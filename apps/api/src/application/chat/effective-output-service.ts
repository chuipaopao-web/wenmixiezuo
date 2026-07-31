import { createHash } from 'node:crypto';
import { sanitizeAuthorFacingConversationText } from './author-conversation-presentation.js';

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
    details: '可展开的补充依据；只能使用作者能理解的产品术语，不得写内部字段名、追溯编号、校验值或内部思维链，没有则为null',
    workflowArtifact: '仅当任务明确要求机器落库时填写；对象格式为type和payload。普通讨论省略该字段'
  },
  rules: [
    '只输出一个JSON对象，不要代码围栏、开场客套、自我介绍、过程说明或重复老板原话',
    '不要重复同一结论；事实、风险、未知、异议和需要确认的重大选择不得省略',
    '字段只写最终结论、依据和可展示说明，不输出内部思维链、后台字段名、资料编号或校验值'
  ]
} as const;

export function prepareEffectiveOutput(raw: string): EffectiveOutputResult {
  const normalizedRaw = normalizeText(raw);
  const structured = parseStructuredReply(normalizedRaw) ?? parseTruncatedStructuredReply(normalizedRaw);
  if (structured !== null) {
    const visibleContent = sanitizeAuthorFacingConversationText(renderStructuredReply(structured, false));
    const fullContent = sanitizeAuthorFacingConversationText(renderStructuredReply(structured, true));
    return {
      visibleContent,
      fullContent,
      filtered: normalizeText(raw) !== visibleContent || fullContent !== visibleContent,
      format: 'structured'
    };
  }

  const cleaned = removeOnlyCertainNoise(normalizedRaw);
  const fallbackContent = cleaned.length > 0 ? cleaned : normalizedRaw;
  const visibleContent = looksLikeMachinePayload(fallbackContent)
    ? '这次回复的格式不适合直接展示，我已经把内部杂乱内容拦下了。请继续追问，我会重新整理成清楚的结论。'
    : sanitizeAuthorFacingConversationText(fallbackContent);
  return {
    visibleContent,
    fullContent: sanitizeAuthorFacingConversationText(normalizedRaw),
    filtered: visibleContent !== normalizedRaw,
    format: 'fallback'
  };
}

function parseTruncatedStructuredReply(raw: string): StructuredEffectiveReply | null {
  if (!isUnclosedJsonObject(raw)) return null;
  const answer = nonEmptyString(extractCompleteJsonProperty(raw, 'answer'));
  if (answer === null) return null;

  const keyPoints = completedStringList(raw, 'keyPoints');
  const alternatives = completedAlternativeList(raw, 'alternatives');
  const risks = completedStringList(raw, 'risks');
  const questions = completedStringList(raw, 'questions');
  const nextStep = optionalString(extractCompleteJsonProperty(raw, 'nextStep'));
  const details = optionalDetails(extractCompleteJsonProperty(raw, 'details'));

  return {
    answer,
    keyPoints: keyPoints ?? [],
    alternatives: alternatives ?? [],
    risks: risks ?? [],
    questions: questions ?? [],
    nextStep: nextStep === undefined ? null : nextStep,
    details: details === undefined ? null : details
  };
}

function completedStringList(raw: string, key: string): string[] | null {
  const value = extractCompleteJsonProperty(raw, key);
  if (value === undefined) return null;
  return stringList(value, MAX_LIST_ITEMS);
}

function completedAlternativeList(raw: string, key: string): EffectiveAlternative[] | null {
  const value = extractCompleteJsonProperty(raw, key);
  if (value === undefined) return null;
  return alternativeList(value);
}

function isUnclosedJsonObject(raw: string): boolean {
  const value = unwrapJsonFence(raw).trim();
  if (!value.startsWith('{')) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
  }
  return depth > 0 || inString;
}

