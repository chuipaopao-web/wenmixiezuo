# Opening Story Direction Implementation Plan

**Goal:** 新建书籍必须提供简短、可修订的故事方向，让主编、设定讨论和剧情总纲始终围绕作者意图工作，而不把该方向冒充正史或详细大纲。

**Architecture:** 在现有 `openingBlueprint` JSON 合同中增加 `storyDirection`，不新增数据库表或迁移。新书入口校验20—800字；不可变开书快照、本书资料、主编开场和规划讨论资料包读取同一字段。旧书通过旧 `fullBookOutline` 只读回退，仍无内容时显示“尚未提供”。正文流水线不重复注入该字段，只继承已确认总纲与章纲。

**Tech Stack:** React, TypeScript, Fastify, SQLite, Vitest.

## Task 1: Freeze contract and tests

- Add DEC-078, design audit and task ledger entry.
- Add failing tests for required length, old-book compatibility, onboarding persistence/kickoff, planning compaction and author UI.

## Task 2: Implement the data flow

- Extend API/Web opening blueprint contracts.
- Validate and persist `storyDirection` in the existing immutable opening snapshot.
- Use the direction as positioning premise instead of the category label.
- Include the direction in story bible opening reference, editor kickoff and bounded planning packets.

## Task 3: Implement the author experience

- Add the required textarea after protagonists and before tags.
- Explain that it is a soft direction, not canon or a full outline.
- Display it in “本书资料” with source/version semantics.

## Task 4: Compatibility and verification

- Keep old books readable; prefer `storyDirection`, then legacy `fullBookOutline`, then empty fallback.
- Run focused tests, typecheck, full tests, build, migration idempotency, runtime health, backup verification, acceptance and diff checks.
- Perform a single-developer review for authority leakage, context duplication, cross-book scope and UI technical-field exposure.
