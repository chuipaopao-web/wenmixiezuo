import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREATIVE_WORK_TYPE_WORD_LIMITS, OPENING_EVALUATION_REPORT } from '@wenmi/agent-catalog';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { parseOpeningPackage } from '../../../rebuild/packages/backend/src/legacy-opening/opening-agent/opening-output-validation.js';
import {
  V7_OPENING_TAXONOMY_REFERENCE,
  toV7OpeningBlueprint,
  validateV7OpeningConfirmationPackage,
  validateV7ManualOpeningPackage,
  validateV7OpeningPackage,
  validateV7OpeningRevisionDraft
} from '../../../apps/api/src/application/books/v7-opening-package-contract.js';
import { BookProfileViewService } from '../../../apps/api/src/application/books/book-profile-view-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { TimeMachineDesignService } from '../../../apps/api/src/application/books/time-machine-design-service.js';
import { V7SettingEditorialService } from '../../../apps/api/src/application/books/v7-setting-editorial-service.js';
import { SystemClock, UuidGenerator } from '../../../apps/api/src/domain/ids.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { TimeMachineModelGateway } from '../../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { createTestContext as createBaseContext, type TestContext } from '../../helpers/test-context.js';
import {
  MEMOIR_PACKAGE,
  NOVEL_PACKAGE,
  SCRIPT_PACKAGE,
  SHORT_PACKAGE,
  bookCount,
  makeManualPackage,
  openingTaskCount,
  positioningDraftCount,
  seedBookWithWorkType,
  timeMachineRunCount
} from '../../helpers/opening-work-type-fixtures.js';

// OPENING-UI-02返修（R1+R2）正式回归 + OPENING-NOVEL-CLOSE-01 开放边界，自包含、不依赖任何证据目录：
// R1（底层兼容能力保留）：篇幅/结果合同按作品类型穿透 生成解析→候选编辑→修订/审查→确认入架→书籍资料编辑/回读；
//     1万字短篇不再被强制10万字下限，范围校验保留，长篇旧合同不放宽，类型只信冻结任务/所属书籍。
// 开放边界（OPENING-NOVEL-CLOSE-01）：新请求只放行长篇小说——短篇/自传/剧本的新建任务、手动/AI确认、
//     会新增模型工作的修订与恢复入口一律409且零新增任务/书籍/模型调用；历史读取与已完成确认幂等保留。
// R2：非长篇（含短篇）在写任务/排队/占预算之前被可信服务端入口拒绝；长篇与无快照旧书不误拦；
//     历史任务只读保留。全部模型调用脚本化合成，不调用真实模型。
const originalEvaluationRows = OPENING_EVALUATION_REPORT.rows;
beforeEach(() => Object.defineProperty(OPENING_EVALUATION_REPORT, 'rows', { value: [
  ['deepseek-v4-pro', 'design', 1], ['kimi-k2.7-code', 'design', 2], ['doubao-seed-2.1-turbo', 'design', 3],
  ['kimi-k3', 'review', 1], ['deepseek-v4-pro', 'review', 2]
].map(([profileKey, node, milliseconds]) => ({
  profileKey, node, milliseconds, structurePassed: true, quality: 'passed' as const, assessment: 'scripted fixture', outputTokens: 100
})) }));
afterEach(() => Object.defineProperty(OPENING_EVALUATION_REPORT, 'rows', { value: originalEvaluationRows }));

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

function createTestContext(prefix: string) {
  const created = createBaseContext(prefix);
  created.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-key';
  created.config.modelRuntime.endpoints.agent.apiKey = 'test-agent-key';
  return created;
}

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
};