function extractCompleteJsonProperty(raw: string, key: string): unknown {
  const value = unwrapJsonFence(raw);
  const marker = new RegExp(`"${escapeRegExp(key)}"\\s*:`, 'u');
  const markerIndex = value.search(marker);
  if (markerIndex < 0) return undefined;
  const markerText = value.slice(markerIndex).match(marker)?.[0];
  if (markerText === undefined) return undefined;
  let start = markerIndex + markerText.length;
  while (start < value.length && /\s/u.test(value[start]!)) start += 1;
  if (start >= value.length) return undefined;

  const first = value[start]!;
  if (first === '"') {
    let escaped = false;
    for (let index = start + 1; index < value.length; index += 1) {
      const char = value[index]!;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') return parseJsonValue(value.slice(start, index + 1));
    }
    return undefined;
  }

  if (first === '[' || first === '{') {
    const opening = first;
    const closing = opening === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === opening) depth += 1;
      else if (char === closing) {
        depth -= 1;
        if (depth === 0) return parseJsonValue(value.slice(start, index + 1));
      }
    }
    return undefined;
  }

  const primitiveEnd = value.slice(start).search(/[,}]/u);
  const candidate = primitiveEnd < 0 ? value.slice(start) : value.slice(start, start + primitiveEnd);
  return parseJsonValue(candidate.trim());
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function createEffectiveOutputReference(result: EffectiveOutputResult): EffectiveOutputReference | null {
  // 非结构化回退保留在内部调用记录中，不再把原始协议或混杂输出作为作者可展开内容。
  if (result.format !== 'structured') return null;
  const fullContent = normalizeText(result.fullContent);
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
  for (const candidate of structuredJsonCandidates(raw)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    // 双形态白名单解析。兼容根级对象和合同版本化包装对象；包装只允许版本1的对象字段。
    const fields = unwrapContractFields(value);
    if (fields === null) continue;
    const answer = nonEmptyString(fields.answer);
    if (answer === null) continue;
    const keyPoints = stringList(fields.keyPoints, MAX_LIST_ITEMS);
    const risks = stringList(fields.risks, MAX_LIST_ITEMS);
    const questions = stringList(fields.questions, MAX_LIST_ITEMS);
    const alternatives = alternativeList(fields.alternatives);
    const nextStep = optionalString(fields.nextStep);
    const details = optionalDetails(fields.details);
    if ([keyPoints, risks, questions, alternatives].some((item) => item === null) || nextStep === undefined || details === undefined) {
      continue;
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
  return null;
}

function structuredJsonCandidates(raw: string): string[] {
  const direct = unwrapJsonFence(raw);
  const candidates = [direct, repairUnescapedJsonQuotes(direct)];

  // 模型偶尔会在结构化答复前后附加岗位意见或“规划落库”。使用字符串感知的括号扫描，
  // 只抽取完整 JSON 对象；不使用贪婪正则，避免嵌套对象、转义引号导致截断。
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          const object = raw.slice(start, index + 1);
          candidates.push(object, repairUnescapedJsonQuotes(object));
          start = index;
          break;
        }
      }
    }
  }
  return candidates;
}

function repairUnescapedJsonQuotes(value: string): string {
  let inString = false;
  let escaped = false;
  let repaired = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (!inString) {
      if (char === '"') inString = true;
      repaired += char;
      continue;
    }
    if (escaped) {
      escaped = false;
      repaired += char;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      repaired += char;
      continue;
    }
    if (char !== '"') {
      repaired += char;
      continue;
    }
    let nextIndex = index + 1;
    while (nextIndex < value.length && /\s/u.test(value[nextIndex]!)) nextIndex += 1;
    const next = value[nextIndex];
    // JSON 字段名或字符串值的合法结束引号，后面只能接冒号、逗号、容器结束或文本结束。
    // 其他位置的裸引号是模型在中文句子里误用的强调引号，转义后再按合同解析。
    if (next === ':' || next === ',' || next === '}' || next === ']' || next === undefined) {
      inString = false;
      repaired += char;
    } else {
      repaired += '\\"';
    }
  }
  return repaired;
}

function unwrapContractFields(value: Record<string, unknown>): Record<string, unknown> | null {
  // 根级对象（无合同包装键）：直接作为字段源，保持对历史根级输出的兼容。
  if (value.version === undefined && value.format === undefined && value.fields === undefined) {
    return value;
  }
  // 版本化包装对象：只允许 version=1、format=json_object、fields 为对象。
  if (value.version !== 1 || value.format !== 'json_object') return null;
  const fields = value.fields;
  return isRecord(fields) ? fields : null;
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

function looksLikeMachinePayload(value: string): boolean {
  const text = value.trim();
  if (/^```(?:json)?\s*/iu.test(text)) return true;
  if (/^[\[{][\s\S]*[\]}]$/u.test(text)) return true;
  return /\\?"(?:version|format|fields|answer|title|goal|beats|hook)\\?"\s*:/iu.test(text)
    || /(?:规划落库|content_json|projection_id|source_ids_json)/iu.test(text);
}

function unwrapJsonFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1]?.trim() ?? value;
}

function stringList(value: unknown, maxItems: number): string[] | null {
  if (value === undefined) return [];
  if (typeof value === 'string' && value.trim().length > 0) return [value.trim()];
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

function optionalDetails(value: unknown): string | null | undefined {
  const scalar = optionalString(value);
  if (scalar !== undefined) return scalar;
  if (!isRecord(value)) return undefined;
  const lines: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    if (key.length === 0 || /^(?:internalReasoning|reasoning|thought|chainOfThought|rules|process)$/iu.test(key)) continue;
    if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
      lines.push(`${key}：${rawValue.trim()}`);
      continue;
    }
    if (Array.isArray(rawValue)) {
      const values = rawValue.map(nonEmptyString);
      if (!values.some((item) => item === null) && values.length > 0) {
        lines.push(`${key}：${(values as string[]).join('；')}`);
      }
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
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
