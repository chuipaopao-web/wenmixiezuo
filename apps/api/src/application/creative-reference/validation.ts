/** R209-B1 纯校验与Unicode计量。不截断、不静默丢内容。 */
import { AmbiguityError, BudgetError, ValidationError } from './errors.js';
import { ASSET_KINDS, CARD_AVAILABILITIES, REVISION_STATUSES, displayCodePrefix, type CardPayload, type LegacyRef, type RevisionStatus } from './types.js';

/** 准确Unicode字符数（码点），非UTF16 code unit：emoji/生僻中文不被低估。 */
export function countChars(text: string): number {
  return Array.from(text).length;
}

const DISPLAY_CODE_PATTERN = (kind: 'method' | 'reference') =>
  new RegExp(`^${displayCodePrefix(kind)}[0-9]{3,}$`, 'u');

export function validateDisplayCode(code: string, kind: 'method' | 'reference'): void {
  if (!DISPLAY_CODE_PATTERN(kind).test(code)) {
    throw new ValidationError(`展示编号格式无效（应为${displayCodePrefix(kind)}+至少三位数字）：${code}`);
  }
}

export function validateLegacyRef(legacy: LegacyRef): void {
  if (legacy.namespace.trim().length === 0 || legacy.key.trim().length === 0) {
    throw new ValidationError('legacy引用必须含非空命名空间与key。');
  }
  if (legacy.namespace.includes(':') || legacy.key.includes(':')) {
    throw new ValidationError('legacy命名空间与key不得包含冒号。');
  }
  if (legacy.version !== undefined && (!Number.isSafeInteger(legacy.version) || legacy.version < 1)) {
    throw new ValidationError('legacy版本必须为正整数。');
  }
}

const SHORT_PHRASE_MAX = 30;

export function validateShortPhrase(phrase: string): void {
  const n = countChars(phrase);
  if (n === 0) throw new ValidationError('shortPhrase不能为空；B1不自动生成短语。');
  if (n > SHORT_PHRASE_MAX) throw new ValidationError(`shortPhrase最多${SHORT_PHRASE_MAX}字符（当前${n}）。`);
}

export function validateSummary(summary: string): void {
  if (countChars(summary) === 0) throw new ValidationError('summary不能为空。');
  if (countChars(summary) > 500) throw new ValidationError('summary最多500字符。');
}

function validateStringArray(value: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(value)) throw new ValidationError(`${label}必须是数组。`);
  if (value.length > maxItems) throw new ValidationError(`${label}最多${maxItems}项。`);
  return value.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) throw new ValidationError(`${label}项必须为非空字符串。`);
    return item;
  });
}

