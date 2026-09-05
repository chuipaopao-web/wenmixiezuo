# Wenmi Rebuild Foundation

Batch 108 creates the independent rebuild foundation only. It does not implement registration, login, paid member handling, author books, task execution, model calls, migration from the current production system, or production deployment.

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
node D:\wenmixiezuo\.local\rebuild\runtime\npm\bin\npm-cli.js run build --cache D:\wenmixiezuo\rebuild\.tools\npm-cache
```

If a normal npm executable is available in PATH, the same scripts can be run with `npm`. Use `npm ci` for reproducible installation from `package-lock.json`.

## PostgreSQL Guard

The guard row must be provisioned before migrations run. The migration runner validates:

- environment marker `wenmi-rebuild-local-v1`
- expected database name
- expected app and migrator roles
- actual current database, current role, and server port
- role flags are not superuser, createdb, createrole, replication, or bypassrls
- migration checksums and missing or unknown migration records

Use [scripts/provision-local-postgres.sql](scripts/provision-local-postgres.sql) as the committed template for a fresh local rebuild database. Supply passwords through `psql` variables or an external secret channel; do not write them into this repository.
