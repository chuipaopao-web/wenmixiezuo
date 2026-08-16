import { OPENING_TAG_GROUPS, uniqueTagValues, type OpeningTagGroup } from './opening-tag-library.js';

export type OpeningChannel = 'male' | 'female';
export type BookCreationMode = 'new' | 'continuation';
export type ProtagonistRole = 'male_lead' | 'female_lead' | 'co_lead' | 'ensemble' | 'non_human'
  | 'male_support' | 'female_support' | 'male_villain' | 'female_villain';

export interface OpeningTaxonomyCategory {
  key: string;
  name: string;
  channel: OpeningChannel;
  description: string;
  recommendedMainTags: string[];
  tagPackKeys: string[];
}

export interface OpeningSubjectOption {
  name: string;
  packKeys: string[];
}

export interface OpeningBoundaryGroup {
  name: string;
  description: string;
  options: string[];
}

export interface OpeningPersonalityGroup {
  key: string;
  name: string;
  description: string;
  options: string[];
}

export interface OpeningTaxonomy {
  version: string;
  sourceLabel: string;
  sourceUrl: string;
  updatedAt: string;
  notice: string;
  categories: OpeningTaxonomyCategory[];
  mainTags: string[];
  auxiliaryTags: string[];
  storyTraits: string[];
  personalityOptions: string[];
  personalityGroups: OpeningPersonalityGroup[];
  boundaryGroups: OpeningBoundaryGroup[];
  tagGroups: OpeningTagGroup[];
  subjects: OpeningSubjectOption[];
}

export interface OpeningProtagonistInput {
  role: ProtagonistRole;
  name: string;
  age: string;
  /** 旧字段：早期书籍的整段人物背景，新书写入三个拆分字段后此字段可为空。 */
  background?: string;
  familyBackground?: string;
  careerBackground?: string;
  goldenFinger?: string;
  personalities: string[];
}

export interface OpeningStyleIntent {
  languageTones: string[];
  emotionalTones: string[];
  pacingAndPayoff: string[];
  atmospheres: string[];
  custom: string[];
}

export interface OpeningBlueprintInput {
  creationMode?: BookCreationMode;
  taxonomyVersion: string;
  channel: OpeningChannel;
  categoryKey: string;
  auxiliaryCategoryKeys?: string[];
  targetAudience: string;
  protagonists: OpeningProtagonistInput[];
  storyDirection: string;
  worldBackground: string;
  openingBackground: string;
  stageOne: { start: string; development: string; end: string };
  fullBookOutline: string;
  mainTags: string[];
  auxiliaryTags: string[];
  storyTraits: string[];
  styleIntent?: OpeningStyleIntent;
  customTags: string[];
  initialMap: string;
  mustFollow: string[];
}

function categoryPackKeys(key: string): string[] {
  const mappings: Array<[string[], string[]]> = [
    [['western'], ['western_fantasy']],
    [['martial-arts'], ['martial']],
    [['female-fantasy'], ['western_fantasy', 'romance']],
    [['fantasy'], ['fantasy']],
    [['xianxia', 'cultivation'], ['xianxia', 'fantasy']],
    [['history', 'war-spy'], ['history']],
    [['game'], ['game']],
    [['modern'], ['romance', 'urban']],
    [['urban', 'war-god'], ['urban']],
    [['farming'], ['lord', 'business']],
    [['scifi'], ['scifi']],
    [['apocalypse'], ['apocalypse', 'scifi']],
    [['suspense', 'supernatural'], ['suspense']],
    [['romance', 'wealthy', 'palace', 'ancient', 'youth'], ['romance']],
    [['ancient', 'palace'], ['history']],
    [['era', 'reality'], ['reality', 'era']],
    [['derivative', 'anime'], ['derivative']]
  ];
  const matched = [...new Set(mappings.filter(([needles]) => needles.some((needle) => key.includes(needle))).flatMap(([, packs]) => packs))];
  return matched.length > 0 ? matched : ['common'];
}

