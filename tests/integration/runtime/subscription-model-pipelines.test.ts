import { afterEach, describe, expect, it } from 'vitest';
import { ConversationService } from '../../../apps/api/src/application/chat/conversation-service.js';
import { ChapterBatchService } from '../../../apps/api/src/application/creation/chapter-batch-service.js';
import { DiscussionPipelineService } from '../../../apps/api/src/application/discussions/discussion-pipeline-service.js';
import { ModelBindingService } from '../../../apps/api/src/application/agents/model-binding-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { countNovelCharacters } from '../../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import { ModelAdapterFactory } from '../../../apps/api/src/infrastructure/models/model-adapter-factory.js';
import type { CodexProcessRunner } from '../../../apps/api/src/infrastructure/models/codex-subscription-model.js';
import { loadModelRuntimeConfig } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('订阅与套餐模型真实流水线接线', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('剧情讨论使用GPT主编与DeepSeek、GLM双编剧，章节使用GPT主笔和Kimi审校', async () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '订阅模型测试书', text: '雾城悬疑与读者钩子' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    }, { codexWorkingDirectory: `${context.dataDir}/codex-test` });
    new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks();

    const codexPrompts: string[] = [];
    const codexRunner: CodexProcessRunner = {
      async run(input) {
        codexPrompts.push(input.prompt);
        if (input.prompt.includes('"operation":"draft"')) {
          const output = buildValidNovel();
          return { output, inputTokens: 18_500, outputTokens: 1_600 };
        }
        return { output: '建议让章末钩子来自人物主动选择，并保留一项下一章可验证的疑问。', inputTokens: 40, outputTokens: 30 };
      }
    };
    const calls: Array<{ url: string; model: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      calls.push({ url: String(input), model: body.model });
      const text = body.model === 'kimi-k2-6-modelhub'
        ? JSON.stringify({
            verdict: 'pass',
            summary: '连续性、人物行动、节奏、文风和钩子均通过。',
            issues: [],
            scores: { continuity: 92, character: 91, pacing: 89, style: 90, hook: 93 }
          })
        : '从体验官角度，读者需要在章末获得一个具体发现，同时留下可验证的新疑问。';
      return new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 50, output_tokens: 35 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const adapters = new ModelAdapterFactory(runtime, fetchImpl, codexRunner);

    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock);
    const scheduled = conversations.sendBossMessage(scope, '我想讨论下一章的读者情绪和结尾钩子');
    const discussionTaskId = String(scheduled.action.taskId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    expect(tasks.claimNext('subscription-discussion-worker')?.taskId).toBe(discussionTaskId);
    const discussionResult = await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, adapters)
      .executeClaimed(scope, discussionTaskId, 'subscription-discussion-worker');
    expect(conversations.sendBossMessage(scope, `确认方案 ${discussionResult.decisionId}`).action)
      .toMatchObject({ kind: 'discussion_confirmed', planningPrepared: true, chapterOutlineCount: 1 });

    const batchService = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock, adapters);
    const batch = batchService.scheduleNewChapters(scope, 1, { firstChapterTitle: '雾中的选择' });
    const chapterResult = await batchService.run(scope, batch.batchId);
    expect(chapterResult.batch.status).toBe('completed');

    const modelCalls = context.database.prepare(`
      SELECT provider, model_id, cash_micros, state FROM model_calls
      WHERE owner_id = ? AND book_id = ? ORDER BY created_at, request_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ provider: string; model_id: string; cash_micros: number; state: string }>;
    expect(modelCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'openai-codex-subscription', model_id: 'gpt-5.6-sol', cash_micros: 0, state: 'succeeded' }),
      expect.objectContaining({ provider: 'volcengine-ark-coding-plan', model_id: 'deepseek-v4-pro', cash_micros: 0, state: 'succeeded' }),
      expect.objectContaining({ provider: 'volcengine-ark-agent-plan', model_id: 'glm-5-2-260617', cash_micros: 0, state: 'succeeded' }),
      expect.objectContaining({ provider: 'volcengine-ark-agent-plan', model_id: 'kimi-k2-6-modelhub', cash_micros: 0, state: 'succeeded' })
    ]));
    expect(calls.some((call) => call.url.startsWith('https://ark.cn-beijing.volces.com/api/coding/'))).toBe(true);
    expect(calls.some((call) => call.url.startsWith('https://ark.cn-beijing.volces.com/api/plan/'))).toBe(true);
    expect(context.database.prepare(`SELECT mode FROM writer_selections WHERE owner_id = ? AND book_id = ? AND status = 'selected'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ mode: 'owner_specified' });
    expect(codexPrompts.some((prompt) => prompt.includes('chapter_outline') && prompt.includes('writing_contract'))).toBe(true);
  });
});

function buildValidNovel(): string {
  const paragraphs: string[] = [];
  const sentence = '林澈沿着雾中的石阶前行，每一步都核对墙上的旧刻痕，他没有相信来历不明的指引，而是让同伴先确认退路与时间。';
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_700) paragraphs.push(sentence);
  paragraphs.push('钟楼的灯忽然亮起，林澈看见窗后的人举起了导师失踪前留下的那枚钥匙。');
  return paragraphs.join('\n\n');
}
