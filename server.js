require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
const database = require('./database');
const SQLiteSessionStore = require('./session-store');

const app = express();
const port = process.env.PORT || 3000;
const adminUsername = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || '';
const maxTextLength = 512;
const generatedCodeRetentionMs = 3 * 24 * 60 * 60 * 1000;
const trustProxyHops = Math.max(0, Number.parseInt(process.env.TRUST_PROXY_HOPS, 10) || 0);
const anonymousCookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
};

if (!/^[a-z0-9._-]{3,32}$/.test(adminUsername)
    || adminPassword.length < 6
    || Buffer.byteLength(adminPassword, 'utf8') > 72
    || sessionSecret.length < 32) {
    console.error('Cần ADMIN_USERNAME hợp lệ, ADMIN_PASSWORD từ 6 ký tự và SESSION_SECRET tối thiểu 32 ký tự.');
    process.exit(1);
}

const existingAdmin = database.prepare('SELECT id, role FROM users WHERE username = ?').get(adminUsername);
if (!existingAdmin) {
    database.prepare(`
        INSERT INTO users (username, password_hash, role, created_at)
        VALUES (?, ?, 'admin', ?)
    `).run(adminUsername, bcrypt.hashSync(adminPassword, 12), new Date().toISOString());
} else if (existingAdmin.role !== 'admin') {
    throw new Error('ADMIN_USERNAME đã được dùng bởi tài khoản không phải admin.');
} else {
    database.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(bcrypt.hashSync(adminPassword, 12), existingAdmin.id);
}

app.set('trust proxy', trustProxyHops);
app.use(express.json({ limit: '16kb' }));
const sessionStore = new SQLiteSessionStore(database);
app.use(session({
    name: 'vtp.sid',
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000,
    },
}));
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Quá nhiều lần đăng nhập không thành công. Vui lòng thử lại sau 15 phút.' },
});
const inventoryLoginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Quá nhiều lần đăng nhập kiểm kê thất bại. Vui lòng thử lại sau 15 phút.' },
});
const generationRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Đã vượt quá giới hạn tạo mã. Vui lòng thử lại sau.' },
});
const pruneExpiredHistory = database.transaction(cutoff => {
    database.prepare('DELETE FROM history WHERE created_at < ?').run(cutoff);
    database.prepare('DELETE FROM inventory_history WHERE created_at < ?').run(cutoff);
});

function pruneGeneratedCodeHistory() {
    try {
        pruneExpiredHistory(new Date(Date.now() - generatedCodeRetentionMs).toISOString());
    } catch (error) {
        console.error('Không thể dọn lịch sử tạo mã quá hạn.', error);
    }
}

pruneGeneratedCodeHistory();
setInterval(pruneGeneratedCodeHistory, 60 * 60 * 1000).unref();

app.get('/healthz', (req, res) => {
    try {
        database.prepare('SELECT 1').get();
        res.json({ status: 'ok' });
    } catch {
        res.status(503).json({ status: 'unavailable' });
    }
});

function getClientIp(req) {
    let ip = req.ip || req.socket.remoteAddress || '';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return net.isIP(ip) ? ip : 'unknown';
}

function readCookie(req, name) {
    for (const item of (req.headers.cookie || '').split(';')) {
        const separator = item.indexOf('=');
        if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(item.slice(separator + 1).trim());
        } catch {
            return '';
        }
    }
    return '';
}

function isValidAnonymousToken(value, prefix) {
    return typeof value === 'string'
        && value.startsWith(`${prefix}_`)
        && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.slice(2));
}

function hashAnonymousSessionId(value) {
    return createHash('sha256').update(value).digest('hex');
}

function hashInventorySessionToken(value) {
    return createHash('sha256').update(value).digest('hex');
}

