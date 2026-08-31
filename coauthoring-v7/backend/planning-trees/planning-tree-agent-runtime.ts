import { assertValidPlanningTree } from './planning-tree-domain.js';
import {
  V7_PLANNING_TREE_SCHEMA,
  type PlanningTreeDocument,
  type PlanningTreeGenerationTask,
  type PlanningTreeKind
} from './planning-tree-contracts.js';
import type { CompiledLayeredPlanningTask } from '../planning-methods/layered-planning-engine.js';
import type { V7PlanningMethodSearchRequest } from '../planning-methods/planning-method-retrieval.js';
import type { V7PlanningLayerReferencePack } from './planning-layer-reference-pack.js';

export function parsePlanningTreeOutput(
  output: string,
  treeKind: PlanningTreeKind,
  scopeId: string,
  referencePack?: V7PlanningLayerReferencePack
): PlanningTreeDocument {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('规划成员没有返回完整的树形方案');
  const value = JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('规划成员返回的不是树形方案');
  const document = normalizePlanningTreeEnvelope(value as Record<string, unknown>, treeKind, scopeId);
  if (document.treeKind !== treeKind || document.scopeId !== scopeId) throw new Error('规划成员返回了错误的层级或范围');
  if (referencePack !== undefined) validateDesignStrategy(document, referencePack);
  assertValidPlanningTree(document);
  return document;
}

export function planningTreeGenerationPrompt(input: {
  treeKind: PlanningTreeKind;
  scopeId: string;
  sourceSnapshot: unknown;
  contextPlan: Pick<V7PlanningMethodSearchRequest, 'publicGoal' | 'taskPersona' | 'taskResponsibilities' | 'creativeSpace'>;
  layeredTask: CompiledLayeredPlanningTask;
  generationTask: PlanningTreeGenerationTask;
  referencePack: V7PlanningLayerReferencePack;
}): string {
  return [
    '你是文秘写作V7规划编剧。请只返回一个PlanningTreeDocument JSON对象，不要Markdown，不要思维过程。',
    `本次只设计${treeName(input.treeKind)}，treeKind固定为${input.treeKind}，scopeId固定为${input.scopeId}。`,
    '方法配方是软参考：必须完成当前层责任，但可以改变具体人物行动、阻力、关系、场景和实现方式。',
    '后台资产只是少量候选，不是剧情答案。先从本书人物、实际处境和上层责任创造方案，再决定是否引用；不得把模板替换人名后直接使用。',
    `资料策划签发的本任务身份、责任与创意空间：${JSON.stringify(input.contextPlan)}`,
    '顶层JSON字段必须完整且只按本合同输出：schema="v7-planning-tree-v1",treeKind,scopeId,title,designStrategy,root。不得省略服务端已给出的固定字段。',
    '输出顶层designStrategy：libraryRefs最多使用候选包允许的数量，也可以为0；originalStrategies为1至6项，每项必须是{title,applicationNote}，说明只适合本书当前人物与局势的原创推进办法；decisionNote说明为什么这样取舍。',
    '正式资料与已确认上层方向不可静默改写；正文实际只能来自结算，不得把未来计划写成已经发生。',
    '每个节点必须同时写清剧情、情绪、阅读体验、因果、伏笔与篇幅；没有必要的伏笔可用空数组，不能凑数。',
    '全书树根节点kind=book，子节点只能是volume或ending；单卷树根节点kind=volume，子节点只能是chain；单元链树根节点kind=chain，子节点只能是event。',
    '卷节点必须linkedTree={treeKind:"volume",scopeId:"..."}；链节点必须linkedTree={treeKind:"chain",scopeId:"..."}；其他节点linkedTree=null。',
    '所有key和scopeId只能使用英文字母、数字、冒号、下划线或短横线；根节点sequence=1，子节点sequence从1连续递增。',
    '每个节点字段必须完整：key,kind,sequence,title,story,emotion,experience,causality,threads,budget,linkedTree,children。',
    'story字段：summary,majorEvents,protagonistChange,outcome,nextStep。emotion字段：publicSummary,openingEmotion,pressureMovement,releaseEmotion,intensity；intensity可以用gentle、moderate、strong、mixed，也可以用一句本书具体的强弱变化说明。',
    'experience字段：publicSummary,pressureRhythm,payoffCadence,informationRhythm,contrastWithPrevious,designReason。',
    'causality字段：trigger,causes,coreConflict,turningPoint,consequences。threads字段：foreshadowing,openQuestions。budget字段：wordTarget,chapterRange；chapterRange只能是null或[start,end]数字数组，不能写成"1-40"。',
    `分层执行责任：${JSON.stringify(input.layeredTask)}`,
    `当前树输出合同：${JSON.stringify(input.generationTask)}`,
    `当前层少量候选工具：${JSON.stringify(input.referencePack)}`,
    `服务端冻结资料：${JSON.stringify(input.sourceSnapshot)}`
  ].join('\n\n');
}