const maleCategories: OpeningTaxonomyCategory[] = [
  ['male-fantasy-brain', '玄幻脑洞', '高概念金手指、成长体系与东方幻想', ['玄幻', '脑洞', '升级']],
  ['male-traditional-fantasy', '传统玄幻', '世界规则、修炼体系与史诗冒险', ['玄幻', '热血', '成长']],
  ['male-urban-brain', '都市脑洞', '现代都市中的高概念设定', ['都市', '脑洞', '爽文']],
  ['male-urban-daily', '都市日常', '现实生活、职业与人物关系', ['都市', '日常', '成长']],
  ['male-urban-farming', '都市种田', '都市或乡村语境中的经营、建设与生活成长', ['都市', '种田', '经营']],
  ['male-urban-martial', '都市高武', '现代社会与武道成长融合', ['都市', '高武', '升级']],
  ['male-urban-cultivation', '都市修真', '现代社会中的修真体系、身份冲突与成长', ['都市', '修真', '成长']],
  ['male-war-god-son-in-law', '战神赘婿', '身份反差、逆袭与强冲突都市故事', ['都市', '赘婿', '逆袭']],
  ['male-history-ancient', '历史古代', '真实或拟真历史语境中的人物与事件', ['历史', '古代', '权谋']],
  ['male-history-brain', '历史脑洞', '历史背景中的架空推演与新设定', ['历史', '脑洞', '谋略']],
  ['male-war-spy', '抗战谍战', '战争背景中的情报、潜伏与家国抉择', ['历史', '谍战', '热血']],
  ['male-eastern-xianxia', '东方仙侠', '修仙、宗门、因果与东方神话', ['仙侠', '修仙', '成长']],
  ['male-fantasy-xianxia', '奇幻仙侠', '奇幻设定与仙侠成长体系融合', ['奇幻', '仙侠', '冒险']],
  ['male-game-sports', '游戏体育', '网游、电竞、游戏异界与竞技体育', ['游戏', '竞技', '成长']],
  ['male-scifi-apocalypse', '科幻末世', '未来科技、星际文明与灾变求生', ['科幻', '末世', '生存']],
  ['male-suspense-brain', '悬疑脑洞', '谜案、规则、推理与高概念悬念', ['悬疑', '推理', '脑洞']],
  ['male-suspense-supernatural', '悬疑灵异', '民俗怪谈、灵异事件与调查', ['悬疑', '灵异', '探案']],
  ['male-western-fantasy', '西方奇幻', '魔法、种族、王国与史诗冒险', ['奇幻', '魔法', '冒险']],
  ['male-martial-arts', '武侠', '江湖秩序、武学与侠义选择', ['武侠', '江湖', '成长']],
  ['male-anime-derivative', '动漫衍生', '基于合法授权、公共文化母题或原创世界观联动的动漫向衍生', ['衍生', '动漫', '冒险']],
  ['male-derivative', '男频衍生', '基于合法授权或公共文化母题的衍生创作', ['衍生', '冒险', '群像']],
  ['male-reality', '现实题材', '职业、社会生活与现实人物成长', ['现实', '职业', '成长']]
].map(([key, name, description, recommendedMainTags]) => ({
  key, name, channel: 'male', description, recommendedMainTags, tagPackKeys: categoryPackKeys(String(key))
})) as OpeningTaxonomyCategory[];

const femaleCategories: OpeningTaxonomyCategory[] = [
  ['female-modern-brain', '现言脑洞', '现代言情与高概念设定融合', ['现言', '脑洞', '情感']],
  ['female-wealthy-romance', '豪门总裁', '都市关系、事业与情感博弈', ['豪门', '都市', '情感']],
  ['female-palace-house', '宫斗宅斗', '古代家族、宫廷关系与生存博弈', ['古言', '宫斗', '权谋']],
  ['female-ancient-brain', '古言脑洞', '古代语境与穿越、重生等新设定', ['古言', '脑洞', '成长']],
  ['female-ancient-romance', '古代言情', '古代人物关系、成长与情感', ['古言', '情感', '成长']],
  ['female-ancient-world', '古风世情', '古代社会、家族命运与人情世态', ['古言', '现实', '群像']],
  ['female-era', '年代', '特定年代中的生活、家庭与成长', ['年代', '生活', '成长']],
  ['female-youth', '青春甜宠', '校园、青春成长与轻甜关系', ['青春', '校园', '甜宠']],
  ['female-fantasy-romance', '玄幻言情', '幻想世界、成长线与人物关系', ['玄幻', '言情', '成长']],
  ['female-xianxia-romance', '仙侠奇缘', '仙侠世界中的因果、成长与情感', ['仙侠', '情感', '成长']],
  ['female-suspense', '悬疑恋爱', '案件、秘密与人物关系共同推进', ['悬疑', '探案', '情感']],
  ['female-scifi', '科幻空间', '星际、未来、末世中的女性成长', ['科幻', '星际', '成长']],
  ['female-game', '游戏竞技', '游戏、电竞与竞技成长', ['游戏', '竞技', '成长']],
  ['female-fantasy', '西方奇幻', '魔法世界、冒险与人物关系', ['奇幻', '魔法', '冒险']],
  ['female-derivative', '女频衍生', '基于合法授权或公共文化母题的衍生创作', ['衍生', '群像', '成长']],
  ['female-reality', '现实生活', '职业、家庭、社会生活与女性成长', ['现实', '生活', '女性成长']]
].map(([key, name, description, recommendedMainTags]) => ({
  key, name, channel: 'female', description, recommendedMainTags, tagPackKeys: categoryPackKeys(String(key))
})) as OpeningTaxonomyCategory[];

