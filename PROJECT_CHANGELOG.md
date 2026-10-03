# Project Changelog

## Phase 9.5 - Inventory Integration

- Files added: `tests/inventory-integration.test.js`, `PHASE_9_5_INVENTORY_INTEGRATION_REPORT.md`.
- Files changed: `frontend/src/features/inventory/InventoryPage.jsx`, `package.json`, `package-lock.json`.
- Inventory QR submission now synchronously guards against duplicate click handlers, preventing more than one history row for one in-flight action.
- Added `jsqr` as a development dependency to decode and verify QR images in integration tests. Existing QR generation and API contracts are unchanged.
- No backend route, SQLite schema, migration, or retention policy was changed. Temporary SQLite tests confirmed the existing `inventory_history` schema and 72-hour retention behavior.
- Fixed: rapid duplicate submissions could create multiple Inventory records. API failures retain the clipboard value; HTTP 500 is shown as a friendly message.
- Verification: the focused Inventory integration test passed all eight requested flows; `npm run build` passed.
- Not verified: production/VPS database, deployed hosting/routing, and production runtime.

## Phase 9.6 - Database Integrity & Error Handling

- Files changed: `database.js`, `server.js`, `tests/database-integrity.test.js`, `PROJECT_CHANGELOG.md`, `PHASE_9_6_DATABASE_INTEGRITY_REPORT.md`.
- Production startup now refuses to create a missing SQLite database file; opening an existing production DB also requires `fileMustExist`.
- Unhandled API 5xx errors now return generic JSON and log only an error code. Existing 4xx handling and route-specific history errors remain unchanged.
- No schema, registry migration, index, retention rule, or data was changed. SQLite tests covered migration rollback/idempotency, transaction rollback, constraints/FKs, registry release timing, 72-hour history and inventory cleanup, DB lock, and sanitized API failures.
- Verification: `node --test tests/database-integrity.test.js` passed. No frontend build was needed.
- Not verified: any production/VPS database or runtime. Existing additive DDL/bootstrap in `database.js` remains unchanged.

## Barcode reuse

- Public order creation accepts a barcode that already exists; each successful submission records another history row and registry mapping.
- Concurrent submissions with the same barcode are both retained. Admin lookup continues to show multiple matching history rows as ambiguous.

## Phase 9.7 - System Acceptance Test

- Files added: `tests/system-acceptance.test.js`, `PHASE_9_7_SYSTEM_ACCEPTANCE_REPORT.md`.
- No application source, API contract, schema, migration, routing, or deployment configuration was changed.
- Focused acceptance covered Public Order/registry create and duplicate, Admin ambiguous lookup and reprint, Inventory Admin/Operator/Guest and duplicate-submit, 72-hour retention/release, label assets, and React/Express routing.
- Verification: `node --test tests/system-acceptance.test.js` passed. The Express `NODE_ENV=production` probe confirms the existing `/`, `/admin`, and `/kiemke` routes still serve legacy HTML; this remains a blocker to production React routing.
- Test writes used only disposable SQLite. Production/VPS database, Nginx/static hosting, deployment, and live HTTPS/cookie behavior remain unverified.

## Phase 10.1 - Production Routing Architecture

- Files changed: `server.js`, `nginx/vtp.conf.example`, `PROJECT_CHANGELOG.md`, `PHASE_10_1_PRODUCTION_ROUTING_REPORT.md`.
- Added a sample Nginx server for `frontend/dist`: UI routes use React SPA fallback, `/assets` and public files are served statically, and `/api/*` plus `/healthz` proxy to loopback Express.
- In production, Express now returns 404 for non-API/UI/static requests and listens on `127.0.0.1`; legacy HTML/source and all API routes remain in the repository.
- Verification: Vite build passed; Nginx sample passed `nginx -t` in Docker; live Docker Nginx + production-mode Express smoke test passed for React routes, assets/MIME, API proxy, and fallback separation.
- The Nginx file is an unapplied sample. VPS build/publish, TLS, proxy trust settings, service env, and production route behavior remain unverified; no deploy or server configuration was changed.

## Phase 10.2 - Production Configuration & Deployment Pipeline

- Files changed: `.github/workflows/deploy.yml`, `nginx/vtp.conf.example`, `PROJECT_CHANGELOG.md`; files added: `scripts/package-release.sh`, `ops/deploy-release.sh`, `tests/deployment-pipeline.test.js`, `PHASE_10_2_DEPLOYMENT_PIPELINE_REPORT.md`.
- The workflow now checks out the pushed `main` commit, builds React once, verifies a clean allowlisted package, then transfers and activates it only after the build job succeeds. The package excludes `.env`, SQLite, `.git`, and `node_modules`; production dependencies are installed in staging on the target before activation.
- Releases use one atomic `current` symlink for frontend and backend. The deployment helper backs up and verifies SQLite before switching, restarts the existing `vtp` systemd service, checks `/healthz`, and restores the previous release on restart/health failure. Old releases and backups are retained.
- Verification: build/package/dependency checks passed; workflow YAML parsed and build-before-deploy structure checked; mocked-systemd tests passed for success, restart failure, health failure, and manual rollback; local Docker Nginx + temporary-SQLite Express proxy smoke test passed.
- No GitHub Actions run, SSH, VPS deployment, database migration, live Nginx change, TLS configuration, or trust-proxy change was performed. Initial VPS release-layout/systemd configuration and actual environment/database paths remain unverified; see the Phase 10.2 report.

## Phase 10.3 - VPS Bootstrap & Deployment Readiness

