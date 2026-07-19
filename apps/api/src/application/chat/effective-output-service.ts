import { createHash } from 'node:crypto';

interface EffectiveAlternative {
  title: string;
  content: string;
  tradeoff?: string;
}

interface StructuredEffectiveReply {
  answer: string;
  keyPoints: string[];
  alternatives: EffectiveAlternative[];
  risks: string[];
  questions: string[];
  nextStep: string | null;
  details: string | null;
}

export interface EffectiveOutputResult {
  visibleContent: string;
  fullContent: string;
  filtered: boolean;
  format: 'structured' | 'fallback';
}

export interface EffectiveOutputReference {
  type: 'effective_output';
  version: 1;
  format: EffectiveOutputResult['format'];
  fullContent: string;
  contentHash: string;
}

const MAX_LIST_ITEMS = 8;
const EMPTY_OPENING_LINES = /^(?:好的|好|收到|明白|了解|当然可以|没问题|可以)[！!。.　\s]*$/u;
const PROCESS_LINES = /^(?:下面|接下来)(?:我|我们)?(?:将|会)?(?:从|分为|围绕).{0,40}(?:分析|说明|展开|回答)[：:！!。.　\s]*$/u;

export const EFFECTIVE_OUTPUT_CONTRACT = {
  version: 1,
  format: 'json_object',
  fields: {
    answer: '直接回答老板的核心结论，使用自然中文',
    keyPoints: '最多3条决定结论的关键依据；没有则为空数组',
    alternatives: '仅在确有不同方向时提供，元素为title/content/tradeoff；必须保留结构不同的高潜少数方案',
    risks: '事实冲突、代价、不确定项或资料缺口；不得为了简短而隐藏',
    questions: '只有继续工作确实需要时才问，最多3个',
    nextStep: '一项可执行下一步；没有则为null',
    details: '可展开的补充证据与来源说明；不得写内部思维链，没有则为null'
  },
  rules: [
    '只输出一个JSON对象，不要代码围栏、开场客套、自我介绍、过程说明或重复老板原话',
    '不要重复同一结论；事实、风险、未知、异议和需要确认的重大选择不得省略',
    '字段只写最终结论、依据和可展示说明，不输出内部思维链'
  ]
} as const;

export function prepareEffectiveOutput(raw: string): EffectiveOutputResult {
  const normalizedRaw = normalizeText(raw);
  const structured = parseStructuredReply(normalizedRaw);
  if (structured !== null) {
    const visibleContent = renderStructuredReply(structured, false);
    const fullContent = renderStructuredReply(structured, true);
    return {
      visibleContent,
      fullContent,
      filtered: normalizeText(raw) !== visibleContent || fullContent !== visibleContent,
      format: 'structured'
    };
  }

  const cleaned = removeOnlyCertainNoise(normalizedRaw);
  const visibleContent = cleaned.length > 0 ? cleaned : normalizedRaw;
  return {
    visibleContent,
    fullContent: normalizedRaw,
    filtered: visibleContent !== normalizedRaw,
    format: 'fallback'
  };
}

export function createEffectiveOutputReference(
  result: EffectiveOutputResult,
  fullContentOverride?: string
): EffectiveOutputReference | null {
  const fullContent = normalizeText(fullContentOverride ?? result.fullContent);
  if (fullContent.length === 0 || fullContent === normalizeText(result.visibleContent)) return null;
  return {
    type: 'effective_output',
    version: 1,
    format: result.format,
    fullContent,
    contentHash: createHash('sha256').update(fullContent).digest('hex')
  };
}

function parseStructuredReply(raw: string): StructuredEffectiveReply | null {
  const candidate = unwrapJsonFence(raw);
  let value: unknown;
  try {
    value = JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const answer = nonEmptyString(value.answer);
  if (answer === null) return null;
  const keyPoints = stringList(value.keyPoints, 3);
  const risks = stringList(value.risks, MAX_LIST_ITEMS);
  const questions = stringList(value.questions, 3);
  const alternatives = alternativeList(value.alternatives);
  const nextStep = optionalString(value.nextStep);
  const details = optionalString(value.details);
  if ([keyPoints, risks, questions, alternatives].some((item) => item === null) || nextStep === undefined || details === undefined) {
    return null;
  }
  return {
    answer,
    keyPoints: keyPoints!,
    alternatives: alternatives!,
    risks: risks!,
    questions: questions!,
    nextStep,
    details
  };
}

function renderStructuredReply(reply: StructuredEffectiveReply, includeDetails: boolean): string {
  const sections = [reply.answer];
  appendList(sections, '关键依据', reply.keyPoints);
  if (reply.alternatives.length > 0) {
    sections.push(`可选方向：\n${reply.alternatives.map((alternative) => {
      const tradeoff = alternative.tradeoff === undefined ? '' : `；代价：${alternative.tradeoff}`;
      return `- ${alternative.title}：${alternative.content}${tradeoff}`;
    }).join('\n')}`);
  }
  appendList(sections, '风险与未知', reply.risks);
  appendList(sections, '需要确认', reply.questions);
  if (reply.nextStep !== null) sections.push(`下一步：${reply.nextStep}`);
  if (includeDetails && reply.details !== null) sections.push(`完整依据：\n${reply.details}`);
  return sections.join('\n\n');
}

function appendList(sections: string[], title: string, values: string[]): void {
  if (values.length === 0) return;
  sections.push(`${title}：\n${values.map((value) => `- ${value}`).join('\n')}`);
}

function removeOnlyCertainNoise(raw: string): string {
  const paragraphs = raw.split(/\n\s*\n/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    if (EMPTY_OPENING_LINES.test(paragraph) || PROCESS_LINES.test(paragraph)) continue;
    const key = paragraph.replace(/\s+/gu, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(paragraph);
  }
  return kept.join('\n\n');
}

function unwrapJsonFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1]?.trim() ?? value;
}

function stringList(value: unknown, maxItems: number): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const values = value.map(nonEmptyString);
  return values.some((item) => item === null) ? null : values as string[];
}

function alternativeList(value: unknown): EffectiveAlternative[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) return null;
  const alternatives: EffectiveAlternative[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const title = nonEmptyString(item.title);
    const content = nonEmptyString(item.content);
    const tradeoff = optionalString(item.tradeoff);
    if (title === null || content === null || tradeoff === undefined) return null;
    alternatives.push({ title, content, ...(tradeoff === null ? {} : { tradeoff }) });
  }
  return alternatives;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