describe('R1 类型篇幅合同（底层兼容能力）：四类夹具逐层通过，范围校验保留', () => {
  const cases = [
    { workType: 'short_story', fixture: SHORT_PACKAGE, label: '短篇小说1万字集中故事' },
    { workType: 'memoir', fixture: MEMOIR_PACKAGE, label: '个人自传8万字已知经历+待补充' },
    { workType: 'script', fixture: SCRIPT_PACKAGE, label: '影视剧本6万字人物与场景' },
    { workType: 'novel', fixture: NOVEL_PACKAGE, label: '长篇小说300万字旧兼容' }
  ] as const;

  it.each(cases)('$label：解析/完整校验/确认校验/修订草稿全链通过', ({ workType, fixture }) => {
    const serialized = JSON.stringify(fixture);
    // 生产Worker引擎解析（rebuild legacy-opening）；长篇额外走缺省参数证明旧兼容。
    const parsed = workType === 'novel'
      ? parseOpeningPackage(serialized, V7_OPENING_TAXONOMY_REFERENCE)
      : parseOpeningPackage(serialized, V7_OPENING_TAXONOMY_REFERENCE, undefined, workType);
    expect(parsed.positioning.expectedTotalWords).toBe(fixture.positioning.expectedTotalWords);
    // 生产API合同层：完整校验、确认入架校验、修订草稿校验同一类型合同。
    // 修订草稿提交的是作者编辑后的完整资料包（含开局等全部段落），这里用解析后的完整包作提交值。
    if (workType === 'novel') {
      expect(validateV7OpeningPackage(fixture).positioning.expectedTotalWords).toBe(fixture.positioning.expectedTotalWords);
      expect(validateV7OpeningConfirmationPackage(fixture).openingPackage.positioning.expectedTotalWords).toBe(fixture.positioning.expectedTotalWords);
      expect(validateV7OpeningRevisionDraft(parsed, parsed, [], []).positioning.expectedTotalWords).toBe(fixture.positioning.expectedTotalWords);
    } else {
      expect(validateV7OpeningPackage(fixture, workType).positioning.expectedTotalWords).toBe(fixture.positioning.expectedTotalWords);
      expect(validateV7OpeningConfirmationPackage(fixture, workType).openingPackage.positioning.expectedTotalWords).toBe(fixture.positioning.expectedTotalWords);
      expect(validateV7OpeningRevisionDraft(parsed, parsed, [], [], workType).positioning.expectedTotalWords).toBe(fixture.positioning.expectedTotalWords);
    }
  });

  it('四类型边界：范围内接受、范围外拒绝；长篇旧合同不放宽', () => {
    for (const [workType, limits] of Object.entries(CREATIVE_WORK_TYPE_WORD_LIMITS) as Array<['novel' | 'short_story' | 'memoir' | 'script', { min: number; max: number }]>) {
      const atMin = structuredClone(NOVEL_PACKAGE);
      atMin.positioning.expectedTotalWords = limits.min;
      const belowMin = structuredClone(NOVEL_PACKAGE);
      belowMin.positioning.expectedTotalWords = limits.min - 1;
      const atMax = structuredClone(NOVEL_PACKAGE);
      atMax.positioning.expectedTotalWords = limits.max;
      const aboveMax = structuredClone(NOVEL_PACKAGE);
      aboveMax.positioning.expectedTotalWords = limits.max + 1;
      const typed = workType === 'novel' ? undefined : workType;
      expect(() => parseOpeningPackage(JSON.stringify(atMin), V7_OPENING_TAXONOMY_REFERENCE, undefined, typed)).not.toThrow();
      expect(() => parseOpeningPackage(JSON.stringify(atMax), V7_OPENING_TAXONOMY_REFERENCE, undefined, typed)).not.toThrow();
      expect(() => parseOpeningPackage(JSON.stringify(belowMin), V7_OPENING_TAXONOMY_REFERENCE, undefined, typed)).toThrow(/预计总字数必须是/);
      expect(() => parseOpeningPackage(JSON.stringify(aboveMax), V7_OPENING_TAXONOMY_REFERENCE, undefined, typed)).toThrow(/预计总字数必须是/);
    }
    // 长篇旧合同不放宽：99999字仍被拒（缺省类型=长篇）。
    const legacyBelow = structuredClone(NOVEL_PACKAGE);
    legacyBelow.positioning.expectedTotalWords = 99_999;
    expect(() => parseOpeningPackage(JSON.stringify(legacyBelow), V7_OPENING_TAXONOMY_REFERENCE)).toThrow(/预计总字数必须是100000至10000000/);
  });

  it('自己设计（手动开书）与修订保持类型：短篇1万字通过、20万字被拒', () => {
    expect(validateV7ManualOpeningPackage(makeManualPackage(10_000), 'short_story').positioning.expectedTotalWords).toBe(10_000);
    expect(() => validateV7ManualOpeningPackage(makeManualPackage(200_000), 'short_story')).toThrow(/预计总字数必须是1000至100000/);
    expect(validateV7ManualOpeningPackage(makeManualPackage(80_000), 'memoir').positioning.expectedTotalWords).toBe(80_000);
    expect(() => validateV7ManualOpeningPackage(makeManualPackage(9_999), 'memoir')).toThrow(/预计总字数必须是10000至2000000/);
    expect(validateV7ManualOpeningPackage(makeManualPackage(60_000), 'script').positioning.expectedTotalWords).toBe(60_000);
    expect(() => validateV7ManualOpeningPackage(makeManualPackage(4_999), 'script')).toThrow(/预计总字数必须是5000至2000000/);
    // 缺省长篇兼容：旧调用不传类型，300万字通过、10万字下限不变。
    expect(validateV7ManualOpeningPackage(makeManualPackage(3_000_000)).positioning.expectedTotalWords).toBe(3_000_000);
    expect(() => validateV7ManualOpeningPackage(makeManualPackage(10_000))).toThrow(/预计总字数必须是100000至10000000/);
  });
});