- Files added: `VPS_BOOTSTRAP_GUIDE.md`, `ops/vtp.service.example`, `PHASE_10_3_VPS_READINESS_REPORT.md`; files changed: `ops/deploy-release.sh`, `tests/deployment-pipeline.test.js`, `PROJECT_CHANGELOG.md`.
- The deploy helper now fails closed unless systemd declares a non-root User/Group, production mode, port 3000, and an absolute existing DATABASE_PATH; it checks existing SQLite/WAL/SHM ownership and owner access, private backup-directory permissions, and existing non-interactive restart authorization before switching releases.
- The systemd sample preserves the current manager and restricts writes to persistent data. The bootstrap guide distinguishes repo-verified settings from VPS values requiring operator inventory; no mutating bootstrap script was added because the live layout/identities are unknown.
- Verification: temp-WAL deployment tests passed for consistent online backup, post-deploy data retention through rollback, missing DB path/user/permissions/dependencies, restart/health failure, and manual rollback; `systemd-analyze verify`, Nginx `-t`, shell syntax, and backend syntax checks passed.
- No SSH, deployment, live configuration, database operation, GitHub Actions run, secret change, commit, or push occurred. Actual VPS identity, paths, unit, ACLs, TLS/proxy chain, and Nginx remain unverified.

## Phase 10.4 - VPS Live Inventory & Bootstrap Preparation

- Files added: `ops/vps-inventory.sh`, `tests/vps-inventory.test.js`, `PHASE_10_4_VPS_INVENTORY_REPORT.md`; files changed: `VPS_BOOTSTRAP_GUIDE.md`, `PROJECT_CHANGELOG.md`.
- Added `--read-only` collection and `--check` preflight for OS/runtime, Nginx/systemd, service identity/environment, app/release/database/WAL/SHM/backup metadata, PM2, deploy identity, and safely queryable sudo authorization. Secrets, `.env` contents, SQLite data, and ExecStart arguments are not emitted; the script does not bootstrap or mutate host state.
- The guide now explains safe execution/result sharing and requires explicit operator confirmation before bootstrap commands. Repository and sample requirements are compared against VPS actuals; live values remain unverified because no host inventory was run.
- Verification: shell syntax and isolated inventory tests passed for read-only/no-mutation behavior, secret redaction, missing unit/DB path, and unsafe SQLite permissions.
- No SSH, VPS inventory execution, package installation, service/Nginx operation, bootstrap, deployment, Actions run, secret change, commit, or push occurred.

## Phase 10.5 - VTP Runtime Port & Persistent Database Alignment

- Files changed: `server.js`, `.env.example`, `frontend/vite.config.js`, `README.md`, `ops/vtp.service.example`, `nginx/vtp.conf.example`, `ops/deploy-release.sh`, `ops/vps-inventory.sh`, `VPS_BOOTSTRAP_GUIDE.md`, Phase 10.4 report, and deployment test fixtures; added `tests/deployment-config.test.js`.
- VTP now defaults/configures port `3001`; the existing deployment helper checks health on `127.0.0.1:3001` and requires `DATABASE_PATH=/var/www/vtp/data/history.sqlite`. Nginx sample proxies VTP to `3001`; IM port/domain configuration was not edited.
- GitHub Actions workflow and `scripts/package-release.sh` remain unchanged; the existing build/package/SSH/backup/atomic-switch/health/rollback pipeline is retained.
- The new focused configuration test passed. Syntax checks passed. Per request, the older test suites were not rerun.
- Follow-up read-only VPS inventory confirmed active service identity `deploy`, `/var/www/vtp/.env`, VTP listener `*:3001`, existing DB path `/var/www/vtp/data/history.sqlite`, VTP hostname/TLS, and existing NOPASSWD restart permission. It also found no release/current/backups layout, an `EnvironmentFile`/`npm start` unit, proxy-all Nginx routing, and DB/WAL/SHM mode `0644` with data directory `0775`.
- Updated the proposed systemd/Nginx samples and guide to match the observed VTP identity/domain/TLS while preserving the IM listener/config. Live VPS configuration/database/`.env` were not changed. Read-only inventory SSH succeeded; no deploy/bootstrap/restart/reload occurred.
- The deployment helper and VPS inventory preflight accept only the exact `/var/www/vtp/.env` EnvironmentFile source, while retaining private-file checks and explicit systemd `NODE_ENV`, `PORT`, and `DATABASE_PATH` gates. Unknown/multiple environment sources still fail closed; no release-switch protection was removed.
- A second read-only VPS inventory after the blocked Actions upload found the candidate still in `incoming/` and `staging/`, no current/release baseline, Node.js 22 on host, and a live proxy-all Nginx config incompatible with the old staged artifact's static React bundle.
- Updated release serving so Express can serve the packaged React UI behind the currently active proxy-all Nginx config; the Nginx sample has a named proxy fallback for legacy rollback releases, and release health checks now require both `/healthz` and `/`. The already-staged VPS artifact predates this fix and was left untouched.
- Prepared the live rollback baseline from the running legacy app, created and verified an online SQLite backup, set DB directory/file/sidecar modes to `0700`/`0600`, and installed the systemd drop-in with `daemon-reload`. No VTP restart, Nginx reload, IM change, or staging cleanup occurred; the service remains active on its pre-drop-in process until a future restart.
- Diagnosed the later workflow rerun: it exits at `test ! -e "$stage"` because retries reuse the same run ID while failed stage/release paths are intentionally retained. The unpushed follow-up adds `github.run_attempt` to release IDs, keeps support for the legacy ID form, and accepts `baseline-*` IDs for manual rollback; fixtures cover an attempt-scoped deployment and baseline rollback. It has not been pushed because the next deploy would still be blocked by the production barcode registry migration awaiting authorization.
