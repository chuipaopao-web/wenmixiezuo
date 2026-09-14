import { expect } from 'vitest';
import { ModelAdapterError, type ModelAdapter, type ModelRequest, type ModelResult } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { ModelPurpose } from '../../../apps/api/src/infrastructure/models/model-runtime-config.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import type { createAppServer } from '../../../apps/api/src/http/app-server.js';
import { V7_SETTING_CATALOG } from '@wenmi/v7-backend';

/**
 * 设定部门共享夹具：从v7-setting-editorial-department.test.ts原位抽出，供部门套件与
 * S1-A持久化门禁测试（s1a-fixes）复用。内容与部门套件原实现一致，勿在副本中分叉。
 */
export const DEPARTMENT_HEADERS = { host: '127.0.0.1:43111', origin: 'http://127.0.0.1:43110', 'sec-fetch-site': 'same-site', 'content-type': 'application/json' };

type TestApp = Awaited<ReturnType<typeof createAppServer>>;

export function settingStagePrompt(compiledPrompt: string): string {
  try {
    const value = JSON.parse(compiledPrompt) as { contextPack?: { content?: { stageTaskPayload?: unknown } } };
    const payload = value.contextPack?.content?.stageTaskPayload;
    if (typeof payload === 'string') return payload;
    if (payload !== undefined) return JSON.stringify(payload);
  } catch { /* 兼容未编译的测试提示。 */ }
  return compiledPrompt;
}

export function groupedSettingOutput(prompt: string): string {
  const match = prompt.match(/【本组要完成的设定】(\[[^\n]+\])/u);
  if (match?.[1] === undefined) throw new Error('测试分组提示缺少条目合同');
  const items = JSON.parse(match[1]) as Array<{ itemKey: string; label: string }>;
  return JSON.stringify({
    items: items.map((item) => ({
      itemKey: item.itemKey,
      content: `${item.label}以东汉末年的真实社会条件为边界，人物行动必须服从交通、粮食、身份与制度限制，并给后续剧情保留明确可追溯的因果空间。`,
      designRationale: `先把${item.label}的硬边界立稳，避免后续规划凭空增加能力或条件。`,
      contextSummary: `${item.label}遵守东汉末年交通、粮食、身份和制度边界。`,
      factEntries: [`${item.label}必须服从东汉末年的交通、粮食、身份与制度限制。`],
      storyConsequences: ['卷和链设计必须检查现实条件'],
      dependencies: ['正式开书资料'],
      risks: [],
      selfReview: { verdict: 'pass', summary: `${item.label}与正式开书资料一致。`, issues: [], suggestions: [] }
    }))
  });
}

export function batchFinalReviewOutput(prompt: string): string {
  const payload = JSON.parse(prompt) as {
    reviewInputMode?: string;
    currentSettingCandidates?: Array<{ itemKey: string; label: string; groupTitle: string; contextSummary?: string }>;
  };
  if (payload.reviewInputMode !== 'layered_semantic_index') {
    return JSON.stringify({
      verdict: 'pass',
      summary: '全部设定已经跨条目核对，机构和时代称呼统一。',
      unifiedDecisions: [{ topic: '时代称呼', decision: '统一使用东汉末年', reason: '与正式开书资料一致' }],
      conflicts: [],
      patches: [{
        itemKey: 'world-stage',
        finalContent: '东汉末年的州郡、驿道与粮道互相制约，统一使用同一套时代称呼。',
        summary: '统一世界舞台中的时代称呼。',
        issues: [],
        suggestions: []
      }]
    });
  }
  const items = payload.currentSettingCandidates ?? [];
  const groups = new Map<string, string[]>();
  for (const item of items) groups.set(item.groupTitle, [...(groups.get(item.groupTitle) ?? []), item.itemKey]);
  if (items.some((item) => item.label.startsWith('冲突长设定'))) {
    return JSON.stringify({
      verdict: 'needs_author',
      summary: '发现国号冲突，正在按统一决定修回受影响条目。',
      contextSummary: '全书统一使用景朝，其他既有规则保持不变。',
      factLedger: items.map((item) => ({ itemKey: item.itemKey, label: item.label, facts: [item.contextSummary ?? item.label] })),
      groupSummaries: [...groups].map(([groupTitle, itemKeys]) => ({ groupTitle, summary: `${groupTitle}需要统一国号。`, itemKeys })),
      unifiedDecisions: [{ topic: '王朝国号', decision: '全书统一使用景朝', reason: '正式开书资料采用景朝' }],
      conflicts: [{ itemKeys: items.map((item) => item.itemKey), problem: '同一本书出现多个国号', decision: '全部改为景朝', impact: '不统一会污染后续规划' }],
      patches: []
    });
  }
  return JSON.stringify({
    verdict: 'pass',
    summary: '大量设定已经按分组轻量核对完成。',
    contextSummary: '人物、时代、规则和禁项已经按分组统一，后续只按任务回查相关条目。',
    factLedger: items.map((item) => ({
      itemKey: item.itemKey,
      label: item.label,
      facts: [item.contextSummary ?? `${item.label}沿用当前确认版本。`]
    })),
    groupSummaries: [...groups].map(([groupTitle, itemKeys]) => ({
      groupTitle,
      summary: `${groupTitle}已经统一关键边界。`,
      itemKeys
    })),
    unifiedDecisions: [],
    conflicts: [],
    patches: []
  });
}

