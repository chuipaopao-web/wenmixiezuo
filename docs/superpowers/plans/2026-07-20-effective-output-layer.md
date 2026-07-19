# 有效输出层实施计划

> **For agentic workers:** 本项目由当前Codex单独执行，禁止调用其他开发Agent。按本计划逐项完成红绿测试、实现、复核与证据留存。

**Goal:** 让小文秘书与创作成员默认只展示直接结论、关键依据、风险/未知和下一步，同时无损保留可展开的完整有效回复，不额外调用付费模型，也不压缩正式正文。

**Architecture:** 在API应用层增加纯函数式有效输出服务。模型优先按可版本化JSON合同自我编辑；服务端只做Schema解析、明显套话/完全重复段落清理和渐进披露，解析失败时保留完整回答。消息正文保存精简显示内容，完整允许展示的最终回答保存在同消息 `references_json` 的 `effective_output` 引用中；前端按需展开，不保存或展示思维链。

**Tech Stack:** TypeScript、Node.js、SQLite、React、Vitest、Testing Library。

## Global Constraints

- `release_id=wm-longform-r1-20260719-003435-e4d7b8b7`，`design_review_id=DR-20260720-02`。
- 只修改 `D:\wenmixiezuo`，不读取、修改、停止或重启 `D:\AI智囊团`。
- 不新增远程模型调用、现金fallback、API Key、数据库迁移或第12名创作Agent。
- 正式正文、试写正文与三席完整稿不经过消息压缩；剧情分歧、证据、风险、未知和需老板确认项不得静默丢失。
- 原始模型最终回答不是思维链；只保存允许展示的最终产物。解析或过滤置信不足时显示完整回答。

---

### Task 1: 有效输出纯服务

**Files:**
- Create: `apps/api/src/application/chat/effective-output-service.ts`
- Create: `tests/foundation/effective-output.test.ts`

**Interfaces:**
- Produces: `prepareEffectiveOutput(raw: string): EffectiveOutputResult`
- Produces: `effectiveOutputReference(result, fullContentOverride?): EffectiveOutputReference | null`
- `EffectiveOutputResult` 包含 `visibleContent`、`fullContent`、`filtered`、`format`。

- [ ] **Step 1: 写失败测试**

```ts
const result = prepareEffectiveOutput(JSON.stringify({
  answer: '建议先确认宣战目标。', keyPoints: ['双方兵力差距明确'],
  alternatives: [{ title: '缓攻', content: '先切断粮道', tradeoff: '节奏较慢' }],
  risks: ['旧盟约可能冲突'], questions: ['是否公开宣战？'], nextStep: '交给编剧估算跨度', details: '完整证据回链'
}));
expect(result.visibleContent).toContain('旧盟约可能冲突');
expect(result.visibleContent).not.toContain('完整证据回链');
expect(result.fullContent).toContain('完整证据回链');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx vitest run tests/foundation/effective-output.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现最小服务**

```ts
export interface EffectiveOutputResult {
  visibleContent: string;
  fullContent: string;
  filtered: boolean;
  format: 'structured' | 'fallback';
}

export function prepareEffectiveOutput(raw: string): EffectiveOutputResult {
  const structured = parseStructuredReply(raw);
  if (structured !== null) return renderStructuredReply(structured);
  const fullContent = removeOnlyCertainNoise(raw);
  return { visibleContent: fullContent, fullContent, filtered: fullContent !== raw.trim(), format: 'fallback' };
}
```

解析器必须限制字段类型和数组长度；fallback只删除确定无信息的独立套话行与完全重复段落，不做语义截断。

- [ ] **Step 4: 运行专项测试**

Run: `npx vitest run tests/foundation/effective-output.test.ts`

Expected: PASS；风险、未知、替代和问题全部保留，长单段回答不截断。

### Task 2: 接入真实回复与剧情汇总

**Files:**
- Modify: `apps/api/src/application/chat/conversation-reply-pipeline-service.ts`
- Modify: `apps/api/src/application/discussions/discussion-pipeline-service.ts`
- Test: `tests/integration/domain/open-conversation-runtime.test.ts`
- Test: `tests/integration/domain/discussion-runtime.test.ts`

**Interfaces:**
- Consumes: `prepareEffectiveOutput` 与 `effectiveOutputReference`。
- Produces: `message.content` 为精简内容；`references_json` 可含 `effective_output` 完整回复引用。

- [ ] **Step 1: 写失败集成测试**

```ts
expect(reply.content).not.toMatch(/下面我将|作为一名/u);
expect(JSON.parse(reply.references_json)).toEqual(expect.arrayContaining([
  expect.objectContaining({ type: 'effective_output', version: 1 })
]));
```

剧情汇总测试必须证明默认消息不再拼接所有岗位全文，但展开引用完整包含两名编剧意见、主编汇总和确认命令。

- [ ] **Step 2: 运行目标测试并确认失败**

Run: `npx vitest run tests/integration/domain/open-conversation-runtime.test.ts tests/integration/domain/discussion-runtime.test.ts`

Expected: FAIL，尚无输出引用或默认仍拼接全文。

- [ ] **Step 3: 接入岗位输出合同**

```ts
outputContract: {
  format: 'json_object',
  fields: ['answer', 'keyPoints', 'alternatives', 'risks', 'questions', 'nextStep', 'details'],
  rules: ['直接回答', '不得删除关键异议、来源、风险或未知', 'details只写可展示依据，不写思维链']
}
```

模型只调用一次。服务端解析后保存精简内容；讨论消息默认显示主编结论与确认动作，独立岗位全文放入同消息可展开引用。讨论决定继续保存人类可读的完整主编产物，不能把原始JSON写进规划成果。

- [ ] **Step 4: 运行目标测试**

Run: `npx vitest run tests/foundation/effective-output.test.ts tests/integration/domain/open-conversation-runtime.test.ts tests/integration/domain/discussion-runtime.test.ts`

Expected: PASS。

### Task 3: 前端渐进披露

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/app.css`
- Test: `tests/integration/experience/workspace-ui.test.tsx`

