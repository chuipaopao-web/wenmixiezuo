import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPENING_EVALUATION_REPORT } from '@wenmi/agent-catalog';
import type { ModelAdapter, ModelRequest, ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { createTestContext as createBaseContext, type TestContext } from '../../helpers/test-context.js';

// OPENING-UI-02：三人名单合同；OPENING-NOVEL-CLOSE-01：作品类型开放边界——仅长篇小说贯通，
// 短篇/自传/剧本新建409零新增；旧客户端兼容与请求指纹保持。模型调用全部脚本化合成，
// 只验证名单准入、提示语义、持久化与回读，不调用真实模型，文学效果由老板实测。
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
  const context = createBaseContext(prefix);
  context.config.modelRuntime.endpoints.coding.apiKey = 'test-coding-key';
  context.config.modelRuntime.endpoints.agent.apiKey = 'test-agent-key';
  return context;
}

const BROWSER_HEADERS = {
  host: '127.0.0.1:43111',
  origin: 'http://127.0.0.1:43110',
  'sec-fetch-site': 'same-site',
  'content-type': 'application/json'
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

const REVIEW = {
  verdict: 'pass',
  summary: '资料包保留作者核心想法，字段一致，可以交给作者检查。',
  issues: [],
  requiredChanges: [],
  authorDecisions: []
};

interface CapturedCall {
  provider: string;
  modelId: string;
  prompt: Record<string, any>;
}

class CapturingResolver implements V7OpeningModelAdapterResolver {
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
          return { provider, modelId, output: JSON.stringify(REVIEW), inputTokens: 120, outputTokens: 240, cashCostCny: 0, state: 'succeeded' };
        }
        // 同一任务重试书名稳定；不同想法派生不同书名，避免同作者建书书名冲突。
        const originalIdea = String((prompt as { authorSource?: { originalIdea?: unknown } }).authorSource?.originalIdea ?? '');
        const titleSuffix = createHash('sha256').update(originalIdea).digest('hex').slice(0, 4);
        // 总字数必须落在该作品类型的合同范围内（OPENING-UI-02返修R1：类型合同穿透校验）。
        const workType = String((prompt as { creativeDirection?: { workType?: unknown } }).creativeDirection?.workType ?? 'novel');
        const expectedTotalWords = { novel: 3_000_000, short_story: 10_000, memoir: 80_000, script: 60_000 }[workType] ?? 3_000_000;
        const output = JSON.stringify({ ...PACKAGE, title: `${PACKAGE.title}${titleSuffix}`, positioning: { ...PACKAGE.positioning, expectedTotalWords } });
        return { provider, modelId, output, inputTokens: 120, outputTokens: 240, cashCostCny: 0, state: 'succeeded' };
      }
    };
  }

  public clear(): void {
    this.calls.length = 0;
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
  app: Awaited<ReturnType<typeof createAppServer>>,
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

function latestCandidate(view: any, kind: string): any {
  const candidates = view.candidates.filter((item: { kind: string }) => item.kind === kind);
  return candidates.at(-1);
}

describe('OPENING-UI-02 三人名单合同', () => {
  it('固定显示顺序、红玉默认、温予安Kimi2.7真实接线、非名单成员被拒绝', async () => {
    context = createTestContext('wenmi-v7-opening-roster-');
    const resolver = new CapturingResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'v7-roster@example.com', '名单作者', 'strong-pass-561');
      const department = await app.inject({
        method: 'GET', url: '/api/v1/v7/editorial-department',
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(department.statusCode).toBe(200);
      const designers = department.json().data.openingDesignMembers as Array<Record<string, any>>;
      expect(designers.map((member) => member.memberKey)).toEqual([
        'planner-glm-5-3', 'planner-deepseek-v4-pro', 'member-planning_writer-7'
      ]);
      expect(designers.map((member) => member.defaultForRole === true)).toEqual([false, true, false]);
      expect(designers.map((member) => member.displayName)).toEqual([
        expect.stringContaining('幼薇'), expect.stringContaining('红玉'), expect.stringContaining('温予安')
      ]);

      // 手选温予安：Kimi 2.7 经 agent plan 真实派单，成员键冻结进任务。
      const picked = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '张三穿越到三国乱世，从流民开始求生。',
          idempotencyKey: 'v7-roster-picked-0001',
          selectedScreenwriterMemberKey: 'member-planning_writer-7'
        }
      });
      expect(picked.statusCode).toBe(200);
      const pickedTaskId = picked.json().data.taskId as string;
      await poll(app, cookie, pickedTaskId, ['awaiting_author_confirmation']);
      const pickedDesign = resolver.designCalls()[0]!;
      expect([pickedDesign.provider, pickedDesign.modelId]).toEqual(['volcengine-ark-agent-plan', 'kimi-k2.7-code']);
      expect(context.database.prepare(
        'SELECT selected_screenwriter_member_key AS key FROM v7_opening_agent_tasks WHERE task_id = ?'
      ).get(pickedTaskId)).toEqual({ key: 'member-planning_writer-7' });

      // 空选择使用明确默认红玉（DeepSeek V4 Pro），不是数组首项幼薇。
      resolver.clear();
      const defaulted = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { idea: '李四重生到未来世界修理星舰。', idempotencyKey: 'v7-roster-default-0001' }
      });
      expect(defaulted.statusCode).toBe(200);
      await poll(app, cookie, defaulted.json().data.taskId, ['awaiting_author_confirmation']);
      expect(resolver.designCalls()[0]!.modelId).toBe('deepseek-v4-pro');

      // 已退出三人名单的成员（宁云汐/DeepSeek Flash、苏映棠/Kimi K3）新任务明确拒绝。
      for (const rejectedKey of ['member-planning_writer-5', 'planner-kimi-k3']) {
        const rejected = await app.inject({
          method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
          headers: { ...BROWSER_HEADERS, cookie },
          payload: {
            idea: '王五穿越到仙侠世界开客栈。',
            idempotencyKey: `v7-roster-reject-${rejectedKey}`,
            selectedScreenwriterMemberKey: rejectedKey
          }
        });
        expect(rejected.statusCode).toBe(400);
        expect(rejected.json().error.message).toContain('未上岗');
      }
    } finally {
      await app.close();
    }
  });
});