export function batchFinalReviewPatchOutput(prompt: string): string {
  const payload = JSON.parse(prompt) as {
    affectedItems?: Array<{ itemKey: string; label: string; currentContent: string; existingIssues?: unknown[] }>;
  };
  return JSON.stringify({
    patches: (payload.affectedItems ?? []).map((item) => ({
      itemKey: item.itemKey,
      finalContent: `景朝统一设定：${item.currentContent.replaceAll('大靖', '景朝').replaceAll('大朔', '景朝').replaceAll('大宁', '景朝')}`.slice(0, 2_000),
      summary: `${item.label}已经统一使用景朝。`,
      contextSummary: `${item.label}统一使用景朝，原有规则保持不变。`,
      factEntries: [`${item.label}使用景朝国号。`],
      issues: Array.isArray(item.existingIssues) ? item.existingIssues : [],
      suggestions: []
    }))
  });
}

export function recommendationOutput(): string {
  const requiredKeys = ['world-stage', 'governance', 'history', 'military'];
  const suggestedKeys: string[] = [];
  const used = new Set([...requiredKeys, ...suggestedKeys]);
  return JSON.stringify({
    requiredKeys,
    suggestedKeys,
    excludedKeys: V7_SETTING_CATALOG.map((item) => item.key).filter((key) => !used.has(key)),
    summary: '这是写实三国穿越文，先准备时代、社会规则、历史边界和军政关系；游戏与超凡设定暂时不用。'
  });
}

export class SettingResolver implements V7OpeningModelAdapterResolver {
  public readonly temperatures: Array<number | undefined> = [];
  public readonly prompts: string[] = [];
  public recommendationAttempts = 0;
  public failAllCalls = false;
  public failMemberKey: string | null = null;
  public finalReviewGate: Promise<void> | null = null;
  public finalReviewStarted: (() => void) | null = null;
  public finalReviewOutputOverride: string | null = null;
  private failedWriterOne = false;
  public constructor(
    private readonly failFirstWriter: boolean,
    public failRecommendation = false,
    private readonly recommendationOutcomeUnknown = false
  ) {}
  public resolve(provider: string, modelId: string, _purpose: ModelPurpose): ModelAdapter {
    return { provider, modelId, generate: async (request: ModelRequest): Promise<ModelResult> => {
      this.temperatures.push(request.temperature);
      this.prompts.push(request.prompt);
      if (this.failAllCalls) throw new Error('模拟当前设定成员均未完成');
      if (this.failMemberKey === request.agentId) throw new Error('模拟指定成员本轮没有完成');
      if (request.prompt.includes('v7_setting_batch_final_review_v1')) {
        this.finalReviewStarted?.();
        if (this.finalReviewGate !== null) await this.finalReviewGate;
      }
      if (this.failFirstWriter && request.agentId === 'planner-deepseek-v4-pro' && !this.failedWriterOne) { this.failedWriterOne = true; throw new Error('模拟成员临时请假'); }
      if (request.prompt.includes('只判断后续设定阶段应该准备哪些条目')) {
        this.recommendationAttempts += 1;
        if (this.failRecommendation) {
          if (this.recommendationOutcomeUnknown) {
            throw new ModelAdapterError('模拟设定清单结果未知', 'technical_failure', true, 504, true);
          }
          throw new Error('模拟主编本轮请假');
        }
      }
      const stagePrompt = settingStagePrompt(request.prompt);
      const output = request.prompt.includes('你是设定连续性审查员')
        ? JSON.stringify({change:'wording',covered:true,conflicts:[]})
        : stagePrompt.includes('v7_setting_group_design_v1')
        ? groupedSettingOutput(stagePrompt)
        : stagePrompt.includes('v7_setting_batch_final_review_patch_v1')
        ? batchFinalReviewPatchOutput(stagePrompt)
        : request.prompt.includes('v7_setting_batch_final_review_v1')
        ? this.finalReviewOutputOverride ?? batchFinalReviewOutput(stagePrompt)
        : request.prompt.includes('v7_compile_book_genre_profile_v1')
        ? JSON.stringify({
            primaryGenreKey: 'history',
            supportingGenreKeys: [],
            publicLabel: '历史穿越',
            workingIdentity: '以历史时代约束为主体，让现代人的选择在真实制度、交通与资源限制下改变局面。',
            primaryPromise: '主角在可信的历史边界内从底层逐步立足。',
            supportingFunctions: [{ genreKey: 'history', functions: ['穿越只提供视角差异，不提供万能答案。'] }],
            writingPriorities: ['人物行动符合时代条件', '成长有持续代价'],
            authenticityChecks: ['年代、交通、军政与物资必须互相一致'],
            avoidPatterns: ['现代知识无成本碾压', '真实人物集体降智'],
            conflictResolutions: []
          })
        : request.prompt.includes('只判断后续设定阶段应该准备哪些条目')
          ? recommendationOutput()
        : request.prompt.includes('你是副编')
        ? JSON.stringify({ verifiedFacts: ['东汉末年制度存在地域差异'], uncertainPoints: ['具体年月需要作者确定'], usableBoundaries: ['不伪造史实'], translationForWriter: '把史实作为边界，不照抄百科。' })
        : request.prompt.includes('你是设计成员')
          ? JSON.stringify({ content: '东汉末年秩序松动，地方军政力量逐渐上升。主角所在地区交通、粮食和户籍都受战乱限制，历史事实作为边界，允许人物与局部事件合理架空。', designRationale: '保持三国代入感，同时给原创剧情留下空间。', storyConsequences: ['分卷设计必须考虑粮道和身份'], dependencies: ['开书时代背景'], risks: ['具体起始年份需作者确认'] })
          : request.prompt.includes('候选：') || request.prompt.includes('上次输出存在空字段')
            ? JSON.stringify({ verdict: 'pass', finalContent: '东汉末年秩序松动，地方军政力量逐渐上升。主角所在地区交通、粮食和户籍都受战乱限制；历史事实作为边界，人物和局部事件可在因果合理的前提下架空。', summary: '与开书资料一致，可供后续蓝图和分卷使用。', issues: [], suggestions: ['确定首卷所在州郡时再补地名细节'] })
            : JSON.stringify({ verdict: 'pass', finalContent: '', summary: '字段偶发缺失，系统应自动修复。', issues: [], suggestions: [] });
      return { provider, modelId, output, inputTokens: 80, outputTokens: 160, cashCostCny: 0, state: 'succeeded' };
    }};
  }
}

