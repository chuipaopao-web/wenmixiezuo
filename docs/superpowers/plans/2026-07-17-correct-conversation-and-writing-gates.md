# Correct Conversation And Writing Gates Implementation Plan

> **For agentic workers:** Execute inline in the current session. `AGENTS.md` explicitly forbids delegating business-code work to other development agents.

**Goal:** Make every natural boss message receive a real, traceable response, make creative intent open a relevant role discussion, and prevent any chapter task from starting before a boss-confirmed plan and grounded chapter outline exist.

**Architecture:** Keep deterministic control commands synchronous, but route open conversation and role discussions through persistent Worker tasks. A focused readiness service owns chapter gates, while a planning-artifact service converts only boss-confirmed discussion decisions into selected, versioned planning artifacts. The chapter pipeline consumes those artifacts and never invents generic plot facts.

**Tech Stack:** TypeScript, Fastify, Node.js built-in SQLite, React, Vitest, REST, persistent Worker tasks.

## Global Constraints

- Work only in `D:\wenmixiezuo`; do not modify, stop, or restart `D:\AI智囊团`.
- API keys remain environment-only; model calls have zero cash fallback.
- Ordinary messages are bounded context, not persistent canon memory.
- Explicit pause/resume/cancel/takeover/confirmation commands remain zero-model operations.
- No chapter is scheduled without a boss-confirmed planning decision and selected chapter outline for every requested chapter.
- Existing user data is preserved; cancelled, manuscript-free chapter shells may be safely reused.

---

### Task 1: Lock the regression contract

**Files:**
- Create: `tests/integration/domain/open-conversation-runtime.test.ts`
- Create: `tests/integration/creation/writing-readiness.test.ts`
- Modify: `tests/integration/domain/discussion-runtime.test.ts`
- Modify: `tests/helpers/domain-fixture.ts`

**Interfaces:**
- Consumes: `ConversationService.sendBossMessage`, `TaskService.claimNext`.
- Produces: test helper `prepareBookForWriting(context, scope, ids, clock, count)`.

- [ ] Add a failing test proving `你好啊` schedules `conversation_reply`, the Worker call creates a chief-editor message, and no canon memory is written.
- [ ] Add a failing test proving `我想写一本游戏文` schedules a two-role planning discussion without requiring the `讨论` prefix.
- [ ] Add a failing test proving `写1章` on an unprepared book creates no chapter and no chapter task, and instead schedules planning.
- [ ] Add a failing test proving the direct batch service rejects missing confirmed planning artifacts with a 409 domain error.
- [ ] Run `npm test -- tests/integration/domain/open-conversation-runtime.test.ts tests/integration/domain/discussion-runtime.test.ts tests/integration/creation/writing-readiness.test.ts`; expect failures for the missing runtime/gate behavior.

### Task 2: Add traceable open conversation replies

**Files:**
- Create: `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/http/server.ts`
- Modify: `apps/worker/src/runtime/worker-loop.ts`
- Modify: `apps/worker/src/health/heartbeat.ts`

**Interfaces:**
- Produces: `ConversationReplyPipelineService.executeClaimed(scope, taskId, workerId)`.
- Produces task type `conversation_reply` with brief `{ conversationId, messageId, content }`.

- [ ] Schedule unmatched non-creative messages for the active chief editor with an immutable context pack containing the target message, at most 12 earlier messages, the selected story bible, and confirmed decisions.
- [ ] Call the assigned chief-editor model with purpose `discussion`, cash fallback disabled, save the real provider/model identity on the reply, then complete the task.
- [ ] Register `conversation_reply` in API Worker dispatch and Worker task capabilities.
- [ ] Run the open-conversation test; expect the chief-editor reply and one succeeded, context-bound model call.

### Task 3: Make creative chat a real role discussion

