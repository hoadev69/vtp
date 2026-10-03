const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const inventoryScript = path.join(__dirname, '..', 'ops', 'vps-inventory.sh');

function writeExecutable(filePath, contents) {
    fs.writeFileSync(filePath, contents, { mode: 0o700 });
}

function snapshotTree(root) {
    const entries = [];
    const visit = directory => {
        for (const name of fs.readdirSync(directory).sort()) {
            const entryPath = path.join(directory, name);
            const info = fs.lstatSync(entryPath);
            const relativePath = path.relative(root, entryPath);
            const entry = {
                path: relativePath,
                mode: info.mode & 0o7777,
                size: info.size,
                mtimeMs: info.mtimeMs,
            };
            if (info.isSymbolicLink()) {
                entry.target = fs.readlinkSync(entryPath);
            } else if (info.isFile()) {
                entry.hash = crypto.createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex');
            } else if (info.isDirectory()) {
                visit(entryPath);
            }
            entries.push(entry);
        }
    };
    visit(root);
    return entries;
}

test('VPS inventory is read-only, filters secrets, and flags missing deployment prerequisites', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-vps-inventory-'));
    const appRoot = path.join(temporaryRoot, 'app');
    const tools = path.join(temporaryRoot, 'tools');
    const databasePath = path.join(appRoot, 'data', 'history.sqlite');
    const releasePath = path.join(appRoot, 'releases', 'a'.repeat(40) + '-1');
    const mutationMarker = path.join(temporaryRoot, 'unexpected-mutation');
    const secret = 'INVENTORY_SECRET_SENTINEL';
    const nginxSecret = 'NGINX_PROXY_PASSWORD_SENTINEL';

    try {
        for (const directory of ['data', 'releases', 'staging', 'incoming', 'backups']) {
            fs.mkdirSync(path.join(appRoot, directory), { recursive: true });
        }
        fs.mkdirSync(path.join(releasePath, 'frontend', 'dist'), { recursive: true });
        fs.mkdirSync(tools);
        fs.writeFileSync(path.join(releasePath, 'server.js'), 'fixture');
        fs.symlinkSync(releasePath, path.join(appRoot, 'current'));
        fs.writeFileSync(databasePath, 'disposable fixture, not a real SQLite database');
        fs.writeFileSync(`${databasePath}-wal`, 'fixture sidecar');
        fs.writeFileSync(`${databasePath}-shm`, 'fixture sidecar');
        fs.writeFileSync(path.join(appRoot, '.env'), `SESSION_SECRET=${secret}\n`);
        fs.chmodSync(path.join(appRoot, 'data'), 0o700);
        fs.chmodSync(path.join(appRoot, 'backups'), 0o700);
        fs.chmodSync(databasePath, 0o600);
        fs.chmodSync(`${databasePath}-wal`, 0o600);
        fs.chmodSync(`${databasePath}-shm`, 0o600);
        fs.chmodSync(path.join(appRoot, '.env'), 0o600);
        fs.writeFileSync(path.join(temporaryRoot, 'nginx.conf'), [
            'server {',
            '    listen 443 ssl;',
            '    server_name inventory.example.org;',
            `    root ${appRoot}/current/frontend/dist;`,
            '    location /api/ {',
            '        proxy_pass http://127.0.0.1:3001;',
            '    }',
            '    location /private/ {',
            `        proxy_pass http://user:${nginxSecret}@127.0.0.1:3001;`,
            '    }',
            '    ssl_certificate /etc/ssl/certs/example.pem;',
            '}',
        ].join('\n'));

        const serviceUser = spawnSync('id', ['-un'], { encoding: 'utf8' }).stdout.trim();
        const serviceGroup = spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim();
        writeExecutable(path.join(tools, 'systemctl'), `#!/bin/sh
if [ "$1" = show ]; then
  property=
    for argument in "$@"; do case "$argument" in --property=*) property=$(printf '%s' "$argument" | cut -d= -f2-) ;; esac; done
  if [ "$VTP_FAKE_NO_UNIT" = 1 ]; then
    case "$property" in LoadState) printf not-found ;; *) printf '' ;; esac
    exit 0
  fi
  case "$property" in
    LoadState) printf loaded ;;
    User) printf '%s' "$VTP_FAKE_SERVICE_USER" ;;
    Group) printf '%s' "$VTP_FAKE_SERVICE_GROUP" ;;
    WorkingDirectory) printf '%s' "$VTP_FAKE_APP_ROOT" ;;
    ExecStart) printf '/usr/bin/env node --token=EXECSTART_SECRET %s/current/server.js' "$VTP_FAKE_APP_ROOT" ;;
    EnvironmentFiles) printf '[]' ;;
    Environment) printf '%s' "$VTP_FAKE_ENVIRONMENT" ;;
    *) exit 2 ;;
  esac
elif [ "$1" = is-active ]; then
  case "$2" in vtp|nginx) printf active ;; *) exit 3 ;; esac
else
    printf attempted > "$VTP_MUTATION_MARKER"
  exit 2
fi
`);
        writeExecutable(path.join(tools, 'nginx'), `#!/bin/sh
case "$1" in
  -v) echo 'nginx version: nginx/1.24.0' >&2 ;;
  -t) exit 0 ;;
  -T) cat "$VTP_FAKE_NGINX_CONFIG" ;;
  *) printf attempted > "$VTP_MUTATION_MARKER"; exit 2 ;;
esac
`);
    writeExecutable(path.join(tools, 'sudo'), `#!/bin/sh
if [ "$1" = -n ] && [ "$2" = -l ]; then exit 0; fi
printf attempted > "$VTP_MUTATION_MARKER"
exit 1
`);
        writeExecutable(path.join(tools, 'node'), '#!/bin/sh\nprintf v24.13.0\n');
    writeExecutable(path.join(tools, 'npm'), `#!/bin/sh
if [ "$1" = --version ]; then printf 10.8.2; else printf attempted > "$VTP_MUTATION_MARKER"; exit 1; fi
`);
        writeExecutable(path.join(tools, 'ps'), '#!/bin/sh\nexit 0\n');

        const invoke = (mode, overrides = {}) => spawnSync('bash', [inventoryScript, mode], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${tools}:${process.env.PATH}`,
                SYSTEMCTL_BIN: path.join(tools, 'systemctl'),
                NGINX_BIN: path.join(tools, 'nginx'),
                SUDO_BIN: path.join(tools, 'sudo'),
                NODE_BIN: path.join(tools, 'node'),
                NPM_BIN: path.join(tools, 'npm'),
                PS_BIN: path.join(tools, 'ps'),
                VTP_INVENTORY_ROOT: appRoot,
                VTP_MUTATION_MARKER: mutationMarker,
                VTP_DEPLOY_USER: serviceUser,
                VTP_FAKE_APP_ROOT: appRoot,
                VTP_FAKE_SERVICE_USER: serviceUser,
                VTP_FAKE_SERVICE_GROUP: serviceGroup,
                VTP_FAKE_DATABASE_PATH: databasePath,
                VTP_FAKE_ENVIRONMENT: `NODE_ENV=production PORT=3001 DATABASE_PATH=${databasePath} SESSION_SECRET="${secret} PORT=9999 DATABASE_PATH=/tmp/secret-path"`,
                VTP_FAKE_NGINX_CONFIG: path.join(temporaryRoot, 'nginx.conf'),
                ...overrides,
            },
        });
        const before = snapshotTree(appRoot);

        const readOnly = invoke('--read-only');
        assert.equal(readOnly.status, 0, readOnly.stderr || readOnly.stdout);
        assert.match(readOnly.stdout, /Mode: read-only collection only/);
        assert.match(readOnly.stdout, /DATABASE_PATH=.*history\.sqlite/);
        assert.match(readOnly.stdout, /current\/server\.js=yes/);
        assert.doesNotMatch(readOnly.stdout, new RegExp(secret));
        assert.doesNotMatch(readOnly.stdout, new RegExp(nginxSecret));
        assert.doesNotMatch(readOnly.stdout, /PORT=9999|\/tmp\/secret-path/);
        assert.doesNotMatch(readOnly.stdout, /EXECSTART_SECRET/);
        assert.match(readOnly.stdout, /proxy_pass \[upstream credentials redacted\]/);
        assert.equal(fs.existsSync(mutationMarker), false);
        assert.deepEqual(snapshotTree(appRoot), before);

        const missingUnit = invoke('--check', { VTP_FAKE_NO_UNIT: '1' });
        assert.notEqual(missingUnit.status, 0);
        assert.match(missingUnit.stdout, /FAIL\s+systemd unit:/);
        assert.equal(fs.existsSync(mutationMarker), false);
        assert.deepEqual(snapshotTree(appRoot), before);

        const missingDatabasePath = invoke('--check', {
            VTP_FAKE_ENVIRONMENT: `NODE_ENV=production PORT=3001 SESSION_SECRET=${secret}`,
        });
        assert.notEqual(missingDatabasePath.status, 0);
        assert.match(missingDatabasePath.stdout, /FAIL\s+DATABASE_PATH: an explicit absolute path/);
        assert.doesNotMatch(missingDatabasePath.stdout, new RegExp(secret));
        assert.equal(fs.existsSync(mutationMarker), false);
        assert.deepEqual(snapshotTree(appRoot), before);

        fs.chmodSync(databasePath, 0o644);
        const badPermissions = invoke('--check');
        assert.notEqual(badPermissions.status, 0);
        assert.match(badPermissions.stdout, /FAIL\s+file permissions:/);
        fs.chmodSync(databasePath, 0o600);
        assert.equal(fs.existsSync(mutationMarker), false);
        assert.deepEqual(snapshotTree(appRoot), before);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});