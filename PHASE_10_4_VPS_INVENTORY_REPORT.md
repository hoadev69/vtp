# PHASE 10.4 - VPS Live Inventory & Bootstrap Preparation

Result: **Read-only VPS inventory completed on 2026-10-03. Port/domain/DB file path align or can be resolved, but release bootstrap is blocked by the active flat layout, incompatible systemd unit, Nginx routing, and SQLite permissions. No live configuration or data was changed.**

## Scope and Safety

- Read `PROJECT_CHANGELOG.md`, Phase 10.2/10.3 reports, `VPS_BOOTSTRAP_GUIDE.md`, `ops/vtp.service.example`, `ops/deploy-release.sh`, `.github/workflows/deploy.yml`, and the Nginx sample.
- Added `ops/vps-inventory.sh` with `--read-only` collection and `--check` preflight modes. It does not install packages, restart/reload services, edit files, change permissions, inspect `.env` contents, read SQLite data, or switch `current`.
- Added `tests/vps-inventory.test.js` with isolated temporary files and fake systemd/Nginx/sudo/Node/npm commands. It checks that output excludes environment/private proxy/ExecStart sentinels, fixtures remain unchanged, and missing unit, missing DB path, and unsafe DB permissions fail.
- Updated `VPS_BOOTSTRAP_GUIDE.md` with invocation, result-sharing guidance, explicit gates, and separately approved bootstrap examples. Appended this phase to `PROJECT_CHANGELOG.md`.
- Read-only SSH commands collected systemd, filesystem, Nginx, listener, identity, and sudo facts. Sensitive environment contents were redacted; no database contents or secrets were read.
- No live service, Nginx config, systemd unit, database, or `.env` was changed. No GitHub Actions/deployment/bootstrap command was run.

## Repository vs. VPS Comparison

`VPS_BOOTSTRAP_GUIDE.md` and `ops/vtp.service.example` are proposals, not proof of the deployed host. Since no VPS output was supplied, no actual setting can honestly be marked verified or mismatched.

| Item | Repository/deploy expectation | Phase 10.3 sample | Actual VPS | Classification |
| --- | --- | --- | --- | --- |
| OS | Workflow builds with Node 24; requested host baseline is Ubuntu 24.04 | No host OS is asserted | Not collected | Chưa xác minh |
| Node/npm | Node 24 in GitHub build; target Node/npm and native build support must be inventoried | `/usr/bin/env node`; PATH must be verified | Not collected | Chưa xác minh |
| Nginx | Serve `current/frontend/dist`; proxy API/health to `127.0.0.1:3001` | VTP domain/TLS paths and port 3001, static release root | Domain `vtp.biloveg.io.vn`; TLS origin cert/key; all paths proxy to `127.0.0.1:3001` | Không khớp routing; domain/TLS/port verified |
| App root/release layout | `/var/www/vtp`, `current`, `releases`, `staging`, `incoming`, `data`, `backups` | Same release layout | Flat `/var/www/vtp`; data exists; `current`, `releases`, `backups`, `ops`, `scripts` absent | Không khớp; first release bootstrap required |
| systemd service | Name `vtp`; working dir root; ExecStart uses `current/server.js`; no `EnvironmentFile` | direct `Environment`, executable `node` | Active; `WorkingDirectory=/var/www/vtp`; `/usr/bin/npm start`; reads `/var/www/vtp/.env` | Không khớp helper contract |
| Service User/Group | Explicit non-root User and Group; DB/sidecars match their numeric IDs | `deploy:deploy` | User `deploy`; primary group `deploy`; no explicit `Group=` | Cần chỉnh unit bằng phê duyệt |
| Runtime environment | `NODE_ENV=production`, `PORT=3001`; explicit DB path | Same values | NODE_ENV from systemd; PORT from `.env` and listener is `*:3001`; no DATABASE_PATH in systemd Environment or `.env` | Port matches; explicit Environment values missing |
| SQLite path | Explicit `/var/www/vtp/data/history.sqlite`; existing file outside releases | Exact same path | File exists there; with current code/working dir, default resolves to this path; no override found | Đã xác minh theo code/default, cần set explicit in unit |
| SQLite/WAL/SHM rights | Service owner bits; no group-write/other access | deploy-owned restrictive modes | All deploy:deploy; DB/WAL/SHM `0644`; data directory `0775` | Không khớp helper; backup then tighten modes |
| `.env` | Root `.env`, private, readable by service | Existing file preserved, not packaged | `/var/www/vtp/.env`, deploy:deploy `0600`; contains PORT/NODE_ENV keys (values withheld) | Đã xác minh; preserve |
| Hostname/TLS | Keep VTP domain; do not touch IM | `vtp.biloveg.io.vn`, origin cert/key paths | Same host/domain and TLS paths observed | Đã xác minh; preserve |
| Listener separation | VTP only loopback `3001`; IM remains on `3000` | VTP port 3001 | VTP `*:3001`; another Node process `0.0.0.0:3000` | Port separation observed; VTP bind scope must be corrected |
| PM2 | Determine whether old PM2 still serves app | systemd proposed manager | Not collected | Chưa xác minh |
| GitHub deploy user/sudo | Match `VPS_USER`; writable staging/release, readable DB/sidecars; noninteractive restart right | Existing Secrets; systemctl restart `vtp` | `deploy` owns app root and has NOPASSWD `systemctl restart vtp`; deeper path rights still need checking | Restart permission/user verified; release access pending |

