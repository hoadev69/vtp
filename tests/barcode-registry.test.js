const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const {
    applyBarcodeRegistryMigration,
    pruneExpiredHistory,
    registerHistory,
    resolveBarcodeHistory,
} = require('../barcode-registry');

function createMemoryDatabase() {
    const database = new Database(':memory:');
    database.pragma('foreign_keys=ON');
    database.exec(`
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE ip_controls (ip TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '');
        CREATE TABLE history (
            id INTEGER PRIMARY KEY,
            ip TEXT NOT NULL DEFAULT 'test',
            anonymous_user_id TEXT,
            creator_username TEXT,
            legacy_username TEXT,
            barcode TEXT NOT NULL,
            district TEXT NOT NULL DEFAULT '',
            commune TEXT NOT NULL DEFAULT '',
            village TEXT NOT NULL DEFAULT '',
            field_values TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );
        CREATE TABLE inventory_history (id INTEGER PRIMARY KEY, created_at TEXT NOT NULL);
    `);
    return database;
}

function addHistory(database, id, barcode, createdAt = '2026-10-03T00:00:00.000Z') {
    database.prepare('INSERT INTO history (id, barcode, created_at) VALUES (?, ?, ?)')
        .run(id, barcode, createdAt);
}

test('migration backfills all legacy rows and reruns idempotently', () => {
    const database = createMemoryDatabase();
    try {
        addHistory(database, 5, 'AMBIGUOUS');
        addHistory(database, 6, 'AMBIGUOUS');
        addHistory(database, 7, 'UNIQUE');
        const before = database.prepare('SELECT id, barcode FROM history ORDER BY id').all();

        const first = applyBarcodeRegistryMigration(database, '2026-10-03T00:00:00.000Z');
        const second = applyBarcodeRegistryMigration(database, '2026-10-04T00:00:00.000Z');

        assert.deepEqual(database.prepare('SELECT id, barcode FROM history ORDER BY id').all(), before);
        assert.equal(first.historyCount, 3);
        assert.equal(second.mappingCount, 3);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM barcode_registry').get().count, 2);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode = 'AMBIGUOUS'").get().status, 'legacy_ambiguous');
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode = 'UNIQUE'").get().status, 'legacy_unique');
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM barcode_registry_history').get().count, 3);
        assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(database.pragma('foreign_key_check'), []);
    } finally {
        database.close();
    }
});

test('registration allows duplicate barcodes, rolls back insert failures, and RELEASE waits for every row', () => {
    const database = createMemoryDatabase();
    try {
        addHistory(database, 1, 'OLD-DUP', '2026-10-01T00:00:00.000Z');
        addHistory(database, 2, 'OLD-DUP', '2026-10-03T00:00:00.000Z');
        applyBarcodeRegistryMigration(database);

        assert.throws(() => registerHistory(database, 'ROLLBACK', () => { throw new Error('forced insert failure'); }), /forced insert failure/);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM barcode_registry WHERE barcode = 'ROLLBACK'").get().count, 0);

        database.exec(`
            CREATE TRIGGER block_old_history_delete BEFORE DELETE ON history
            WHEN OLD.barcode = 'OLD-DUP'
            BEGIN SELECT RAISE(ABORT, 'forced cleanup failure'); END;
        `);
        assert.throws(() => pruneExpiredHistory(database, '2026-10-02T00:00:00.000Z'), /forced cleanup failure/);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode = 'OLD-DUP'").get().count, 2);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode = 'OLD-DUP'").get().status, 'legacy_ambiguous');
        database.exec('DROP TRIGGER block_old_history_delete');

        const firstPrune = pruneExpiredHistory(database, '2026-10-02T00:00:00.000Z');
        assert.equal(firstPrune.historyDeleted, 1);
        assert.equal(firstPrune.barcodesReleased, 0);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode = 'OLD-DUP'").get().status, 'legacy_ambiguous');
        assert.equal(resolveBarcodeHistory(database, 'OLD-DUP').rows.length, 1);

        const secondPrune = pruneExpiredHistory(database, '2026-10-04T00:00:00.000Z');
        assert.equal(secondPrune.historyDeleted, 1);
        assert.equal(secondPrune.barcodesReleased, 1);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode = 'OLD-DUP'").get().status, 'released');
        assert.deepEqual(pruneExpiredHistory(database, '2026-10-04T00:00:00.000Z'), {
            historyDeleted: 0,
            inventoryDeleted: 0,
            barcodesReleased: 0,
        });

        const reuse = registerHistory(database, ' OLD-DUP ', barcode => database.prepare(
            'INSERT INTO history (barcode, created_at) VALUES (?, ?)',
        ).run(barcode, '2026-10-04T00:00:00.000Z'));
        const secondUse = registerHistory(database, 'OLD-DUP', barcode => database.prepare(
            'INSERT INTO history (barcode, created_at) VALUES (?, ?)',
        ).run(barcode, '2026-10-04T00:00:01.000Z'));
        assert.notEqual(reuse.historyId, secondUse.historyId);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode = 'OLD-DUP'").get().status, 'new');
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history WHERE barcode = 'OLD-DUP'").get().count, 2);
        assert.equal(resolveBarcodeHistory(database, 'OLD-DUP').status, 'ambiguous');
        assert.equal(resolveBarcodeHistory(database, 'OLD-DUP').rows.length, 2);
        assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
        database.close();
    }
});

