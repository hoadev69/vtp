# PHASE 10.2 - DEPLOYMENT PIPELINE REPORT

Result: **Build, artifact packaging, local Nginx/Express routing, and simulated release rollback passed. No GitHub deployment run or VPS access occurred.**

## Changed Files

- `.github/workflows/deploy.yml`: replaces in-place `git pull` with build-gated package creation, artifact transfer, staged activation, and health verification.
- `nginx/vtp.conf.example`: static root now points at `/var/www/vtp/current/frontend/dist`; no live Nginx configuration was changed.
- `scripts/package-release.sh`: creates a checksum-protected, allowlisted release archive and checks production dependency installation.
- `ops/deploy-release.sh`: checks service/layout/database preconditions, backs up SQLite, activates releases atomically, checks health, and supports automatic/manual rollback.
- `tests/deployment-pipeline.test.js`: uses fake systemd/sudo/curl/npm commands and temporary SQLite to exercise release transitions and failures.
- `PROJECT_CHANGELOG.md`: appended the Phase 10.2 entry.

## Build Artifact

The single `npm run build` in this phase passed with Vite 6.4.3 and wrote `frontend/dist`: `index.html`, hashed JS/CSS/SVG under `assets/`, icons, `manifest.webmanifest`, and `sw.js`. `base: '/'` and frontend API calls use same-origin paths; source only uses `import.meta.env.PROD`/`BASE_URL`, with no `VITE_*` public configuration or local backend URL found in the build.

The archive contains only:

- `frontend/dist/`
- `server.js`, `database.js`, `barcode-registry.js`, `session-store.js`
- `package.json`, `package-lock.json`, `migrations/`
- `ops/deploy-release.sh` and a commit SHA marker

The packaging script performs a temporary `npm ci --omit=dev`, verifies required runtime modules resolve and Vite is excluded, then removes the temporary `node_modules` before archiving. The archive listing and SHA-256 were checked; `.env`, `.env.*`, SQLite/DB files, `.git`, and `node_modules` are rejected. Runtime dependencies are installed again inside the target staging directory before activation so native `better-sqlite3` is built for the target host.

## GitHub Actions Flow

1. A push to `main` checks out exactly `github.sha` and runs Node.js 24, `npm ci`, one Vite build, package verification, then uploads the archive/checksum for one day.
2. The deploy job has `needs: build`; it cannot start after a failed build/package job. It downloads and checksums the archive, uploads it over SCP, extracts a `<commit-sha>-<run-id>-<run-attempt>` staging directory, and calls the release helper. Including the attempt number prevents reruns from colliding with retained stage/release directories.
3. Concurrency no longer cancels an active deployment. The build job receives no VPS secrets; deploy uses only existing secrets `VPS_HOST`, `VPS_USER`, and `VPS_SSH_KEY` (SSH port remains the existing default 22). No secret or token is copied into the artifact or added to build environment variables.

The workflow YAML parsed with Ruby's YAML parser and structural assertions verified the `main` trigger and `deploy.needs: build`. `actionlint` is not installed in this workspace. The workflow has not been run by GitHub; no push or dispatch was issued.

## Expected VPS Layout and Preconditions

```text
/var/www/vtp/
  .env                         # existing runtime config, never in artifact
  data/history.sqlite          # persistent database, never in artifact
  current -> releases/<sha>-<run-id>-<run-attempt>
  releases/<release-id>/       # frontend, backend, lockfiles, target node_modules
  staging/<release-id>/        # extracted candidate, moved after validation
  incoming/                     # temporary archive and checksum
  backups/history-*.sqlite      # verified pre-deploy backups
```

The single `current` symlink couples Nginx's static root and Express's entry point to the same release. Existing systemd remains the process manager and is restarted with the existing `sudo systemctl restart vtp` mechanism. Before this workflow can deploy, the VPS owner must perform/approve a one-time layout bootstrap and ensure:

- `/var/www/vtp/current` already points to a retained release; the helper intentionally refuses first activation without a rollback target.
- `vtp` has `WorkingDirectory=/var/www/vtp` (so dotenv continues reading the root `.env`) and an `ExecStart` that invokes `/var/www/vtp/current/server.js`.
- The SSH deploy user can write the app root/release directories and already has the same restart permission assumed by the existing workflow. No additional sudo command or permission is introduced.
- `/var/www/vtp/data` and the actual configured SQLite database already exist. Each release links `data/` to this persistent directory; database files are never shipped, replaced, or migrated by this pipeline.
- At Phase 10.2, the helper rejected units with `EnvironmentFile` because that source had not been verified. After the later VPS inventory, a follow-up narrowly allowlisted only `/var/www/vtp/.env`; all other EnvironmentFile sources remain rejected. `DATABASE_PATH` must now be explicit in systemd `Environment` and point to the existing persistent DB.
- Node.js/npm and the native build prerequisites for `better-sqlite3` are available on the VPS. The package install occurs before the active symlink changes.

The deploy user must also be able to run the existing systemd restart command non-interactively, as the former workflow already required. The workflow does not modify the unit, grant sudo rights, change DNS/Cloudflare, or configure TLS.

## Backup, Activation, and Rollback

- Before switching releases, the helper takes an online SQLite backup through `better-sqlite3`, verifies `integrity_check` and foreign keys, and stores it with mode `0600` under `/var/www/vtp/backups/`. A missing database, unresolvable path, unsupported environment source, or failed backup aborts before activation.
- The candidate and target-specific production dependencies are prepared while the current release remains active. A same-filesystem atomic rename switches `current`; both Nginx (`current/frontend/dist`) and systemd (`current/server.js`) then address that one release. The database and `.env` stay outside releases.
- After restart, the helper checks systemd active state and `http://127.0.0.1:3000/healthz`. Restart/health failure switches `current` back and attempts another systemd restart plus health check. If that recovery restart also fails, the pointer is restored but operator intervention is required.
- No old release or database backup is automatically pruned. Manual rollback command after bootstrap: `bash /var/www/vtp/current/ops/deploy-release.sh rollback <release-id> /var/www/vtp`. Manual rollback is allowed even when the current release is unhealthy.
- Frontend and backend are packaged from the same commit and switched through one pointer, avoiding a deliberately mixed release. Database schema migrations are not run by deployment; schema/API compatibility remains the release owner's responsibility.

## Verification and Unverified Items

- `npm run build`: passed once; the expected `frontend/dist` files were confirmed.
- `bash scripts/package-release.sh <sha> /tmp/...`: passed, including `npm ci --omit=dev`, runtime module resolution, Vite exclusion, forbidden-file scan, archive listing, and checksum verification.
- `bash -n` passed for both deployment scripts. Ruby YAML parse/structure checks passed. Editor diagnostics reported no errors in changed JavaScript files.
- `node --test tests/deployment-pipeline.test.js`: passed for deploy success, simulated health failure, simulated systemd restart failure, rollback from an unhealthy release, release retention, and unchanged temporary SQLite data/backups.
- Nginx Docker runtime check passed SPA routes, release-root static JS, manifest MIME, and missing-asset 404. Combined Nginx + production Express smoke test passed `/healthz`, `/api/form-fields`, unknown API non-SPA 404, `/admin` SPA fallback, and loopback-only Express binding, using disposable SQLite.
- No Phase 9 suite was rerun. No production DB, VPS, GitHub Actions execution, systemd unit, active Nginx, domain, TLS, Cloudflare, or external proxy chain was inspected.

The Nginx sample remains HTTP-only. `TRUST_PROXY_HOPS` is unchanged and must not be raised until the real trusted proxy chain is confirmed. With TLS terminating before Express, confirm the exact hop count before expecting existing Secure session cookies to work through forwarded HTTPS. These are deployment blockers to resolve during an approved VPS preparation, not verified properties of this local pipeline.