interface CapturedCall {
  provider: string;
  modelId: string;
  prompt: Record<string, any>;
}

class TypeAwareResolver implements V7OpeningModelAdapterResolver {
  public readonly calls: CapturedCall[] = [];

  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return {
      provider,
      modelId,
      generate: async (request: ModelRequest): Promise<ModelResult> => {
        const compiled = JSON.parse(request.prompt) as {
          contextPack?: { content?: { stageTaskPayload?: unknown } };
        } & Record<string, unknown>;
        const stageTaskPayload = compiled.contextPack?.content?.stageTaskPayload;
        const prompt = (typeof stageTaskPayload === 'string'
          ? JSON.parse(stageTaskPayload)
          : (stageTaskPayload ?? compiled)) as Record<string, any>;
        this.calls.push({ provider, modelId, prompt });
        if (prompt.operation === 'v7_opening_package_review_v1') {
          return { provider, modelId, output: JSON.stringify({ verdict: 'pass', summary: '资料包保留作者核心想法，字段一致。', issues: [], requiredChanges: [], authorDecisions: [] }), inputTokens: 120, outputTokens: 240, cashCostCny: 0, state: 'succeeded' };
        }
        const workType = String(prompt.creativeDirection?.workType ?? 'novel');
        const fixture = { novel: NOVEL_PACKAGE, short_story: SHORT_PACKAGE, memoir: MEMOIR_PACKAGE, script: SCRIPT_PACKAGE }[workType] ?? NOVEL_PACKAGE;
        const suffix = createHash('sha256').update(String(prompt.authorSource?.originalIdea ?? '')).digest('hex').slice(0, 4);
        return { provider, modelId, output: JSON.stringify({ ...fixture, title: `${fixture.title}${suffix}` }), inputTokens: 120, outputTokens: 240, cashCostCny: 0, state: 'succeeded' };
      }
    };
  }

  public designCalls(): CapturedCall[] {
    return this.calls.filter((call) => call.prompt.operation !== 'v7_opening_package_review_v1');
  }

  public reviewCalls(): CapturedCall[] {
    return this.calls.filter((call) => call.prompt.operation === 'v7_opening_package_review_v1');
  }
}

async function register(
  app: Awaited<ReturnType<typeof createAppServer>>,
  email: string,
  displayName: string
): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/register', headers: BROWSER_HEADERS,
    payload: { email, password: 'strong-pass-771', displayName }
  });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie'];
  return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

