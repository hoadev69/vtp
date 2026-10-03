#!/usr/bin/env bash
set -Eeuo pipefail

action=${1:-}
release_id=${2:-}
app_root=${3:-/var/www/vtp}
service_name=${VTP_SERVICE_NAME:-vtp}
systemctl_bin=${SYSTEMCTL_BIN:-systemctl}
sudo_bin=${SUDO_BIN:-sudo}
curl_bin=${CURL_BIN:-curl}
npm_bin=${NPM_BIN:-npm}
health_url=${VTP_HEALTH_URL:-http://127.0.0.1:3001/healthz}
frontend_url=${VTP_FRONTEND_URL:-http://127.0.0.1:3001/}
health_retries=${VTP_HEALTH_RETRIES:-15}
health_interval=${VTP_HEALTH_INTERVAL:-2}
service_user=''
service_group=''
service_uid=''
service_gid=''
service_environment=''

if [[ ! "$release_id" =~ ^[0-9a-f]{40}-[0-9]+$ ]]; then
    echo "Invalid release id." >&2
    exit 2
fi
if [[ "$action" != deploy && "$action" != rollback ]]; then
    echo "Usage: $0 <deploy|rollback> <commit-sha-run-id> [app-root]" >&2
    exit 2
fi
if [[ ! -d "$app_root" || -L "$app_root" ]]; then
    echo "Application root must be an existing, non-symlink directory." >&2
    exit 1
fi
app_root=$(cd -- "$app_root" && pwd -P)
current_link="$app_root/current"
releases_dir="$app_root/releases"
staging_dir="$app_root/staging"
backups_dir="$app_root/backups"

die() {
    echo "$1" >&2
    exit 1
}

unit_property() {
    "$systemctl_bin" show "--property=$1" --value "$service_name"
}

require_service_layout() {
    local working_directory exec_start environment_files
    working_directory=$(unit_property WorkingDirectory) || die "Could not inspect systemd WorkingDirectory."
    exec_start=$(unit_property ExecStart) || die "Could not inspect systemd ExecStart."
    environment_files=$(unit_property EnvironmentFiles) || die "Could not inspect systemd EnvironmentFiles."
    service_user=$(unit_property User) || die "Could not inspect systemd User."
    service_group=$(unit_property Group) || die "Could not inspect systemd Group."
    service_environment=$(unit_property Environment) || die "Could not inspect systemd Environment."
    [[ "$working_directory" == "$app_root" ]] \
        || die "Expected systemd WorkingDirectory=$app_root; refusing release switch."
    [[ "$exec_start" == *"$current_link/server.js"* ]] \
        || die "Expected systemd ExecStart to use $current_link/server.js; refusing release switch."
    [[ -n "$service_user" && "$service_user" != root ]] \
        || die "systemd must specify a non-root User; refusing release switch."
    [[ -n "$service_group" ]] || die "systemd must specify a Group; refusing release switch."
    case "$environment_files" in
        ''|'[]') ;;
        "$app_root/.env (ignore_errors=no)")
            [[ -f "$app_root/.env" && ! -L "$app_root/.env" ]] \
                || die "The required systemd EnvironmentFile must be a regular $app_root/.env file."
            ;;
        *) die "Only EnvironmentFile=$app_root/.env is supported; refusing an unknown environment source." ;;
    esac
    service_database_path=$(unit_environment_value DATABASE_PATH)
    [[ "$service_database_path" == /* ]] \
        || die "systemd must declare an absolute DATABASE_PATH; refusing to guess the SQLite location."
    [[ "$service_database_path" == "$app_root/data/history.sqlite" ]] \
        || die "Expected DATABASE_PATH=$app_root/data/history.sqlite; refusing to switch releases."
    service_uid=$(id -u "$service_user") || die "systemd User does not exist."
    service_gid=$(getent group "$service_group" | cut -d: -f3) || die "systemd Group does not exist."
    [[ "$service_uid" != 0 && "$service_gid" =~ ^[0-9]+$ ]] \
        || die "systemd service account must be a valid non-root user and group."
    if [[ -e "$app_root/.env" || -L "$app_root/.env" ]]; then
        local env_owner env_group env_mode
        [[ -f "$app_root/.env" && ! -L "$app_root/.env" ]] \
            || die "Application .env must be a regular file, not a symlink."
        env_owner=$(stat -c '%u' -- "$app_root/.env") || die "Cannot inspect application .env owner."
        env_group=$(stat -c '%g' -- "$app_root/.env") || die "Cannot inspect application .env group."
        env_mode=$(stat -c '%a' -- "$app_root/.env") || die "Cannot inspect application .env permissions."
        env_mode=$((8#$env_mode))
        (( (env_mode & 0017) == 0 && (env_mode & 0020) == 0 )) \
            || die "Application .env must not be accessible to others or group-writable."
        if [[ "$env_owner" == "$service_uid" ]]; then
            (( (env_mode & 0400) != 0 )) || die "systemd User cannot read application .env."
        elif [[ "$env_group" == "$service_gid" ]]; then
            (( (env_mode & 0040) != 0 )) || die "systemd Group cannot read application .env."
        else
            die "Application .env is not readable by the configured systemd User or Group."
        fi
    fi
}

unit_environment_value() {
    local variable_name=$1
    if [[ "$service_environment" =~ (^|[[:space:]])${variable_name}=([^[:space:]]+) ]]; then
        printf '%s' "${BASH_REMATCH[2]}"
    fi
}

validate_runtime_environment() {
    [[ "$(unit_environment_value NODE_ENV)" == production \
        && "$(unit_environment_value PORT)" == 3001 ]] \
        || return 1
}

preflight_restart_permission() {
    local systemctl_path
    systemctl_path=$(command -v "$systemctl_bin") || die "systemctl is unavailable."
    "$sudo_bin" -n -l "$systemctl_path" restart "$service_name" >/dev/null 2>&1 \
        || die "Existing non-interactive sudo permission to restart $service_name is missing."
}

assert_service_owned_path() {
    local target=$1 target_type=$2 owner group mode required_mode forbidden_mode
    owner=$(stat -c '%u' -- "$target") || die "Cannot stat required SQLite path: $target."
    group=$(stat -c '%g' -- "$target") || die "Cannot stat required SQLite path: $target."
    mode=$(stat -c '%a' -- "$target") || die "Cannot read SQLite permissions: $target."
    [[ "$owner" == "$service_uid" && "$group" == "$service_gid" ]] \
        || die "SQLite path must be owned by the configured service User:Group: $target."
    mode=$((8#$mode))
    if [[ "$target_type" == directory ]]; then
        required_mode=$((0700))
        forbidden_mode=$((0027))
    else
        required_mode=$((0600))
        forbidden_mode=$((0037))
    fi
    (( (mode & required_mode) == required_mode )) \
        || die "Service user lacks required owner permissions on SQLite path: $target."
    (( (mode & forbidden_mode) == 0 )) \
        || die "SQLite path grants group-write or other-user access: $target."
}

ensure_backup_directory() {
    local owner mode backup_user_id
    if [[ ! -e "$backups_dir" ]]; then
        mkdir -m 0700 -- "$backups_dir" || die "Cannot create private SQLite backup directory."
    fi
    [[ -d "$backups_dir" && ! -L "$backups_dir" ]] \
        || die "SQLite backup path must be a real directory."
    owner=$(stat -c '%u' -- "$backups_dir") || die "Cannot inspect SQLite backup directory."
    mode=$(stat -c '%a' -- "$backups_dir") || die "Cannot inspect SQLite backup permissions."
    backup_user_id=$(id -u) || die "Cannot identify deployment user."
    mode=$((8#$mode))
    [[ "$owner" == "$backup_user_id" && -w "$backups_dir" ]] \
        || die "Deployment user must own and write the SQLite backup directory."
    (( (mode & 0077) == 0 )) || die "SQLite backup directory must not be accessible to group or other users."
}

current_release() {
    [[ -L "$current_link" ]] || die "No current release symlink exists; one-time VPS release-layout bootstrap is required."
    local target
    target=$(realpath -e -- "$current_link") || die "The current release symlink is broken."
    [[ "$target" == "$releases_dir/"* && -d "$target" ]] \
        || die "The current symlink does not point to a retained release."
    printf '%s\n' "$target"
}

wait_for_health() {
    local attempt
    for ((attempt = 1; attempt <= health_retries; attempt += 1)); do
        if "$systemctl_bin" is-active --quiet "$service_name" \
            && "$curl_bin" --fail --silent --output /dev/null --max-time 3 "$health_url" \
            && "$curl_bin" --fail --silent --output /dev/null --max-time 3 "$frontend_url"; then
            return 0
        fi
        if (( attempt < health_retries )); then
            sleep "$health_interval"
        fi
    done
    return 1
}

switch_current() {
    local target=$1 temporary_link="$app_root/.current-${release_id}-$$"
    rm -f -- "$temporary_link"
    ln -s -- "$target" "$temporary_link"
    mv -Tf -- "$temporary_link" "$current_link"
}

restart_service() {
    "$sudo_bin" "$systemctl_bin" restart "$service_name"
}

rollback_after_failure() {
    local previous_release=$1
    echo "Candidate release failed health checks; restoring the previous release."
    switch_current "$previous_release"
    if ! restart_service; then
        echo "Rollback pointer restored, but systemd restart failed." >&2
        return 1
    fi
    if ! wait_for_health; then
        echo "Previous release did not pass the rollback health check." >&2
        return 1
    fi
    echo "Previous release is active and healthy."
}

database_path_for_release() {
    unit_environment_value DATABASE_PATH
}

backup_database() {
    local stage=$1 db_path=$2 backup_path=$3
    node - "$stage" "$db_path" "$backup_path" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const Database = require(path.join(process.argv[2], 'node_modules', 'better-sqlite3'));
const sourcePath = process.argv[3];
const backupPath = process.argv[4];
(async () => {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true, timeout: 10000 });
    try {
        await source.backup(backupPath);
    } finally {
        source.close();
    }
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
        if (backup.pragma('integrity_check', { simple: true }) !== 'ok') {
            throw new Error('SQLite backup integrity check failed.');
        }
        if (backup.pragma('foreign_key_check').length !== 0) {
            throw new Error('SQLite backup foreign-key check failed.');
        }
    } finally {
        backup.close();
    }
    fs.chmodSync(backupPath, 0o600);
})().catch(error => {
    console.error(`SQLite backup failed: ${error.message}`);
    process.exitCode = 1;
});
NODE
}

require_service_layout
preflight_restart_permission
previous_release=$(current_release)
validate_runtime_environment \
    || die "Runtime must resolve to NODE_ENV=production and PORT=3001 before switching releases."

if [[ "$action" == rollback ]]; then
    target_release="$releases_dir/$release_id"
    [[ -d "$target_release" && ! -L "$target_release" ]] \
        || die "Requested rollback release does not exist."
    target_release=$(realpath -e -- "$target_release")
    if [[ "$target_release" == "$previous_release" ]]; then
        echo "Requested release is already active and healthy."
        exit 0
    fi
    switch_current "$target_release"
    if ! restart_service || ! wait_for_health; then
        rollback_after_failure "$previous_release" || true
        die "Requested rollback failed; previous release restoration was attempted."
    fi
    echo "Rollback release is active and healthy: $release_id"
    exit 0
fi

"$systemctl_bin" is-active --quiet "$service_name" \
    || die "The current systemd service is not active; refusing release switch."
wait_for_health || die "The current release is not healthy; refusing release switch."

stage="$staging_dir/$release_id"
release="$releases_dir/$release_id"
[[ -d "$stage" && ! -L "$stage" ]] || die "Staged artifact directory is missing."
[[ ! -e "$release" && ! -L "$release" ]] || die "Release id already exists; refusing to overwrite it."
[[ "$(<"$stage/RELEASE_SHA")" == "${release_id%-*}" ]] || die "Artifact commit SHA does not match the release id."
[[ -s "$stage/frontend/dist/index.html" && -s "$stage/server.js" ]] || die "Staged artifact is incomplete."
[[ ! -e "$stage/.env" && ! -e "$stage/data" && ! -e "$stage/node_modules" ]] \
    || die "Staged artifact contains runtime environment, data, or dependencies."
[[ -d "$app_root/data" ]] || die "Persistent application data directory is missing."

(
    cd "$stage"
    "$npm_bin" ci --omit=dev --no-audit --no-fund
    node --check server.js
    node -e "for (const name of ['express', 'better-sqlite3', 'express-session']) require.resolve(name)"
)
ln -s -- "$app_root/data" "$stage/data"

database_path=$(database_path_for_release) || die "Could not resolve the configured SQLite path."
[[ "$database_path" == /* && -f "$database_path" ]] \
    || die "Configured SQLite database does not exist; refusing to create or replace it."
database_path=$(realpath -e -- "$database_path")
[[ "$database_path" != "$releases_dir/"* && "$database_path" != "$staging_dir/"* ]] \
    || die "SQLite database must be outside release and staging directories."
database_directory=$(dirname -- "$database_path")
assert_service_owned_path "$database_directory" directory
assert_service_owned_path "$database_path" file
for sidecar in "$database_path-wal" "$database_path-shm"; do
    if [[ -e "$sidecar" ]]; then
        [[ -f "$sidecar" && ! -L "$sidecar" ]] || die "SQLite sidecar must be a regular file: $sidecar."
        assert_service_owned_path "$sidecar" file
    fi
done
ensure_backup_directory
backup_path="$backups_dir/history-${release_id}-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
[[ ! -e "$backup_path" ]] || die "SQLite backup destination already exists."
backup_database "$stage" "$database_path" "$backup_path"

mv -- "$stage" "$release"
release=$(realpath -e -- "$release")
switch_current "$release"
if ! restart_service; then
    rollback_after_failure "$previous_release" || true
    die "systemd restart failed; rollback was attempted."
fi
if ! wait_for_health; then
    rollback_after_failure "$previous_release" || true
    die "New release failed health checks; rollback was attempted."
fi

echo "Release is active and healthy: $release_id"