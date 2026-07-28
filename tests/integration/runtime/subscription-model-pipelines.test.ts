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
import { approvePendingManuscript, initializeDomainBook, prepareBookForWriting } from '../../helpers/domain-fixture.js';
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
    prepareBookForWriting(context, scope, ids, clock, 1);
    const runtime = loadModelRuntimeConfig({
      WENMI_MODEL_MODE: 'subscription-plan',
      WENMI_ARK_CODING_PLAN_API_KEY: 'coding-test-key',
      WENMI_ARK_AGENT_PLAN_API_KEY: 'agent-test-key'
    }, { codexWorkingDirectory: `${context.dataDir}/codex-test` });
    new ModelBindingService(context.database, ids, clock, runtime.roleProfiles).bindAllBooks();

    const codexPrompts: string[] = [];
    let malformedSynthesisSent = false;
    const codexRunner: CodexProcessRunner = {
      async run(input) {
        codexPrompts.push(input.prompt);
        const wrapped = parseObject(input.prompt.split('【本次任务输入】').at(-1)?.trim());
        const synthesisInput = parseObject(wrapped?.taskInput) ?? wrapped;
        if (synthesisInput?.operation === 'draft' || input.prompt.includes('"operation":"draft"')) {
          const output = buildValidNovel();
          // Codex还会计入岗位系统提示与订阅运行器包装开销；该值刻意超过
          // 24k上下文包+8k输出的旧冻结上限，验证预算预留不会误杀成功结果。
          return { output, inputTokens: 31_000, outputTokens: 1_600 };
        }
        if (synthesisInput?.operation === 'repair_editor_synthesis_json') {
          return {
            output: JSON.stringify({
              panelId: synthesisInput.panelId,
              manuscriptVersionId: synthesisInput.manuscriptVersionId,
              recommendedVerdict: 'pass',
              priorityIssueIndexes: Array.from({ length: Number(synthesisInput.issueCount ?? 0) }, (_, index) => index),
              preservedDisagreements: [],
              rationale: '按校验摘要修复结构，不改变三席风险等级。'
            }),
            inputTokens: 120,
            outputTokens: 50
          };
        }
        if (synthesisInput?.operation === 'review_synthesis') {
          if (!malformedSynthesisSent) {
            malformedSynthesisSent = true;
            return { output: '{"recommendedVerdict":"pass"', inputTokens: 300, outputTokens: 20 };
          }
          const reports = Array.isArray(synthesisInput?.reports) ? synthesisInput.reports.filter((report) => typeof report === 'object' && report !== null) as Array<Record<string, unknown>> : [];
          const issueCount = reports.reduce((count, report) => count + (Array.isArray(report.issues) ? report.issues.length : 0), 0);
          const verdicts = reports.map((report) => String(report.verdict));
          const panelId = synthesisInput?.panelId ?? input.prompt.match(/"panelId":"([^"]+)"/u)?.[1];
          const manuscriptVersionId = synthesisInput?.manuscriptVersionId ?? input.prompt.match(/"manuscriptVersionId":"([^"]+)"/u)?.[1];
          return {
            output: JSON.stringify({
              panelId,
              manuscriptVersionId,
              recommendedVerdict: verdicts.includes('blocked') ? 'blocked' : verdicts.includes('rewrite') ? 'rewrite' : 'pass',
              priorityIssueIndexes: Array.from({ length: issueCount }, (_, index) => index),
              preservedDisagreements: [],
              rationale: '按三席结构化报告综合，不进行第四次正文点评。'
            }),
            inputTokens: 300,
            outputTokens: 80
          };
        }
        if (input.prompt.includes('规划落库')) {
          return {
            output: [
              '建议把这一段设计成三章滚动窗口：先迫使主角选择，再让代价落地，最后用新的事实改变下一步判断。',
              `规划落库 ${JSON.stringify({
                arcTitle: '雾城选择弧',
                arcGoal: '让主角主动选择并承担代价',
                endingState: '主角获得新线索，同时失去一条安全退路',
                estimatedChapterRange: { minimum: 2, recommended: 3, maximum: 5 },
                chapters: [
                  { title: '雾中的选择', goal: '主角在两条风险路线中主动选择', beats: ['确认目标', '作出选择'], hook: '选择触发意外回信' },
                  { title: '代价落地', goal: '让上一章选择产生具体损失', beats: ['损失显现', '关系受压'], hook: '盟友隐瞒被揭开一角' },
                  { title: '钟楼新证', goal: '用新事实改变主角对敌友的判断', beats: ['验证线索', '调整行动'], hook: '钟楼出现失踪者信物' }
                ]
              })}`
            ].join('\n'),
            inputTokens: 400,
            outputTokens: 220
          };
        }
        return { output: '建议让章末钩子来自人物主动选择，并保留一项下一章可验证的疑问。', inputTokens: 40, outputTokens: 30 };
      }
    };
    const calls: Array<{ url: string; model: string; prompt: string; maxTokens: number }> = [];
    let malformedLiterarySent = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number; messages: Array<{ content: string }> };
      calls.push({ url: String(input), model: body.model, prompt: body.messages[0]?.content ?? '', maxTokens: body.max_tokens });
      const prompt = parseObject(body.messages[0]?.content);
      const taskInput = parseObject(prompt?.taskInput);
      const role = taskInput?.reviewerRole;
      const discussionPrompt = body.messages[0]?.content ?? '';
      const repairContract = parseObject(taskInput?.originalContract);
      const repairRole = repairContract?.reviewerRole;
      const text = taskInput?.operation === 'repair_review_json' && typeof repairRole === 'string'
        ? JSON.stringify(reviewResult(repairRole, repairContract?.manuscriptVersionId, repairContract?.modelSnapshotId))
        : role === 'literary' && !malformedLiterarySent
          ? (malformedLiterarySent = true, '{"verdict":"pass"')
          : typeof role === 'string'
        ? JSON.stringify(reviewResult(role, taskInput?.manuscriptVersionId, taskInput?.modelSnapshotId))
        : discussionPrompt.includes('章节跨度估算')
          ? '从当前岗位角度，读者需要在章末获得一个具体发现，同时留下可验证的新疑问。\n章节跨度估算 {"minimum":2,"recommended":3,"maximum":5,"units":[{"unit":"推进单元","suggestedChapters":3}],"assumptions":["基于当前简报"],"uncertainty":["后续信息可能改变跨度"]}'
          : '从当前岗位角度，读者需要在章末获得一个具体发现，同时留下可验证的新疑问。';
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
    const locked = conversations.sendBossMessage(scope, `确认方案 ${discussionResult.decisionId}`);
    expect(locked.action).toMatchObject({ kind: 'creative_direction_locked', roundKind: 'locked_planning' });
    const planningTaskId = String(locked.action.taskId);
    expect(tasks.claimNext('subscription-planning-worker')?.taskId).toBe(planningTaskId);
    const planningResult = await new DiscussionPipelineService(context.database, context.config.releaseId, ids, clock, adapters)
      .executeClaimed(scope, planningTaskId, 'subscription-planning-worker');
    expect(conversations.sendBossMessage(scope, `确认方案 ${planningResult.decisionId}`).action)
      .toMatchObject({ kind: 'discussion_confirmed', planningPrepared: true, chapterOutlineCount: 3 });

    const batchService = new ChapterBatchService(context.database, context.dataDir, context.config.releaseId, ids, clock, adapters);
    const batch = batchService.scheduleNewChapters(scope, 1, { firstChapterTitle: '雾中的选择' });
    const chapterResult = await batchService.run(scope, batch.batchId);
    expect(chapterResult.batch.status).toBe('paused');
    approvePendingManuscript(context, scope, ids, clock);
    expect((await batchService.run(scope, batch.batchId)).batch.status).toBe('completed');

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
    expect(calls.filter((call) => call.prompt.includes('最后必须另起一行输出：章节跨度估算'))
      .every((call) => call.maxTokens >= 3_000)).toBe(true);
    expect(calls.some((call) => call.prompt.includes('repair_review_json'))).toBe(true);
    expect(calls.filter((call) => call.prompt.includes('repair_review_json')).every((call) =>
      call.prompt.includes('location')
      && call.prompt.includes('issueType')
      && call.prompt.includes('requiredAction')
      && call.prompt.includes('pass|rewrite|blocked'))).toBe(true);
    expect(context.database.prepare(`SELECT mode FROM writer_selections WHERE owner_id = ? AND book_id = ? AND status = 'selected'`)
      .get(scope.ownerId, scope.bookId)).toEqual({ mode: 'owner_specified' });
    expect(codexPrompts.some((prompt) => prompt.includes('chapter_work_order'))).toBe(true);
    expect(codexPrompts.some((prompt) => prompt.includes('repair_editor_synthesis_json'))).toBe(true);
  });
});