async function poll(
  app: Awaited<ReturnType<typeof createAppServer>>,
  cookie: string,
  taskId: string,
  terminal: string[]
): Promise<any> {
  let view: any = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({
      method: 'GET', url: `/api/v1/v7/opening-agent/tasks/${taskId}`,
      headers: { host: BROWSER_HEADERS.host, cookie }
    });
    expect(response.statusCode).toBe(200);
    view = response.json().data;
    if (terminal.includes(view.status)) return view;
    if (view.status === 'failed') throw new Error(`任务失败：${view.errorMessage ?? JSON.stringify(view)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`V7开书任务未在预期时间进入：${terminal.join(', ')}；最后状态：${JSON.stringify(view)}`);
}

function latestCandidate(view: any, kind: string): any {
  return view.candidates.filter((item: { kind: string }) => item.kind === kind).at(-1);
}

describe('长篇开书闭环HTTP（OPENING-NOVEL-CLOSE-01）：创建→候选编辑→修订→确认入架→资料编辑回读', () => {
  it('长篇小说3,000,000字从生成到入架到编辑全链通过；缺workType旧客户端按长篇兼容', async () => {
    context = createTestContext('wenmi-opening-type-contract-http-');
    const resolver = new TypeAwareResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'r1-chain@example.com', '链作者');
      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '张三穿越到三国乱世，从流民开始求生，并想办法保护同行百姓。',
          idempotencyKey: 'r1-chain-start-0001',
          creativeProfile: { scale: 3, styles: [], workType: 'novel' }
        }
      });
      expect(started.statusCode).toBe(200);
      const taskId = started.json().data.taskId as string;
      const view = await poll(app, cookie, taskId, ['awaiting_author_confirmation']);
      expect(view.creativeProfile.workType).toBe('novel');

      // 设计与审查提示都拿到长篇旧合同：schema模板与最终指令保持100000至10000000，不因本轮边界变化。
      const design = resolver.designCalls()[0]!.prompt;
      expect(design.creativeDirection.workType).toBe('novel');
      expect(JSON.stringify(design.outputTemplate)).toContain('整数 100000至10000000');
      const instructions = (design.finalInstructions as string[]).join('\n');
      expect(instructions).toContain('字数建议只写100000至10000000之间整数');
      expect(resolver.reviewCalls()[0]!.prompt.creativeDirection.workType).toBe('novel');

      const activePackage = latestCandidate(view, 'opening_package');
      expect(activePackage.content.positioning.expectedTotalWords).toBe(3_000_000);

      // 候选编辑（修订）保持类型：把总字数改成99,999必须被长篇旧合同拒绝，任务保持可继续。
      const illegalEdit = structuredClone(activePackage.content);
      illegalEdit.positioning.expectedTotalWords = 99_999;
      const rejected = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/revisions`,
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          baseCandidateId: activePackage.candidateId,
          openingPackage: illegalEdit,
          adjustmentNote: '',
          idempotencyKey: 'r1-chain-revise-bad-0001'
        }
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error.message).toContain('预计总字数必须是100000至10000000');

      // 正常候选编辑：只改核心卖点，走模型修订+复审（脚本化），回到待确认。
      const legalEdit = structuredClone(activePackage.content);
      legalEdit.positioning.coreAppeal = '现代普通人从乱世底层起步，靠判断、协作和承担责任建立能保护同伴的秩序。';
      const revised = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/revisions`,
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          baseCandidateId: activePackage.candidateId,
          openingPackage: legalEdit,
          adjustmentNote: '',
          idempotencyKey: 'r1-chain-revise-ok-0001'
        }
      });
      expect(revised.statusCode).toBe(200);
      const revisedView = await poll(app, cookie, taskId, ['awaiting_author_confirmation', 'awaiting_author_decision']);
      const revisedPackage = latestCandidate(revisedView, 'opening_package');

      // 确认入架：类型与字数合同穿透到正式书。
      const confirmed = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          taskId,
          candidateId: revisedPackage.candidateId,
          openingPackage: revisedPackage.content,
          idempotencyKey: 'r1-chain-confirm-0001'
        }
      });
      expect(confirmed.statusCode).toBe(200);
      const bookId = confirmed.json().data.bookId as string;
      const stored = context.database.prepare(
        'SELECT profile_json FROM book_creative_profiles WHERE book_id = ?'
      ).get(bookId) as { profile_json: string };
      expect(JSON.parse(stored.profile_json).workType).toBe('novel');

      // 书籍资料回读：类型长篇、蓝图字数300万。
      const profile = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/book-profile`,
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(profile.statusCode).toBe(200);
      expect(profile.json().data.workType).toBe('novel');
      expect(profile.json().data.openingBlueprint.planningProfile.expectedTotalWords).toBe(3_000_000);

      // 书籍资料编辑：长篇书改书名（蓝图仍300万字）正常保存。
      const blueprint = profile.json().data.openingBlueprint;
      const renamed = await app.inject({
        method: 'PUT', url: `/api/v1/v7/books/${bookId}/book-profile`,
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { expectedVersion: profile.json().data.version, title: '三国流民·改', openingBlueprint: blueprint }
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json().data.title).toBe('三国流民·改');

      // 同一编辑入口保持类型：把字数改成99,999必须被长篇旧合同拒绝。
      const illegalBlueprint = structuredClone(blueprint);
      illegalBlueprint.planningProfile.expectedTotalWords = 99_999;
      const illegalSave = await app.inject({
        method: 'PUT', url: `/api/v1/v7/books/${bookId}/book-profile`,
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { expectedVersion: renamed.json().data.version, title: '三国流民·改', openingBlueprint: illegalBlueprint }
      });
      expect(illegalSave.statusCode).toBe(400);
      expect(illegalSave.json().error.message).toContain('预计总字数必须是100000至10000000');

      // 缺workType旧客户端兼容：不传creativeProfile，任务按缺省长篇规范化冻结。
      const legacy = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { idea: '李四重生到未来世界修理星舰引擎。', idempotencyKey: 'r1-chain-legacy-0001' }
      });
      expect(legacy.statusCode).toBe(200);
      const legacyRow = context.database.prepare(
        'SELECT creative_profile_json AS profile FROM v7_opening_agent_tasks WHERE task_id = ?'
      ).get(legacy.json().data.taskId as string) as { profile: string };
      expect(JSON.parse(legacyRow.profile).workType).toBe('novel');
    } finally {
      await app.close();
    }
  });
});

