import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { V7_PLANNING_MEMBERS } from '@wenmi/v7-backend';
import {
  V7PlanningSourceCompiler,
  planningSnapshotSourceTraces
} from '../../../apps/api/src/application/planning/v7-planning-source-compiler.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { V7PlanningModelGateway } from '../../../apps/api/src/infrastructure/models/v7-planning-model-gateway.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

const HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7规划正式资料快照', () => {
  it('全书路线缺少预计总字数时在调用成员前明确拦截', async () => {
    context = createTestContext('wenmi-v7-planning-profile-gate-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'snapshot-gate@example.com', '资料门槛作者');
      const bookId = await createBook(app, cookie, '缺项测试书');
      const row = context.database.prepare('SELECT blueprint_json FROM book_opening_blueprints WHERE book_id=?')
        .get(bookId) as { blueprint_json: string };
      const blueprint = JSON.parse(row.blueprint_json) as Record<string, unknown>;
      delete blueprint.planningProfile;
      context.database.prepare('UPDATE book_opening_blueprints SET blueprint_json=? WHERE book_id=?')
        .run(JSON.stringify(blueprint), bookId);
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
      const now = '2026-07-16T00:00:00.000Z';
      context.database.prepare(`INSERT INTO v7_setting_item_versions
        (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
        VALUES ('gate-setting-version',?,?, 'world-stage',1,'confirmed',?,'author',?)`)
        .run(ownerId, bookId, JSON.stringify({ era: '北宋' }), now);
      context.database.prepare(`INSERT INTO v7_setting_items
        (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
        VALUES (?,?,'world-stage','世界舞台','核心设定','时代和世界规则','confirmed','gate-setting-version',1,?)`)
        .run(ownerId, bookId, now);
      const compiler = new V7PlanningSourceCompiler(context.database, new SequenceIds(), new FixedClock());
      expect(() => compiler.compile({
        ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design'
      })).toThrow('补全预计总字数');
    } finally {
      await app.close();
    }
  });

  it('由服务端冻结开书、确认设定和作者目标，并对相同来源幂等复用', async () => {
    context = createTestContext('wenmi-v7-planning-snapshot-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'snapshot-owner@example.com', '快照作者');
      const bookId = await createBook(app, cookie, '北宋小卒');
      const ownerId = ownerOf(bookId);
      confirmSetting(ownerId, bookId, 'world-stage', '世界舞台', { era: '北宋', rule: '没有系统和超凡力量' });
      const compiler = new V7PlanningSourceCompiler(context.database, new SequenceIds(), new FixedClock());
      const first = compiler.compile({
        ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design',
        authorGoal: '计划写三百万字，张三从小卒成长为能够改变时代的人。'
      });
      const repeated = compiler.compile({
        ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design',
        authorGoal: '计划写三百万字，张三从小卒成长为能够改变时代的人。'
      });
      expect(repeated.snapshotId).toBe(first.snapshotId);
      expect(first.sources.map((source) => source.sourceKind)).toEqual(['opening', 'setting', 'setting', 'author_goal']);
      expect(first.sources[0]?.content).toMatchObject({ title: '北宋小卒' });
      expect(first.sources[0]?.content).toMatchObject({ planningProfile: { publishingPlatform: 'fanqie', expectedTotalWords: 3_000_000 } });
      expect(JSON.stringify(first.sources[0]?.content)).not.toMatch(/volumePlan|commercialAudience|retentionPositioning|targetAudience/u);
      expect(first.sources[1]?.content).toMatchObject({ schema: 'v7-compact-setting-ledger-v1' });
      expect(first.sources[1]?.content).not.toHaveProperty('itemIndex');
      expect(first.sources[1]?.content).not.toHaveProperty('factLedger');
      expect(first.sources[2]?.content).toMatchObject({
        schema: 'v7-setting-fact-source-v1', itemKey: 'world-stage', label: '世界舞台',
        facts: expect.arrayContaining([expect.any(String)])
      });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_planning_source_snapshots WHERE owner_id=? AND book_id=?')
        .get(ownerId, bookId)).toEqual({ count: 1 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM v7_planning_source_items WHERE owner_id=? AND book_id=?')
        .get(ownerId, bookId)).toEqual({ count: 4 });

      const changed = compiler.compile({
        ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design',
        authorGoal: '计划写两百万字，重点写张三与岳飞从相识到分歧。'
      });
      expect(changed.snapshotId).not.toBe(first.snapshotId);
      expect(changed.sourceFingerprint).not.toBe(first.sourceFingerprint);
      expect(() => compiler.require('other-owner', bookId, first.snapshotId)).toThrow('不存在或不属于本书');

      const chief = V7_PLANNING_MEMBERS.find((member) => member.roleKey === 'chief_editor' && member.enabledByDefault)!;
      const gateway = new V7PlanningModelGateway(context.database, new SuccessfulPlanningResolver(), new FixedClock());
      await gateway.generate({
        requestId: 'planning-explicit-operation-mode-0001', ownerId, bookId,
        runId: 'planning-explicit-operation-mode-run', runKind: 'recipe',
        // 名称同时带 chain/repair；显式合同仍必须原样保持，不从文本猜测。
        nodeKey: 'chain:repair-route_fusion', taskKind: 'planning_review', workstationKey: 'full_book_route',
        operationMode: 'fresh', basedOnTaskId: null,
        authorInstructionVersion: null, sourceTraces: planningSnapshotSourceTraces(first),
        member: chief, prompt: JSON.stringify({ task: '验证显式规划操作模式', snapshotId: first.snapshotId }),
        maxOutputTokens: 200, temperature: 0.2
      });
      expect(context.database.prepare(`SELECT task_kind,workstation_key,operation_mode,based_on_task_id,author_instruction_version
        FROM v7_task_contracts WHERE task_id='planning-explicit-operation-mode-0001'`).get()).toEqual({
        task_kind: 'planning_review', workstation_key: 'full_book_route', operation_mode: 'fresh',
        based_on_task_id: null, author_instruction_version: null
      });
      expect(context.database.prepare(`SELECT role_key,task_kind,workstation_key,operation_mode
        FROM v7_prompt_manifests WHERE task_id='planning-explicit-operation-mode-0001'`).get()).toEqual({
        role_key: 'chief_editor', task_kind: 'planning_review',
        workstation_key: 'full_book_route', operation_mode: 'fresh'
      });
      await gateway.generate({
        requestId: 'planning-real-lineage-0002', ownerId, bookId,
        runId: 'planning-real-lineage-run', runKind: 'recipe', nodeKey: 'renamed-adjustment-node',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'revise',
        basedOnTaskId: 'planning-explicit-operation-mode-0001', authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '基于已完成规划任务调整', snapshotId: first.snapshotId }),
        maxOutputTokens: 200, temperature: 0.2
      });
      expect(context.database.prepare(`SELECT operation_mode,based_on_task_id,author_instruction_version
        FROM v7_task_contracts WHERE task_id='planning-real-lineage-0002'`).get()).toEqual({
        operation_mode: 'revise', based_on_task_id: 'planning-explicit-operation-mode-0001',
        author_instruction_version: null
      });
      await expect(gateway.generate({
        requestId: 'planning-fake-lineage-0003', ownerId, bookId,
        runId: 'planning-fake-lineage-run', runKind: 'recipe', nodeKey: 'renamed-adjustment-node',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'revise',
        basedOnTaskId: 'not-a-real-planning-task', authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '不得接受伪造来源任务' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('任务来源不存在');

      await expect(gateway.generate({
        requestId: 'planning-fresh-with-parent-0004', ownerId, bookId,
        runId: 'planning-fresh-with-parent-run', runKind: 'recipe', nodeKey: 'fresh-with-parent',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'fresh',
        basedOnTaskId: 'planning-explicit-operation-mode-0001', authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '新建任务不得伪造父任务' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('新建规划任务不得携带来源任务');
      await expect(gateway.generate({
        requestId: 'planning-repair-without-parent-0005', ownerId, bookId,
        runId: 'planning-repair-without-parent-run', runKind: 'recipe', nodeKey: 'repair-without-parent',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'repair',
        basedOnTaskId: null, authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '修复任务必须有真实父任务' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('必须绑定一个已成功的真实来源任务');
      await expect(gateway.generate({
        requestId: 'planning-unpersisted-author-version-0006', ownerId, bookId,
        runId: 'planning-unpersisted-author-version-run', runKind: 'recipe', nodeKey: 'author-version',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'revise',
        basedOnTaskId: 'planning-explicit-operation-mode-0001', authorInstructionVersion: 1,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '不得猜测作者意见版本' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('尚未持久化作者意见版本');

      const otherCookie = await register(app, 'snapshot-other-owner@example.com', '其他规划作者');
      const otherBookId = await createBook(app, otherCookie, '另一本书');
      const otherOwnerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(otherBookId) as { owner_id: string }).owner_id);
      await gateway.generate({
        requestId: 'planning-other-book-parent-0007', ownerId: otherOwnerId, bookId: otherBookId,
        runId: 'planning-other-book-parent-run', runKind: 'recipe', nodeKey: 'other-book-parent',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'fresh',
        basedOnTaskId: null, authorInstructionVersion: null, sourceTraces: [], member: chief,
        prompt: JSON.stringify({ task: '另一本书的真实成功规划任务' }), maxOutputTokens: 200, temperature: 0.2
      });
      await expect(gateway.generate({
        requestId: 'planning-cross-book-lineage-0008', ownerId, bookId,
        runId: 'planning-cross-book-lineage-run', runKind: 'recipe', nodeKey: 'cross-book-lineage',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'revise',
        basedOnTaskId: 'planning-other-book-parent-0007', authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '不得跨书绑定父任务' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('任务来源不存在或不属于当前书籍');

      const failedGateway = new V7PlanningModelGateway(context.database, new FailingPlanningResolver(), new FixedClock());
      await expect(failedGateway.generate({
        requestId: 'planning-failed-parent-0009', ownerId, bookId,
        runId: 'planning-failed-parent-run', runKind: 'recipe', nodeKey: 'failed-parent',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'fresh',
        basedOnTaskId: null, authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '本次模拟失败' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('模拟规划失败');
      await expect(gateway.generate({
        requestId: 'planning-failed-parent-child-0010', ownerId, bookId,
        runId: 'planning-failed-parent-child-run', runKind: 'recipe', nodeKey: 'failed-parent-child',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'repair',
        basedOnTaskId: 'planning-failed-parent-0009', authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '失败输出不得成为修复依据' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('任务来源尚未成功');
      await expect(gateway.generate({
        requestId: 'planning-fusion-fake-parent-0011', ownerId, bookId,
        runId: 'planning-fusion-fake-parent-run', runKind: 'recipe', nodeKey: 'fusion-fake-parent',
        taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'fusion',
        basedOnTaskId: 'fabricated-fusion-parent', authorInstructionVersion: null,
        sourceTraces: planningSnapshotSourceTraces(first), member: chief,
        prompt: JSON.stringify({ task: '融合可多源但不得伪造单一父任务' }), maxOutputTokens: 200, temperature: 0.2
      })).rejects.toThrow('任务来源不存在');
    } finally {
      await app.close();
    }

    function ownerOf(bookId: string): string {
      return String((context!.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id);
    }

    function confirmSetting(ownerId: string, bookId: string, itemKey: string, label: string, content: unknown): void {
      const now = '2026-07-16T00:00:00.000Z';
      context!.database.prepare(`INSERT INTO v7_setting_item_versions
        (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
        VALUES (?,?,?,?,1,'confirmed',?,'author',?)`).run('setting-version-0001', ownerId, bookId, itemKey, JSON.stringify(content), now);
      context!.database.prepare(`INSERT INTO v7_setting_items
        (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
        VALUES (?,?,?,?,?,?,'confirmed','setting-version-0001',1,?)`)
        .run(ownerId, bookId, itemKey, label, '核心设定', '说明时代与世界规则', now);
    }
  });

  it('大量设定只向全书规划发送当前主编总账，设定变化后拒绝复用旧总账', async () => {
    context = createTestContext('wenmi-v7-planning-compact-ledger-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'snapshot-ledger@example.com', '总账作者');
      const bookId = await createBook(app, cookie, '三百万字历史长篇');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      const opening = context.database.prepare(`SELECT version FROM book_opening_blueprints
        WHERE owner_id=? AND book_id=? AND status='active'`).get(ownerId, bookId) as { version: number };
      const itemKeys: string[] = [];
      for (let index = 1; index <= 25; index += 1) {
        const itemKey = `setting-${index}`;
        const versionId = `ledger-version-${index}`;
        itemKeys.push(itemKey);
        const content = {
          finalContent: `这是第${index}项设定的完整原文，包含不应重复塞进全书规划资料包的详细内容。`.repeat(12),
          contextSummary: `第${index}项设定的关键身份、边界和规则。`,
          factEntries: [`第${index}项硬事实。`]
        };
        context.database.prepare(`INSERT INTO v7_setting_item_versions
          (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
          VALUES (?,?,?,?,1,'confirmed',?,'author','2026-07-16T00:00:00.000Z')`)
          .run(versionId, ownerId, bookId, itemKey, JSON.stringify(content));
        context.database.prepare(`INSERT INTO v7_setting_items
          (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
          VALUES (?,?,?,?,?,'测试设定','confirmed',?,1,'2026-07-16T00:00:00.000Z')`)
          .run(ownerId, bookId, itemKey, `设定${index}`, `分组${Math.ceil(index / 5)}`, versionId);
      }
      const groupSummaries = Array.from({ length: 5 }, (_, index) => ({
        groupTitle: `分组${index + 1}`,
        summary: `这一组统一说明第${index * 5 + 1}至${index * 5 + 5}项设定的关键边界。`,
        itemKeys: itemKeys.slice(index * 5, index * 5 + 5)
      }));
      context.database.prepare(`INSERT INTO v7_setting_batches
        (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,
          opening_version,opening_hash,roster_json,created_at,updated_at)
        VALUES ('compact-ledger-review',?,?, 'compact-ledger-review-key','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','awaiting_author',?,?,?,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','[]',
          '2026-07-16T00:01:00.000Z','2026-07-16T00:01:00.000Z')`).run(
        ownerId,
        bookId,
        JSON.stringify({
          taskKind: 'batch_final_review',
          resultHash: 'current-result-hash',
          result: {
            verdict: 'pass',
            summary: '全部设定已经统一。',
            contextSummary: '主角、时代、规则和禁项已经统一，后续按分组边界展开。',
            factLedger: itemKeys.map((itemKey, index) => ({ itemKey, label: `设定${index + 1}`, facts: [`第${index + 1}项硬事实。`] })),
            groupSummaries,
            unifiedDecisions: [], conflicts: [], patchedItemKeys: []
          }
        }),
        JSON.stringify({ taskKind: 'batch_final_review', phase: 'ready', progress: 100 }),
        opening.version
      );

      const compiler = new V7PlanningSourceCompiler(context.database, new SequenceIds(), new FixedClock());
      const compiled = compiler.compile({ ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design' });
      const settingSources = compiled.sources.filter((source) => source.sourceKind === 'setting');
      const ledgerSources = settingSources.filter((source) => (source.content as { schema?: string }).schema === 'v7-compact-setting-ledger-v1');
      const itemSources = settingSources.filter((source) => (source.content as { schema?: string }).schema === 'v7-setting-fact-source-v1');
      expect(ledgerSources).toHaveLength(1);
      expect(itemSources).toHaveLength(25);
      expect(ledgerSources[0]).toMatchObject({ sourceId: 'compact-ledger-review' });
      expect(ledgerSources[0]?.content).toMatchObject({
        schema: 'v7-compact-setting-ledger-v1',
        summary: '主角、时代、规则和禁项已经统一，后续按分组边界展开。',
        groups: groupSummaries
      });
      expect(ledgerSources[0]?.content).not.toHaveProperty('itemIndex');
      expect(ledgerSources[0]?.content).not.toHaveProperty('factLedger');
      expect(itemSources[0]?.content).toMatchObject({
        schema: 'v7-setting-fact-source-v1', itemKey: 'setting-1', label: '设定1',
        facts: ['第1项硬事实。']
      });
      expect(new Set(itemSources.map((source) => source.sourceId)).size).toBe(25);
      expect(JSON.stringify(compiled.sources)).not.toContain('不应重复塞进全书规划资料包');
      expect(Array.from(JSON.stringify(compiled.sources)).length).toBeLessThan(18_000);

      context.database.prepare(`UPDATE v7_setting_items SET updated_at='2026-07-16T00:02:00.000Z'
        WHERE owner_id=? AND book_id=? AND item_key='setting-1'`).run(ownerId, bookId);
      expect(() => compiler.compile({ ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'tree_generation' }))
        .toThrow('重新统一整理当前版本');
    } finally {
      await app.close();
    }
  });
});

class SuccessfulPlanningResolver {
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return {
      provider,
      modelId,
      async generate(request: ModelRequest): Promise<ModelResult> {
        return {
          provider, modelId, output: JSON.stringify({ requestId: request.requestId, ok: true }),
          inputTokens: 10, outputTokens: 5, cashCostCny: 0, state: 'succeeded'
        };
      }
    };
  }
}

class FailingPlanningResolver {
  public resolve(_provider: string, _modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return {
      provider: 'failing-provider', modelId: 'failing-model',
      async generate(): Promise<ModelResult> { throw new Error('模拟规划失败'); }
    };
  }
}

async function register(app: FastifyInstance, email: string, displayName: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
    payload: { email, password: 'strong-pass-123', displayName } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function createBook(app: FastifyInstance, cookie: string, title: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...HEADERS, cookie }, payload: {
    idempotencyKey: 'snapshot-book-create-0001',
    openingPackage: {
      title,
      positioning: {
        publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['历史', '权谋'],
        coreAppeal: '张三改变时代。', expectedTotalWords: 3_000_000,
        // 模拟升级前已有书籍；编译时必须剔除这些旧规划结论。
        targetReaders: '旧版受众结论', volumePlan: { minimum: 6, recommended: 8, maximum: 10 },
        retentionPositioning: '旧版追读结论'
      },
      backgrounds: { eraAndWorld: '北宋末年', openingSituation: '' },
      protagonists: [{ name: '张三', age: '20岁', identity: '男主', background: '现代人穿越为小卒', familyBackground: '', careerBackground: '', goldenFinger: '', goal: '在乱世活下去并改变时代', dilemma: '身份低微', personality: ['谨慎'], boundary: '不能靠系统解决问题' }],
      opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
      longTermDirection: { centralConflict: '小人物与旧秩序的冲突', progression: '从小卒逐步成长', relationshipDirection: '与岳飞从相识到并肩', storyPotential: '身份、关系和格局逐卷改变' },
      possibleEnding: { direction: '建立新秩序', price: '承担真实损失', openness: '允许随正文调整' },
      authorNotes: [], mustFollow: ['主角必须是张三', '不使用系统和超凡力量']
    }
  } });
  expect(response.statusCode).toBe(200);
  return response.json().data.bookId as string;
}
