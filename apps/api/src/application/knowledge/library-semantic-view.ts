export interface LibraryEntityRow {
  entity_id: unknown;
  entity_type: unknown;
  canonical_name: unknown;
  aliases?: unknown;
}

export interface LibraryFactRow {
  fact_id?: unknown;
  subject_entity_id: unknown;
  canonical_name?: unknown;
  relation_key: unknown;
  value: unknown;
  story_time_start?: unknown;
  source_chapter_number?: unknown;
  source_chapter_title?: unknown;
}

export interface LibraryProfileValue {
  value: unknown;
  sourceChapterNumber: number | null;
  sourceChapterTitle: string | null;
  storyTime: string | null;
}

export interface LibraryProfileField {
  key: string;
  label: string;
  values: LibraryProfileValue[];
}

export interface LibrarySemanticProfile {
  entityId: string;
  entityType: string;
  name: string;
  aliases: string[];
  firstAppearance: LibraryProfileValue | null;
  fields: LibraryProfileField[];
}

export interface LibraryWorldMapNode {
  nodeId: string;
  name: string;
  role: 'birthplace' | 'story_start' | 'location';
  chapterNumber: number | null;
  chapterTitle: string | null;
  direction: string | null;
}

export interface LibraryWorldMapEdge {
  fromNodeId: string;
  toNodeId: string;
  label: string;
  chapterNumber: number | null;
}

export interface LibraryWorldMap {
  authorDescription: string | null;
  nodes: LibraryWorldMapNode[];
  edges: LibraryWorldMapEdge[];
}

interface FieldDefinition {
  key: string;
  label: string;
  match: RegExp;
}

const PROFILE_FIELDS: Record<string, FieldDefinition[]> = {
  character: [
    { key: 'identity', label: '身份', match: /identity|role|occupation|background|身份|职业|出身|地位/iu },
    { key: 'age', label: '年龄', match: /(?:^|[._:])age(?:$|[._:])|birth|年龄|岁数/iu },
    { key: 'personality', label: '性格', match: /personality|temperament|trait|性格|气质|脾气/iu },
    { key: 'affiliation', label: '所属门派或组织', match: /affiliation|faction|sect|organization|guild|team|门派|宗门|势力|公会|战队|所属/iu },
    { key: 'realm', label: '境界与等级', match: /realm|cultivation|level|rank|境界|修为|等级|段位/iu },
    { key: 'strength', label: '实力', match: /strength|combat|power|战力|实力/iu },
    { key: 'attributes', label: '属性面板', match: /attribute|stat|panel|属性|面板/iu },
    { key: 'equipment', label: '装备与持有物', match: /equipment|weapon|armor|item|possess|道具|装备|武器|持有/iu },
    { key: 'relationships', label: '人物关系', match: /relationship|关系/iu }
  ],
  organization: [
    { key: 'leader', label: '负责人', match: /leader|master|chief|captain|宗主|掌门|首领|会长|队长|负责人/iu },
    { key: 'member_count', label: '人数与规模', match: /member.?count|headcount|population|size|人数|成员数|规模/iu },
    { key: 'strength', label: '整体实力', match: /strength|power|combat|战力|实力/iu },
    { key: 'level', label: '等级', match: /level|rank|grade|tier|等级|品级|级别/iu },
    { key: 'base', label: '主要场地与驻地', match: /headquarter|base|site|territory|场地|驻地|总部|据点|领地|宗门所在/iu },
    { key: 'position', label: '地位与影响力', match: /status|prestige|influence|position|地位|声望|影响力/iu },
    { key: 'members', label: '已确认成员', match: /(?:^|[.:])members?$|(?:^|[.:])member_(?:name|list)(?:$|[.:])|成员(?!数|数量)|弟子名册|队员/iu }
  ],
  location: [
    { key: 'birthplace', label: '出生地或故事起点', match: /birthplace|birth.?place|hometown|origin|出生地|故乡|起点/iu },
    { key: 'type', label: '地点类型', match: /location.?type|category|kind|地点类型|类型/iu },
    { key: 'parent', label: '所属区域', match: /parent|region|belongs|contains|所属区域|上级地点|位于/iu },
    { key: 'direction', label: '方位', match: /direction|orientation|方位|方向|东侧|西侧|南侧|北侧/iu },
    { key: 'description', label: '地点特点', match: /description|feature|environment|地点特点|环境|地貌/iu }
  ],
  item: [
    { key: 'owner', label: '归属人物', match: /owner|holder|belong|possess|归属|持有者|主人/iu },
    { key: 'type', label: '类型', match: /item.?type|category|kind|类型|种类/iu },
    { key: 'level', label: '等级与品质', match: /level|rank|grade|tier|quality|等级|品级|品质/iu },
    { key: 'attributes', label: '属性面板', match: /attribute|stat|panel|property|属性|面板|数值/iu },
    { key: 'effects', label: '作用与效果', match: /effect|ability|capability|function|作用|效果|能力|用途/iu },
    { key: 'status', label: '当前状态', match: /status|condition|durability|状态|耐久/iu },
    { key: 'history', label: '获得与失去记录', match: /acquire|obtain|gain|lose|lost|consume|获得|得到|失去|消耗/iu }
  ],
  resource: [
    { key: 'owner', label: '当前归属', match: /owner|holder|belong|possess|归属|持有者/iu },
    { key: 'type', label: '资源类型', match: /resource.?type|category|kind|资源类型|类型/iu },
    { key: 'amount', label: '数量', match: /amount|count|quantity|数量|余额/iu },
    { key: 'attributes', label: '属性与价值', match: /attribute|stat|property|value|属性|价值/iu },
    { key: 'uses', label: '用途', match: /effect|function|use|用途|作用/iu },
    { key: 'history', label: '获得与消耗记录', match: /acquire|obtain|gain|lose|lost|consume|获得|得到|失去|消耗/iu }
  ]
};

