# Manuscript and Knowledge Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Project authority overrides delegation: the current Codex executes inline because `AGENTS.md` forbids other development agents.

**Goal:** Build one non-duplicated planning/manuscript/graph/library workspace with immutable owner edits, real rewrite/finalization workflow, protagonist state history, and safe attribute formulas.

**Architecture:** Keep SQLite as authority and immutable files as manuscript storage. Add focused application services for owner manuscript revisions and protagonist state/formulas, reuse the existing chapter pipeline for AI rewrite and three-seat finalization, and make graph data a rebuildable categorized projection.

**Tech Stack:** React, TypeScript, Vite, Fastify, Node.js stable LTS, SQLite, REST, existing Worker/SSE runtime.

## Global Constraints

- Work only in `D:\wenmixiezuo`; do not change, stop, or restart `D:\AI智囊团`.
- API keys come only from environment variables; tests use deterministic adapters and spend no cash.
- Existing migrations are immutable; add `0023_manuscript_protagonist_workspace.sql` only.
- Every record carries `owner_id` and `book_id`; manuscript content remains immutable.
- A finalize action must not bypass hard checks, three independent reviewers, editor synthesis, and owner confirmation.
- Use current checkout because the owner fixed the implementation directory and repository status was clean.

---

### Task 1: Freeze contracts and failing tests

**Files:**
- Modify: `docs/DECISIONS.md`
- Create: `docs/MANUSCRIPT_KNOWLEDGE_WORKSPACE_AUDIT.md`
- Test: `tests/integration/experience/workspace-ui.test.tsx`
- Test: `tests/integration/http/domain-routes.test.ts`
- Test: `tests/integration/db/migrations.test.ts`

**Interfaces:**
- Produces: DEC-041, DR-20260720-04, expected UI labels, API payload shapes, Schema 23 expectation.

- [ ] Add UI assertions that planning has `全书框架/基本设定/总纲/卷纲/章纲` and no `规划` chapter catalog; manuscript has persistent chapter rail, edit, rewrite, and finalize controls; library has a protagonist tab but no duplicate relation/emotion/foreshadowing graph tabs; graph has six category controls.
- [ ] Add API tests for immutable owner save, same-version conflict, settled edit rejection, rewrite scheduling, finalize scheduling, protagonist append/archive, formula validation/evaluation, and cross-book denial.
- [ ] Add migration assertions for new tables, constraints, indexes, and `creator_kind/edit_note` manuscript attribution columns.
- [ ] Run targeted tests and confirm failure before implementation: `npm test -- tests/integration/experience/workspace-ui.test.tsx tests/integration/http/domain-routes.test.ts tests/integration/db/migrations.test.ts`.

### Task 2: Add Schema 23 and safe formula core

**Files:**
- Create: `apps/api/src/infrastructure/db/migrations/0023_manuscript_protagonist_workspace.sql`
- Create: `apps/api/src/application/knowledge/attribute-formula-service.ts`
- Test: `tests/unit/knowledge/attribute-formula-service.test.ts`

**Interfaces:**
- Produces: `AttributeFormulaService.create/list/evaluate/archive` and `evaluateArithmetic(expression, variables)`.

- [ ] Add forward-only columns `creator_kind`, `edit_note` to manuscript versions with legacy defaults.
- [ ] Add `protagonist_profiles`, append-only `protagonist_state_entries`, and versioned `attribute_formulas` with scoped foreign keys and lookup indexes.
- [ ] Implement tokenization and recursive-descent arithmetic for numbers, declared identifiers, parentheses, unary signs, `+ - * / %`; reject invalid characters, unknown identifiers, division by zero, excessive depth, and non-finite results. Do not use `eval` or `Function`.
- [ ] Run `npm test -- tests/unit/knowledge/attribute-formula-service.test.ts tests/integration/db/migrations.test.ts` and require pass.

### Task 3: Add owner manuscript lifecycle and production scheduling

**Files:**
- Create: `apps/api/src/application/creation/owner-manuscript-service.ts`
- Modify: `apps/api/src/application/creation/chapter-batch-service.ts`
- Modify: `apps/api/src/application/creation/chapter-pipeline-service.ts`
- Modify: `apps/api/src/application/chapters/chapter-catalog-service.ts`
- Modify: `apps/api/src/application/tasks/task-service.ts`
- Modify: `apps/api/src/http/domain-routes.ts`
- Test: `tests/integration/creation/owner-manuscript-service.test.ts`
- Test: `tests/integration/creation/chapter-pipeline.test.ts`
- Test: `tests/integration/http/domain-routes.test.ts`

