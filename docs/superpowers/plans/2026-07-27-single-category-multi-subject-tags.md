# Single Category, Multi-Subject Tag Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute inline under the project single-developer rule. Steps use checkbox syntax for tracking.

**Goal:** Replace auxiliary categories with one category, multiple subjects and a dynamically ranked full tag library.

**Architecture:** Keep stored opening blueprints compatible. New clients submit one `categoryKey`, store selected subjects in the existing `auxiliaryTags` slot, and never submit auxiliary categories. The taxonomy exposes versioned subject-to-pack routing; tags remain soft directions.

**Tech Stack:** TypeScript, React, Fastify contracts, Vitest.

## Global Constraints

- Work only in `D:\wenmixiezuo`.
- No database migration; old drafts remain readable.
- Classification is single-select; subjects are multi-select with a maximum of eight.
- Full tags are grouped/searchable and never rendered as one unbounded wall.
- Ordinary tags never become canon or hard chapter rules.

---

### Task 1: Contract and compatibility

- [x] Add versioned subject options with pack routing.
- [x] Convert legacy auxiliary category keys into subject names during validation.
- [x] Keep old JSON readable and expose the complete grouped tag catalog.

### Task 2: Creation UI

- [x] Restore single-select category cards.
- [x] Add multi-select subject section with recommended-first and full expansion.
- [x] Make tag group tabs and global search always available.
- [x] Preserve selected tags when category, subject or active group changes.

### Task 3: Tests and evidence

- [x] Cover single category, cross-category subjects, dynamic routing and legacy conversion.
- [x] Run typecheck, all tests, build, migration and acceptance audit.
- [x] Commit a clean, reversible Git snapshot.
