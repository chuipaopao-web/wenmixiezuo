# Dynamic Opening Tag Library Implementation Plan

> **For agentic workers:** This plan is executed inline by the current Codex because project rules prohibit delegating business code to other development agents.

**Goal:** Build a versioned, high-coverage opening tag library that loads only common and selected primary/auxiliary genre packs.

**Architecture:** Keep the API as the single taxonomy source. Split genre-pack data from opening validation, add one primary plus up to three auxiliary classifications, and expose grouped tags to the Web client. The UI renders recommended groups first and only expands relevant packs; selected tags remain soft directions except explicit boundaries.

**Tech Stack:** TypeScript, Fastify contracts, React, Vitest.

## Global Constraints

- Work only in `D:\wenmixiezuo`; do not touch or restart `D:\AI智囊团`.
- No paid API, new credential, database service, or destructive migration.
- Preserve old `categoryKey`; add auxiliary category keys compatibly.
- Main/auxiliary/story/custom/boundary limits become 8/11/11/13/15.
- Tags do not automatically become canon or mandatory generation constraints.

---

### Task 1: Versioned tag-pack contract

**Files:**
- Create: `apps/api/src/contracts/opening-tag-library.ts`
- Modify: `apps/api/src/contracts/opening-blueprint.ts`
- Test: `tests/foundation/opening-taxonomy.test.ts`

- [ ] Add common and genre-specific tag groups with stable keys, descriptions, category mappings and three tag lanes.
- [ ] Add `auxiliaryCategoryKeys` with same-channel, uniqueness and maximum-three validation.
- [ ] Raise all agreed selection limits and cover them with contract tests.

### Task 2: Dynamic creation UI

**Files:**
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

- [ ] Show a selected classification strip with one primary and up to three auxiliary classifications.
- [ ] Filter tag sections to common plus selected classification packs.
- [ ] Keep the full library behind an explicit expandable browser/search interaction.
- [ ] Submit primary and auxiliary category keys and preserve keyboard-accessible controls.

### Task 3: Specifications and evidence

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/API.md`
- Modify: `docs/COVERAGE_MATRIX.md`
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/dynamic-opening-tag-library-20260727.md`

- [x] Record authority, soft-direction semantics, UI behavior and rollback.
- [x] Run targeted tests, typecheck, full tests, build and migration verification.
- [x] Record exact commands and results, then commit.