const CLOSED_MESSAGE = /暂未开放，目前仅支持长篇小说/;

describe('OPENING-NOVEL-CLOSE-01 开放边界：非长篇新请求409且零新增，历史读取与幂等保留', () => {
  it.each([
    { workType: 'short_story', label: '短篇小说', fixture: SHORT_PACKAGE },
    { workType: 'memoir', label: '个人自传', fixture: MEMOIR_PACKAGE },
    { workType: 'script', label: '影视剧本', fixture: SCRIPT_PACKAGE }
  ] as const)('$label：新建/手动确认/AI确认/修订/恢复入口全拒，历史任务只读', async ({ workType, fixture }) => {
    context = createTestContext(`wenmi-opening-closed-${workType}-`);
    const resolver = new TypeAwareResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, `closed-${workType}@example.com`, '边界作者');
      const ownerId = (context.database.prepare("SELECT owner_id FROM owners WHERE display_name = '边界作者'").get() as { owner_id: string }).owner_id;

      // 新建任务：规范化之后、建任务壳/排队/模型调用之前拒绝。
      const tasksBefore = openingTaskCount(context.database, ownerId);
      const callsBefore = resolver.calls.length;
      const created = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '一段未开放类型的新开书想法。',
          idempotencyKey: `closed-create-${workType}`,
          creativeProfile: { scale: 3, styles: [], workType }
        }
      });
      expect(created.statusCode).toBe(409);
      expect(created.json().error.message).toMatch(CLOSED_MESSAGE);
      expect(openingTaskCount(context.database, ownerId)).toBe(tasksBefore);
      expect(resolver.calls.length).toBe(callsBefore);

      // 手动确认（自己设计）：任何建草稿/建书写入之前拒绝。
      const manual = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          openingIdea: '未开放类型的手动开书。',
          openingPackage: makeManualPackage(fixture.positioning.expectedTotalWords),
          creativeProfile: { scale: 3, styles: [], workType },
          idempotencyKey: `closed-manual-${workType}`
        }
      });
      expect(manual.statusCode).toBe(409);
      expect(manual.json().error.message).toMatch(CLOSED_MESSAGE);
      expect(bookCount(context.database, ownerId)).toBe(0);
      expect(positioningDraftCount(context.database, ownerId)).toBe(0);

      // 历史非长篇任务（本轮边界之前创建）：先建真实长篇任务跑完设计，再把冻结快照与
      // 候选内容改写成该类型，等价于旧版客户端留下的任务。
      const historical = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: `历史${workType}任务的开书想法。`,
          idempotencyKey: `closed-task-${workType}`,
          creativeProfile: { scale: 3, styles: [], workType: 'novel' }
        }
      });
      expect(historical.statusCode).toBe(200);
      const taskId = historical.json().data.taskId as string;
      await poll(app, cookie, taskId, ['awaiting_author_confirmation']);
      context.database.prepare('UPDATE v7_opening_agent_tasks SET creative_profile_json = ? WHERE task_id = ?')
        .run(JSON.stringify({ scale: 3, styles: [], workType }), taskId);
      context.database.prepare("UPDATE v7_opening_agent_candidates SET content_json = ? WHERE owner_id = ? AND task_id = ? AND kind = 'opening_package'")
        .run(JSON.stringify(fixture), ownerId, taskId);
      const modelCallsAfterSeed = resolver.calls.length;

      // 历史读取可用：冻结类型如实回读，不被静默转换。
      const readable = await app.inject({
        method: 'GET', url: `/api/v1/v7/opening-agent/tasks/${taskId}`,
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(readable.statusCode).toBe(200);
      expect(readable.json().data.creativeProfile.workType).toBe(workType);
      const activePackage = latestCandidate(readable.json().data, 'opening_package');
      const candidatesBefore = (context.database.prepare(
        'SELECT COUNT(*) AS n FROM v7_opening_agent_candidates WHERE task_id = ?'
      ).get(taskId) as { n: number }).n;

      // 修订入口：必然新增模型工作，按冻结任务类型拒绝。
      const revised = await app.inject({
        method: 'POST', url: `/api/v1/v7/opening-agent/tasks/${taskId}/revisions`,
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          baseCandidateId: activePackage.candidateId,
          openingPackage: activePackage.content,
          adjustmentNote: '试试修改',
          idempotencyKey: `closed-revise-${workType}`
        }
      });
      expect(revised.statusCode).toBe(409);
      expect(revised.json().error.message).toMatch(CLOSED_MESSAGE);
      expect((context.database.prepare(
        'SELECT COUNT(*) AS n FROM v7_opening_agent_candidates WHERE task_id = ?'
      ).get(taskId) as { n: number }).n).toBe(candidatesBefore);

      // AI确认入架：冻结任务类型非长篇，新书创建被拒，不信客户端标novel。
      const confirmed = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          taskId,
          candidateId: activePackage.candidateId,
          openingPackage: activePackage.content,
          idempotencyKey: `closed-confirm-${workType}`
        }
      });
      expect(confirmed.statusCode).toBe(409);
      expect(confirmed.json().error.message).toMatch(CLOSED_MESSAGE);
      expect(bookCount(context.database, ownerId)).toBe(0);

      // 恢复入口：旧任务停在工作队列也不再被重新消费；读取保持200且不触发模型。
      context.database.prepare("UPDATE v7_opening_agent_tasks SET status = 'queued' WHERE task_id = ?").run(taskId);
      const reread = await app.inject({
        method: 'GET', url: `/api/v1/v7/opening-agent/tasks/${taskId}`,
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(reread.statusCode).toBe(200);
      expect(reread.json().data.status).toBe('queued');
      expect(resolver.calls.length).toBe(modelCallsAfterSeed);
    } finally {
      await app.close();
    }
  });

  it('已完成的手动确认按原幂等合同返回原书（历史非长篇书不受开放边界影响）', async () => {
    context = createTestContext('wenmi-opening-closed-replay-');
    const resolver = new TypeAwareResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'closed-replay@example.com', '幂等作者');
      const ownerId = (context.database.prepare("SELECT owner_id FROM owners WHERE display_name = '幂等作者'").get() as { owner_id: string }).owner_id;
      // 用生产同一代码路径预置“本轮边界之前已完成”的短篇确认：定位草稿+正式书+偏好快照。
      const idea = '祖父辈在南方修铁路的真实经历。';
      const validated = validateV7ManualOpeningPackage(makeManualPackage(80_000), 'short_story');
      const idempotencyKey = 'closed-replay-manual-0001';
      const stableHash = createHash('sha256').update(`${ownerId}\nmanual-${idempotencyKey}`).digest('hex').slice(0, 32);
      const draftId = `v7-opening-draft-${stableHash}`;
      const bookId = `v7-book-${stableHash}`;
      const positioning = new PositioningService(context.database, new UuidGenerator(), new SystemClock());
      positioning.createDraft({ ownerId }, {
        title: validated.title,
        text: validated.positioning.coreAppeal,
        openingBlueprint: toV7OpeningBlueprint(validated, idea),
        workType: 'short_story'
      }, { draftId, proposedBookId: bookId });
      context.database.prepare('INSERT INTO books (book_id,owner_id,title,status,version,positioning_version,canon_revision,editor_epoch,created_at,updated_at) VALUES (?,?,?,?,1,0,0,0,?,?)')
        .run(bookId, ownerId, validated.title, 'active', '2026-09-19', '2026-09-19');
      context.database.prepare("UPDATE positioning_drafts SET status = 'confirmed', confirmed_book_id = ? WHERE draft_id = ?").run(bookId, draftId);
      context.database.prepare('INSERT INTO book_creative_profiles(owner_id,book_id,profile_json,source_task_id,created_at) VALUES(?,?,?,?,?)')
        .run(ownerId, bookId, JSON.stringify({ scale: 3, styles: [], workType: 'short_story' }), 'fixture', '2026-09-19');

      const replay = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          openingIdea: idea,
          openingPackage: makeManualPackage(80_000),
          creativeProfile: { scale: 3, styles: [], workType: 'short_story' },
          idempotencyKey
        }
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data.bookId).toBe(bookId);
      expect(bookCount(context.database, ownerId)).toBe(1);
      expect(resolver.calls.length).toBe(0);
    } finally {
      await app.close();
    }
  });
});