export function planningTreeRepairPrompt(input: {
  treeKind: PlanningTreeKind;
  scopeId: string;
  invalidOutput: string;
  validationMessage: string;
}): string {
  return [
    '你刚才的规划内容可以保留，但JSON结构没有通过合同校验。请只修复结构，不要重写剧情、人物、因果、卷序、字数与创意。',
    '只返回一个完整PlanningTreeDocument JSON对象，不要Markdown，不要解释，不要思维过程。',
    `schema固定为${V7_PLANNING_TREE_SCHEMA}。treeKind固定为${input.treeKind}。scopeId固定为${input.scopeId}。title必须保留。`,
    '顶层必须含schema,treeKind,scopeId,title,designStrategy,root。designStrategy.originalStrategies为1至6个{title,applicationNote}对象。',
    'emotion.intensity必须保留原有非空强弱说明。budget.chapterRange只能是null或[start,end]数字数组。',
    `校验问题：${input.validationMessage}`,
    `待修复原文：${input.invalidOutput}`
  ].join('\n\n');
}

function treeName(treeKind: PlanningTreeKind): string {
  if (treeKind === 'book') return '全书方向树';
  if (treeKind === 'volume') return '单卷树';
  return '单元链树';
}

function validateDesignStrategy(document: PlanningTreeDocument, referencePack: V7PlanningLayerReferencePack): void {
  const strategy = document.designStrategy;
  if (strategy === undefined) throw new Error('规划成员没有说明本层如何使用候选工具和原创策略');
  if (!Array.isArray(strategy.originalStrategies) || strategy.originalStrategies.length < 1 || strategy.originalStrategies.length > 6) {
    throw new Error('规划成员必须提出一至六项本书原创策略');
  }
  for (const original of strategy.originalStrategies) {
    if (original.title?.trim().length === 0 || original.applicationNote?.trim().length === 0) {
      throw new Error('本书原创策略缺少名称或使用说明');
    }
  }
  if (!Array.isArray(strategy.libraryRefs) || strategy.libraryRefs.length > referencePack.policy.libraryUseLimit) {
    throw new Error('规划成员引用的后台资产过多');
  }
  const allowed = new Set([
    ...referencePack.narrativeMethods,
    ...referencePack.plotRecipes,
    ...referencePack.plotPatterns
  ].map((item) => `${item.assetType}:${item.key}`));
  const used = new Set<string>();
  for (const reference of strategy.libraryRefs) {
    const key = `${reference.assetType}:${reference.key}`;
    if (!allowed.has(key)) throw new Error('规划成员引用了本轮未提供的后台资产');
    if (used.has(key)) throw new Error('规划成员重复引用了同一后台资产');
    if (reference.applicationNote?.trim().length === 0) throw new Error('后台资产缺少本书使用说明');
    used.add(key);
  }
  if (strategy.decisionNote?.trim().length === 0) throw new Error('规划成员没有说明本层设计取舍');
}