export function buildLibraryProfiles(entities: LibraryEntityRow[], facts: LibraryFactRow[], entityTypes: string[]): LibrarySemanticProfile[] {
  const allowed = new Set(entityTypes);
  return entities.filter((entity) => allowed.has(String(entity.entity_type))).map((entity) => buildProfile(entity, facts));
}

export function buildLibraryWorldMap(locationProfiles: LibrarySemanticProfile[], authorDescription: unknown): LibraryWorldMap {
  const appeared = [...locationProfiles].filter((profile) => profile.firstAppearance !== null).sort((left, right) => {
    const leftChapter = left.firstAppearance?.sourceChapterNumber ?? Number.MAX_SAFE_INTEGER;
    const rightChapter = right.firstAppearance?.sourceChapterNumber ?? Number.MAX_SAFE_INTEGER;
    return leftChapter - rightChapter || left.name.localeCompare(right.name, 'zh-CN');
  });
  const selected = new Map<string, LibrarySemanticProfile>();
  if (appeared[0] !== undefined) selected.set(appeared[0].entityId, appeared[0]);
  for (const profile of appeared.filter(isMapScaleLocation)) selected.set(profile.entityId, profile);
  const ordered = [...selected.values()].sort((left, right) =>
    (left.firstAppearance?.sourceChapterNumber ?? Number.MAX_SAFE_INTEGER) - (right.firstAppearance?.sourceChapterNumber ?? Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, 'zh-CN'));
  const nodes = ordered.map((profile, index): LibraryWorldMapNode => ({
    nodeId: profile.entityId,
    name: profile.name,
    role: hasBirthplaceFact(profile) ? 'birthplace' : index === 0 ? 'story_start' : 'location',
    chapterNumber: profile.firstAppearance?.sourceChapterNumber ?? null,
    chapterTitle: profile.firstAppearance?.sourceChapterTitle ?? null,
    direction: profile.fields.find((field) => field.key === 'direction')?.values.map((item) => scalarText(item.value)).find(Boolean) ?? null
  }));
  const edges: LibraryWorldMapEdge[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!;
    const current = nodes[index]!;
    if (previous.chapterNumber !== null && current.chapterNumber !== null && current.chapterNumber > previous.chapterNumber) {
      edges.push({ fromNodeId: previous.nodeId, toNodeId: current.nodeId, label: '故事行进到', chapterNumber: current.chapterNumber });
    }
  }
  const description = typeof authorDescription === 'string' && authorDescription.trim().length > 0 ? authorDescription.trim() : null;
  return { authorDescription: description, nodes, edges };
}

function buildProfile(entity: LibraryEntityRow, facts: LibraryFactRow[]): LibrarySemanticProfile {
  const entityId = String(entity.entity_id);
  const entityType = String(entity.entity_type);
  const profileType = entityType === 'skill' || entityType === 'stat_panel' ? 'item' : entityType;
  const definitions = PROFILE_FIELDS[profileType] ?? [];
  const entityFacts = deduplicateFacts(facts.filter((fact) => String(fact.subject_entity_id) === entityId));
  const appearances = entityFacts.filter(isAppearanceFact).sort(compareFacts);
  const fields = definitions.map((definition): LibraryProfileField => ({
    key: definition.key,
    label: definition.label,
    values: entityFacts.filter((fact) => !isAppearanceFact(fact) && definition.match.test(String(fact.relation_key))).map(toProfileValue)
  }));
  enrichReverseRelationships(entity, facts, fields);
  const matched = new Set(fields.flatMap((field) => field.values.map(valueSignature)));
  const extras = entityFacts.filter((fact) => !isAppearanceFact(fact) && !matched.has(valueSignature(toProfileValue(fact))));
  if (extras.length > 0) fields.push({ key: 'other', label: '其他已确认资料', values: extras.map(toProfileValue) });
  if (appearances.length > 0) {
    fields.push({
      key: 'appearances',
      label: '出场记录',
      values: appearances.map((fact) => ({ ...toProfileValue(fact), value: appearanceText(fact) }))
    });
  }
  return {
    entityId,
    entityType,
    name: String(entity.canonical_name),
    aliases: Array.isArray(entity.aliases) ? entity.aliases.filter((item): item is string => typeof item === 'string') : [],
    firstAppearance: appearances[0] === undefined ? null : toProfileValue(appearances[0]),
    fields
  };
}

