# Wenmi Rebuild Foundation

Batch 121 connects the preserved manual opening form to this independent backend: authenticated manual creation, the complete copied taxonomy used by the form, and book-profile GET/PUT with immutable profile revisions. Original opening inputs remain immutable. Profile revisions are independent of bookshelf archive/restore versions; profile saves update the bookshelf title in the same transaction. The author shell refreshes the shelf after a successful save. These are local rebuild capabilities, not a production cutover. Real team AI creation, setting/naming services, membership integration, public mail delivery and author-data migration remain separate unfinished work. See [batch 121](../coauthoring-v7/docs/worklists/REBUILD-MANUAL-INFORMATION-20260906-121.md) for current evidence.

Batch 108 creates the independent rebuild foundation only. It does not implement registration, login, paid member handling, author books, task execution, model calls, migration from the current production system, or production deployment.

Batch 109 adds only the isolated synthetic task recovery foundation. It verifies scoped enqueueing, leases, fencing tokens, checkpoints, cancellation, unknown external-call handling, retry bounds, transactional events, and cursor replay with synthetic owner/book IDs. It still does not expose unauthenticated product HTTP APIs, call real models, use real accounts, charge users, migrate production data, or deploy production services.

Batch 111 adds the isolated account core for local rebuild development. It provides PostgreSQL-backed login sessions, password verification and internal one-time email verification/password reset token services for tests and future mail integration. It does not expose public registration, public email verification, public password reset, real mail delivery, old account migration, admin self-registration, or production deployment.

Batch 113 adds the independent bookshelf metadata backend. It stores only rebuild-owned book metadata and append-only book operation audit events, exposes account-protected listing plus archive/restore HTTP routes, and provides an internal metadata-only create service for future manual book creation orchestration. It does not import old books, write author prose, project chapter progress, route old engines, expose a public full-book creation endpoint, cancel creative tasks after archival, or deploy production services.

Batch 115 adds the internal manual-book creation transaction. It stores one immutable `manual_opening_package` source, the rebuild book metadata row, an initial empty chapter directory metadata row, and book audit in one authenticated transaction. It does not expose the full manual creation HTTP success route, change the current manual form UI, create volume/chain/chapter content, call models, or claim literary validation.

Batch 110 migrates the protected author-side page UI into `apps/author-web`. The page source and public assets were copied from `coauthoring-v7/author-app/src` and `coauthoring-v7/author-app/public`, then adapted inside the rebuild app so runtime code does not import from the old workspace. The new shell keeps the public entry, signed-in home page, manual creation, information and setting pages, time machine, planning workspace, library content UI, and author task/team status content while replacing the outer navigation with two top buttons: the left button opens the bookshelf and the right button opens the five primary functions. Time-machine/library and volume/chain/chapter remain visible as second-level switches in the page shell.

The migrated author UI still talks only to the rebuild local API boundary. Author API paths are fixed to same-origin `/api`; the Vite development server proxies `/api` to the local rebuild API on port 43282. The copied legacy clients are intentionally not allowed to use arbitrary `VITE_API_ORIGIN` values, old production origins, or old workspace imports. Full account-backed author APIs are not implemented in this batch, so real unavailable operations must fail honestly until the later API work lands. Browser previews and visual checks can use the local Playwright fixture `.local/rebuild/ui-fixture110.mjs` by calling `installFixture(page)`; the fixture intercepts author API requests for explicit local validation and returns 503 for unknown API calls.

## Runtime

- Node.js: 24.19.0 verified in this batch
- npm: 12.0.2
- PostgreSQL: 18.x, loopback only on port 54329
- Author web: http://127.0.0.1:43280
- Admin web: http://127.0.0.1:43281
- API: http://127.0.0.1:43282

The protected HTTP surface is local-only in this batch. It accepts account and bookshelf routes only for explicit loopback Host values and write Origins from the local author/admin dev ports. It does not trust forwarded IP headers; rate limits use the direct socket address in this local setup, so this is not a production proxy configuration.

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

## Account Core

