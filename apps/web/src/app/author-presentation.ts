const TECHNICAL_FIELDS = new Set([
  'owner_id', 'ownerId', 'book_id', 'bookId', 'content_hash', 'contentHash',
  'model_snapshot_id', 'modelSnapshotId', 'parameters_json', 'parametersJson',
  'scope_json', 'scopeJson', 'impact_json', 'impactJson', 'references_json',
  'referencesJson', 'source_ids_json', 'sourceIds', 'sourceIdsJson', 'rebuilt_at',
  'rebuiltAt', 'schema_version', 'schemaVersion', 'version', 'format', 'rules'
]);

const FIELD_LABELS: Record<string, string> = {
  title: '标题', answer: '结论', keyPoints: '关键依据', alternatives: '可选方向', risks: '风险与未知',
  questions: '需要确认', nextStep: '下一步', details: '补充依据', content: '内容', summary: '摘要',
  goal: '目标', objective: '目标', beats: '剧情节点', hook: '章末钩子', status: '状态', track: '轨迹',
  chapterNumber: '章节', chapter_number: '章节', canonRevision: '正史修订', canon_revision: '正史修订',
  projectionType: '图谱类型', projection_type: '图谱类型', section: '区域', data: '内容', source: '来源',
  canonical_name: '名称', canonicalName: '名称', entity_type: '类型', entityType: '类型', aliases: '别名',
  relation_key: '关系', relationKey: '关系', value: '事实', evidence: '依据', grade: '证据等级',
  namespace: '标签类别', name: '名称', description: '说明', diagnosis: '待补信息', severity: '重要程度',
  intentional_unknown: '刻意留白', narrative_goal: '叙事目标', from_name: '起点', toValue: '终点或数值',
  tradeoff: '代价', fields: '内容', quality: '分析结果', manuscript: '正文分析',
  genre: '题材', sourceStatus: '来源状态', source_status: '来源状态', candidates: '候选', premise: '核心前提',
  audience: '目标读者', tone: '整体表达', constraints: '必须遵守', confirmedRecommendation: '确认方案',
  positioning: '作品定位', worldView: '世界观', worldRules: '世界规则', powerSystem: '力量体系',
  resourceSystem: '资源体系', equipmentTiers: '装备等级', economicRules: '经济规则', attributeFields: '属性字段',
  characters: '初始人物', initialOrganizations: '初始势力', mainPlot: '主线', planningHistory: '规划沿革',
  openQuestions: '开放问题', tags: '主要标签', theme: '主题', acts: '推进阶段', endingDirection: '结局方向',
  volumeNumber: '卷号', arcs: '故事弧', endingState: '卷末状态', created_source: '记录来源',
  assignment_count: '使用次数', candidate_status: '确认状态', claim_text: '候选判断',
  sources: '资料来源', structureCards: '结构参考卡', cleanroomPackages: '隔离资料包', checks: '版权检查',
  recentChecks: '最近检查', count: '数量'
};

const ENUM_LABELS: Record<string, string> = {
  planned: '规划', actual: '实际', emotion: '情绪', mainline: '主线', subplot: '支线', hook: '钩子与伏笔',
  information_gap: '信息差', not_extracted: '暂无可展示内容', chapter_outline: '章纲', active: '有效',
  archived: '已归档', proposed: '待确认', confirmed: '已确认', candidate: '候选', derived: '分析结果',
  provided: '作者提供', manual: '人工记录', explicit: '明确确认', inferred: '根据资料推断', unspecified: '尚未说明',
  low: '低', medium: '中', high: '高', true: '是', false: '否'
};

export interface AuthorReplyProjection {
  visibleContent: string;
  fullContent: string;
}

export function toAuthorDisplayValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '内容层级过深，已省略';
  const parsed = parseJsonString(value);
  if (parsed !== value) return toAuthorDisplayValue(parsed, depth + 1);
  if (typeof value === 'string' && looksLikeMachinePayload(value)) return '这项内容的格式异常，内部原件已保留，但不会在作者界面直接展示。';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => toAuthorDisplayValue(item, depth + 1));
  if (!isRecord(value)) return value;

  if (value.version === 1 && value.format === 'json_object' && isRecord(value.fields)) {
    return toAuthorDisplayValue(value.fields, depth + 1);
  }

  const result: Record<string, unknown> = {};
  let sourceRecorded = false;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (rawKey === 'source_ids_json' || rawKey === 'sourceIds' || rawKey === 'sourceIdsJson') {
      const sources = parseJsonString(rawValue);
      sourceRecorded = (Array.isArray(sources) && sources.length > 0) || (typeof sources === 'string' && sources.trim().length > 0);
      continue;
    }
    if (isAuthorTechnicalField(rawKey)) continue;
    const key = rawKey.endsWith('_json') ? rawKey.slice(0, -5) : rawKey.endsWith('Json') ? rawKey.slice(0, -4) : rawKey;
    const item = toAuthorDisplayValue(rawValue, depth + 1);
    if (item === undefined || item === null || item === '' || (Array.isArray(item) && item.length === 0)) continue;
    result[key] = item;
  }
  if (sourceRecorded) result.sourceRecorded = true;
  if (Object.keys(result).length === 0) return '暂无可展示内容';
  return result;
}

