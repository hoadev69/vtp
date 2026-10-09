const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const bcrypt = require('bcryptjs');

const environmentKeys = [
    'DATABASE_PATH',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'SESSION_SECRET',
    'NODE_ENV',
];

test('Admin APIs integrate with isolated SQLite for auth, history, users, geography, fields, and IPs', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-admin-integration-'));
    const databasePath = path.join(directory, 'history.sqlite');
    const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
    let database;
    let server;

    try {
        Object.assign(process.env, {
            DATABASE_PATH: databasePath,
            ADMIN_USERNAME: 'phase94.admin',
            ADMIN_PASSWORD: 'phase94-admin-password',
            SESSION_SECRET: 'phase94-isolated-session-secret-with-at-least-32-bytes',
            NODE_ENV: 'test',
        });

        database = require('../database');
        const createdAt = new Date().toISOString();
        const insertHistory = database.prepare(`
            INSERT INTO history (ip, barcode, district, commune, village, field_values, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (let index = 0; index < 52; index += 1) {
            insertHistory.run(
                '203.0.113.94', `ORDER-${String(index).padStart(2, '0')}`,
                'Phase94 District', 'Phase94 Commune', '',
                JSON.stringify({ nhapTen: `Recipient ${index}` }), createdAt,
            );
        }
        insertHistory.run('203.0.113.94', 'AMBIG-CODE', 'Phase94 District', 'Phase94 Commune', '', '{"nhapTen":"Ambiguous A"}', createdAt);
        insertHistory.run('203.0.113.94', 'AMBIG-CODE', 'Phase94 District', 'Phase94 Commune', '', '{"nhapTen":"Ambiguous B"}', createdAt);
        insertHistory.run('203.0.113.94', 'SNAPSHOT-CODE', 'Phase94 District', 'Phase94 Commune', '', '{"nhapTen":"Snapshot recipient"}', createdAt);
        require('../barcode-registry').applyBarcodeRegistryMigration(database, createdAt);

        const app = require('../server');
        server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const origin = `http://127.0.0.1:${server.address().port}`;
        const request = (url, { method = 'GET', body, cookie } = {}) => fetch(`${origin}${url}`, {
            method,
            headers: {
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(cookie ? { Cookie: cookie } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const readJson = response => response.json();
        const readCookie = response => response.headers.getSetCookie()
            .map(value => value.split(';', 1)[0]).join('; ');
        const login = async (url, username, password) => {
            const response = await request(url, { method: 'POST', body: { username, password } });
            return { response, cookie: readCookie(response) };
        };

        const guestHistory = await request('/api/admin/history');
        assert.equal(guestHistory.status, 401);
        const guestUsers = await request('/api/admin/users');
        assert.equal(guestUsers.status, 401);
        assert.equal((await request('/api/admin/users/1', { method: 'DELETE' })).status, 401);

        const adminLogin = await login('/api/login', 'phase94.admin', 'phase94-admin-password');
        assert.equal(adminLogin.response.status, 200);
        assert.match(adminLogin.response.headers.get('set-cookie'), /HttpOnly/i);
        assert.match(adminLogin.response.headers.get('set-cookie'), /SameSite=Lax/i);
        const adminCookie = adminLogin.cookie;
        assert.equal((await request('/api/admin/me', { cookie: adminCookie })).status, 200);

        const adminPage = await request('/admin', { cookie: adminCookie });
        assert.equal(adminPage.status, 200);
        const adminPageHtml = await adminPage.text();
        assert.match(adminPageHtml, /historyPanel/);
        assert.doesNotMatch(adminPageHtml, /assets\/index-[^" ]+\.js/);

        const operatorPassword = 'phase94-operator-password';
        const operatorId = database.prepare(`
            INSERT INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'operator', 1, ?)
        `).run('phase94.operator', bcrypt.hashSync(operatorPassword, 4), createdAt).lastInsertRowid;
        const operatorLogin = await login('/api/kiemke/login', 'phase94.operator', operatorPassword);
        assert.equal(operatorLogin.response.status, 200);
        const operatorCookie = operatorLogin.cookie;
        assert.equal((await request('/api/admin/history', { cookie: operatorCookie })).status, 403);
        assert.equal((await request('/api/admin/users', { cookie: operatorCookie })).status, 403);
        assert.equal((await request('/api/admin/users/1', { method: 'DELETE', cookie: operatorCookie })).status, 403);
        assert.equal((await request('/api/admin/users/not-an-id', { method: 'DELETE', cookie: adminCookie })).status, 400);
        assert.equal((await request('/api/admin/users/999999', { method: 'DELETE', cookie: adminCookie })).status, 404);

        const firstPage = await readJson(await request('/api/admin/history?page=1', { cookie: adminCookie }));
        const secondPage = await readJson(await request('/api/admin/history?page=2', { cookie: adminCookie }));
        assert.equal(firstPage.total, 55);
        assert.equal(firstPage.pages, 2);
        assert.equal(firstPage.rows.length, 50);
        assert.equal(secondPage.rows.length, 5);
        assert.equal(new Set([...firstPage.rows, ...secondPage.rows].map(row => row.id)).size, 55);

        const ambiguousResponse = await request('/api/admin/history?search=AMBIG-CODE&barcode=AMBIG-CODE', { cookie: adminCookie });
        assert.equal(ambiguousResponse.status, 200);
        const ambiguous = await readJson(ambiguousResponse);
        assert.equal(ambiguous.barcodeResolution.status, 'ambiguous');
        assert.deepEqual(ambiguous.rows.map(row => row.fields.nhapTen), ['Ambiguous A', 'Ambiguous B']);
        assert.equal((await request('/api/admin/history?barcode=AMBIG-CODE', { cookie: operatorCookie })).status, 403);
        const unique = await readJson(await request('/api/admin/history?barcode=ORDER-01', { cookie: adminCookie }));
        assert.equal(unique.barcodeResolution.status, 'unique');
        assert.equal(unique.rows.length, 1);
        assert.equal(unique.rows[0].fields.nhapTen, 'Recipient 1');

        const createdAccountResponse = await request('/api/admin/users', {
            method: 'POST', cookie: adminCookie,
            body: { username: 'phase94-role-change', password: 'phase94-role-password', role: 'operator' },
        });
        assert.equal(createdAccountResponse.status, 201);
        const roleChangeAccount = await readJson(createdAccountResponse);
        const roleChangeLogin = await login('/api/kiemke/login', roleChangeAccount.username, 'phase94-role-password');
        assert.equal(roleChangeLogin.response.status, 200);
        assert.equal((await request('/api/kiemke/me', { cookie: roleChangeLogin.cookie })).status, 200);
        assert.equal((await request(`/api/admin/users/${roleChangeAccount.id}/role`, {
            method: 'PATCH', cookie: adminCookie, body: { role: 'admin' },
        })).status, 204);
        assert.equal((await request('/api/admin/me', { cookie: roleChangeLogin.cookie })).status, 401);
        const promotedLogin = await login('/api/login', roleChangeAccount.username, 'phase94-role-password');
        assert.equal(promotedLogin.response.status, 200);
        assert.equal((await request('/api/admin/me', { cookie: promotedLogin.cookie })).status, 200);
        assert.equal((await request('/api/admin/users/1/role', {
            method: 'PATCH', cookie: adminCookie, body: { role: 'operator' },
        })).status, 409);
        assert.equal((await request('/api/admin/users/1/status', {
            method: 'PATCH', cookie: adminCookie, body: { active: false, reason: 'self lock check' },
        })).status, 409);
        const adminId = database.prepare("SELECT id FROM users WHERE username = 'phase94.admin'").get().id;
        assert.equal((await request(`/api/admin/users/${adminId}`, { method: 'DELETE', cookie: adminCookie })).status, 409);

        const lockedAccountResponse = await request('/api/admin/users', {
            method: 'POST', cookie: adminCookie,
            body: { username: 'phase94-locked', password: 'phase94-locked-password', role: 'operator' },
        });
        assert.equal(lockedAccountResponse.status, 201);
        const lockedAccount = await readJson(lockedAccountResponse);
        const lockedLogin = await login('/api/kiemke/login', lockedAccount.username, 'phase94-locked-password');
        assert.equal(lockedLogin.response.status, 200);
        assert.equal((await request(`/api/admin/users/${lockedAccount.id}/status`, {
            method: 'PATCH', cookie: adminCookie, body: { active: false, reason: 'acceptance lock test' },
        })).status, 204);
        assert.equal((await request('/api/kiemke/me', { cookie: lockedLogin.cookie })).status, 401);
        const lockedRelogin = await request('/api/kiemke/login', {
            method: 'POST', body: { username: lockedAccount.username, password: 'phase94-locked-password' },
        });
        assert.equal(lockedRelogin.status, 403);
        assert.equal((await request(`/api/admin/users/${operatorId}/status`, {
            method: 'PATCH', cookie: adminCookie, body: { active: false, reason: 'lock seeded operator' },
        })).status, 204);
        assert.equal((await request('/api/kiemke/me', { cookie: operatorCookie })).status, 401);

        const accountList = await readJson(await request('/api/admin/users?search=phase94&role=operator&status=locked', { cookie: adminCookie }));
        assert.ok(accountList.rows.some(account => account.username === 'phase94-locked' && !account.active));
        assert.ok(accountList.rows.some(account => account.username === 'phase94.operator' && !account.active));
        assert.equal((await request(`/api/admin/users/${lockedAccount.id}/status`, {
            method: 'PATCH', cookie: adminCookie, body: { active: true },
        })).status, 204);
        const unlockedLogin = await login('/api/kiemke/login', lockedAccount.username, 'phase94-locked-password');
        assert.equal(unlockedLogin.response.status, 200);
        assert.equal((await request('/api/kiemke/me', { cookie: unlockedLogin.cookie })).status, 200);

        const deletableResponse = await request('/api/admin/users', {
            method: 'POST', cookie: adminCookie,
            body: { username: 'phase94-delete-me', password: 'phase94-delete-password', role: 'operator' },
        });
        assert.equal(deletableResponse.status, 201);
        const deletableAccount = await readJson(deletableResponse);
        const deletableLogin = await login('/api/kiemke/login', deletableAccount.username, 'phase94-delete-password');
        assert.equal(deletableLogin.response.status, 200);
        const deletableSessionCookie = deletableLogin.cookie.split('; ')
            .find(value => value.startsWith('vtp.sid='));
        const deletableSessionId = decodeURIComponent(deletableSessionCookie.slice('vtp.sid='.length)).slice(2).split('.', 1)[0];
        assert.ok(database.prepare('SELECT sid FROM sessions WHERE sid = ?').get(deletableSessionId));
        database.prepare(`
            INSERT INTO inventory_history (ip, waybill, creator_username, created_at, created_by_user_id)
            VALUES (?, ?, ?, ?, ?)
        `).run('203.0.113.94', 'DELETE-ACCOUNT-HISTORY', deletableAccount.username, createdAt, deletableAccount.id);
        const deletedAccountResponse = await request(`/api/admin/users/${deletableAccount.id}`, {
            method: 'DELETE', cookie: adminCookie,
        });
        assert.equal(deletedAccountResponse.status, 204);
        assert.equal(database.prepare('SELECT id FROM users WHERE id = ?').get(deletableAccount.id), undefined);
        assert.equal(database.prepare('SELECT sid FROM sessions WHERE sid = ?').get(deletableSessionId), undefined);
        assert.equal((await request('/api/kiemke/me', { cookie: deletableLogin.cookie })).status, 401);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM inventory_sessions WHERE user_id = ?').get(deletableAccount.id).count, 0);
        const retainedHistory = database.prepare('SELECT waybill, creator_username, created_by_user_id FROM inventory_history WHERE waybill = ?').get('DELETE-ACCOUNT-HISTORY');
        assert.deepEqual(retainedHistory, {
            waybill: 'DELETE-ACCOUNT-HISTORY',
            creator_username: 'phase94-delete-me',
            created_by_user_id: null,
        });

        const districtCreate = await request('/api/admin/districts', {
            method: 'POST', cookie: adminCookie, body: { name: 'Phase94 Address District', kind: 'district' },
        });
        assert.equal(districtCreate.status, 201);
        const districtId = (await readJson(districtCreate)).id;
        const missingParentCommune = await request('/api/admin/communes', {
            method: 'POST', cookie: adminCookie, body: { name: 'No Parent', districtId: 999999 },
        });
        assert.equal(missingParentCommune.status, 404);
        const communeCreate = await request('/api/admin/communes', {
            method: 'POST', cookie: adminCookie, body: { name: 'Phase94 Commune', districtId },
        });
        assert.equal(communeCreate.status, 201);
        const communeId = (await readJson(communeCreate)).id;
        const villageCreate = await request('/api/admin/villages', {
            method: 'POST', cookie: adminCookie, body: { name: 'Phase94 Village', communeId },
        });
        assert.equal(villageCreate.status, 201);
        const villageId = (await readJson(villageCreate)).id;
        const hierarchy = await readJson(await request('/api/admin/geography', { cookie: adminCookie }));
        const hierarchyDistrict = hierarchy.find(item => item.id === districtId);
        assert.equal(hierarchyDistrict.communes[0].id, communeId);
        assert.equal(hierarchyDistrict.communes[0].villages[0].id, villageId);

        assert.equal((await request(`/api/admin/communes/${communeId}/visibility`, {
            method: 'PATCH', cookie: adminCookie, body: { hidden: true },
        })).status, 204);
        const hiddenAdminGeography = await readJson(await request('/api/admin/geography', { cookie: adminCookie }));
        assert.equal(hiddenAdminGeography.find(item => item.id === districtId).communes[0].is_hidden, 1);
        const publicGeography = await readJson(await request('/api/geography'));
        assert.equal(publicGeography.find(item => item.id === districtId).communes.length, 0);
        assert.equal((await request(`/api/admin/communes/${communeId}/visibility`, {
            method: 'PATCH', cookie: adminCookie, body: { hidden: false },
        })).status, 204);

        assert.equal((await request(`/api/admin/villages/${villageId}`, {
            method: 'PUT', cookie: adminCookie, body: { name: 'Wrong Parent', communeId: 999999 },
        })).status, 404);
        const unchangedVillage = await readJson(await request('/api/admin/geography', { cookie: adminCookie }));
        assert.equal(unchangedVillage.find(item => item.id === districtId).communes[0].villages[0].name, 'Phase94 Village');
        assert.equal((await request(`/api/admin/districts/${districtId}`, { method: 'DELETE', cookie: adminCookie })).status, 204);
        assert.equal(database.prepare("SELECT district FROM history WHERE barcode = 'SNAPSHOT-CODE'").get().district, 'Phase94 District');
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM villages WHERE commune_id = ?').get(communeId).count, 0);

        const originalField = (await readJson(await request('/api/admin/form-fields', { cookie: adminCookie })))
            .find(field => field.key === 'nhapTen');
        assert.ok(originalField);
        assert.equal((await request('/api/admin/form-fields/nhapTen', {
            method: 'PUT', cookie: adminCookie,
            body: { label: 'Recipient acceptance', visible: false, defaultValue: 'Hidden default' },
        })).status, 204);
        const updatedField = (await readJson(await request('/api/admin/form-fields', { cookie: adminCookie })))
            .find(field => field.key === 'nhapTen');
        assert.equal(updatedField.visible, 0);
        assert.equal(updatedField.defaultValue, 'Hidden default');
        assert.equal((await readJson(await request('/api/form-fields'))).find(field => field.key === 'nhapTen').visible, 0);
        assert.equal(database.prepare("SELECT field_values FROM history WHERE barcode = 'SNAPSHOT-CODE'").get().field_values, '{"nhapTen":"Snapshot recipient"}');

        const newOrder = await request('/api/history', {
            method: 'POST',
            body: {
                barcode: 'PHASE94-HIDDEN-FIELD',
                chonHuyen: 'Phase94 District', chonXa: 'Phase94 Commune', chonThon: '',
                fields: { nhapTen: 'Client value must be ignored' },
            },
        });
        assert.equal(newOrder.status, 201);
        assert.equal((await readJson(newOrder)).fields.nhapTen, 'Hidden default');
        assert.equal((await request('/api/history', {
            method: 'POST', body: {
                barcode: 'PHASE94-HIDDEN-FIELD', chonHuyen: 'Phase94 District', chonXa: 'Phase94 Commune', chonThon: '', fields: {},
            },
        })).status, 409);

        const ipRows = await readJson(await request('/api/admin/ips', { cookie: adminCookie }));
        assert.ok(ipRows.some(entry => entry.ip === '203.0.113.94'));
        assert.equal((await request('/api/admin/ips', {
            method: 'PUT', cookie: adminCookie, body: { ip: '203.0.113.94', label: 'Phase94 fixture', blocked: true },
        })).status, 204);
        const updatedIp = (await readJson(await request('/api/admin/ips', { cookie: adminCookie })))
            .find(entry => entry.ip === '203.0.113.94');
        assert.equal(updatedIp.label, 'Phase94 fixture');
        assert.equal(updatedIp.blocked, 1);

        database.exec(`
            CREATE TRIGGER phase94_fail_form_update BEFORE UPDATE ON form_fields
            WHEN OLD.field_key = 'soHang'
            BEGIN SELECT RAISE(ABORT, 'forced Phase 9.4 test failure'); END;
        `);
        const failedFieldUpdate = await request('/api/admin/form-fields/soHang', {
            method: 'PUT', cookie: adminCookie,
            body: { label: 'New quantity', visible: true, defaultValue: '' },
        });
        assert.equal(failedFieldUpdate.status, 500);
        assert.equal(database.prepare("SELECT label FROM form_fields WHERE field_key = 'soHang'").get().label, 'Số hàng');
        database.exec('DROP TRIGGER phase94_fail_form_update');

        const expiringLogin = await login('/api/login', 'phase94.admin', 'phase94-admin-password');
        assert.equal(expiringLogin.response.status, 200);
        const sessionCookie = expiringLogin.cookie.split('; ')
            .find(value => value.startsWith('vtp.sid='))?.slice('vtp.sid='.length);
        assert.ok(sessionCookie);
        const expiringSessionId = decodeURIComponent(sessionCookie).slice(2).split('.', 1)[0];
        const expiringSession = database.prepare('SELECT sid FROM sessions WHERE sid = ?').get(expiringSessionId);
        assert.ok(expiringSession);
        database.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1000, expiringSession.sid);
        assert.equal((await request('/api/admin/me', { cookie: expiringLogin.cookie })).status, 401);

        const logoutLogin = await login('/api/login', 'phase94.admin', 'phase94-admin-password');
        assert.equal(logoutLogin.response.status, 200);
        assert.equal((await request('/api/logout', { method: 'POST', cookie: logoutLogin.cookie })).status, 204);
        assert.equal((await request('/api/admin/me', { cookie: logoutLogin.cookie })).status, 401);

        assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(database.pragma('foreign_key_check'), []);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (database) database.close();
        for (const filePath of ['../server', '../database', '../session-store']) {
            delete require.cache[require.resolve(filePath)];
        }
        for (const key of environmentKeys) {
            if (previousEnvironment[key] === undefined) delete process.env[key];
            else process.env[key] = previousEnvironment[key];
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
});