# 火山方舟套餐模型接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文秘写作在不允许按量计费回退的前提下，用本机 Codex 订阅通道的 GPT-5.6 Sol 承担主编和主笔，用火山方舟套餐的 DeepSeek V4 Pro、GLM 5.2、豆包和 Kimi K2.6 承担其余岗位，同时保留确定性假模型作为无凭证开发模式。

**Architecture:** 在 API 基础设施层增加严格订阅适配器与模型工厂。GPT-5.6 Sol 仅通过本机已登录 ChatGPT 的 Codex CLI 以 `read-only + ephemeral` 模式调用；方舟调用只允许 `https://ark.cn-beijing.volces.com/api/coding/v1/messages` 或 `/api/plan/v1/messages`。模型配置从环境变量装载，启动时为现有书籍创建新的不可变配置快照并切换 Agent 指针；讨论与章节流水线按快照解析适配器，不再硬编码确定性模型。当前 Codex 单独串行实现和复核，不调用其他开发 Agent。

**Tech Stack:** TypeScript 7、Node.js 24 原生 `fetch` 与 `child_process`、Codex CLI、Fastify、SQLite、React、Vitest、火山方舟 Anthropic Messages 兼容协议。

## Global Constraints

- 只修改 `D:\wenmixiezuo`；`D:\AI智囊团` 只读核对，不修改、不停止、不重启，也不形成运行时依赖。
- API Key 只从环境变量读取，不进入源码、SQLite、日志、聊天、上下文、备份、导出或 Git。
- 只允许 Coding Plan 与 Agent Plan 端点；禁止 `/api/v3`、`ep-*` 或任意普通按量计费回退。
- GPT-5.6 Sol 禁止走按 Token 计费的 OpenAI API，只允许本机 Codex/ChatGPT 订阅通道；Codex 子进程必须只读、临时，不调用其他开发 Agent。
- 现金费用始终记为 0；套餐不可用时失败关闭，开发和自动测试使用确定性假模型。
- 主笔 Codex GPT-5.6 Sol 与审校 Kimi K2.6 使用不同的 `provider + model_id`，不得冒充异模型复核。
- 既有模型配置快照和迁移不可改写；现有书籍只新增快照并更新当前 Agent 指针。
- 本次沿用 `release_id` `wm-v1-20260716-220959-d5dd704d`，作为首版可逆增量。

---

### Task 1: 严格订阅运行配置、九岗位提示词与适配器

**Files:**
- Create: `apps/api/src/infrastructure/models/model-runtime-config.ts`
- Create: `apps/api/src/infrastructure/models/ark-plan-model.ts`
- Create: `apps/api/src/infrastructure/models/codex-subscription-model.ts`
- Create: `apps/api/src/infrastructure/models/model-adapter-factory.ts`
- Create: `apps/api/src/domain/role-prompts.ts`
- Modify: `apps/api/src/infrastructure/runtime-config.ts`
- Test: `tests/foundation/model-runtime-config.test.ts`
- Test: `tests/foundation/ark-plan-model.test.ts`
- Test: `tests/foundation/codex-subscription-model.test.ts`
- Test: `tests/foundation/role-prompts.test.ts`

**Interfaces:**
- Consumes: `ModelAdapter`、`ModelRequest`、Node.js `fetch` 与 `NodeJS.ProcessEnv`。
- Produces: `loadModelRuntimeConfig(env)`、`roleModelProfiles`、九岗位完整定位提示词、`ArkPlanModelAdapter`、`CodexSubscriptionModelAdapter`、`ModelAdapterFactory.resolve(provider, modelId, purpose, roleKey)` 和不含密钥的运行摘要。

- [x] **Step 1: 写失败测试**

```ts
expect(loadModelRuntimeConfig({ WENMI_MODEL_MODE: 'subscription-plan' })).toMatchObject({
  activeMode: 'deterministic', missingCredentials: ['coding-plan', 'agent-plan']
});
expect(() => loadModelRuntimeConfig({
  WENMI_MODEL_MODE: 'subscription-plan',
  WENMI_ARK_CODING_PLAN_API_KEY: 'coding',
  WENMI_ARK_AGENT_PLAN_API_KEY: 'agent',
  WENMI_ARK_AGENT_PLAN_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3'
})).toThrow('只允许火山方舟套餐端点');
```

```ts
const adapter = new ArkPlanModelAdapter(options, async (url, init) => {
  expect(String(url)).toBe('https://ark.cn-beijing.volces.com/api/plan/v1/messages');
  expect(init?.headers).not.toEqual(expect.objectContaining({ 'x-api-key': expect.anything() }));
  return Response.json({ model: 'kimi-k2.6', content: [{ type: 'text', text: '结果' }], usage: { input_tokens: 8, output_tokens: 2 } });
});
expect(await adapter.generate(request)).toMatchObject({ cashCostCny: 0, output: '结果' });
```

- [x] **Step 2: 运行测试确认因缺少实现而失败**