**Interfaces:**
- Consumes: `references_json` 中 `type='effective_output'`、`version=1`、`fullContent`。
- Produces: “查看完整回复/收起完整回复”按钮，附件引用解析保持兼容。

- [ ] **Step 1: 写失败UI测试**

```tsx
expect(screen.getByText('精简结论')).toBeInTheDocument();
expect(screen.queryByText('完整依据')).not.toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: '查看完整回复' }));
expect(screen.getByText(/完整依据/u)).toBeInTheDocument();
```

- [ ] **Step 2: 运行UI测试并确认失败**

Run: `npx vitest run tests/integration/experience/workspace-ui.test.tsx`

Expected: FAIL，展开按钮不存在。

- [ ] **Step 3: 实现展开与无障碍样式**

`MessageBubble` 独立维护展开状态；解析失败、非Agent消息或完整内容与显示内容相同均不显示按钮。按钮使用真实 `button`、明确 `aria-expanded`，不影响附件卡片和左右布局。

- [ ] **Step 4: 运行UI与无障碍测试**

Run: `npx vitest run tests/integration/experience/workspace-ui.test.tsx`

Expected: PASS，axe无新增违规。

### Task 4: 决定、规格、账本与发布证据

**Files:**
- Create: `docs/EFFECTIVE_OUTPUT_LAYER_AUDIT.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/PRODUCT.md`
- Modify: `docs/AGENT_SYSTEM.md`
- Modify: `docs/API.md`
- Modify: `docs/LONGFORM_QUALITY.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `TASKS.md`
- Create: `docs/releases/wm-longform-r1-20260719-003435-e4d7b8b7/evidence/effective-output-layer-20260720.md`

**Interfaces:**
- Produces: `DEC-039`、`DR-20260720-02`、E0—E2证据和回滚条件。

- [ ] **Step 1: 登记决定与两轮审查**

记录推荐方案、维持现状和二次远程总结三个选项；反例必须覆盖关键风险位于末尾、少数意见、坏JSON、长单段、重复段落、前端解析失败和正文误过滤。

- [ ] **Step 2: 运行审计校验与文档检查**

Run: `node .agents/skills/wenmi-longform-quality/scripts/validate-audit.mjs docs/EFFECTIVE_OUTPUT_LAYER_AUDIT.md`

Run: `git diff --check`

Expected: 两项均退出0。

- [ ] **Step 3: 完整质量门禁**

Run: `npm run typecheck`

Run: `npm run test`

Run: `npm run build`

Run: `npm run migrate`

Run: `npm run acceptance`

Expected: 全部退出0；迁移保持Schema 19且无新增迁移。

- [ ] **Step 4: 运行、恢复与提交**

启动文秘写作自身API/Web/Worker并检查健康；运行消息分页、任务恢复、备份恢复和跨书隔离专项。只提交本增量，不操作生产数据，不触碰智囊团。

## Self-Review

- 覆盖小文秘书、普通岗位、剧情汇总、完整依据展开、零额外远程调用与正文豁免。
- 所有新增字段均有具体类型；没有新增表或迁移。
- 没有未说明占位、静默语义截断或依赖其他开发Agent的步骤。
- 若结构化输出失败，fallback保留全部实质内容；若前端引用解析失败，仍显示消息正文。