function buildValidNovel(): string {
  const paragraphs: string[] = [];
  const sentence = '林澈沿着雾中的石阶前行，每一步都核对墙上的旧刻痕，他没有相信来历不明的指引，而是让同伴先确认退路与时间。';
  while (countNovelCharacters(paragraphs.join('\n\n')) < 2_700) paragraphs.push(sentence);
  paragraphs.push('钟楼的灯忽然亮起，林澈看见窗后的人举起了导师失踪前留下的那枚钥匙。');
  return paragraphs.join('\n\n');
}

function reviewResult(role: string, manuscriptVersionId: unknown, modelSnapshotId: unknown): Record<string, unknown> {
  const common = {
    reviewerRole: role,
    manuscriptVersionId,
    modelSnapshotId,
    verdict: 'pass',
    summary: '基于同一完整正文完成独立点评。',
    issues: [],
    scores: { continuity: 92, character: 91, pacing: 89, style: 90, hook: 93 }
  };
  if (role === 'literary') return { ...common, aiStyle: { riskScore: 5, flaggedParagraphCount: 0, totalParagraphCount: 20, flaggedParagraphRatio: 0, isAuthorshipProbability: false, evidence: [] } };
  if (role === 'experience') {
    const none = { level: 'none', locations: [], evidence: [], recommendedAction: '无需修改', policyVersion: 'test-policy-v1' };
    return { ...common, politicalRisk: none, sexualContentRisk: none };
  }
  return { ...common, factCandidates: [{
    subjectName: '林澈', entityType: 'character', relationKey: 'observed:item', value: '导师留下的钥匙',
    evidenceQuote: '钟楼的灯忽然亮起，林澈看见窗后的人举起了导师失踪前留下的那枚钥匙。',
    evidenceLocation: '章末', epistemicStatus: 'objective', negated: false,
    viewpointName: null, knowledgeSubjectName: null, knowledgeTimeStart: null, knowledgeTimeEnd: null,
    storyTimeStart: null, storyTimeEnd: null
  }] };
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