const getAnonymousSession = database.prepare(
    'SELECT anonymous_user_id FROM anonymous_sessions WHERE id = ?',
);
const recordAnonymousActivity = database.transaction((userId, sessionId, ip, timestamp) => {
    database.prepare(`
        INSERT INTO anonymous_users (id, first_seen_at, last_seen_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).run(userId, timestamp, timestamp);
    database.prepare(`
        INSERT INTO anonymous_sessions (id, anonymous_user_id, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).run(sessionId, userId, timestamp, timestamp);
    database.prepare(`
        INSERT INTO anonymous_user_ips (anonymous_user_id, ip, first_seen_at, last_seen_at, request_count)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(anonymous_user_id, ip) DO UPDATE SET
            last_seen_at = excluded.last_seen_at,
            request_count = anonymous_user_ips.request_count + 1
    `).run(userId, ip, timestamp, timestamp);
});

function identifyAnonymousUser(req, res, next) {
    let userId = readCookie(req, 'vtp.uid');
    const hasUserCookie = isValidAnonymousToken(userId, 'u');
    if (!hasUserCookie) userId = `u_${randomUUID()}`;

    let anonymousSessionId = readCookie(req, 'vtp.anon.sid');
    let hasSessionCookie = isValidAnonymousToken(anonymousSessionId, 's');
    if (!hasSessionCookie) anonymousSessionId = `s_${randomUUID()}`;

    let anonymousSessionKey = hashAnonymousSessionId(anonymousSessionId);
    const existingSession = hasSessionCookie ? getAnonymousSession.get(anonymousSessionKey) : null;
    if (existingSession && existingSession.anonymous_user_id !== userId) {
        anonymousSessionId = `s_${randomUUID()}`;
        anonymousSessionKey = hashAnonymousSessionId(anonymousSessionId);
        hasSessionCookie = false;
    }

    try {
        const timestamp = new Date().toISOString();
        recordAnonymousActivity(userId, anonymousSessionKey, req.clientIp || getClientIp(req), timestamp);

        if (!hasUserCookie) {
            res.cookie('vtp.uid', userId, {
                ...anonymousCookieOptions,
                maxAge: 365 * 24 * 60 * 60 * 1000,
            });
        }
        if (!hasSessionCookie) {
            res.cookie('vtp.anon.sid', anonymousSessionId, anonymousCookieOptions);
        }
        req.anonymousUserId = userId;
        req.anonymousSessionId = anonymousSessionId;
        next();
    } catch (error) {
        next(error);
    }
}

function blockIfIpBlocked(req, res, next) {
    const ip = getClientIp(req);
    const control = database.prepare('SELECT blocked FROM ip_controls WHERE ip = ?').get(ip);
    if (control?.blocked) {
        return res.status(403).type('text').send('Địa chỉ IP này đã bị chặn. Vui lòng liên hệ quản trị viên.');
    }
    req.clientIp = ip;
    next();
}

function getAdminUser(req) {
    if (!req.session.user) return null;
    const user = database.prepare('SELECT id, username, role, active FROM users WHERE id = ?')
        .get(req.session.user.id);
    if (!user?.active || user.role !== 'admin') {
        req.session.destroy(() => {});
        return null;
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    return user;
}

function getInventoryUser(req) {
    const token = readCookie(req, 'vtp.kiemke.sid');
    if (!token) return null;
    const tokenHash = hashInventorySessionToken(token);
    const user = database.prepare(`
        SELECT u.id, u.username
        FROM inventory_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
            AND u.role = 'operator' AND u.active = 1
    `).get(tokenHash, Date.now());
    if (!user) {
        database.prepare('DELETE FROM inventory_sessions WHERE expires_at <= ?').run(Date.now());
        return null;
    }
    req.inventorySessionHash = tokenHash;
    return user;
}

function requireInventoryUser(req, res, next) {
    const user = getInventoryUser(req);
    if (!user) return res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản kiểm kê.' });
    req.inventoryUser = user;
    next();
}

function revokeInventorySessions(userId) {
    database.prepare('DELETE FROM inventory_sessions WHERE user_id = ?').run(userId);
}

function logSessionDebug(req, route) {
    const hasSessionCookie = (req.headers.cookie || '').split(';')
        .some(cookie => cookie.trim().startsWith('vtp.sid='));
    console.log(`[SESSION DEBUG] ${route} cookie=${hasSessionCookie} secure=${req.secure} proto=${req.get('X-Forwarded-Proto') || 'none'} sessionUser=${Boolean(req.session?.user)} NODE_ENV=${process.env.NODE_ENV || 'undefined'}`);
}

function requireAdmin(req, res, next) {
    if (!getAdminUser(req)) {
        return res.status(401).json({ error: 'Vui lòng đăng nhập bằng tài khoản quản trị.' });
    }
    next();
}

function getText(req, res) {
    const text = req.query.text;
    if (typeof text !== 'string' || text.length === 0 || text.length > maxTextLength) {
        res.status(400).send('Vui lòng cung cấp nội dung hợp lệ (tối đa 512 ký tự).');
        return null;
    }
    return text;
}

function validateGeographyName(name) {
    return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 80;
}

function readGeography(includeHidden = false) {
    const districtFilter = includeHidden ? '' : 'WHERE is_hidden = 0';
    const communeFilter = includeHidden ? '' : 'AND is_hidden = 0';
    const villageFilter = includeHidden ? '' : 'AND is_hidden = 0';
    const districts = database.prepare(`
        SELECT id, name, kind, is_hidden FROM districts ${districtFilter}
        ORDER BY kind, name COLLATE NOCASE
    `).all();
    const getCommunes = database.prepare(`
        SELECT id, name, is_hidden FROM communes WHERE district_id = ? ${communeFilter}
        ORDER BY name COLLATE NOCASE
    `);
    const getVillages = database.prepare(`
        SELECT id, name, is_hidden FROM villages
        WHERE commune_id = ? ${villageFilter}
        ORDER BY name COLLATE NOCASE
    `);
    return districts.map(district => ({
        ...district,
        communes: getCommunes.all(district.id).map(commune => ({
            ...commune,
            villages: getVillages.all(commune.id),
        })),
    }));
}

function readFormFields() {
    return database.prepare(`
        SELECT field_key AS key, label, input_type AS inputType,
            visible, default_value AS defaultValue, sort_order AS sortOrder
        FROM form_fields ORDER BY sort_order
    `).all();
}

function parseFieldValues(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

app.get('/login', (req, res) => res.redirect('/admin'));

app.get(['/', '/index.html'], blockIfIpBlocked, identifyAnonymousUser, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/ketqua.html', blockIfIpBlocked, identifyAnonymousUser, (req, res) => {
    res.sendFile(path.join(__dirname, 'ketqua.html'));
});

app.get('/admin', (req, res) => {
    logSessionDebug(req, '/admin');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get(['/home.css', '/ketqua.css', '/login.css', '/admin.css', '/login.js', '/admin.js', '/a7.svg'], (req, res) => {
    res.sendFile(path.join(__dirname, req.path.slice(1)));
});

app.get('/kiemke', blockIfIpBlocked, identifyAnonymousUser, (req, res) => {
    res.sendFile(path.join(__dirname, 'kiemke.html'));
});

app.get(['/kiemke.css', '/kiemke.js'], (req, res) => {
    res.sendFile(path.join(__dirname, req.path.slice(1)));
});

app.post('/api/login', loginRateLimit, async (req, res) => {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const user = database.prepare(`
        SELECT id, username, password_hash, role, active FROM users WHERE username = ?
    `).get(username);

    if (!user || user.role !== 'admin' || !user.active || !await bcrypt.compare(password, user.password_hash)) {
        return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }

    await new Promise((resolve, reject) => {
        req.session.regenerate(error => error ? reject(error) : resolve());
    });
    req.session.user = { id: user.id, username: user.username, role: user.role };
    await new Promise((resolve, reject) => {
        req.session.save(error => error ? reject(error) : resolve());
    });
    res.json({ username: user.username });
});

app.post('/api/logout', requireAdmin, (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie('vtp.sid', { httpOnly: true, sameSite: 'lax' });
        res.sendStatus(204);
    });
});

app.get('/api/kiemke/me', requireInventoryUser, (req, res) => {
    res.json({ id: req.inventoryUser.id, username: req.inventoryUser.username });
});

app.post('/api/kiemke/login', blockIfIpBlocked, inventoryLoginRateLimit, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = database.prepare(`
        SELECT id, username, password_hash, active, disabled_reason FROM users
        WHERE username = ? AND role = 'operator'
    `).get(username);

    if (!user || !await bcrypt.compare(password, user.password_hash)) {
        return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
    }
    if (!user.active) {
        return res.status(403).json({
            code: 'ACCOUNT_DISABLED',
            error: 'Tài khoản kiểm kê đã bị khóa.',
            reason: user.disabled_reason || 'Vui lòng liên hệ quản trị viên.',
        });
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    database.prepare(`
        INSERT INTO inventory_sessions (token_hash, user_id, expires_at, created_at)
        VALUES (?, ?, ?, ?)
    `).run(hashInventorySessionToken(token), user.id, expiresAt, new Date().toISOString());
    res.cookie('vtp.kiemke.sid', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
    });
    res.json({ id: user.id, username: user.username });
});

app.post('/api/kiemke/logout', requireInventoryUser, (req, res) => {
    database.prepare('DELETE FROM inventory_sessions WHERE token_hash = ?').run(req.inventorySessionHash);
    res.clearCookie('vtp.kiemke.sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
    });
    res.sendStatus(204);
});

