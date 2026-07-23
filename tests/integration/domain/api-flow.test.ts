import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { ConversationReplyPipelineService } from '../../../apps/api/src/application/chat/conversation-reply-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import type { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('建书REST流程', () => {
  it('公开版本化番茄式分类并接受完整开书资料', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const taxonomyResponse = await app.inject({ method: 'GET', url: '/api/v1/opening-taxonomy' });
      expect(taxonomyResponse.statusCode).toBe(200);
      const taxonomy = taxonomyResponse.json().data as {
        version: string; categories: Array<{ key: string; channel: string }>;
      };
      expect(taxonomy.categories).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'male-fantasy-brain', channel: 'male' }),
        expect.objectContaining({ key: 'female-modern-brain', channel: 'female' })
      ]));
      const openingBlueprint = {
        taxonomyVersion: taxonomy.version, channel: 'male', categoryKey: 'male-fantasy-brain',
        protagonists: [{ role: 'male_lead', name: '张三', age: '十八岁', background: '天安城边军斥候。', personalities: ['冷静'] }],
        worldBackground: '诸城邦以军功与盟约维持秩序。', openingBackground: '天安城拒绝缴纳边境军费。',
        stageOne: { start: '张三发现伪造军令。', development: '他阻止第一次宣战。', end: '他查出军令来自城内权臣。' },
        fullBookOutline: '张三调查城邦战争规则，最终重建联盟。', mainTags: ['玄幻', '谋略'], auxiliaryTags: [],
        storyTraits: ['群像'], customTags: ['城邦战争'], initialMap: '天安城北门与边军大营。', mustFollow: ['不写后宫']
      };
      const invalidResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '错误分类', text: '测试', openingBlueprint: { ...openingBlueprint, categoryKey: 'female-modern-brain' } }
      });
      expect(invalidResponse.statusCode).toBe(400);
      expect(invalidResponse.json().error.message).toContain('不属于当前频道');
      const missingTitleResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts', payload: { text: openingBlueprint.fullBookOutline, openingBlueprint }
      });
      expect(missingTitleResponse.statusCode).toBe(400);
      expect(missingTitleResponse.json().error.message).toContain('必须填写书名');
      const longTitleResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '书'.repeat(121), text: openingBlueprint.fullBookOutline, openingBlueprint }
      });
      expect(longTitleResponse.statusCode).toBe(400);
      expect(longTitleResponse.json().error.message).toContain('120');
      const draftResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '天安城军报', text: openingBlueprint.fullBookOutline, openingBlueprint }
      });
      expect(draftResponse.statusCode).toBe(200);
      const draft = draftResponse.json().data as { draftId: string; version: number };
      const confirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version }
      });
      expect(confirmResponse.statusCode).toBe(200);
      const created = confirmResponse.json().data as { bookId: string; kickoffTaskId: string };
      expect(created.kickoffTaskId).toBeTruthy();
      const messages = await app.inject({ method: 'GET', url: `/api/v1/books/${created.bookId}/messages` });
      expect(messages.json().data).toEqual([]);
      const workspace = await app.inject({ method: 'GET', url: `/api/v1/books/${created.bookId}/workspace` });
      expect(workspace.json().data.messageCount).toBe(0);
      const clock = new FixedClock();
      const claimed = new TaskService(context.database, context.config.releaseId, clock).claimNext('worker-onboarding');
      expect(claimed?.taskId).toBe(created.kickoffTaskId);
      let capturedPrompt = '';
      const modelFactory = { resolve: (provider: string, modelId: string) => ({
        provider, modelId,
        generate: async (request: { prompt: string }) => {
          capturedPrompt = request.prompt;
          return {
            provider, modelId,
            output: JSON.stringify({
              answer: '开书资料已经建立，第一阶段目标清楚。',
              keyPoints: ['已知：主角、开篇地点和阶段终点已明确', '待讨论：宣战规则的具体代价'],
              alternatives: [], risks: [], questions: ['张三最不能失去的东西是什么？'],
              nextStep: '先围绕这项代价讨论第一段剧情。', details: '不启动正文。'
            }), inputTokens: 120, outputTokens: 80, cashCostCny: 0, state: 'succeeded' as const
          };
        }
      }) } as unknown as ModelAdapterFactory;
      await new ConversationReplyPipelineService(
        context.database, context.config.releaseId, new SequenceIds(), clock, modelFactory
      ).executeClaimed({ ownerId: context.config.ownerId, bookId: created.bookId }, created.kickoffTaskId, 'worker-onboarding');
      expect(capturedPrompt).toContain('这是建书后的主动开场');
      expect(capturedPrompt).toContain('不得启动主笔或生成小说正文');
      expect(capturedPrompt).toContain('张三');
      expect(capturedPrompt).toContain('天安城');
      const sourceManifest = context.database.prepare(`SELECT source_manifest_json FROM context_packs WHERE task_id = ?`)
        .get(created.kickoffTaskId) as { source_manifest_json: string };
      expect(JSON.parse(sourceManifest.source_manifest_json)).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceType: 'opening_blueprint', hard: true })
      ]));
      const proactiveMessages = await app.inject({ method: 'GET', url: `/api/v1/books/${created.bookId}/messages` });
      expect(proactiveMessages.json().data).toEqual([
        expect.objectContaining({ sender_type: 'agent', role_key: 'chief_editor', message_type: 'conversation_reply' })
      ]);
    } finally {
      await app.close();
    }
  });

  it('从自然语言定位草稿到确认建书并查询9岗位', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const draftResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '北宋副本', text: '主角进入游戏副本，从朱仙镇开始', category: '历史', tags: ['成长'] }
      });
      expect(draftResponse.statusCode).toBe(200);
      const draft = draftResponse.json().data as { draftId: string; version: number };
      const confirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version }
      });
      expect(confirmResponse.statusCode).toBe(200);
      const book = confirmResponse.json().data as { bookId: string; kickoffTaskId: string };
      const agents = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/agents` });
      expect((agents.json().data as unknown[])).toHaveLength(11);
      const books = await app.inject({ method: 'GET', url: '/api/v1/books' });
      expect(books.json().data).toHaveLength(1);
      const clock = new FixedClock();
      expect(new TaskService(context.database, context.config.releaseId, clock).claimNext('worker-legacy-onboarding')?.taskId)
        .toBe(book.kickoffTaskId);
      const modelFactory = { resolve: (provider: string, modelId: string) => ({
        provider, modelId,
        generate: async () => ({
          provider, modelId,
          output: JSON.stringify({
            answer: '目前只有基础定位，我们先补齐第一阶段。', keyPoints: ['已知：历史游戏题材'], alternatives: [],
            risks: [], questions: ['主角进入副本时最先面对什么困境？'], nextStep: '先确认开篇困境。', details: ''
          }), inputTokens: 80, outputTokens: 40, cashCostCny: 0, state: 'succeeded' as const
        })
      }) } as unknown as ModelAdapterFactory;
      await new ConversationReplyPipelineService(
        context.database, context.config.releaseId, new SequenceIds(), clock, modelFactory
      ).executeClaimed({ ownerId: context.config.ownerId, bookId: book.bookId }, book.kickoffTaskId, 'worker-legacy-onboarding');
      const messages = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/messages` });
      expect(messages.json().data).toEqual([
        expect.objectContaining({ sender_type: 'agent', role_key: 'chief_editor', message_type: 'conversation_reply' })
      ]);
    } finally {
      await app.close();
    }
  });
});
