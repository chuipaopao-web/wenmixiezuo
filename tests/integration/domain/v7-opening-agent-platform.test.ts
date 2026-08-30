import { afterEach, describe, expect, it } from 'vitest';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import {
  V7OpeningAgentModelGateway,
  type V7OpeningModelAdapterResolver
} from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { membershipGenerationBlockReason } from '../../../apps/api/src/infrastructure/security/membership-service.js';
import { V7OpeningAgentRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-opening-agent-repository.js';
import { V7PromptGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-prompt-governance-repository.js';
import { parseMemberRoster } from '../../../apps/api/src/application/books/v7-opening-agent-service.js';
import { validateV7OpeningPackage } from '../../../apps/api/src/application/books/v7-opening-package-contract.js';
import { V7_OPENING_MEMBERS, type OpeningModelRequest } from '@wenmi/v7-backend';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, FixedClock, type TestContext } from '../../helpers/test-context.js';

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

describe('V7历史开书任务名册恢复', () => {
  it('无冻结快照的历史任务继续恢复旧八人成员表', () => {
    const historical = parseMemberRoster(null);
    expect(historical).toHaveLength(V7_OPENING_MEMBERS.length);
    expect(historical.map((member) => member.memberKey)).toEqual(
      V7_OPENING_MEMBERS.map((member) => member.memberKey)
    );
    expect(historical.some((member) => member.memberKey.startsWith('screenwriter-'))).toBe(true);
  });

  it('按旧任务冻结的六人成员表恢复，不要求补入后来新增的成员', () => {
    const snapshot = [
      ['chief-deepseek-v4-pro', true, 1],
      ['chief-glm-5-3', false, 2],
      ['chief-kimi-k3', false, 3],
      ['screenwriter-deepseek-v4-pro', true, 1],
      ['screenwriter-doubao-seed-2-1-turbo', false, 2],
      ['screenwriter-kimi-k3', false, 3]
    ].map(([memberKey, defaultForRole, fallbackPriority]) => ({
      memberKey,
      enabled: true,
      defaultForRole,
      fallbackPriority,
      promptInstruction: ''
    }));

    const historical = parseMemberRoster(JSON.stringify(snapshot));

    expect(historical).toHaveLength(6);
    expect(historical.map((member) => member.memberKey)).toEqual(snapshot.map((member) => member.memberKey));
    expect(historical.find((member) => member.memberKey === 'screenwriter-kimi-k3')?.displayName).toBe('清照');
    expect(historical.some((member) => member.memberKey === 'screenwriter-deepseek-v4-flash')).toBe(false);
  });

  it('历史任务列表可只读展示旧排序，恢复执行仍保持严格校验', () => {
    const snapshot = V7_OPENING_MEMBERS.map((member) => ({
      memberKey: member.memberKey,
      displayName: member.displayName,
      roleKey: member.roleKey,
      model: { ...member.model },
      enabled: member.enabledByDefault,
      defaultForRole: member.defaultForRole,
      fallbackPriority: member.roleKey === 'screenwriter' ? 1 : member.fallbackPriority,
      promptInstruction: ''
    }));

    expect(() => parseMemberRoster(JSON.stringify(snapshot))).toThrow(/备用优先级不能重复/u);
    expect(parseMemberRoster(JSON.stringify(snapshot), false)).toHaveLength(snapshot.length);
  });
});

const WORK_ORDER = {
  corePremise: '现代青年张三穿越三国乱世，从流民起步改变自己与百姓命运。',
  mustKeep: ['张三是穿越者', '背景是三国乱世'],
  preferences: ['从底层起步'],
  openDecisions: ['最终阵营'],
  intendedExperience: '让读者看到小人物靠判断与行动逐步立足。',
  designResponsibilities: ['明确时代处境', '建立持续矛盾'],
  prohibitions: ['不提前拆分具体分卷']
};

const PACKAGE = {
  title: '三国：从流民开始',
  positioning: {
    publishingPlatform: 'fanqie',
    channel: 'male', category: '历史脑洞', genres: ['历史脑洞', '秦汉三国', '穿越'],
    tags: ['成长', '权谋', '智商在线', '群像'],
    coreAppeal: '现代普通人从乱世底层起步，靠判断、协作和承担责任逐步改变命运。',
    expectedTotalWords: 3_000_000
  },
  backgrounds: {
    eraAndWorld: '东汉末年，黄巾余波未平，地方秩序松动。'
  },
  protagonists: [{
    name: '张三', age: '23岁', identity: '男主',
    background: '熟悉基础历史脉络，但没有万能技术手册。',
    familyBackground: '现代普通家庭出身，穿越后没有可依靠的宗族。',
    careerBackground: '穿越前是普通职员，擅长整理信息和协调同伴。',
    goldenFinger: '无额外系统，主要依靠现代常识、观察力和复盘能力。',
    visualIdentity: {
      appearance: '五官端正、目光沉静',
      build: '身形精干、耐力较好',
      signatureFeature: '左眉浅痕、旧布护腕'
    },
    personality: ['谨慎', '有同理心']
  }],
  longTermDirection: {
    centralConflict: '个人求生与乱世权力扩张持续冲突。',
    progression: '先带同伴活下来，再取得立足之地，最终有能力保护更多普通人。',
    relationshipDirection: '在共同求生和立场冲突中建立可信赖的伙伴关系。',
    storyPotential: '身份上升、阵营选择与百姓生存可以持续形成跨卷矛盾。'
  },
  possibleEnding: {
    direction: '最终建立能保护普通人的稳定秩序。',
    price: '必须在个人安稳与承担更大责任之间作出取舍。',
    openness: '主冲突收束，同时保留新秩序继续经受考验的空间。'
  },
  mustFollow: ['不能准确记住所有历史细节'],
  authorInstructions: []
};

describe('V7开书目录字段归位', () => {
  it('把误放在内容标签中的已知融合题材无损归位，不触发第二次模型修结构', () => {
    const parsed = validateV7OpeningPackage({
      ...PACKAGE,
      positioning: {
        ...PACKAGE.positioning,
        genres: ['历史脑洞', '秦汉三国'],
        tags: [...PACKAGE.positioning.tags, '穿越']
      }
    });
    expect(parsed.positioning.genres).toEqual(['历史脑洞', '秦汉三国', '穿越']);
    expect(parsed.positioning.tags).toEqual(PACKAGE.positioning.tags);
  });
});

const REVIEW = {
  verdict: 'pass',
  summary: '资料包保留作者核心想法，字段一致，可以交给作者检查。',
  issues: [],
  requiredChanges: [],
  authorDecisions: []
};

const DECISION_REVIEW = {
  verdict: 'author_decision',
  summary: '整体方向成立，但预计篇幅会影响长篇容量，需要作者决定。',
  issues: [],
  requiredChanges: [],
  authorDecisions: [],
  decisions: [{
    field: 'positioning.expectedTotalWords',
    question: '预计总字数是否调整为200万字？',
    currentValue: String(PACKAGE.positioning.expectedTotalWords),
    recommendation: '2000000',
    reason: '在保留长期容量的同时控制开篇承诺。',
    impact: '只调整预计总字数。',
    required: true
  }]
};

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7开书Agent平台接入', () => {
  it('模型请求复用、对账和返修严格绑定真实账号、开书任务与节点', async () => {
    context = createTestContext('wenmi-v7-opening-request-scope-');
    const resolver = new ScriptedResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      await register(app, 'v7-scope-a@example.com', '范围作者甲', 'strong-pass-101');
      await register(app, 'v7-scope-b@example.com', '范围作者乙', 'strong-pass-102');
      const owners = context.database.prepare(`
        SELECT owner_id, email_normalized FROM user_accounts
        WHERE email_normalized IN ('v7-scope-a@example.com','v7-scope-b@example.com')
      `).all() as unknown as Array<{ owner_id: string; email_normalized: string }>;
      const ownerA = owners.find((item) => item.email_normalized === 'v7-scope-a@example.com')!.owner_id;
      const ownerB = owners.find((item) => item.email_normalized === 'v7-scope-b@example.com')!.owner_id;
      const repository = new V7OpeningAgentRepository(context.database);
      const now = '2026-08-28T00:00:00.000Z';
      for (const task of [
        { taskId: 'opening-scope-task-a', ownerId: ownerA, suffix: 'a' },
        { taskId: 'opening-scope-task-b', ownerId: ownerB, suffix: 'b' }
      ]) {
        repository.createShell({
          taskId: task.taskId,
          ownerId: task.ownerId,
          idempotencyKey: `opening-scope-idempotency-${task.suffix}`,
          requestHash: task.suffix.repeat(64),
          ideaText: '张三穿越到三国乱世，从流民开始求生。',
          ideaHash: task.suffix.repeat(64),
          publishingPlatform: 'fanqie',
          selectedChiefMemberKey: null,
          selectedScreenwriterMemberKey: null,
          memberRoster: V7_OPENING_MEMBERS,
          now
        });
      }
      const member = V7_OPENING_MEMBERS.find((item) => item.memberKey === 'chief-deepseek-v4-pro')!;
      const gateway = new V7OpeningAgentModelGateway(context.database, resolver, new FixedClock(new Date(now)));
      const request = {
        requestId: 'opening-scope-request-1',
        taskId: 'opening-scope-task-a',
        ownerId: ownerA,
        nodeKey: 'opening_work_order',
        taskKind: 'opening_review',
        workstationKey: 'opening',
        operationMode: 'fresh',
        basedOnTaskId: null,
        authorInstructionVersion: null,
        sourceTraces: [{
          ownerId: ownerA,
          bookId: 'v7-prebook:opening-scope-task-a',
          sourceKey: 'author-opening-idea',
          sourceType: 'author_opening_idea',
          sourceId: 'opening-scope-task-a',
          sourceVersion: '1',
          authority: 'author_source',
          decision: 'included',
          reason: '作者本轮提交的开书原话。',
          contentHash: 'c'.repeat(64),
          estimatedTokens: 30
        }],
        member,
        prompt: JSON.stringify({ operation: 'v7_opening_work_order_v1' }),
        maxOutputTokens: 3_000
      } satisfies OpeningModelRequest;
      const first = await gateway.generate(request);
      expect(first.requestId).toBe(request.requestId);
      expect(resolver.generateCount).toBe(1);

      await expect(gateway.generate({
        ...request,
        ownerId: ownerB,
        taskId: 'opening-scope-task-b',
        sourceTraces: request.sourceTraces.map((trace) => ({
          ...trace,
          ownerId: ownerB,
          bookId: 'v7-prebook:opening-scope-task-b',
          sourceId: 'opening-scope-task-b'
        }))
      })).rejects.toThrow(/不属于当前开书任务/u);
      await expect(gateway.reconcile({
        requestId: request.requestId,
        ownerId: ownerB,
        taskId: 'opening-scope-task-b',
        nodeKey: 'opening_work_order',
        memberKey: member.memberKey
      })).rejects.toThrow(/不属于当前开书任务/u);
      await expect(gateway.generate({
        ...request,
        operationMode: 'repair',
        basedOnTaskId: 'another-request'
      })).rejects.toThrow(/显式任务合同不一致/u);
      expect(await gateway.reconcile({
        requestId: request.requestId,
        ownerId: ownerA,
        taskId: request.taskId,
        nodeKey: request.nodeKey,
        memberKey: member.memberKey
      })).toMatchObject({ status: 'succeeded', result: { requestId: request.requestId } });

      const repairRequest = {
        ...request,
        requestId: 'opening-scope-request-repair',
        operationMode: 'repair',
        basedOnTaskId: request.requestId
      } satisfies OpeningModelRequest;
      await expect(gateway.generate({
        ...repairRequest,
        ownerId: ownerB,
        taskId: 'opening-scope-task-b',
        sourceTraces: request.sourceTraces.map((trace) => ({
          ...trace,
          ownerId: ownerB,
          bookId: 'v7-prebook:opening-scope-task-b',
          sourceId: 'opening-scope-task-b'
        }))
      })).rejects.toThrow(/来源不存在、未成功或不属于当前任务/u);
      await expect(gateway.generate(repairRequest)).resolves.toMatchObject({
        requestId: repairRequest.requestId
      });
      expect(resolver.generateCount).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('现有方舟运行时能解析全部V7成员，且不改变冻结套餐绑定', () => {
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'test-coding-plan-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'test-agent-plan-key'
    });
    const factory = new ModelAdapterFactory(runtime);
    for (const member of V7_OPENING_MEMBERS) {
      const adapter = factory.resolve(member.model.provider, member.model.modelId, 'structured_planning');
      expect(adapter.provider).toBe(member.model.provider);
      expect(adapter.modelId).toBe(member.model.modelId);
      if (member.model.modelId === 'kimi-k3') {
        expect(member.model).toMatchObject({ plan: 'agent', provider: 'volcengine-ark-agent-plan' });
      } else {
        expect(member.model).toMatchObject({ plan: 'coding', provider: 'volcengine-ark-coding-plan' });
      }
    }
  });

  it('账号隔离、幂等执行、追加候选，并严格按成员使用Coding Plan和Agent Plan', async () => {
    context = createTestContext('wenmi-v7-opening-platform-');
    const resolver = new ScriptedResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      await register(app, 'v7-admin@example.com', '管理员', 'strong-pass-000');
      const first = await register(app, 'v7-first@example.com', '作者甲', 'strong-pass-123');
      const second = await register(app, 'v7-second@example.com', '作者乙', 'strong-pass-456');
      const input = {
        idea: '一个普通男人意外认识了八位性格和身份完全不同的女子。',
        idempotencyKey: 'v7-opening-task-0001',
        selectedChiefMemberKey: 'chief-kimi-k3'
      };
      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie: first }, payload: input
      });
      expect(started.statusCode).toBe(200);
      const taskId = started.json().data.taskId as string;
      const view = await poll(app, first, taskId, ['awaiting_author_confirmation']);
      expect(view).toMatchObject({
        taskId,
        status: 'awaiting_author_confirmation',
        isRunning: false,
        selectedMembers: { chiefEditor: { memberKey: 'chief-kimi-k3', displayName: '沈知微' } },
        idea: input.idea,
        resultBookId: null,
        workflowStyle: 'direct_design_review',
        progress: { currentStep: 2, totalSteps: 2, percent: 100 }
      });
      expect(view.candidates).toHaveLength(2);
      expect(view.candidates.map((item: { kind: string }) => item.kind)).toEqual([
        'opening_package', 'opening_review'
      ]);
      expect(JSON.stringify(view)).not.toMatch(/modelId|provider|requestId|思维链/u);

      const calls = context.database.prepare(`
        SELECT member_key, model_id, plan, state, input_tokens, output_tokens
        FROM v7_opening_agent_model_calls ORDER BY started_at, rowid
      `).all() as unknown as Array<{
        member_key: string; model_id: string; plan: string; state: string;
        input_tokens: number; output_tokens: number;
      }>;
      expect(calls.map((call) => [call.member_key, call.model_id, call.plan, call.state])).toEqual([
        ['planner-deepseek-v4-pro', 'deepseek-v4-pro', 'coding', 'succeeded'],
        ['chief-kimi-k3', 'kimi-k3', 'agent', 'succeeded']
      ]);
      const owner = context.database.prepare(`
        SELECT owner_id FROM v7_opening_agent_tasks WHERE task_id=?
      `).get(taskId) as { owner_id: string };
      const prebookId = `v7-prebook:${taskId}`;
      const frozenPromptBundles = context.database.prepare(`
        SELECT
          json_extract(task_contract_json,'$.taskKind') AS task_kind,
          json_extract(task_contract_json,'$.workstationKey') AS workstation_key,
          json_extract(task_contract_json,'$.operationMode') AS operation_mode,
          json_extract(task_contract_json,'$.basedOnTaskId') AS based_on_task_id,
          json_extract(task_contract_json,'$.authorInstructionVersion') AS author_instruction_version,
          json_extract(context_pack_json,'$.bookId') AS context_book_id,
          json_extract(prompt_manifest_json,'$.bookId') AS manifest_book_id,
          json_extract(prompt_manifest_json,'$.memberKey') AS manifest_member_key,
          json_extract(prompt_manifest_json,'$.compiledPromptHash') AS compiled_prompt_hash
        FROM v7_opening_agent_model_calls
        WHERE owner_id=? AND task_id=?
        ORDER BY started_at,rowid
      `).all(owner.owner_id, taskId) as unknown as Array<{
          task_kind: string;
          workstation_key: string;
          operation_mode: string;
          based_on_task_id: string | null;
          author_instruction_version: number | null;
        context_book_id: string;
        manifest_book_id: string;
        manifest_member_key: string;
        compiled_prompt_hash: string;
      }>;
      expect(frozenPromptBundles).toHaveLength(2);
      expect(frozenPromptBundles.map((bundle) => bundle.task_kind)).toEqual([
        'opening_design', 'opening_review'
      ]);
      expect(frozenPromptBundles.every((bundle) => (
        bundle.workstation_key === 'opening'
        && bundle.operation_mode === 'fresh'
        && bundle.based_on_task_id === null
        && bundle.author_instruction_version === null
      ))).toBe(true);
      expect(frozenPromptBundles.every((bundle) => (
        bundle.context_book_id === prebookId
        && bundle.manifest_book_id === prebookId
        && bundle.compiled_prompt_hash.length === 64
      ))).toBe(true);
      expect(frozenPromptBundles.map((bundle) => bundle.manifest_member_key)).toEqual([
        'planner-deepseek-v4-pro', 'chief-kimi-k3'
      ]);
      const tracedPrebookManifests = new V7PromptGovernanceRepository(context.database).listManifests({
        ownerId: owner.owner_id,
        bookId: prebookId,
        limit: 10
      }) as Array<{ taskKind: string; storageKind: string; openingTaskId: string }>;
      expect(tracedPrebookManifests).toHaveLength(2);
      expect(tracedPrebookManifests.map((manifest) => manifest.taskKind).toSorted()).toEqual([
        'opening_design', 'opening_review'
      ]);
      expect(tracedPrebookManifests.every((manifest) => (
        manifest.storageKind === 'prebook_model_call' && manifest.openingTaskId === taskId
      ))).toBe(true);
      expect(resolver.temperatures).toEqual([0.72, 0.24]);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 0 });

      const repeated = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie: first }, payload: input
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.taskId).toBe(taskId);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_opening_agent_model_calls').get())
        .toEqual({ count: 2 });

      const crossOwner = await app.inject({
        method: 'GET', url: `/api/v1/v7/opening-agent/tasks/${taskId}`,
        headers: { host: BROWSER_HEADERS.host, cookie: second }
      });
      expect(crossOwner.statusCode).toBe(404);

      const ownerLog = await app.inject({
        method: 'GET', url: '/api/v1/v7/opening-agent/tasks?limit=10',
        headers: { host: BROWSER_HEADERS.host, cookie: first }
      });
      expect(ownerLog.statusCode).toBe(200);
      expect(ownerLog.json().data).toHaveLength(1);
      expect(ownerLog.json().data[0]).toMatchObject({ taskId, idea: input.idea, resultBookId: null });
      const otherOwnerLog = await app.inject({
        method: 'GET', url: '/api/v1/v7/opening-agent/tasks?limit=10',
        headers: { host: BROWSER_HEADERS.host, cookie: second }
      });
      expect(otherOwnerLog.statusCode).toBe(200);
      expect(otherOwnerLog.json().data).toEqual([]);

      const crossOwnerAbandon = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/abandon`,
        headers: { ...BROWSER_HEADERS, cookie: second }, payload: {}
      });
      expect(crossOwnerAbandon.statusCode).toBe(404);
      const candidatesBeforeArchive = context.database.prepare(`
        SELECT COUNT(*) AS count FROM v7_opening_agent_candidates WHERE task_id = ?
      `).get(taskId);
      const abandoned = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/abandon`,
        headers: { ...BROWSER_HEADERS, cookie: first }, payload: {}
      });
      expect(abandoned.statusCode).toBe(200);
      expect(abandoned.json().data).toMatchObject({ taskId, status: 'archived', resultBookId: null });
      const repeatedAbandon = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/abandon`,
        headers: { ...BROWSER_HEADERS, cookie: first }, payload: {}
      });
      expect(repeatedAbandon.statusCode).toBe(200);
      const ownerLogAfterArchive = await app.inject({
        method: 'GET', url: '/api/v1/v7/opening-agent/tasks?limit=10',
        headers: { host: BROWSER_HEADERS.host, cookie: first }
      });
      expect(ownerLogAfterArchive.json().data).toEqual([]);
      expect(context.database.prepare(`
        SELECT COUNT(*) AS count FROM v7_opening_agent_candidates WHERE task_id = ?
      `).get(taskId)).toEqual(candidatesBeforeArchive);

      context.database.prepare(`
        INSERT INTO v7_opening_agent_tasks (
          task_id, owner_id, idempotency_key, request_hash, idea_text, idea_version, idea_hash,
          selected_chief_member_key, selected_screenwriter_member_key, status, phase, state_json,
          lease_token, lease_expires_at, error_code, error_message, created_at, updated_at,
          member_roster_json, publishing_platform
        )
        SELECT 'bulk-old-task', owner_id, 'bulk-old-task-0001', request_hash,
               '一条用于验证批量清理的旧开书任务。', idea_version, idea_hash,
               selected_chief_member_key, selected_screenwriter_member_key, 'failed', phase, NULL,
               NULL, NULL, 'internal_failure', '旧任务未完成', created_at, updated_at,
               member_roster_json, publishing_platform
        FROM v7_opening_agent_tasks WHERE task_id = ?
      `).run(taskId);
      const bulkAbandon = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks/abandon-all',
        headers: { ...BROWSER_HEADERS, cookie: first }, payload: {}
      });
      expect(bulkAbandon.statusCode).toBe(200);
      expect(bulkAbandon.json().data).toEqual({ archivedCount: 1, skippedCreatedCount: 0 });
      expect(context.database.prepare(`
        SELECT error_code FROM v7_opening_agent_tasks WHERE task_id = 'bulk-old-task'
      `).get()).toEqual({ error_code: 'archived_by_author' });

      context.database.prepare(`UPDATE v7_opening_agent_model_calls SET state='unknown'
        WHERE request_id=(SELECT request_id FROM v7_opening_agent_model_calls
          WHERE task_id=? ORDER BY updated_at DESC LIMIT 1)`).run(taskId);

      const department = await app.inject({
        method: 'GET', url: '/api/v1/v7/editorial-department',
        headers: { host: BROWSER_HEADERS.host, cookie: first }
      });
      expect(department.statusCode).toBe(200);
      const departmentData = department.json().data;
      const visibleMembers = departmentData.departments.flatMap((group: { members: Array<{ displayName: string; capabilities: string[] }> }) => group.members);
      expect(departmentData.summary).toMatchObject({ memberCount: 22, workingCount: 0 });
      expect(new Set(visibleMembers.map((member: { displayName: string }) => member.displayName)).size).toBe(visibleMembers.length);
      expect(departmentData.departments.map((group: { departmentKey: string }) => group.departmentKey)).toEqual([
        'chief_editor', 'deputy_editor', 'planning_writer', 'lead_writer',
        'independent_reviewer', 'continuity_editor', 'visual_renderer'
      ]);
      expect(visibleMembers.every((member: { capabilities: string[] }) => member.capabilities.length > 0)).toBe(true);
      expect(JSON.stringify(departmentData)).not.toMatch(/modelId|provider|Coding Plan|Agent Plan/u);

      context.database.prepare(`UPDATE v7_opening_agent_tasks SET status='working' WHERE task_id=?`).run(taskId);
      context.database.prepare(`UPDATE v7_opening_agent_model_calls SET state='working',updated_at='2000-01-01T00:00:00.000Z'
        WHERE request_id=(SELECT request_id FROM v7_opening_agent_model_calls
          WHERE task_id=? ORDER BY started_at DESC LIMIT 1)`).run(taskId);
      const staleDepartment = await app.inject({
        method: 'GET', url: '/api/v1/v7/editorial-department',
        headers: { host: BROWSER_HEADERS.host, cookie: first }
      });
      expect(staleDepartment.json().data.summary.workingCount).toBe(0);

      const activeAt = new Date().toISOString();
      context.database.prepare(`UPDATE v7_opening_agent_model_calls SET updated_at=?
        WHERE task_id=? AND state='working'`).run(activeAt, taskId);
      const activeDepartment = await app.inject({
        method: 'GET', url: '/api/v1/v7/editorial-department',
        headers: { host: BROWSER_HEADERS.host, cookie: first }
      });
      expect(activeDepartment.json().data.summary.workingCount).toBe(1);

      context.database.prepare(`UPDATE v7_opening_agent_tasks SET status='failed' WHERE task_id=?`).run(taskId);
      context.database.prepare(`UPDATE v7_opening_agent_model_calls
        SET state='succeeded',completed_at=?,updated_at=? WHERE task_id=? AND state='working'`)
        .run(activeAt, activeAt, taskId);

      const actualTokens = calls.reduce((sum, call) => sum + call.input_tokens + call.output_tokens, 0);
      const membership = await app.inject({
        method: 'GET', url: '/api/v1/membership/me',
        headers: { host: BROWSER_HEADERS.host, cookie: first }
      });
      expect(membership.json().data.membership.computeConsumed).toBe(actualTokens * 2);
    } finally {
      await app.close();
    }
  });

  it('运行租约只能由当前令牌续期，旧到期点不能接管，续期后到期才能恢复', async () => {
    context = createTestContext('wenmi-v7-opening-lease-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new ScriptedResolver() });
    try {
      await register(app, 'v7-lease@example.com', '租约作者', 'strong-pass-654');
      const owner = context.database.prepare(`
        SELECT owner_id FROM user_accounts WHERE email_normalized = 'v7-lease@example.com'
      `).get() as { owner_id: string };
      const repository = new V7OpeningAgentRepository(context.database);
      const createdAt = '2026-08-25T00:00:00.000Z';
      repository.createShell({
        taskId: 'v7-opening-lease-task', ownerId: owner.owner_id,
        idempotencyKey: 'v7-opening-lease-0001', requestHash: 'a'.repeat(64),
        ideaText: '张三穿越乱世，从流民开始求生。', ideaHash: 'b'.repeat(64),
        publishingPlatform: 'fanqie',
        selectedChiefMemberKey: null, selectedScreenwriterMemberKey: null,
        memberRoster: V7_OPENING_MEMBERS, now: createdAt
      });
      expect(repository.claim(
        owner.owner_id, 'v7-opening-lease-task', 'lease-owner-a',
        '2026-08-25T00:02:00.000Z', createdAt
      )).toBe(true);
      expect(repository.renewLease(
        owner.owner_id, 'v7-opening-lease-task', 'stale-owner',
        '2026-08-25T00:03:00.000Z', '2026-08-25T00:00:30.000Z'
      )).toBe(false);
      expect(repository.renewLease(
        owner.owner_id, 'v7-opening-lease-task', 'lease-owner-a',
        '2026-08-25T00:02:30.000Z', '2026-08-25T00:00:30.000Z'
      )).toBe(true);
      expect(repository.claim(
        owner.owner_id, 'v7-opening-lease-task', 'lease-owner-b',
        '2026-08-25T00:04:01.000Z', '2026-08-25T00:02:01.000Z'
      )).toBe(false);
      expect(repository.claim(
        owner.owner_id, 'v7-opening-lease-task', 'lease-owner-b',
        '2026-08-25T00:04:31.000Z', '2026-08-25T00:02:31.000Z'
      )).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('管理员能治理成员且新任务冻结创建时团队，普通用户、旧版本和最后一名下岗被拒绝', async () => {
    context = createTestContext('wenmi-v7-opening-governance-');
    const resolver = new ScriptedResolver();
    const app = await createServer(context.config, context.database, {
      v7OpeningModelAdapters: resolver,
      v7CoverImageGateway: {
        configured: true,
        modelId: 'doubao-seedream-test',
        generate: async () => { throw new Error('本测试不执行真实出图'); }
      }
    });
    try {
      const admin = await register(app, 'v7-team-admin@example.com', '团队管理员', 'strong-pass-000');
      const author = await register(app, 'v7-team-author@example.com', '作者丁', 'strong-pass-321');
      const forbidden = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/opening-agent/members',
        headers: { host: BROWSER_HEADERS.host, cookie: author }
      });
      expect(forbidden.statusCode).toBe(403);

      const initial = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/opening-agent/members',
        headers: { host: BROWSER_HEADERS.host, cookie: admin }
      });
      expect(initial.statusCode).toBe(200);
      expect(initial.json().data).toMatchObject({
        summary: { roleCount: 7, memberCount: 22 },
        credentials: { codingPlan: false, agentPlan: false, image: true }
      });
      expect(initial.json().data.roles[0].members[0]).toEqual(expect.objectContaining({
        memberKey: 'chief-deepseek-v4-pro'
      }));
      expect(initial.json().data.roles[0].members[0]).not.toHaveProperty('promptInstruction');
      expect(JSON.stringify(initial.json().data)).not.toMatch(/test-.*key|apiKey|secret/iu);

      const visualForbidden = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/visual-agent/members',
        headers: { host: BROWSER_HEADERS.host, cookie: author }
      });
      expect(visualForbidden.statusCode).toBe(403);
      const visual = await app.inject({
        method: 'GET', url: '/api/v1/admin/v7/visual-agent/members',
        headers: { host: BROWSER_HEADERS.host, cookie: admin }
      });
      expect(visual.statusCode).toBe(200);
      expect(visual.json().data).toMatchObject({
        credentials: { imageCapabilityConfigured: true },
        members: [
          { memberKey: 'visual-seedream', modelId: 'doubao-seedream-5-0-260128', status: 'on_duty' }
        ]
      });
      expect(JSON.stringify(visual.json().data)).not.toMatch(/apiKey|secret|Bearer/iu);

      const kimiDefault = await patchMember(app, admin, 'chief-kimi-k3', {
        expectedRevision: 1,
        defaultForRole: true
      });
      expect(kimiDefault.statusCode).toBe(200);
      const chiefAfterDefault = kimiDefault.json().data.roles.find((role: { roleKey: string }) => role.roleKey === 'chief_editor');
      expect(kimiDefault.json().data.revision).toBe(2);
      expect(chiefAfterDefault.members.find((member: { memberKey: string }) => member.memberKey === 'chief-kimi-k3')).toMatchObject({
        memberKey: 'chief-kimi-k3', defaultForRole: true, fallbackPriority: 3, plan: 'agent'
      });

      const stale = await patchMember(app, admin, 'chief-glm-5-3', {
        expectedRevision: 1,
        enabled: false
      });
      expect(stale.statusCode).toBe(409);

      const withoutGlm = await patchMember(app, admin, 'chief-glm-5-3', {
        expectedRevision: 2,
        enabled: false
      });
      expect(withoutGlm.statusCode).toBe(200);
      const withoutDeepseek = await patchMember(app, admin, 'chief-deepseek-v4-pro', {
        expectedRevision: 3,
        enabled: false
      });
      expect(withoutDeepseek.statusCode).toBe(200);
      const lastMemberRejected = await patchMember(app, admin, 'chief-kimi-k3', {
        expectedRevision: 4,
        enabled: false
      });
      expect(lastMemberRejected.statusCode).toBe(409);

      const promptConfigured = await patchMember(app, admin, 'chief-kimi-k3', {
        expectedRevision: 4,
        promptInstruction: '开书时优先提供具体、直给、能看出卖点的商业书名。'
      });
      expect(promptConfigured.statusCode).toBe(400);
      expect(promptConfigured.json().error.message).toMatch(/不再保存永久补充提示/u);

      // 兼容真实旧库：历史版本曾允许保存成员永久提示。它可以继续留在
      // 治理历史中，但任何新任务都必须剥离，改由版本化任务提示体系接管。
      context.database.prepare(`UPDATE v7_opening_agent_member_settings
        SET prompt_instruction='历史遗留成员补充提示，不得进入新任务'
        WHERE member_key='chief-kimi-k3'`).run();

      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie: author },
        payload: {
          idea: '周宁穿越到三国历史乱世，想从边军小卒开始保护故乡并逐步成长。',
          idempotencyKey: 'v7-governance-snapshot-0001'
        }
      });
      expect(started.statusCode).toBe(200);
      const taskId = started.json().data.taskId as string;
      const frozen = context.database.prepare(`
        SELECT member_roster_json FROM v7_opening_agent_tasks WHERE task_id = ?
      `).get(taskId) as { member_roster_json: string };
      const frozenRoster = JSON.parse(frozen.member_roster_json) as Array<{ memberKey: string }>;
      expect(frozenRoster).toContainEqual(expect.objectContaining({
        memberKey: 'chief-kimi-k3', enabled: true, defaultForRole: true, fallbackPriority: 1,
        promptInstruction: ''
      }));
      expect(frozenRoster).toContainEqual(expect.objectContaining({ memberKey: 'planner-deepseek-v4-pro' }));
      expect(frozenRoster.some((member) => member.memberKey.startsWith('screenwriter-'))).toBe(false);

      const futureDefault = await patchMember(app, admin, 'chief-deepseek-v4-pro', {
        expectedRevision: 4,
        defaultForRole: true
      });
      expect(futureDefault.statusCode).toBe(200);
      const futurePrompt = await patchMember(app, admin, 'chief-kimi-k3', {
        expectedRevision: 5,
        promptInstruction: '后续任务改用另一套补充要求。'
      });
      expect(futurePrompt.statusCode).toBe(400);
      const unchanged = context.database.prepare(`
        SELECT member_roster_json FROM v7_opening_agent_tasks WHERE task_id = ?
      `).get(taskId) as { member_roster_json: string };
      expect(unchanged.member_roster_json).toBe(frozen.member_roster_json);
      await poll(app, author, taskId, ['awaiting_author_confirmation']);
      const calls = context.database.prepare(`
        SELECT member_key, plan FROM v7_opening_agent_model_calls WHERE task_id = ? ORDER BY rowid
      `).all(taskId) as unknown as Array<{ member_key: string; plan: string }>;
      expect(calls[0]).toEqual({ member_key: 'planner-deepseek-v4-pro', plan: 'coding' });
      expect(calls.at(-1)).toEqual({ member_key: 'chief-kimi-k3', plan: 'agent' });
      expect(context.database.prepare(`
        SELECT COUNT(*) AS count FROM v7_opening_agent_member_setting_events
      `).get()).toEqual({ count: 0 });
      expect(context.database.prepare(`
        SELECT COUNT(*) AS count FROM v7_agent_governance_events
      `).get()).toEqual({ count: 4 });
    } finally {
      await app.close();
    }
  });

  it('供应商结果未知时只对账，不重复发送同一个模型请求', async () => {
    context = createTestContext('wenmi-v7-opening-unknown-');
    const resolver = new ScriptedResolver('unknown');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      await register(app, 'v7-unknown-admin@example.com', '管理员', 'strong-pass-000');
      const cookie = await register(app, 'v7-unknown@example.com', '作者丙', 'strong-pass-789');
      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '林秋穿越仙侠世界成为宗门杂役，意外发现废弃药园。',
          idempotencyKey: 'v7-opening-unknown-0001'
        }
      });
      const taskId = started.json().data.taskId as string;
      const view = await poll(app, cookie, taskId, ['interrupted']);
      expect(view.status).toBe('interrupted');
      expect(resolver.generateCount).toBe(1);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await app.inject({
          method: 'GET', url: `/api/v1/v7/opening-agent/tasks/${taskId}`,
          headers: { host: BROWSER_HEADERS.host, cookie }
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(resolver.generateCount).toBe(1);
      expect(context.database.prepare(`
        SELECT state FROM v7_opening_agent_model_calls WHERE task_id = ?
      `).get(taskId)).toEqual({ state: 'unknown' });
      const owner = context.database.prepare(`
        SELECT owner_id FROM user_accounts WHERE email_normalized = 'v7-unknown@example.com'
      `).get() as { owner_id: string };
      const reservation = context.database.prepare(`
        SELECT reserved_tokens FROM v7_opening_agent_model_calls WHERE task_id = ?
      `).get(taskId) as { reserved_tokens: number };
      expect(reservation.reserved_tokens).toBeGreaterThan(20_000);
      expect(membershipGenerationBlockReason(
        context.database,
        owner.owner_id,
        new Date().toISOString(),
        80_000
      )).toBe('quota-exhausted');
    } finally {
      await app.close();
    }
  });

  it('作者修改追加版本、主编复审并幂等转成一本没有旧团队的正式书', async () => {
    context = createTestContext('wenmi-v7-opening-author-loop-');
    const resolver = new ScriptedResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'v7-loop@example.com', '闭环作者', 'strong-pass-555');
      const other = await register(app, 'v7-loop-other@example.com', '其他作者', 'strong-pass-556');
      const loopOwner = context.database.prepare(`
        SELECT owner_id FROM user_accounts WHERE email_normalized = 'v7-loop@example.com'
      `).get() as { owner_id: string };
      context.database.prepare(`
        INSERT INTO books (
          book_id, owner_id, title, status, version, positioning_version, canon_revision,
          editor_epoch, created_at, updated_at
        ) VALUES ('legacy-book', ?, '历史验收书', 'active', 1, 0, 0, 0, ?, ?)
      `).run(loopOwner.owner_id, new Date().toISOString(), new Date().toISOString());
      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '张三穿越到三国乱世，从流民开始求生，并想办法保护同行百姓。',
          idempotencyKey: 'v7-author-loop-task-0001'
        }
      });
      const taskId = started.json().data.taskId as string;
      const initial = await poll(app, cookie, taskId, ['awaiting_author_confirmation']);
      const base = latestCandidate(initial, 'opening_package');
      const authorPackage = {
        ...base.content,
        title: '三国：小卒问鼎',
        protagonists: [{ ...base.content.protagonists[0], age: '24岁' }]
      };
      const revision = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/revisions`,
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          baseCandidateId: base.candidateId,
          openingPackage: authorPackage,
          adjustmentNote: '保留小卒起点，但让主角更早承担保护同伴的责任。',
          idempotencyKey: 'v7-author-loop-revision-0001'
        }
      });
      expect(revision.statusCode).toBe(200);
      const reviewed = await poll(app, cookie, taskId, ['awaiting_author_confirmation']);
      const activePackage = latestCandidate(reviewed, 'opening_package');
      expect(activePackage).toMatchObject({
        version: 3,
        createdBy: { memberKey: 'planner-deepseek-v4-pro', displayName: '红玉' },
        content: {
          title: '三国：小卒问鼎',
          protagonists: [expect.objectContaining({ age: '24岁' })],
          authorInstructions: ['保留小卒起点，但让主角更早承担保护同伴的责任。']
        }
      });
      expect(reviewed.candidates.filter((item: { kind: string }) => item.kind === 'opening_package'))
        .toHaveLength(3);
      expect(reviewed.candidates.filter((item: { kind: string }) => item.kind === 'opening_review')).toHaveLength(2);

      const confirmPayload = {
        taskId,
        candidateId: activePackage.candidateId,
        openingPackage: activePackage.content,
        idempotencyKey: 'v7-author-loop-confirm-0001'
      };
      const confirmed = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie }, payload: confirmPayload
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().data).toMatchObject({ title: '三国：小卒问鼎', status: 'active', nextView: 'information' });
      const bookId = confirmed.json().data.bookId as string;
      const abandonConfirmed = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/abandon`,
        headers: { ...BROWSER_HEADERS, cookie }, payload: {}
      });
      expect(abandonConfirmed.statusCode).toBe(409);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 2 });
      expect(context.database.prepare(`
        SELECT COUNT(*) AS count FROM agent_instances WHERE book_id = ?
      `).get(bookId)).toEqual({ count: 0 });
      expect(context.database.prepare(`
        SELECT category_name, status FROM book_opening_blueprints WHERE owner_id = (
          SELECT owner_id FROM user_accounts WHERE email_normalized = 'v7-loop@example.com'
        ) AND book_id = ?
      `).get(bookId)).toEqual({ category_name: '历史脑洞', status: 'active' });

      const v7Books = await app.inject({
        method: 'GET', url: '/api/v1/v7/books', headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(v7Books.statusCode).toBe(200);
      expect(v7Books.json().data).toEqual([expect.objectContaining({ bookId, title: '三国：小卒问鼎', status: 'active' })]);
      const hiddenLegacyProfile = await app.inject({
        method: 'GET', url: '/api/v1/v7/books/legacy-book/book-profile',
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(hiddenLegacyProfile.statusCode).toBe(404);
      const v7Profile = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/book-profile`,
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(v7Profile.statusCode).toBe(200);
      expect(v7Profile.json().data.title).toBe('三国：小卒问鼎');

      const revisedProfile = await app.inject({
        method: 'PUT', url: `/api/v1/v7/books/${bookId}/book-profile`,
        headers: { ...BROWSER_HEADERS, cookie }, payload: {
          expectedVersion: 1,
          title: '三国：小卒定天下',
          openingBlueprint: v7Profile.json().data.openingBlueprint
        }
      });
      expect(revisedProfile.statusCode).toBe(200);
      expect(revisedProfile.json().data).toMatchObject({ title: '三国：小卒定天下', version: 2 });

      const repeated = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie }, payload: confirmPayload
      });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.json().data.bookId).toBe(bookId);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM books').get()).toEqual({ count: 2 });

      const crossOwner = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie: other }, payload: confirmPayload
      });
      expect(crossOwner.statusCode).toBe(404);

      const archived = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/archive`,
        headers: { ...BROWSER_HEADERS, cookie }, payload: { expectedVersion: 2 }
      });
      expect(archived.statusCode).toBe(200);
      const afterArchive = await app.inject({
        method: 'GET', url: '/api/v1/v7/books', headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(afterArchive.json().data).toEqual([
        expect.objectContaining({ bookId, title: '三国：小卒定天下', status: 'archived', version: 3 })
      ]);

      const restored = await app.inject({
        method: 'POST', url: `/api/v1/v7/books/${bookId}/restore`,
        headers: { ...BROWSER_HEADERS, cookie }, payload: { expectedVersion: 3 }
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().data).toMatchObject({ bookId, status: 'active', version: 4 });
    } finally {
      await app.close();
    }
  });

  it('作者决定卡只更新白名单开书候选，并在复审通过后恢复创建资格', async () => {
    context = createTestContext('wenmi-v7-opening-decisions-');
    const resolver = new ScriptedResolver('decision');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'v7-decisions@example.com', '决定卡作者', 'strong-pass-777');
      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks', headers: { ...BROWSER_HEADERS, cookie },
        payload: { idea: '张三穿越到三国乱世，从流民开始统一天下。', idempotencyKey: 'v7-decision-task-0001' }
      });
      const taskId = started.json().data.taskId as string;
      const waiting = await poll(app, cookie, taskId, ['awaiting_author_decision']);
      const base = latestCandidate(waiting, 'opening_package');
      const review = latestCandidate(waiting, 'opening_review');
      expect(review.content.decisions).toEqual([expect.objectContaining({
        decisionId: 'decision-1', field: 'positioning.expectedTotalWords', required: true
      })]);

      const unknown = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/revisions`, headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          baseCandidateId: base.candidateId, openingPackage: base.content, adjustmentNote: '',
          decisionResolutions: [{ decisionId: 'decision-unknown', action: 'accept' }],
          idempotencyKey: 'v7-decision-revision-bad'
        }
      });
      expect(unknown.statusCode).toBe(409);

      const revised = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/revisions`, headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          baseCandidateId: base.candidateId, openingPackage: base.content, adjustmentNote: '',
          decisionResolutions: [{ decisionId: 'decision-1', action: 'accept' }],
          idempotencyKey: 'v7-decision-revision-0001'
        }
      });
      expect(revised.statusCode).toBe(200);
      const completed = await poll(app, cookie, taskId, ['awaiting_author_confirmation']);
      expect(latestCandidate(completed, 'opening_package').content).toMatchObject({
        positioning: { expectedTotalWords: 2_000_000 }
      });
      expect(resolver.generateCount).toBe(3);
      expect(JSON.stringify(latestCandidate(completed, 'opening_package').content)).not.toContain('revisionDirective');
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_setting_batches').get()).toEqual({ count: 0 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM canon_revisions').get()).toEqual({ count: 0 });
    } finally {
      await app.close();
    }
  });

  it('自己设计补齐商业规划资料后建书，未填写的后续剧情仍保持为空', async () => {
    context = createTestContext('wenmi-v7-opening-manual-minimal-');
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: new ScriptedResolver() });
    try {
      const cookie = await register(app, 'v7-manual@example.com', '手工作者', 'strong-pass-557');
      const minimal = {
        title: '八方姻缘',
        positioning: {
          publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: [], tags: [], coreAppeal: '',
          expectedTotalWords: 1_500_000
        },
        backgrounds: { eraAndWorld: '', openingSituation: '' },
        protagonists: [{
          name: '张三', age: '青年', identity: '男主', background: '寒门出身，家人在战乱中失散。',
          familyBackground: '', careerBackground: '', goldenFinger: '',
          goal: '', dilemma: '', personality: ['谨慎'], boundary: ''
        }],
        opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
        longTermDirection: { centralConflict: '', progression: '', relationshipDirection: '', storyPotential: '' },
        possibleEnding: { direction: '', price: '', openness: '' },
        authorNotes: [],
        mustFollow: ['无额外限制']
      };
      const confirmed = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          openingPackage: minimal,
          idempotencyKey: 'v7-manual-minimal-0001'
        }
      });
      expect(confirmed.statusCode).toBe(200);
      const bookId = confirmed.json().data.bookId as string;
      const profile = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/book-profile`,
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(profile.statusCode).toBe(200);
      expect(profile.json().data).toMatchObject({
        title: '八方姻缘', subjects: [], mainTags: [], storyDirection: '', openingStart: '', storyEnding: '',
        protagonists: [{ name: '张三', age: '青年', personalities: ['谨慎'] }]
      });
      expect(profile.json().data.openingBlueprint.openingIdea).toBeUndefined();
      expect(profile.json().data.mustFollow).toEqual(['无额外限制']);
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_opening_agent_tasks').get()).toEqual({ count: 0 });
      const tooLong = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          openingIdea: '张'.repeat(2_001),
          openingPackage: minimal,
          idempotencyKey: 'v7-manual-too-long-0001'
        }
      });
      expect(tooLong.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

function latestCandidate(view: any, kind: string): any {
  const candidates = view.candidates.filter((item: { kind: string }) => item.kind === kind);
  return candidates.at(-1);
}

class ScriptedResolver implements V7OpeningModelAdapterResolver {
  public generateCount = 0;
  public readonly temperatures: Array<number | undefined> = [];
  public constructor(private readonly mode: 'success' | 'unknown' | 'decision' = 'success') {}

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return {
      provider,
      modelId,
      generate: async (request: ModelRequest): Promise<ModelResult> => {
        this.generateCount += 1;
        this.temperatures.push(request.temperature);
        if (this.mode === 'unknown') {
          throw new ModelAdapterError('连接断开，无法确认供应商是否已经完成', 'technical_failure', true, undefined, true);
        }
        const compiled = JSON.parse(request.prompt) as {
          contextPack?: { content?: { stageTaskPayload?: unknown } };
        } & Record<string, unknown>;
        const stageTaskPayload = compiled.contextPack?.content?.stageTaskPayload;
        const prompt = (typeof stageTaskPayload === 'string'
          ? JSON.parse(stageTaskPayload)
          : (stageTaskPayload ?? compiled)) as {
          operation: string;
          authorSource?: { originalIdea?: string };
          currentCandidates?: { openingPackage?: typeof PACKAGE | null };
        };
        const operation = prompt.operation;
        const output = operation === 'v7_opening_work_order_v1'
          ? JSON.stringify(WORK_ORDER)
          : operation === 'v7_opening_package_review_v1'
            ? JSON.stringify(this.mode === 'decision' && (prompt.currentCandidates?.openingPackage?.authorInstructions?.length ?? 0) === 0 ? DECISION_REVIEW : REVIEW)
            : operation === 'v7_opening_package_revision_v1'
              ? JSON.stringify(prompt.currentCandidates?.openingPackage ?? PACKAGE)
              : JSON.stringify(packageForIdea(prompt.authorSource?.originalIdea ?? ''));
        return {
          provider,
          modelId,
          output,
          inputTokens: 120,
          outputTokens: 240,
          cashCostCny: 0,
          state: 'succeeded'
        };
      }
    };
  }
}