**Interfaces:**
- Produces: `saveDraft(scope,{chapterId,baseManuscriptVersionId,content,note})`, `scheduleRewrite(scope,chapterId,instruction)`, `scheduleFinalize(scope,chapterId,manuscriptVersionId)` and REST endpoints under `/chapters/:chapterId/manuscripts/*`.

- [ ] Save author text through `PromotionService`, create a synchronous audit task, register a new manuscript version with parent/hash/word count/manual attribution, and update the chapter current pointer using a base-version CAS.
- [ ] Supersede pending approval gates/confirmations for the edited parent; never mutate or delete prior manuscript files.
- [ ] Extend chapter creation pipeline preflight to honor a scoped task brief for `review_existing` or `rewrite_existing`, binding the specified current version after verifying same-book/same-chapter ownership.
- [ ] Finalize queues `review_existing`; rewrite queues `rewrite_existing` with one active structured revision order. Both retain the normal writer selection, lease, hard checks, three-seat review, editor synthesis, owner confirmation and settlement behavior.
- [ ] Remove/disable public direct select and settle shortcuts that could bypass the production gate; retain internal service calls used by confirmed settlement.
- [ ] Run lifecycle and pipeline tests and require old version hashes unchanged, current version updated, direct canon unchanged, and true queued tasks present.

### Task 4: Add protagonist state API

**Files:**
- Create: `apps/api/src/application/knowledge/protagonist-state-service.ts`
- Modify: `apps/api/src/http/domain-routes.ts`
- Test: `tests/integration/knowledge/protagonist-state-service.test.ts`
- Test: `tests/integration/http/domain-routes.test.ts`

**Interfaces:**
- Produces: profile list/upsert, state append/archive, formula list/create/evaluate/archive, and a dashboard response grouped by category with `confirmed` and `pending` lanes.

- [ ] Upsert a profile tied optionally to an existing character entity; require a non-empty display name and one primary profile per book.
- [ ] Append state revisions by logical key with value type/unit/category/status/effective chapter/source/canon revision and previous-entry link; return latest active projection while retaining history.
- [ ] Treat manual items as candidate until explicitly confirmed or tied to a settled canon fact. Archive creates a new archived revision; never delete a confirmed historical row.
- [ ] Expose scoped REST routes and prove cross-book reads/writes return denial.

### Task 5: Rework React workspace

**Files:**
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: manuscript and protagonist REST APIs from Tasks 3–4.
- Produces: persistent left chapter rail/right editor, planning tabs, categorized graph, protagonist/formula workbench.

- [ ] Replace planning tabs with full-book framework/basic settings/master/volume/chapter; map `creative_plan` to full-book framework and `story_bible` plus rule/formula artifacts to basic settings.
- [ ] Keep chapter browser visible as the left column at all times. Load selected content on the right; show textarea and save only for unsettled chapters, with dirty-state warning, base-version CAS, version/status notice, rewrite instruction dialog, and finalize submission.
- [ ] Make settled text read-only and label owner confirmation separately from “submitted for review”. Do not display a fake working state before the server returns a queued task.
- [ ] Add graph category tabs for relationship, emotion, mainline, subplot, hook, information gap; planned/actual tracks remain visible within relevant categories.
- [ ] Remove relation/emotion/foreshadowing graph views from the library. Add protagonist dashboard with grouped state cards, add/archive forms, property formula editor and calculator; keep generic characters/items/rules as source records.
- [ ] Use existing green design tokens, keyboard labels, focus states, reduced motion and responsive collapse; no new UI framework or marketing components.
- [ ] Run UI tests, typecheck and production build.

### Task 6: Verify, document, commit and back up

**Files:**
- Modify: `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md`, `docs/ACCEPTANCE.md`, `docs/DEVELOPMENT_ROADMAP.md`, `KNOWLEDGE.md`, `TASKS.md`
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/manuscript-knowledge-workspace-20260720.md`

**Interfaces:**
- Produces: complete current specifications, command evidence, Git commit and private remote backup.

- [ ] Run `git diff --check`, `npm run typecheck`, targeted tests, `npm test`, and `npm run build`.
- [ ] Run empty Schema 23 migration, Schema 22→23 upgrade, repeated migration, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, repository isolation, task recovery, and backup verification.
- [ ] Start only 文秘写作 API/Web/Worker on the configured loopback ports, probe health/readiness and the new endpoints, capture the rendered desktop layout, then stop only those processes.
- [ ] Run `npm run acceptance`; record exact counts and any evidence ceiling without claiming E3/E4.
- [ ] Update task status and evidence, commit all scoped files, push `main` to the configured private origin, and verify the remote commit hash.