**Files:**
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/application/discussions/discussion-pipeline-service.ts`
- Modify: `tests/integration/domain/discussion-runtime.test.ts`

**Interfaces:**
- Discussion brief adds `purpose: 'open_discussion' | 'creative_planning'` and `requestedChapterCount: 1 | 3 | 4 | 5 | null`.
- Creative-intent routing activates chief editor plus one relevant role.

- [ ] Route natural creative intent such as `我想写一本游戏文` to `creative_planning`; retain `讨论 <问题>` as an explicit `open_discussion` shortcut.
- [ ] Execute the specialist first, then give the chief editor the specialist output as a hard source and request an actionable synthesis.
- [ ] Store the chief editor's actual output as the decision recommendation and visible agent message; remove the hard-coded “可逆小步方案” response.
- [ ] Run discussion tests; expect both real opinions, actual chief-editor output, and a boss-confirmation command.

### Task 4: Materialize confirmed planning and enforce readiness

**Files:**
- Create: `apps/api/src/application/artifacts/planning-artifact-service.ts`
- Create: `apps/api/src/application/creation/writing-readiness-service.ts`
- Modify: `apps/api/src/application/chat/conversation-service.ts`
- Modify: `apps/api/src/application/creation/chapter-batch-service.ts`
- Modify: `tests/helpers/domain-fixture.ts`
- Modify: all tests that intentionally start chapter creation.

**Interfaces:**
- Produces: `PlanningArtifactService.promoteConfirmedDecision(scope, discussionId, decisionId, chapterCount)`.
- Produces: `WritingReadinessService.inspect(scope, count)` and `assertReady(scope, count)`.

- [ ] On `确认方案 <id>` for `creative_planning`, create or version-select `creative_plan`, `story_bible`, `master_outline`, and one grounded `chapter_outline` per requested chapter; every outline records `sourceDiscussionId` and `sourceDecisionId`.
- [ ] Readiness requires all requested chapter numbers to have a selected outline whose source decision is boss-confirmed, plus active creative plan, story bible, and master outline.
- [ ] If `写N章` is not ready, create no chapter; reuse an active planning discussion or schedule one explaining the missing materials.
- [ ] Make `ChapterBatchService` enforce the same readiness invariant so the REST shortcut cannot bypass chat.
- [ ] Permit reuse only of cancelled/failed, manuscript-free chapter shells and use a new task idempotency attempt key.
- [ ] Run readiness, workspace API, and creation tests; expect unprepared creation blocked and prepared creation unchanged.

### Task 5: Remove invented creation data

**Files:**
- Modify: `apps/api/src/application/creation/chapter-pipeline-service.ts`
- Modify: `apps/api/src/application/projections/narrative-projection-service.ts`
- Modify: `tests/integration/creation/single-chapter-pipeline.test.ts`
- Modify: `tests/integration/experience/projections-research.test.ts`

**Interfaces:**
- Chapter preflight consumes the selected grounded outline and versions a writing contract; it never creates plot beats.
- Settlement state contains source manuscript identity and exact ending excerpt, not invented people, locations, or hooks.

- [ ] Replace the generic “观察异常/更高层灯亮起” outline creation with readiness lookup.
- [ ] Add selected creative plan, story bible, master outline, chapter outline, and writing contract to the draft context hard sources.
- [ ] Replace hard-coded `林澈/北塔/第三个日期` fact and settlement values with an exact ending excerpt from the selected manuscript.
- [ ] Keep all five projection tracks honest by marking absent derived dimensions as `not_extracted` with source identifiers instead of fictional content.
- [ ] Run chapter and projection tests; assert production records contain none of the removed fixture-only names.

### Task 6: Align the visible workflow and documentation

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `tests/integration/experience/workspace-ui.test.tsx`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/API.md`
- Modify: `TASKS.md`
- Modify: `docs/releases/wm-v1-20260716-220959-d5dd704d/ACCEPTANCE_MATRIX.md`
- Create: `docs/releases/wm-v1-20260716-220959-d5dd704d/stages/09-conversation-writing-gates.md`

**Interfaces:**
- Quick-write buttons send the same `写N章` conversational command and cannot bypass readiness.
- Conversation empty-state and composer copy explain natural discussion and confirmation-before-writing.

- [ ] Route UI write buttons through `sendMessage`; add task labels for conversation and discussion tasks.
- [ ] Show the speaking member avatar on agent messages and replace obsolete offline-capability copy.
- [ ] Record the corrected workflow, source decision, affected files, rollback, and evidence in current docs.
- [ ] Run UI tests and build.

### Task 7: Full verification, recovery, and Git backup

**Files:**
- Modify: release task ledger and stage evidence files with exact command outputs.

**Interfaces:**
- Produces a verified Git commit on `main` and pushes it to `git@github.com:chuipaopao-web/wenmixiezuo.git`.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run clean and upgrade migration verification.
- [ ] Restart only the 文秘写作 services through the desktop launcher, verify API/Worker/Web readiness, and never touch `D:\AI智囊团`.
- [ ] Verify the cancelled bad task produced no manuscript, then exercise greeting reply, planning discussion, confirmation, and grounded write scheduling on a disposable verification book.
- [ ] Run backup create/verify and recovery checks.
- [ ] Commit the code and evidence, push `main`, and verify local/remote commit hashes match.

## Self-Review

- Spec coverage: natural replies, automatic creative discussion, explicit confirmation, readiness, direct-API protection, grounded context, honest settlement, UI copy, recovery, and Git backup are covered.
- Placeholder scan: no deferred implementation markers or unscoped error-handling steps remain.
- Type consistency: discussion purpose, requested count, planning promotion, readiness inspection, and Worker task names are defined once and consumed consistently.
