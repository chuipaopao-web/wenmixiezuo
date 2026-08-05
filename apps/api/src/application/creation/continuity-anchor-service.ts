export interface ChapterContinuityAnchors {
  exactFields: Record<string, string[]>;
  identifiers: string[];
  namedTerms: string[];
}

export interface ChapterContinuityConflict {
  field: string;
  expected: string[];
  actual: string[];
  excerpt: string;
}

export interface ChapterContinuityCheck {
  passed: boolean;
  conflicts: ChapterContinuityConflict[];
}

const FIELD_NAMES = [
  '库位编号', '物品编号', '档案编号', '案件编号', '单据编号', '记录编号',
  '合同编号', '任务编号', '设备编号', '道具编号', '技能编号', '订单号',
  '批次号', '临时账号', '账号', '封存袋编号', '物证袋编号', '证物编号',
  '材料编号', '回执编号', '申请编号', '工号', '门牌号', '房间号', '车牌号', '坐标'
] as const;

const FIELD_PATTERN = new RegExp(
  `(${[...FIELD_NAMES].sort((left, right) => right.length - left.length).join('|')})(?:栏)?\\s*(?:写着|显示|登记为|记为|为|是|[:：])?\\s*[“”"'「」『』【】]*([A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)+)`,
  'giu'
);
const IDENTIFIER_PATTERN = /\b(?=[A-Za-z0-9_/-]{4,40}\b)(?=[A-Za-z0-9_/-]*[A-Za-z])(?=[A-Za-z0-9_/-]*\d)[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)+\b/gu;
const NAMED_TERM_PATTERN = /[\u3400-\u9fff]{2,12}(?:中心|公司|学校|大学|医院|研究所|实验室|事务所|协会|基金会|委员会|管理局|分局|村|镇|县|城|宫|塔|宗|门|派)/gu;
const CONTINUATION_HINT = /这|该|同一|对应|刚才|此前|之前|前述|上一章|昨晚|昨天|原来|仍|还是|就是|那(?:条|个|件|份|张)/u;
const EXPLICIT_CHANGE_HINT = /另一|另一个|另外|新增|新(?:的|一)?|第二|改为|更正|修正|转移|搬到|换到|改放|重新分配|原.{0,16}(?:错误|有误)|不是同一/u;
const EXPLICIT_IDENTIFIER_MAPPING = /(?:明确)?沿用.{0,20}(?:账号|编号)|(?:账号|编号).{0,20}(?:明确)?沿用|同时作为|一号两用|共用同一|与.{0,12}(?:编号|账号)相同/u;

export function buildChapterContinuityAnchors(content: string): ChapterContinuityAnchors {
  const exactFields: Record<string, string[]> = {};
  for (const match of content.matchAll(FIELD_PATTERN)) {
    const field = match[1]!;
    const value = normalizeIdentifier(match[2]!);
    exactFields[field] = uniqueBounded([...(exactFields[field] ?? []), value], 6);
  }
  const identifiers = uniqueBounded(
    [...content.matchAll(IDENTIFIER_PATTERN)].map((match) => normalizeIdentifier(match[0])),
    24
  );
  const namedTerms = uniqueBounded([...content.matchAll(NAMED_TERM_PATTERN)].map((match) => match[0]), 16);
  return { exactFields, identifiers, namedTerms };
}

export function checkChapterContinuityAnchors(
  content: string,
  previous: ChapterContinuityAnchors | null | undefined
): ChapterContinuityCheck {
  if (previous === null || previous === undefined) return { passed: true, conflicts: [] };
  const current = buildChapterContinuityAnchors(content);
  const conflicts: ChapterContinuityConflict[] = [];
  for (const [field, expected] of Object.entries(previous.exactFields)) {
    const actual = current.exactFields[field] ?? [];
    if (actual.length === 0 || actual.some((value) => expected.includes(value))) continue;
    const unexplained = actual.filter((value) => {
      const index = content.toUpperCase().indexOf(value.toUpperCase());
      if (index < 0) return false;
      const excerpt = content.slice(Math.max(0, index - 140), Math.min(content.length, index + value.length + 80));
      return CONTINUATION_HINT.test(excerpt) && !EXPLICIT_CHANGE_HINT.test(excerpt);
    });
    if (unexplained.length === 0) continue;
    const index = content.toUpperCase().indexOf(unexplained[0]!.toUpperCase());
    conflicts.push({
      field,
      expected,
      actual: unexplained,
      excerpt: content.slice(Math.max(0, index - 80), Math.min(content.length, index + unexplained[0]!.length + 80))
    });
  }
  for (const [currentField, actualValues] of Object.entries(current.exactFields)) {
    const currentKind = identifierKind(currentField);
    for (const value of actualValues) {
      const previousFields = Object.entries(previous.exactFields)
        .filter(([, values]) => values.includes(value))
        .map(([field]) => field);
      if (previousFields.length === 0 || previousFields.some((field) => identifierKind(field) === currentKind)) continue;
      const index = content.toUpperCase().indexOf(value.toUpperCase());
      if (index < 0) continue;
      const excerpt = content.slice(Math.max(0, index - 140), Math.min(content.length, index + value.length + 100));
      if (EXPLICIT_IDENTIFIER_MAPPING.test(excerpt)) continue;
      conflicts.push({ field: 'identifier_kind', expected: previousFields, actual: [currentField], excerpt });
    }
  }
  return { passed: conflicts.length === 0, conflicts };
}

function identifierKind(field: string): 'account' | 'object' | 'document' | 'location' | 'other' {
  if (/账号/u.test(field)) return 'account';
  if (/(?:物品|道具|封存袋|物证袋|证物|材料)编号/u.test(field)) return 'object';
  if (/(?:档案|案件|单据|记录|合同|任务|订单|批次|回执|申请)/u.test(field)) return 'document';
  if (/(?:库位|门牌|房间|车牌|坐标)/u.test(field)) return 'location';
  return 'other';
}

export function compactChapterContinuityAnchors(anchors: ChapterContinuityAnchors): string {
  return JSON.stringify({
    exactFields: anchors.exactFields,
    identifiers: anchors.identifiers,
    namedTerms: anchors.namedTerms
  });
}

export function parseChapterContinuityAnchors(stateJson: string): ChapterContinuityAnchors | null {
  try {
    const parsed = JSON.parse(stateJson) as { continuityAnchors?: unknown };
    if (!isRecord(parsed.continuityAnchors)) return null;
    const exactFields = isRecord(parsed.continuityAnchors.exactFields)
      ? Object.fromEntries(Object.entries(parsed.continuityAnchors.exactFields)
          .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((value) => typeof value === 'string')))
      : {};
    return {
      exactFields,
      identifiers: stringArray(parsed.continuityAnchors.identifiers),
      namedTerms: stringArray(parsed.continuityAnchors.namedTerms)
    };
  } catch {
    return null;
  }
}

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

function uniqueBounded(values: string[], maximum: number): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].slice(0, maximum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
