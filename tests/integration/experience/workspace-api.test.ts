import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../../apps/api/src/http/server.js';
import { initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('工作台API', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    context?.close();
  });

  it('工作区按书聚合真实状态，明确命令零模型调用', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '工作台接口书', text: '聚合工作区并执行确定性命令'
    });
    prepareBookForWriting(context, { ownerId: context.config.ownerId, bookId: book.bookId }, ids, clock, 1);
    app = await createServer(context.config, context.database, { trustedTest: true });
    const workspaceResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/workspace` });
    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json().data).toMatchObject({
      book: { bookId: book.bookId, title: '工作台接口书' },
      confirmations: { count: 0 }
    });
    expect(workspaceResponse.json().data.agents).toHaveLength(11);
    expect(workspaceResponse.json().data).toMatchObject({
      volumes: [],
      localAssistant: expect.objectContaining({ displayName: '小文秘书', status: 'ready' })
    });
    expect(workspaceResponse.json().data.agents[0]).toEqual(expect.objectContaining({ publicSummary: expect.any(String), responsibilities: expect.any(Array) }));
    const artifactsResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/artifacts` });
    expect(artifactsResponse.statusCode).toBe(200);
    expect(artifactsResponse.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifact_type: 'story_bible', status: 'active', active_content: expect.objectContaining({ mainPlot: expect.any(Object) }) }),
      expect.objectContaining({ artifact_type: 'volume_outline', status: 'active', active_content: expect.objectContaining({ volumeNumber: 1 }) }),
      expect.objectContaining({ artifact_type: 'chapter_outline', status: 'active', active_content: expect.objectContaining({ sourceDecisionId: expect.any(String) }) })
    ]));
    const storyArtifact = artifactsResponse.json().data.find((item: Record<string, unknown>) => item.artifact_type === 'story_bible') as Record<string, unknown>;
    const candidate = (await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/artifacts/${storyArtifact.artifact_id}/versions`,
      payload: { content: storyArtifact.active_content, parentVersionId: storyArtifact.active_version_id }
    })).json().data as { artifactVersionId: string; status: string };
    const compared = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/artifacts/${storyArtifact.artifact_id}/compare?left=${storyArtifact.active_version_id}&right=${candidate.artifactVersionId}` });
    expect(compared.json().data).toMatchObject({ same: true, changedTopLevelKeys: [] });
    const rejected = await app.inject({ method: 'POST', url: `/api/v1/books/${book.bookId}/artifacts/${storyArtifact.artifact_id}/versions/${candidate.artifactVersionId}/reject`, payload: {} });
    expect(rejected.json().data.status).toBe('invalidated');
    const replacement = (await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/artifacts/${storyArtifact.artifact_id}/versions`,
      payload: { content: storyArtifact.active_content, parentVersionId: storyArtifact.active_version_id }
    })).json().data as { artifactVersionId: string };
    const selectedPlanning = await app.inject({ method: 'POST', url: `/api/v1/books/${book.bookId}/artifacts/${storyArtifact.artifact_id}/select`, payload: { versionId: replacement.artifactVersionId } });
    expect(selectedPlanning.json().data.status).toBe('selected');

    const libraryResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/library` });
    expect(libraryResponse.statusCode).toBe(200);
    expect(libraryResponse.json().data).toEqual(expect.objectContaining({ canonRevision: 0, entities: expect.any(Array), summary: expect.any(Object) }));
    const bindingsResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/model-bindings` });
    expect(bindingsResponse.statusCode).toBe(200);
    expect(bindingsResponse.json().data.active).toHaveLength(11);
    const profiles = Object.fromEntries(bindingsResponse.json().data.active.map((binding: Record<string, unknown>) => [binding.roleKey, {
      provider: binding.provider, modelId: binding.modelId, plan: binding.plan
    }]));
    const previewResponse = await app.inject({ method: 'POST', url: `/api/v1/books/${book.bookId}/model-bindings/preview`, payload: { profiles } });
    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json().data).toMatchObject({ valid: true, futureTasksOnly: true, roleCount: 11 });

    const commandResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/messages`, payload: { content: '写1章' }
    });
    expect(commandResponse.statusCode).toBe(200);
    expect(commandResponse.json().data.action).toMatchObject({ kind: 'chapter_batch_scheduled', count: 1 });
    const scheduledWorkspace = (await app.inject({
      method: 'GET', url: `/api/v1/books/${book.bookId}/workspace`
    })).json().data;
    expect(scheduledWorkspace.tasks[0]).toMatchObject({
      chapterId: scheduledWorkspace.chapters[0].chapterId,
      brief: { chapterNumber: 1 },
      checkpoint: {},
      cancelRequested: false
    });
    expect(scheduledWorkspace.volumes).toEqual([
      expect.objectContaining({ volumeNumber: 1, chapterCount: 1 })
    ]);
    expect(scheduledWorkspace.chapters[0].volumeId).toBe(scheduledWorkspace.volumes[0].volumeId);
    const chapterPage = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.bookId}/volumes/${scheduledWorkspace.volumes[0].volumeId}/chapters?limit=1&query=1&status=planned`
    });
    expect(chapterPage.statusCode).toBe(200);
    expect(chapterPage.json().data).toMatchObject({ total: 1, offset: 0, limit: 1, items: [
      expect.objectContaining({ chapterId: scheduledWorkspace.chapters[0].chapterId, chapterNumber: 1 })
    ] });
    const prepareResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/messages`, payload: { content: '准备接管' }
    });
    expect(prepareResponse.json().data.action).toMatchObject({ kind: 'takeover_prepared', fromEpoch: 1 });
    const takeoverId = prepareResponse.json().data.action.takeoverId as string;
    const takeoverResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/messages`, payload: { content: `确认接管 ${takeoverId}` }
    });
    expect(takeoverResponse.json().data.action).toMatchObject({ kind: 'takeover_completed', editorEpoch: 2 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM model_calls WHERE owner_id = ? AND book_id = ?`)
      .get(context.config.ownerId, book.bookId)).toEqual({ count: 0 });
  });

  it('工作区返回当前持续剧情会话和可读黑板，不泄露内部事件原文', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '持续会话接口书',
      text: '张三准备进入天安城调查旧案'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const message = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/messages`,
      payload: { content: '讨论张三应该怎样进入天安城' }
    });
    expect(message.statusCode).toBe(200);
    expect(message.json().data.action).toMatchObject({
      kind: 'creative_session_started',
      roundKind: 'initial_exploration'
    });

    const workspaceResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/books/${book.bookId}/workspace`
    });
    expect(workspaceResponse.statusCode).toBe(200);
    expect(workspaceResponse.json().data.creativeSession).toMatchObject({
      status: 'exploring',
      mode: 'creative_forecast',
      activeTopic: '讨论张三应该怎样进入天安城',
      currentBlackboardRevision: 1,
      blackboard: {
        revision: 1,
        currentGoal: '讨论张三应该怎样进入天安城',
        maturity: 'exploring'
      },
      activeForecast: null
    });
    expect(workspaceResponse.json().data.creativeSession.blackboard.ownerMessages).toBeUndefined();
    expect(workspaceResponse.json().data.creativeSession.blackboard.evidence).toBeUndefined();
  });

  it('研究元数据可查看但接口不返回缓存原文，候选不会修改正史', async () => {
    context = createTestContext();
    const book = initializeDomainBook(context, context.config.ownerId, new SequenceIds(), new FixedClock(), {
      title: '研究接口书', text: '验证研究来源隔离'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const sourceResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/research/sources`, payload: {
        title: '历史公开资料', content: '原始研究材料只存储在研究缓存，不应由列表接口直接返回。',
        language: 'zh-CN', credibility: 75
      }
    });
    const sourceId = sourceResponse.json().data.researchSourceId as string;
    await app.inject({
      method: 'POST', url: `/api/v1/books/${book.bookId}/research/claims`, payload: {
        sourceId, claim: '某制度可能限制人物通行', evidence: '公开材料中的制度记载'
      }
    });
    const listResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/research/sources` });
    expect(listResponse.body).not.toContain('原始研究材料只存储在研究缓存');
    expect(listResponse.json().data[0]).toMatchObject({ title: '历史公开资料', credibility: 75 });
    const claimsResponse = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/research/claims` });
    expect(claimsResponse.json().data[0]).toMatchObject({ candidate_status: 'candidate' });
    expect(context.database.prepare(`SELECT canon_revision FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(context.config.ownerId, book.bookId)).toEqual({ canon_revision: 0 });
  });

  it('主角资料和属性公式可维护、保留历史并按书隔离', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '主角接口书', text: '领主经营与军队属性' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '隔离书', text: '验证跨书隔离' });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const profileResponse = await app.inject({ method: 'POST', url: `/api/v1/books/${first.bookId}/protagonists`, payload: { displayName: '林澈', isPrimary: true } });
    expect(profileResponse.statusCode).toBe(200);
    const profileId = profileResponse.json().data.profileId as string;
    const stateResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/protagonists/${profileId}/state`,
      payload: { category: '待归类', logicalKey: '主城等级', label: '主城等级', valueType: 'number', value: 3, unit: '级', confirmed: true }
    });
    expect(stateResponse.json().data).toMatchObject({ value: 3, authorityLayer: 'canon', revision: 1 });
    const stateId = stateResponse.json().data.entryId as string;
    const classifiedResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/protagonist-state/${stateId}/classify`, payload: { category: '城池等级' }
    });
    expect(classifiedResponse.statusCode).toBe(200);
    expect(classifiedResponse.json().data).toMatchObject({ category: '城池等级', value: 3, revision: 2, previousEntryId: stateId });
    const formulaResponse = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/attribute-formulas`,
      payload: { formulaKey: '总兵力', label: '总兵力', expression: '步兵 + 弓兵', variables: [{ key: '步兵', label: '步兵' }, { key: '弓兵', label: '弓兵' }], unit: '人' }
    });
    const formulaId = formulaResponse.json().data.formulaId as string;
    const evaluated = await app.inject({
      method: 'POST', url: `/api/v1/books/${first.bookId}/attribute-formulas/${formulaId}/evaluate`, payload: { values: { 步兵: 120, 弓兵: 80 } }
    });
    expect(evaluated.json().data).toMatchObject({ result: 200, formula: { unit: '人' } });
    const library = await app.inject({ method: 'GET', url: `/api/v1/books/${first.bookId}/library` });
    expect(library.json().data).toMatchObject({
      protagonists: { profiles: [expect.objectContaining({ displayName: '林澈', current: [expect.objectContaining({ value: 3 })] })] },
      attributeFormulas: [expect.objectContaining({ formulaKey: '总兵力' })]
    });
    const crossBook = await app.inject({
      method: 'POST', url: `/api/v1/books/${second.bookId}/protagonists/${profileId}/state`,
      payload: { category: '资源', logicalKey: '金币', label: '金币', valueType: 'resource', value: 1 }
    });
    expect(crossBook.statusCode).toBeGreaterThanOrEqual(400);
    const crossBookClassification = await app.inject({
      method: 'POST', url: `/api/v1/books/${second.bookId}/protagonist-state/${stateId}/classify`, payload: { category: '越权分类' }
    });
    expect(crossBookClassification.statusCode).toBeGreaterThanOrEqual(400);
    expect((await app.inject({ method: 'GET', url: `/api/v1/books/${second.bookId}/protagonists` })).json().data.profiles).toEqual([]);
  });
});
