import {
  OPENING_TAXONOMY,
  type OpeningChannel,
  type OpeningTaxonomyCategory,
  type ProtagonistRole
} from '../../contracts/opening-blueprint.js';
import type {
  OpeningSynopsisAnalysisInput,
  OpeningSynopsisAnalysisResult,
  OpeningSynopsisProtagonistSuggestion
} from '../../contracts/opening-synopsis-analysis.js';

type SectionKey =
  | 'title' | 'channel' | 'category' | 'protagonist' | 'maleProtagonist' | 'femaleProtagonist'
  | 'personality' | 'worldBackground' | 'openingBackground' | 'stageStart' | 'stageDevelopment'
  | 'stageEnd' | 'fullBookOutline' | 'initialMap' | 'mainTags' | 'auxiliaryTags' | 'storyTraits'
  | 'mustFollow';

const sectionLabels = new Map<string, SectionKey>([
  ['书名', 'title'], ['作品名称', 'title'],
  ['频道', 'channel'], ['创作频道', 'channel'], ['男频女频', 'channel'],
  ['分类', 'category'], ['作品分类', 'category'], ['题材分类', 'category'],
  ['主角', 'protagonist'], ['初始主角', 'protagonist'],
  ['男主', 'maleProtagonist'], ['女主', 'femaleProtagonist'],
  ['性格', 'personality'], ['性格选项', 'personality'],
  ['世界观背景', 'worldBackground'], ['世界背景', 'worldBackground'], ['世界观', 'worldBackground'],
  ['故事起始背景', 'openingBackground'], ['开篇背景', 'openingBackground'], ['起始背景', 'openingBackground'],
  ['第一阶段起始剧情', 'stageStart'], ['一阶段起始剧情', 'stageStart'], ['阶段起始', 'stageStart'],
  ['第一阶段发展剧情', 'stageDevelopment'], ['一阶段发展剧情', 'stageDevelopment'], ['阶段发展', 'stageDevelopment'],
  ['第一阶段结束剧情', 'stageEnd'], ['一阶段结束剧情', 'stageEnd'], ['阶段结束', 'stageEnd'],
  ['全书简介', 'fullBookOutline'], ['故事主线和结果', 'fullBookOutline'], ['全书梗概', 'fullBookOutline'],
  ['初始地图', 'initialMap'], ['开篇地点', 'initialMap'], ['初始地点', 'initialMap'],
  ['主要标签', 'mainTags'], ['主类型', 'mainTags'],
  ['辅助题材', 'auxiliaryTags'], ['辅助标签', 'auxiliaryTags'],
  ['全书特点', 'storyTraits'], ['创作特点', 'storyTraits'],
  ['必须遵守', 'mustFollow'], ['硬边界', 'mustFollow']
]);

const personalityAliases = new Map<string, string>([
  ['有底线', '善良有底线'],
  ['善良', '善良有底线'],
  ['责任感', '责任感强']
]);

const boundaryAliases = new Map<string, string>([
  ['无后宫', '不写后宫'], ['不要后宫', '不写后宫'],
  ['不虐', '不虐主'], ['主角不降智', '不降智'],
  ['不露骨', '不写露骨情色'], ['不要开放式结局', '不写开放式结局']
]);

const fieldLabels: Record<string, string> = {
  title: '书名',
  channel: '创作频道',
  categoryKey: '作品分类',
  protagonist: '初始主角',
  worldBackground: '世界观背景',
  openingBackground: '故事起始背景',
  stageStart: '第一阶段起始剧情',
  stageDevelopment: '第一阶段发展剧情',
  stageEnd: '第一阶段结束剧情',
  fullBookOutline: '全书简介',
  initialMap: '初始地图',
  mainTags: '主要标签',
  mustFollow: '必须遵守'
};

