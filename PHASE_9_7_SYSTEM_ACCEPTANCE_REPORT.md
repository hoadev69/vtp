# PHASE 9.7 - SYSTEM ACCEPTANCE REPORT

Result: **Core system flows passed on disposable SQLite. React production routing is blocked by the current Express page routes.**

## Acceptance Results

| Flow | Result |
|---|---|
| Public Order create | PASS; React submit persisted the expected history row and one registry mapping, then navigated to the React result page |
| Duplicate barcode | PASS; API returned 409, React retained every entered form value, and no extra row/mapping was created |
| Result output | PASS; barcode and QR endpoints returned valid PNG signatures for the requested waybill; React A7 SVG reports 105mm × 74mm |
| Admin access and ambiguous legacy barcode | PASS; Admin logged in, listed both `legacy_ambiguous` rows and opened detail; Guest received 401 and Operator 403 |
| Reprint existing order | PASS; Admin reprint opened the result label without another `POST /api/history` or history row |
| Admin GET database failure | PASS; with existing rows visible, a temporary table-unavailable condition produced a generic UI error and cleared the old rows; the temporary table change was restored |
| Inventory access and submit | PASS; Admin and Operator created records, Guest received 401, and two synchronous submit events created one Operator row |
| Retention and barcode release | PASS; startup removed 100-hour rows and retained 48-hour rows; a barcode stayed reserved while one history row remained, released after the last row expired, cleanup was idempotent, and reuse then succeeded |
| Migration/data integrity | PASS; registry migration reran without changing legacy history; final SQLite integrity check was `ok` with no foreign-key violations |
| API routing boundary | PASS; existing JSON APIs remained API responses, and an unknown `/api/*` returned 404 rather than the React shell |

## Routing Blocker

- Direct Vite refresh at `/`, `/admin`, and `/kiemke` loaded the React app shell in the integration test.
- A separate Express process ran with `NODE_ENV=production` and the same disposable SQLite file. Express returned legacy HTML at `/` and `/kiemke`; unauthenticated `/admin` returned status 401 with legacy Admin HTML. `/api/form-fields` and `/api/geography` still returned JSON.
- Therefore React-through-Vite-to-Express integration passes, but the production React hosting route is **not accepted**. The repository's Express routing still serves legacy pages. No Express fallback, static hosting, Nginx, or deployment change was attempted because that would exceed acceptance scope and require a routing/deployment decision.
- Existing legacy page routes remain reachable. The route probe does not establish whether external clients still rely on them.

## Test Environment and Limits

- `node --test tests/system-acceptance.test.js`: **1/1 focused acceptance test passed**. It uses a temporary SQLite database, real Express APIs, Vite proxy, and Playwright only for browser behavior. The separate production-mode route probe also uses that temporary database.
- No existing Admin, Inventory, Public Order, barcode, or database-integrity suite was rerun. Relevant previously accepted error/session behavior was not repeated unless needed by this cross-system flow.
- No workspace or production SQLite was read or written. No production migration, deploy, VPS, Nginx, Cloudflare, or GitHub Actions operation occurred.
- QR decoding was not repeated because QR generation was unchanged; the result flow did check the API PNG signature and exact waybill URL. A7 dimensions were checked from the React result SVG attributes.
- Production database contents/schema, external reverse-proxy/static hosting, live HTTPS cookies, and actual production routing remain unverified.

## Pre-Deployment Blockers

1. Establish and verify a production route that serves the React build at `/`, `/admin`, and `/kiemke` while preserving `/api/*` routing and any required legacy page routes.
2. Verify the target production database path/schema, backups, and migration/retention readiness through the deployment owner's approved procedure. This phase made no production database claim.
