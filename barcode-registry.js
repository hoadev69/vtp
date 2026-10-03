const REGISTRY_MIGRATION_KEY = 'barcode_registry_v1';

function canonicalizeBarcode(value) {
    return typeof value === 'string' ? value.trim() : null;
}

function hasTable(database, tableName) {
    return Boolean(database.prepare(`
        SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(tableName));
}

function applyBarcodeRegistryMigration(database, registeredAt = new Date().toISOString()) {
    if (!hasTable(database, 'history') || !hasTable(database, 'app_settings')) {
        throw new Error('Barcode registry migration requires history and app_settings tables.');
    }
    if (!database.pragma('foreign_keys', { simple: true })) {
        throw new Error('SQLite foreign key enforcement must be enabled before barcode registry migration.');
    }

    const migrate = database.transaction(() => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS barcode_registry (
                barcode TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
                status TEXT NOT NULL CHECK (status IN (
                    'legacy_unique', 'legacy_ambiguous', 'new', 'released'
                )),
                origin TEXT NOT NULL CHECK (origin IN ('legacy', 'new')),
                registered_at TEXT NOT NULL,
                released_at TEXT,
                legacy_history_count INTEGER NOT NULL DEFAULT 0 CHECK (legacy_history_count >= 0),
                CHECK (
                    (status = 'released' AND released_at IS NOT NULL) OR
                    (status != 'released' AND released_at IS NULL)
                )
            );

            CREATE TABLE IF NOT EXISTS barcode_registry_history (
                barcode TEXT COLLATE BINARY NOT NULL,
                history_id INTEGER NOT NULL,
                PRIMARY KEY (barcode, history_id),
                UNIQUE (history_id),
                FOREIGN KEY (barcode)
                    REFERENCES barcode_registry(barcode) ON DELETE CASCADE,
                FOREIGN KEY (history_id)
                    REFERENCES history(id) ON DELETE CASCADE
            );
        `);

        const historyRows = database.prepare('SELECT id, barcode FROM history ORDER BY id').all();
        const groups = new Map();
        for (const row of historyRows) {
            const barcode = canonicalizeBarcode(row.barcode);
            if (!barcode) {
                throw new Error(`Cannot backfill empty or invalid barcode at history row ${row.id}.`);
            }
            if (!groups.has(barcode)) groups.set(barcode, []);
            groups.get(barcode).push(row);
        }

        const findRegistry = database.prepare('SELECT status, origin FROM barcode_registry WHERE barcode = ?');
        const insertLegacy = database.prepare(`
            INSERT INTO barcode_registry (
                barcode, status, origin, registered_at, released_at, legacy_history_count
            ) VALUES (?, ?, 'legacy', ?, NULL, ?)
            ON CONFLICT(barcode) DO NOTHING
        `);
        const updateLegacyClass = database.prepare(`
            UPDATE barcode_registry
            SET status = ?, legacy_history_count = ?
            WHERE barcode = ? AND origin = 'legacy' AND status IN ('legacy_unique', 'legacy_ambiguous')
        `);
        const insertMapping = database.prepare(`
            INSERT INTO barcode_registry_history (barcode, history_id)
            VALUES (?, ?)
            ON CONFLICT(barcode, history_id) DO NOTHING
        `);
        const findMapping = database.prepare('SELECT barcode FROM barcode_registry_history WHERE history_id = ?');

        for (const [barcode, rows] of groups) {
            const status = rows.length === 1 ? 'legacy_unique' : 'legacy_ambiguous';
            const existing = findRegistry.get(barcode);
            if (existing?.status === 'released') {
                throw new Error(`History rows exist for released barcode registry key ${JSON.stringify(barcode)}.`);
            }
            if (!existing) {
                insertLegacy.run(barcode, status, registeredAt, rows.length);
            } else {
                updateLegacyClass.run(status, rows.length, barcode);
            }

            for (const row of rows) {
                insertMapping.run(barcode, row.id);
                const mapping = findMapping.get(row.id);
                if (!mapping || mapping.barcode !== barcode) {
                    throw new Error(`History row ${row.id} is already mapped to a different barcode.`);
                }
            }
        }

        const mappedRows = database.prepare('SELECT COUNT(*) AS count FROM barcode_registry_history').get().count;
        if (mappedRows !== historyRows.length) {
            throw new Error(`Barcode registry backfill mapped ${mappedRows} rows; expected ${historyRows.length}.`);
        }

        const activeWithoutHistory = database.prepare(`
            SELECT r.barcode
            FROM barcode_registry r
            WHERE r.status != 'released'
                AND NOT EXISTS (
                    SELECT 1 FROM barcode_registry_history m WHERE m.barcode = r.barcode
                )
            LIMIT 1
        `).get();
        if (activeWithoutHistory) {
            throw new Error(`Active barcode registry key has no history mapping: ${JSON.stringify(activeWithoutHistory.barcode)}.`);
        }

        database.prepare(`
            INSERT INTO app_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO NOTHING
        `).run(REGISTRY_MIGRATION_KEY, registeredAt);

        return {
            historyCount: historyRows.length,
            registryCount: database.prepare('SELECT COUNT(*) AS count FROM barcode_registry').get().count,
            mappingCount: mappedRows,
            ambiguousCount: database.prepare("SELECT COUNT(*) AS count FROM barcode_registry WHERE status = 'legacy_ambiguous'").get().count,
        };
    });

    return migrate.immediate();
}

