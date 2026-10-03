const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const {
    applyBarcodeRegistryMigration,
    pruneExpiredHistory,
    registerHistory,
} = require('../barcode-registry');

function createDatabase() {
    const database = new Database(':memory:');
    database.pragma('foreign_keys=ON');
    database.exec(`
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE history (
            id INTEGER PRIMARY KEY,
            barcode TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE inventory_history (
            id INTEGER PRIMARY KEY,
            created_at TEXT NOT NULL
        );
    `);
    return database;
}

const environmentKeys = ['DATABASE_PATH', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'NODE_ENV'];

test('SQLite migrations, retention, transactions, constraints, lock errors, and API responses', async () => {
    const memoryDatabases = [];
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-database-integrity-'));
    const databasePath = path.join(directory, 'runtime.sqlite');
    const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
    let runtimeDatabase;
    let apiServer;

    try {
        const migrationDatabase = createDatabase();
        memoryDatabases.push(migrationDatabase);
        migrationDatabase.prepare('INSERT INTO history (id, barcode, created_at) VALUES (?, ?, ?)')
            .run(10, 'LEGACY-SHARED', '2026-01-01T00:00:00.000Z');
        migrationDatabase.prepare('INSERT INTO history (id, barcode, created_at) VALUES (?, ?, ?)')
            .run(11, 'LEGACY-SHARED', '2026-01-02T00:00:00.000Z');
        migrationDatabase.prepare('INSERT INTO history (id, barcode, created_at) VALUES (?, ?, ?)')
            .run(12, 'LEGACY-UNIQUE', '2026-01-01T00:00:00.000Z');
        const historyBeforeMigration = migrationDatabase.prepare('SELECT id, barcode, created_at FROM history ORDER BY id').all();
        const firstMigration = applyBarcodeRegistryMigration(migrationDatabase, '2026-01-03T00:00:00.000Z');
        const secondMigration = applyBarcodeRegistryMigration(migrationDatabase, '2026-01-04T00:00:00.000Z');
        assert.deepEqual(migrationDatabase.prepare('SELECT id, barcode, created_at FROM history ORDER BY id').all(), historyBeforeMigration);
        assert.equal(firstMigration.historyCount, 3);
        assert.equal(secondMigration.mappingCount, 3);
        assert.equal(migrationDatabase.prepare('SELECT COUNT(*) AS count FROM barcode_registry').get().count, 2);
        assert.equal(migrationDatabase.prepare('SELECT COUNT(*) AS count FROM barcode_registry_history').get().count, 3);
        assert.deepEqual(migrationDatabase.pragma('foreign_key_check'), []);
        assert.ok(migrationDatabase.pragma('index_list(barcode_registry)').some(index => index.origin === 'pk' && index.unique));
        assert.ok(migrationDatabase.pragma('index_list(barcode_registry_history)').some(index => index.origin === 'pk' && index.unique));
        assert.ok(migrationDatabase.pragma('index_list(barcode_registry_history)').some(index => index.origin === 'u' && index.unique));

        const invalidMigrationDatabase = createDatabase();
        memoryDatabases.push(invalidMigrationDatabase);
        invalidMigrationDatabase.prepare('INSERT INTO history (id, barcode, created_at) VALUES (1, ?, ?)')
            .run('   ', '2026-01-01T00:00:00.000Z');
        assert.throws(() => applyBarcodeRegistryMigration(invalidMigrationDatabase), /empty or invalid barcode/);
        assert.equal(invalidMigrationDatabase.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'barcode_registry%'").get().count, 0);
        assert.equal(invalidMigrationDatabase.prepare('SELECT COUNT(*) AS count FROM app_settings').get().count, 0);
        assert.equal(invalidMigrationDatabase.prepare('SELECT COUNT(*) AS count FROM history').get().count, 1);
        invalidMigrationDatabase.prepare('UPDATE history SET barcode = ? WHERE id = 1').run('REPAIRED-LEGACY');
        assert.equal(applyBarcodeRegistryMigration(invalidMigrationDatabase).mappingCount, 1);

        const registrationDatabase = createDatabase();
        memoryDatabases.push(registrationDatabase);
        applyBarcodeRegistryMigration(registrationDatabase);
        assert.throws(() => registerHistory(registrationDatabase, 'ROLLBACK-CODE', () => {
            throw new Error('forced history insert failure');
        }), /forced history insert failure/);
        assert.equal(registrationDatabase.prepare("SELECT COUNT(*) AS count FROM barcode_registry WHERE barcode='ROLLBACK-CODE'").get().count, 0);
        assert.equal(registrationDatabase.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history WHERE barcode='ROLLBACK-CODE'").get().count, 0);
        assert.throws(() => registrationDatabase.prepare(`
            INSERT INTO barcode_registry (barcode, status, origin, registered_at, released_at)
            VALUES ('CHECK-FAIL', 'not-a-status', 'new', ?, NULL)
        `).run(new Date().toISOString()), error => error.code === 'SQLITE_CONSTRAINT_CHECK');
        assert.throws(() => registrationDatabase.prepare(`
            INSERT INTO barcode_registry_history (barcode, history_id) VALUES ('ROLLBACK-CODE', 999)
        `).run(), error => error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY');
        assert.deepEqual(registrationDatabase.pragma('foreign_key_check'), []);

        const retentionDatabase = createDatabase();
        memoryDatabases.push(retentionDatabase);
        retentionDatabase.prepare('INSERT INTO history (id, barcode, created_at) VALUES (?, ?, ?)')
            .run(1, 'STILL-REFERENCED', '2026-01-01T00:00:00.000Z');
        retentionDatabase.prepare('INSERT INTO history (id, barcode, created_at) VALUES (?, ?, ?)')
            .run(2, 'STILL-REFERENCED', '2026-01-02T00:00:00.000Z');
        retentionDatabase.prepare('INSERT INTO history (id, barcode, created_at) VALUES (?, ?, ?)')
            .run(3, 'READY-TO-RELEASE', '2026-01-01T00:00:00.000Z');
        retentionDatabase.prepare('INSERT INTO inventory_history (id, created_at) VALUES (?, ?)')
            .run(1, '2026-01-01T00:00:00.000Z');
        retentionDatabase.prepare('INSERT INTO inventory_history (id, created_at) VALUES (?, ?)')
            .run(2, '2026-01-02T00:00:00.000Z');
        applyBarcodeRegistryMigration(retentionDatabase, '2026-01-03T00:00:00.000Z');
        retentionDatabase.exec(`
            CREATE TRIGGER fail_retention_delete BEFORE DELETE ON history
            WHEN OLD.barcode = 'STILL-REFERENCED'
            BEGIN SELECT RAISE(ABORT, 'forced retention rollback'); END;
        `);
        assert.throws(() => pruneExpiredHistory(retentionDatabase, '2026-01-02T00:00:00.000Z'), /forced retention rollback/);
        assert.equal(retentionDatabase.prepare('SELECT COUNT(*) AS count FROM history').get().count, 3);
        assert.equal(retentionDatabase.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count, 2);
        assert.equal(retentionDatabase.prepare("SELECT status FROM barcode_registry WHERE barcode='READY-TO-RELEASE'").get().status, 'legacy_unique');
        retentionDatabase.exec('DROP TRIGGER fail_retention_delete');

        const firstPrune = pruneExpiredHistory(retentionDatabase, '2026-01-02T00:00:00.000Z');
        assert.deepEqual(firstPrune, { historyDeleted: 2, inventoryDeleted: 1, barcodesReleased: 1 });
        assert.equal(retentionDatabase.prepare("SELECT status FROM barcode_registry WHERE barcode='STILL-REFERENCED'").get().status, 'legacy_ambiguous');
        assert.equal(retentionDatabase.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history WHERE barcode='STILL-REFERENCED'").get().count, 1);
        assert.equal(retentionDatabase.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count, 1);

        const secondPrune = pruneExpiredHistory(retentionDatabase, '2026-01-03T00:00:00.000Z');
        assert.deepEqual(secondPrune, { historyDeleted: 1, inventoryDeleted: 1, barcodesReleased: 1 });
        assert.equal(retentionDatabase.prepare("SELECT status FROM barcode_registry WHERE barcode='STILL-REFERENCED'").get().status, 'released');
        assert.deepEqual(pruneExpiredHistory(retentionDatabase, '2026-01-03T00:00:00.000Z'), {
            historyDeleted: 0, inventoryDeleted: 0, barcodesReleased: 0,
        });
        assert.equal(retentionDatabase.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(retentionDatabase.pragma('foreign_key_check'), []);

        Object.assign(process.env, {
            DATABASE_PATH: databasePath,
            ADMIN_USERNAME: 'phase96.admin',
            ADMIN_PASSWORD: 'phase96-admin-password',
            SESSION_SECRET: 'phase96-isolated-session-secret-with-at-least-32-bytes',
            NODE_ENV: 'test',
        });
        runtimeDatabase = require('../database');
        runtimeDatabase.pragma('busy_timeout=100');
        const createdAt = new Date().toISOString();
        runtimeDatabase.prepare(`
            INSERT INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'operator', 1, ?)
        `).run('phase96.operator', bcrypt.hashSync('phase96-operator-password', 4), createdAt);
        applyBarcodeRegistryMigration(runtimeDatabase, createdAt);
        const inventoryForeignKey = runtimeDatabase.pragma('foreign_key_list(inventory_history)')
            .find(key => key.from === 'created_by_user_id');
        assert.equal(inventoryForeignKey?.table, 'users');
        assert.equal(inventoryForeignKey?.on_delete, 'SET NULL');
        const snapshotUserId = runtimeDatabase.prepare(`
            INSERT INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'operator', 1, ?)
        `).run('phase96.snapshot', bcrypt.hashSync('phase96-operator-password', 4), createdAt).lastInsertRowid;
        const snapshotId = runtimeDatabase.prepare(`
            INSERT INTO inventory_history (ip, waybill, creator_username, created_at, created_by_user_id)
            VALUES (?, ?, ?, ?, ?)
        `).run('203.0.113.96', 'USER-DELETE-SNAPSHOT', 'phase96.snapshot', createdAt, snapshotUserId).lastInsertRowid;
        runtimeDatabase.prepare('DELETE FROM users WHERE id = ?').run(snapshotUserId);
        const preservedSnapshot = runtimeDatabase.prepare('SELECT creator_username, created_by_user_id FROM inventory_history WHERE id = ?')
            .get(snapshotId);
        assert.deepEqual(preservedSnapshot, { creator_username: 'phase96.snapshot', created_by_user_id: null });
        const app = require('../server');
        apiServer = app.listen(0, '127.0.0.1');
        await once(apiServer, 'listening');
        const origin = `http://127.0.0.1:${apiServer.address().port}`;
        const request = (url, { method = 'GET', body, cookie } = {}) => fetch(`${origin}${url}`, {
            method,
            headers: {
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(cookie ? { Cookie: cookie } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const login = await request('/api/kiemke/login', {
            method: 'POST',
            body: { username: 'phase96.operator', password: 'phase96-operator-password' },
        });
        assert.equal(login.status, 200);
        const cookie = login.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
        assert.ok(cookie.includes('vtp.sid='));

        const lockDatabase = new Database(databasePath, { timeout: 100 });
        lockDatabase.exec('BEGIN IMMEDIATE');
        let lockedResponse;
        try {
            lockedResponse = await request('/api/kiemke', {
                method: 'POST', cookie, body: { waybill: 'LOCKED-WRITE' },
            });
        } finally {
            lockDatabase.exec('ROLLBACK');
            lockDatabase.close();
        }
        assert.equal(lockedResponse.status, 500);
        assert.equal(lockedResponse.headers.get('content-type').startsWith('application/json'), true);
        const lockedBody = await lockedResponse.text();
        assert.match(lockedBody, /Máy chủ đang gặp sự cố/);
        assert.doesNotMatch(lockedBody, /SQLITE_BUSY|database is locked|server\.js|SqliteError| at /i);
        assert.equal(runtimeDatabase.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill='LOCKED-WRITE'").get().count, 0);

        runtimeDatabase.exec(`
            CREATE TRIGGER fail_inventory_history BEFORE INSERT ON inventory_history
            WHEN NEW.waybill = 'CONSTRAINT-FAIL'
            BEGIN SELECT RAISE(ABORT, 'private inventory SQL detail'); END;
        `);
        const failedInventory = await request('/api/kiemke', {
            method: 'POST', cookie, body: { waybill: 'CONSTRAINT-FAIL' },
        });
        assert.equal(failedInventory.status, 500);
        const failedInventoryBody = await failedInventory.text();
        assert.match(failedInventoryBody, /Máy chủ đang gặp sự cố/);
        assert.doesNotMatch(failedInventoryBody, /private inventory SQL|SQLITE_CONSTRAINT|SqliteError|server\.js/);
        assert.equal(runtimeDatabase.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill='CONSTRAINT-FAIL'").get().count, 0);
        runtimeDatabase.exec('DROP TRIGGER fail_inventory_history');

        runtimeDatabase.exec(`
            CREATE TRIGGER fail_barcode_history BEFORE INSERT ON history
            WHEN NEW.barcode = 'ROLLBACK-API'
            BEGIN SELECT RAISE(ABORT, 'private history SQL detail'); END;
        `);
        const failedHistory = await request('/api/history', {
            method: 'POST',
            body: { barcode: 'ROLLBACK-API', chonHuyen: 'D', chonXa: 'C', chonThon: '', fields: {} },
        });
        assert.equal(failedHistory.status, 500);
        const failedHistoryBody = await failedHistory.text();
        assert.doesNotMatch(failedHistoryBody, /private history SQL|SQLITE_CONSTRAINT|SqliteError|server\.js/);
        assert.equal(runtimeDatabase.prepare("SELECT COUNT(*) AS count FROM barcode_registry WHERE barcode='ROLLBACK-API'").get().count, 0);
        assert.equal(runtimeDatabase.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='ROLLBACK-API'").get().count, 0);
        assert.equal(runtimeDatabase.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history WHERE barcode='ROLLBACK-API'").get().count, 0);
        runtimeDatabase.exec('DROP TRIGGER fail_barcode_history');

        const missingPath = path.join(directory, 'missing.sqlite');
        assert.throws(() => new Database(missingPath, { readonly: true, fileMustExist: true }), error => error.code === 'SQLITE_CANTOPEN');
        assert.equal(fs.existsSync(missingPath), false);
        const missingProductionPath = path.join(directory, 'production-missing', 'history.sqlite');
        const missingProduction = spawnSync(process.execPath, ['-e', 'require("./database")'], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
            env: { ...process.env, DATABASE_PATH: missingProductionPath, NODE_ENV: 'production' },
        });
        assert.notEqual(missingProduction.status, 0);
        assert.match(missingProduction.stderr, /Refusing to create a production database/);
        assert.equal(fs.existsSync(missingProductionPath), false);
        assert.equal(fs.existsSync(path.dirname(missingProductionPath)), false);
        const productionTarget = path.join(directory, 'must-not-create.sqlite');
        const migration = spawnSync(process.execPath, [
            path.join(__dirname, '..', 'migrations', '20261003_barcode_registry.js'),
            '--confirm-local-dev-db',
        ], {
            encoding: 'utf8',
            env: { ...process.env, DATABASE_PATH: productionTarget, NODE_ENV: 'production' },
        });
        assert.equal(migration.status, 1);
        assert.match(migration.stderr, /Refusing migration/);
        assert.equal(fs.existsSync(productionTarget), false);
        assert.equal(runtimeDatabase.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(runtimeDatabase.pragma('foreign_key_check'), []);

    } finally {
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        if (runtimeDatabase) {
            runtimeDatabase.close();
            delete require.cache[require.resolve('../database')];
            delete require.cache[require.resolve('../server')];
        }
        for (const database of memoryDatabases) database.close();
        for (const key of environmentKeys) {
            if (previousEnvironment[key] === undefined) delete process.env[key];
            else process.env[key] = previousEnvironment[key];
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
});