export async function registerDepartmentAuthor(app: TestApp, email: string, displayName: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: DEPARTMENT_HEADERS, payload: { email, password, displayName } });
  expect(response.statusCode).toBe(200);
  const raw = response.headers['set-cookie']; return String(Array.isArray(raw) ? raw[0] : raw).split(';', 1)[0]!;
}

export async function createDepartmentBook(
  app: TestApp,
  cookie: string,
  title: string,
  key: string,
  category: string,
  options: { tags?: string[]; mustFollow?: string[] } = {}
): Promise<string> {
  const openingPackage = {
    title, positioning: {
      publishingPlatform: 'fanqie', channel: 'male', category, genres: [category], tags: options.tags ?? ['成长'],
      coreAppeal: '小人物在复杂世界中稳步成长。', targetReaders: '喜欢长篇成长和持续回报的男频读者',
      expectedTotalWords: 2_000_000, volumePlan: { minimum: 5, recommended: 6, maximum: 8 },
      retentionPositioning: '开篇快速建立主角处境，逐卷兑现成长、关系和局势变化。'
    },
    backgrounds: { eraAndWorld: category.includes('科幻') ? '星际殖民时代' : '东汉末年', openingSituation: '主角处于社会底层。' },
    protagonists: [{ name: '张三', age: '23岁', identity: '男主', background: '普通人', familyBackground: '普通家庭出身', careerBackground: '', goldenFinger: '', goal: '活下去并改变处境', dilemma: '资源和身份不足', personality: ['谨慎'], boundary: '不能无代价解决问题' }],
    opening: { startingSituation: '危机中醒来', incitingIncident: '被卷入冲突', immediateConflict: '必须立即选择', readerPromise: '靠行动逐步成长' },
    longTermDirection: { centralConflict: '个人与旧秩序冲突', progression: '从底层到能影响局势', relationshipDirection: '逐步建立可信伙伴', storyPotential: '冲突持续升级' },
    possibleEnding: { direction: '建立新的生活秩序', price: '承担真实损失', openness: '保留调整空间' }, authorNotes: [], mustFollow: options.mustFollow ?? ['不违背已确认设定']
  };
  const response = await app.inject({ method: 'POST', url: '/api/v1/v7/opening-books', headers: { ...DEPARTMENT_HEADERS, cookie }, payload: { openingPackage, idempotencyKey: key } });
  expect(response.statusCode).toBe(200); return response.json().data.bookId as string;
}

export async function pollDepartmentBatch(app: TestApp, cookie: string, bookId: string, batchId: string): Promise<any> {
  for (let index = 0; index < 120; index += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-batches/${batchId}`, headers: { host: DEPARTMENT_HEADERS.host, cookie } });
    expect(response.statusCode).toBe(200); const view = response.json().data;
    if (!['queued', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('设定任务未在预期时间完成');
}

export async function pollDepartmentFinalReview(app: TestApp, cookie: string, bookId: string): Promise<any> {
  for (let index = 0; index < 120; index += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/v7/books/${bookId}/setting-final-reviews/current`, headers: { host: DEPARTMENT_HEADERS.host, cookie } });
    expect(response.statusCode).toBe(200); const view = response.json().data;
    if (!['queued', 'working'].includes(view.status)) return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('设定统一整理未在预期时间完成');
}
