#!/usr/bin/env bash
set -uo pipefail

usage() {
    echo "Usage: $0 <--read-only|--check>" >&2
    exit 2
}

[[ $# -eq 1 ]] || usage
mode=$1
[[ "$mode" == --read-only || "$mode" == --check ]] || usage

app_root=${VTP_INVENTORY_ROOT:-/var/www/vtp}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
git_repository='not a Git checkout or Git unavailable'
if command -v git >/dev/null 2>&1; then
    git_repository=$(GIT_OPTIONAL_LOCKS=0 git -C "$script_dir" rev-parse --show-toplevel 2>/dev/null || printf 'not a Git checkout')
fi
service_name=${VTP_SERVICE_NAME:-vtp}
systemctl_bin=${SYSTEMCTL_BIN:-systemctl}
nginx_bin=${NGINX_BIN:-nginx}
sudo_bin=${SUDO_BIN:-sudo}
id_bin=${ID_BIN:-id}
getent_bin=${GETENT_BIN:-getent}
stat_bin=${STAT_BIN:-stat}
realpath_bin=${REALPATH_BIN:-realpath}
ps_bin=${PS_BIN:-ps}
node_bin=${NODE_BIN:-node}
npm_bin=${NPM_BIN:-npm}
deploy_user=${VTP_DEPLOY_USER:-}
current_user=$($id_bin -un 2>/dev/null || printf 'unknown')
checks_failed=0
checks_confirm=0

if [[ -d "$app_root" && ! -L "$app_root" ]]; then
    app_root=$(cd -- "$app_root" && pwd -P)
fi

usage_section() {
    printf '\n[%s]\n' "$1"
}

capture_command_version() {
    local command_name=$1 version_pattern=$2 version_output
    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf 'not installed'
        return
    fi
    if [[ "${command_name##*/}" == npm ]]; then
        version_output=$(npm_config_logs_max=0 npm_config_update_notifier=false \
            "$command_name" --version --logs-max=0 --update-notifier=false 2>/dev/null || true)
    else
        version_output=$("$command_name" --version 2>/dev/null || true)
    fi
    if [[ "$version_output" =~ $version_pattern ]]; then
        printf '%s' "${BASH_REMATCH[0]}"
    else
        printf 'installed; version unavailable'
    fi
}

systemd_property() {
    "$systemctl_bin" show "--property=$1" --value "$service_name" 2>/dev/null
}

environment_value() {
    local key=$1 raw token='' quote='' escaped=0 character index
    local -a tokens
    raw=$(systemd_property Environment) || return 0
    tokens=()
    for ((index = 0; index < ${#raw}; index += 1)); do
        character=${raw:index:1}
        if (( escaped )); then
            token+=$character
            escaped=0
        elif [[ "$character" == \\ ]]; then
            escaped=1
        elif [[ -n "$quote" ]]; then
            if [[ "$character" == "$quote" ]]; then quote=''; else token+=$character; fi
        elif [[ "$character" == '"' || "$character" == "'" ]]; then
            quote=$character
        elif [[ "$character" == ' ' || "$character" == $'\t' || "$character" == $'\n' ]]; then
            if [[ -n "$token" ]]; then tokens+=("$token"); token=''; fi
        else
            token+=$character
        fi
    done
    [[ -n "$token" ]] && tokens+=("$token")
    for token in "${tokens[@]}"; do
        case "$token" in
            "$key"=*) printf '%s' "${token#*=}"; return 0 ;;
        esac
    done
}

path_metadata() {
    local label=$1 path=$2 details
    if [[ -e "$path" || -L "$path" ]]; then
        details=$($stat_bin -c '%F|%U:%G|%a' -- "$path" 2>/dev/null || true)
        if [[ -n "$details" ]]; then
            printf '%s: %s (%s)\n' "$label" "$path" "$details"
        else
            printf '%s: %s (metadata unavailable)\n' "$label" "$path"
        fi
    else
        printf '%s: %s (missing)\n' "$label" "$path"
    fi
}

systemd_load_state=$(systemd_property LoadState 2>/dev/null || true)
unit_user=$(systemd_property User 2>/dev/null || true)
unit_group=$(systemd_property Group 2>/dev/null || true)
unit_working_directory=$(systemd_property WorkingDirectory 2>/dev/null || true)
unit_exec_start=$(systemd_property ExecStart 2>/dev/null || true)
unit_environment_files=$(systemd_property EnvironmentFiles 2>/dev/null || true)
node_env=$(environment_value NODE_ENV)
port=$(environment_value PORT)
database_path=$(environment_value DATABASE_PATH)
trust_proxy_hops=$(environment_value TRUST_PROXY_HOPS)

current_target=''
if [[ -L "$app_root/current" ]]; then
    current_target=$(realpath -e -- "$app_root/current" 2>/dev/null || true)
fi

nginx_directives=''
nginx_config_ok=0
if command -v "$nginx_bin" >/dev/null 2>&1; then
    nginx_directives=$("$nginx_bin" -T 2>/dev/null | awk '
        {
            line = $0
            sub(/^[[:space:]]*/, "", line)
            if (line ~ /^proxy_pass[[:space:]]+https?:\/\/[^\/;[:space:]]+@/) {
                print "proxy_pass [upstream credentials redacted];"
            } else if (line ~ /^(server_name|root|proxy_pass|listen|ssl_certificate)[[:space:]]/) {
                print line
            }
        }
    ' || true)
    if "$nginx_bin" -t >/dev/null 2>&1; then nginx_config_ok=1; fi
fi

usage_section 'Host'
os_name=$(awk -F= '$1 == "PRETTY_NAME" { gsub(/^"|"$/, "", $2); print $2; exit }' /etc/os-release 2>/dev/null)
printf 'Ubuntu/OS: %s\n' "${os_name:-unknown}"
printf 'Node.js: %s\n' "$(capture_command_version "$node_bin" 'v[0-9]+\.[0-9]+\.[0-9]+')"
printf 'npm: %s\n' "$(capture_command_version "$npm_bin" '[0-9]+\.[0-9]+\.[0-9]+')"
nginx_version='not installed'
if command -v "$nginx_bin" >/dev/null 2>&1; then
    raw_nginx_version=$("$nginx_bin" -v 2>&1 || true)
    if [[ "$raw_nginx_version" =~ nginx/[0-9]+\.[0-9]+\.[0-9]+ ]]; then
        nginx_version=${BASH_REMATCH[0]}
    else
        nginx_version='installed; version unavailable'
    fi
fi
printf 'Nginx: %s; service=%s; config-test=%s\n' \
    "$nginx_version" "$("$systemctl_bin" is-active nginx 2>/dev/null || printf 'unknown')" \
    "$([[ $nginx_config_ok -eq 1 ]] && printf 'ok' || printf 'unavailable/failed')"

usage_section 'Application service'
printf 'Service: %s; LoadState=%s; ActiveState=%s\n' \
    "$service_name" "${systemd_load_state:-unknown}" \
    "$("$systemctl_bin" is-active "$service_name" 2>/dev/null || printf 'unknown')"
printf 'User=%s; Group=%s\n' "${unit_user:-unset}" "${unit_group:-unset}"
printf 'WorkingDirectory=%s\n' "${unit_working_directory:-unset}"
exec_entrypoint=no
if [[ "$unit_exec_start" == *"$app_root/current/server.js"* ]]; then exec_entrypoint=yes; fi
exec_command='unset'
if [[ -n "$unit_exec_start" ]]; then
    exec_command=${unit_exec_start%% *}
    [[ "$exec_command" == '{'* ]] && exec_command='structured command (executable redacted)'
fi
printf 'ExecStart executable=%s; arguments redacted; current/server.js=%s\n' "$exec_command" "$exec_entrypoint"
printf 'EnvironmentFile=%s\n' "${unit_environment_files:-none reported}"
printf 'NODE_ENV=%s; PORT=%s; DATABASE_PATH=%s; TRUST_PROXY_HOPS=%s\n' \
    "${node_env:-unset}" "${port:-unset}" "${database_path:-unset}" "${trust_proxy_hops:-unset}"

usage_section 'Application paths and permissions'
printf 'Configured app root: %s\n' "$app_root"
printf 'Inventory script Git root: %s\n' "$git_repository"
printf 'Current release target: %s\n' "${current_target:-unavailable}"
for path_name in root current releases staging incoming data backups; do
    case "$path_name" in
        root) path_metadata app-root "$app_root" ;;
        *) path_metadata "$path_name" "$app_root/$path_name" ;;
    esac
done
if [[ -n "$current_target" ]]; then
    path_metadata current-release "$current_target"
    path_metadata current-server "$current_target/server.js"
    path_metadata current-frontend-dist "$current_target/frontend/dist"
fi
path_metadata application-env "$app_root/.env"
if [[ -d "$app_root/backups" ]]; then
    for backup_file in "$app_root"/backups/history-*.sqlite; do
        if [[ -e "$backup_file" || -L "$backup_file" ]]; then path_metadata backup-file "$backup_file"; fi
    done
fi
if [[ "$database_path" == /* ]]; then
    path_metadata sqlite "$database_path"
    path_metadata sqlite-wal "$database_path-wal"
    path_metadata sqlite-shm "$database_path-shm"
    path_metadata sqlite-directory "$(dirname -- "$database_path")"
else
    printf 'SQLite/WAL/SHM paths: unavailable until an absolute DATABASE_PATH is configured\n'
fi

usage_section 'Nginx configuration summary'
if [[ -n "$nginx_directives" ]]; then
    printf '%s\n' "$nginx_directives"
else
    printf 'Active Nginx configuration could not be inspected.\n'
fi
if printf '%s\n' "$nginx_directives" | grep -Eq 'listen[[:space:]][^;]*ssl|ssl_certificate[[:space:]]'; then
    printf 'TLS directives: detected in local Nginx configuration\n'
else
    printf 'TLS directives: not detected locally; upstream TLS termination requires confirmation\n'
fi

usage_section 'Process manager and deployment identity'
if command -v pm2 >/dev/null 2>&1; then
    printf 'PM2: executable installed; process details are not queried to avoid exposing command/environment data\n'
else
    printf 'PM2: executable not installed\n'
fi
pm2_process_count=0
if command -v "$ps_bin" >/dev/null 2>&1; then
    pm2_process_count=$("$ps_bin" -eo comm= 2>/dev/null | awk 'tolower($0) ~ /pm2|god daemon/ { count++ } END { print count+0 }')
fi
printf 'PM2-like process names visible: %s (process arguments not inspected)\n' "$pm2_process_count"
printf 'Inventory caller: %s\n' "$current_user"
if [[ -n "$deploy_user" ]]; then
    printf 'VTP_DEPLOY_USER: %s\n' "$deploy_user"
else
    printf 'VTP_DEPLOY_USER: not supplied; GitHub VPS_USER cannot be inferred from this host\n'
fi

systemctl_path=$(command -v "$systemctl_bin" 2>/dev/null || true)
sudo_status='not checked'
if [[ -n "$deploy_user" && -n "$systemctl_path" ]] && command -v "$sudo_bin" >/dev/null 2>&1; then
    if [[ "$deploy_user" == "$current_user" ]]; then
        if "$sudo_bin" -n -l "$systemctl_path" restart "$service_name" >/dev/null 2>&1; then sudo_status='allowed'; else sudo_status='not allowed or not verifiable'; fi
    elif [[ "$current_user" == root ]]; then
        if "$sudo_bin" -n -l -U "$deploy_user" "$systemctl_path" restart "$service_name" >/dev/null 2>&1; then sudo_status='allowed'; else sudo_status='not allowed or not verifiable'; fi
    else
        sudo_status='not checked; run inventory as the configured deploy user'
    fi
fi
printf 'Non-interactive sudo restart check: %s\n' "$sudo_status"
printf 'GitHub Secret VPS_USER value: unavailable to this script; compare locally without printing secrets\n'

if [[ "$mode" == --read-only ]]; then
    printf '\nMode: read-only collection only; no deployment checks or mutations performed.\n'
    exit 0
fi

usage_section 'Deployment preflight checks'
record_check() {
    local status=$1 label=$2 detail=$3
    printf '%-22s %s: %s\n' "$status" "$label" "$detail"
    case "$status" in
        FAIL) checks_failed=$((checks_failed + 1)) ;;
        CONFIRM) checks_confirm=$((checks_confirm + 1)) ;;
    esac
}

if [[ "$systemd_load_state" == loaded ]]; then
    record_check PASS 'systemd unit' "$service_name is loaded"
else
    record_check FAIL 'systemd unit' "missing or not loaded ($service_name)"
fi
if [[ "$os_name" == *'Ubuntu 24.04'* ]]; then
    record_check PASS 'Ubuntu version' "$os_name"
else
    record_check FAIL 'Ubuntu version' 'Ubuntu 24.04 is required by the VPS preparation scope'
fi
node_version=$(capture_command_version "$node_bin" 'v[0-9]+\.[0-9]+\.[0-9]+')
if [[ "$node_version" == v24.* ]]; then
    record_check PASS 'Node.js version' "$node_version"
else
    record_check FAIL 'Node.js version' "expected Node.js 24; found $node_version"
fi
if [[ -n "$unit_user" && "$unit_user" != root ]]; then
    record_check PASS 'service user' "non-root User is configured ($unit_user)"
else
    record_check FAIL 'service user' 'explicit non-root User is required'
fi
service_uid=''
if [[ -n "$unit_user" ]]; then service_uid=$($id_bin -u "$unit_user" 2>/dev/null || true); fi
if [[ -n "$unit_group" ]]; then
    service_gid=$($getent_bin group "$unit_group" 2>/dev/null | awk -F: 'NR == 1 { print $3 }')
else
    service_gid=''
fi
if [[ -n "$service_uid" && "$service_uid" != 0 && "$service_gid" =~ ^[0-9]+$ ]]; then
    record_check PASS 'service identity' 'User and Group resolve to non-root numeric IDs'
else
    record_check FAIL 'service identity' 'configured User/Group do not resolve to a valid non-root identity'
fi
if [[ "$unit_working_directory" == "$app_root" ]]; then
    record_check PASS 'WorkingDirectory' "$app_root"
else
    record_check FAIL 'WorkingDirectory' "expected $app_root"
fi
if [[ "$exec_entrypoint" == yes ]]; then
    record_check PASS 'ExecStart' 'references current/server.js (arguments redacted)'
else
    record_check FAIL 'ExecStart' 'must reference current/server.js'
fi
if [[ -z "$unit_environment_files" || "$unit_environment_files" == '[]' ]]; then
    record_check PASS 'EnvironmentFile' 'none; runtime values are checked from Environment'
else
    record_check FAIL 'EnvironmentFile' 'unsupported by the deployment helper; reconcile before deploy'
fi
if [[ "$node_env" == production && "$port" == 3001 ]]; then
    record_check PASS 'runtime environment' 'NODE_ENV=production and PORT=3001'
else
    record_check FAIL 'runtime environment' 'explicit NODE_ENV=production and PORT=3001 are required'
fi

active_state=$("$systemctl_bin" is-active "$service_name" 2>/dev/null || true)
if [[ "$active_state" == active ]]; then
    record_check PASS 'service active' 'systemd reports active'
else
    record_check FAIL 'service active' "systemd reports ${active_state:-unknown}"
fi
if [[ -L "$app_root/current" && -n "$current_target" && "$current_target" == "$app_root/releases/"* && -d "$current_target" ]]; then
    record_check PASS 'current release' 'symlink resolves to an existing release'
else
    record_check FAIL 'current release' 'a valid current symlink to a retained release is required'
fi
if [[ -d "$app_root/data" ]]; then
    record_check PASS 'persistent data dir' 'application data directory exists'
else
    record_check FAIL 'persistent data dir' 'expected an existing data directory outside releases'
fi
if [[ -e "$app_root/.env" || -L "$app_root/.env" ]]; then
    env_fields=$($stat_bin -c '%u %g %a %F' -- "$app_root/.env" 2>/dev/null || true)
    read -r env_owner env_group env_mode env_type <<< "$env_fields"
    if [[ -n "$env_fields" && "$env_type" == 'regular file' && -n "$service_uid" && -n "$service_gid" ]]; then
        env_mode=$((8#$env_mode))
        if (( (env_mode & 0017) == 0 && (env_mode & 0020) == 0 )) \
            && { [[ "$env_owner" == "$service_uid" && $((env_mode & 0400)) -ne 0 ]] \
                || [[ "$env_group" == "$service_gid" && $((env_mode & 0040)) -ne 0 ]]; }; then
            record_check PASS '.env permissions' 'regular file; readable by service identity without other access'
        else
            record_check FAIL '.env permissions' 'file type, service readability, or access mode is unsafe'
        fi
    else
        record_check FAIL '.env permissions' 'application .env is not a readable regular file'
    fi
else
    record_check CONFIRM '.env permissions' 'no root .env file; confirm credentials are supplied through an approved source'
fi

if [[ "$database_path" != /* ]]; then
    record_check FAIL 'DATABASE_PATH' 'an explicit absolute path in systemd Environment is required'
elif [[ "$database_path" != "$app_root/data/history.sqlite" ]]; then
    record_check FAIL 'DATABASE_PATH' "expected $app_root/data/history.sqlite; do not move or replace the current database before a reviewed migration plan"
elif [[ ! -f "$database_path" ]]; then
    record_check FAIL 'DATABASE_PATH' 'configured SQLite file is missing or not a regular file'
else
    resolved_database_path=$(realpath -e -- "$database_path" 2>/dev/null || true)
    if [[ -z "$resolved_database_path" || "$resolved_database_path" == "$app_root/releases/"* || "$resolved_database_path" == "$app_root/staging/"* ]]; then
        record_check FAIL 'DATABASE_PATH' 'SQLite must resolve outside releases and staging'
    else
        record_check PASS 'DATABASE_PATH' 'absolute existing SQLite file resolves outside releases/staging'
        check_sqlite_path() {
            local target=$1 type=$2 fields owner_id group_id mode file_type required forbidden
            fields=$($stat_bin -c '%u %g %a %F' -- "$target" 2>/dev/null || true)
            if [[ -z "$fields" ]]; then
                record_check FAIL "$type permissions" "$target is missing or cannot be inspected"
                return
            fi
            read -r owner_id group_id mode file_type <<< "$fields"
            if [[ "$type" == directory ]]; then
                required=$((0700))
                forbidden=$((0027))
                [[ "$file_type" == directory ]] || { record_check FAIL "$type permissions" "$target is not a directory"; return; }
            else
                required=$((0600))
                forbidden=$((0037))
                [[ "$file_type" == 'regular file' ]] || { record_check FAIL "$type permissions" "$target is not a regular file"; return; }
            fi
            mode=$((8#$mode))
            if [[ "$owner_id" == "$service_uid" && "$group_id" == "$service_gid" ]] \
                && (( (mode & required) == required && (mode & forbidden) == 0 )); then
                record_check PASS "$type permissions" 'owner/group and mode are compatible with service identity'
            else
                record_check FAIL "$type permissions" "$target owner/group or mode is incompatible with service identity"
            fi
        }
        check_sqlite_path "$(dirname -- "$resolved_database_path")" directory
        check_sqlite_path "$resolved_database_path" file
        for sidecar in "$resolved_database_path-wal" "$resolved_database_path-shm"; do
            if [[ -e "$sidecar" || -L "$sidecar" ]]; then check_sqlite_path "$sidecar" file; fi
        done
    fi
fi

if [[ $nginx_config_ok -eq 1 ]]; then
    record_check PASS 'Nginx config' 'nginx -t passed'
else
    record_check FAIL 'Nginx config' 'Nginx unavailable or nginx -t failed'
fi
nginx_active=$("$systemctl_bin" is-active nginx 2>/dev/null || true)
if [[ "$nginx_active" == active ]]; then
    record_check PASS 'Nginx service' 'systemd reports active'
else
    record_check FAIL 'Nginx service' "systemd reports ${nginx_active:-unknown}"
fi
if printf '%s\n' "$nginx_directives" | grep -Fq "root $app_root/current/frontend/dist;"; then
    record_check PASS 'Nginx root' 'points to current/frontend/dist'
else
    record_check FAIL 'Nginx root' 'active config does not show the expected release document root'
fi
if printf '%s\n' "$nginx_directives" | grep -Eq 'proxy_pass[[:space:]]+http://127\.0\.0\.1:3001;'; then
    record_check PASS 'Nginx API proxy' 'local Express upstream is configured'
else
    record_check FAIL 'Nginx API proxy' 'active config does not show the expected loopback upstream'
fi
if printf '%s\n' "$nginx_directives" | grep -Eq 'server_name[[:space:]]+[^;]+;'; then
    record_check CONFIRM 'Nginx host/TLS' 'verify real hostname, TLS termination, and proxy chain with the operator'
else
    record_check FAIL 'Nginx host/TLS' 'no server_name directive was identified'
fi

if [[ -z "$deploy_user" ]]; then
    record_check CONFIRM 'deploy user' 'set VTP_DEPLOY_USER to the GitHub VPS_USER account before accepting this inventory'
elif ! "$getent_bin" passwd "$deploy_user" >/dev/null 2>&1; then
    record_check FAIL 'deploy user' 'configured VTP_DEPLOY_USER does not resolve'
elif [[ "$deploy_user" != "$current_user" ]]; then
    record_check CONFIRM 'deploy user' 'rerun as the GitHub VPS_USER account to verify its filesystem access directly'
elif [[ "$sudo_status" == allowed ]]; then
    record_check PASS 'sudo restart' 'non-interactive systemctl restart permission was listed'
else
    record_check FAIL 'sudo restart' 'required non-interactive restart permission is missing or could not be verified'
fi
if [[ -n "$deploy_user" && "$deploy_user" == "$current_user" ]]; then
    for directory in incoming staging releases; do
        target_directory="$app_root/$directory"
        if [[ -d "$target_directory" && -w "$target_directory" && -x "$target_directory" ]]; then
            record_check PASS "deploy $directory" 'current inventory user can write/traverse the existing directory'
        else
            record_check FAIL "deploy $directory" 'current inventory user lacks required existing-directory write/traverse access'
        fi
    done
    if [[ -n "$database_path" && -f "$database_path" && -r "$database_path" && -x "$(dirname -- "$database_path")" ]]; then
        record_check PASS 'deploy DB read' 'current inventory user can read the configured DB path'
    else
        record_check FAIL 'deploy DB read' 'current inventory user cannot confirm read/traverse access to the DB path'
    fi
    if [[ -n "$database_path" ]]; then
        for sidecar in "$database_path-wal" "$database_path-shm"; do
            if [[ -e "$sidecar" || -L "$sidecar" ]]; then
                if [[ -f "$sidecar" && -r "$sidecar" ]]; then
                    record_check PASS 'deploy sidecar read' "current inventory user can read $(basename -- "$sidecar")"
                else
                    record_check FAIL 'deploy sidecar read' "current inventory user cannot read $(basename -- "$sidecar")"
                fi
            fi
        done
    fi
fi
if [[ $pm2_process_count -gt 0 ]]; then
    record_check CONFIRM 'PM2' 'PM2-like processes are visible; confirm they do not own the production app'
else
    record_check PASS 'PM2' 'no PM2-like process name was visible to this inventory caller'
fi
if [[ "$nginx_directives" == *'server_name vtp.example.com;'* ]]; then
    record_check FAIL 'Nginx placeholder' 'sample hostname vtp.example.com must not be used as the production host'
fi
if [[ -d "$app_root/backups" ]]; then
    backup_fields=$($stat_bin -c '%u %a' -- "$app_root/backups" 2>/dev/null || true)
    read -r backup_owner backup_mode <<< "$backup_fields"
    if [[ -n "$deploy_user" ]]; then deploy_uid=$($id_bin -u "$deploy_user" 2>/dev/null || true); else deploy_uid=''; fi
    if [[ -n "$backup_fields" && -n "$deploy_uid" && "$backup_owner" == "$deploy_uid" ]]; then
        backup_mode=$((8#$backup_mode))
        if (( (backup_mode & 0077) == 0 )); then
            record_check PASS 'backup directory' 'owned by deploy user and private to that user'
        else
            record_check FAIL 'backup directory' 'group/other access must be removed after operator approval'
        fi
    else
        record_check FAIL 'backup directory' 'must be owned by the configured deploy user with mode 0700'
    fi
else
    record_check CONFIRM 'backup directory' 'not present; deployment helper may create it if the deploy identity can do so safely'
fi

printf '\nSummary: %s failure(s), %s item(s) requiring operator confirmation.\n' "$checks_failed" "$checks_confirm"
if (( checks_failed > 0 || checks_confirm > 0 )); then exit 1; fi
exit 0