Run: `npm test -- tests/foundation/model-runtime-config.test.ts tests/foundation/ark-plan-model.test.ts tests/foundation/codex-subscription-model.test.ts tests/foundation/role-prompts.test.ts`

Expected: FAIL，提示模块或导出不存在。

- [x] **Step 3: 实现配置、端点白名单、Messages 请求、取消和响应解析**

```ts
export type ModelPurpose = 'discussion' | 'novel_writer' | 'novel_reviewer';
export interface RoleModelProfile { provider: string; modelId: string; plan: 'deterministic' | 'coding' | 'agent' }

export function assertPlanBaseUrl(plan: 'coding' | 'agent', raw: string): string {
  const url = new URL(raw);
  const expectedPath = plan === 'coding' ? '/api/coding' : '/api/plan';
  if (url.protocol !== 'https:' || url.hostname !== 'ark.cn-beijing.volces.com' || url.pathname.replace(/\/$/u, '') !== expectedPath) {
    throw new Error('只允许火山方舟套餐端点');
  }
  return `${url.origin}${expectedPath}`;
}
```

默认角色绑定：主编和主笔使用 `openai-codex-subscription/gpt-5.6-sol`；编剧和版权顾问使用 Coding Plan DeepSeek V4 Pro；设定师和研究员使用 Agent Plan GLM 5.2；审校和文编使用 Agent Plan Kimi K2.6；体验官使用 Agent Plan 豆包 2.0 Pro。Kimi 2.7 在方舟官方目录和实际套餐探针中均不存在，不得伪造；未来上线后通过环境模型名切换。

- [x] **Step 4: 运行目标测试**

Run: `npm test -- tests/foundation/model-runtime-config.test.ts tests/foundation/ark-plan-model.test.ts tests/foundation/codex-subscription-model.test.ts tests/foundation/role-prompts.test.ts`

Expected: PASS；同时验证 AbortSignal、中断、Codex 子进程超时清理、只读临时参数、非200响应、空文本、密钥不进入错误文本和现金费用恒为0。

### Task 2: Agent 快照绑定和真实流水线解析

**Files:**
- Create: `apps/api/src/application/agents/model-binding-service.ts`
- Modify: `apps/api/src/application/agents/agent-team-service.ts`
- Modify: `apps/api/src/application/books/book-onboarding-service.ts`
- Modify: `apps/api/src/application/creation/writer-selection-service.ts`
- Modify: `apps/api/src/application/creation/chapter-batch-service.ts`
- Modify: `apps/api/src/application/creation/chapter-pipeline-service.ts`
- Modify: `apps/api/src/application/discussions/discussion-pipeline-service.ts`
- Modify: `apps/api/src/http/domain-routes.ts`
- Modify: `apps/api/src/http/server.ts`
- Modify: `apps/api/src/main.ts`
- Test: `tests/integration/runtime/model-binding.test.ts`
- Test: `tests/integration/domain/discussion-runtime.test.ts`
- Test: `tests/integration/creation/single-chapter-pipeline.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `roleModelProfiles` 和 `ModelAdapterFactory`。
- Produces: `ModelBindingService.bindAllBooks()`，以及讨论、写作、审校阶段按不可变快照选择真实适配器的行为。

- [x] **Step 1: 写失败测试，证明现有书籍需要新增快照而不是改写旧快照**

```ts
const previous = database.prepare('SELECT model_snapshot_id, provider FROM model_config_snapshots').all();
const result = new ModelBindingService(database, ids, clock, liveProfiles).bindAllBooks();
expect(result.updatedAgents).toBe(9);
expect(database.prepare('SELECT provider FROM model_config_snapshots WHERE model_snapshot_id = ?').get(previous[0]!.model_snapshot_id))
  .toEqual({ provider: previous[0]!.provider });