function subject(packKeys: string[], ...names: string[]): OpeningSubjectOption[] {
  return names.map((name) => ({ name, packKeys }));
}

// “题材”只保存平台分类级或跨分类的大方向。副本、排行榜、装备品质等
// 书内机制继续留在完整标签库和设定，不得混入开书题材选择。
const subjects: OpeningSubjectOption[] = [
  ...subject(['fantasy'], '玄幻脑洞', '传统玄幻', '东方玄幻', '异世大陆', '王朝争霸', '高武世界', '洪荒神话', '灵气复苏', '御兽'),
  ...subject(['xianxia', 'fantasy'], '东方仙侠', '奇幻仙侠', '古典仙侠', '修真文明', '幻想修仙', '现代修真', '神话修真'),
  ...subject(['history'], '历史古代', '历史脑洞', '架空历史', '秦汉三国', '两晋隋唐', '五代十国', '两宋元明', '清史民国', '外国历史', '朝堂江湖'),
  ...subject(['history'], '军事战争', '军旅生涯', '战争幻想', '抗战烽火', '谍战特工', '抗战谍战'),
  ...subject(['game'], '游戏异界', '虚拟网游', '电子竞技', '游戏竞技', '体育赛事', '篮球运动', '足球运动'),
  ...subject(['urban'], '都市脑洞', '都市生活', '都市日常', '异术超能', '都市高武', '都市修真', '都市种田', '青春校园', '商战职场', '娱乐明星', '现实生活'),
  ...subject(['lord'], '领主争霸', '种田经营', '基建发展'),
  ...subject(['business'], '商业经营'),
  ...subject(['suspense'], '悬疑脑洞', '悬疑灵异', '侦探推理', '诡秘悬疑', '民俗悬疑', '规则怪谈', '盗墓探险', '奇妙世界'),
  ...subject(['scifi', 'apocalypse'], '科幻末世', '未来世界', '星际文明', '古武机甲', '超级科技', '进化变异', '时空穿梭', '赛博朋克', '废土求生'),
  ...subject(['western_fantasy'], '西方奇幻', '史诗奇幻', '剑与魔法', '黑暗幻想', '现代魔法', '历史神话'),
  ...subject(['martial'], '传统武侠', '武侠幻想', '国术无双'),
  ...subject(['romance'], '古代言情', '现代言情', '古言脑洞', '现言脑洞', '玄幻言情', '仙侠奇缘', '豪门总裁', '宫斗宅斗', '青春甜宠', '悬疑恋爱', '年代婚恋'),
  ...subject(['system', 'infinite'], '系统流', '无限流', '诸天万界', '快穿', '穿书'),
  ...subject(['reality', 'era'], '现实题材', '社会乡土', '生活时尚', '文学艺术', '成功励志', '年代'),
  ...subject(['common'], '穿越', '重生'),
  ...subject(['derivative'], '动漫衍生', '影视衍生', '男频衍生', '女频衍生', '轻小说')
];
const allSelectableTags = [...new Set(OPENING_TAG_GROUPS.flatMap((group) => [
  ...group.mainTags,
  ...group.auxiliaryTags,
  ...group.storyTraits
]))];