export class OpeningSynopsisAnalysisService {
  public analyze(input: OpeningSynopsisAnalysisInput): OpeningSynopsisAnalysisResult {
    const synopsis = normalizeInput(input.synopsis);
    const sections = extractSections(synopsis);
    const evidence: OpeningSynopsisAnalysisResult['evidence'] = [];
    const explicitChannel = parseChannel(sections.get('channel') ?? synopsis);
    const category = chooseCategory(sections.get('category') ?? null, synopsis, explicitChannel);
    const channel = explicitChannel ?? category?.channel ?? null;
    const protagonist = parseProtagonist(sections, synopsis, channel);
    const fullBookOutline = sections.get('fullBookOutline') ?? synopsis;
    const mainTags = matchTerms(sections.get('mainTags') ?? synopsis, OPENING_TAXONOMY.mainTags, 5);
    const auxiliaryTags = matchTerms(sections.get('auxiliaryTags') ?? synopsis, OPENING_TAXONOMY.auxiliaryTags, 8);
    const storyTraits = matchTerms(sections.get('storyTraits') ?? synopsis, OPENING_TAXONOMY.storyTraits, 8);
    const mustFollow = matchMustFollow(sections.get('mustFollow') ?? synopsis);
    const suggestions = {
      title: cleanCandidate(sections.get('title'), 120),
      channel,
      categoryKey: category?.key ?? null,
      protagonist,
      worldBackground: cleanCandidate(sections.get('worldBackground')),
      openingBackground: cleanCandidate(sections.get('openingBackground')),
      stageOne: {
        start: cleanCandidate(sections.get('stageStart')),
        development: cleanCandidate(sections.get('stageDevelopment')),
        end: cleanCandidate(sections.get('stageEnd'))
      },
      fullBookOutline,
      initialMap: cleanCandidate(sections.get('initialMap')),
      mainTags,
      auxiliaryTags,
      storyTraits,
      mustFollow
    };

    collectEvidence(evidence, '书名', suggestions.title);
    collectEvidence(evidence, '创作频道', suggestions.channel === 'male' ? '男频' : suggestions.channel === 'female' ? '女频' : null);
    collectEvidence(evidence, '作品分类', category?.name ?? null);
    collectEvidence(evidence, '初始主角', protagonist === null ? null : [protagonist.name, protagonist.age, protagonist.background].filter(Boolean).join('，'));
    collectEvidence(evidence, '世界观背景', suggestions.worldBackground);
    collectEvidence(evidence, '故事起始背景', suggestions.openingBackground);
    collectEvidence(evidence, '第一阶段起始剧情', suggestions.stageOne.start);
    collectEvidence(evidence, '第一阶段发展剧情', suggestions.stageOne.development);
    collectEvidence(evidence, '第一阶段结束剧情', suggestions.stageOne.end);
    collectEvidence(evidence, '全书简介', fullBookOutline);
    collectEvidence(evidence, '初始地图', suggestions.initialMap);
    collectEvidence(evidence, '主要标签', mainTags.join('、') || null);
    collectEvidence(evidence, '辅助题材', auxiliaryTags.join('、') || null);
    collectEvidence(evidence, '全书特点', storyTraits.join('、') || null);
    collectEvidence(evidence, '必须遵守', mustFollow.join('、') || null);

    const status = new Map<string, boolean>([
      ['title', suggestions.title !== null],
      ['channel', channel !== null],
      ['categoryKey', category !== null],
      ['protagonist', protagonist !== null],
      ['worldBackground', suggestions.worldBackground !== null],
      ['openingBackground', suggestions.openingBackground !== null],
      ['stageStart', suggestions.stageOne.start !== null],
      ['stageDevelopment', suggestions.stageOne.development !== null],
      ['stageEnd', suggestions.stageOne.end !== null],
      ['fullBookOutline', fullBookOutline.length > 0],
      ['initialMap', suggestions.initialMap !== null],
      ['mainTags', mainTags.length >= 2],
      ['mustFollow', mustFollow.length > 0]
    ]);
    return {
      schemaVersion: 'opening-synopsis-suggestions-v1',
      analysisMode: 'local-deterministic',
      taxonomyVersion: OPENING_TAXONOMY.version,
      synopsisLength: synopsis.length,
      suggestions,
      recognizedFields: [...status].filter(([, recognized]) => recognized).map(([field]) => fieldLabels[field] ?? field),
      unresolvedFields: [...status].filter(([, recognized]) => !recognized).map(([field]) => fieldLabels[field] ?? field),
      evidence
    };
  }
}

function normalizeInput(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('剧情梗概不能为空');
  const synopsis = value.replace(/\r\n?/gu, '\n').trim();
  if (synopsis.length > 5_000) throw new Error('剧情梗概不能超过5000个字符');
  return synopsis;
}

function extractSections(synopsis: string): Map<SectionKey, string> {
  const sections = new Map<SectionKey, string>();
  let active: SectionKey | null = null;
  for (const rawLine of synopsis.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = line.match(/^([^：:]{1,18})[：:]\s*(.*)$/u);
    const key = match === null ? undefined : sectionLabels.get(match[1]?.replace(/\s+/gu, '') ?? '');
    if (key !== undefined) {
      active = key;
      const value = match?.[2]?.trim() ?? '';
      if (value.length > 0) sections.set(key, value);
      continue;
    }
    if (active !== null) {
      sections.set(active, [sections.get(active), line].filter(Boolean).join('\n'));
    }
  }
  return sections;
}

function parseChannel(text: string): OpeningChannel | null {
  const hasMale = /(?:^|[^\p{Script=Han}])男频(?:$|[^\p{Script=Han}])/u.test(text) || text.trim() === '男频';
  const hasFemale = /(?:^|[^\p{Script=Han}])女频(?:$|[^\p{Script=Han}])/u.test(text) || text.trim() === '女频';
  if (hasMale === hasFemale) return null;
  return hasMale ? 'male' : 'female';
}

