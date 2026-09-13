/** R209-B1 纯校验与Unicode计量。不截断、不静默丢内容。 */
import { AmbiguityError, BudgetError, ValidationError } from './errors.js';
import { ASSET_KINDS, CARD_STATUSES, displayCodePrefix, type CardPayload, type LegacyRef } from './types.js';

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
}

const SHORT_PHRASE_MAX = 30;

/** B1不调用AI写短语：内容必须由调用方提供经审核的shortPhrase（建议4—12汉字，上限30字符）。 */
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

/** 校验整份payload。schema不裁内容分类学（kind自由字符串），但强制结构与边界。 */
export function validatePayload(payload: CardPayload): void {
  if (!ASSET_KINDS.includes(payload.assetKind)) throw new ValidationError('assetKind无效。');
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) throw new ValidationError('name不能为空。');
  validateShortPhrase(payload.shortPhrase);
  validateSummary(payload.summary);
  validateStringArray(payload.aliases, 'aliases', 20);
  if (payload.assetKind === 'reference') {
    const r = payload.reference;
    if (typeof r.kind !== 'string' || r.kind.trim().length === 0) throw new ValidationError('reference.kind不能为空。');
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
    validateStringArray(m.applicableLayers, 'method.applicableLayers', 10);
    validateStringArray(m.aliases, 'method.aliases', 20);
  }
}

export function validateStatusTransition(from: string, to: string): void {
  if (!CARD_STATUSES.includes(to as never)) throw new ValidationError(`状态无效：${to}`);
  if (from === 'retired') throw new ValidationError('已退役条目不能变更状态；退役不回收编号。');
}

/** 投影字符预算：超限抛BudgetError让上层缩请求，不截断关键约束。 */
export function enforceBudget(text: string, budget: number, label: string): string {
  const n = countChars(text);
  if (n > budget) {
    throw new BudgetError(`${label}为${n}字符，超出预算${budget}；请缩小请求范围（如减少条目或改用引用投影），不会截断内容。`);
  }
  return text;
}

/** 别名歧义检测：多个候选命中同一别名时返回ambiguity（由服务层转换）。 */
export function assertSingleAliasHit<T extends { matchedAlias: string }>(hits: T[], alias: string): T {
  if (hits.length > 1) {
    throw new AmbiguityError(`别名“${alias}”命中${hits.length}个条目，不能近似替换；请改用displayCode或明确命名空间。`, hits);
  }
  return hits[0]!;
}