function assertBarcodeRegistryReady(database) {
    if (!hasTable(database, 'barcode_registry') || !hasTable(database, 'barcode_registry_history')) {
        throw new Error('Barcode registry is not migrated. Run migrations/20261003_barcode_registry.js before starting the server.');
    }
    const marker = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(REGISTRY_MIGRATION_KEY);
    if (!marker) {
        throw new Error('Barcode registry migration marker is missing. Run the barcode registry migration before starting the server.');
    }
}

function registerHistory(database, rawBarcode, insertHistory, registeredAt = new Date().toISOString()) {
    const barcode = canonicalizeBarcode(rawBarcode);
    if (!barcode) throw new TypeError('A non-empty normalized barcode is required.');

    const register = database.transaction(() => {
        const registration = database.prepare(`
            INSERT INTO barcode_registry (
                barcode, status, origin, registered_at, released_at, legacy_history_count
            ) VALUES (?, 'new', 'new', ?, NULL, 0)
            ON CONFLICT(barcode) DO UPDATE SET
                status = 'new',
                origin = 'new',
                registered_at = excluded.registered_at,
                released_at = NULL,
                legacy_history_count = 0
            WHERE barcode_registry.status = 'released'
        `).run(barcode, registeredAt);

        if (registration.changes === 0) return { duplicate: true };

        const historyResult = insertHistory(barcode);
        const historyId = Number(historyResult.lastInsertRowid);
        database.prepare(`
            INSERT INTO barcode_registry_history (barcode, history_id) VALUES (?, ?)
        `).run(barcode, historyId);
        return { duplicate: false, historyResult, historyId, barcode };
    });

    return register.immediate();
}

function pruneExpiredHistory(database, cutoff) {
    const prune = database.transaction(expiry => {
        const history = database.prepare('DELETE FROM history WHERE created_at < ?').run(expiry);
        const inventory = database.prepare('DELETE FROM inventory_history WHERE created_at < ?').run(expiry);
        const releasedAt = new Date().toISOString();
        const released = database.prepare(`
            UPDATE barcode_registry
            SET status = 'released', released_at = ?
            WHERE status IN ('legacy_unique', 'legacy_ambiguous', 'new')
                AND NOT EXISTS (
                    SELECT 1 FROM barcode_registry_history m WHERE m.barcode = barcode_registry.barcode
                )
                AND NOT EXISTS (
                    SELECT 1 FROM history h WHERE h.barcode = barcode_registry.barcode COLLATE BINARY
                )
        `).run(releasedAt);
        return { historyDeleted: history.changes, inventoryDeleted: inventory.changes, barcodesReleased: released.changes };
    });

    return prune.immediate(cutoff);
}

function resolveBarcodeHistory(database, rawBarcode) {
    const barcode = canonicalizeBarcode(rawBarcode);
    if (!barcode) return { status: 'not_found', barcode: '' , rows: [] };

    const registry = database.prepare(`
        SELECT barcode, status, origin, registered_at, released_at, legacy_history_count
        FROM barcode_registry WHERE barcode = ? COLLATE BINARY
    `).get(barcode);
    if (!registry) return { status: 'not_found', barcode, rows: [] };

    const rows = database.prepare(`
        SELECT h.id, h.ip, h.anonymous_user_id, COALESCE(c.label, '') AS ip_label,
            h.creator_username, h.legacy_username, h.barcode, h.district, h.commune, h.village,
            h.field_values, h.created_at
        FROM barcode_registry_history m
        JOIN history h ON h.id = m.history_id
        LEFT JOIN ip_controls c ON c.ip = h.ip
        WHERE m.barcode = ? COLLATE BINARY
        ORDER BY h.id ASC
    `).all(barcode).map(({ field_values: fieldValues, ...row }) => ({
        ...row,
        fields: parseFieldValues(fieldValues),
    }));

    if (registry.status === 'released' || rows.length === 0) {
        return { status: registry.status === 'released' ? 'released' : 'expired', barcode, rows: [], registry };
    }

    return {
        status: rows.length > 1 ? 'ambiguous' : 'unique',
        barcode,
        rows,
        registry,
    };
}

module.exports = {
    REGISTRY_MIGRATION_KEY,
    applyBarcodeRegistryMigration,
    assertBarcodeRegistryReady,
    canonicalizeBarcode,
    pruneExpiredHistory,
    registerHistory,
    resolveBarcodeHistory,
};

function parseFieldValues(value) {
    try {
        const fields = JSON.parse(value);
        return fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
    } catch {
        return {};
    }
}