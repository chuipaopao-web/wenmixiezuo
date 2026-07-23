# Fanqie-style Complete Onboarding Implementation Plan

> **For Codex:** Execute this plan inline in the current release workspace. The project forbids delegating business code to development agents; no separate executing agent is used.

**Goal:** Replace the two-field book dialog with a complete, validated opening blueprint, a versioned Fanqie-style local taxonomy, candidate protagonist projections, and a real chief-editor kickoff task.

**Architecture:** Keep the existing modular monolith. Extend positioning drafts with JSON, persist an immutable per-book blueprint in SQLite, expose a read-only taxonomy contract, and queue the kickoff through the existing task/worker/model pipeline. Do not make the taxonomy or blueprint canon.

**Tech Stack:** React, TypeScript, Vite, Fastify, Node SQLite, existing REST/task/worker contracts.

### Task 1: Freeze contracts and failing tests

**Files:** `apps/api/src/contracts/opening-blueprint.ts`, `tests/foundation/opening-taxonomy.test.ts`, `tests/integration/domain/positioning-onboarding.test.ts`, `tests/integration/experience/workspace-ui.test.tsx`.

Add tests for channel/category matching, 2—5 main tags, required fields, multiple protagonists, invalid custom category, old-draft compatibility, atomic rollback and new UI payload. Run target tests and verify they fail for the expected missing implementation.

### Task 2: Add forward-only persistence

**Files:** `apps/api/src/infrastructure/db/migrations/0025_opening_blueprints.sql`, `apps/api/src/domain/positioning.ts`, `apps/api/src/application/books/positioning-service.ts`, `apps/api/src/application/books/book-onboarding-service.ts`, migration/domain tests.

Add draft JSON and immutable blueprint table. Validate and store the blueprint, create candidate protagonist profile/state entries, include the blueprint in the story bible, and keep the whole operation atomic. Verify empty and upgraded databases.

### Task 3: Add taxonomy and API contracts

**Files:** `apps/api/src/contracts/opening-blueprint.ts`, `apps/api/src/http/domain-routes.ts`, `apps/web/src/lib/api/client.ts`, API tests.

Return the versioned local catalog. Accept `openingBlueprint` in draft creation and return `kickoffTaskId` after confirmation. Preserve old request fields for compatibility.

### Task 4: Queue truthful proactive guidance

**Files:** `apps/api/src/application/books/book-onboarding-service.ts`, `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`, `apps/api/src/application/chat/conversation-service.ts`, worker/integration tests.

Create a hidden onboarding trigger and a unique queued conversation-reply task assigned to the active editor. Exclude the trigger from visible message history. Make the prompt summarize known/pending/conflicting information and ask at most three questions; prohibit prose generation.

### Task 5: Replace the Web dialog

**Files:** `apps/web/src/app/onboarding-tags.ts`, `apps/web/src/app/App.tsx`, `apps/web/src/app/app.css`, `apps/web/src/lib/api/client.ts`, UI tests.

Load the taxonomy, render required basics/protagonists/background/stage-one/outline/map/constraints and hierarchical tags. Keep the creative-freedom notice visible, provide custom tags, accessible errors and a compact scrollable layout.

### Task 6: Verification and evidence

Run target tests, typecheck, full tests, build, empty/upgrade migrations, local API/Web/Worker probes, repository/cross-book/recovery tests, acceptance and `git diff --check`. Record existing unrelated baseline failures separately. Update TASKS and release evidence, then commit only after all required gates pass.
