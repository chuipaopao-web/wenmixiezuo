# Conversation Reception Implementation Plan

> **For Codex:** Execute this plan in order and keep the entry endpoint idempotent. Do not treat page refresh as a new creative turn.

**Goal:** Every entry into a book's conversation shows an immediate, accurate Xiaowen secretary reception and resumes the one current workflow item without duplicate model calls or fake Agent status.

**Architecture:** Add a read-and-resume `conversation-entry` application operation to the existing modular monolith. It derives the next action from the current setting/planning state and real task records. The Web client invokes it only on an actual transition into chat; the response is an ephemeral reception card, while a real chief/deput editor task is scheduled only when no equivalent guidance task or reply exists.

**Tech Stack:** TypeScript, Fastify, React, SQLite, Vitest.

---

### Task 1: Freeze the runtime contract

**Files:**
- Modify: `docs/DECISIONS.md`
- Add: `docs/CONVERSATION_RECEPTION_AUDIT.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/RUNTIME_WORKFLOWS.md`
- Modify: `docs/API.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `TASKS.md`

1. Record deterministic secretary observation versus creative editor work.
2. Define idempotency, failure, candidate-confirmation and stage-transition behavior.
3. Record E2-only evidence limits and rollback conditions.

### Task 2: Write failing application and HTTP tests

**Files:**
- Modify: `tests/integration/domain/open-conversation-runtime.test.ts`
- Modify: `tests/integration/domain/api-flow.test.ts`

1. Prove a legacy/existing book without a current guidance task gets exactly one reception task.
2. Enter twice and prove the second entry reuses the task/reply.
3. Prove candidate awaiting confirmation and failed task states do not create duplicate calls.
4. Prove hidden entry triggers never appear in author messages and book isolation holds.

### Task 3: Implement idempotent conversation entry

**Files:**
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/http/domain-routes.ts`

1. Add a typed reception result derived from setting guidance, planning state, editor lease and real tasks.
2. Reuse a matching task/reply before scheduling.
3. Create a hidden entry trigger and actual active-editor reply task only when needed.
4. Make conversation reply scheduling safe when an idempotency key already exists.

### Task 4: Add the author-facing reception card

**Files:**
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`

1. Call the entry endpoint on selecting a book or returning from another book page to chat.
2. Display a compact Xiaowen secretary card with current item, real editor/task status and next action.
3. Avoid persistent duplicate secretary messages and avoid calling on polling refreshes.
4. Verify mobile and desktop layout, keyboard navigation and screen-reader status.

### Task 5: Verify and preserve evidence

**Files:**
- Add: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/conversation-reception-20260801.md`

1. Run targeted domain, HTTP and UI tests.
2. Run typecheck, all automated tests, build, migration/idempotency, runtime and recovery checks.
3. Run `git diff --check` and record actual evidence only.