const GUARD_MESSAGE = /尚未开放/;

describe('R2 服务层门禁：非长篇在写任务/排队/占预算之前拒绝', () => {
  it('时光机 start/startDesignRound/retry 三类非长篇全拒、0任务0模型调用；长篇与无快照旧书放行', () => {
    context = createTestContext('wenmi-opening-type-guard-svc-');
    const ownerId = context.config.ownerId;
    context.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(ownerId, '门禁验收', '2026-09-19', '2026-09-19');
    let modelCalls = 0;
    const gateway = new TimeMachineModelGateway(context.database, () => { modelCalls += 1; throw new Error('Model calls forbidden'); });
    const service = new TimeMachineDesignService(context.database, gateway, 64_000);
    const selection = { recommendationRunId: 'seed-run', recommendationHash: 'seed-hash', preparationVersion: 'seed-version', selectedLineIds: [], addedLines: [], shape: 'auto' as const, ensemble: false, authorNote: '' };
    for (const workType of ['short_story', 'memoir', 'script'] as const) {
      const bookId = `guard-${workType}`;
      seedBookWithWorkType(context!.database, ownerId, bookId, workType);
      const scope = { ownerId, bookId };
      expect(() => service.start(scope, 'recommend', '', `guard-start-${workType}`)).toThrow(GUARD_MESSAGE);
      expect(() => service.startDesignRound(scope, selection, `guard-round-${workType}`)).toThrow(GUARD_MESSAGE);
      expect(() => service.retry(scope, 'missing-run')).toThrow(GUARD_MESSAGE);
      expect(timeMachineRunCount(context!.database, bookId)).toBe(0);
    }
    // 长篇与无快照旧书不误拦：start正常建run（队列模式，不触发模型）。
    for (const workType of ['novel', null] as const) {
      const bookId = `guard-${workType ?? 'legacy'}`;
      seedBookWithWorkType(context!.database, ownerId, bookId, workType);
      const runId = service.start({ ownerId, bookId }, 'recommend', '', `guard-start-${workType ?? 'legacy'}`);
      expect(typeof runId).toBe('string');
      expect(timeMachineRunCount(context!.database, bookId)).toBe(1);
    }
    expect(modelCalls).toBe(0);
  });

  it('设定任务入口（推荐/批量/融合）对非长篇拒绝，对长篇不按门禁拦截', () => {
    context = createTestContext('wenmi-opening-type-guard-setting-');
    const ownerId = context.config.ownerId;
    context.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(ownerId, '设定门禁', '2026-09-19', '2026-09-19');
    const settings = new V7SettingEditorialService(
      context.database,
      { resolve: () => { throw new Error('Model calls forbidden'); } },
      new UuidGenerator(),
      new SystemClock(),
      { codingPlan: false, agentPlan: false }
    );
    seedBookWithWorkType(context!.database, ownerId, 'guard-setting-short', 'short_story');
    expect(() => settings.createRecommendation(ownerId, 'guard-setting-short', {})).toThrow(GUARD_MESSAGE);
    expect(() => settings.createBatch(ownerId, 'guard-setting-short', { selectedItemKeys: ['world-stage'], idempotencyKey: 'guard-batch-1' })).toThrow(GUARD_MESSAGE);
    expect(() => settings.fuse(ownerId, 'guard-setting-short', 'world-stage', {})).toThrow(GUARD_MESSAGE);
    // 长篇书：可以因其他业务原因失败，但绝不能被“尚未开放”门禁误拦。
    seedBookWithWorkType(context!.database, ownerId, 'guard-setting-novel', 'novel');
    for (const action of [
      () => settings.createRecommendation(ownerId, 'guard-setting-novel', {}),
      () => settings.createBatch(ownerId, 'guard-setting-novel', { selectedItemKeys: ['world-stage'], idempotencyKey: 'guard-batch-2' }),
      () => settings.fuse(ownerId, 'guard-setting-novel', 'world-stage', {})
    ]) {
      let message = '';
      try { action(); } catch (error) { message = error instanceof Error ? error.message : String(error); }
      expect(message).not.toMatch(GUARD_MESSAGE);
    }
  });
});

