import type { ContextSource } from '../memory/context-pack-service.js';

const PUBLIC_SOURCE_NAMES: Record<string, string> = {
  boss_message: '老板当前消息',
  onboarding_trigger: '建书后的接待要求',
  opening_blueprint: '本书资料',
  story_bible: '当前设定大纲',
  recent_conversation: '最近对话',
  confirmed_decisions: '最近确认的创作决定',
  creative_blackboard: '当前讨论状态',
  fact: '相关已确认事实',
  manuscript: '相关正文',
  outline: '相关规划',
  setting: '相关设定',
  wiki: '相关资料关系',
  voice: '相关人物表达参考'
};

const PUBLIC_FIELD_LABELS: Record<string, string> = {
  title: '书名',
  channel: '频道',
  categoryKey: '主分类',
  category: '主分类',
  mainTags: '主要标签',
  auxiliaryTags: '辅助题材',
  storyTraits: '作品特点',
  customTags: '自定义标签',
  storyDirection: '故事方向',
  worldBackground: '世界背景',
  openingBackground: '开篇背景',
  fullBookOutline: '全书梗概',
  initialMap: '初始地图',
  mustFollow: '必须遵守',
  protagonists: '初始主角',
  name: '姓名',
  role: '身份',
  age: '年龄或阶段',
  background: '人物背景',
  personalities: '性格',
  premise: '核心前提',
  genre: '题材',
  audience: '读者方向',
  theme: '主题',
  worldRules: '世界规则',
  characters: '人物',
  mainPlot: '剧情方向',
  currentGoal: '当前议题',
  candidates: '候选方向',
  disagreements: '分歧',
  unknowns: '未知项',
  nextStep: '下一步',
  scope_text: '讨论范围',
  recommendation_json: '确认内容'
};

const OMITTED_MODEL_FIELDS = new Set([
  'schema', 'version', 'sourceStatus', 'source_status', 'authority',
  'storyDirectionAuthority', 'decision_id', 'created_at', 'updated_at',
  'sender_type', 'role_key'
]);

export interface AuthorModelContextSource {
  name: string;
  purpose: string;
  content: string;
}

/**
 * 规划按钮会把结构化资料包作为老板消息提交，供确定性路由和创作任务使用。
 * 资料包需要完整留在审计记录中，但不应作为聊天正文展示给作者，也不应在
 * 后续“最近对话”里被重复注入。这里仅生成作者当时真正发起的简短请求。
 */
export function projectBossMessageForAuthor(value: string): string {
  const text = value.replace(/\r\n?/gu, '\n').trim();

  if (/^(?:讨论设定\s+)?【设定专项讨论资料包】/u.test(text)) {
    const item = packetLine(text, '当前设定项');
    return item === null ? '请继续完善本书的设定大纲。' : `请讨论设定：${item}。`;
  }

  if (/^(?:讨论设定\s+)?【设定大纲成组讨论资料包】/u.test(text)) {
    const labels = packetItemLabels(text, '本批设定项JSON');
    return labels.length === 0
      ? '请集中完善当前尚未确认的设定。'
      : `请集中讨论这些设定：${labels.join('、')}。`;
  }

  if (/^(?:讨论(?:剧情)?总纲\s+)?【剧情总纲专项讨论资料包】/u.test(text)) {
    return '请讨论并完善当前阶段的剧情大纲。';
  }

  if (/^【(?:续写诊断|已有正文设定整理)资料包】/u.test(text)) {
    return '请依据已导入正文和反向章纲，从第一项开始整理设定大纲。';
  }

  return text;
}