function packageForIdea(idea: string): typeof PACKAGE {
  const protagonist = idea.match(/^\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z·]{0,11})(?:穿越|重生|魂穿|转生)/u)?.[1];
  if (protagonist === undefined) return PACKAGE;
  return {
    ...PACKAGE,
    protagonists: [{ ...PACKAGE.protagonists[0]!, name: protagonist }]
  };
}

async function register(
  app: Awaited<ReturnType<typeof createServer>>,
  email: string,
  displayName: string,
  password: string
): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
    payload: { email, password, displayName }
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function poll(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  taskId: string,
  terminal: string[]
): Promise<any> {
  let view: any = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.inject({
      method: 'GET', url: `/api/v1/v7/opening-agent/tasks/${taskId}`,
      headers: { host: BROWSER_HEADERS.host, cookie }
    });
    expect(response.statusCode).toBe(200);
    view = response.json().data;
    if (terminal.includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`V7开书任务未在预期时间进入：${terminal.join(', ')}；最后状态：${JSON.stringify(view)}`);
}

async function patchMember(
  app: Awaited<ReturnType<typeof createServer>>,
  cookie: string,
  memberKey: string,
  payload: Record<string, unknown>
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/v7/opening-agent/members/${memberKey}`,
    headers: { ...BROWSER_HEADERS, cookie },
    payload
  });
}