const personalityGroups: OpeningPersonalityGroup[] = [
  {
    key: 'surface',
    name: '外在气质',
    description: '别人初见这个角色时最容易感受到的一面。',
    options: ['冷静', '沉稳', '热情', '温柔', '克制', '幽默', '毒舌', '疏离', '亲和', '骄傲', '叛逆', '慢热']
  },
  {
    key: 'decision',
    name: '思考与决策',
    description: '角色遇到问题时怎样观察、判断和行动。',
    options: ['理性', '敏锐', '果断', '谨慎', '多疑', '冲动', '务实', '理想主义', '善于谋划', '随机应变', '执拗', '优柔寡断']
  },
  {
    key: 'drive',
    name: '核心驱动力',
    description: '真正推动角色长期选择的内在需要。',
    options: ['野心勃勃', '责任感强', '渴望认可', '追求自由', '重视公平', '强烈求知欲', '保护欲强', '复仇心重', '害怕失去', '渴望归属', '证明自己', '守护承诺']
  },
  {
    key: 'relationship',
    name: '人际模式',
    description: '角色怎样信任、靠近、合作或对抗别人。',
    options: ['重情重义', '外冷内热', '嘴硬心软', '敢爱敢恨', '独立疏离', '善于共情', '控制欲强', '讨好型', '戒备心强', '慕强', '护短', '社牛', '社恐']
  },
  {
    key: 'pressure',
    name: '压力反应',
    description: '危险、失败和失控时会暴露的真实反应。',
    options: ['越挫越勇', '临危不乱', '逞强硬撑', '逃避拖延', '自我怀疑', '迁怒他人', '极端冒险', '过度控制', '沉默封闭', '以笑掩饰', '先保全再反击', '宁折不弯']
  },
  {
    key: 'moral',
    name: '道德边界',
    description: '角色愿意做什么、绝不会做什么，以及底线如何被考验。',
    options: ['善良有底线', '杀伐果断', '原则至上', '结果至上', '恩怨分明', '宽容克制', '睚眦必报', '利益优先', '不伤无辜', '愿为大局牺牲', '绝不背叛', '底线会随代价动摇']
  },
  {
    key: 'contradiction',
    name: '矛盾与成长面',
    description: '让人物不扁平的内外反差、缺点或潜在变化。',
    options: ['自信但怕失败', '强势却缺乏安全感', '善良但不敢拒绝', '聪明却过度自负', '勇敢但容易冲动', '理性却不懂表达', '渴望亲密又害怕依赖', '追求正义却手段激进', '看似随和实则固执', '看似冷漠实则重情', '会从自保走向担当', '会从依赖走向独立']
  }
];

export const OPENING_TAXONOMY: OpeningTaxonomy = {
  version: 'wenmi-single-category-subject-library-2026-08-10-v7',
  sourceLabel: '起点与番茄公开分类整理＋文秘写作动态词条库',
  sourceUrl: 'https://fanqienovel.com/',
  updatedAt: '2026-08-01',
  notice: '分类依据公开页面整理并在本地版本化，不代表平台永久不变；主要选择只定方向，其他元素可随剧情自由创作。',
  categories: [...maleCategories, ...femaleCategories],
  mainTags: allSelectableTags,
  // 保留旧细粒度题材的合同兼容，避免旧草稿失效；Web只展示上面的精选大题材。
  auxiliaryTags: [...new Set([
    ...subjects.map((item) => item.name),
    ...[...maleCategories, ...femaleCategories].map((item) => item.name),
    ...uniqueTagValues(OPENING_TAG_GROUPS, 'auxiliary')
  ])],
  storyTraits: uniqueTagValues(OPENING_TAG_GROUPS, 'trait'),
  personalityOptions: [...new Set(personalityGroups.flatMap((group) => group.options))],
  personalityGroups,
  boundaryGroups: [
    {
      name: '感情与关系',
      description: '只选择作者明确不接受的关系走向。',
      options: ['不写后宫', '不写多角恋', '不写出轨', '不写强制爱', '不写追妻火葬场', '感情线不喧宾夺主']
    },
    {
      name: '主角体验',
      description: '避免把爽点偏好误当成每章任务。',
      options: ['不虐主', '不降智', '不圣母', '不洗白恶人', '不靠误会强推剧情', '不使用系统金手指']
    },
    {
      name: '内容尺度',
      description: '系统安全与平台合规始终生效，这里只记录作品额外边界。',
      options: ['不写露骨情色', '不写血腥猎奇', '不写未成年人恋爱', '不写现实政治映射', '不写宗教神秘化', '不写真实人物影射']
    },
    {
      name: '结构与结局',
      description: '只约束明确结局底线，不提前锁死过程。',
      options: ['不写开放式结局', '不写悲剧结局', '不写烂尾式跳时', '不写梦境式翻盘', '不写主角团灭', '不写机械式重复升级']
    }
  ],
  tagGroups: OPENING_TAG_GROUPS,
  subjects
};

