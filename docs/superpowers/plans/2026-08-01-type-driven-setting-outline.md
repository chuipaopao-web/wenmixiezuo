# Type-adaptive Setting Outline Implementation Plan

**Goal:** 让设定大纲按本书类型只激活真实需要的必须项和建议项，同时保留完整可搜索资料库，消除都市言情被游戏/玄幻类目锁死和前后端门禁漂移。

**Architecture:** 在API应用层新增纯函数类型画像解析器，读取现有不可变开书蓝图并返回 `profileKey/profileLabel/required/recommended`。`SettingBaselineService` 只用该画像计算准备状态；Web先读取readiness，再初始化活动条目，旧的无内容待讨论行隐藏且不阻断，已有内容、自定义项与主动加入项保持可见。无数据库迁移。

**Tech Stack:** React, TypeScript, Fastify, SQLite, Vitest.

## Task 1: Freeze specification and regression cases

- Add DEC-083, audit, task ledger and API/acceptance updates.
- Add failing domain tests for urban romance, game, fantasy, history, lord, mystery, sci-fi, fusion and legacy irrelevant rows.
- Add UI regressions for active required/recommended sections, inactive full catalog and no bulk initialization.

## Task 2: Implement one type-profile source

- Add a pure resolver with stable keys, labels, required and recommended arrays.
- Update readiness to inspect only active required items.
- Expose the profile through the existing readiness endpoint and Web client type.

## Task 3: Rebuild setting catalog activation

- Load readiness and saved workspace in one startup path.
- Initialize only required/recommended template items.
- Render required and recommended first; preserve custom or non-empty historical items.
- Put all inactive items behind a searchable “完整设定资料库” section with explicit “加入本书/跳转讨论”.

## Task 4: Verify compatibility and quality gates

- Run focused domain/UI tests, typecheck, full tests and build.
- Run migration twice, repository/backup/recovery and local HTTP probes.
- Validate the design audit, run acceptance and inspect the final diff for authority loss, context inflation, cross-book leakage and unrelated user changes.