app.post('/api/history', blockIfIpBlocked, identifyAnonymousUser, generationRateLimit, (req, res) => {
    pruneGeneratedCodeHistory();
    const { barcode, chonHuyen, chonXa, chonThon, fields: submittedFields = {} } = req.body || {};
    if (typeof barcode !== 'string' || barcode.trim().length === 0 || barcode.length > maxTextLength) {
        return res.status(400).json({ error: 'Mã vạch không hợp lệ.' });
    }

    const locationValues = [chonHuyen, chonXa, chonThon];
    if (locationValues.some(value => typeof value !== 'string' || value.length > 120)) {
        return res.status(400).json({ error: 'Thông tin địa chỉ không hợp lệ.' });
    }

    const fields = Object.fromEntries(readFormFields().map(field => {
        const submittedValue = submittedFields && typeof submittedFields[field.key] === 'string'
            ? submittedFields[field.key].slice(0, 160)
            : field.defaultValue;
        return [field.key, field.visible ? submittedValue : field.defaultValue];
    }));

    const result = database.prepare(`
        INSERT INTO history (ip, barcode, district, commune, village, field_values, created_at, anonymous_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.clientIp,
        barcode.trim(),
        chonHuyen,
        chonXa,
        chonThon,
        JSON.stringify(fields),
        new Date().toISOString(),
        req.anonymousUserId,
    );

    res.status(201).json({ id: result.lastInsertRowid, fields });
});

app.post('/api/kiemke', blockIfIpBlocked, identifyAnonymousUser, requireInventoryUser, generationRateLimit, async (req, res) => {
    const waybill = req.body?.waybill;
    if (typeof waybill !== 'string' || waybill.trim().length === 0 || waybill.length > maxTextLength) {
        return res.status(400).json({ error: 'Mã vận đơn không hợp lệ.' });
    }

    let qrCode;
    try {
        qrCode = await QRCode.toDataURL(waybill.trim(), { width: 260, margin: 1 });
    } catch {
        return res.status(400).json({ error: 'Không thể tạo QR từ mã vận đơn này.' });
    }

    pruneGeneratedCodeHistory();
    const result = database.prepare(`
        INSERT INTO inventory_history (ip, waybill, created_at, anonymous_user_id, created_by_user_id)
        VALUES (?, ?, ?, ?, ?)
    `).run(req.clientIp, waybill.trim(), new Date().toISOString(), req.anonymousUserId, req.inventoryUser.id);

    res.status(201).json({ id: result.lastInsertRowid, qrCode });
});

app.get('/api/barcode', blockIfIpBlocked, identifyAnonymousUser, generationRateLimit, async (req, res) => {
    const text = getText(req, res);
    if (text === null) return;

    try {
        const image = await bwipjs.toBuffer({
            bcid: 'code128',
            text,
            scale: 3,
            height: 12,
            includetext: false,
        });
        res.type('png').send(image);
    } catch {
        res.status(400).send('Không thể tạo mã vạch từ nội dung đã nhập.');
    }
});

app.get('/api/qrcode', blockIfIpBlocked, identifyAnonymousUser, generationRateLimit, async (req, res) => {
    const text = getText(req, res);
    if (text === null) return;

    try {
        const image = await QRCode.toBuffer(text, { width: 150, margin: 1 });
        res.type('png').send(image);
    } catch {
        res.status(400).send('Không thể tạo mã QR từ nội dung đã nhập.');
    }
});

app.get('/api/admin/me', (req, res, next) => {
    logSessionDebug(req, '/api/admin/me');
    next();
}, requireAdmin, (req, res) => {
    res.json({ username: req.session.user.username });
});

app.get('/api/geography', blockIfIpBlocked, identifyAnonymousUser, (req, res) => {
    res.json(readGeography());
});

app.get('/api/form-fields', blockIfIpBlocked, identifyAnonymousUser, (req, res) => {
    res.json(readFormFields());
});

app.get('/api/admin/geography', requireAdmin, (req, res) => {
    res.json(readGeography(true));
});

app.get('/api/admin/form-fields', requireAdmin, (req, res) => {
    res.json(readFormFields());
});

app.put('/api/admin/form-fields/:key', requireAdmin, (req, res) => {
    const { label, visible, defaultValue } = req.body || {};
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 60
        || typeof visible !== 'boolean'
        || typeof defaultValue !== 'string' || defaultValue.length > 160) {
        return res.status(400).json({ error: 'Nhãn, trạng thái hiển thị hoặc giá trị mặc định không hợp lệ.' });
    }

    const field = database.prepare('SELECT input_type FROM form_fields WHERE field_key = ?')
        .get(req.params.key);
    if (!field) return res.status(404).json({ error: 'Không tìm thấy trường nhập liệu.' });
    if (field.input_type === 'number' && defaultValue !== '' && !/^-?\d+(\.\d+)?$/.test(defaultValue)) {
        return res.status(400).json({ error: 'Giá trị mặc định của trường số phải là số hợp lệ.' });
    }

    database.prepare(`
        UPDATE form_fields SET label = ?, visible = ?, default_value = ? WHERE field_key = ?
    `).run(label.trim(), visible ? 1 : 0, defaultValue, req.params.key);
    res.sendStatus(204);
});

app.post('/api/admin/districts', requireAdmin, (req, res) => {
    const { name, kind } = req.body || {};
    if (!validateGeographyName(name) || !['city', 'district'].includes(kind)) {
        return res.status(400).json({ error: 'Tên hoặc loại đơn vị hành chính không hợp lệ.' });
    }

    try {
        const result = database.prepare(`
            INSERT INTO districts (name, kind, created_at) VALUES (?, ?, ?)
        `).run(name.trim(), kind, new Date().toISOString());
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Tên thành phố/huyện đã tồn tại.' });
        }
        throw error;
    }
});

app.put('/api/admin/districts/:id', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { name, kind } = req.body || {};
    if (!Number.isInteger(id) || !validateGeographyName(name) || !['city', 'district'].includes(kind)) {
        return res.status(400).json({ error: 'Thông tin thành phố/huyện không hợp lệ.' });
    }

    try {
        const result = database.prepare('UPDATE districts SET name = ?, kind = ? WHERE id = ?')
            .run(name.trim(), kind, id);
        if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy thành phố/huyện.' });
        res.sendStatus(204);
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Tên thành phố/huyện đã tồn tại.' });
        }
        throw error;
    }
});

app.delete('/api/admin/districts/:id', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Mã thành phố/huyện không hợp lệ.' });
    const result = database.prepare('DELETE FROM districts WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy thành phố/huyện.' });
    res.sendStatus(204);
});

app.post('/api/admin/communes', requireAdmin, (req, res) => {
    const { name, districtId } = req.body || {};
    const parentId = Number.parseInt(districtId, 10);
    if (!validateGeographyName(name) || !Number.isInteger(parentId)) {
        return res.status(400).json({ error: 'Tên xã hoặc thành phố/huyện không hợp lệ.' });
    }

    try {
        const result = database.prepare(`
            INSERT INTO communes (district_id, name, created_at) VALUES (?, ?, ?)
        `).run(parentId, name.trim(), new Date().toISOString());
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            return res.status(404).json({ error: 'Không tìm thấy thành phố/huyện đã chọn.' });
        }
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Xã này đã tồn tại trong thành phố/huyện đã chọn.' });
        }
        throw error;
    }
});

app.put('/api/admin/communes/:id', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { name, districtId } = req.body || {};
    const parentId = Number.parseInt(districtId, 10);
    if (!Number.isInteger(id) || !validateGeographyName(name) || !Number.isInteger(parentId)) {
        return res.status(400).json({ error: 'Thông tin xã không hợp lệ.' });
    }

    try {
        const result = database.prepare('UPDATE communes SET name = ?, district_id = ? WHERE id = ?')
            .run(name.trim(), parentId, id);
        if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy xã.' });
        res.sendStatus(204);
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            return res.status(404).json({ error: 'Không tìm thấy thành phố/huyện đã chọn.' });
        }
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Xã này đã tồn tại trong thành phố/huyện đã chọn.' });
        }
        throw error;
    }
});

app.delete('/api/admin/communes/:id', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Mã xã không hợp lệ.' });
    const result = database.prepare('DELETE FROM communes WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy xã.' });
    res.sendStatus(204);
});

app.patch('/api/admin/districts/:id/visibility', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const hidden = req.body?.hidden;
    if (!Number.isInteger(id) || typeof hidden !== 'boolean') {
        return res.status(400).json({ error: 'Trạng thái hiển thị không hợp lệ.' });
    }
    const result = database.prepare('UPDATE districts SET is_hidden = ? WHERE id = ?')
        .run(hidden ? 1 : 0, id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy thành phố/huyện.' });
    res.sendStatus(204);
});

app.patch('/api/admin/communes/:id/visibility', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const hidden = req.body?.hidden;
    if (!Number.isInteger(id) || typeof hidden !== 'boolean') {
        return res.status(400).json({ error: 'Trạng thái hiển thị không hợp lệ.' });
    }
    const result = database.prepare('UPDATE communes SET is_hidden = ? WHERE id = ?')
        .run(hidden ? 1 : 0, id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy xã.' });
    res.sendStatus(204);
});

app.post('/api/admin/villages', requireAdmin, (req, res) => {
    const communeId = Number.parseInt(req.body?.communeId, 10);
    const name = req.body?.name;
    if (!Number.isInteger(communeId) || !validateGeographyName(name)) {
        return res.status(400).json({ error: 'Tên thôn hoặc xã không hợp lệ.' });
    }

    try {
        const result = database.prepare(`
            INSERT INTO villages (commune_id, name, created_at)
            VALUES (?, ?, ?)
        `).run(communeId, name.trim(), new Date().toISOString());
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            return res.status(404).json({ error: 'Không tìm thấy xã đã chọn.' });
        }
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Thôn này đã tồn tại trong xã đã chọn.' });
        }
        throw error;
    }
});

app.put('/api/admin/villages/:id', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const communeId = Number.parseInt(req.body?.communeId, 10);
    const name = req.body?.name;
    if (!Number.isInteger(id) || !Number.isInteger(communeId) || !validateGeographyName(name)) {
        return res.status(400).json({ error: 'Thông tin thôn không hợp lệ.' });
    }

    try {
        const result = database.prepare('UPDATE villages SET name = ?, commune_id = ? WHERE id = ?')
            .run(name.trim(), communeId, id);
        if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy thôn.' });
        res.sendStatus(204);
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            return res.status(404).json({ error: 'Không tìm thấy xã đã chọn.' });
        }
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Thôn này đã tồn tại trong xã đã chọn.' });
        }
        throw error;
    }
});

app.delete('/api/admin/villages/:id', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Mã thôn không hợp lệ.' });
    const result = database.prepare('DELETE FROM villages WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy thôn.' });
    res.sendStatus(204);
});

app.patch('/api/admin/villages/:id/visibility', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const hidden = req.body?.hidden;
    if (!Number.isInteger(id) || typeof hidden !== 'boolean') {
        return res.status(400).json({ error: 'Trạng thái hiển thị thôn không hợp lệ.' });
    }
    const result = database.prepare('UPDATE villages SET is_hidden = ? WHERE id = ?')
        .run(hidden ? 1 : 0, id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy thôn.' });
    res.sendStatus(204);
});

app.get('/api/admin/history', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const values = [];
    let where = '';

    if (search) {
        where = `WHERE h.ip LIKE ? OR c.label LIKE ? OR h.barcode LIKE ?
            OR h.district LIKE ? OR h.commune LIKE ? OR h.village LIKE ?
            OR h.legacy_username LIKE ? OR h.anonymous_user_id LIKE ?`;
        const query = `%${search}%`;
        values.push(query, query, query, query, query, query, query, query);
    }

    const total = database.prepare(`
        SELECT COUNT(*) AS count FROM history h
        LEFT JOIN ip_controls c ON c.ip = h.ip ${where}
    `).get(...values).count;
    const rows = database.prepare(`
        SELECT h.id, h.ip, h.anonymous_user_id, COALESCE(c.label, '') AS ip_label,
            h.legacy_username, h.barcode, h.district, h.commune, h.village,
            h.field_values, h.created_at
        FROM history h
        LEFT JOIN ip_controls c ON c.ip = h.ip
        ${where}
        ORDER BY h.id DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit)
        .map(({ field_values: fieldValues, ...row }) => ({ ...row, fields: parseFieldValues(fieldValues) }));

    const generatedCodeTotal = database.prepare(`
        SELECT (SELECT COUNT(*) FROM history) + (SELECT COUNT(*) FROM inventory_history) AS count
    `).get().count;
    res.json({ rows, total, generatedCodeTotal, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/api/admin/created-codes', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const ip = typeof req.query.ip === 'string' ? req.query.ip : '';
    const anonymousUserId = typeof req.query.anonymousUserId === 'string' ? req.query.anonymousUserId : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    if (ip && ip !== 'unknown' && !net.isIP(ip)) {
        return res.status(400).json({ error: 'Địa chỉ IP không hợp lệ.' });
    }
    if (anonymousUserId && !isValidAnonymousToken(anonymousUserId, 'u')) {
        return res.status(400).json({ error: 'Anonymous user ID không hợp lệ.' });
    }

    const conditions = [];
    const values = [];
    if (ip) { conditions.push('ip = ?'); values.push(ip); }
    if (anonymousUserId) { conditions.push('anonymous_user_id = ?'); values.push(anonymousUserId); }
    if (search) {
        conditions.push('(code LIKE ? OR ip LIKE ? OR creator_username LIKE ? OR anonymous_user_id LIKE ?)');
        const query = `%${search}%`;
        values.push(query, query, query, query);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const codes = `
        SELECT id, 'tem' AS code_type, barcode AS code, ip, anonymous_user_id,
            COALESCE(legacy_username, '') AS creator_username,
            district, commune, village, created_at
        FROM history
        UNION ALL
        SELECT ih.id, 'kiểm kê' AS code_type, ih.waybill AS code, ih.ip, ih.anonymous_user_id,
            COALESCE(u.username, '') AS creator_username,
            '' AS district, '' AS commune, '' AS village, ih.created_at
        FROM inventory_history ih
        LEFT JOIN users u ON u.id = ih.created_by_user_id
    `;
    const total = database.prepare(`WITH codes AS (${codes}) SELECT COUNT(*) AS count FROM codes ${where}`)
        .get(...values).count;
    const rows = database.prepare(`
        WITH codes AS (${codes})
        SELECT id, code_type, code, ip, anonymous_user_id, creator_username,
            district, commune, village, created_at
        FROM codes ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit);

    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/api/admin/kiemke-history', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const values = [];
    let where = '';

    if (search) {
        where = 'WHERE ih.waybill LIKE ? OR ih.ip LIKE ? OR u.username LIKE ?';
        const query = `%${search}%`;
        values.push(query, query, query);
    }

    const total = database.prepare(`
        SELECT COUNT(*) AS count
        FROM inventory_history ih
        LEFT JOIN users u ON u.id = ih.created_by_user_id
        ${where}
    `)
        .get(...values).count;
    const rows = database.prepare(`
        SELECT ih.id, ih.ip, ih.waybill, ih.created_at, ih.anonymous_user_id,
            ih.created_by_user_id, u.username AS creator_username
        FROM inventory_history ih
        LEFT JOIN users u ON u.id = ih.created_by_user_id
        ${where}
        ORDER BY ih.id DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit);

    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/api/admin/anonymous-users', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const values = [];
    let where = '';

    if (search) {
        where = `WHERE u.id LIKE ? OR EXISTS (
            SELECT 1 FROM anonymous_user_ips ui
            WHERE ui.anonymous_user_id = u.id AND ui.ip LIKE ?
        )`;
        const query = `%${search}%`;
        values.push(query, query);
    }

    const total = database.prepare(`SELECT COUNT(*) AS count FROM anonymous_users u ${where}`)
        .get(...values).count;
    const users = database.prepare(`
        SELECT u.id, u.first_seen_at, u.last_seen_at,
            (SELECT COUNT(*) FROM anonymous_sessions s WHERE s.anonymous_user_id = u.id) AS session_count,
            (SELECT COUNT(*) FROM anonymous_user_ips ui WHERE ui.anonymous_user_id = u.id) AS ip_count,
            (SELECT COUNT(*) FROM history h WHERE h.anonymous_user_id = u.id) AS history_count,
            (SELECT COUNT(*) FROM inventory_history ih WHERE ih.anonymous_user_id = u.id) AS inventory_count
        FROM anonymous_users u ${where}
        ORDER BY u.last_seen_at DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit)
        .map(row => ({ ...row, generated_code_count: row.history_count + row.inventory_count }));
    const userIds = users.map(user => user.id);
    const ipsByUser = new Map(userIds.map(userId => [userId, []]));
    if (userIds.length > 0) {
        const placeholders = userIds.map(() => '?').join(', ');
        const ips = database.prepare(`
            SELECT anonymous_user_id, ip
            FROM anonymous_user_ips
            WHERE anonymous_user_id IN (${placeholders})
            ORDER BY last_seen_at DESC
        `).all(...userIds);
        for (const entry of ips) ipsByUser.get(entry.anonymous_user_id).push(entry.ip);
    }
    const rows = users.map(user => ({ ...user, ips: ipsByUser.get(user.id) }));

    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/api/admin/anonymous-users/:id', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    if (!isValidAnonymousToken(req.params.id, 'u')) {
        return res.status(400).json({ error: 'Anonymous user ID không hợp lệ.' });
    }

    const user = database.prepare(`
        SELECT id, first_seen_at, last_seen_at FROM anonymous_users WHERE id = ?
    `).get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy anonymous user.' });

    const ips = database.prepare(`
        SELECT ip, first_seen_at, last_seen_at, request_count
        FROM anonymous_user_ips
        WHERE anonymous_user_id = ?
        ORDER BY last_seen_at DESC
    `).all(user.id);
    const sessions = database.prepare(`
        SELECT first_seen_at, last_seen_at
        FROM anonymous_sessions
        WHERE anonymous_user_id = ?
        ORDER BY last_seen_at DESC
    `).all(user.id);
    const historyCount = database.prepare('SELECT COUNT(*) AS count FROM history WHERE anonymous_user_id = ?')
        .get(user.id).count;
    const inventoryCount = database.prepare('SELECT COUNT(*) AS count FROM inventory_history WHERE anonymous_user_id = ?')
        .get(user.id).count;

    res.json({
        ...user,
        ips,
        sessions,
        history_count: historyCount,
        inventory_count: inventoryCount,
        generated_code_count: historyCount + inventoryCount,
    });
});

app.get('/api/admin/inventory-accounts', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const where = search ? "WHERE u.role = 'operator' AND u.username LIKE ?" : "WHERE u.role = 'operator'";
    const values = search ? [`%${search}%`] : [];
    const total = database.prepare(`SELECT COUNT(*) AS count FROM users u ${where}`).get(...values).count;
    const rows = database.prepare(`
        SELECT u.id, u.username, u.active, u.disabled_reason, u.created_at,
            COUNT(ih.id) AS order_count, MAX(ih.created_at) AS last_seen
        FROM users u
        LEFT JOIN inventory_history ih ON ih.created_by_user_id = u.id
        ${where}
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit);

    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/api/admin/inventory-accounts/:id/orders', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const userId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Mã tài khoản không hợp lệ.' });
    const account = database.prepare("SELECT id FROM users WHERE id = ? AND role = 'operator'").get(userId);
    if (!account) return res.status(404).json({ error: 'Không tìm thấy tài khoản kiểm kê.' });

    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const timezoneOffset = Number.parseInt(req.query.timezoneOffset, 10) || 0;
    const parseDateBoundary = value => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const utcDate = new Date(`${value}T00:00:00.000Z`);
        if (Number.isNaN(utcDate.getTime()) || utcDate.toISOString().slice(0, 10) !== value) return null;
        return new Date(utcDate.getTime() + timezoneOffset * 60 * 1000);
    };
    if (Math.abs(timezoneOffset) > 14 * 60) {
        return res.status(400).json({ error: 'Múi giờ không hợp lệ.' });
    }

    const fromDate = from ? parseDateBoundary(from) : null;
    const toDate = to ? parseDateBoundary(to) : null;
    if ((from && !fromDate) || (to && !toDate)) {
        return res.status(400).json({ error: 'Ngày lọc không hợp lệ.' });
    }
    const toExclusive = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : null;
    if (fromDate && toExclusive && fromDate >= toExclusive) {
        return res.status(400).json({ error: 'Khoảng ngày lọc không hợp lệ.' });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const conditions = ['created_by_user_id = ?', 'created_at >= ?'];
    const values = [userId, new Date(Date.now() - generatedCodeRetentionMs).toISOString()];
    if (fromDate) {
        conditions.push('created_at >= ?');
        values.push(fromDate.toISOString());
    }
    if (toExclusive) {
        conditions.push('created_at < ?');
        values.push(toExclusive.toISOString());
    }
    const where = conditions.join(' AND ');
    const total = database.prepare(`SELECT COUNT(*) AS count FROM inventory_history WHERE ${where}`)
        .get(...values).count;
    const rows = database.prepare(`
        SELECT id, waybill, ip, created_at
        FROM inventory_history
        WHERE ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit);

    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.post('/api/admin/inventory-accounts', requireAdmin, (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!/^[a-z0-9._-]{3,32}$/.test(username)
        || password.length < 6
        || Buffer.byteLength(password, 'utf8') > 72) {
        return res.status(400).json({ error: 'Tên đăng nhập phải từ 3-32 ký tự; mật khẩu từ 6 ký tự và tối đa 72 byte.' });
    }

    try {
        const result = database.prepare(`
            INSERT INTO users (username, password_hash, role, active, created_at)
            VALUES (?, ?, 'operator', 1, ?)
        `).run(username, bcrypt.hashSync(password, 12), new Date().toISOString());
        res.status(201).json({ id: result.lastInsertRowid, username });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại.' });
        }
        throw error;
    }
});

app.patch('/api/admin/inventory-accounts/:id', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const { active, reason = '' } = req.body || {};
    if (!Number.isInteger(id) || typeof active !== 'boolean'
        || typeof reason !== 'string' || reason.trim().length > 500
        || (!active && !reason.trim())) {
        return res.status(400).json({ error: 'Tài khoản hoặc trạng thái không hợp lệ.' });
    }

    const result = database.prepare(`
        UPDATE users SET active = ?, disabled_reason = ? WHERE id = ? AND role = 'operator'
    `).run(active ? 1 : 0, active ? '' : reason.trim(), id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản kiểm kê.' });
    if (!active) revokeInventorySessions(id);
    res.sendStatus(204);
});

app.put('/api/admin/inventory-accounts/:id/password', requireAdmin, (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!Number.isInteger(id) || password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) {
        return res.status(400).json({ error: 'Mật khẩu phải từ 6 ký tự và tối đa 72 byte.' });
    }

    const result = database.prepare(`
        UPDATE users SET password_hash = ? WHERE id = ? AND role = 'operator'
    `).run(bcrypt.hashSync(password, 12), id);
    if (result.changes === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản kiểm kê.' });
    revokeInventorySessions(id);
    res.sendStatus(204);
});

app.get('/api/admin/ips', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const rows = database.prepare(`
        WITH codes AS (
            SELECT ip, created_at FROM history
            UNION ALL
            SELECT ip, created_at FROM inventory_history
        )
        SELECT codes.ip, COALESCE(c.label, '') AS label,
            COALESCE(c.blocked, 0) AS blocked, COUNT(*) AS code_count,
            MAX(codes.created_at) AS last_seen
        FROM codes
        LEFT JOIN ip_controls c ON c.ip = codes.ip
        GROUP BY codes.ip
        ORDER BY blocked DESC, last_seen DESC
    `).all();
    res.json(rows);
});

app.get('/api/admin/ips/:ip/history', requireAdmin, (req, res) => {
    pruneGeneratedCodeHistory();
    const ip = req.params.ip;
    if (ip !== 'unknown' && !net.isIP(ip)) {
        return res.status(400).json({ error: 'Địa chỉ IP không hợp lệ.' });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const total = database.prepare('SELECT COUNT(*) AS count FROM history WHERE ip = ?').get(ip).count;
    const rows = database.prepare(`
        SELECT id, barcode, district, commune, village, field_values, created_at
        FROM history
        WHERE ip = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `).all(ip, limit, (page - 1) * limit)
        .map(({ field_values: fieldValues, ...row }) => ({ ...row, fields: parseFieldValues(fieldValues) }));

    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.put('/api/admin/ips', requireAdmin, (req, res) => {
    const { ip, label, blocked } = req.body || {};
    if (typeof ip !== 'string' || !net.isIP(ip) || ip !== ip.trim()) {
        return res.status(400).json({ error: 'Địa chỉ IP không hợp lệ.' });
    }
    if (typeof label !== 'string' || label.trim().length > 80 || typeof blocked !== 'boolean') {
        return res.status(400).json({ error: 'Tên gợi nhớ hoặc trạng thái chặn không hợp lệ.' });
    }

    database.prepare(`
        INSERT INTO ip_controls (ip, label, blocked, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(ip) DO UPDATE SET
            label = excluded.label,
            blocked = excluded.blocked,
            updated_at = excluded.updated_at
    `).run(ip, label.trim(), blocked ? 1 : 0, new Date().toISOString());
    res.sendStatus(204);
});

app.listen(port, () => {
    console.log(`Ứng dụng đang chạy tại http://localhost:${port}`);
});