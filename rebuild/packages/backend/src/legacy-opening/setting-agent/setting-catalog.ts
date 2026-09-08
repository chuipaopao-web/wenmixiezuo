import type { V7SettingCatalogItem } from './setting-agent-contracts.js';

/** One cross-genre catalog. Applicability is decided from the book, not keywords. */
const TOPICS = [
  [
    "world-stage",
    "时代与世界性质",
    "合并世界舞台、历史基线、架空分歧点，明确真实历史、架空、现代或超凡等基本前提。"
  ],
  [
    "geography",
    "空间、地理与通行",
    "合并世界层级、地理地图、交通边界、星域与航行，统一说明在哪里、怎样到达。"
  ],
  [
    "hazards",
    "自然环境与危险",
    "收纳气候、生态、灾难、禁区；与地理位置分开，不重复世界环境。"
  ],
  [
    "civilization",
    "文明与技术边界",
    "合并文明生产水平、核心科技、技术传播及技术社会影响。"
  ],
  [
    "history",
    "历史与时间基准",
    "合并历史背景、历法、年代；与世界性质分开。"
  ],
  [
    "governance",
    "治理、法律与公共制度",
    "合并社会秩序、政权法律、官制；取消重复社会总述。"
  ],
  [
    "class",
    "身份、地位与社会流动",
    "身份、资格、阶层及社会晋升；普通职业发展也适用。"
  ],
  [
    "factions",
    "组织运作与利益关系",
    "组织类型、利益基础、内部权力、组织间合作与冲突。"
  ],
  [
    "culture",
    "文化、信仰与日常习俗",
    "宗教、礼俗、禁忌、家庭与社会习惯，适配现实、言情等题材。"
  ],
  [
    "language-naming",
    "语言、称谓与命名",
    "合并语言命名制度、历史称谓校验；年代归时间，地名归地理。"
  ],
  [
    "education",
    "教育、知识与传承",
    "教育渠道、知识垄断、传承方式；具体功法效果不在此重复。"
  ],
  [
    "information",
    "信息传播与舆论",
    "传播渠道、速度、可信度、公开与私下情报渠道。"
  ],
  [
    "currency",
    "货币、价格与交易",
    "货币、信用、交易条件；具体物品价格引用物品记录。"
  ],
  [
    "production",
    "生产、人口与资源供给",
    "生产消耗、稀缺资源、人口劳动力、领地生产与建设条件。"
  ],
  [
    "power-source",
    "特殊能力的来源与资格",
    "力量来源、血脉、体质、先天天赋；无特殊能力时可不启用。"
  ],
  [
    "levels",
    "学习、成长与晋升机制",
    "境界等级、职业转职、修炼及技能获取；不强迫现实题材设置数值等级。"
  ],
  [
    "abilities",
    "能力效果、代价与反制",
    "能力技能、消耗限制、克制免疫、因果气运的具体作用规则。"
  ],
  [
    "death",
    "伤病、死亡与恢复",
    "死亡复活、治疗、恢复条件及损失，按世界类型适配。"
  ],
  [
    "equipment",
    "物品、装备与特殊资源",
    "装备品阶、掉落绑定、丹药法宝、损坏升级与流通。"
  ],
  [
    "military",
    "武装、战争与补给",
    "军队兵种、编制、招募训练、战争动员、补给与伤亡。"
  ],
  [
    "combat",
    "行动、竞争与胜负条件",
    "战斗、战术、团队分工、竞技规则；商业和体育竞争按本书需要设计。"
  ],
  [
    "investigation",
    "调查、证据与知情边界",
    "调查权限、证据链、验证污染、信息差，保留谁知道什么的约束。"
  ],
  [
    "game-entry",
    "本书特殊运行机制",
    "游戏入口、玩家/NPC、面板、任务副本、特殊系统等；每种独立机制单独记录。"
  ],
  [
    "formula",
    "数值、单位与计算口径",
    "属性公式、单位、结算、取整；其他主题引用，不重复维护计算规则。"
  ]
] as const;

export const V7_SETTING_CATALOG: readonly V7SettingCatalogItem[] = TOPICS.map(([key,label,prompt],i) => ({
  key,label,prompt:prompt+'只确定本主题的必要规则；已有事实引用，不重复。条件、例外和代价与规则一起表达。无此机制则标明不适用，不能为了完整而创造。',
  source:'统一主题',groupKey:i<5?'world':i<12?'society':i<14?'resources':i<18?'growth':i===18?'resources':i<22?'action':'mechanism',
  groupTitle:i<5?'世界与环境':i<12?'社会与生活':i<14?'经济与资源':i<18?'能力与生命':i===18?'经济与资源':i<22?'行动与冲突':'特殊机制与计算',
  required:false,deputyPolicy:'conditional'
}));

/** Read old task keys without resurrecting duplicate choices in the new catalog. */
export const SETTING_TOPIC_ALIASES: Readonly<Record<string,string>> = {
 'social-order':'governance','rules-costs':'abilities','boundaries-blanks':'world-stage','world-layer':'geography',
 'history-baseline':'world-stage','divergence':'world-stage','politics-military':'governance','technology-spread':'civilization',
 'historical-names':'language-naming','costs':'abilities','counters':'abilities','structure':'factions','diplomacy':'factions',
 'scarcity':'production','tactics':'combat','war':'military','player-npc':'game-entry','game-panel':'game-entry',
 'class-skill':'levels','loot':'equipment','quest-instance':'game-entry','ranking':'combat','cultivation':'levels',
 'bloodline':'power-source','treasures':'equipment','causality':'abilities','case-rules':'investigation',
 'evidence-chain':'investigation','technology-boundary':'civilization','science-cost':'civilization','social-impact':'civilization',
 'space-rules':'geography','territory':'production','population':'production','army':'military','yield':'production'
};
export function activeSettingCatalog(_positiveProfileText: string, _forbiddenText = ''): V7SettingCatalogItem[] {
  return V7_SETTING_CATALOG.map(item=>({...item}));
}
export function settingTopicKey(key: string): string { return SETTING_TOPIC_ALIASES[key] ?? key; }
export function settingItemByKey(key:string): V7SettingCatalogItem | undefined {
  const item=V7_SETTING_CATALOG.find(item=>item.key===settingTopicKey(key));
  return item ? {...item,key} : undefined;
}
export function deputyNeeded(item:V7SettingCatalogItem,authorNote:string):boolean {
  return item.deputyPolicy==='conditional' && /请(?:帮我)?(?:查证|核实|考据|查资料)|需要(?:查证|核实|考据)|史实是否准确/u.test(authorNote);
}
