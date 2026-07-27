# Opening Auto Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute inline under the project single-developer rule. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recommend target-reader chips and automatically preselect eight relevant, removable opening tags from the chosen category and subjects.

**Architecture:** Keep the existing opening blueprint contract. The Web client derives reversible suggestions from the versioned taxonomy: audience chips serialize into the existing free-text field, while category or subject changes replace the initial eight tag suggestions. Manual tag edits remain untouched until the routing inputs change again.

**Tech Stack:** React, TypeScript, Vitest.

## Global Constraints

- Work only in `D:\wenmixiezuo`.
- Recommendations are soft directions, never canon or chapter requirements.
- No model call, API key, database migration or paid service.
- Existing free-text target readers and old opening blueprints remain valid.

---

### Task 1: Recommendation behavior

- [x] Add deterministic target-reader recommendations by channel and active tag packs.
- [x] Preselect exactly eight unique relevant tags when category or subjects change.
- [x] Keep all selected tags removable and allow replacement from the full library.

### Task 2: Regression and delivery

- [x] Cover automatic selection, deletion persistence and audience chip selection in UI tests.
- [x] Update decisions, product/API coverage and run typecheck, tests, build, migration and acceptance.
- [x] Commit a clean reversible snapshot.