The backend package exports the batch 111 account API and the batch 112 self-profile API:

```ts
import {
  accountProfileSchema,
  accountProfileUpdateSchema
} from "@wenmi-rebuild/contracts";
import {
  createAccountCoreService,
  REBUILD_SESSION_COOKIE
} from "@wenmi-rebuild/backend";
```

The public HTTP routes are limited to:

- `POST /v1/auth/login`
- `GET /v1/auth/me`
- `GET /v1/auth/profile`
- `POST /v1/auth/profile`
- `POST /v1/auth/logout`
- `POST /v1/auth/password/change`
- `POST /v1/auth/sessions/revoke-others`

Successful auth responses use `{ data, meta: { requestId } }`, set `Cache-Control: no-store`, and store only a SHA-256 digest of the 256-bit session token in PostgreSQL. The cookie name is `wenmi_rebuild_session`, with `HttpOnly`, `SameSite=Lax`, `Path=/`, and a 24-hour absolute expiry. Email verification and password reset tokens are internal service results only in this batch; the raw token is returned to the in-process caller for tests or future mail adapters and is never persisted.

`GET /v1/auth/profile` returns `{ displayName, profileVersion }`. `POST /v1/auth/profile` accepts only `{ displayName, expectedVersion }`, rejects unknown fields, returns `409 ACCOUNT_PROFILE_CONFLICT` on a stale profile version, treats same-name updates as a no-op without a version bump, and keeps profile versioning separate from password credential versioning and session revocation.

## Bookshelf Core

The backend package exports the batch 113 bookshelf API:

```ts
import {
  bookLifecycleRequestSchema,
  bookListQuerySchema,
  bookRecordSchema
} from "@wenmi-rebuild/contracts";
import {
  createBookShelfService
} from "@wenmi-rebuild/backend";
```

The HTTP routes are account-protected and local-only:

- `GET /v1/v7/books`
- `POST /v1/v7/books/:bookId/archive`
- `POST /v1/v7/books/:bookId/restore`

`GET /v1/v7/books` returns `{ data: BookRecord[], meta: { requestId, nextCursor } }`, where `nextCursor` is always a string or `null`. Query parameters are strictly validated: `status=all|active|archived`, optional literal text search `q`, `limit` from 1 to 100, and an opaque cursor bound to the current owner and filter set. Results are ordered by `createdAt` and `bookId` descending, with database timestamps fixed to millisecond precision for stable JavaScript cursor comparisons.

Batch 114 updates the author-web bookshelf client to consume every page of that envelope before handing the existing UI a `BookRecord[]`. The client keeps the first request on `/api/v1/v7/books`, sends only encoded cursor query parameters for later pages, and treats missing metadata, invalid records, repeated cursors, duplicate book IDs, empty continuing pages, later-page failures, and cancellation as failed loads rather than partial success. The local browser fixture `.local/rebuild/ui-fixture110.mjs` now includes `meta.requestId` and `meta.nextCursor` so visual checks exercise the same envelope shape.

Archive and restore accept only `{ expectedVersion }`. Cross-owner or missing books return 404; stale versions return `409 BOOK_VERSION_CONFLICT`; already-archived or already-active requests with the current version are no-ops that do not increment `version` or duplicate audit events. Writes revalidate the authenticated account and session inside the same transaction before locking the book row. Book operation audit is append-only for the app role; audit insertion failure rolls back the associated metadata write.

`createBookFromSession(sessionToken, { title, idempotencyKey })` is an internal metadata-only service. It creates a `rebuild` engine book row for the authenticated owner, returns the same book for the same owner/key/input, and returns `409 BOOK_IDEMPOTENCY_CONFLICT` for the same owner/key with different normalized input. It is reserved for later manual-book orchestration and does not mean opening idea capture, outline/chapter creation, old-book migration, progress projection, archival task cancellation, or real creative workflow integration is complete.

Batch 115 also exports internal manual-book services:

