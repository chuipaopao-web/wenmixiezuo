import { afterEach, describe, expect, it } from 'vitest';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import { ModelAdapterError } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7CharacterMemoryModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-character-memory-model-gateway.js';
import { V7CharacterMemoryService } from '../../../apps/api/src/application/characters/v7-character-memory-service.js';
import { SystemClock, UuidGenerator } from '../../../apps/api/src/domain/ids.js';
import { createServer } from '../../../apps/api/src/http/server.js';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

const HEADERS = {
  host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site', 'content-type': 'application/json'
};
let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('V7人物角色管理后端', () => {
  it('隔离人物档案版本，用成员裁剪最小资料，并只把结算结果写成待审候选', async () => {
    context = createTestContext('wenmi-v7-character-memory-');
    const resolver = new CharacterResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'character-owner@example.com', '人物作者');
      const bookId = await createBook(app, cookie, '张三北宋行', 'character-book-0001', '张三');
      const secondBookId = await createBook(app, cookie, '李四江湖行', 'character-book-0002', '李四');
      const ownerId = (context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id;

      const synced = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/sync`, {});
      expect(synced.statusCode).toBe(200);
      expect(synced.json().data).toMatchObject({ created: 1, linkedProtagonists: 1, total: 1 });
      const initial = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/characters`);
      expect(initial.statusCode).toBe(200);
      expect(initial.json().data).toEqual([
        expect.objectContaining({ displayName: '张三', narrativeTier: 'core', currentState: null })
      ]);
      const protagonistEntityId = initial.json().data[0].entityId as string;

      const created = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters`, {
        narrativeTier: 'important', idempotencyKey: 'create-character-yuefei-0001',
        document: profile('岳飞', '张三的重要盟友', '守住山河')
      });
      expect(created.statusCode).toBe(200);
      expect(created.json().data.stableProfile).toMatchObject({ displayName: '岳飞', coreDesire: '守住山河' });
      const profileId = created.json().data.profileId as string;
      const entityId = created.json().data.entityId as string;

      const candidate = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/${profileId}/versions`, {
        activate: false, idempotencyKey: 'revise-character-yuefei-0001',
        document: profile('岳飞', '张三的重要盟友与现实压力', '守住山河并约束张三')
      });
      expect(candidate.statusCode).toBe(200);
      expect(candidate.json().data.stableProfile.coreDesire).toBe('守住山河');
      expect(candidate.json().data.versionHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ revision: 2, lifecycle: 'candidate', authority: 'candidate' })
      ]));
      const originalVersionId = candidate.json().data.versionHistory.find((item: { revision: number }) => item.revision === 1).versionId as string;
      const candidateVersionId = candidate.json().data.versionHistory.find((item: { revision: number }) => item.revision === 2).versionId as string;
      const activated = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/characters/${profileId}/versions/${candidateVersionId}/activate`, {
          idempotencyKey: 'activate-character-yuefei-0001'
        });
      expect(activated.statusCode).toBe(200);
      expect(activated.json().data.stableProfile.coreDesire).toBe('守住山河并约束张三');
      const replay = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/characters/${profileId}/versions/${candidateVersionId}/activate`, {
          idempotencyKey: 'activate-character-yuefei-0001'
      });
      expect(replay.statusCode).toBe(200);

      const rolledBack = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/characters/${profileId}/versions/${originalVersionId}/activate`, {
          idempotencyKey: 'rollback-character-yuefei-0001'
        });
      expect(rolledBack.json().data.stableProfile.coreDesire).toBe('守住山河');
      const restoredRevision = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/characters/${profileId}/versions/${candidateVersionId}/activate`, {
          idempotencyKey: 'restore-revision-character-yuefei-0001'
        });
      expect(restoredRevision.json().data.stableProfile.coreDesire).toBe('守住山河并约束张三');

      const aliased = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/${profileId}/aliases`, {
        aliases: ['岳将军', '鹏举'], idempotencyKey: 'alias-character-yuefei-0001'
      });
      expect(aliased.statusCode).toBe(200);
      expect(aliased.json().data.stableProfile.aliases).toEqual(['鹏举', '岳将军']);

      const organized = await request(app, cookie, 'PATCH', `/api/v1/v7/books/${bookId}/characters/${profileId}/organization`, {
        narrativeTier: 'supporting', idempotencyKey: 'organize-character-yuefei-0001'
      });
      expect(organized.statusCode).toBe(200);
      expect(organized.json().data).toMatchObject({ narrativeTier: 'supporting' });
      const archived = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/${profileId}/archive`, {
        idempotencyKey: 'archive-character-yuefei-0001'
      });
      expect(archived.json().data.status).toBe('archived');
      const restored = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/${profileId}/restore`, {
        idempotencyKey: 'restore-character-yuefei-0001'
      });
      expect(restored.json().data.status).toBe('active');
      expect(restored.json().data.actionHistory).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: '更新人物别名', detail: { aliases: ['鹏举', '岳将军'] } }),
        expect.objectContaining({ action: '调整人物重要程度', detail: { narrativeTier: 'supporting' } }),
        expect.objectContaining({ action: '归档人物' }),
        expect.objectContaining({ action: '恢复人物' })
      ]));

      const crossBook = await request(app, cookie, 'GET', `/api/v1/v7/books/${secondBookId}/characters/${profileId}`);
      expect(crossBook.statusCode).toBe(404);

      insertKnowledgeFacts(ownerId, bookId, protagonistEntityId, entityId);
      const packStarted = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/character-context-packs`, {
        taskKind: 'event_design', taskId: 'event-1', taskBrief: '设计张三第一次独立领兵，只取真正相关人物。',
        candidateEntityIds: [protagonistEntityId, entityId], relationshipDepth: 0, maxTokens: 3_000,
        idempotencyKey: 'character-context-pack-0001'
      });
      expect(packStarted.statusCode).toBe(200);
      const packId = packStarted.json().data.contextPackId as string;
      const pack = await pollPack(app, cookie, bookId, packId);
      expect(pack).toMatchObject({ status: 'completed', selectedCharacterCount: 1 });
      expect(pack.content.characters).toHaveLength(1);
      expect(pack.content.characters[0]).toMatchObject({ entityId: protagonistEntityId, displayName: '张三' });
      expect(pack.content.characters[0]).not.toHaveProperty('history');
      expect(pack.content.characters[0]).not.toHaveProperty('relationships');
      expect(pack.content.characters[0].knowledge.map((item: { epistemicStatus: string }) => item.epistemicStatus))
        .toEqual(['objective', 'lie']);
      expect(JSON.stringify(pack)).not.toMatch(/provider|modelId|prompt|hash|reservedTokens/iu);
      const repeatedPack = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/character-context-packs`, {
        taskKind: 'event_design', taskId: 'event-1', taskBrief: '设计张三第一次独立领兵，只取真正相关人物。',
        candidateEntityIds: [protagonistEntityId, entityId], relationshipDepth: 0, maxTokens: 3_000,
        idempotencyKey: 'character-context-pack-0001'
      });
      expect(repeatedPack.json().data.contextPackId).toBe(packId);
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM v7_character_model_calls
        WHERE owner_id=? AND book_id=? AND run_id=?`).get(ownerId, bookId, packId)).toEqual({ count: 2 });
      expect(context.database.prepare(`SELECT task_kind,workstation_key,COUNT(*) AS count
        FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_kind='character_context'
        GROUP BY task_kind,workstation_key`).get(ownerId, bookId)).toEqual({
        task_kind: 'character_context', workstation_key: 'continuity_record', count: 2
      });
      const packHistory = await request(app, cookie, 'GET',
        `/api/v1/v7/books/${bookId}/character-context-packs?taskKind=event_design&taskId=event-1`);
      expect(packHistory.statusCode).toBe(200);
      expect(packHistory.json().data).toEqual([expect.objectContaining({ contextPackId: packId, status: 'completed' })]);

      insertSettlement(ownerId, bookId, protagonistEntityId);
      const memory = new V7CharacterMemoryService(context.database, resolver, new UuidGenerator(), new SystemClock());
      const maintenanceStarted = memory.triggerMaintenance(ownerId, bookId, {
        sourceKind: 'event_settlement', sourceVersionId: 'character-settlement-1',
        candidateEntityIds: [protagonistEntityId, entityId]
      }) as { runId: string };
      const maintained = await pollMaintenance(memory, ownerId, bookId, maintenanceStarted.runId);
      expect(maintained).toMatchObject({ status: 'needs_review', candidateCount: 1, issueCount: 1 });
      expect(memory.pendingCandidates(ownerId, bookId)).toEqual([
        expect.objectContaining({ entityId: protagonistEntityId, kind: 'profile_update', state: 'pending' })
      ]);
      expect(memory.openIssues(ownerId, bookId)).toEqual([
        expect.objectContaining({ entityId: protagonistEntityId, kind: 'continuity_risk', severity: 'important' })
      ]);
      const pending = memory.pendingCandidates(ownerId, bookId) as any[];
      const accepted = memory.decideCandidate(ownerId, bookId, pending[0].candidateId, {
        decision: 'accept', idempotencyKey: 'accept-character-candidate-0001'
      }) as any;
      expect(accepted).toMatchObject({ state: 'accepted', nextStep: 'create_profile_version' });
      const issues = memory.openIssues(ownerId, bookId) as any[];
      expect(memory.decideIssue(ownerId, bookId, issues[0].issueId, {
        decision: 'resolve', idempotencyKey: 'resolve-character-issue-0001'
      })).toMatchObject({ state: 'resolved' });
      expect(memory.pendingCandidates(ownerId, bookId)).toEqual([]);
      expect(memory.openIssues(ownerId, bookId)).toEqual([]);
      expect((memory.getProfile(ownerId, bookId, initial.json().data[0].profileId) as any).stableProfile).toBeNull();
      expect(memory.triggerMaintenance(ownerId, bookId, {
        sourceKind: 'event_settlement', sourceVersionId: 'character-settlement-1',
        candidateEntityIds: [protagonistEntityId, entityId]
      })).toMatchObject({ runId: maintenanceStarted.runId });

      const foreignEntity = (await request(app, cookie, 'POST', `/api/v1/v7/books/${secondBookId}/characters/sync`, {})).json().data;
      expect(foreignEntity.total).toBe(1);
      const secondCharacters = await request(app, cookie, 'GET', `/api/v1/v7/books/${secondBookId}/characters`);
      const rejectedPack = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/character-context-packs`, {
        taskKind: 'event_design', taskId: 'event-cross', taskBrief: '不应跨书读取人物。',
        candidateEntityIds: [secondCharacters.json().data[0].entityId], maxTokens: 3_000,
        idempotencyKey: 'character-context-cross-book-0001'
      });
      expect(rejectedPack.statusCode).toBe(403);

      const unauthenticated = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/characters`, headers: HEADERS
      });
      expect(unauthenticated.statusCode).toBe(401);
      context.database.prepare(`UPDATE user_accounts SET role='user'
        WHERE email_normalized='character-owner@example.com'`).run();
      const forbiddenAudit = await request(app, cookie, 'GET',
        `/api/v1/admin/v7/character-memory/runs/audit?ownerId=${ownerId}&bookId=${bookId}&runId=${packId}`);
      expect(forbiddenAudit.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('模型结果未知时停止交接和重复调用，并向作者返回真实道歉状态', async () => {
    context = createTestContext('wenmi-v7-character-unknown-');
    const resolver = new UnknownCharacterResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'character-unknown@example.com', '人物作者');
      const bookId = await createBook(app, cookie, '未知结果测试书', 'character-book-unknown-0001', '张三');
      await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/sync`, {});
      const characters = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/characters`);
      const entityId = characters.json().data[0].entityId as string;
      const payload = {
        taskKind: 'chapter_design', taskId: 'chapter-1', taskBrief: '只准备本章需要的人物资料。',
        candidateEntityIds: [entityId], maxTokens: 2_000, idempotencyKey: 'character-context-unknown-0001'
      };
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/character-context-packs`, payload);
      const packId = started.json().data.contextPackId as string;
      const finished = await pollPack(app, cookie, bookId, packId);
      expect(finished).toMatchObject({ status: 'result_unknown' });
      expect(finished.errorMessage).toMatch(/^抱歉/u);
      const replay = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/character-context-packs`, payload);
      expect(replay.json().data).toMatchObject({ contextPackId: packId, status: 'result_unknown' });
      expect(resolver.calls).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('明确失败后可以用新尝试编号重新交接，成功结果不会被旧失败覆盖', async () => {
    context = createTestContext('wenmi-v7-character-retry-');
    const resolver = new RetryCharacterResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'character-retry@example.com', '人物作者');
      const bookId = await createBook(app, cookie, '失败恢复测试书', 'character-book-retry-0001', '张三');
      await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/sync`, {});
      const characters = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/characters`);
      const entityId = characters.json().data[0].entityId as string;
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/character-context-packs`, {
        taskKind: 'chapter_design', taskId: 'chapter-retry', taskBrief: '准备重试任务的人物资料。',
        candidateEntityIds: [entityId], maxTokens: 2_000, idempotencyKey: 'character-context-retry-0001'
      });
      const packId = started.json().data.contextPackId as string;
      const failed = await pollPack(app, cookie, bookId, packId);
      expect(failed).toMatchObject({ status: 'failed', retryCount: 0 });
      expect(resolver.calls).toBe(3);
      const logicalTaskId = `${packId}:context:1`;
      const frozenBefore = context.database.prepare(`SELECT manifest_id,compiled_prompt_hash,context_pack_id,
        task_contract_id,task_id FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_id=?`)
        .get((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id,
          bookId, logicalTaskId) as Record<string, unknown>;
      expect(frozenBefore).toMatchObject({ task_id: logicalTaskId });

      const otherBookId = await createBook(app, cookie, '另一本文人物书', 'character-book-retry-cross-0001', '李四');
      const crossBookRetry = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${otherBookId}/character-context-packs/${packId}/retry`, {});
      expect(crossBookRetry.statusCode).toBe(404);
      const retried = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/character-context-packs/${packId}/retry`, {});
      expect(retried.statusCode).toBe(200);
      expect(retried.json().data).toMatchObject({ status: 'waiting', retryCount: 1 });
      const completed = await pollPack(app, cookie, bookId, packId);
      expect(completed).toMatchObject({ status: 'completed', retryCount: 1, selectedCharacterCount: 1 });
      expect(resolver.calls).toBe(4);
      expect(resolver.requestIds).toEqual(expect.arrayContaining([
        `${packId}:context:0:1`, `${packId}:context:1:1`
      ]));
      expect(resolver.prompts[3]).toBe(resolver.prompts[0]);
      const frozenAfter = context.database.prepare(`SELECT manifest_id,compiled_prompt_hash,context_pack_id,
        task_contract_id,task_id FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_id=?`)
        .get((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?').get(bookId) as { owner_id: string }).owner_id,
          bookId, logicalTaskId) as Record<string, unknown>;
      expect(frozenAfter).toEqual(frozenBefore);
      expect((context.database.prepare(`SELECT COUNT(*) AS total FROM v7_prompt_manifests
        WHERE owner_id=(SELECT owner_id FROM books WHERE book_id=?) AND book_id=? AND task_id=?`)
        .get(bookId, bookId, logicalTaskId) as { total: number }).total).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('人物资料上游正式版本变化后拒绝沿用旧任务快照', async () => {
    context = createTestContext('wenmi-v7-character-retry-source-change-');
    const resolver = new RetryCharacterResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'character-retry-source@example.com', '人物作者');
      const bookId = await createBook(app, cookie, '人物版本变化测试书', 'character-book-source-change-0001', '张三');
      await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/sync`, {});
      const characters = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/characters`);
      const entityId = characters.json().data[0].entityId as string;
      const started = await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/character-context-packs`, {
        taskKind: 'chapter_design', taskId: 'chapter-source-change', taskBrief: '准备人物资料。',
        candidateEntityIds: [entityId], maxTokens: 2_000, idempotencyKey: 'character-context-source-change-0001'
      });
      const packId = started.json().data.contextPackId as string;
      expect(await pollPack(app, cookie, bookId, packId)).toMatchObject({ status: 'failed' });
      context.database.prepare('UPDATE books SET canon_revision=canon_revision+1 WHERE book_id=?').run(bookId);
      const retried = await request(app, cookie, 'POST',
        `/api/v1/v7/books/${bookId}/character-context-packs/${packId}/retry`, {});
      expect(retried.statusCode).toBe(200);
      expect(await pollPack(app, cookie, bookId, packId)).toMatchObject({
        status: 'outdated', errorMessage: '人物实际状态已经更新，请重新准备资料。'
      });
      expect(resolver.calls).toBe(3);
    } finally {
      await app.close();
    }
  });

  it('人物维护技术重试复用首次冻结的任务资料和提示清单', async () => {
    context = createTestContext('wenmi-v7-character-maintenance-retry-');
    const resolver = new RetryCharacterMaintenanceResolver();
    const app = await createServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'character-maintenance-retry@example.com', '人物作者');
      const bookId = await createBook(app, cookie, '人物维护重试书', 'character-maintenance-retry-book-0001', '张三');
      const ownerId = String((context.database.prepare('SELECT owner_id FROM books WHERE book_id=?')
        .get(bookId) as { owner_id: string }).owner_id);
      await request(app, cookie, 'POST', `/api/v1/v7/books/${bookId}/characters/sync`, {});
      const characters = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/characters`);
      const entityId = characters.json().data[0].entityId as string;
      insertSettlement(ownerId, bookId, entityId);
      const service = new V7CharacterMemoryService(
        context.database, resolver, new UuidGenerator(), new SystemClock()
      );
      const started = service.triggerMaintenance(ownerId, bookId, {
        sourceKind: 'event_settlement', sourceVersionId: 'character-settlement-1', candidateEntityIds: [entityId]
      }) as { runId: string };
      const failed = await pollMaintenance(service, ownerId, bookId, started.runId);
      expect(failed).toMatchObject({ status: 'failed', retryCount: 0 });
      const initialAttemptCount = resolver.calls;
      const logicalTaskId = `${started.runId}:maintenance:1`;
      const frozenBefore = context.database.prepare(`SELECT manifest_id,compiled_prompt_hash,context_pack_id,
        task_contract_id,task_id FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_id=?`)
        .get(ownerId, bookId, logicalTaskId) as Record<string, unknown>;
      expect(frozenBefore).toMatchObject({ task_id: logicalTaskId });

      resolver.allowSuccess = true;
      expect(service.retryMaintenance(ownerId, bookId, started.runId)).toMatchObject({ status: 'waiting', retryCount: 1 });
      const completed = await pollMaintenance(service, ownerId, bookId, started.runId);
      expect(completed).toMatchObject({ status: 'needs_review', retryCount: 1, candidateCount: 1, issueCount: 1 });
      expect(resolver.requestIds).toEqual(expect.arrayContaining([
        `${started.runId}:maintenance:0:1`, `${started.runId}:maintenance:1:1`
      ]));
      expect(resolver.prompts[initialAttemptCount]).toBe(resolver.prompts[0]);
      const frozenAfter = context.database.prepare(`SELECT manifest_id,compiled_prompt_hash,context_pack_id,
        task_contract_id,task_id FROM v7_prompt_manifests WHERE owner_id=? AND book_id=? AND task_id=?`)
        .get(ownerId, bookId, logicalTaskId) as Record<string, unknown>;
      expect(frozenAfter).toEqual(frozenBefore);
    } finally {
      await app.close();
    }
  });
});

class CharacterResolver implements V7CharacterMemoryModelAdapterResolver {
  private contextFailed = false;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      const taskPrompt = stageTaskPayload(request.prompt);
      if (taskPrompt.includes('v7-character-context-selection-v1') && !this.contextFailed) {
        this.contextFailed = true;
        throw new Error('模拟人物资料员临时请假');
      }
      const entityIds = [...taskPrompt.matchAll(/"entityId":"([^"]+)"/gu)].map((match) => match[1]!)
        .filter((value, index, all) => all.indexOf(value) === index);
      const output = taskPrompt.includes('v7-character-maintenance-v1')
        ? JSON.stringify({
            schema: 'v7-character-maintenance-v1', publicSummary: '张三的带队责任已经发生变化。',
            affectedEntityIds: [entityIds[0]],
            changes: [{
              kind: 'profile_update', entityId: entityIds[0], fieldPath: 'voiceAndBehavior',
              proposedValue: '开始以带队者身份做决定', publicSummary: '张三开始承担带队责任。',
              reason: '结算明确记录了他保住小队。', evidenceRefs: ['character-settlement-1']
            }],
            issues: [{
              kind: 'continuity_risk', severity: 'important', entityId: entityIds[0],
              publicSummary: '后续需要保持张三已经被小队初步信任。', evidenceRefs: ['character-settlement-1'],
              suggestedAction: '后续设计不得把小队关系重置为陌生。'
            }]
          })
        : JSON.stringify({
            schema: 'v7-character-context-selection-v1',
            selected: [{ entityId: entityIds[0], fields: ['profile', 'state', 'knowledge'], reason: '当前任务只需要主角。' }],
            excludedSummary: '岳飞暂不参与当前事件。', openQuestions: []
          });
      return { provider, modelId, output, inputTokens: 100, outputTokens: 300, cashCostCny: 0, state: 'succeeded' };
    } };
  }
}

class UnknownCharacterResolver implements V7CharacterMemoryModelAdapterResolver {
  public calls = 0;
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (): Promise<ModelResult> => {
      this.calls += 1;
      throw new ModelAdapterError('请求已经发出，但连接中断。', 'technical_failure', false, undefined, true);
    } };
  }
}

class RetryCharacterResolver implements V7CharacterMemoryModelAdapterResolver {
  public calls = 0;
  public readonly prompts: string[] = [];
  public readonly requestIds: string[] = [];
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.calls += 1;
      this.prompts.push(request.prompt);
      this.requestIds.push(request.requestId);
      if (this.calls <= 3) throw new Error('模拟所有人物资料成员本轮请假');
      const entityId = stageTaskPayload(request.prompt).match(/"entityId":"([^"]+)"/u)?.[1];
      return {
        provider, modelId, inputTokens: 100, outputTokens: 200, cashCostCny: 0, state: 'succeeded',
        output: JSON.stringify({
          schema: 'v7-character-context-selection-v1',
          selected: [{ entityId, fields: ['profile', 'state'], reason: '当前任务只需要主角。' }],
          excludedSummary: '没有其他相关人物。', openQuestions: []
        })
      };
    } };
  }
}

class RetryCharacterMaintenanceResolver implements V7CharacterMemoryModelAdapterResolver {
  public calls = 0;
  public allowSuccess = false;
  public readonly prompts: string[] = [];
  public readonly requestIds: string[] = [];
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.calls += 1;
      this.prompts.push(request.prompt);
      this.requestIds.push(request.requestId);
      if (!this.allowSuccess) throw new Error('模拟全部人物维护员本轮请假');
      const entityId = stageTaskPayload(request.prompt).match(/"entityId":"([^"]+)"/u)?.[1];
      return {
        provider, modelId, inputTokens: 100, outputTokens: 200, cashCostCny: 0, state: 'succeeded',
        output: JSON.stringify({
          schema: 'v7-character-maintenance-v1', publicSummary: '张三的带队责任已经发生变化。',
          affectedEntityIds: [entityId],
          changes: [{
            kind: 'profile_update', entityId, fieldPath: 'voiceAndBehavior',
            proposedValue: '开始以带队者身份做决定', publicSummary: '张三开始承担带队责任。',
            reason: '正式结算记录了他保住小队。', evidenceRefs: ['character-settlement-1']
          }],
          issues: [{
            kind: 'continuity_risk', severity: 'important', entityId,
            publicSummary: '后续要保持小队已经初步信任张三。', evidenceRefs: ['character-settlement-1'],
            suggestedAction: '不能把小队关系重置为陌生。'
          }]
        })
      };
    } };
  }
}

function stageTaskPayload(compiledPrompt: string): string {
  try {
    const manifest = JSON.parse(compiledPrompt) as {
      contextPack?: { content?: { stageTaskPayload?: unknown } };
    };
    return typeof manifest.contextPack?.content?.stageTaskPayload === 'string'
      ? manifest.contextPack.content.stageTaskPayload
      : compiledPrompt;
  } catch {
    return compiledPrompt;
  }
}

function profile(displayName: string, dramaticFunction: string, coreDesire: string): Record<string, unknown> {
  return {
    schema: 'v7-character-profile-v1', displayName, aliases: [], dramaticFunction, coreDesire,
    longTermGoal: coreDesire, fearOrWeakness: '害怕辜负同伴', personalityTraits: ['坚定', '克制'],
    voiceAndBehavior: '说话直接，行动前会核对代价。', visualAnchor: '目光坚定',
    hardBoundaries: ['不能替代张三成为主角'], openQuestions: [], publicSummary: dramaticFunction
  };
}

async function register(app: Awaited<ReturnType<typeof createServer>>, email: string, displayName: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: HEADERS,
    payload: { email, password: 'strong-pass-123', displayName } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function createBook(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, title: string, key: string, protagonist: string
): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...HEADERS, cookie }, payload: {
    idempotencyKey: key,
    openingPackage: {
      title, positioning: {
        publishingPlatform: 'fanqie', channel: 'male', category: '历史脑洞', genres: ['历史脑洞'], tags: ['历史'],
        coreAppeal: `${protagonist}改变时代。`, targetReaders: '喜欢历史穿越和人物成长的男频读者',
        expectedTotalWords: 2_000_000, volumePlan: { minimum: 5, recommended: 6, maximum: 8 },
        retentionPositioning: '开篇快速建立处境，逐卷兑现人物成长、关系变化和格局升级。'
      },
      backgrounds: { eraAndWorld: '北宋末年', openingSituation: '' },
      protagonists: [{ name: protagonist, age: '20岁', identity: '男主', background: '现代人穿越为小卒', familyBackground: '', careerBackground: '', goldenFinger: '', goal: '改变时代', dilemma: '身份低微', personality: ['谨慎'], boundary: '不能靠系统解决问题' }],
      opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
      longTermDirection: { centralConflict: '小人物与旧秩序冲突', progression: '从小卒成长', relationshipDirection: '结识同伴', storyPotential: '逐卷扩大影响' },
      possibleEnding: { direction: '建立新秩序', price: '承担损失', openness: '允许调整' }, authorNotes: [],
      mustFollow: [`主角必须是${protagonist}`, '不使用系统和超凡力量']
    }
  } });
  expect(response.statusCode).toBe(200);
  return response.json().data.bookId as string;
}

function insertSettlement(ownerId: string, bookId: string, protagonistEntityId: string): void {
  const now = '2026-07-16T01:00:00.000Z';
  context!.database.prepare(`INSERT INTO stage_settlements
    (stage_settlement_id,owner_id,book_id,stage_type,stage_key,version,chapter_start,chapter_end,canon_revision,
     irreversible_results_json,entity_states_json,closed_threads_json,open_threads_json,relationship_changes_json,
     knowledge_changes_json,resource_changes_json,rule_changes_json,exclusions_json,status,created_at,activated_at)
    VALUES ('character-settlement-1',?,?,'story_arc','event-1',1,1,8,0,?,?,?,?,?,?,?,?,?,'active',?,?)`).run(
    ownerId, bookId, JSON.stringify(['张三保住了小队']), JSON.stringify([{ entityId: protagonistEntityId, state: '成为带队者' }]),
    JSON.stringify([]), JSON.stringify(['上级会如何试探张三']),
    JSON.stringify([{ entityId: protagonistEntityId, change: '小队初步信任' }]), JSON.stringify([]),
    JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), now, now
  );
}

function insertKnowledgeFacts(ownerId: string, bookId: string, protagonistEntityId: string, otherEntityId: string): void {
  const statement = context!.database.prepare(`INSERT INTO fact_assertions
    (fact_id,owner_id,book_id,subject_entity_id,relation_key,value_json,story_time_start,story_time_end,
     source_chapter_id,source_manuscript_version_id,evidence_json,epistemic_status,negated,viewpoint_entity_id,
     knowledge_subject_id,knowledge_time_start,knowledge_time_end,temporal_completeness,grade,status,created_at)
    VALUES (?,?,?,?,?,? ,NULL,NULL,NULL,NULL,'[]',?,0,NULL,?,NULL,NULL,'complete','B','active',?)`);
  statement.run(
    'character-knowledge-objective', ownerId, bookId, protagonistEntityId, 'knows_self_role',
    JSON.stringify('自己负责带队'), 'objective', protagonistEntityId, '2026-07-16T00:00:00.000Z'
  );
  statement.run(
    'character-knowledge-lie', ownerId, bookId, otherEntityId, 'believes_false_order',
    JSON.stringify('岳飞已经奉命离城'), 'lie', protagonistEntityId, '2026-07-16T00:01:00.000Z'
  );
}

async function request(
  app: Awaited<ReturnType<typeof createServer>>, cookie: string, method: 'GET'|'POST'|'PATCH', url: string, payload?: unknown
) {
  const headers = { ...HEADERS, cookie };
  return payload === undefined ? await app.inject({ method, url, headers }) : await app.inject({ method, url, headers, payload: payload as object });
}

async function pollPack(app: Awaited<ReturnType<typeof createServer>>, cookie: string, bookId: string, packId: string): Promise<any> {
  for (let index = 0; index < 100; index += 1) {
    const response = await request(app, cookie, 'GET', `/api/v1/v7/books/${bookId}/character-context-packs/${packId}`);
    expect(response.statusCode).toBe(200);
    const view = response.json().data;
    if (!['waiting', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('人物资料包未按时完成');
}

async function pollMaintenance(
  service: V7CharacterMemoryService, ownerId: string, bookId: string, runId: string
): Promise<any> {
  for (let index = 0; index < 100; index += 1) {
    const view = service.getMaintenance(ownerId, bookId, runId) as any;
    if (!['waiting', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('人物维护未按时完成');
}