export function projectionForAuthor(record: Record<string, unknown>): Record<string, unknown> {
  const content = toAuthorDisplayValue(record.content ?? record.content_json);
  const result: Record<string, unknown> = {};
  const chapter = record.chapterNumber ?? record.chapter_number;
  if (typeof chapter === 'number' || (typeof chapter === 'string' && chapter.trim().length > 0)) result.chapterNumber = chapter;
  if (isRecord(content) && content.status === 'not_extracted') {
    result.status = content.status;
    if (content.source !== undefined) result.source = content.source;
  } else if (isRecord(content)) Object.assign(result, content);
  else result.content = content;
  const revision = record.canonRevision ?? record.canon_revision;
  if (typeof revision === 'number') result.canonRevision = revision;
  return result;
}

export function authorFieldLabel(key: string): string {
  if (key === 'sourceRecorded') return '资料来源';
  const known = FIELD_LABELS[key];
  if (known !== undefined) return known;
  return /\p{Script=Han}/u.test(key) ? key.replaceAll('_', ' ') : '补充信息';
}

export function authorFormatScalar(value: unknown): string {
  if (value === null || value === undefined || value === '') return '暂无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return new Intl.NumberFormat('zh-CN').format(value);
  const text = String(value).trim();
  return ENUM_LABELS[text] ?? text;
}

export function authorRelationshipLabel(value: unknown): string {
  const text = String(value ?? '').trim();
  const known: Record<string, string> = {
    ally_of: '盟友', enemy_of: '敌对', member_of: '隶属', located_in: '位于', owns: '拥有',
    parent_of: '亲子', sibling_of: '手足', loves: '爱慕', trusts: '信任', betrays: '背叛', supports: '支持'
  };
  if (known[text] !== undefined) return known[text];
  return /\p{Script=Han}/u.test(text) ? text : '关联';
}

export function isAuthorTechnicalField(key: string): boolean {
  if (TECHNICAL_FIELDS.has(key)) return true;
  if (/(?:^|_)(?:owner|book|projection|artifact|fact|entity|relation|task|message|discussion|decision|model|manuscript)_?id$/iu.test(key)) return true;
  if (/(?:Id|_id)$/u.test(key)) return true;
  return /^(?:created_at|updated_at|deleted_at|createdAt|updatedAt|deletedAt)$/u.test(key);
}

export function structuredReplyFromMixedText(raw: string): AuthorReplyProjection | null {
  for (const candidate of balancedJsonObjects(raw)) {
    let value: unknown;
    try { value = JSON.parse(candidate) as unknown; } catch { continue; }
    if (!isRecord(value)) continue;
    const fields = value.version === 1 && value.format === 'json_object' && isRecord(value.fields) ? value.fields : value;
    const answer = nonEmptyString(fields.answer);
    if (answer === null) continue;
    const visible = renderReply(fields, false);
    const full = renderReply(fields, true);
    return { visibleContent: visible, fullContent: full };
  }
  return null;
}

function renderReply(fields: Record<string, unknown>, details: boolean): string {
  const sections = [String(fields.answer).trim()];
  appendList(sections, '关键依据', fields.keyPoints, 3);
  if (Array.isArray(fields.alternatives)) {
    const alternatives = fields.alternatives.slice(0, 8).flatMap((item) => {
      if (!isRecord(item)) return [];
      const title = nonEmptyString(item.title);
      const content = nonEmptyString(item.content);
      if (title === null || content === null) return [];
      const tradeoff = nonEmptyString(item.tradeoff);
      return [`- ${title}：${content}${tradeoff === null ? '' : `；代价：${tradeoff}`}`];
    });
    if (alternatives.length > 0) sections.push(`可选方向：\n${alternatives.join('\n')}`);
  }
  appendList(sections, '风险与未知', fields.risks, 8);
  appendList(sections, '需要确认', fields.questions, 3);
  const nextStep = nonEmptyString(fields.nextStep);
  if (nextStep !== null) sections.push(`下一步：${nextStep}`);
  const detail = nonEmptyString(fields.details);
  if (details && detail !== null) sections.push(`补充依据：\n${detail}`);
  return sections.join('\n\n');
}

function appendList(sections: string[], title: string, value: unknown, limit: number): void {
  if (!Array.isArray(value)) return;
  const items = value.slice(0, limit).map(nonEmptyString).filter((item): item is string => item !== null);
  if (items.length > 0) sections.push(`${title}：\n${items.map((item) => `- ${item}`).join('\n')}`);
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (text.length < 2 || text.length > 200_000 || !((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) return value;
  try { return JSON.parse(text) as unknown; } catch {
    let unescaped = text;
    for (let attempt = 0; attempt < 2 && /\\"/u.test(unescaped); attempt += 1) {
      unescaped = unescaped.replaceAll('\\"', '"');
      try { return JSON.parse(unescaped) as unknown; } catch { /* 继续尝试下一层转义 */ }
    }
    return value;
  }
}

function looksLikeMachinePayload(value: string): boolean {
  const text = value.trim();
  return /^```(?:json)?\s*/iu.test(text)
    || /\\?"(?:version|format|fields|answer|title|goal|beats|hook|content_json|projection_id)\\?"\s*:/iu.test(text)
    || /(?:规划落库|source_ids_json)/iu.test(text);
}

function balancedJsonObjects(raw: string): string[] {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  const candidates = [trimmed];
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
      else if (char === '}' && --depth === 0) {
        candidates.push(raw.slice(start, index + 1));
        start = index;
        break;
      }
    }
  }
  return [...new Set(candidates)];
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