- `createManualBookFromSession(sessionToken, { openingPackage, openingIdea?, idempotencyKey })`
- `readManualBookFromSession(sessionToken, bookId)`

The manual create service accepts the current author-web `OpeningPackage` shape through a strict runtime schema. Unknown fields such as client-supplied owner, book, member, candidate, or task identities are rejected. The schema preserves original string content, including spaces, line breaks, optional empty strings, array order, and object values; it rejects NUL and isolated surrogate characters before PostgreSQL sees the JSON. The bookshelf title is the only display-normalized field and is trimmed for `BookRecord`.

Idempotency is scoped to owner plus normalized key and binds to the complete manual source input, excluding the key itself. Object key order is normalized for hashing; array order and text changes remain meaningful. The same owner/key/input returns the original manual book even after archival without restoring it. The same owner/key with different input returns `409 BOOK_IDEMPOTENCY_CONFLICT`; a prior metadata-only book with the same key is not treated as a completed manual book. Different keys may create separate books even when the source content is identical.

Manual source rows live in `manual_book_opening_sources`, and empty chapter directory metadata lives in `manual_book_chapter_directories`. The app role can only `SELECT` and `INSERT` manual source rows. This batch stores deterministic source and empty directory metadata only; future contracts must still connect the public manual creation route, server-side drafts, real chapter directory entries, archive-time task handling, and author UI recovery.

Storage capacity is separate from model context capacity: `openingIdea` allows up to 5000 Unicode characters, field/array limits are explicit in the shared schema, and the stable serialized source JSON allows up to 256000 Unicode characters. Overflow rejects the entire transaction without truncating author text. A future public route must set and test a compatible HTTP body limit instead of inheriting the current 16 KB default unnoticed.

Batch 121 connects the manual opening information backend without changing the author UI. It adds `GET /v1/v7/opening-taxonomy`, `POST /v1/v7/opening-books`, `GET /v1/v7/books/:bookId/book-profile`, and `PUT /v1/v7/books/:bookId/book-profile`. These routes reuse the protected local hooks, accept trusted local `PUT`, use a 2 MiB body limit only on opening/profile write routes, and return the existing envelope shape plus `error.message`/`error.retryable` compatibility for frontend errors.

`POST /v1/v7/opening-books` is the public manual branch only. It rejects AI `taskId`/`candidateId` fields through strict schemas, applies the existing manual form rules before entering the create transaction, then reuses `createManualBookFromSession` so book metadata, immutable source, empty chapter directory, initial profile version, and audit remain atomic. Idempotent retry for an archived book returns `409 BOOK_VERSION_CONFLICT` with a restore hint rather than pretending the book is active.

Book profiles are immutable full JSON versions in `book_profile_versions`. `profile.version` is independent from bookshelf `book.version`: profile edits compare `expectedVersion` with the latest profile version, save a new profile version only on real changes, and update the bookshelf title in the same transaction for list consistency. Existing 0006 manual books read a deterministic version-1 projection without writing; the first real edit preserves that original projection as version 1 and writes the edited profile as version 2. Archive and restore change only bookshelf metadata and do not change profile versions.

The opening taxonomy used by the rebuild API is a frozen copy of the old pure taxonomy source under `packages/backend/src/application/bookshelf/taxonomy-source/`, projected to the current author-web `OpeningTaxonomy` fields. Profile projection follows the old information-page field ownership model: unknown opening details stay empty in the editable profile, raw author source remains immutable in `manual_book_opening_sources`, and source-derived long fields are rejected or saved as complete values without truncation.

## PostgreSQL Guard

The guard row must be provisioned before migrations run. The migration runner validates:

- environment marker `wenmi-rebuild-local-v1`
- expected database name
- expected app and migrator roles
- actual current database, current role, and server port
- role flags are not superuser, createdb, createrole, replication, or bypassrls
- migration checksums and missing or unknown migration records

Use [scripts/provision-local-postgres.sql](scripts/provision-local-postgres.sql) as the committed template for a fresh local rebuild database. Supply passwords through `psql` variables or an external secret channel; do not write them into this repository.