const protagonistRoles = new Set<ProtagonistRole>(['male_lead', 'female_lead', 'co_lead', 'ensemble', 'non_human', 'male_support', 'female_support', 'male_villain', 'female_villain']);

export function validateOpeningBlueprint(input: OpeningBlueprintInput): OpeningBlueprintInput {
  const creationMode = input.creationMode ?? 'new';
  if (creationMode !== 'new' && creationMode !== 'continuation') throw new Error('创作方式必须选择从零创作或已有正文续写');
  if (input.taxonomyVersion !== OPENING_TAXONOMY.version) throw new Error('开书分类目录版本无效或已经过期，请刷新后重试');
  if (input.channel !== 'male' && input.channel !== 'female') throw new Error('创作频道必须选择男频或女频');
  const category = OPENING_TAXONOMY.categories.find((item) => item.key === input.categoryKey);
  if (category === undefined) throw new Error('作品分类不存在，请从当前分类目录重新选择');
  if (category.channel !== input.channel) throw new Error('作品分类不属于当前频道，请重新选择');
  const auxiliaryCategoryKeys = uniqueTexts(input.auxiliaryCategoryKeys ?? [], '旧版辅助分类', 0, 3, 100);
  const legacySubjects: string[] = [];
  if (auxiliaryCategoryKeys.includes(category.key)) throw new Error('主分类不能同时作为辅助分类（旧版兼容字段）');
  for (const key of auxiliaryCategoryKeys) {
    const auxiliary = OPENING_TAXONOMY.categories.find((item) => item.key === key);
    if (auxiliary === undefined) throw new Error(`辅助分类不存在：${key}`);
    if (auxiliary.channel !== input.channel) throw new Error('辅助分类不属于当前频道，请重新选择');
    legacySubjects.push(auxiliary.name);
  }
  if (input.protagonists !== undefined && (!Array.isArray(input.protagonists) || input.protagonists.length > 8)) {
    throw new Error('初始主角最多8位');
  }
  const protagonists = (input.protagonists ?? []).map((item, index) => {
    if (!protagonistRoles.has(item.role)) throw new Error(`第${index + 1}位主角的身份类型无效`);
    const name = requiredText(item.name, `第${index + 1}位主角姓名`, 80);
    const age = requiredText(item.age, `第${index + 1}位主角年龄`, 80);
    const background = optionalText(item.background, `第${index + 1}位主角人物背景`, 2_000);
    const familyBackground = optionalText(item.familyBackground, `第${index + 1}位主角家庭背景`, 2_000);
    const careerBackground = optionalText(item.careerBackground, `第${index + 1}位主角职业背景`, 2_000);
    const goldenFinger = optionalText(item.goldenFinger, `第${index + 1}位主角金手指`, 2_000);
    const personalities = uniqueTexts(item.personalities, `第${index + 1}位主角性格`, 1, 8, 40);
    return { role: item.role, name, age, background, familyBackground, careerBackground, goldenFinger, personalities };
  });
  if (protagonists.length < 1) throw new Error('请至少填写一位主角的姓名、年龄、家庭背景和性格');
  if (new Set(protagonists.map((item) => item.name)).size !== protagonists.length) throw new Error('初始主角姓名不能重复');
  const storyDirection = requiredText(input.storyDirection, '故事方向', 800);
  if (storyDirection.length < 20) throw new Error('故事方向至少需要20个字符，请写清开篇处境、启动事件、主角目标和主要阻力');
  if (Array.isArray(input.mainTags)) {
    const distinctMainTags = new Set(input.mainTags
      .map((item) => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean));
    if (distinctMainTags.size < 2) throw new Error('主要标签至少选择2个');
  }
  const mainTags = uniqueTexts(input.mainTags, '主要标签', 2, OPENING_TAXONOMY.mainTags.length, 40);
  for (const tag of mainTags) {
    if (!OPENING_TAXONOMY.mainTags.includes(tag)) throw new Error(`主要标签不在当前目录：${tag}`);
  }
  const auxiliaryTags = uniqueTexts(
    [...input.auxiliaryTags, ...legacySubjects],
    '题材',
    0,
    auxiliaryCategoryKeys.length > 0 ? 11 : 8,
    40
  );
  for (const tag of auxiliaryTags) {
    if (!OPENING_TAXONOMY.auxiliaryTags.includes(tag)) throw new Error(`题材不在当前目录；如需自定义请放入自定义标签：${tag}`);
  }
  const storyTraits = uniqueTexts(input.storyTraits, '全书特点', 0, 11, 40);
  for (const tag of storyTraits) {
    if (!OPENING_TAXONOMY.storyTraits.includes(tag)) throw new Error(`全书特点不在当前目录；如需自定义请放入自定义标签：${tag}`);
  }
  const styleIntent = {
    languageTones: uniqueTexts(input.styleIntent?.languageTones ?? [], '可用语言气质', 0, 8, 40),
    emotionalTones: uniqueTexts(input.styleIntent?.emotionalTones ?? [], '可用情绪色彩', 0, 8, 40),
    pacingAndPayoff: uniqueTexts(input.styleIntent?.pacingAndPayoff ?? [], '可用节奏策略', 0, 8, 40),
    atmospheres: uniqueTexts(input.styleIntent?.atmospheres ?? [], '叙事氛围', 0, 8, 40),
    custom: uniqueTexts(input.styleIntent?.custom ?? [], '自定义风格', 0, 12, 80)
  };
  const validated: OpeningBlueprintInput = {
    creationMode,
    taxonomyVersion: input.taxonomyVersion,
    channel: input.channel,
    categoryKey: input.categoryKey,
    ...(auxiliaryCategoryKeys.length > 0 ? { auxiliaryCategoryKeys } : {}),
    // 旧书和旧客户端继续保留该字段；新书入口不再要求作者预判目标读者。
    targetAudience: optionalText(input.targetAudience, '目标读者', 500),
    protagonists,
    storyDirection,
    worldBackground: optionalText(input.worldBackground, '世界观背景', 10_000),
    openingBackground: optionalText(input.openingBackground, '故事起始背景', 10_000),
    stageOne: {
      start: optionalText(input.stageOne?.start, '第一阶段起始剧情', 10_000),
      development: optionalText(input.stageOne?.development, '第一阶段发展剧情', 10_000),
      end: optionalText(input.stageOne?.end, '第一阶段结束剧情', 10_000)
    },
    fullBookOutline: optionalText(input.fullBookOutline, '全书简介（故事主线和结果）', 20_000),
    mainTags,
    auxiliaryTags,
    storyTraits,
    styleIntent,
    customTags: uniqueTexts(input.customTags, '自定义标签', 0, 13, 40),
    initialMap: optionalText(input.initialMap, '初始地图', 5_000),
    mustFollow: uniqueTexts(input.mustFollow, '必须遵守', 1, 15, 500)
  };
  if (JSON.stringify(validated).length > 18_000) {
    throw new Error('开书资料总量不能超过18,000个字符，请保留确定信息并把细节留到后续讨论');
  }
  return validated;
}

function optionalText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error(`${label}格式无效`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label}不能超过${maxLength}个字符`);
  return text;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空；尚未决定可明确填写“待讨论”`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label}不能超过${maxLength}个字符`);
  return text;
}

function uniqueTexts(value: unknown, label: string, min: number, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}格式无效`);
  const items = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))];
  if (items.length < min || items.length > max) throw new Error(`${label}需要选择${min}至${max}个`);
  if (items.some((item) => item.length > maxLength)) throw new Error(`${label}单项不能超过${maxLength}个字符`);
  return items;
}