function chooseCategory(explicit: string | null, synopsis: string, channel: OpeningChannel | null): OpeningTaxonomyCategory | null {
  if (explicit !== null) {
    const normalized = explicit.trim();
    const exact = OPENING_TAXONOMY.categories.find((item) =>
      (item.name === normalized || item.key === normalized) && (channel === null || item.channel === channel)
    );
    if (exact !== undefined) return exact;
  }
  const scored = OPENING_TAXONOMY.categories
    .filter((item) => channel === null || item.channel === channel)
    .map((item) => {
      let score = synopsis.includes(item.name) ? 30 : 0;
      for (const tag of item.recommendedMainTags) if (synopsis.includes(tag)) score += 5;
      return { item, score };
    })
    .filter(({ score }) => score >= 8)
    .sort((left, right) => right.score - left.score || left.item.key.localeCompare(right.item.key));
  if (scored.length === 0) return null;
  if (scored[1] !== undefined && scored[0]?.score === scored[1].score) return null;
  return scored[0]?.item ?? null;
}

function parseProtagonist(
  sections: Map<SectionKey, string>,
  synopsis: string,
  channel: OpeningChannel | null
): OpeningSynopsisProtagonistSuggestion | null {
  const explicitMale = sections.get('maleProtagonist');
  const explicitFemale = sections.get('femaleProtagonist');
  const explicitGeneric = sections.get('protagonist');
  const source = explicitMale ?? explicitFemale ?? explicitGeneric ?? synopsis;
  const explicit = explicitMale !== undefined || explicitFemale !== undefined || explicitGeneric !== undefined;
  const role: ProtagonistRole = explicitMale !== undefined ? 'male_lead'
    : explicitFemale !== undefined ? 'female_lead'
      : channel === 'male' ? 'male_lead' : channel === 'female' ? 'female_lead' : 'co_lead';
  const parts = source.split(/[，,；;|]/u).map((item) => item.trim()).filter(Boolean);
  const freeName = synopsis.match(/(?:男主|女主|主角)(?:名叫|名为|叫|是)?\s*([\p{Script=Han}·]{2,6}?)(?=[零一二三四五六七八九十百两\d]{1,4}岁|[，,。；;\s]|在|从|于)/u)?.[1];
  const explicitName = explicit ? parts[0]?.replace(/^(?:男主|女主|主角)(?:名叫|名为|叫|是)?\s*/u, '').trim() : undefined;
  const name = cleanPersonName(explicitName ?? freeName);
  if (name === null) return null;
  const age = source.match(/([零一二三四五六七八九十百两\d]{1,4}岁)/u)?.[1] ?? null;
  let background: string | null = null;
  if (explicit && parts.length > 1) {
    background = cleanCandidate(parts.filter((part) => part !== name && part !== age).join('，'), 2_000);
  }
  const personalitySource = [sections.get('personality'), synopsis].filter(Boolean).join('\n');
  const personalities = matchPersonalities(personalitySource);
  return { role, name, age, background, personalities };
}

function cleanPersonName(value: string | undefined): string | null {
  if (value === undefined) return null;
  const name = value.replace(/[《》“”"'：:]/gu, '').trim();
  if (!/^[\p{Script=Han}·]{2,8}$/u.test(name)) return null;
  if (['一个人', '主人公', '主角们', '所在的'].includes(name)) return null;
  return name;
}

function matchPersonalities(text: string): string[] {
  const matched = matchTerms(text, OPENING_TAXONOMY.personalityOptions, 8);
  for (const [alias, canonical] of personalityAliases) {
    if (text.includes(alias) && !matched.includes(canonical) && matched.length < 6) matched.push(canonical);
  }
  return matched;
}

function matchMustFollow(text: string): string[] {
  const options = OPENING_TAXONOMY.boundaryGroups.flatMap((group) => group.options);
  const matched = matchTerms(text, options, 12);
  for (const [alias, canonical] of boundaryAliases) {
    if (text.includes(alias) && !matched.includes(canonical) && matched.length < 12) matched.push(canonical);
  }
  return matched;
}

function matchTerms(text: string, options: string[], limit: number): string[] {
  return options
    .map((option, order) => ({ option, index: text.indexOf(option), order }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index || left.order - right.order)
    .slice(0, limit)
    .map(({ option }) => option);
}

function cleanCandidate(value: string | undefined, maxLength = Number.POSITIVE_INFINITY): string | null {
  const candidate = value?.trim();
  return candidate === undefined || candidate.length === 0 || candidate.length > maxLength ? null : candidate;
}

function collectEvidence(
  evidence: OpeningSynopsisAnalysisResult['evidence'],
  field: string,
  value: string | null
): void {
  if (value === null || value.length === 0) return;
  evidence.push({ field, excerpt: value.slice(0, 160) });
}
