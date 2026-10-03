# PHASE 10.3 - VPS READINESS REPORT

Result: **Repository-side readiness checks and isolated deployment simulations passed. VPS readiness is not established; no SSH or real deployment was attempted.**

## Files Changed

- Added `VPS_BOOTSTRAP_GUIDE.md`: read-first inventory and an operator-run bootstrap checklist; commands were not executed on a VPS.
- Added `ops/vtp.service.example`: proposed systemd unit matching the release helper, not installed.
- Changed `ops/deploy-release.sh`: explicit runtime/database/service/permission gates before release activation.
- Changed `tests/deployment-pipeline.test.js`: WAL snapshot, user/DB/dependency preflight, restart/health rollback, and post-deploy data retention coverage.
- Added this report and appended Phase 10.3 to `PROJECT_CHANGELOG.md`.

`PROJECT_CHANGELOG.md`, Phase 10.1/10.2 reports, `.github/workflows/deploy.yml`, `scripts/package-release.sh`, and `nginx/vtp.conf.example` were read. The Phase 10.3 changes do not modify the GitHub workflow, Nginx sample, or production routing.

## Verified From the Repository

- The workflow and Phase 10.2 helper assume `/var/www/vtp`, a systemd service named `vtp`, and existing sudo-based `systemctl restart`; the workflow's current Secrets are `VPS_HOST`, `VPS_USER`, and `VPS_SSH_KEY`.
- No systemd unit file or VPS bootstrap configuration exists in the repository. The `.env.example` lists `PORT`, `TRUST_PROXY_HOPS`, and application credentials, but not `DATABASE_PATH`.
- `database.js` uses `DATABASE_PATH` or defaults relative to `__dirname` at `data/history.sqlite`; in production it refuses a missing DB file. Release layout therefore needs a persistent `data/` symlink, and the helper now additionally requires an explicit absolute `DATABASE_PATH` in systemd `Environment` so the deployed path cannot be guessed.
- Express production routing permits API/health traffic and binds to loopback when `NODE_ENV=production`; the release helper requires the unit to declare `NODE_ENV=production` and `PORT=3000`.
- The Nginx sample roots static files at `/var/www/vtp/current/frontend/dist` and proxies API/health to `127.0.0.1:3000`. It remains an HTTP-only sample with a placeholder hostname.
- This workspace is an Ubuntu 24 dev container with Node 24 and Docker available. That is not evidence about the VPS. `systemd-analyze verify` validated the sample copied to a temporary `.service` filename; no host systemd unit/manager was inspected.

## Fail-Closed Helper Changes

Before a deploy or rollback can change `current`, the helper now verifies:

- The service has explicit non-root `User` and `Group`, `WorkingDirectory=/var/www/vtp`, and `ExecStart` referencing `/var/www/vtp/current/server.js`.
- The service has no `EnvironmentFile`; runtime values must be explicit in systemd `Environment`, while credentials remain in a private root `.env` readable by the service identity. This avoids logging or parsing app secrets in the deploy helper.
- `NODE_ENV=production`, `PORT=3000`, and an absolute `DATABASE_PATH` are explicitly configured. The database file must already exist outside staging/releases.
- Existing DB parent, DB, and present `-wal`/`-shm` files match the configured service user/group and have owner permissions needed for SQLite. Group-read is allowed for a backup reader, but group-write and `other` access are rejected. The backup directory is a private `0700` directory owned/writable by the deploy user.
- The existing non-interactive sudo rule authorizes exactly the service restart before any activation. Production dependencies must install and resolve before backup/switch.

The unit sample proposes `User=vtp`, `Group=vtp`, `DATABASE_PATH=/var/www/vtp/data/history.sqlite`, and `/usr/bin/env node`; these are examples, not confirmed host values. The actual Node path/PATH, service identity, data ownership, and database path must be inventoried first. The helper intentionally rejects unknown `EnvironmentFile` use until its DB/runtime values can be resolved safely.

## Release, Backup, and Rollback Guarantees

