# PHASE 9.6 - DATABASE INTEGRITY REPORT

Result: **Focused database integrity checks passed on disposable SQLite. Production/VPS were not accessed.**

## Changes

- `database.js` now refuses to create a missing SQLite file in production, before creating its parent directory; production opens also use `fileMustExist` to guard against a missing-file race. Development/test bootstrap behavior is unchanged.
- `server.js` now handles unhandled API 5xx errors as generic JSON (`Máy chủ đang gặp sự cố. Vui lòng thử lại sau.`) and logs only the SQLite/error code. Existing 4xx responses and the specific handled `POST /api/history` failure response remain unchanged.
- Added `tests/database-integrity.test.js`. No schema, migration, index, retention policy, or application data was changed.

## Verification

`node --test tests/database-integrity.test.js`: **1/1 focused test passed.** It verifies:

- Barcode registry migration backfill preserves legacy rows and is idempotent; invalid legacy data rolls back DDL and marker, leaving source rows intact.
- History registration failure leaves no registry key, mapping, or partial history record.
- Primary/unique constraints and foreign keys are enforced; `inventory_history.created_by_user_id` uses `ON DELETE SET NULL` while preserving the creator snapshot.
- History and inventory retention delete only rows older than the supplied 72-hour cutoff. A barcode remains active while any mapped history row exists, releases after the last row is deleted, and repeated cleanup is idempotent.
- A cleanup trigger failure rolls back both history tables and registry status.
- SQLite lock, inventory constraint failure, and history/registry transaction failure do not return false success; API 5xx responses contain no SQL, SQLite error details, or stack paths.
- Opening a missing production DB fails without creating a file/directory. The explicit barcode migration runner refuses production mode before creating its target.
- Final SQLite `integrity_check` is `ok`; `foreign_key_check` has no violations.

All writes ran against in-memory SQLite or a disposable file under the OS temporary directory. No earlier Phase suites, frontend build, workspace database, production database, or VPS was run or modified.

## Migration and Limits

- The explicit barcode registry migration is not invoked by server startup; startup checks registry readiness, and the migration CLI has production/path confirmation guards. The guard was tested with a temporary target, not by migrating a real database.
- `database.js` still contains pre-existing idempotent table creation, additive column migrations, and seed bootstrap when an existing database is opened. This behavior was not redesigned or run against any production schema; production schema compatibility remains unverified.
- Production/VPS database availability, integrity, locks, backups, and runtime responses remain unverified.
