require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const path = require('node:path');
const net = require('node:net');
const database = require('./database');

const app = express();
const port = process.env.PORT || 3000;
const adminUsername = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || '';
const maxTextLength = 512;
const trustProxyHops = Math.max(0, Number.parseInt(process.env.TRUST_PROXY_HOPS, 10) || 0);

if (!/^[a-z0-9._-]{3,32}$/.test(adminUsername)
    || adminPassword.length < 12
    || Buffer.byteLength(adminPassword, 'utf8') > 72
    || sessionSecret.length < 32) {
    console.error('Cần ADMIN_USERNAME hợp lệ, ADMIN_PASSWORD từ 12 ký tự và SESSION_SECRET tối thiểu 32 ký tự.');
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
app.use(session({
    name: 'vtp.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000,
    },
}));

function getClientIp(req) {
    let ip = req.ip || req.socket.remoteAddress || '';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return net.isIP(ip) ? ip : 'unknown';
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
    const districts = database.prepare(`
        SELECT id, name, kind, is_hidden FROM districts ${districtFilter}
        ORDER BY kind, name COLLATE NOCASE
    `).all();
    const getCommunes = database.prepare(`
        SELECT id, name, is_hidden FROM communes WHERE district_id = ? ${communeFilter}
        ORDER BY name COLLATE NOCASE
    `);
    return districts.map(district => ({ ...district, communes: getCommunes.all(district.id) }));
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

app.get(['/', '/index.html'], blockIfIpBlocked, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/ketqua.html', blockIfIpBlocked, (req, res) => {
    res.sendFile(path.join(__dirname, 'ketqua.html'));
});

app.get('/admin', (req, res) => {
    const admin = getAdminUser(req);
    res.sendFile(path.join(__dirname, admin ? 'admin.html' : 'login.html'));
});

app.get(['/home.css', '/ketqua.css', '/login.css', '/admin.css', '/login.js', '/admin.js', '/a7.svg'], (req, res) => {
    res.sendFile(path.join(__dirname, req.path.slice(1)));
});

app.post('/api/login', async (req, res) => {
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
    res.json({ username: user.username });
});

app.post('/api/logout', requireAdmin, (req, res, next) => {
    req.session.destroy(error => {
        if (error) return next(error);
        res.clearCookie('vtp.sid', { httpOnly: true, sameSite: 'lax' });
        res.sendStatus(204);
    });
});

app.post('/api/history', blockIfIpBlocked, (req, res) => {
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
        INSERT INTO history (ip, barcode, district, commune, village, field_values, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        req.clientIp,
        barcode.trim(),
        chonHuyen,
        chonXa,
        chonThon,
        JSON.stringify(fields),
        new Date().toISOString(),
    );

    res.status(201).json({ id: result.lastInsertRowid, fields });
});

app.get('/api/barcode', blockIfIpBlocked, async (req, res) => {
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

app.get('/api/qrcode', blockIfIpBlocked, async (req, res) => {
    const text = getText(req, res);
    if (text === null) return;

    try {
        const image = await QRCode.toBuffer(text, { width: 150, margin: 1 });
        res.type('png').send(image);
    } catch {
        res.status(400).send('Không thể tạo mã QR từ nội dung đã nhập.');
    }
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
    res.json({ username: req.session.user.username });
});

app.get('/api/geography', blockIfIpBlocked, (req, res) => {
    res.json(readGeography());
});

app.get('/api/form-fields', blockIfIpBlocked, (req, res) => {
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

app.get('/api/admin/history', requireAdmin, (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = 50;
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';
    const values = [];
    let where = '';

    if (search) {
        where = `WHERE h.ip LIKE ? OR c.label LIKE ? OR h.barcode LIKE ?
            OR h.district LIKE ? OR h.commune LIKE ? OR h.village LIKE ? OR h.legacy_username LIKE ?`;
        const query = `%${search}%`;
        values.push(query, query, query, query, query, query, query);
    }

    const total = database.prepare(`
        SELECT COUNT(*) AS count FROM history h
        LEFT JOIN ip_controls c ON c.ip = h.ip ${where}
    `).get(...values).count;
    const rows = database.prepare(`
        SELECT h.id, h.ip, COALESCE(c.label, '') AS ip_label,
            h.legacy_username, h.barcode, h.district, h.commune, h.village,
            h.field_values, h.created_at
        FROM history h
        LEFT JOIN ip_controls c ON c.ip = h.ip
        ${where}
        ORDER BY h.id DESC
        LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit)
        .map(({ field_values: fieldValues, ...row }) => ({ ...row, fields: parseFieldValues(fieldValues) }));

    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

app.get('/api/admin/ips', requireAdmin, (req, res) => {
    const rows = database.prepare(`
        SELECT h.ip, COALESCE(c.label, '') AS label,
            COALESCE(c.blocked, 0) AS blocked, COUNT(h.id) AS code_count,
            MAX(h.created_at) AS last_seen
        FROM history h
        LEFT JOIN ip_controls c ON c.ip = h.ip
        GROUP BY h.ip
        ORDER BY blocked DESC, last_seen DESC
    `).all();
    res.json(rows);
});

app.get('/api/admin/ips/:ip/history', requireAdmin, (req, res) => {
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