const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');

const deployScript = path.join(__dirname, '..', 'ops', 'deploy-release.sh');
const countBackups = directory => fs.readdirSync(directory).filter(name => name.endsWith('.sqlite')).length;

function writeExecutable(filePath, contents) {
    fs.writeFileSync(filePath, contents, { mode: 0o700 });
}

test('release activation and rollback preserve active releases and SQLite', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-deployment-pipeline-'));
    const appRoot = path.join(temporaryRoot, 'app');
    const tools = path.join(temporaryRoot, 'tools');
    const releaseIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((letter, index) => `${letter.repeat(40)}-${index + 1}`);
    const [previousId, healthyId, healthFailureId, restartFailureId, permissionFailureId, noDatabasePathId, noUserId, dependencyFailureId, unsafePermissionId, frontendFailureId] = releaseIds;
    const databasePath = path.join(appRoot, 'data', 'history.sqlite');
    let liveDatabase;

    try {
        for (const directory of ['data', 'releases', 'staging']) {
            fs.mkdirSync(path.join(appRoot, directory), { recursive: true });
        }
        fs.mkdirSync(tools);
        liveDatabase = new Database(databasePath);
        liveDatabase.pragma('journal_mode = WAL');
        liveDatabase.exec('CREATE TABLE deployment_probe (value TEXT NOT NULL)');
        liveDatabase.prepare('INSERT INTO deployment_probe (value) VALUES (?)').run('preserve-me');
        assert.ok(fs.existsSync(`${databasePath}-wal`));
        fs.chmodSync(path.join(appRoot, 'data'), 0o750);
        fs.chmodSync(databasePath, 0o640);
        for (const sidecar of [`${databasePath}-wal`, `${databasePath}-shm`]) {
          if (fs.existsSync(sidecar)) fs.chmodSync(sidecar, 0o640);
        }

        const previousRelease = path.join(appRoot, 'releases', previousId);
        fs.mkdirSync(path.join(previousRelease, 'frontend', 'dist'), { recursive: true });
        fs.mkdirSync(path.join(previousRelease, 'ops'), { recursive: true });
        fs.writeFileSync(path.join(previousRelease, 'server.js'), '// active');
        fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(previousRelease, 'node_modules'));
        fs.symlinkSync(path.join(appRoot, 'data'), path.join(previousRelease, 'data'));
        fs.symlinkSync(previousRelease, path.join(appRoot, 'current'));

        writeExecutable(path.join(tools, 'systemctl'), `#!/bin/sh
case "$1" in
  show)
    property=
    for argument in "$@"; do
      case "$argument" in --property=*) property=$(printf '%s' "$argument" | cut -d= -f2-) ;; esac
    done
    case "$property" in
      WorkingDirectory) printf '%s' "$VTP_FAKE_APP_ROOT" ;;
      ExecStart) printf '/usr/bin/node %s/current/server.js' "$VTP_FAKE_APP_ROOT" ;;
      EnvironmentFiles) printf '[]' ;;
      Environment) printf 'NODE_ENV=production PORT=3001 DATABASE_PATH=%s' "$VTP_FAKE_DATABASE_PATH" ;;
      User) printf '%s' "$VTP_FAKE_SERVICE_USER" ;;
      Group) printf '%s' "$VTP_FAKE_SERVICE_GROUP" ;;
      *) exit 2 ;;
    esac
    ;;
  is-active) exit 0 ;;
  restart)
    current=$(basename "$(readlink -f "$VTP_FAKE_APP_ROOT/current")")
    test "$current" != "$VTP_FAIL_RESTART_RELEASE"
    ;;
  *) exit 2 ;;
esac
`);
        writeExecutable(path.join(tools, 'sudo'), `#!/bin/sh
if [ "$1" = "-n" ] && [ "$2" = "-l" ]; then
  test "$VTP_FAIL_SUDO_PREFLIGHT" != 1
  exit $?
fi
exec "$@"
`);
        writeExecutable(path.join(tools, 'curl'), `#!/bin/sh
current=$(basename "$(readlink -f "$VTP_FAKE_APP_ROOT/current")")
for argument do url=$argument; done
case "$url" in
  */) test "$current" != "$VTP_FAIL_FRONTEND_RELEASE" ;;
  *) test "$current" != "$VTP_FAIL_HEALTH_RELEASE" ;;
esac
`);
        writeExecutable(path.join(tools, 'npm'), `#!/bin/sh
      if [ "$VTP_FAIL_NPM_INSTALL" = 1 ]; then exit 1; fi
      ln -s "$VTP_TEST_NODE_MODULES" "$PWD/node_modules"
      `);
        const serviceUser = spawnSync('id', ['-un'], { encoding: 'utf8' }).stdout.trim();
        const serviceGroup = spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim();

        const prepareStage = releaseId => {
            const stage = path.join(appRoot, 'staging', releaseId);
            fs.mkdirSync(path.join(stage, 'frontend', 'dist'), { recursive: true });
            fs.mkdirSync(path.join(stage, 'ops'), { recursive: true });
            fs.writeFileSync(path.join(stage, 'RELEASE_SHA'), `${releaseId.slice(0, 40)}\n`);
            fs.writeFileSync(path.join(stage, 'frontend', 'dist', 'index.html'), '<html></html>');
            fs.writeFileSync(path.join(stage, 'server.js'), '// candidate');
            fs.copyFileSync(deployScript, path.join(stage, 'ops', 'deploy-release.sh'));
            return stage;
        };

        const invoke = (action, releaseId, overrides = {}) => spawnSync('bash', [deployScript, action, releaseId, appRoot], {
            encoding: 'utf8',
            env: {
                ...process.env,
                PATH: `${tools}:${process.env.PATH}`,
                SYSTEMCTL_BIN: path.join(tools, 'systemctl'),
                SUDO_BIN: path.join(tools, 'sudo'),
                CURL_BIN: path.join(tools, 'curl'),
                NPM_BIN: path.join(tools, 'npm'),
                VTP_FAKE_APP_ROOT: appRoot,
                VTP_FAKE_SERVICE_USER: serviceUser,
                VTP_FAKE_SERVICE_GROUP: serviceGroup,
                VTP_FAKE_DATABASE_PATH: databasePath,
                VTP_TEST_NODE_MODULES: path.join(__dirname, '..', 'node_modules'),
                VTP_HEALTH_RETRIES: '1',
                VTP_HEALTH_INTERVAL: '0',
                ...overrides,
            },
        });

        prepareStage(healthyId);
        const deployed = invoke('deploy', healthyId);
        assert.equal(deployed.status, 0, deployed.stderr || deployed.stdout);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.equal(fs.realpathSync(path.join(appRoot, 'current', 'data')), path.join(appRoot, 'data'));
        assert.ok(fs.existsSync(previousRelease));
        assert.equal(countBackups(path.join(appRoot, 'backups')), 1);
        const firstBackupName = fs.readdirSync(path.join(appRoot, 'backups')).find(name => name.endsWith('.sqlite'));
        const firstBackupPath = path.join(appRoot, 'backups', firstBackupName);
        assert.equal(fs.statSync(firstBackupPath).mode & 0o777, 0o600);
        const firstBackup = new Database(firstBackupPath, { readonly: true, fileMustExist: true });
        assert.deepEqual(firstBackup.prepare('SELECT value FROM deployment_probe').all(), [{ value: 'preserve-me' }]);
        firstBackup.close();
        liveDatabase.prepare('INSERT INTO deployment_probe (value) VALUES (?)').run('written-after-deploy');

        prepareStage(permissionFailureId);
        const sudoDenied = invoke('deploy', permissionFailureId, { VTP_FAIL_SUDO_PREFLIGHT: '1' });
        assert.notEqual(sudoDenied.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.equal(countBackups(path.join(appRoot, 'backups')), 1);
        assert.equal(fs.existsSync(path.join(appRoot, 'releases', permissionFailureId)), false);

        prepareStage(noDatabasePathId);
        const noDatabasePath = invoke('deploy', noDatabasePathId, { VTP_FAKE_DATABASE_PATH: '' });
        assert.notEqual(noDatabasePath.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.equal(fs.existsSync(path.join(appRoot, 'releases', noDatabasePathId)), false);
        assert.equal(countBackups(path.join(appRoot, 'backups')), 1);

        prepareStage(noUserId);
        const noUser = invoke('deploy', noUserId, { VTP_FAKE_SERVICE_USER: '' });
        assert.notEqual(noUser.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.equal(fs.existsSync(path.join(appRoot, 'releases', noUserId)), false);
        assert.equal(countBackups(path.join(appRoot, 'backups')), 1);

        prepareStage(dependencyFailureId);
        const dependencyFailure = invoke('deploy', dependencyFailureId, { VTP_FAIL_NPM_INSTALL: '1' });
        assert.notEqual(dependencyFailure.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.equal(fs.existsSync(path.join(appRoot, 'releases', dependencyFailureId)), false);
        assert.equal(countBackups(path.join(appRoot, 'backups')), 1);

        fs.chmodSync(databasePath, 0o400);
        const databasePermissionDenied = invoke('deploy', permissionFailureId);
        fs.chmodSync(databasePath, 0o640);
        assert.notEqual(databasePermissionDenied.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.equal(countBackups(path.join(appRoot, 'backups')), 1);
        assert.equal(fs.existsSync(path.join(appRoot, 'releases', permissionFailureId)), false);

        prepareStage(unsafePermissionId);
        fs.chmodSync(databasePath, 0o644);
        const unsafePermissions = invoke('deploy', unsafePermissionId);
        fs.chmodSync(databasePath, 0o640);
        assert.notEqual(unsafePermissions.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.equal(countBackups(path.join(appRoot, 'backups')), 1);
        assert.equal(fs.existsSync(path.join(appRoot, 'releases', unsafePermissionId)), false);

        prepareStage(healthFailureId);
        const healthFailure = invoke('deploy', healthFailureId, { VTP_FAIL_HEALTH_RELEASE: healthFailureId });
        assert.notEqual(healthFailure.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.ok(fs.existsSync(path.join(appRoot, 'releases', healthFailureId)));

        prepareStage(frontendFailureId);
        const frontendFailure = invoke('deploy', frontendFailureId, { VTP_FAIL_FRONTEND_RELEASE: frontendFailureId });
        assert.notEqual(frontendFailure.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.ok(fs.existsSync(path.join(appRoot, 'releases', frontendFailureId)));

        prepareStage(restartFailureId);
        const restartFailure = invoke('deploy', restartFailureId, { VTP_FAIL_RESTART_RELEASE: restartFailureId });
        assert.notEqual(restartFailure.status, 0);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), path.join(appRoot, 'releases', healthyId));
        assert.ok(fs.existsSync(path.join(appRoot, 'releases', restartFailureId)));

        const manualRollback = invoke('rollback', previousId, { VTP_FAIL_HEALTH_RELEASE: healthyId });
        assert.equal(manualRollback.status, 0, manualRollback.stderr || manualRollback.stdout);
        assert.equal(fs.realpathSync(path.join(appRoot, 'current')), previousRelease);
        assert.ok(fs.existsSync(path.join(appRoot, 'releases', healthyId)));
        assert.equal(countBackups(path.join(appRoot, 'backups')), 4);

        assert.deepEqual(liveDatabase.prepare('SELECT value FROM deployment_probe ORDER BY rowid').all(), [
            { value: 'preserve-me' },
            { value: 'written-after-deploy' },
        ]);
    } finally {
        liveDatabase?.close();
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});