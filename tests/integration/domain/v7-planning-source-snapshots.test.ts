import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { V7_PLANNING_MEMBERS } from '@wenmi/v7-backend';
import {
  V7PlanningSourceCompiler,
  planningSnapshotSourceTraces
} from '../../../apps/api/src/application/planning/v7-planning-source-compiler.js';
import { V7SettingLedgerReader } from '../../../apps/api/src/application/books/v7-setting-ledger-reader.js';
import { createServer } from '../../../apps/api/src/http/v7-server.js';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { V7PlanningModelGateway } from '../../../apps/api/src/infrastructure/models/v7-planning-model-gateway.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { v7GenreProfileFixtureResult } from '../../helpers/v7-genre-profile-model-fixture.js';

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

  it('规划网关在题材档案缺失时只懒生成一次并让后续任务复用', async () => {
    context = createTestContext('wenmi-v7-planning-genre-profile-');
    const resolver = new SuccessfulPlanningResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'snapshot-genre@example.com', '题材档案作者');
      const bookId = await createBook(app, cookie, '北宋题材档案');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      const chief = V7_PLANNING_MEMBERS.find((member) => (
        member.roleKey === 'chief_editor' && member.enabledByDefault
      ))!;
      const gateway = new V7PlanningModelGateway(context.database, resolver, new FixedClock());
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_book_genre_profiles
        WHERE owner_id=? AND book_id=?`).get(ownerId, bookId)).toEqual({ count: 0 });

      for (const requestId of ['planning-genre-lazy-0001', 'planning-genre-lazy-0002']) {
        await gateway.generate({
          requestId, ownerId, bookId, runId: `run-${requestId}`, runKind: 'recipe', nodeKey: requestId,
          taskKind: 'planning_review', workstationKey: 'full_book_route', operationMode: 'fresh',
          basedOnTaskId: null, authorInstructionVersion: null, sourceTraces: [], member: chief,
          prompt: JSON.stringify({ task: '验证题材档案只生成一次', requestId }),
          maxOutputTokens: 200, temperature: 0.2
        });
      }

      expect(resolver.genreProfileCalls).toBe(1);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_setting_model_calls
        WHERE owner_id=? AND book_id=? AND node_key='genre_profile'`).get(ownerId, bookId)).toEqual({ count: 1 });
      const active = context.database.prepare(`SELECT profile_id,version,status FROM v7_book_genre_profiles
        WHERE owner_id=? AND book_id=? AND status='active'`).get(ownerId, bookId) as {
          profile_id: string;
          version: number;
          status: string;
        };
      expect(active).toMatchObject({ version: 1, status: 'active' });
      expect(context.database.prepare(`SELECT task_id,genre_profile_id,genre_profile_version
        FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_id IN (?,?) ORDER BY task_id`)
        .all(ownerId, bookId, 'planning-genre-lazy-0001', 'planning-genre-lazy-0002')).toEqual([
          { task_id: 'planning-genre-lazy-0001', genre_profile_id: active.profile_id, genre_profile_version: 1 },
          { task_id: 'planning-genre-lazy-0002', genre_profile_id: active.profile_id, genre_profile_version: 1 }
        ]);
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

  it('小规模已确认设定不被失败或覆盖不完整的总审永久锁死', async () => {
    context = createTestContext('wenmi-v7-planning-ledger-recovery-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'snapshot-ledger-recovery@example.com', '总审恢复作者');
      const bookId = await createBook(app, cookie, '已确认设定恢复书');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      const opening = context.database.prepare(`SELECT version FROM book_opening_blueprints
        WHERE owner_id=? AND book_id=? AND status='active'`).get(ownerId, bookId) as { version: number };
      const now = '2026-07-16T00:00:00.000Z';
      context.database.prepare(`INSERT INTO v7_setting_item_versions
        (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
        VALUES ('recovery-setting-version',?,?,'world-stage',1,'confirmed',?,'author',?)`)
        .run(ownerId, bookId, JSON.stringify({
          finalContent: '故事发生在北宋边军。', contextSummary: '北宋边军且无超凡力量。',
          factEntries: ['时代是北宋。', '没有超凡力量。']
        }), now);
      context.database.prepare(`INSERT INTO v7_setting_items
        (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
        VALUES (?,?,'world-stage','世界舞台','核心设定','确定时代边界','confirmed','recovery-setting-version',1,?)`)
        .run(ownerId, bookId, now);
      context.database.prepare(`INSERT INTO v7_setting_batches
        (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,
          opening_version,opening_hash,roster_json,error_message,created_at,updated_at)
        VALUES ('failed-final-review',?,?,'failed-final-review-key','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'partially_failed',?,?,?,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','[]','模型额度不足',?,?)`).run(
        ownerId,
        bookId,
        JSON.stringify({ taskKind: 'batch_final_review', result: null }),
        JSON.stringify({ taskKind: 'batch_final_review', phase: 'failed', progress: 90 }),
        opening.version,
        '2026-07-16T00:01:00.000Z',
        '2026-07-16T00:01:00.000Z'
      );

      const compiler = new V7PlanningSourceCompiler(context.database, new SequenceIds(), new FixedClock());
      const afterFailure = compiler.compile({
        ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design'
      });
      const failureLedger = afterFailure.sources.find((source) => (
        source.sourceKind === 'setting'
        && (source.content as { schema?: string }).schema === 'v7-compact-setting-ledger-v1'
      ));
      expect(failureLedger).toMatchObject({ sourceId: `setting-ledger:${bookId}` });
      expect(failureLedger?.content).toMatchObject({
        schema: 'v7-compact-setting-ledger-v1'
      });
      expect(afterFailure.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'setting', sourceId: 'recovery-setting-version' })
      ]));

      context.database.prepare(`UPDATE v7_setting_batches
        SET status='awaiting_author',selected_items_json=?,custom_items_json=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND batch_id='failed-final-review'`).run(
        JSON.stringify({
          taskKind: 'batch_final_review', resultHash: 'stale-result', result: {
            verdict: 'pass', summary: '历史总审结果', contextSummary: '历史总账只覆盖了旧条目。',
            factLedger: [{ itemKey: 'retired-setting', label: '旧条目', facts: ['已不属于当前书籍。'] }],
            groupSummaries: [{ groupTitle: '旧分组', summary: '旧总账', itemKeys: ['retired-setting'] }],
            unifiedDecisions: [], conflicts: [], patchedItemKeys: []
          }
        }),
        JSON.stringify({ taskKind: 'batch_final_review', phase: 'ready', progress: 100 }),
        '2026-07-16T00:02:00.000Z', ownerId, bookId
      );
      const afterMismatch = compiler.compile({
        ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'tree_generation'
      });
      expect(afterMismatch.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'setting', sourceId: `setting-ledger:${bookId}` }),
        expect.objectContaining({ sourceKind: 'setting', sourceId: 'recovery-setting-version' })
      ]));
    } finally {
      await app.close();
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

  it('逐项设定事实超过快照预算时自动降级为语义索引，规划不再要求作者缩小资料', async () => {
    context = createTestContext('wenmi-v7-planning-light-index-');
    const app = await createServer(context.config, context.database);
    try {
      const cookie = await register(app, 'snapshot-light-index@example.com', '轻量索引作者');
      const bookId = await createBook(app, cookie, '两百条设定长篇');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      const opening = context.database.prepare(`SELECT version FROM book_opening_blueprints
        WHERE owner_id=? AND book_id=? AND status='active'`).get(ownerId, bookId) as { version: number };
      const itemKeys: string[] = [];
      for (let index = 1; index <= 80; index += 1) {
        const itemKey = `bulk-setting-${index}`;
        const versionId = `bulk-ledger-version-${index}`;
        itemKeys.push(itemKey);
        const content = {
          finalContent: `这是第${index}项设定的完整原文，包含完整的世界规则和人物约束。`.repeat(8),
          contextSummary: `第${index}项设定的关键身份、边界和规则。`,
          factEntries: [`第${index}项硬事实：这是一条很长的设定硬事实，用于让完整事实账超过快照预算。`.repeat(6)]
        };
        context.database.prepare(`INSERT INTO v7_setting_item_versions
          (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
          VALUES (?,?,?,?,1,'confirmed',?,'author','2026-07-16T00:00:00.000Z')`)
          .run(versionId, ownerId, bookId, itemKey, JSON.stringify(content));
        context.database.prepare(`INSERT INTO v7_setting_items
          (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
          VALUES (?,?,?,?,?,'测试设定','confirmed',?,1,'2026-07-16T00:00:00.000Z')`)
          .run(ownerId, bookId, itemKey, `设定${index}`, `分组${Math.ceil(index / 20)}`, versionId);
      }
      const groupSummaries = Array.from({ length: 10 }, (_, index) => ({
        groupTitle: `分组${index + 1}`,
        summary: `这一组统一说明第${index * 20 + 1}至${index * 20 + 20}项设定的关键边界。`,
        itemKeys: itemKeys.slice(index * 20, index * 20 + 20)
      }));
      context.database.prepare(`INSERT INTO v7_setting_batches
        (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,
          opening_version,opening_hash,roster_json,created_at,updated_at)
        VALUES ('bulk-light-review',?,?,'bulk-light-review-key','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','awaiting_author',?,?,?,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','[]',
          '2026-07-16T00:01:00.000Z','2026-07-16T00:01:00.000Z')`).run(
        ownerId,
        bookId,
        JSON.stringify({
          taskKind: 'batch_final_review',
          resultHash: 'bulk-light-hash',
          result: {
            verdict: 'pass',
            summary: '全部设定已经统一。',
            contextSummary: '主角、时代、规则和禁项已经统一，后续按分组边界展开。',
            factLedger: itemKeys.map((itemKey, index) => ({
              itemKey, label: `设定${index + 1}`,
              facts: [`第${index + 1}项硬事实：这是一条很长的设定硬事实，用于让完整事实账超过快照预算。`.repeat(6)]
            })),
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
      expect(itemSources).toHaveLength(80);
      expect(ledgerSources[0]?.content).toMatchObject({ schema: 'v7-compact-setting-ledger-v1' });
      expect(itemSources[0]?.content).toMatchObject({
        schema: 'v7-setting-fact-source-v1', itemKey: 'bulk-setting-1', label: '设定1'
      });
      expect(itemSources[0]?.content).not.toHaveProperty('facts');
      expect(itemSources[0]?.content).not.toHaveProperty('contextSummary');
      expect(itemSources[0]?.label).toContain('轻量索引');
      expect(JSON.stringify(compiled.sources)).not.toContain('完整的世界规则和人物约束');
      expect(JSON.stringify(compiled.sources)).not.toContain('超过快照预算');
    } finally {
      await app.close();
    }
  });
});

describe('V7设定总账门禁只校验导航投影', () => {
  const OWNER_ID = 'owner-ledger-gate-test';
  const OPENING_VERSION = 1;
  const ITEM_TIME = '2026-07-16T00:00:00.000Z';
  const BATCH_TIME = '2026-07-16T00:01:00.000Z';

  function insertBook(bookId: string): void {
    const db = context!.database;
    db.prepare(`INSERT OR IGNORE INTO owners
      (owner_id,display_name,version,created_at,updated_at)
      VALUES (?,?,1,?,?)`).run(OWNER_ID, '总账门禁测试作者', ITEM_TIME, ITEM_TIME);
    db.prepare(`INSERT OR IGNORE INTO user_accounts
      (user_id,owner_id,email_normalized,display_name,password_salt,password_hash,role,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `user-${OWNER_ID}`, OWNER_ID, `${OWNER_ID}@example.com`, '总账门禁测试作者', 'salt', 'hash', 'user', 'active', ITEM_TIME, ITEM_TIME
    );
    db.prepare(`INSERT INTO books
      (book_id,owner_id,title,status,version,positioning_version,canon_revision,active_editor_agent_id,editor_epoch,created_at,updated_at,archived_at)
      VALUES (?,?,?,'draft',1,0,0,NULL,0,?,?,NULL)`).run(bookId, OWNER_ID, `门禁测试书-${bookId}`, ITEM_TIME, ITEM_TIME);
  }

  function insertItemRows(bookId: string, itemKeys: string[]): void {
    const db = context!.database;
    itemKeys.forEach((key, index) => {
      db.prepare(`INSERT INTO v7_setting_items
        (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
        VALUES (?,?,?,?,?,?, 'confirmed',?,1,?)`)
        .run(OWNER_ID, bookId, key, `设定${index + 1}`, '核心设定', '说明规则', `ledger-version-${index + 1}`, ITEM_TIME);
    });
  }

  function insertFinalReview(bookId: string, batchId: string, status: string, selected: unknown): void {
    context!.database.prepare(`INSERT INTO v7_setting_batches
      (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,
        opening_version,opening_hash,roster_json,error_message,created_at,updated_at)
      VALUES (?,?,?, ?,?,? ,?,?, ?,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','[]',NULL,?,?)`)
      .run(
        batchId, OWNER_ID, bookId, `${batchId}-key`, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status,
        JSON.stringify(selected),
        JSON.stringify({ taskKind: 'batch_final_review', phase: 'ready', progress: 100 }),
        OPENING_VERSION, ITEM_TIME, BATCH_TIME
      );
  }

  function settingsFor(itemKeys: string[], fact: string): Array<{
    item_key: string;
    item_label: string;
    version_id: string;
    revision: number;
    content_json: string;
  }> {
    return itemKeys.map((key, index) => ({
      item_key: key,
      item_label: `设定${index + 1}`,
      version_id: `ledger-version-${index + 1}`,
      revision: 1,
      content_json: JSON.stringify({ contextSummary: `第${index + 1}项的关键边界。`, factEntries: [fact] })
    }));
  }

  it('完整事实账超过8000字但导航投影未超限时规划可以继续，事实账与正式设定保持不变', () => {
    context = createTestContext('wenmi-v7-ledger-gate-nav-');
    try {
      const bookId = 'book-ledger-gate-nav';
      const itemKeys = Array.from({ length: 25 }, (_, index) => `setting-${index + 1}`);
      const longFact = '这是一条很长的设定硬事实，用于验证完整事实账超过门禁也不会被截断或重写。'.repeat(20);
      insertBook(bookId);
      insertItemRows(bookId, itemKeys);
      const factLedger = itemKeys.map((key, index) => ({ itemKey: key, label: `设定${index + 1}`, facts: [longFact] }));
      insertFinalReview(bookId, 'nav-gate-review', 'awaiting_author', {
        taskKind: 'batch_final_review', resultHash: 'nav-gate-hash', result: {
          verdict: 'pass', summary: '全部设定已经统一。', contextSummary: '主角、时代、规则和禁项已经统一。',
          factLedger,
          groupSummaries: [{ groupTitle: '全部设定', summary: '全部条目已统一。', itemKeys }],
          unifiedDecisions: [], conflicts: [], patchedItemKeys: []
        }
      });

      const reader = new V7SettingLedgerReader(context!.database);
      const ledger = reader.readCurrent({
        ownerId: OWNER_ID, bookId, openingVersion: OPENING_VERSION, settings: settingsFor(itemKeys, longFact)
      });
      expect(ledger.sourceId).toBe('nav-gate-review');
      expect(ledger.content.factLedger).toHaveLength(25);
      expect(Array.from(JSON.stringify(ledger.content.factLedger)).length).toBeGreaterThan(8_000);
      expect(ledger.content.factLedger[0]).toEqual({
        itemKey: 'setting-1', label: '设定1', versionId: 'ledger-version-1', revision: 1, facts: [longFact]
      });
      expect(ledger.content.groups[0]?.itemKeys).toEqual(itemKeys);
      expect(ledger.content.itemIndex).toEqual([]);
      expect(ledger.projections).toHaveLength(25);
      expect(ledger.projections[0]).toMatchObject({ itemKey: 'setting-1', versionId: 'ledger-version-1', revision: 1 });
    } finally {
      // afterEach closes the test context once, including when setup fails.
    }
  });

  it('导航投影本身超过门禁时安全拒绝，且不泄漏内部字符计数', () => {
    context = createTestContext('wenmi-v7-ledger-gate-nav-over-');
    try {
      const bookId = 'book-ledger-gate-nav-over';
      const itemKeys = Array.from({ length: 25 }, (_, index) => `setting-${index + 1}`);
      const fact = '短硬事实。';
      insertBook(bookId);
      insertItemRows(bookId, itemKeys);
      const factLedger = itemKeys.map((key, index) => ({ itemKey: key, label: `设定${index + 1}`, facts: [fact] }));
      const hugeSummary = '这是一段过于冗长、应该由主编重新统一整理的高层导航摘要，用来让导航投影本身超过安全上限。'.repeat(220);
      insertFinalReview(bookId, 'nav-over-review', 'awaiting_author', {
        taskKind: 'batch_final_review', resultHash: 'nav-over-hash', result: {
          verdict: 'pass', summary: '全部设定已经统一。', contextSummary: hugeSummary,
          factLedger,
          groupSummaries: [{ groupTitle: '全部设定', summary: '全部条目已统一。', itemKeys }],
          unifiedDecisions: [], conflicts: [], patchedItemKeys: []
        }
      });

      const reader = new V7SettingLedgerReader(context!.database);
      const read = (): void => {
        reader.readCurrent({
          ownerId: OWNER_ID, bookId, openingVersion: OPENING_VERSION, settings: settingsFor(itemKeys, fact)
        });
      };
      expect(() => read()).toThrow(/重新发起一次统一整理/);
      try {
        read();
        throw new Error('应当拒绝导航投影超限');
      } catch (error) {
        expect(error).toMatchObject({ details: {} });
        expect(JSON.stringify(error)).not.toMatch(/navigationProjectionCharacters|\d{3,}字/);
      }
    } finally {
      // afterEach closes the test context once, including when setup fails.
    }
  });

  it('无设定、少量设定与失败总审保持原有兼容总账行为', () => {
    context = createTestContext('wenmi-v7-ledger-gate-compat-');
    try {
      const reader = new V7SettingLedgerReader(context!.database);

      // 无设定：没有可用总审 → 兼容总账，空事实账
      const emptyBook = 'book-ledger-gate-empty';
      const emptyLedger = reader.readCurrent({
        ownerId: OWNER_ID, bookId: emptyBook, openingVersion: OPENING_VERSION, settings: []
      });
      expect(emptyLedger.sourceId).toBe(`setting-ledger:${emptyBook}`);
      expect(emptyLedger.content.factLedger).toEqual([]);

      // 少量设定（≤8）＋ 失败总审 → 兼容总账，逐项事实账保留
      const smallBook = 'book-ledger-gate-small';
      const fewKeys = Array.from({ length: 3 }, (_, index) => `small-${index + 1}`);
      insertBook(smallBook);
      insertFinalReview(smallBook, 'failed-review-small', 'partially_failed', { taskKind: 'batch_final_review', result: null });
      const compatLedger = reader.readCurrent({
        ownerId: OWNER_ID, bookId: smallBook, openingVersion: OPENING_VERSION, settings: settingsFor(fewKeys, '少量事实。')
      });
      expect(compatLedger.sourceId).toBe(`setting-ledger:${smallBook}`);
      expect(compatLedger.content.factLedger).toHaveLength(3);
      expect(compatLedger.content.factLedger[0]).toMatchObject({ itemKey: 'small-1', facts: ['少量事实。'] });

      // 大量设定（>8）＋ 失败总审 → 仍按原行为要求先完成全书统一整理
      const largeBook = 'book-ledger-gate-large';
      const manyKeys = Array.from({ length: 12 }, (_, index) => `large-${index + 1}`);
      insertBook(largeBook);
      insertFinalReview(largeBook, 'failed-review-many', 'partially_failed', { taskKind: 'batch_final_review', result: null });
      expect(() => reader.readCurrent({
        ownerId: OWNER_ID, bookId: largeBook, openingVersion: OPENING_VERSION, settings: settingsFor(manyKeys, '大量事实。')
      })).toThrow(/设定条目较多/);
    } finally {
      // afterEach closes the test context once, including when setup fails.
    }
  });
});

class SuccessfulPlanningResolver {
  public genreProfileCalls = 0;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    const resolver = this;
    return {
      provider,
      modelId,
      async generate(request: ModelRequest): Promise<ModelResult> {
        const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
        if (genreProfile !== null) {
          resolver.genreProfileCalls += 1;
          return genreProfile;
        }
        return {
          provider, modelId, output: JSON.stringify({ requestId: request.requestId, ok: true }),
          inputTokens: 10, outputTokens: 5, cashCostCny: 0, state: 'succeeded'
        };
      }
    };
  }
}

class FailingPlanningResolver {
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return {
      provider: 'failing-provider', modelId: 'failing-model',
      async generate(request: ModelRequest): Promise<ModelResult> {
        const genreProfile = v7GenreProfileFixtureResult(provider, modelId, request);
        if (genreProfile !== null) return genreProfile;
        throw new Error('模拟规划失败');
      }
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