export function sanitizeAuthorFacingConversationText(value: string): string {
  let text = value.replace(/\r\n?/gu, '\n');
  text = text.replace(
    /故事圣经\s*(?:sourceId|source_id)\s*[:：]\s*[A-Za-z0-9_-]+\s*的?\s*premise\s*(?:原文)?/giu,
    '现有设定大纲中的核心前提'
  );
  text = text.replace(/故事圣经\s*(?:中的?|里(?:的)?)?\s*premise/giu, '设定大纲中的核心前提');
  text = text.replace(/\bstory_bible\b/giu, '设定大纲');
  text = text.replace(/故事圣经/gu, '设定大纲');
  // 旧回复有时会把“故事圣经”简写为“圣经”。只在明确的规划语境中转换，
  // 避免将小说正文里真正的宗教书籍名称误改。
  text = text.replace(/圣经(?=中|里|版本|核心前提|premise)/giu, '设定大纲');
  text = text.replace(/\bpremise\b/giu, '核心前提');
  text = text.replace(/\bconfirmed_decisions\s*(?:为|是|=)?\s*(?:空|\[\s*\])/giu, '目前还没有正式确认的讨论结论');
  text = text.replace(/\bconfirmed_decisions\b/giu, '已确认的讨论结论');
  text = text.replace(/\b(?:sourceId|source_id)\s*[:：=]\s*[A-Za-z0-9_-]+/giu, '来源记录');
  text = text.replace(/\bcontextPackHash\s*[:：=]\s*[A-Za-z0-9_-]+/giu, '资料包校验记录');
  text = text.replace(/\bmustFollow\b/gu, '必须遵守');
  text = text.replace(/\bfullBookOutline\b/gu, '全书梗概');
  text = text.replace(/\bstageOne\b/gu, '第一阶段');
  text = text.replace(/\bopeningReference\b/gu, '开书参考');
  // 这些句子来自旧版资料包把未确认规划误标为正史。只修正已知句式，
  // 不会隐藏基于正式正史证据得出的真实冲突。
  text = text.replace(/正史冲突必须解决/gu, '规划差异需要先确认');
  text = text.replace(/当前正史版本无法并存/gu, '当前规划表述不能同时成立');
  text = text.replace(
    /更新设定大纲中的核心前提为统一正史版本/gu,
    '按老板确认的版本更新设定大纲中的核心前提'
  );
  text = text.replace(
    /目前还没有正式确认的讨论结论，说明此前无正式确认决定落库。?/gu,
    '此前没有可直接沿用的正式决定。'
  );
  return text.trim();
}

export function renderSettingOutlineContext(raw: string, maximum = 1_500): string {
  const parsed = parseRecord(raw);
  if (parsed === null) return clip(sanitizeAuthorFacingConversationText(raw), maximum);

  const lines = [
    '资料名称：当前设定大纲',
    '资料性质：规划参考，不是正史；内容可以继续讨论和修订，老板本轮明确说明优先。'
  ];
  appendPublicField(lines, '书名', parsed.title);
  if (isRecord(parsed.positioning)) {
    for (const [key, value] of Object.entries(parsed.positioning)) {
      const label = PUBLIC_FIELD_LABELS[key];
      if (label !== undefined) appendPublicField(lines, label, unwrapValue(value));
    }
  }
  appendPublicField(lines, '主要标签', parsed.tags);
  appendPublicField(lines, '主题', unwrapValue(parsed.theme));
  appendPublicField(lines, '世界规则', parsed.worldRules);
  appendPublicField(lines, '人物', parsed.characters);
  appendPublicField(lines, '剧情方向', unwrapValue(parsed.mainPlot));
  if (isRecord(parsed.openingReference)) {
    const opening = parsed.openingReference;
    appendPublicField(lines, '故事方向', opening.storyDirection);
    appendPublicField(lines, '世界背景', opening.worldBackground);
    appendPublicField(lines, '开篇背景', opening.openingBackground);
    appendPublicField(lines, '第一阶段', opening.stageOne);
    appendPublicField(lines, '全书梗概', opening.fullBookOutline);
    appendPublicField(lines, '初始地图', opening.initialMap);
    appendPublicField(lines, '必须遵守', opening.mustFollow);
  }
  return clip(lines.join('\n'), maximum);
}

export function renderModelContextContent(sourceType: string, raw: string, maximum: number): string {
  if (sourceType === 'story_bible') return renderSettingOutlineContext(raw, maximum);
  if (sourceType === 'recent_conversation') return renderRecentConversation(raw, maximum);
  const parsed = parseJson(raw);
  if (parsed === undefined) return clip(sanitizeAuthorFacingConversationText(raw), maximum);
  const lines: string[] = [];
  flattenPublicValue(parsed, lines, 0);
  const rendered = lines.length > 0 ? lines.join('\n') : sanitizeAuthorFacingConversationText(raw);
  return clip(rendered, maximum);
}

function renderRecentConversation(raw: string, maximum: number): string {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return clip(sanitizeAuthorFacingConversationText(raw), maximum);
  const lines = parsed.flatMap((item) => {
    if (!isRecord(item) || typeof item.content !== 'string') return [];
    const speaker = item.sender_type === 'boss'
      ? '老板'
      : item.sender_type === 'system' || item.sender_type === 'local_tool'
        ? '小文秘书'
        : typeof item.role_key === 'string'
          ? publicRoleTitle(item.role_key)
          : '创作成员';
    const sourceContent = item.sender_type === 'boss'
      ? projectBossMessageForAuthor(item.content)
      : item.content;
    const content = sanitizeAuthorFacingConversationText(sourceContent);
    return content.length === 0 ? [] : [`${speaker}：${content}`];
  });
  return clip(lines.join('\n'), maximum);
}