describe('OPENING-NOVEL-CLOSE-01 作品类型开放边界', () => {
  it('长篇小说贯通创建、提示语义、候选、确认入架与书籍回读', async () => {
    context = createTestContext('wenmi-v7-opening-work-types-');
    const resolver = new CapturingResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'v7-types@example.com', '类型作者', 'strong-pass-562');
      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '张三穿越到三国乱世，从流民开始求生，并想办法保护同行百姓。',
          idempotencyKey: 'v7-work-type-novel-0001',
          creativeProfile: { scale: 3, styles: [], workType: 'novel' }
        }
      });
      expect(started.statusCode).toBe(200);
      const taskId = started.json().data.taskId as string;
      const view = await poll(app, cookie, taskId, ['awaiting_author_confirmation']);
      expect(view.creativeProfile.workType).toBe('novel');

      // 设计提示：类型是结构化字段与节点级语义，不是末尾附一句“这是某类型”。
      const design = resolver.designCalls()[0]!.prompt;
      expect(design.creativeDirection.workType).toBe('novel');
      expect(design.creativeDirection.workTypeLabel).toBe('长篇小说');
      expect(JSON.stringify(design.creativeDirection)).toContain('金手指');
      const instructions = (design.finalInstructions as string[]).join('\n');
      expect(instructions).toContain('番茄可用口语');
      expect(instructions).not.toContain('不是网文投稿');
      expect(design.publishingStyle.publicName).toBe('番茄小说');
      expect(design.stageBoundary.instruction).toContain('三席全案策划');

      // 类型策略同样进入主编审查提示。
      const review = resolver.reviewCalls()[0]!.prompt;
      expect(review.creativeDirection.workType).toBe('novel');

      // 确认入架：类型随任务快照复制进正式书并可回读。
      const activePackage = latestCandidate(view, 'opening_package');
      const confirmed = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-books',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          taskId,
          candidateId: activePackage.candidateId,
          openingPackage: activePackage.content,
          idempotencyKey: 'v7-work-type-confirm-novel'
        }
      });
      expect(confirmed.statusCode).toBe(200);
      const bookId = confirmed.json().data.bookId as string;
      const stored = context.database.prepare(
        'SELECT profile_json FROM book_creative_profiles WHERE book_id = ?'
      ).get(bookId) as { profile_json: string };
      expect(JSON.parse(stored.profile_json).workType).toBe('novel');
      const profile = await app.inject({
        method: 'GET', url: `/api/v1/v7/books/${bookId}/book-profile`,
        headers: { host: BROWSER_HEADERS.host, cookie }
      });
      expect(profile.statusCode).toBe(200);
      expect(profile.json().data.workType).toBe('novel');
    } finally {
      await app.close();
    }
  });

  it.each([
    { workType: 'short_story', label: '短篇小说' },
    { workType: 'memoir', label: '个人自传' },
    { workType: 'script', label: '影视剧本' }
  ] as const)('$label暂未开放：新建任务409且零新增任务、零模型调用', async ({ workType }) => {
    context = createTestContext(`wenmi-v7-opening-closed-${workType}-`);
    const resolver = new CapturingResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, `v7-closed-${workType}@example.com`, '边界作者', 'strong-pass-565');
      const ownerId = (context.database.prepare("SELECT owner_id FROM owners WHERE display_name = '边界作者'").get() as { owner_id: string }).owner_id;
      const before = (context.database.prepare(
        'SELECT COUNT(*) AS n FROM v7_opening_agent_tasks WHERE owner_id = ?'
      ).get(ownerId) as { n: number }).n;
      const started = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '未开放类型的新开书想法。',
          idempotencyKey: `v7-closed-${workType}-0001`,
          creativeProfile: { scale: 3, styles: [], workType }
        }
      });
      expect(started.statusCode).toBe(409);
      expect(started.json().error.message).toContain('暂未开放，目前仅支持长篇小说');
      expect((context.database.prepare(
        'SELECT COUNT(*) AS n FROM v7_opening_agent_tasks WHERE owner_id = ?'
      ).get(ownerId) as { n: number }).n).toBe(before);
      expect(resolver.calls.length).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('创作偏好进入请求指纹：重复请求返回同一任务，同一幂等键变更偏好或类型分别被拒', async () => {
    context = createTestContext('wenmi-v7-opening-type-fingerprint-');
    const resolver = new CapturingResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'v7-fingerprint@example.com', '指纹作者', 'strong-pass-563');
      const base = {
        idea: '赵六穿越到民国开照相馆。',
        idempotencyKey: 'v7-type-fingerprint-0001'
      };
      const first = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { ...base, creativeProfile: { scale: 4, styles: [], workType: 'novel' } }
      });
      expect(first.statusCode).toBe(200);
      const firstTaskId = first.json().data.taskId as string;
      const replay = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { ...base, creativeProfile: { scale: 4, styles: [], workType: 'novel' } }
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data.taskId).toBe(firstTaskId);
      // 同一幂等键变更偏好（仍为长篇）：按请求指纹冲突拒绝。
      const changedProfile = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { ...base, creativeProfile: { scale: 5, styles: [], workType: 'novel' } }
      });
      expect(changedProfile.statusCode).toBe(409);
      expect(changedProfile.json().error.message).toContain('重新发起');
      // 同一幂等键切到未开放类型：先按开放边界拒绝（OPENING-NOVEL-CLOSE-01）。
      const closedType = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { ...base, creativeProfile: { scale: 4, styles: [], workType: 'script' } }
      });
      expect(closedType.statusCode).toBe(409);
      expect(closedType.json().error.message).toContain('暂未开放，目前仅支持长篇小说');
    } finally {
      await app.close();
    }
  });

  it('未知类型明确拒绝；无偏好快照与缺省类型字段的旧请求按长篇兼容', async () => {
    context = createTestContext('wenmi-v7-opening-type-compat-');
    const resolver = new CapturingResolver();
    const app = await createAppServer(context.config, context.database, { v7OpeningModelAdapters: resolver });
    try {
      const cookie = await register(app, 'v7-compat@example.com', '兼容作者', 'strong-pass-564');
      const unknown = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '张三穿越到三国乱世。', idempotencyKey: 'v7-type-unknown-0001',
          creativeProfile: { scale: 4, styles: [], workType: 'space_opera' }
        }
      });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json().error.message).toContain('作品类型');

      // 旧客户端完全不传 creativeProfile：任务可建，按缺省长篇规范化冻结（旧行为）。
      const legacy = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { idea: '张三穿越到三国乱世，从流民开始求生。', idempotencyKey: 'v7-type-legacy-0001' }
      });
      expect(legacy.statusCode).toBe(200);
      const legacyRow = context.database.prepare(
        'SELECT creative_profile_json AS profile FROM v7_opening_agent_tasks WHERE task_id = ?'
      ).get(legacy.json().data.taskId as string) as { profile: string };
      expect(JSON.parse(legacyRow.profile).workType).toBe('novel');

      // 迁移前留下的空快照旧任务（creative_profile_json 为 NULL、旧指纹）：同一幂等键
      // 不带偏好重放必须按旧请求兼容复用，不能报 409。
      const legacyTaskId = legacy.json().data.taskId as string;
      const stored = context.database.prepare(
        'SELECT idea_text AS idea, selected_chief_member_key AS chief, selected_screenwriter_member_key AS screenwriter FROM v7_opening_agent_tasks WHERE task_id = ?'
      ).get(legacyTaskId) as { idea: string; chief: string | null; screenwriter: string | null };
      const legacyHash = createHash('sha256').update(JSON.stringify({
        idea: stored.idea,
        publishingPlatform: 'fanqie',
        selectedChiefMemberKey: stored.chief,
        selectedScreenwriterMemberKey: stored.screenwriter
      })).digest('hex');
      context.database.prepare(
        'UPDATE v7_opening_agent_tasks SET creative_profile_json = NULL, request_hash = ? WHERE task_id = ?'
      ).run(legacyHash, legacyTaskId);
      const legacyRetry = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: { idea: stored.idea, idempotencyKey: 'v7-type-legacy-0001' }
      });
      expect(legacyRetry.statusCode).toBe(200);
      expect(legacyRetry.json().data.taskId).toBe(legacyTaskId);

      // 旧客户端传偏好但没有 workType 字段：按长篇长篇规范化并冻结。
      const missingType = await app.inject({
        method: 'POST', url: '/api/v1/v7/opening-agent/tasks',
        headers: { ...BROWSER_HEADERS, cookie },
        payload: {
          idea: '李四重生到未来世界修理星舰引擎。', idempotencyKey: 'v7-type-missing-0001',
          creativeProfile: { scale: 4, styles: [] }
        }
      });
      expect(missingType.statusCode).toBe(200);
      const row = context.database.prepare(
        'SELECT creative_profile_json AS profile FROM v7_opening_agent_tasks WHERE task_id = ?'
      ).get(missingType.json().data.taskId as string) as { profile: string };
      expect(JSON.parse(row.profile).workType).toBe('novel');
    } finally {
      await app.close();
    }
  });
});
