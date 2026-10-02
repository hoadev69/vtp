const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, 'data', 'history.sqlite'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'operator')),
        active INTEGER NOT NULL DEFAULT 1,
        disabled_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ip_controls (
        ip TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        blocked INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS districts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('city', 'district')),
        is_hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS communes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        district_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (district_id, name),
        FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS villages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commune_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (commune_id, name),
        FOREIGN KEY (commune_id) REFERENCES communes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS form_fields (
        field_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        input_type TEXT NOT NULL CHECK (input_type IN ('text', 'tel', 'number')),
        visible INTEGER NOT NULL DEFAULT 1,
        default_value TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anonymous_users (
        id TEXT PRIMARY KEY,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anonymous_sessions (
        id TEXT PRIMARY KEY,
        anonymous_user_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        FOREIGN KEY (anonymous_user_id) REFERENCES anonymous_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anonymous_user_ips (
        anonymous_user_id TEXT NOT NULL,
        ip TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (anonymous_user_id, ip),
        FOREIGN KEY (anonymous_user_id) REFERENCES anonymous_users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        session TEXT NOT NULL,
        expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS inventory_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        waybill TEXT NOT NULL,
        creator_username TEXT,
        anonymous_user_id TEXT,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
    );
`);

const userColumns = database.pragma('table_info(users)');
if (!userColumns.some(column => column.name === 'disabled_reason')) {
    database.exec("ALTER TABLE users ADD COLUMN disabled_reason TEXT NOT NULL DEFAULT ''");
}

for (const [table, column] of [['districts', 'is_hidden'], ['communes', 'is_hidden']]) {
    const columns = database.pragma(`table_info(${table})`);
    if (!columns.some(item => item.name === column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
}

const historyColumns = database.pragma('table_info(history)');
if (historyColumns.length === 0) {
    database.exec(`
        CREATE TABLE history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            barcode TEXT NOT NULL,
            district TEXT NOT NULL,
            commune TEXT NOT NULL,
            village TEXT NOT NULL,
            legacy_username TEXT,
            creator_username TEXT,
            created_at TEXT NOT NULL
        );
    `);
} else if (!historyColumns.some(column => column.name === 'ip')) {
    const legacyHasUsername = historyColumns.some(column => column.name === 'username');
    database.exec(`
        DROP INDEX IF EXISTS history_created_at_idx;
        DROP INDEX IF EXISTS history_user_id_idx;
        ALTER TABLE history RENAME TO history_legacy;
        CREATE TABLE history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            barcode TEXT NOT NULL,
            district TEXT NOT NULL,
            commune TEXT NOT NULL,
            village TEXT NOT NULL,
            legacy_username TEXT,
            creator_username TEXT,
            created_at TEXT NOT NULL
        );
        INSERT INTO history (id, ip, barcode, district, commune, village, legacy_username, created_at)
        SELECT id, 'unknown', barcode, district, commune, village,
            ${legacyHasUsername ? 'username' : 'NULL'}, created_at
        FROM history_legacy;
        DROP TABLE history_legacy;
    `);
}

const currentHistoryColumns = database.pragma('table_info(history)');
if (!currentHistoryColumns.some(column => column.name === 'field_values')) {
    database.exec("ALTER TABLE history ADD COLUMN field_values TEXT NOT NULL DEFAULT '{}'");
}
if (!currentHistoryColumns.some(column => column.name === 'anonymous_user_id')) {
    database.exec('ALTER TABLE history ADD COLUMN anonymous_user_id TEXT');
}
if (!currentHistoryColumns.some(column => column.name === 'creator_username')) {
    database.exec('ALTER TABLE history ADD COLUMN creator_username TEXT');
}

const inventoryHistoryColumns = database.pragma('table_info(inventory_history)');
if (!inventoryHistoryColumns.some(column => column.name === 'anonymous_user_id')) {
    database.exec('ALTER TABLE inventory_history ADD COLUMN anonymous_user_id TEXT');
}
if (!inventoryHistoryColumns.some(column => column.name === 'created_by_user_id')) {
    database.exec('ALTER TABLE inventory_history ADD COLUMN created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
}
if (!inventoryHistoryColumns.some(column => column.name === 'creator_username')) {
    database.exec('ALTER TABLE inventory_history ADD COLUMN creator_username TEXT');
}

database.exec(`
    CREATE INDEX IF NOT EXISTS history_created_at_idx ON history(created_at DESC);
    CREATE INDEX IF NOT EXISTS history_ip_idx ON history(ip);
    CREATE INDEX IF NOT EXISTS history_anonymous_user_idx ON history(anonymous_user_id);
    CREATE INDEX IF NOT EXISTS villages_commune_idx ON villages(commune_id, is_hidden, name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS inventory_history_created_at_idx ON inventory_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS inventory_history_anonymous_user_idx ON inventory_history(anonymous_user_id);
    CREATE INDEX IF NOT EXISTS inventory_history_creator_idx ON inventory_history(created_by_user_id);
    CREATE INDEX IF NOT EXISTS inventory_sessions_user_idx ON inventory_sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS anonymous_sessions_user_idx ON anonymous_sessions(anonymous_user_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS anonymous_user_ips_ip_idx ON anonymous_user_ips(ip);
`);

if (!database.prepare('SELECT 1 FROM app_settings WHERE key = ?').get('geography_seeded')) {
    const seedDistrict = database.prepare(`
        INSERT OR IGNORE INTO districts (name, kind, created_at) VALUES (?, ?, ?)
    `);
    const seedCommune = database.prepare(`
        INSERT OR IGNORE INTO communes (district_id, name, created_at) VALUES (?, ?, ?)
    `);
    const seedGeography = database.transaction(() => {
        const createdAt = new Date().toISOString();
        seedDistrict.run('TP.Lào Cai', 'city', createdAt);
        seedDistrict.run('H.Bảo Thắng', 'district', createdAt);

        const cityId = database.prepare('SELECT id FROM districts WHERE name = ?').get('TP.Lào Cai').id;
        const districtId = database.prepare('SELECT id FROM districts WHERE name = ?').get('H.Bảo Thắng').id;
        seedCommune.run(cityId, 'Thống Nhất', createdAt);
        seedCommune.run(districtId, 'Gia Phú', createdAt);
        seedCommune.run(districtId, 'Xuân Giao', createdAt);
        seedCommune.run(districtId, 'Phú Nhuận', createdAt);
        database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
            .run('geography_seeded', '1');
    });
    seedGeography();
}

if (!database.prepare('SELECT 1 FROM app_settings WHERE key = ?').get('villages_seeded')) {
    const existingVillages = [
        ['H.Bảo Thắng', 'Gia Phú', ['Thôn Nậm Hẻn', 'Thôn Đông Căm', 'Thôn Hùng Thắng', 'Thôn Phú Xuân', 'Thôn Bến Phà', 'Thôn Chính Tiến', 'Thôn Soi Cờ', 'Thôn Soi Giá', 'Thôn Đồng Lục', 'Bản Bay', 'Thôn Xuân Tư']],
        ['TP.Lào Cai', 'Thống Nhất', ['Thôn Hòa Lạc', 'Thôn Thái Bo', 'Thôn Giao Ngay', 'Thôn Giao Tiến', 'Thôn Tiến Cường', 'Thôn Tân Tiến', 'Thôn Tiến Thắng', 'Thôn Muồng', 'Thôn Chang', 'Phú Hùng', 'Thôn Mường Bát', 'Bản Cam', 'Thôn Khe Luộc', 'Thôn Kắp kẹ', 'Thôn An Thành']],
        ['H.Bảo Thắng', 'Xuân Giao', ['Thôn Chành', 'Thôn Hùng Xuân', 'Thôn Tiến Lợi', 'Thôn Giao Bình', 'Thôn Mường', 'Thôn Phẻo', 'Thôn Vàng', 'Thôn Hợp Giao']],
        ['H.Bảo Thắng', 'Phú Nhuận', ['Phú Thịnh 1', 'Phú Thịnh 2', 'Phú Thịnh 3', 'Phú An 1', 'Phú An 2', 'Tân Lập', 'Phú Sơn', 'Làng Đền', 'Khe Bá', 'Phú Hải 2', 'Phú Hải 3', 'Nhuần 2', 'Nhuần 3']],
    ];
    const insertVillage = database.prepare(`
        INSERT OR IGNORE INTO villages (commune_id, name, created_at)
        SELECT c.id, ?, ?
        FROM communes c JOIN districts d ON d.id = c.district_id
        WHERE d.name = ? AND c.name = ?
    `);
    const seedVillages = database.transaction(() => {
        const createdAt = new Date().toISOString();
        for (const [districtName, communeName, villageNames] of existingVillages) {
            for (const villageName of new Set(villageNames)) {
                insertVillage.run(villageName, createdAt, districtName, communeName);
            }
        }
        database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
            .run('villages_seeded', '1');
    });
    seedVillages();
}

    if (!database.prepare('SELECT 1 FROM app_settings WHERE key = ?').get('form_fields_seeded')) {
        const seedFormFields = database.transaction(() => {
            const insertField = database.prepare(`
                INSERT OR IGNORE INTO form_fields (field_key, label, input_type, visible, default_value, sort_order)
                VALUES (?, ?, ?, 1, '', ?)
            `);
            insertField.run('nhapTen', 'Người nhận', 'text', 1);
            insertField.run('nhapSdt', 'Số điện thoại', 'tel', 2);
            insertField.run('soHang', 'Số hàng', 'number', 3);
            insertField.run('tenHang', 'Tên hàng', 'text', 4);
            database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)')
                .run('form_fields_seeded', '1');
        });
        seedFormFields();
    }

module.exports = database;