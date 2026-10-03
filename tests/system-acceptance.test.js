const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');
const {
    applyBarcodeRegistryMigration,
    pruneExpiredHistory,
} = require('../barcode-registry');

const environmentKeys = ['DATABASE_PATH', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'NODE_ENV'];

test('VTP system acceptance integrates React, Express, registry, Admin, Inventory, and SQLite', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-system-acceptance-'));
    const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
    let database;
    let apiServer;
    let vite;
    let browser;
    const contexts = [];

    try {
        Object.assign(process.env, {
            DATABASE_PATH: path.join(directory, 'history.sqlite'),
            ADMIN_USERNAME: 'phase97.admin',
            ADMIN_PASSWORD: 'phase97-admin-password',
            SESSION_SECRET: 'phase97-isolated-session-secret-with-at-least-32-bytes',
            NODE_ENV: 'test',
        });

        database = require('../database');
        const now = new Date();
        const createdAt = now.toISOString();
        const insertHistory = database.prepare(`
            INSERT INTO history (ip, barcode, district, commune, village, field_values, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        insertHistory.run('203.0.113.97', 'LEGACY-AMBIG-97', 'TP.Lào Cai', 'Thống Nhất', '', '{"nhapTen":"Ambiguous old"}', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());
        insertHistory.run('203.0.113.97', 'LEGACY-AMBIG-97', 'TP.Lào Cai', 'Thống Nhất', '', '{"nhapTen":"Ambiguous recent"}', createdAt);
        insertHistory.run('203.0.113.97', 'RELEASE-SYS-97', 'TP.Lào Cai', 'Thống Nhất', '', '{}', new Date(now.getTime() - 100 * 60 * 60 * 1000).toISOString());
        insertHistory.run('203.0.113.97', 'RELEASE-SYS-97', 'TP.Lào Cai', 'Thống Nhất', '', '{}', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());
        database.prepare(`
            INSERT INTO inventory_history (ip, waybill, creator_username, created_at)
            VALUES (?, ?, ?, ?)
        `).run('203.0.113.97', 'INVENTORY-OLD-97', 'legacy', new Date(now.getTime() - 100 * 60 * 60 * 1000).toISOString());
        database.prepare(`
            INSERT INTO inventory_history (ip, waybill, creator_username, created_at)
            VALUES (?, ?, ?, ?)
        `).run('203.0.113.97', 'INVENTORY-RECENT-97', 'legacy', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());
        const operatorId = database.prepare(`
            INSERT INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'operator', 1, ?)
        `).run('phase97.operator', bcrypt.hashSync('phase97-operator-password', 4), createdAt).lastInsertRowid;

        const historyBeforeMigration = database.prepare('SELECT id, barcode, created_at FROM history ORDER BY id').all();
        applyBarcodeRegistryMigration(database, createdAt);
        applyBarcodeRegistryMigration(database, new Date(now.getTime() + 1000).toISOString());
        assert.deepEqual(database.prepare('SELECT id, barcode, created_at FROM history ORDER BY id').all(), historyBeforeMigration);

        apiServer = require('../server').listen(0, '127.0.0.1');
        await once(apiServer, 'listening');
        const apiOrigin = `http://127.0.0.1:${apiServer.address().port}`;
        const { createServer } = await import('vite');
        vite = await createServer({
            configFile: false,
            root: path.join(process.cwd(), 'frontend'),
            appType: 'spa',
            logLevel: 'error',
            server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: apiOrigin } } },
        });
        await vite.listen();
        const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
        const request = (url, { method = 'GET', body, cookie } = {}) => fetch(`${apiOrigin}${url}`, {
            method,
            headers: {
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(cookie ? { Cookie: cookie } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const login = async (url, username, password) => {
            const response = await request(url, { method: 'POST', body: { username, password } });
            const cookie = response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
            return { response, cookie };
        };

        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='RELEASE-SYS-97'").get().count, 1);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history m JOIN history h ON h.id=m.history_id WHERE m.barcode='RELEASE-SYS-97'").get().count, 1);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode='RELEASE-SYS-97'").get().status, 'legacy_ambiguous');
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill='INVENTORY-OLD-97'").get().count, 0);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill='INVENTORY-RECENT-97'").get().count, 1);

        const anonymousAdmin = await request('/api/admin/history?barcode=LEGACY-AMBIG-97');
        assert.equal(anonymousAdmin.status, 401);
        const operatorLogin = await login('/api/kiemke/login', 'phase97.operator', 'phase97-operator-password');
        assert.equal(operatorLogin.response.status, 200);
        const operatorAdmin = await request('/api/admin/history?barcode=LEGACY-AMBIG-97', { cookie: operatorLogin.cookie });
        assert.equal(operatorAdmin.status, 403);
        const adminLogin = await login('/api/login', 'phase97.admin', 'phase97-admin-password');
        assert.equal(adminLogin.response.status, 200);
        const adminHistory = await request('/api/admin/history?barcode=LEGACY-AMBIG-97', { cookie: adminLogin.cookie });
        assert.equal(adminHistory.status, 200);
        const ambiguousData = await adminHistory.json();
        assert.equal(ambiguousData.barcodeResolution.status, 'ambiguous');
        assert.equal(ambiguousData.barcodeResolution.count, 2);
        assert.equal(ambiguousData.rows.length, 2);

        const pageErrors = [];
        const historyPostRequests = [];
        const adminContext = await browserContext();
        contexts.push(adminContext);
        const page = await adminContext.newPage();
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('request', browserRequest => {
            if (new URL(browserRequest.url()).pathname === '/api/history' && browserRequest.method() === 'POST') {
                historyPostRequests.push(browserRequest.postDataJSON());
            }
        });
        await page.goto(`${origin}/admin`);
        await page.locator('#admin-username').waitFor();
        await page.goto(`${origin}/kiemke`);
        await page.locator('#inventory-username').waitFor();
        await page.goto(`${origin}/`);
        await page.locator('#barcodeInput').waitFor();
        await page.locator('#barcodeInput').fill('P97-ORDER-001');
        await page.locator('#nhapTen').fill('Nguyen System Acceptance');
        await page.locator('#nhapSdt').fill('0912345678');
        await page.locator('#soHang').fill('2');
        await page.locator('#tenHang').fill('Phase 97 fixture');
        const barcodeImageResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/barcode');
        const qrImageResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/qrcode');
        await page.getByRole('button', { name: 'Gửi' }).click();
        await page.getByRole('heading', { name: 'Tem vận chuyển' }).waitFor();
        const [barcodeResponse, qrResponse] = await Promise.all([barcodeImageResponse, qrImageResponse]);
        const resultLabel = page.locator('.result-label-svg');
        await resultLabel.waitFor();
        assert.equal(await resultLabel.getAttribute('width'), '105mm');
        assert.equal(await resultLabel.getAttribute('height'), '74mm');
        assert.equal(await resultLabel.locator('title').first().textContent(), 'Tem vận chuyển P97-ORDER-001');
        assert.ok((await resultLabel.locator('image').nth(1).getAttribute('href')).includes('/api/barcode?text=P97-ORDER-001'));
        assert.ok((await resultLabel.locator('image').nth(2).getAttribute('href')).includes('/api/qrcode?text=P97-ORDER-001'));
        await page.waitForFunction(() => {
            const images = Array.from(document.querySelectorAll('.result-label-svg image'));
            return images.some(image => image.getAttribute('href')?.startsWith('/api/barcode?'))
                && images.some(image => image.getAttribute('href')?.startsWith('/api/qrcode?'));
        });
        assert.equal(barcodeResponse.status(), 200);
        assert.match(barcodeResponse.headers()['content-type'], /image\/png/);
        assert.deepEqual([...((await barcodeResponse.body()).subarray(0, 8))], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.equal(qrResponse.status(), 200);
        assert.match(qrResponse.headers()['content-type'], /image\/png/);
        assert.deepEqual([...((await qrResponse.body()).subarray(0, 8))], [137, 80, 78, 71, 13, 10, 26, 10]);
        const createdHistory = database.prepare("SELECT id, barcode, field_values FROM history WHERE barcode='P97-ORDER-001'").get();
        assert.ok(createdHistory);
        assert.deepEqual(JSON.parse(createdHistory.field_values), {
            nhapTen: 'Nguyen System Acceptance', nhapSdt: '0912345678', soHang: '2', tenHang: 'Phase 97 fixture',
        });
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history WHERE barcode='P97-ORDER-001'").get().count, 1);
        assert.equal(historyPostRequests.length, 1);

        await page.goto(`${origin}/`);
        await page.locator('#barcodeInput').fill('P97-ORDER-001');
        await page.locator('#nhapTen').fill('Retained after conflict');
        await page.locator('#nhapSdt').fill('0987654321');
        await page.locator('#soHang').fill('7');
        await page.locator('#tenHang').fill('Conflict data stays in form');
        await page.getByRole('button', { name: 'Gửi' }).click();
        await page.getByRole('alert').filter({ hasText: 'Mã vận đơn này đã được sử dụng.' }).waitFor();
        assert.equal(await page.locator('#barcodeInput').inputValue(), 'P97-ORDER-001');
        assert.equal(await page.locator('#nhapTen').inputValue(), 'Retained after conflict');
        assert.equal(await page.locator('#nhapSdt').inputValue(), '0987654321');
        assert.equal(await page.locator('#soHang').inputValue(), '7');
        assert.equal(await page.locator('#tenHang').inputValue(), 'Conflict data stays in form');
        assert.equal((await request('/api/history', {
            method: 'POST', body: { barcode: 'P97-ORDER-001', chonHuyen: 'TP.Lào Cai', chonXa: 'Thống Nhất', chonThon: '', fields: {} },
        })).status, 409);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='P97-ORDER-001'").get().count, 1);
        assert.equal(historyPostRequests.length, 2);

        await page.goto(`${origin}/admin`);
        await page.locator('#admin-username').fill('phase97.admin');
        await page.locator('#admin-password').fill('phase97-admin-password');
        await page.getByRole('button', { name: 'Đăng nhập' }).click();
        await page.getByRole('heading', { name: 'Lịch sử tạo tem' }).waitFor();
        await page.locator('#admin-order-search').fill('LEGACY-AMBIG-97');
        await page.getByRole('button', { name: 'Tìm kiếm' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.admin-order-table tbody tr').length === 2);
        await page.getByRole('button', { name: 'Xem chi tiết' }).first().click();
        await page.getByRole('heading', { name: 'LEGACY-AMBIG-97' }).waitFor();
        const historyPostsBeforeReprint = historyPostRequests.length;
        page.on('dialog', dialog => dialog.accept());
        await page.getByRole('button', { name: 'In lại tem' }).click();
        await page.getByRole('heading', { name: 'Tem vận chuyển' }).waitFor();
        assert.equal(historyPostRequests.length, historyPostsBeforeReprint);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='LEGACY-AMBIG-97'").get().count, 2);

        await page.goto(`${origin}/admin`);
        await page.locator('#admin-order-search').fill('LEGACY-AMBIG-97');
        await page.getByRole('button', { name: 'Tìm kiếm' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.admin-order-table tbody tr').length === 2);
        database.exec('ALTER TABLE history RENAME TO phase97_history_unavailable');
        try {
            await page.locator('#admin-order-search').fill('ADMIN-DB-FAILURE');
            await page.getByRole('button', { name: 'Tìm kiếm' }).click();
            await page.getByRole('alert').filter({ hasText: 'Không thể tải lịch sử đơn hàng.' }).waitFor();
            assert.equal(await page.locator('.admin-order-table tbody tr').count(), 0);
        } finally {
            database.exec('ALTER TABLE phase97_history_unavailable RENAME TO history');
        }

        await adminContext.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { readText: () => Promise.resolve('INV-P97-ADMIN') },
            });
        });
        await page.goto(`${origin}/kiemke`);
        await page.getByRole('button', { name: 'Lấy mã từ clipboard' }).waitFor();
        await page.getByRole('button', { name: 'Lấy mã từ clipboard' }).click();
        await page.locator('.inventory-dialog[open] .inventory-dialog__qr').waitFor();
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill='INV-P97-ADMIN' AND creator_username='phase97.admin'").get().count, 1);

        const operatorContext = await browserContext();
        contexts.push(operatorContext);
        await operatorContext.addInitScript(() => {
            window.__clipboardGate = true;
            window.__clipboardReads = 0;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    readText: () => {
                        window.__clipboardReads += 1;
                        return new Promise(resolve => { window.__releaseClipboard = () => resolve('INV-P97-DOUBLE'); });
                    },
                },
            });
        });
        const operatorPage = await operatorContext.newPage();
        operatorPage.on('pageerror', error => pageErrors.push(error.message));
        await operatorPage.goto(`${origin}/kiemke`);
        await operatorPage.locator('#inventory-username').fill('phase97.operator');
        await operatorPage.locator('#inventory-password').fill('phase97-operator-password');
        await operatorPage.getByRole('button', { name: 'Đăng nhập' }).click();
        await operatorPage.getByRole('button', { name: 'Lấy mã từ clipboard' }).waitFor();
        await operatorPage.evaluate(() => {
            const button = document.querySelector('.inventory-page__create');
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        assert.equal(await operatorPage.evaluate(() => window.__clipboardReads), 1);
        await operatorPage.evaluate(() => window.__releaseClipboard());
        await operatorPage.locator('.inventory-dialog[open] .inventory-dialog__qr').waitFor();
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill='INV-P97-DOUBLE' AND creator_username='phase97.operator'").get().count, 1);
        const guestInventory = await request('/api/kiemke/me');
        assert.equal(guestInventory.status, 401);
        const guestCreate = await request('/api/kiemke', { method: 'POST', body: { waybill: 'INV-P97-GUEST' } });
        assert.equal(guestCreate.status, 401);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill='INV-P97-GUEST'").get().count, 0);

        const stillReferencedAttempt = await request('/api/history', {
            method: 'POST',
            body: { barcode: 'RELEASE-SYS-97', chonHuyen: 'TP.Lào Cai', chonXa: 'Thống Nhất', chonThon: '', fields: {} },
        });
        assert.equal(stillReferencedAttempt.status, 409);
        const remainingReleaseRow = database.prepare("SELECT id FROM history WHERE barcode='RELEASE-SYS-97'").get();
        assert.ok(remainingReleaseRow);
        database.prepare('UPDATE history SET created_at = ? WHERE id = ?')
            .run(new Date(now.getTime() - 100 * 60 * 60 * 1000).toISOString(), remainingReleaseRow.id);
        const releaseCleanup = pruneExpiredHistory(database, now.toISOString());
        assert.equal(releaseCleanup.historyDeleted >= 1, true);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM history WHERE barcode='RELEASE-SYS-97'").get().count, 0);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM barcode_registry_history WHERE barcode='RELEASE-SYS-97'").get().count, 0);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode='RELEASE-SYS-97'").get().status, 'released');
        const secondCleanup = pruneExpiredHistory(database, now.toISOString());
        assert.equal(secondCleanup.historyDeleted, 0);
        assert.equal(secondCleanup.inventoryDeleted, 0);
        const releasedBarcodeReuse = await request('/api/history', {
            method: 'POST',
            body: { barcode: 'RELEASE-SYS-97', chonHuyen: 'TP.Lào Cai', chonXa: 'Thống Nhất', chonThon: '', fields: {} },
        });
        assert.equal(releasedBarcodeReuse.status, 201);
        assert.equal(database.prepare("SELECT status FROM barcode_registry WHERE barcode='RELEASE-SYS-97'").get().status, 'new');

        assert.deepEqual(pageErrors, []);
        assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(database.pragma('foreign_key_check'), []);

        await new Promise((resolve, reject) => apiServer.close(error => error ? reject(error) : resolve()));
        apiServer = null;
        database.close();
        database = null;
        delete require.cache[require.resolve('../database')];
        delete require.cache[require.resolve('../server')];

        const routeProbeSource = `
            const assert = require('node:assert/strict');
            const app = require(${JSON.stringify(path.join(process.cwd(), 'server.js'))});
            (async () => {
                const server = app.listen(0, '127.0.0.1');
                await new Promise(resolve => server.once('listening', resolve));
                const base = 'http://127.0.0.1:' + server.address().port;
                try {
                    const results = {};
                    for (const route of ['/', '/admin', '/kiemke']) {
                        const response = await fetch(base + route);
                        results[route] = { status: response.status, body: await response.text() };
                    }
                    for (const route of ['/api/form-fields', '/api/geography']) {
                        const response = await fetch(base + route);
                        results[route] = { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
                    }
                    const unknownApi = await fetch(base + '/api/system-acceptance-not-a-route');
                    results.unknownApi = { status: unknownApi.status, body: await unknownApi.text() };
                    console.log('PHASE97_RESULTS=' + JSON.stringify(results));
                } finally {
                    await new Promise(resolve => server.close(resolve));
                }
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `;
        const productionRoutes = spawnSync(process.execPath, ['-e', routeProbeSource], {
            cwd: process.cwd(),
            encoding: 'utf8',
            env: {
                ...process.env,
                DATABASE_PATH: path.join(directory, 'history.sqlite'),
                ADMIN_USERNAME: 'phase97.admin',
                ADMIN_PASSWORD: 'phase97-admin-password',
                SESSION_SECRET: 'phase97-isolated-session-secret-with-at-least-32-bytes',
                NODE_ENV: 'production',
            },
        });
        assert.equal(productionRoutes.status, 0, `${productionRoutes.stderr}\n${productionRoutes.stdout}`);
        const resultLine = productionRoutes.stdout.split('\n').find(line => line.startsWith('PHASE97_RESULTS='));
        assert.ok(resultLine, productionRoutes.stdout);
        const routeResults = JSON.parse(resultLine.slice('PHASE97_RESULTS='.length));
        assert.equal(routeResults['/'].status, 200);
        assert.match(routeResults['/'].body, /index\.js|barcodeInput/);
        assert.doesNotMatch(routeResults['/'].body, /src="\/src\/main\.jsx"/);
        assert.equal(routeResults['/admin'].status, 401);
        assert.match(routeResults['/admin'].body, /admin/);
        assert.doesNotMatch(routeResults['/admin'].body, /assets\/index-[^" ]+\.js/);
        assert.equal(routeResults['/kiemke'].status, 200);
        assert.match(routeResults['/kiemke'].body, /operatorLoginPanel/);
        assert.equal(routeResults['/api/form-fields'].status, 200);
        assert.match(routeResults['/api/form-fields'].type, /application\/json/);
        assert.equal(routeResults['/api/geography'].status, 200);
        assert.match(routeResults['/api/geography'].type, /application\/json/);
        assert.equal(routeResults.unknownApi.status, 404);
        assert.doesNotMatch(routeResults.unknownApi.body, /id="root"|src="\/src\/main\.jsx"/);

        console.log('System acceptance passed; Express production routing remains legacy at /, /admin, and /kiemke.');
    } finally {
        for (const context of contexts) await context.close();
        if (browser) await browser.close();
        if (vite) await vite.close();
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        if (database) database.close();
        for (const key of environmentKeys) {
            if (previousEnvironment[key] === undefined) delete process.env[key];
            else process.env[key] = previousEnvironment[key];
        }
        delete require.cache[require.resolve('../database')];
        delete require.cache[require.resolve('../server')];
        fs.rmSync(directory, { recursive: true, force: true });
    }

    async function browserContext() {
        if (!browser) browser = await chromium.launch({ headless: true });
        return browser.newContext();
    }
});