/** assetKind与卡类型一致性：reference卡的payload.reference存在且method.payload.method存在。 */
export function validatePayload(payload: CardPayload): void {
  if (!ASSET_KINDS.includes(payload.assetKind)) throw new ValidationError('assetKind无效。');
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) throw new ValidationError('name不能为空。');
  validateShortPhrase(payload.shortPhrase);
  validateSummary(payload.summary);
  validateStringArray(payload.aliases, 'aliases', 20);
  if (payload.assetKind === 'reference') {
    const r = payload.reference;
    if (typeof r.kind !== 'string' || r.kind.trim().length === 0) throw new ValidationError('reference.kind不能为空。');
    for (const key of ['genres', 'mechanisms', 'experiences', 'purposes'] as const) {
      validateStringArray(r.facets[key], `facets.${key}`, 30);
    }
    validateStringArray(r.stages, 'stages', 10);
    validateStringArray(r.useWhen, 'useWhen', 20);
    if (!Array.isArray(r.examples)) throw new ValidationError('examples必须是数组。');
    if (!Array.isArray(r.methodRefs)) throw new ValidationError('methodRefs必须是数组。');
    if (r.evidence === null || typeof r.evidence !== 'object') throw new ValidationError('evidence必须存在。');
    if (!['editorial_heuristic', 'cited_research', 'observed_evaluation'].includes(r.evidence.kind)) {
      throw new ValidationError('evidence.kind无效。');
    }
  } else {
    const m = payload.method;
    if (countChars(m.title) === 0) throw new ValidationError('method.title不能为空。');
    if (countChars(m.instruction) === 0) throw new ValidationError('method.instruction不能为空。');
    if (countChars(m.usageTree) === 0) throw new ValidationError('method.usageTree不能为空。');
    validateStringArray(m.applicableLayers, 'method.applicableLayers', 10);
    if(m.relatedPurposes!==undefined) validateStringArray(m.relatedPurposes,'method.relatedPurposes',8);
    if(m.methodKind!==undefined&&!['technique','story_container','action_strategy','story_beat','combination','checklist'].includes(m.methodKind)) throw new ValidationError('方法类型无效。');
    if(m.conditionalUses!==undefined){
      if(!Array.isArray(m.conditionalUses)||m.conditionalUses.length>8)throw new ValidationError('条件用法最多8项。');
      const seen=new Set<string>();
      for(const item of m.conditionalUses){
        if(!item||!['opening','setting','book','volume','chain','chain_chapters','chapter','prose'].includes(item.stage)||seen.has(item.stage)||m.applicableLayers.includes(item.stage))throw new ValidationError('条件阶段重复、无效或与重点阶段重叠。');
        if(typeof item.condition!=='string'||!item.condition.trim()||item.condition.length>600||typeof item.use!=='string'||!item.use.trim()||item.use.length>1000)throw new ValidationError('条件用法必须包含简短触发条件和具体用法。');
        seen.add(item.stage);
      }
    }
    validateStringArray(m.aliases, 'method.aliases', 20);
  }
}

/** payload.assetKind与既有卡类型核对：不允许reference卡被method payload更新。 */
export function assertAssetKindMatches(payload: CardPayload, expected: 'method' | 'reference'): void {
  if (payload.assetKind !== expected) {
    throw new ValidationError(`payload.assetKind(${payload.assetKind})与卡类型(${expected})不一致。`);
  }
}

export function validateRevisionStatus(status: string): asserts status is RevisionStatus {
  if (!REVISION_STATUSES.includes(status as never)) throw new ValidationError(`revision状态无效：${status}`);
}

export function validateAvailability(status: string): asserts status is import('./types.js').CardAvailability {
  if (!CARD_AVAILABILITIES.includes(status as never)) throw new ValidationError(`可用状态无效：${status}`);
}

export function validateRevisionNumber(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new ValidationError('revision必须为正整数。');
}

/**
 * revision状态转换：draft→reviewed（需reviewActor）→published（发布批次打标，不可跳级）。
 * published内容不可变；retired不是revision状态（落在卡可用状态）。
 */
export function validateRevisionTransition(from: RevisionStatus, to: RevisionStatus, reviewActor: string | null): void {
  if (from === to) throw new ValidationError(`revision状态未变化：${from}。`);
  if (from === 'published') throw new ValidationError('已发布revision不可覆盖；修改创建新revision。');
  if (from === 'draft' && to === 'published') throw new ValidationError('draft必须先审核（reviewed）再发布，不能跳级。');
  if (to === 'reviewed') {
    if (reviewActor === null || reviewActor.trim().length === 0) throw new ValidationError('审核必须有reviewActor证据。');
  }
}

/** 投影字符预算：超限抛BudgetError让上层缩请求，不截断关键约束。 */
export function enforceBudget(text: string, budget: number, label: string): string {
  const n = countChars(text);
  if (n > budget) {
    throw new BudgetError(`${label}为${n}字符，超出预算${budget}；请缩小请求范围（如减少条目或改用引用投影），不会截断内容。`);
  }
  return text;
}

export function assertSingleAliasHit<T extends { matchedAlias: string }>(hits: T[], alias: string): T {
  if (hits.length > 1) {
    throw new AmbiguityError(`别名“${alias}”命中${hits.length}个条目，不能近似替换；请改用displayCode或明确命名空间。`, hits);
  }
  return hits[0]!;
}