- The persistent DB remains outside releases. Each release's `data/` points to `/var/www/vtp/data`; release files and application code are changed through the one `current` symlink.
- An online `better-sqlite3` backup is made while the existing service is active, then checked with SQLite `integrity_check` and `foreign_key_check` before switching. It is stored under `/var/www/vtp/backups/` with mode `0600`; the directory is private. Backups are not automatically removed.
- A missing/unknown DB path, DB file, account, permissions, sudo authorization, or dependency aborts before `current` changes. The helper does not create an empty database, overwrite a release id, delete an active/old release, run schema migrations, or restore a DB snapshot during application rollback.
- Health/restart failure atomically restores the previous frontend/backend release and retries systemd restart/health. Manual rollback uses the same helper and does not roll back data created after deployment. Releases and backups are retained; cleanup is a separate operator decision.

## Tests Run

- `node --test tests/deployment-pipeline.test.js`: passed with disposable SQLite in WAL mode and fake systemd/sudo/curl/npm. It covers online backup snapshot/mode, a write made after deployment, no DB loss on rollback, missing DB path/User, missing sudo, insufficient or overly broad DB permissions, failed dependency install, failed health, failed restart, manual rollback from an unhealthy release, and retention of old releases/backups.
- `systemd-analyze verify` on a temporary copy of `ops/vtp.service.example`: passed. No unit was installed or reloaded.
- `docker run ... nginx:alpine nginx -t` on the repository sample: passed. No live Nginx was read or changed.
- `bash -n scripts/package-release.sh ops/deploy-release.sh`, `node --check server.js`, and editor diagnostics for touched code: passed.
- No Phase 9 suite, build, GitHub workflow, or production API smoke test was rerun; those surfaces were not changed in this phase.

All SQLite writes above were confined to the test's temporary directory and removed at test completion. No workspace DB, production DB, or backup was read or changed.

## VPS Values Not Verified

The following cannot be established from this repository or dev container:

- Ubuntu release, Node/npm installation and path, Nginx version/worker user, systemd version, service account/group, effective `WorkingDirectory`/`ExecStart`/environment, and current sudo policy.
- Whether `/var/www/vtp` exists, whether `current`/`releases`/`data`/`backups` have the proposed layout, and who owns them.
- The real SQLite path, DB owner/group/mode, WAL/SHM state, backup storage capacity, and whether the GitHub deploy account can read an online WAL backup.
- The active Nginx document root, configuration, TLS terminator, public host, external proxy chain, and resulting Secure-cookie behavior.
- Whether the current service uses `EnvironmentFile`; the helper will deliberately refuse deployment if it does.
- Whether the existing GitHub Secrets are present/valid, whether the deploy user has required filesystem access, and whether its current sudo rule passes the helper's non-interactive preflight.
- Whether a healthy baseline release/current symlink exists. The helper refuses first activation without a retained release; one-time bootstrap/cutover needs a separately reviewed maintenance plan.

## Operator Next Steps

1. Follow `VPS_BOOTSTRAP_GUIDE.md` in read-only inventory mode first. Record actual values privately; do not paste secrets or full systemd environment output into logs.
2. Resolve mismatches explicitly: persistent absolute DB path, service user/group, data/sidecar permissions, deployment-user read access for backup, backup-directory ownership, Node path, Nginx worker access, and the existing narrowly scoped restart permission.
3. Prepare a verified baseline release and `current` symlink without moving or replacing the existing database or `.env`. Review the proposed unit and Nginx config against the live configuration; only an approved operator should install/reload them.
4. Validate TLS termination and trusted proxy hops before changing `TRUST_PROXY_HOPS`; test Secure session cookies over the real HTTPS path in an approved staging/maintenance window.
5. Confirm the three existing GitHub Secrets in the GitHub UI without revealing their values. Do not push/trigger production until the bootstrap gates and rollback target are confirmed.

Phase 10.3 ends here. No bootstrap script was added because safe creation/chown/replacement choices depend on host identities and existing paths that are not available without the explicitly prohibited VPS access. The guide and unit file are examples only; deployment readiness remains pending operator inventory.