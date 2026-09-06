import type { V7SettingCatalogItem } from './setting-agent-contracts.js';

type Seed = [key: string, label: string, prompt: string, required?: boolean, deputy?: boolean];
type Group = { key: string; title: string; source: string; match?: RegExp; forbiddenMatch?: RegExp; items: Seed[] };

const GROUPS: readonly Group[] = [
  { key: 'core', title: '核心设定', source: '通用', items: [
    ['world-stage', '世界舞台', '故事发生在什么时代、什么样的世界？空间、生活条件和整体氛围是什么？', true],
    ['social-order', '社会运行与秩序', '普通人怎样生活，资源与权力怎样分配，制度为何能够长期运转？', true, true],
    ['rules-costs', '规矩与代价', '世界运转的关键规矩是什么？得到好处必须付出什么代价？什么事绝对做不到？', true],
    ['boundaries-blanks', '边界与留白', '哪些规则必须遵守，哪些区域、机制或历史真相暂时不能擅自补全？', true]
  ] },
  { key: 'world', title: '世界与环境', source: '通用', items: [
    ['world-layer', '世界层级与空间结构', '世界由哪些层级、位面、区域或服务器构成？'],
    ['geography', '地理地图与交通边界', '重要区域怎样分布、如何往来，交通受什么客观限制？', true],
    ['civilization', '文明、科技与生产水平', '文明和科技发展到什么程度，哪些能力普及或稀缺？', false, true],
    ['history', '历史背景与历法', '哪些历史事件塑造了当下，各方如何记录时间？', false, true],
    ['hazards', '灾难、禁区与自然限制', '环境中有哪些不可忽视的危险、禁区和客观限制？']
  ] },
  { key: 'society', title: '社会与秩序', source: '通用', items: [
    ['governance', '政权、法律与治理', '谁制定规则，法律如何执行，违规的真实代价是什么？', true, true],
    ['class', '阶层、身份与流动', '身份如何取得，阶层能否流动，特权与义务怎样对应？'],
    ['culture', '文化、宗教与禁忌', '礼俗、宗教和社会禁忌如何约束公共生活？'],
    ['education', '教育与知识传承', '知识、技能和秘密通过什么体系传播与垄断？'],
    ['information', '信息传播与舆论', '消息传播速度、可信度和控制权分别如何？'],
    ['language-naming', '语言、称谓与命名制度', '不同地区、阶层和族群遵循什么语言、称谓与命名制度？']
  ] },
  { key: 'growth', title: '力量与成长', source: '通用', items: [
    ['power-source', '力量来源', '力量从哪里来，谁可以获得，是否能被夺取或继承？', true],
    ['levels', '等级、境界与晋升', '成长阶段如何划分，晋升需要什么条件并带来什么变化？', true],
    ['abilities', '能力、特性与技能', '主动、被动、天赋和职业能力分别遵守什么规则？'],
    ['costs', '消耗、代价与限制', '使用力量消耗什么，失败和过度使用会造成什么后果？', true],
    ['counters', '克制、免疫与平衡', '哪些反制能防止能力无限膨胀？'],
    ['death', '死亡、复活与继承', '死亡是否可逆，复活、继承和损失分别遵守什么规则？']
  ] },
  { key: 'organization', title: '势力与组织', source: '通用', items: [
    ['factions', '组织类型与利益基础', '存在哪些组织类型，各自依靠什么制度、资源和利益长期存在？', true],
    ['structure', '组织结构与权力来源', '组织如何决策、晋升和监督，权力怎样取得与约束？'],
    ['military', '军队、兵种与武装体系', '武装力量如何组织、补给、训练和承担损失？', false, true],
    ['diplomacy', '组织间合作与冲突规则', '组织间合作、契约和冲突遵守哪些规则？']
  ] },
  { key: 'resources', title: '物品、经济与资源', source: '通用', items: [
    ['currency', '货币、价格与交易', '价值如何衡量，信用和货币由谁保证？'],
    ['production', '生产、产出与消耗', '关键资源怎样生产、运输、储存和消耗？', true],
    ['equipment', '装备、道具与品阶', '装备如何分类、获得、损坏、升级和流通？'],
    ['scarcity', '稀缺资源与争夺规则', '真正稀缺的资源是什么，为什么不能无限复制？'],
    ['formula', '属性与计算方法', '哪些数值需要精确计算？单位、范围和取整规则是什么？', false, true]
  ] },
  { key: 'conflict', title: '冲突与战术', source: '通用', items: [
    ['combat', '战斗与胜负规则', '战斗如何判定优势和胜负，环境、信息和士气怎样影响结果？'],
    ['tactics', '主流战术与团队分工', '常见战术、职业分工和反制是什么？'],
    ['war', '战争、补给与损失', '大规模冲突如何动员、补给、结算伤亡并承担后果？', false, true],
    ['investigation', '调查、证据与信息差', '事实如何查明，证据如何验证，谁有权接触哪些信息？', false, true]
  ] },
  { key: 'history-extension', title: '历史与架空', source: '历史扩展', match: /历史|古代|三国|架空/u, forbiddenMatch: /(?:不要|不得|禁止|不写|不设|不允许|排除|去掉)[^。；\n]{0,24}(?:历史|古代|三国|架空)/u, items: [
    ['history-baseline', '历史基线', '故事以哪段历史为基线，哪些事实必须保持一致？', true, true],
    ['divergence', '架空分歧点', '世界从哪个事件开始偏离历史，直接和长期影响是什么？', true, true],
    ['politics-military', '政治、官制与军制', '权力、行政和军事制度如何真实运转？', false, true],
    ['technology-spread', '技术传播与时代限制', '技术改进需要哪些前置条件，传播速度和阻力是什么？', false, true],
    ['historical-names', '年代、地名与称谓校验', '年代、称谓和地名遵循什么资料基线？', false, true]
  ] },
  { key: 'game-extension', title: '游戏规则', source: '游戏扩展', match: /游戏|电竞|网游|系统/u, forbiddenMatch: /(?:不要|不得|禁止|不写|不设|不允许|排除|去掉)[^。；\n]{0,24}(?:游戏|电竞|网游)/u, items: [
    ['game-entry', '进入游戏世界', '怎样进入游戏世界，现实与游戏之间有哪些边界？', true],
    ['player-npc', '玩家与NPC规则', '玩家和NPC怎样识别、互动，死亡承担什么后果？', true],
    ['game-panel', '属性面板与数据可见性', '哪些属性可见，谁能查看，信息能否伪装？', true],
    ['class-skill', '职业、转职与技能树', '职业如何获得、成长、转职和组合？', true],
    ['loot', '装备、掉落与绑定', '物品如何掉落、交易、绑定和回收？', true],
    ['quest-instance', '任务、副本与奖励', '任务和副本如何失败、重置和结算？'],
    ['ranking', '排行榜、赛季与竞技', '榜单怎样计算并防止刷榜？']
  ] },
  { key: 'fantasy-extension', title: '超凡体系', source: '超凡扩展', match: /玄幻|仙侠|修仙|奇幻|魔法|超凡/u, forbiddenMatch: /(?:不要|不得|禁止|不写|不设|不允许|排除|去掉)[^。；\n]{0,24}(?:玄幻|仙侠|修仙|奇幻|魔法|超凡)/u, items: [
    ['cultivation', '功法、修炼与传承', '修炼体系如何学习、传承、改进和走火入魔？'],
    ['bloodline', '血脉、体质与天赋', '先天条件怎样影响成长，能否改变，代价是什么？'],
    ['treasures', '丹药、法宝与天材地宝', '超凡资源如何分级、获得、炼制和限制使用？'],
    ['causality', '天劫、因果与气运', '这些力量怎样作用，又有哪些事绝对做不到？']
  ] },
  { key: 'mystery-extension', title: '悬疑调查', source: '悬疑扩展', match: /悬疑|推理|探案|灵异/u, forbiddenMatch: /(?:不要|不得|禁止|不写|不设|不允许|排除|去掉)[^。；\n]{0,24}(?:悬疑|推理|探案|灵异)/u, items: [
    ['case-rules', '犯罪条件与侦查边界', '侦查权限、技术和程序的能力边界是什么？', false, true],
    ['evidence-chain', '证据链与验证规则', '哪些证据有效，如何验证、污染、隐藏或误导？', false, true]
  ] },
  { key: 'scifi-extension', title: '科技与未来', source: '科幻扩展', match: /科幻|末世|星际|未来|赛博|机甲/u, forbiddenMatch: /(?:不要|不得|禁止|不写|不设|不允许|排除|去掉)[^。；\n]{0,24}(?:科幻|末世|星际|未来|赛博|机甲)/u, items: [
    ['technology-boundary', '核心科技边界', '核心科技能做什么、不能做什么，需要哪些前提？', true, true],
    ['science-cost', '技术代价与失效条件', '能源、维护、伦理和失效代价是什么？', true, true],
    ['social-impact', '科技的社会影响', '科技怎样改变职业、阶层、治理与战争？', false, true],
    ['space-rules', '空间、星域与航行规则', '距离、通信、航行和补给遵守什么限制？', false, true]
  ] },
  { key: 'lord-extension', title: '领地经营', source: '领地扩展', match: /领主|种田|经营|基建/u, forbiddenMatch: /(?:不要|不得|禁止|不写|不设|不允许|排除|去掉)[^。；\n]{0,24}(?:领主|种田|经营|基建)/u, items: [
    ['territory', '领地、城市与建筑等级', '领地和建筑如何升级，成本和时间是什么？', true],
    ['population', '人口、民心与劳动力', '人口如何增长、迁移和分工？', true],
    ['army', '军队、兵种与编制', '军队如何招募、训练、补给和承担伤亡？', true, true],
    ['yield', '资源产出与生产队列', '产出如何计算，生产队列受什么限制？', true, true]
  ] }
] as const;

