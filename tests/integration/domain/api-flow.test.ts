import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../apps/api/src/http/server.js';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import type { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';
import { OPENING_TAXONOMY } from '../../../apps/api/src/contracts/opening-blueprint.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('建书REST流程', () => {
  it('无状态识别5000字内剧情梗概，不创建草稿、模型调用或正史记录', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const synopsis = [
        '书名：北境军报',
        '频道：男频',
        '分类：历史脑洞',
        '男主：陆沉，十八岁，边城驿卒之子。',
        '全书简介：陆沉利用未来军报阻止王朝覆灭。',
        '主要标签：历史、穿越、权谋'
      ].join('\n');
      const response = await app.inject({
        method: 'POST', url: '/api/v1/opening-synopsis/analyze', payload: { synopsis }
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        schemaVersion: 'opening-synopsis-suggestions-v1',
        analysisMode: 'local-deterministic',
        suggestions: {
          title: '北境军报',
          channel: 'male',
          categoryKey: 'male-history-brain',
          mainTags: ['历史', '权谋']
        }
      });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM positioning_drafts').get()).toMatchObject({ count: 0 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM books').get()).toMatchObject({ count: 0 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM model_calls').get()).toMatchObject({ count: 0 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM canon_revisions').get()).toMatchObject({ count: 0 });

      const empty = await app.inject({
        method: 'POST', url: '/api/v1/opening-synopsis/analyze', payload: { synopsis: ' ' }
      });
      expect(empty.statusCode).toBe(400);
      expect(empty.json().error.message).toContain('不能为空');

      const tooLong = await app.inject({
        method: 'POST', url: '/api/v1/opening-synopsis/analyze', payload: { synopsis: '长'.repeat(5_001) }
      });
      expect(tooLong.statusCode).toBe(400);
      expect(tooLong.json().error.message).toContain('不能超过5000');
    } finally {
      await app.close();
    }
  });

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
        styleIntent: {
          languageTones: ['幽默'], emotionalTones: ['热血'],
          pacingAndPayoff: ['爽点密集'], atmospheres: ['沉浸'], custom: []
        },
        taxonomyVersion: taxonomy.version, channel: 'male', categoryKey: 'male-fantasy-brain',
        targetAudience: '喜欢玄幻成长与谋略冲突的男频读者',
        protagonists: [{ role: 'male_lead', name: '张三', age: '十八岁', background: '天安城边军斥候。', personalities: ['冷静'] }],
        storyDirection: '张三从一封伪造军令入手，阻止天安城被卷入战争，并追查幕后操控城邦秩序的权臣。',
        worldBackground: '诸城邦以军功与盟约维持秩序。', openingBackground: '天安城拒绝缴纳边境军费。',
        stageOne: { start: '张三发现伪造军令。', development: '他阻止第一次宣战。', end: '他查出军令来自城内权臣。' },
        fullBookOutline: '张三调查城邦战争规则，最终重建联盟。', mainTags: ['玄幻', '权谋'], auxiliaryTags: [],
        storyTraits: ['智斗'], customTags: ['城邦战争'], initialMap: '天安城北门与边军大营。', mustFollow: ['不写后宫']
      };
      const invalidResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '错误分类', text: '测试', openingBlueprint: { ...openingBlueprint, categoryKey: 'female-modern-brain' } }
      });
      expect(invalidResponse.statusCode).toBe(400);
      const missingDirectionResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '缺少故事方向', text: '', openingBlueprint: { ...openingBlueprint, storyDirection: '' } }
      });
      expect(missingDirectionResponse.statusCode).toBe(200);
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
      expect(longTitleResponse.json().error.message).toContain('15');
      const draftResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '天安城军报', text: '这个旧定位文本不应覆盖故事方向', openingBlueprint }
      });
      expect(draftResponse.statusCode).toBe(200);
      const draft = draftResponse.json().data as {
        draftId: string;
        version: number;
        fields: Array<{ key: string; value: string | null }>;
      };
      expect(draft.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'premise', value: openingBlueprint.storyDirection })
      ]));
      const staleConfirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version + 1 }
      });
      expect(staleConfirmResponse.statusCode).toBe(409);
      expect(staleConfirmResponse.json().error).toMatchObject({
        code: 'BOOK_VERSION_CONFLICT',
        message: expect.stringContaining('版本已经变化'),
        retryable: true
      });
      const booksAfterStaleConfirm = await app.inject({ method: 'GET', url: '/api/v1/books' });
      expect(booksAfterStaleConfirm.json().data).toEqual([]);
      const confirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version }
      });
      expect(confirmResponse.statusCode).toBe(200);
      const created = confirmResponse.json().data as { bookId: string; kickoffTaskId: string | null };
      // DEC-CURRENT-062：建书不再自动召集，作者点“团队设计”才建首个提案任务
      expect(created.kickoffTaskId).toBeNull();
      const sameTitleDraftResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: ' 天安城军报 ', text: openingBlueprint.storyDirection, openingBlueprint }
      });
      expect(sameTitleDraftResponse.statusCode).toBe(200);
      const sameTitleDraft = sameTitleDraftResponse.json().data as { draftId: string; version: number; proposedBookId: string };
      const sameTitleConfirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${sameTitleDraft.draftId}/confirm`,
        payload: { expectedVersion: sameTitleDraft.version }
      });
      expect(sameTitleConfirmResponse.statusCode).toBe(409);
      expect(sameTitleConfirmResponse.json().error).toMatchObject({
        code: 'BOOK_TITLE_CONFLICT',
        message: expect.stringContaining('同名书籍'),
        retryable: false
      });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM books WHERE owner_id = ?')
        .get(context.config.ownerId)).toEqual({ count: 1 });
      expect(context.database.prepare('SELECT status FROM positioning_drafts WHERE draft_id = ?')
        .get(sameTitleDraft.draftId)).toEqual({ status: 'editing' });
      context.database.prepare(`UPDATE model_config_snapshots SET provider='volcengine-ark-agent-plan', model_id='kimi-k3', parameters_json='{"plan":"agent"}'
        WHERE model_snapshot_id=(SELECT a.model_snapshot_id FROM agent_instances a JOIN role_templates r
          ON r.role_template_id=a.role_template_id AND r.version=a.role_template_version
          WHERE a.owner_id=? AND a.book_id=? AND r.role_key='senior_screenwriter' LIMIT 1)`).run(context.config.ownerId, created.bookId);
      const memberAvailability = await app.inject({
        method: 'GET', url: `/api/v1/books/${created.bookId}/setting-outline-workspace/world-stage/collaboration`
      });
      expect(memberAvailability.statusCode).toBe(200);
      expect(memberAvailability.json().data.screenwriters).toEqual(expect.arrayContaining([
        expect.objectContaining({ roleKey: 'senior_screenwriter', availability: 'unavailable', availabilityReason: '模型路线缺少可用凭证' })
      ]));
      const bypassUnavailable = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${created.bookId}/setting-outline-workspace/world-stage/collaboration/start`,
        payload: { screenwriterRoleKeys: ['senior_screenwriter'], idempotencyKey: 'api-flow-unavailable-senior' }
      });
      expect(bypassUnavailable.statusCode).toBe(409);
      expect(bypassUnavailable.json().error.message).toContain('不可用');
      const startPanel = await app.inject({
        method: 'POST',
        url: `/api/v1/books/${created.bookId}/setting-outline-workspace/world-stage/collaboration/start`,
        payload: { screenwriterRoleKeys: ['lead_screenwriter'], idempotencyKey: 'api-flow-first-panel' }
      });
      expect(startPanel.statusCode).toBe(200);
      const panelTaskId = (startPanel.json().data as { taskId: string }).taskId;
      const duplicateConfirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version }
      });
      expect(duplicateConfirmResponse.statusCode).toBe(409);
      expect(duplicateConfirmResponse.json().error).toMatchObject({
        code: 'BOOK_STATUS_CONFLICT',
        message: expect.stringContaining('已经确认或结束'),
        retryable: false
      });
      const profileBefore = await app.inject({ method: 'GET', url: `/api/v1/books/${created.bookId}/book-profile` });
      expect(profileBefore.statusCode).toBe(200);
      expect(profileBefore.json().data).toMatchObject({ version: 1, title: '天安城军报', openingBlueprint: { initialMap: openingBlueprint.initialMap } });
      const revisedDirection = '张三利用伪造军令中的时间差反向布局，既要阻止城邦开战，也要找出权臣控制盟约的真实目的。';
      const revisedProfile = await app.inject({
        method: 'PUT', url: `/api/v1/books/${created.bookId}/book-profile`,
        payload: { expectedVersion: 1, title: '天安城盟约', openingBlueprint: { ...openingBlueprint, storyDirection: revisedDirection } }
      });
      expect(revisedProfile.statusCode).toBe(200);
      expect(revisedProfile.json().data).toMatchObject({ version: 2, title: '天安城盟约', storyDirection: revisedDirection });
      const staleProfile = await app.inject({
        method: 'PUT', url: `/api/v1/books/${created.bookId}/book-profile`,
        payload: { expectedVersion: 1, title: '过期标题', openingBlueprint }
      });
      expect(staleProfile.statusCode).toBe(409);
      expect(staleProfile.json().error).toMatchObject({ code: 'BOOK_VERSION_CONFLICT' });
      const settingCollaboration = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${created.bookId}/setting-outline-workspace/world-stage/collaboration`
      });
      expect(settingCollaboration.statusCode).toBe(200);
      expect(settingCollaboration.json().data).toMatchObject({
        item: { itemKey: 'world-stage' },
        panel: { recoveryKey: panelTaskId },
        impact: { changesCanon: false, changesManuscript: false }
      });
      const unknownSettingCollaboration = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${created.bookId}/setting-outline-workspace/not-a-real-item/collaboration`
      });
      expect(unknownSettingCollaboration.statusCode).toBe(404);
      expect((context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
        WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
          AND json_extract(task_brief_json, '$.purpose') = 'setting_proposal_panel'`)
        .get(context.config.ownerId, created.bookId) as { count: number }).count).toBe(1);
      const clock = new FixedClock();
      const claimed = new TaskService(context.database, context.config.releaseId, clock).claimNext('worker-onboarding');
      expect(claimed?.taskId).toBe(panelTaskId);
      let capturedPrompt = '';
      const modelFactory = { resolve: (provider: string, modelId: string) => ({
        provider, modelId,
        generate: async (request: { prompt: string }) => {
          capturedPrompt = request.prompt;
          return {
            provider, modelId,
            output: JSON.stringify({
              answer: '推荐把这本书写成：张三在城邦冲突中用有代价的选择守住人的尊严与共同体。',
              keyPoints: ['重点是选择与代价，不是宣战流程本身。'],
              alternatives: [], risks: [], questions: ['是否按这个确定？'],
              nextStep: '回复“确认”，或直接说要修改哪一点。', details: null,
              workflowArtifact: {
                type: 'setting_outline',
                payload: { items: [{
                  itemKey: 'world-stage',
                  content: '通过张三在城邦冲突中的有代价选择，探讨个人尊严与共同体责任，让读者获得热血推进中的道德张力。'
                }] }
              }
            }), inputTokens: 120, outputTokens: 80, cashCostCny: 0, state: 'succeeded' as const
          };
        }
      }) } as unknown as ModelAdapterFactory;
      await new DiscussionPipelineService(
        context.database, context.config.releaseId, new SequenceIds(), clock, modelFactory
      ).executeClaimed({ ownerId: context.config.ownerId, bookId: created.bookId }, panelTaskId, 'worker-onboarding');
      expect(capturedPrompt).toContain('世界舞台');
      expect(capturedPrompt).not.toContain('王怡心里恨夏炎');
      expect(capturedPrompt).toContain('你看不到其他成员的答案');
      expect(capturedPrompt).toContain('只提交一个你自己真正推荐、可供作者选择的完整方案');
      expect(capturedPrompt).toContain('不依赖具体人物和剧情也成立');
      expect(capturedPrompt).not.toContain('张三');
      expect(capturedPrompt).toContain(openingBlueprint.worldBackground);
      expect(capturedPrompt).toContain(openingBlueprint.initialMap);
      expect(capturedPrompt).not.toContain(openingBlueprint.storyDirection);
      expect(capturedPrompt.split(openingBlueprint.storyDirection).length - 1).toBe(0);
      const sourceManifest = context.database.prepare(`SELECT source_manifest_json FROM context_packs WHERE task_id = ?`)
        .get(panelTaskId) as { source_manifest_json: string };
      expect(JSON.parse(sourceManifest.source_manifest_json)).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceType: 'boss_discussion_scope', hard: true })
      ]));
      const proactiveCollaboration = await app.inject({
        method: 'GET',
        url: `/api/v1/books/${created.bookId}/setting-outline-workspace/world-stage/collaboration`
      });
      expect(proactiveCollaboration.statusCode).toBe(200);
      expect(proactiveCollaboration.json().data.panel).toMatchObject({
        recoveryKey: panelTaskId,
        taskStatus: 'succeeded',
        proposals: [expect.objectContaining({ roleKey: 'lead_screenwriter' })]
      });
      expect(context.database.prepare(`SELECT item_status, content_text FROM setting_outline_workspace
        WHERE owner_id = ? AND book_id = ? AND item_key = 'world-stage'`)
        .get(context.config.ownerId, created.bookId)).toMatchObject({
        item_status: '讨论中',
        content_text: null
      });
      expect(proactiveCollaboration.json().data.item).toMatchObject({
        itemKey: 'world-stage', status: '讨论中'
      });
      expect((context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
        WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
          AND json_extract(task_brief_json, '$.purpose') = 'setting_proposal_panel'`)
        .get(context.config.ownerId, created.bookId) as { count: number }).count).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('从自然语言定位草稿到确认建书并查询25人团队', async () => {
    context = createTestContext();
    const app = await createServer(context.config, context.database, { trustedTest: true });
    try {
      const draftResponse = await app.inject({
        method: 'POST', url: '/api/v1/books/drafts',
        payload: { title: '北宋副本', text: '主角进入游戏副本，从朱仙镇开始', category: '历史', tags: ['成长'],
          openingBlueprint: {
            styleIntent: { languageTones: ['自然'], emotionalTones: ['热血'], pacingAndPayoff: ['紧凑'], atmospheres: ['历史'], custom: [] },
            taxonomyVersion: OPENING_TAXONOMY.version, channel: 'male', categoryKey: 'male-history-brain',
            targetAudience: '历史题材读者',
            protagonists: [{ role: 'male_lead', name: '赵四', age: '二十岁', background: '朱仙镇屯兵之子。', personalities: ['果断'] }],
            storyDirection: '赵四进入南宋副本，从朱仙镇开始改写岳家军的命运。',
            worldBackground: '', openingBackground: '', stageOne: { start: '', development: '', end: '' },
            fullBookOutline: '赵四在一个个历史副本里积攒人心与力量。', mainTags: ['历史', '副本'], auxiliaryTags: [],
            storyTraits: [], customTags: ['成长'], initialMap: '', mustFollow: ['不偏离历史主线']
          } }
      });
      if (draftResponse.statusCode !== 200) console.log('DRAFT ERROR:', JSON.stringify(draftResponse.json()));
      expect(draftResponse.statusCode).toBe(200);
      const draft = draftResponse.json().data as { draftId: string; version: number };
      const confirmResponse = await app.inject({
        method: 'POST', url: `/api/v1/book-drafts/${draft.draftId}/confirm`, payload: { expectedVersion: draft.version }
      });
      expect(confirmResponse.statusCode).toBe(200);
      const book = confirmResponse.json().data as { bookId: string; kickoffTaskId: string | null };
      expect(book.kickoffTaskId).toBeNull();
      const startPanel = await app.inject({
        method: 'POST',
        url: '/api/v1/books/' + book.bookId + '/setting-outline-workspace/world-stage/collaboration/start',
        payload: { screenwriterRoleKeys: ['lead_screenwriter'], idempotencyKey: 'api-flow-legacy-first-panel' }
      });
      expect(startPanel.statusCode).toBe(200);
      const panelTaskId = (startPanel.json().data as { taskId: string }).taskId;
      const agents = await app.inject({ method: 'GET', url: `/api/v1/books/${book.bookId}/agents` });
      expect((agents.json().data as unknown[])).toHaveLength(25);
      const books = await app.inject({ method: 'GET', url: '/api/v1/books' });
      expect(books.json().data).toHaveLength(1);
      const clock = new FixedClock();
      expect(new TaskService(context.database, context.config.releaseId, clock).claimNext('worker-legacy-onboarding')?.taskId)
        .toBe(panelTaskId);
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
      await new DiscussionPipelineService(
        context.database, context.config.releaseId, new SequenceIds(), clock, modelFactory
      ).executeClaimed({ ownerId: context.config.ownerId, bookId: book.bookId }, panelTaskId, 'worker-legacy-onboarding');
      const kickoffBrief = JSON.parse((context.database.prepare('SELECT task_brief_json FROM tasks WHERE task_id = ?')
        .get(panelTaskId) as { task_brief_json: string }).task_brief_json) as { discussionId: string };
      const proposals = context.database.prepare(`SELECT r.role_key AS roleKey
        FROM discussion_opinions o
        JOIN agent_instances a ON a.owner_id = o.owner_id AND a.book_id = o.book_id AND a.agent_id = o.agent_id
        JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
        WHERE o.owner_id = ? AND o.book_id = ? AND o.discussion_id = ? AND o.phase = 'independent'`)
        .all(context.config.ownerId, book.bookId, kickoffBrief.discussionId);
      expect(proposals).toEqual([{ roleKey: 'lead_screenwriter' }]);
    } finally {
      await app.close();
    }
  });
});