expect(team.list(scope).find((agent) => agent.roleKey === 'writer')).toMatchObject({
  provider: 'openai-codex-subscription', modelId: 'gpt-5.6-sol'
});
```

- [x] **Step 2: 运行模型绑定与流水线测试确认失败**

Run: `npm test -- tests/integration/runtime/model-binding.test.ts tests/integration/domain/discussion-runtime.test.ts tests/integration/creation/single-chapter-pipeline.test.ts`

Expected: FAIL，现有代码仍把流水线硬编码到确定性适配器。

- [x] **Step 3: 实现快照切换、旧选择失效和模型工厂注入**

```ts
const adapter = this.models.resolve(participant.provider, participant.model_id, 'discussion');
const writer = this.models.resolve(identity.provider, identity.modelId, 'novel_writer');
const reviewer = this.models.resolve(identity.provider, identity.modelId, 'novel_reviewer');
```

实时模式下老板已明确指定 Codex GPT-5.6 Sol 为主笔，因此主笔选择记录使用 `owner_specified` 单候选，不伪造盲测样章；确定性测试模式继续保留原有双候选验收夹具。

- [x] **Step 4: 增加审校 JSON 防护并验证完整章节流水线**

```ts
const review = parseStructuredReview(output);
if (!['pass', 'rewrite', 'blocked'].includes(review.verdict)) throw new Error('审校模型返回格式无效');
```

Run: `npm test -- tests/integration/runtime/model-binding.test.ts tests/integration/domain/discussion-runtime.test.ts tests/integration/creation/single-chapter-pipeline.test.ts`

Expected: PASS；伪造 `fetch` 返回完整章节、结构化审校和讨论意见，数据库中的 `model_calls`、正文版本和消息均记录真实套餐 provider/model。

### Task 3: 运行状态、设置页和桌面环境装载

**Files:**
- Modify: `apps/api/src/http/server.ts`
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Modify: `scripts/start-desktop.ps1`
- Test: `tests/integration/experience/workspace-ui.test.tsx`
- Test: `tests/integration/experience/workspace-api.test.ts`

**Interfaces:**
- Consumes: Task 1 的脱敏运行摘要。
- Produces: `/health.data.modelRuntime` 与设置页“模型运行”只读区；桌面启动器只把用户级环境变量传入子进程，不读取项目 `.env`。

- [x] **Step 1: 写失败体验测试**

```tsx
fireEvent.click(await screen.findByRole('button', { name: '界面设置' }));
expect(screen.getByText('火山方舟套餐')).toBeInTheDocument();
expect(screen.getByText('禁止按量计费回退')).toBeInTheDocument();
expect(screen.queryByText(/API[_ ]?KEY|Bearer/u)).not.toBeInTheDocument();
```

- [x] **Step 2: 实现脱敏健康状态和紧凑模型清单**

```ts
modelRuntime: {
  requestedMode: config.modelRuntime.requestedMode,
  activeMode: config.modelRuntime.activeMode,
  planOnly: true,
  cashFallbackAllowed: false,
  profiles: config.modelRuntime.publicProfiles
}
```

- [x] **Step 3: 桌面启动器仅同步允许的用户环境变量**

```powershell
foreach ($name in @('WENMI_MODEL_MODE', 'WENMI_ARK_CODING_PLAN_API_KEY', 'ARK_AGENTPLAN_KEY')) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if (-not [string]::IsNullOrWhiteSpace($value)) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
  }
}
```

- [x] **Step 4: 运行体验测试**

Run: `npm test -- tests/integration/experience/workspace-ui.test.tsx tests/integration/experience/workspace-api.test.ts`

Expected: PASS；UI显示套餐状态和五个真实模型，不显示任何密钥或按量计费配置。

### Task 4: 激活、迁移、运行与恢复验证

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/AGENT_SYSTEM.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/OWNER_GUIDE.md`
- Modify: `README.md`
- Modify: `TASKS.md`
- Create: `docs/releases/wm-v1-20260716-220959-d5dd704d/increments/2026-07-17-subscription-models.md`

**Interfaces:**
- Consumes: 已验证的 Coding Plan 配置和 Agent Plan 模型 ID。
- Produces: DEC-007、任务账本、使用说明、脱敏验收证据和可回滚提交。

- [x] **Step 1: 把已存在的 Coding Plan 密钥安全复制为用户级环境变量**

从本机 Claude 设置读取 `ANTHROPIC_AUTH_TOKEN`，只写入用户环境变量 `WENMI_ARK_CODING_PLAN_API_KEY`；同时写入不敏感的 `WENMI_MODEL_MODE=subscription-plan`、Codex 模型名和四个方舟模型名。命令不得回显密钥，也不得写入项目文件。

- [x] **Step 2: 完成全量质量门禁**

Run: `npm run typecheck`

Run: `npm run test`

Run: `npm run build`

Run: `npm run migrate`（空库与现有库各一次，再重复一次验证幂等）

Run: `npm run acceptance`

Expected: 全部 PASS；Schema 仍为9且无已合并迁移被修改。

- [x] **Step 3: 重启文秘写作并进行真实套餐烟雾验证**

只停止和启动文秘写作自身；验证 `/health` 显示 `activeMode=subscription-plan`，现有书籍9个Agent已绑定 Codex GPT-5.6 Sol 与四类方舟套餐模型，Worker ready，讨论任务产生真实 `model_calls`，现金费用仍为0。不得停止、重启或修改 AI智囊团。

- [x] **Step 4: 恢复与回滚验证**

运行现有备份恢复测试和数据库 `PRAGMA integrity_check` / `foreign_key_check`；记录 Git 回滚方式为对本增量提交执行 `git revert`。环境回滚只需把 `WENMI_MODEL_MODE` 改为 `deterministic`，不会删除模型调用、正文或快照历史。

- [ ] **Step 5: 自检、提交和推送**

Run: `git diff --check`

Run: `git status --short`

提交功能与证据，确认干净工作树后推送 `main` 到 `git@github.com:chuipaopao-web/wenmixiezuo.git`。

Expected: 本地 `HEAD` 与远端 `origin/main` 一致；验收证据中的提交哈希与实际一致。