function enrichReverseRelationships(entity: LibraryEntityRow, facts: LibraryFactRow[], fields: LibraryProfileField[]): void {
  const entityId = String(entity.entity_id);
  const entityType = String(entity.entity_type);
  const entityName = String(entity.canonical_name).trim();
  if (!['item', 'resource', 'organization'].includes(entityType) || entityName.length === 0) return;
  const targetKey = entityType === 'organization' ? 'members' : 'owner';
  const relationPattern = entityType === 'organization'
    ? /affiliation|faction|sect|organization|guild|team|member|门派|宗门|势力|公会|战队|所属|成员/iu
    : /owner|holder|possess|equipment|weapon|item|resource|acquire|obtain|持有|装备|武器|道具|资源|获得|得到|归属/iu;
  const target = fields.find((field) => field.key === targetKey);
  if (target === undefined) return;
  const reverseValues = facts.filter((fact) => String(fact.subject_entity_id) !== entityId
      && relationPattern.test(String(fact.relation_key)) && referencesName(fact.value, entityName))
    .map((fact): LibraryProfileValue | null => {
      const ownerName = typeof fact.canonical_name === 'string' ? fact.canonical_name.trim() : '';
      return ownerName.length === 0 ? null : { ...toProfileValue(fact), value: ownerName };
    }).filter((value): value is LibraryProfileValue => value !== null);
  const seen = new Set(target.values.map(valueSignature));
  for (const value of reverseValues) {
    const signature = valueSignature(value);
    if (!seen.has(signature)) target.values.push(value);
    seen.add(signature);
  }
}

function referencesName(value: unknown, expectedName: string): boolean {
  if (typeof value === 'string') return value.trim() === expectedName;
  if (Array.isArray(value)) return value.some((item) => referencesName(item, expectedName));
  if (typeof value !== 'object' || value === null) return false;
  return ['name', 'canonicalName', 'target', 'item', 'resource', 'equipment', 'organization', 'value']
    .some((key) => referencesName((value as Record<string, unknown>)[key], expectedName));
}

function appearanceText(fact: LibraryFactRow): string {
  const chapter = toProfileValue(fact).sourceChapterNumber;
  const title = toProfileValue(fact).sourceChapterTitle;
  const position = chapter === null ? '正文已经出现' : `第${chapter}章`;
  return title === null ? position : `${position} · 《${title}》`;
}

function isMapScaleLocation(profile: LibrarySemanticProfile): boolean {
  if (hasBirthplaceFact(profile)) return true;
  if (/(?:秘境|猎场入口|主峰|九峰|阵城|城|镇|村|州|国|界|域|岛|谷|岭|涧|基地|俱乐部|战区|服务器|赛场|训练营)$/u.test(profile.name)
    || /世界服|全球总决赛|国际邀请赛|城市联赛|季后赛/u.test(profile.name)) return true;
  const typeValues = profile.fields.find((field) => field.key === 'type')?.values ?? [];
  return typeValues.some((item) => /世界|大陆|区域|国家|州|城|镇|村|宗|门派|学院|基地|赛场|俱乐部|战区|服务器/u.test(scalarText(item.value)));
}

function isAppearanceFact(fact: LibraryFactRow): boolean {
  return /^(?:event(?:\.|$)|appearance(?:\.|$)|character\.appears|location\.appears|organization\.appears|item\.appears|resource\.appears)/iu.test(String(fact.relation_key));
}

function toProfileValue(fact: LibraryFactRow): LibraryProfileValue {
  const chapter = Number(fact.source_chapter_number);
  return {
    value: fact.value,
    sourceChapterNumber: Number.isInteger(chapter) && chapter > 0 ? chapter : null,
    sourceChapterTitle: typeof fact.source_chapter_title === 'string' && fact.source_chapter_title.trim() ? fact.source_chapter_title.trim() : null,
    storyTime: typeof fact.story_time_start === 'string' && fact.story_time_start.trim() && !/^第\s*\d+\s*章$/u.test(fact.story_time_start.trim()) ? fact.story_time_start.trim() : null
  };
}

function compareFacts(left: LibraryFactRow, right: LibraryFactRow): number {
  return (toProfileValue(left).sourceChapterNumber ?? Number.MAX_SAFE_INTEGER) - (toProfileValue(right).sourceChapterNumber ?? Number.MAX_SAFE_INTEGER);
}

function deduplicateFacts(facts: LibraryFactRow[]): LibraryFactRow[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const signature = `${String(fact.relation_key)}\u0000${JSON.stringify(fact.value)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function valueSignature(value: LibraryProfileValue): string {
  return JSON.stringify([value.value, value.sourceChapterNumber, value.sourceChapterTitle]);
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function hasBirthplaceFact(profile: LibrarySemanticProfile): boolean {
  return profile.fields.some((field) => (/birth|出生/u.test(field.key) && field.values.length > 0)
    || field.values.some((item) => /出生地|故乡|故事起点/u.test(scalarText(item.value))));
}
