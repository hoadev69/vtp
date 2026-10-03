# PHASE 10.1 - PRODUCTION ROUTING REPORT

Result: **Repository routing preparation and isolated Nginx/Express checks passed. Nothing was deployed to a VPS.**

## Current and Target Architecture

- Before this phase, `npm run build` produced `frontend/dist`, but the deploy workflow only installed production dependencies and restarted Express; it did not build or publish the React assets.
- Express served legacy HTML at `/`, `/admin`, `/kiemke`, and `/ketqua.html`, plus legacy CSS/JS. The repo had no Nginx config. React calls same-origin relative `/api/...` endpoints; Vite's dev server proxies `/api` to Express.
- Added `nginx/vtp.conf.example` for static React hosting from `/var/www/vtp/frontend/dist`. `/`, `/admin`, `/kiemke`, `/ketqua.html`, and other UI routes use `index.html` fallback; `/assets/`, `/icons/`, manifest, and service worker are static-only; `/api` and `/api/*` plus `/healthz` proxy to `127.0.0.1:3000`.
- In production mode, Express now rejects non-API/UI/static requests with 404 and its standalone listener binds only to `127.0.0.1`. Existing HTML/legacy source files and API handlers were not deleted or changed. Development/test legacy route behavior remains unchanged.

## Files Changed

- `server.js`: production-only non-API boundary and loopback bind.
- `nginx/vtp.conf.example`: new reference configuration; it is **not installed or applied**.
- `PROJECT_CHANGELOG.md`: Phase 10.1 entry.
- `PHASE_10_1_PRODUCTION_ROUTING_REPORT.md`: this report.

No API contract, cookie options, auth policy, database schema, or business logic was changed. No workspace or production SQLite was accessed for writing; Express smoke testing used only a disposable database under the OS temporary directory.

## Verification

- `npm run build`: passed; actual output is `frontend/dist` with hashed files under `/assets/`, plus `sw.js`, `manifest.webmanifest`, and `/icons/`.
- `nginx -t` using the sample in an isolated `nginx:alpine` Docker container: passed.
- Live Docker Nginx + Express `NODE_ENV=production` smoke test using temporary SQLite: `/`, `/admin`, `/kiemke` served the React app and direct refresh worked; JS/CSS/manifest/service-worker/icon assets returned success with expected MIME types; `/api/form-fields` and `/healthz` reached Express; unknown `/api/*` returned 404 rather than React HTML; missing static assets returned 404; direct Express UI/static routes returned 404 while API remained available; Express listener was loopback-only.
- `node --check server.js`: passed.
- `git diff --check`: passed.

The Nginx sample listens on HTTP port 80 and uses `vtp.example.com` as a placeholder. TLS certificates, redirects, and the actual domain are deployment-owner decisions and were not fabricated or tested.

## Steps and Blockers Before VPS Use

1. Confirm the VPS checkout/root path and make the deployment workflow build and publish `frontend/dist`. Current deploy uses `npm ci --omit=dev`, which does not install Vite and does not create the build; this phase intentionally did not edit GitHub Actions.
2. Adapt `server_name`, TLS/listen configuration, filesystem permissions, and Nginx site enablement to the real VPS. Test with `nginx -t` before an approved reload.
3. Configure `TRUST_PROXY_HOPS` only after confirming the trusted proxy chain. If this Nginx is the sole proxy, value `1` allows Express to recognize forwarded HTTPS for existing Secure session cookies; do not trust forwarded headers from an untrusted direct client.
4. Confirm systemd environment, existing firewall/port exposure, and that port 3000 is reachable only locally. This repo phase did not inspect the VPS or service unit.
5. Verify legacy page routes are not still required by external clients before switching the public domain. Legacy source/API handlers remain in the repo, but production Express now returns 404 for page/static paths while Nginx owns those URLs.

Production/VPS, DNS, Cloudflare, live HTTPS cookie/session behavior, actual deployment artifact publication, and any active Nginx configuration remain unverified. The sample is a repository reference only and was not deployed.