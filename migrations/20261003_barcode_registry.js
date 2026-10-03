require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { applyBarcodeRegistryMigration } = require('../barcode-registry');

const workspacePath = path.resolve(__dirname, '..');
const expectedDatabasePath = path.join(workspacePath, 'data', 'history.sqlite');
const configuredDatabasePath = path.resolve(process.env.DATABASE_PATH || expectedDatabasePath);

function historyFingerprint(database) {
    const hash = createHash('sha256');
    const rows = database.prepare('SELECT id, barcode FROM history ORDER BY id').iterate();
    let count = 0;
    for (const row of rows) {
        hash.update(JSON.stringify([row.id, row.barcode]));
        hash.update('\n');
        count += 1;
    }
    return { count, sha256: hash.digest('hex') };
}

function backupName() {
    const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
    return path.join(path.dirname(expectedDatabasePath), `history.pre-barcode-${timestamp}.sqlite`);
}

async function main() {
    if (!process.argv.includes('--confirm-local-dev-db')) {
        throw new Error('Pass --confirm-local-dev-db to migrate only the workspace development database.');
    }
    if (process.env.NODE_ENV === 'production' || configuredDatabasePath !== expectedDatabasePath) {
        throw new Error('Refusing migration: target is not the default workspace development database.');
    }
    if (!fs.existsSync(expectedDatabasePath)) {
        throw new Error('Workspace development database does not exist; refusing to create a new database.');
    }

    const backupPath = backupName();
    if (fs.existsSync(backupPath)) throw new Error('Backup file already exists; refusing to overwrite it.');

    const source = new Database(expectedDatabasePath, { readonly: true, fileMustExist: true, timeout: 5000 });
    let before;
    try {
        source.pragma('query_only=ON');
        before = historyFingerprint(source);
        await source.backup(backupPath);
    } finally {
        source.close();
    }
    fs.chmodSync(backupPath, 0o600);

    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
        backup.pragma('query_only=ON');
        const backupFingerprint = historyFingerprint(backup);
        const backupIntegrity = backup.pragma('integrity_check', { simple: true });
        const backupForeignKeys = backup.pragma('foreign_key_check');
        if (backupFingerprint.count !== before.count || backupFingerprint.sha256 !== before.sha256) {
            throw new Error('Backup history fingerprint does not match the source database.');
        }
        if (backupIntegrity !== 'ok' || backupForeignKeys.length !== 0) {
            throw new Error('Backup integrity or foreign key validation failed.');
        }
    } finally {
        backup.close();
    }

    const database = new Database(expectedDatabasePath, { fileMustExist: true, timeout: 10000 });
    database.pragma('foreign_keys=ON');
    database.pragma('busy_timeout=10000');
    try {
        const migrateAndVerify = database.transaction(() => {
            const result = applyBarcodeRegistryMigration(database);
            const after = historyFingerprint(database);
            if (after.count !== before.count || after.sha256 !== before.sha256) {
                throw new Error('History rows changed during barcode registry migration.');
            }
            const integrity = database.pragma('integrity_check', { simple: true });
            const foreignKeys = database.pragma('foreign_key_check');
            if (integrity !== 'ok' || foreignKeys.length !== 0) {
                throw new Error('Database integrity validation failed inside migration transaction.');
            }
            return { ...result, historySha256: after.sha256, integrity, foreignKeyViolations: foreignKeys.length };
        });
        const result = migrateAndVerify.immediate();
        console.log(JSON.stringify({
            target: expectedDatabasePath,
            backup: backupPath,
            backupBytes: fs.statSync(backupPath).size,
            backupSha256: createHash('sha256').update(fs.readFileSync(backupPath)).digest('hex'),
            backupHistoryCount: before.count,
            backupHistoryFingerprint: before.sha256,
            migration: result,
        }, null, 2));
    } finally {
        database.close();
    }
}

main().catch(error => {
    console.error(`Barcode registry migration stopped: ${error.message}`);
    process.exitCode = 1;
});