# Unified Setting Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing onboarding, chat and planning surfaces into one author-safe setting ingestion workflow with a universal configurable catalog and Wenji-owned semantic extraction.

**Architecture:** Keep SQLite artifacts and the existing story-bible candidate/version flow as authority. Reuse the opening deterministic analyzer for pre-book form assistance, route post-book source text through chat to the real setting role, and present one interactive catalog that links to candidate content without creating duplicate canon sources.

**Tech Stack:** React, TypeScript, Fastify, SQLite, Vitest, Testing Library.

## Global Constraints

- Work only in `D:\wenmixiezuo`; do not touch or restart `D:\AI智囊团`.
- Keep the fixed 11-member creative team; Wenji owns semantic extraction and Xiaowen owns deterministic routing.
- Preserve owner/book isolation, immutable artifact versions and source text.
- No candidate may silently replace active planning or enter canon.
- API keys remain environment-only; tests use deterministic adapters.
- Categories are optional organization aids, never mandatory generation constraints.

---

### Task 1: Freeze the universal catalog and role contract

**Files:**
- Modify: `docs/PRODUCT.md`
- Modify: `docs/AGENT_SYSTEM.md`
- Modify: `docs/API.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/COVERAGE_MATRIX.md`

**Interfaces:**
- Consumes: DEC-052.
- Produces: author-facing catalog, three-entry ingestion contract and Wenji/Xiaowen responsibility boundary.

- [ ] Specify universal groups, genre extensions, entity-vs-tag rules and candidate confirmation.
- [ ] Specify onboarding, chat and planning entry behavior with identical authority semantics.
- [ ] Add acceptance assertions for no twelfth role, no duplicate entity authority and no silent canon writes.

### Task 2: Make the existing catalog interactive and universal

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: existing `SETTING_CATALOG`, `SettingCatalog` and story-bible candidates.
- Produces: searchable group navigation, configured/pending/unconfigured states, universal groups and genre extension labels.

- [ ] Write failing UI tests for search, group selection, custom category affordance and human-readable states.
- [ ] Replace the static tag wall with group navigation and detail cards while retaining the existing planning page.
- [ ] Keep paste-and-delegate within the same workbench and preserve the 10,000-character limit.
- [ ] Run `npm test -- tests/integration/experience/workspace-ui.test.tsx`.

### Task 3: Unify post-book ingestion routing

**Files:**
- Modify: `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Test: `tests/integration/domain/conversation-reply-pipeline.test.ts`

**Interfaces:**
- Consumes: owner source message, role routing and existing story-bible candidate persistence.
- Produces: structured setting-extraction intent recognized from planning submission, explicit Wenji request or owner-confirmed discussion.

- [ ] Write failing tests proving ordinary brainstorming is not persisted and explicit extraction creates only a candidate.
- [ ] Generalize the current exact-string detector into a bounded extraction-intent contract.
- [ ] Preserve source message ID, source kind and unknown/conflict fields in the candidate.
- [ ] Run the focused conversation tests.

### Task 4: Align onboarding with the unified flow

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/api/src/application/books/opening-synopsis-analysis-service.ts`
- Test: `tests/foundation/opening-synopsis-analysis.test.ts`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: current stateless 5,000-character analyzer.
- Produces: form-fill candidates using the same universal category vocabulary without pre-book model calls.

- [ ] Preserve manual values and fill only empty fields.
- [ ] Return explicit category/entity hints without inventing unsupported facts.
- [ ] On book creation, keep confirmed form values in the current onboarding snapshot; do not create a hidden second source.
- [ ] Run onboarding unit and UI tests.

### Task 5: Verification and evidence

**Files:**
- Modify: `TASKS.md`
- Modify: `KNOWLEDGE.md`
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/unified-setting-ingestion-20260726.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: reproducible E2 evidence and rollback boundary.

- [ ] Run typecheck, focused tests, full tests and production build.
- [ ] Run empty/upgrade migration verification and local API/web smoke checks.
- [ ] Record that semantic extraction quality remains E1/E2 until real-model gold evaluation; do not claim literary improvement.
- [ ] Commit only after `git diff --check` and evidence review pass.