function packetLine(text: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = text.match(new RegExp(`(?:^|\\n)${escaped}[：:]\\s*([^\\n]+)`, 'u'));
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function packetItemLabels(text: string, label: string): string[] {
  const raw = packetLine(text, label);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => (
      isRecord(item) && typeof item.label === 'string' && item.label.trim().length > 0
        ? [item.label.trim()]
        : []
    )).slice(0, 6);
  } catch {
    return [];
  }
}

export function toAuthorModelContextSources(sources: ContextSource[]): AuthorModelContextSource[] {
  return sources.map((source) => ({
    name: PUBLIC_SOURCE_NAMES[source.sourceType] ?? '相关创作资料',
    purpose: publicSourcePurpose(source.sourceType),
    content: renderModelContextContent(source.sourceType, source.content, source.content.length)
  }));
}

export function publicRoleTitle(roleKey: string): string {
  const names: Record<string, string> = {
    chief_editor: '主编', deputy_editor: '副编', plot_writer_a: '编剧', plot_writer_b: '编剧',
    setting_editor: '设定', lead_writer: '主笔', deputy_writer: '副笔', literary_reviewer: '审校',
    experience_reviewer: '体验', researcher: '研究', copyright_reviewer: '版权'
  };
  return names[roleKey] ?? '创作成员';
}

function publicSourcePurpose(sourceType: string): string {
  if (sourceType === 'story_bible') return '用于核对当前规划；它可以修订，不得称为正史。';
  if (sourceType === 'opening_blueprint') return '用于理解老板建书时确认的方向和边界。';
  if (sourceType === 'confirmed_decisions') return '用于遵守老板已经明确确认的创作决定。';
  if (sourceType === 'recent_conversation') return '用于衔接当前话题，避免重复询问。';
  if (sourceType === 'creative_blackboard') return '用于继续当前讨论；它不是正史。';
  if (sourceType === 'boss_message' || sourceType === 'onboarding_trigger') return '这是本轮必须直接回应的内容。';
  return '仅在与本轮问题直接相关时使用。';
}

function flattenPublicValue(value: unknown, lines: string[], depth: number, label?: string): void {
  if (depth > 4 || value === null || value === undefined || value === '') return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const content = sanitizeAuthorFacingConversationText(String(value));
    if (content.length > 0) lines.push(label === undefined ? content : `${label}：${content}`);
    return;
  }
  if (Array.isArray(value)) {
    const scalars = value.filter((item) => ['string', 'number', 'boolean'].includes(typeof item));
    if (scalars.length === value.length) {
      const content = scalars.map((item) => sanitizeAuthorFacingConversationText(String(item))).filter(Boolean).join('、');
      if (content.length > 0) lines.push(label === undefined ? content : `${label}：${content}`);
      return;
    }
    for (const item of value.slice(0, 12)) flattenPublicValue(item, lines, depth + 1, label);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (OMITTED_MODEL_FIELDS.has(key) || /(?:^|_)(?:id|hash)$/iu.test(key) || /(?:Id|Hash)$/u.test(key)) continue;
    const publicLabel = PUBLIC_FIELD_LABELS[key] ?? (/\p{Script=Han}/u.test(key) ? key : undefined);
    if (publicLabel === undefined) continue;
    flattenPublicValue(unwrapValue(child), lines, depth + 1, publicLabel);
  }
}

function appendPublicField(lines: string[], label: string, value: unknown): void {
  const rendered: string[] = [];
  flattenPublicValue(unwrapValue(value), rendered, 0);
  const content = rendered.map((line) => line.replace(/^[^：]{1,12}：/u, '')).filter(Boolean).join('；');
  if (content.length > 0) lines.push(`${label}：${content}`);
}

function unwrapValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if ('value' in value) return value.value;
  if ('confirmed' in value && value.confirmed !== null && value.confirmed !== undefined) return value.confirmed;
  if ('candidates' in value) return value.candidates;
  return value;
}

function parseRecord(raw: string): Record<string, unknown> | null {
  const parsed = parseJson(raw);
  return isRecord(parsed) ? parsed : null;
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
}

function clip(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 18))}……（其余内容保留在资料中）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