/** HTTP就绪种子：蓝图 + 已确认设定 + 兼容分支统一整理批次，使请求穿过prerequisite直达类型门禁。 */
function seedPreparedBook(ownerId: string, bookId: string, workType: 'novel' | 'short_story' | 'memoir' | 'script'): void {
  seedBookWithWorkType(context!.database, ownerId, bookId, workType);
  const db = context!.database;
  const scope = { ownerId, bookId };
  const profile = new BookProfileViewService(db).get(scope);
  db.prepare(`INSERT INTO v7_setting_item_versions
    (version_id,owner_id,book_id,item_key,revision,status,content_json,created_by,created_at)
    VALUES (?,?,?, 'world-stage',1,'confirmed',?,'author','2026-09-19T00:00:00.000Z')`)
    .run(`setting-version-${bookId}`, ownerId, bookId, JSON.stringify({ era: '北宋末年', rule: '写实历史，无超凡体系' }));
  db.prepare(`INSERT INTO v7_setting_items
    (owner_id,book_id,item_key,item_label,group_title,item_prompt,state,active_version_id,revision,updated_at)
    VALUES (?,?,'world-stage','世界舞台','核心设定','时代和世界规则','confirmed',?,1,'2026-09-19T00:00:00.000Z')`)
    .run(ownerId, bookId, `setting-version-${bookId}`);
  db.prepare(`INSERT INTO v7_setting_batches
    (batch_id,owner_id,book_id,idempotency_key,request_hash,status,selected_items_json,custom_items_json,opening_version,opening_hash,roster_json,created_at,updated_at)
    VALUES (?,?,?,?,?,'awaiting_author',?,?,1,?,'[]','2026-09-19T01:00:00.000Z','2026-09-19T01:00:00.000Z')`)
    .run(
      `seed-final-review-${bookId}`, ownerId, bookId,
      `seed-final-review-key-${bookId}`, 'b'.repeat(64),
      JSON.stringify({ taskKind: 'batch_final_review', result: { summary: '离线统一整理完成', items: [] } }),
      JSON.stringify({ taskKind: 'batch_final_review' }),
      createHash('sha256').update(JSON.stringify(profile.openingBlueprint)).digest('hex')
    );
}