test('trim is preserved while barcode matching remains case-sensitive', () => {
    const database = createMemoryDatabase();
    try {
        applyBarcodeRegistryMigration(database);
        const insert = barcode => registerHistory(database, barcode, normalized => database.prepare(
            'INSERT INTO history (barcode, created_at) VALUES (?, ?)',
        ).run(normalized, '2026-10-03T00:00:00.000Z'));
        const first = insert('  Case-Code  ');
        const repeated = insert('Case-Code');
        const lower = insert('case-code');
        assert.notEqual(first.historyId, repeated.historyId);
        assert.notEqual(repeated.historyId, lower.historyId);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM barcode_registry').get().count, 2);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM barcode_registry_history').get().count, 3);
    } finally {
        database.close();
    }
});

test('concurrent independent SQLite writers keep duplicate history rows under one registry key', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-barcode-race-'));
    const databasePath = path.join(directory, 'race.sqlite');
    const database = new Database(databasePath);
    database.pragma('foreign_keys=ON');
    database.pragma('journal_mode=WAL');
    database.exec(`
        CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE history (id INTEGER PRIMARY KEY, barcode TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    applyBarcodeRegistryMigration(database);
    database.close();

    const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 1);
    const workers = Array.from({ length: 2 }, () => new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const Database = require('better-sqlite3');
        const { registerHistory } = require(workerData.registryModule);
        const database = new Database(workerData.databasePath, { timeout: 10000 });
        database.pragma('foreign_keys=ON');
        const signal = new Int32Array(workerData.shared);
        Atomics.add(signal, 0, 1);
        Atomics.notify(signal, 0);
        while (Atomics.load(signal, 0) < 2) Atomics.wait(signal, 0, 1, 10000);
        try {
            const result = registerHistory(database, 'RACE-CODE', barcode => database.prepare(
                'INSERT INTO history (barcode, created_at) VALUES (?, ?)',
            ).run(barcode, '2026-10-03T00:00:00.000Z'));
            parentPort.postMessage({ historyId: result.historyId });
        } catch (error) {
            parentPort.postMessage({ error: error.message });
        } finally {
            database.close();
        }
    `, {
        eval: true,
        workerData: {
            databasePath,
            registryModule: path.resolve(__dirname, '..', 'barcode-registry.js'),
            shared,
        },
    }));

    try {
        const results = await Promise.all(workers.map(worker => once(worker, 'message').then(([message]) => message)));
        assert.deepEqual(results.filter(result => result.error), []);
        assert.equal(new Set(results.map(result => result.historyId)).size, 2);
        const verify = new Database(databasePath, { readonly: true, fileMustExist: true });
        try {
            assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode = 'RACE-CODE'").get().count, 2);
            assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM barcode_registry WHERE barcode = 'RACE-CODE'").get().count, 1);
            assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history WHERE barcode = 'RACE-CODE'").get().count, 2);
        } finally {
            verify.close();
        }
    } finally {
        await Promise.all(workers.map(worker => worker.terminate()));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('HTTP create and Admin ambiguous lookup preserve authorization and response contract', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-barcode-api-'));
    const databasePath = path.join(directory, 'api.sqlite');
    process.env.DATABASE_PATH = databasePath;
    process.env.ADMIN_USERNAME = 'phase.test.admin';
    process.env.ADMIN_PASSWORD = 'phase-test-admin-password';
    process.env.SESSION_SECRET = 'phase-test-session-secret-0123456789-0123456789';
    process.env.NODE_ENV = 'test';

    const database = require('../database');
    database.pragma('foreign_keys=ON');
    const now = new Date().toISOString();
    const insertHistory = database.prepare(`
        INSERT INTO history (ip, barcode, district, commune, village, field_values, created_at)
        VALUES ('test', ?, 'TP.Lào Cai', 'Thống Nhất', '', '{"nhapTen":"Legacy"}', ?)
    `);
    insertHistory.run('LEGACY-DUP', now);
    insertHistory.run('LEGACY-DUP', now);
    applyBarcodeRegistryMigration(database, now);
    database.prepare(`
        INSERT INTO users (username, password_hash, role, active, created_at)
        VALUES (?, ?, 'operator', 1, ?)
    `).run('phase.test.operator', bcrypt.hashSync('phase-test-operator-password', 4), now);

    const app = require('../server');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const jsonRequest = (url, body, cookie) => fetch(`${origin}${url}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
    });
    const cookieFrom = response => response.headers.getSetCookie()
        .map(value => value.split(';', 1)[0]).join('; ');

    try {
        await t.test('Guest and Operator are denied; Admin sees all ambiguous rows', async () => {
            const guest = await fetch(`${origin}/api/admin/history?search=LEGACY-DUP&barcode=LEGACY-DUP`);
            assert.equal(guest.status, 401);

            const operatorLogin = await jsonRequest('/api/kiemke/login', {
                username: 'phase.test.operator', password: 'phase-test-operator-password',
            });
            assert.equal(operatorLogin.status, 200);
            const operatorCookie = cookieFrom(operatorLogin);
            const operatorRead = await fetch(`${origin}/api/admin/history?search=LEGACY-DUP&barcode=LEGACY-DUP`, {
                headers: { Cookie: operatorCookie },
            });
            assert.equal(operatorRead.status, 403);

            const adminLogin = await jsonRequest('/api/login', {
                username: 'phase.test.admin', password: 'phase-test-admin-password',
            });
            assert.equal(adminLogin.status, 200);
            const adminCookie = cookieFrom(adminLogin);
            const adminRead = await fetch(`${origin}/api/admin/history?search=LEGACY-DUP&barcode=LEGACY-DUP`, {
                headers: { Cookie: adminCookie },
            });
            assert.equal(adminRead.status, 200);
            const data = await adminRead.json();
            assert.equal(data.barcodeResolution.status, 'ambiguous');
            assert.equal(data.barcodeResolution.count, 2);
            assert.equal(data.rows.length, 2);
            assert.deepEqual(data.rows.map(row => row.barcode), ['LEGACY-DUP', 'LEGACY-DUP']);
        });

        await t.test('POST records every create even when the barcode is already used', async () => {
            const body = { barcode: '  NEW-HTTP-1  ', chonHuyen: 'TP.Lào Cai', chonXa: 'Thống Nhất', chonThon: '', fields: {} };
            const created = await jsonRequest('/api/history', body);
            assert.equal(created.status, 201);
            const createdData = await created.json();
            assert.equal(typeof createdData.id, 'number');
            assert.equal(database.prepare('SELECT barcode FROM history WHERE id=?').get(createdData.id).barcode, 'NEW-HTTP-1');

            const duplicate = await jsonRequest('/api/history', { ...body, barcode: 'NEW-HTTP-1' });
            assert.equal(duplicate.status, 201);
            const duplicateData = await duplicate.json();
            assert.equal(typeof duplicateData.id, 'number');
            assert.notEqual(duplicateData.id, createdData.id);
            assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='NEW-HTTP-1'").get().count, 2);
            assert.equal(resolveBarcodeHistory(database, 'NEW-HTTP-1').status, 'ambiguous');

            const outcomes = await Promise.all([
                jsonRequest('/api/history', { ...body, barcode: 'RACING-HTTP' }),
                jsonRequest('/api/history', { ...body, barcode: 'RACING-HTTP' }),
            ]);
            assert.deepEqual(outcomes.map(response => response.status), [201, 201]);
            assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='RACING-HTTP'").get().count, 2);

            database.exec(`
                CREATE TRIGGER fail_history_insert BEFORE INSERT ON history
                WHEN NEW.barcode = 'FAIL-HISTORY'
                BEGIN SELECT RAISE(ABORT, 'forced history failure'); END;
            `);
            const failed = await jsonRequest('/api/history', { ...body, barcode: 'FAIL-HISTORY' });
            assert.equal(failed.status, 500);
            assert.equal(database.prepare("SELECT COUNT(*) AS count FROM barcode_registry WHERE barcode='FAIL-HISTORY'").get().count, 0);
            assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='FAIL-HISTORY'").get().count, 0);
            database.exec('DROP TRIGGER fail_history_insert');
        });
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        database.close();
        delete require.cache[require.resolve('../database')];
        delete require.cache[require.resolve('../server')];
        fs.rmSync(directory, { recursive: true, force: true });
        delete process.env.DATABASE_PATH;
        delete process.env.ADMIN_USERNAME;
        delete process.env.ADMIN_PASSWORD;
        delete process.env.SESSION_SECRET;
        delete process.env.NODE_ENV;
    }
});