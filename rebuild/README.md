# Wenmi Rebuild Foundation

Batch 108 creates the independent rebuild foundation only. It does not implement registration, login, paid member handling, author books, task execution, model calls, migration from the current production system, or production deployment.

Batch 109 adds only the isolated synthetic task recovery foundation. It verifies scoped enqueueing, leases, fencing tokens, checkpoints, cancellation, unknown external-call handling, retry bounds, transactional events, and cursor replay with synthetic owner/book IDs. It still does not expose unauthenticated product HTTP APIs, call real models, use real accounts, charge users, migrate production data, or deploy production services.

Batch 110 migrates the protected author-side page UI into `apps/author-web`. The page source and public assets were copied from `coauthoring-v7/author-app/src` and `coauthoring-v7/author-app/public`, then adapted inside the rebuild app so runtime code does not import from the old workspace. The new shell keeps the public entry, signed-in home page, manual creation, information and setting pages, time machine, planning workspace, library content UI, and author task/team status content while replacing the outer navigation with two top buttons: the left button opens the bookshelf and the right button opens the five primary functions. Time-machine/library and volume/chain/chapter remain visible as second-level switches in the page shell.

The migrated author UI still talks only to the rebuild local API boundary. Author API paths are fixed to same-origin `/api`; the Vite development server proxies `/api` to the local rebuild API on port 43282. The copied legacy clients are intentionally not allowed to use arbitrary `VITE_API_ORIGIN` values, old production origins, or old workspace imports. Full account-backed author APIs are not implemented in this batch, so real unavailable operations must fail honestly until the later API work lands. Browser previews and visual checks can use the local Playwright fixture `.local/rebuild/ui-fixture110.mjs` by calling `installFixture(page)`; the fixture intercepts author API requests for explicit local validation and returns 503 for unknown API calls.

## Runtime

- Node.js: 24.19.0 verified in this batch
- npm: 12.0.2
- PostgreSQL: 18.x, loopback only on port 54329
- Author web: http://127.0.0.1:43280
- Admin web: http://127.0.0.1:43281
- API: http://127.0.0.1:43282

The project does not read the repository root `.env` and does not contain fallback database targets. All database settings must be explicit environment variables.

## Environment

Set the variables below before `npm run migrate`, `npm run dev:api`, `npm run dev:worker`, or `npm run test:pg`.

```powershell
Set-Location D:\wenmixiezuo\rebuild

$env:WENMI_REBUILD_ENV = "rebuild-local"
$env:WENMI_REBUILD_EXPECTED_HOST = "127.0.0.1"
$env:WENMI_REBUILD_EXPECTED_PORT = "54329"
$env:WENMI_REBUILD_EXPECTED_DB = "wenmi_rebuild_dev"
$env:WENMI_REBUILD_APP_ROLE = "wenmi_rebuild_app"
$env:WENMI_REBUILD_MIGRATOR_ROLE = "wenmi_rebuild_migrator"
$env:WENMI_REBUILD_DATABASE_URL = "<postgresql URL for the current role>"
```

Use the migrator URL for `npm run migrate`. Use the app URL for API and Worker startup. `npm run test:pg` refuses to mutate `wenmi_rebuild_dev`; it requires a random database named `wenmi_rebuild_test_<suffix>`.

## Commands

```powershell
Set-Location D:\wenmixiezuo\rebuild

node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js ci --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js run check:boundary --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js run typecheck --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js test --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js run test:author --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js run build --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js run verify --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
```

If a normal npm executable is available in PATH, the same scripts can be run with `npm`. Use `npm ci` for reproducible installation from `package-lock.json`.

## Synthetic Task Recovery

The backend package exports the batch 109 synthetic task API:

```ts
import {
  PostgresSyntheticTaskRepository,
  createPostgresPool,
  createSyntheticTaskService
} from "@wenmi-rebuild/backend";
```

Create the service with an app-role PostgreSQL pool. Public operations require an explicit `{ ownerId, bookId }` scope and JSON-only payloads:

- `enqueue` stores a scoped idempotent request. The idempotency hash includes the request payload and execution contract such as `maxAttempts`.
- `claimNext` uses PostgreSQL row locks with `SKIP LOCKED`, DB-time leases, and monotonic fencing tokens.
- `renewLease`, `saveCheckpoint`, `recordExternalCallStarted`, `completeTask`, and `failTask` require the current fencing token.
- `cancelTask` serializes with completion on the same task row.
- `resolveUnknownExternalCall` is the only recovery path after an external call becomes unknown; it can confirm an existing result or confirm that the call did not start and schedule a bounded retry.
- `listEvents` replays events for one scoped task by its own monotonic revision cursor.

The Worker remains inert by default. It runs the synthetic executor only when explicitly enabled:

```powershell
$env:WENMI_REBUILD_WORKER_SYNTHETIC = "1"
$env:WENMI_REBUILD_WORKER_ONCE = "1"
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js run dev:worker --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
```

Synthetic fault-injection flags used by tests:

- `WENMI_REBUILD_SYNTHETIC_CRASH_AFTER_CHECKPOINT=1`
- `WENMI_REBUILD_SYNTHETIC_CRASH_AFTER_EXTERNAL_START=1`
- `WENMI_REBUILD_SYNTHETIC_LEASE_MS=<milliseconds>`

For real PostgreSQL tests, provide a random `wenmi_rebuild_test_<suffix>` database. The migrator URL stays in `WENMI_REBUILD_DATABASE_URL`; the app-role URL is read from `WENMI_REBUILD_TEST_APP_DATABASE_URL`.

## PostgreSQL Guard

The guard row must be provisioned before migrations run. The migration runner validates:

- environment marker `wenmi-rebuild-local-v1`
- expected database name
- expected app and migrator roles
- actual current database, current role, and server port
- role flags are not superuser, createdb, createrole, replication, or bypassrls
- migration checksums and missing or unknown migration records

Use [scripts/provision-local-postgres.sql](scripts/provision-local-postgres.sql) as the committed template for a fresh local rebuild database. Supply passwords through `psql` variables or an external secret channel; do not write them into this repository.