describe('R2 HTTP层门禁：非长篇三条入口409且0新任务，长篇放行', () => {
  it('时光机推荐/设计轮与设定推荐对非长篇409含尚未开放，runs为0；长篇正常建任务', async () => {
    context = createTestContext('wenmi-opening-type-guard-http-');
    const resolver = new TypeAwareResolver();
    // 与生产一致的64k上下文窗口：时光机start依赖窗口打包来源；脚本化resolver保证任何被放行的调用可追踪。
    const app = await createAppServer(context.config, context.database, { timeMachineWindowTokens: 64_000, v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'r2-guard@example.com', '门禁作者');
      const owner = context.database.prepare("SELECT owner_id FROM owners WHERE display_name = '门禁作者'").get() as { owner_id: string };
      const ownerId = owner.owner_id;
      const books = ['short_story', 'memoir', 'script', 'novel'] as const;
      for (const workType of books) seedPreparedBook(ownerId, `http-${workType}`, workType);

      for (const workType of ['short_story', 'memoir', 'script'] as const) {
        const bookId = `http-${workType}`;
        const recommend = await app.inject({
          method: 'POST', url: `/api/time-machine/books/${bookId}/recommendation-runs`,
          headers: { ...BROWSER_HEADERS, cookie },
          payload: { idempotencyKey: `r2-rec-${workType}` }
        });
        expect(recommend.statusCode).toBe(409);
        expect(recommend.json().error.message).toMatch(GUARD_MESSAGE);
        const design = await app.inject({
          method: 'POST', url: `/api/time-machine/books/${bookId}/design-runs`,
          headers: { ...BROWSER_HEADERS, cookie },
          payload: {
            idempotencyKey: `r2-design-${workType}`,
            selection: { recommendationRunId: 'seed-run', recommendationHash: 'seed-hash', preparationVersion: 'seed-version', selectedLineIds: ['line-1'], addedLines: [], shape: 'single', ensemble: false, authorNote: '' }
          }
        });
        expect(design.statusCode).toBe(409);
        expect(design.json().error.message).toMatch(GUARD_MESSAGE);
        const setting = await app.inject({
          method: 'POST', url: `/api/v1/v7/books/${bookId}/setting-recommendations`,
          headers: { ...BROWSER_HEADERS, cookie },
          payload: { idempotencyKey: `r2-setting-${workType}` }
        });
        expect(setting.statusCode).toBe(409);
        expect(setting.json().error.message).toMatch(GUARD_MESSAGE);
        expect(timeMachineRunCount(context!.database, bookId)).toBe(0);
      }
      const blockedBatchCount = (context.database.prepare(
        "SELECT COUNT(*) AS n FROM v7_setting_batches WHERE book_id IN ('http-short_story','http-memoir','http-script') AND idempotency_key LIKE 'r2-setting-%'"
      ).get() as { n: number }).n;
      expect(blockedBatchCount).toBe(0);
      // 被拒请求不得产生任何模型调用（R2：写任务/排队/占预算之前拒绝）。
      expect(resolver.calls.length).toBe(0);

      // 长篇合法路径：推荐与设计轮进入队列（脚本化resolver兜底，不断言终态）。
      const novelRecommend = await app.inject({
        method: 'POST', url: '/api/time-machine/books/http-novel/recommendation-runs',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { idempotencyKey: 'r2-rec-novel' }
      });
      expect([200, 202]).toContain(novelRecommend.statusCode);
      expect(timeMachineRunCount(context!.database, 'http-novel')).toBe(1);
      const novelSetting = await app.inject({
        method: 'POST', url: '/api/v1/v7/books/http-novel/setting-recommendations',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { idempotencyKey: 'r2-setting-novel' }
      });
      expect(novelSetting.statusCode).toBe(200);
      expect(novelSetting.body).not.toContain('尚未开放');
    } finally {
      await app.close();
    }
  });
});
