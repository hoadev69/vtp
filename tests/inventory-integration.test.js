const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const { chromium } = require('playwright');
const QRCode = require('qrcode');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');

const environmentKeys = ['DATABASE_PATH', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'NODE_ENV'];

test('Inventory React and API integrate with isolated SQLite', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vtp-inventory-integration-'));
    const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
    let database;
    let apiServer;
    let vite;
    let browser;
    const contexts = [];

    try {
        Object.assign(process.env, {
            DATABASE_PATH: path.join(directory, 'history.sqlite'),
            ADMIN_USERNAME: 'phase95.admin',
            ADMIN_PASSWORD: 'phase95-admin-password',
            SESSION_SECRET: 'phase95-isolated-session-secret-with-at-least-32-bytes',
            NODE_ENV: 'test',
        });

        database = require('../database');
        const now = new Date();
        const createdAt = now.toISOString();
        const operatorPassword = 'phase95-operator-password';
        const operatorId = database.prepare(`
            INSERT INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'operator', 1, ?)
        `).run('phase95.operator', bcrypt.hashSync(operatorPassword, 4), createdAt).lastInsertRowid;
        const expiryUserId = database.prepare(`
            INSERT INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'operator', 1, ?)
        `).run('phase95.expiry', bcrypt.hashSync(operatorPassword, 4), createdAt).lastInsertRowid;
        database.prepare(`
            INSERT OR IGNORE INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'admin', 1, ?)
        `).run('phase95.admin', bcrypt.hashSync('phase95-admin-password', 4), createdAt);

        const inventoryColumns = database.pragma('table_info(inventory_history)').map(column => column.name);
        for (const column of ['id', 'ip', 'waybill', 'creator_username', 'created_at', 'anonymous_user_id', 'created_by_user_id']) {
            assert.ok(inventoryColumns.includes(column), `inventory_history is missing ${column}`);
        }
        const insertInventoryFixture = database.prepare(`
            INSERT INTO inventory_history (ip, waybill, creator_username, created_at, created_by_user_id)
            VALUES (?, ?, ?, ?, ?)
        `);
        insertInventoryFixture.run('203.0.113.95', 'RETENTION-OLD', 'legacy', new Date(now.getTime() - 73 * 60 * 60 * 1000).toISOString(), null);
        insertInventoryFixture.run('203.0.113.95', 'RETENTION-RECENT', 'legacy', new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(), null);

        require('../barcode-registry').applyBarcodeRegistryMigration(database, createdAt);
        apiServer = require('../server').listen(0, '127.0.0.1');
        await once(apiServer, 'listening');
        const apiOrigin = `http://127.0.0.1:${apiServer.address().port}`;
        const { createServer } = await import('vite');
        vite = await createServer({
            configFile: false,
            root: path.join(process.cwd(), 'frontend'),
            appType: 'spa',
            logLevel: 'error',
            server: {
                host: '127.0.0.1',
                port: 0,
                proxy: { '/api': { target: apiOrigin } },
            },
        });
        await vite.listen();
        const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill = 'RETENTION-OLD'").get().count, 0);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill = 'RETENTION-RECENT'").get().count, 1);

        browser = await chromium.launch({ headless: true });
        const operatorContext = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
        });
        contexts.push(operatorContext);
        await operatorContext.addInitScript(() => {
            window.__clipboardValue = '';
            window.__clipboardReadCount = 0;
            window.__clipboardGate = false;
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    readText: () => {
                        window.__clipboardReadCount += 1;
                        if (window.__clipboardGate) {
                            return new Promise(resolve => { window.__releaseClipboard = () => resolve(window.__clipboardValue); });
                        }
                        return Promise.resolve(window.__clipboardValue);
                    },
                },
            });
        });
        const operatorPage = await operatorContext.newPage();
        const pageErrors = [];
        const inventoryRequests = [];
        operatorPage.on('pageerror', error => pageErrors.push(error.message));
        operatorPage.on('request', request => {
            if (new URL(request.url()).pathname === '/api/kiemke' && request.method() === 'POST') {
                inventoryRequests.push(request.postDataJSON());
            }
        });

        await operatorPage.goto(`${origin}/kiemke`);
        await operatorPage.locator('#inventory-username').waitFor();
        const guestProbe = await operatorPage.evaluate(async () => {
            const [session, create] = await Promise.all([
                fetch('/api/kiemke/me'),
                fetch('/api/kiemke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waybill: 'GUEST-WAYBILL' }) }),
            ]);
            return { session: session.status, create: create.status };
        });
        assert.deepEqual(guestProbe, { session: 401, create: 401 });
        assert.equal(await operatorPage.locator('#inventory-username').count(), 1);
        inventoryRequests.length = 0;

        async function loginOperator(page, username = 'phase95.operator') {
            await page.locator('#inventory-username').fill(username);
            await page.locator('#inventory-password').fill(operatorPassword);
            await page.getByRole('button', { name: 'Đăng nhập' }).click();
            await page.getByRole('button', { name: 'Lấy mã từ clipboard' }).waitFor();
        }

        await loginOperator(operatorPage);
        await operatorPage.evaluate(() => { window.__clipboardValue = '  WB-95-OPERATOR-1  '; });
        await operatorPage.getByRole('button', { name: 'Lấy mã từ clipboard' }).click();
        const qrImage = operatorPage.locator('.inventory-dialog__qr');
        await qrImage.waitFor();
        const displayedQr = await qrImage.getAttribute('src');
        assert.match(displayedQr, /^data:image\/png;base64,/);
        const decodedPng = PNG.sync.read(Buffer.from(displayedQr.split(',')[1], 'base64'));
        assert.equal(jsQR(new Uint8ClampedArray(decodedPng.data), decodedPng.width, decodedPng.height)?.data, 'WB-95-OPERATOR-1');
        const operatorRecord = database.prepare('SELECT * FROM inventory_history WHERE waybill = ?').get('WB-95-OPERATOR-1');
        assert.equal(operatorRecord.creator_username, 'phase95.operator');
        assert.equal(operatorRecord.created_by_user_id, operatorId);
        assert.equal(inventoryRequests[0].waybill, 'WB-95-OPERATOR-1');
        await operatorPage.touchscreen.tap(5, 5);
        await operatorPage.locator('.inventory-dialog[open]').waitFor({ state: 'hidden' });

        inventoryRequests.length = 0;
        const dropZone = operatorPage.locator('.inventory-workspace');
        const acceptedDrag = await operatorPage.evaluate(() => {
            const zone = document.querySelector('.inventory-workspace');
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', '  WB-95-DROP-1  ');
            const dragenter = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer });
            zone.dispatchEvent(dragenter);
            const dragover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer });
            zone.dispatchEvent(dragover);
            return { dragenterPrevented: dragenter.defaultPrevented, dragoverPrevented: dragover.defaultPrevented };
        });
        assert.deepEqual(acceptedDrag, { dragenterPrevented: true, dragoverPrevented: true });
        assert.equal(await dropZone.evaluate(zone => zone.classList.contains('inventory-workspace--dragging')), true);
        assert.match(await dropZone.textContent(), /Có thể thả mã vận đơn vào đây/);

        const dropPrevented = await operatorPage.evaluate(() => {
            const zone = document.querySelector('.inventory-workspace');
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', '  WB-95-DROP-1  ');
            const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer });
            zone.dispatchEvent(drop);
            return drop.defaultPrevented;
        });
        assert.equal(dropPrevented, true);
        await qrImage.waitFor();
        assert.equal(await operatorPage.locator('.inventory-dialog__waybill').textContent(), 'WB-95-DROP-1');
        assert.equal(inventoryRequests.length, 1);
        assert.equal(inventoryRequests[0].waybill, 'WB-95-DROP-1');
        await operatorPage.getByRole('button', { name: 'Đóng' }).click();

        await operatorPage.evaluate(() => {
            const zone = document.querySelector('.inventory-workspace');
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', 'https://example.com/waybill');
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        });
        await dropZone.getByRole('alert').filter({ hasText: 'không phải mã vận đơn' }).waitFor();
        assert.equal(inventoryRequests.length, 1);

        await operatorPage.evaluate(() => {
            const zone = document.querySelector('.inventory-workspace');
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', '   ');
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        });
        await dropZone.getByRole('alert').filter({ hasText: 'Không tìm thấy mã vận đơn' }).waitFor();
        assert.equal(inventoryRequests.length, 1);

        await operatorPage.evaluate(() => {
            const zone = document.querySelector('.inventory-workspace');
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', 'WB-95-DROP-2');
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        });
        await qrImage.waitFor();
        assert.equal(await operatorPage.locator('.inventory-dialog__waybill').textContent(), 'WB-95-DROP-2');
        assert.equal(inventoryRequests.length, 2);
        assert.equal(inventoryRequests[1].waybill, 'WB-95-DROP-2');
        await operatorPage.getByRole('button', { name: 'Đóng' }).click();

        await operatorPage.evaluate(() => {
            window.__clipboardValue = 'WB-95-DOUBLE-SUBMIT';
            window.__clipboardReadCount = 0;
            window.__clipboardGate = true;
            const button = document.querySelector('.inventory-page__create');
            const click = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            click();
            click();
        });
        assert.equal(await operatorPage.evaluate(() => window.__clipboardReadCount), 1);
        await operatorPage.evaluate(() => {
            window.__clipboardGate = false;
            window.__releaseClipboard();
        });
        await qrImage.waitFor();
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill = 'WB-95-DOUBLE-SUBMIT'").get().count, 1);
        await operatorPage.getByRole('button', { name: 'Đóng' }).click();

        const beforeInvalid = database.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count;
        const invalidStatuses = await operatorPage.evaluate(async () => {
            const values = [null, '', '   ', 'X'.repeat(513), 42];
            const responses = await Promise.all(values.map(waybill => fetch('/api/kiemke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ waybill }),
            })));
            return responses.map(response => response.status);
        });
        assert.deepEqual(invalidStatuses, [400, 400, 400, 400, 400]);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count, beforeInvalid);

        database.exec(`
            CREATE TRIGGER phase95_inventory_insert_error
            BEFORE INSERT ON inventory_history
            WHEN NEW.waybill = 'WB-95-FAIL-500'
            BEGIN SELECT RAISE(ABORT, 'phase95 internal fixture error'); END;
        `);
        await operatorPage.evaluate(() => { window.__clipboardValue = 'WB-95-FAIL-500'; });
        await operatorPage.getByRole('button', { name: 'Lấy mã từ clipboard' }).click();
        await operatorPage.getByRole('alert').filter({ hasText: 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.' }).waitFor();
        assert.equal(await operatorPage.locator('.inventory-dialog[open]').count(), 0);
        assert.equal(await operatorPage.evaluate(() => window.__clipboardValue), 'WB-95-FAIL-500');
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill = 'WB-95-FAIL-500'").get().count, 0);
        database.exec('DROP TRIGGER phase95_inventory_insert_error');

        const adminContext = await browser.newContext();
        contexts.push(adminContext);
        const adminPage = await adminContext.newPage();
        await adminPage.goto(`${origin}/kiemke`);
        await adminPage.locator('#inventory-username').fill('phase95.admin');
        await adminPage.locator('#inventory-password').fill('phase95-admin-password');
        await adminPage.getByRole('button', { name: 'Đăng nhập' }).click();
        await adminPage.getByRole('button', { name: 'Lấy mã từ clipboard' }).waitFor();
        const desktopAdminLink = adminPage.locator('.app-navigation__links a[href="/admin"]');
        await desktopAdminLink.waitFor();
        assert.equal(await desktopAdminLink.isVisible(), true);
        await adminPage.setViewportSize({ width: 390, height: 844 });
        const mobileAdminLink = adminPage.locator('.bottom-navigation a[href="/admin"]');
        await mobileAdminLink.waitFor();
        assert.equal(await mobileAdminLink.isVisible(), true);
        const inventoryHeadingBox = await adminPage.locator('.inventory-page__heading').boundingBox();
        const createButtonBox = await adminPage.locator('.inventory-page__create').boundingBox();
        const bottomNavigationBox = await adminPage.locator('.bottom-navigation').boundingBox();
        assert.ok(createButtonBox.y - inventoryHeadingBox.y >= 96);
        assert.ok(bottomNavigationBox.y - (createButtonBox.y + createButtonBox.height) >= 24);
        const adminInventory = await adminPage.evaluate(async () => {
            const [admin, session, create] = await Promise.all([
                fetch('/api/admin/me'),
                fetch('/api/kiemke/me'),
                fetch('/api/kiemke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waybill: 'WB-95-ADMIN' }) }),
            ]);
            return { admin: admin.status, session: session.status, create: create.status, result: await create.json() };
        });
        assert.equal(adminInventory.admin, 200);
        assert.equal(adminInventory.session, 200);
        assert.equal(adminInventory.create, 201);
        assert.match(adminInventory.result.qrCode, /^data:image\/png;base64,/);
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM inventory_history WHERE waybill = 'WB-95-ADMIN' AND creator_username = 'phase95.admin'").get().count, 1);

        await operatorPage.getByRole('button', { name: 'Đăng xuất' }).click();
        await operatorPage.waitForURL(`${origin}/`);
        const loggedOutStatus = await operatorPage.evaluate(async () => (await fetch('/api/kiemke/me')).status);
        assert.equal(loggedOutStatus, 401);
        await operatorPage.goto(`${origin}/kiemke`);
        await loginOperator(operatorPage);

        const lockStatus = await adminPage.evaluate(async operatorId => (await fetch(`/api/admin/users/${operatorId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: false, reason: 'Phase 9.5 acceptance lock' }),
        })).status, operatorId);
        assert.equal(lockStatus, 204);
        const beforeLockedSend = database.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count;
        await operatorPage.evaluate(() => { window.__clipboardValue = 'WB-95-LOCKED'; });
        await operatorPage.getByRole('button', { name: 'Lấy mã từ clipboard' }).click();
        await operatorPage.locator('#inventory-username').waitFor();
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count, beforeLockedSend);

        const expiryContext = await browser.newContext();
        contexts.push(expiryContext);
        await expiryContext.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { readText: () => Promise.resolve('WB-95-EXPIRED') },
            });
        });
        const expiryPage = await expiryContext.newPage();
        await expiryPage.goto(`${origin}/kiemke`);
        await loginOperator(expiryPage, 'phase95.expiry');
        const sessionCookie = (await expiryContext.cookies(origin)).find(cookie => cookie.name === 'vtp.sid');
        assert.ok(sessionCookie);
        const sessionId = decodeURIComponent(sessionCookie.value).replace(/^s:/, '').split('.')[0];
        database.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() - 1000, sessionId);
        database.prepare('UPDATE inventory_sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, expiryUserId);
        const beforeExpiredSend = database.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count;
        await expiryPage.getByRole('button', { name: 'Lấy mã từ clipboard' }).click();
        await expiryPage.locator('#inventory-username').waitFor();
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM inventory_history').get().count, beforeExpiredSend);

        await adminPage.getByRole('button', { name: 'Đăng xuất' }).click();
        await adminPage.waitForURL(`${origin}/`);
        const adminLogoutStatuses = await adminPage.evaluate(async () => Promise.all([
            fetch('/api/admin/me').then(response => response.status),
            fetch('/api/kiemke/me').then(response => response.status),
        ]));
        assert.deepEqual(adminLogoutStatuses, [401, 401]);
        assert.deepEqual(pageErrors, []);

        const integrity = database.pragma('integrity_check');
        assert.deepEqual(integrity, [{ integrity_check: 'ok' }]);
        assert.deepEqual(database.pragma('foreign_key_check'), []);
        console.log('Inventory acceptance: operator/admin/guest, lock, validation, double-send, 500, logout, expiry, QR decode, and 72h retention passed.');
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
        fs.rmSync(directory, { recursive: true, force: true });
    }
});