function normalizePlanningTreeEnvelope(
  source: Record<string, unknown>,
  treeKind: PlanningTreeKind,
  scopeId: string
): PlanningTreeDocument {
  const normalized = structuredClone(source);
  normalized.schema ??= V7_PLANNING_TREE_SCHEMA;
  normalized.treeKind ??= treeKind;
  normalized.scopeId ??= scopeId;
  if (normalized.title === undefined && isRecord(normalized.root) && typeof normalized.root.title === 'string') {
    normalized.title = normalized.root.title;
  }
  if (isRecord(normalized.root) && normalized.root.title === undefined && typeof normalized.title === 'string') {
    normalized.root.title = normalized.title;
  }
  if (isRecord(normalized.designStrategy) && Array.isArray(normalized.designStrategy.originalStrategies)) {
    normalized.designStrategy.originalStrategies = normalized.designStrategy.originalStrategies.map((item, index) => (
      typeof item === 'string'
        ? { title: `本书原创策略${index + 1}`, applicationNote: item.trim() }
        : item
    ));
  }
  normalizeNodeFormats(normalized.root, treeKind, scopeId, 1, true);
  return normalized as unknown as PlanningTreeDocument;
}

function normalizeNodeFormats(
  value: unknown,
  treeKind: PlanningTreeKind,
  scopeId: string,
  sequence: number,
  root: boolean
): void {
  if (!isRecord(value)) return;
  const childKind = treeKind === 'book' ? 'volume' : treeKind === 'volume' ? 'chain' : 'event';
  value.sequence ??= sequence;
  value.kind ??= root ? treeKind : childKind;
  // key、sequence、linkedTree 和缺省展示名是传输合同字段，不是文学判断。
  // 模型已交回完整剧情时由系统补齐这些确定性字段，不能因此再次调用模型
  // 重写整份方案。子节点缺少标题时使用中性序号，不从剧情文本猜测语义。
  value.title ??= root ? `${scopeId}` : `第${sequence}段推进`;
  if (value.key === undefined) {
    const linkedScope = isRecord(value.linkedTree) && typeof value.linkedTree.scopeId === 'string'
      ? value.linkedTree.scopeId
      : undefined;
    value.key = root ? scopeId : linkedScope ?? `${scopeId}:${childKind}:${sequence}`;
  }
  if (root && value.linkedTree === undefined) value.linkedTree = null;
  if (!root && childKind === 'event' && value.linkedTree === undefined) value.linkedTree = null;
  if (!root && value.children === undefined) value.children = [];
  if (isRecord(value.budget) && typeof value.budget.chapterRange === 'string') {
    const match = /^\s*(?:约)?\s*(?:第)?\s*(\d+)\s*(?:-|—|至)\s*(\d+)\s*(?:章)?\s*$/u.exec(value.budget.chapterRange);
    if (match !== null) value.budget.chapterRange = [Number(match[1]), Number(match[2])];
  }
  normalizeStringArrayField(value.story, 'majorEvents');
  normalizeStringArrayField(value.causality, 'causes');
  normalizeStringArrayField(value.causality, 'consequences');
  normalizeThreadArrayField(value.threads, 'foreshadowing');
  normalizeThreadArrayField(value.threads, 'openQuestions');
  if (Array.isArray(value.children)) value.children.forEach((child, index) => {
    normalizeNodeFormats(child, treeKind, scopeId, index + 1, false);
  });
}

/**
 * 这里只消除模型在 JSON 容器上的等价差异，不拆句、不补写也不判断剧情。
 * 单句与单项数组表达同一内容，统一后无需再次调用模型修复整份规划。
 */
function normalizeStringArrayField(parent: unknown, field: string): void {
  if (!isRecord(parent)) return;
  const value = parent[field];
  if (typeof value === 'string' && value.trim().length > 0) parent[field] = [value.trim()];
}

function normalizeThreadArrayField(parent: unknown, field: string): void {
  if (!isRecord(parent)) return;
  const value = parent[field];
  if (typeof value === 'string' && value.trim().length > 0) {
    parent[field] = [value.trim()];
    return;
  }
  if (!Array.isArray(value)) return;
  parent[field] = value.map((item) => {
    if (typeof item === 'string') return item.trim();
    if (!isRecord(item)) return item;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const question = typeof item.question === 'string' ? item.question.trim() : '';
    const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim() : '';
    const body = summary || answer;
    const heading = question || title;
    return heading && body ? `${heading}：${body}` : heading || body;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