export const V7_SETTING_CATALOG: readonly V7SettingCatalogItem[] = GROUPS.flatMap((group) => group.items.map(([key, label, prompt, required = false, deputy = false]) => ({
  key, label, prompt, source: group.source, groupKey: group.key, groupTitle: group.title, required,
  deputyPolicy: deputy ? 'conditional' : 'never'
})));

export function activeSettingCatalog(positiveProfileText: string, forbiddenText = ''): V7SettingCatalogItem[] {
  const activeGroups = GROUPS.filter((group) => {
    if (group.match === undefined) return true;
    if (!group.match.test(positiveProfileText)) return false;
    return group.forbiddenMatch === undefined || !group.forbiddenMatch.test(forbiddenText);
  });
  return activeGroups.flatMap((group) => V7_SETTING_CATALOG.filter((item) => item.groupKey === group.key));
}

export function settingItemByKey(key: string): V7SettingCatalogItem | undefined {
  return V7_SETTING_CATALOG.find((item) => item.key === key);
}

export function deputyNeeded(item: V7SettingCatalogItem, authorNote: string): boolean {
  // 普通设定由一名强模型直接处理，不能因为条目属于历史、制度或科技
  // 就自动再派一名副编重复阅读。只有作者本轮明确要求查证/考据时，
  // 才增加一次资料核对；题材本身不再触发额外调用。
  return item.deputyPolicy === 'conditional'
    && /请(?:帮我)?(?:查证|核实|考据|查资料)|需要(?:查证|核实|考据)|史实是否准确/u.test(authorNote);
}