Deployment remains blocked until a retained baseline/current symlink exists, systemd matches the helper contract, Nginx serves the React release, DB/WAL/SHM modes are restricted, and the deploy identity passes backup and release-directory preflight. The current DB path is inferred with high confidence from the live code/default, working directory, environment keys, and existing file; the pipeline still requires it to be explicit in systemd Environment.

## Inventory Behavior

`--read-only` reports OS and tool versions/status; sanitized systemd user/group/working directory/EnvironmentFile and allowlisted runtime keys; repository/app/current/release entry point/frontend/data/release/backup/database/WAL/SHM metadata; selected Nginx host/root/proxy/listen/TLS directives; PM2 executable/process-name presence; caller/deploy identity and, when safely queryable, non-interactive sudo listing. It does not print systemd command arguments or raw environment, `.env`, secrets, database contents, private keys, or PM2 environment/arguments.

`--check` compares available local facts with the deploy helper's explicit gates and emits `PASS`, `FAIL`, or `CONFIRM`. It requires Ubuntu 24.04, Node 24, a loaded non-root `vtp` service identity, expected root/entry point/environment, current release/data/DB, SQLite permissions, Nginx release root/loopback proxy, and applicable deploy-user directory/DB access, backup, and sudo preconditions. Hostname, TLS/proxy chain, and credentials-source decisions remain operator confirmations. A nonzero exit means at least one failure or unresolved confirmation; it is not an authorization to bootstrap/deploy. Health is deliberately not requested, avoiding a probe-generated application log; rollout health remains the deployment helper's responsibility.

## Verification

- `bash -n ops/vps-inventory.sh`: passed.
- `node --test tests/vps-inventory.test.js`: passed with fixture cases for read-only output/no mutation, secret redaction, missing systemd unit, missing absolute DB path, and unsafe SQLite mode.
- The test uses marker commands that fail if inventory attempts an install, restart, or reload. A before/after tree snapshot confirms app fixture contents, metadata, symlinks, and permissions did not change.
- Live inventory was run read-only over SSH. It did not query PM2 or target Node/npm versions. No deployment pipeline, Nginx reload, systemd edit/restart, or bootstrap command was performed.

## Required Next Gate

After approved changes, run the current inventory script as `deploy` and require all deployment gates to pass. The existing observations already confirm `deploy`, domain/TLS, port separation, and the DB file path; unresolved blockers are unit contract, release baseline/layout, Nginx React routing, and strict SQLite permissions. First cutover and creation of a healthy baseline still require an explicit maintenance/rollback plan.

## Follow-up Runtime Alignment

The repository runtime target is port `3001` and DB path `/var/www/vtp/data/history.sqlite`; the live inventory confirms the VTP port, host/domain, existing DB file location, and deploy user. The live app still uses the pre-release layout and is not deployment-ready until the blockers above are remediated.