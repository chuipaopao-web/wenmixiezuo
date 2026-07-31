# Existing Manuscript Continuation Implementation Plan

**Goal:** 让作者把已有数万字正文安全导入为可追溯前文基线，并由主编基于最小接续包继续讨论剧情和生成新章。

**Architecture:** 新增 `continuation_imports` 与逐章预览记录，确定性解析与作者确认分离。确认后复用 PromotionService、ChapterCatalogService 和 CanonService 逐章建立不可变正文及正史；前端正文空态提供导入向导，完成后提供“让主编接手续写”动作。

**Tech Stack:** TypeScript, Fastify, SQLite, React, Vite, Vitest.

## Task 1: Freeze the contract

- Update DECISIONS, PRODUCT, DATA_MODEL, API, RUNTIME_WORKFLOWS, MEMORY, ACCEPTANCE, TASKS and audit document.
- Verify spec has preview-zero-write, empty-book guard, explicit confirmation, idempotency and rollback.

## Task 2: Add forward-only schema and repository

- Create migration `0034_existing_manuscript_continuation.sql`.
- Add repository with owner/book scoped reads and writes.
- Add migration and isolation tests.

## Task 3: Implement parser, preview and confirmed import

- Add deterministic chapter parser with title editing and include/exclude preview.
- Add service state machine and immutable promotion.
- Settle confirmed imported chapters in order and preserve retry checkpoints.
- Add parser, service, duplicate retry, failure recovery and cross-book tests.

## Task 4: Add API and author UI

- Add preview/status/confirm endpoints.
- Add import wizard to the manuscript workspace empty state.
- Add file text loading, validation, warnings, chapter preview editing, confirmation and progress.
- Add CTA that sends an explicit continuation handoff request to the chief editor.

## Task 5: Verify continuation context and new writing path

- Confirm imported chapters are readable, indexed requests exist, the last tail is retrievable and normal future chapter pipeline still applies.
- Test typecheck, focused tests, full tests, build, empty/upgrade migrations, runtime, backup/restore, repository isolation and acceptance.
- Record evidence and commit.
