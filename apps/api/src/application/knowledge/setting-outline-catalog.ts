import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import {
  resolveContinuationSettingOutlineProfile,
  resolveSettingOutlineProfile,
  type SettingOutlineProfile
} from './setting-outline-profile.js';

export interface SettingOutlineTemplateItem {
  itemKey: string;
  groupTitle: string;
  label: string;
  prompt: string;
  sourceLabel: string;
  required: boolean;
  sortOrder: number;
}

type Metadata = Omit<SettingOutlineTemplateItem, 'itemKey' | 'required' | 'sortOrder'>;

const CATALOG: Record<string, Metadata> = {
  'story-kernel': item('可选方向', '长期吸引力', '如果已经想清楚，可以写下读者长期追更会获得什么满足；没想好可以留到第一卷一起设计。'),
  'world-stage': item('核心设定', '世界舞台', '故事发生在什么时代、什么样的世界？主角开场在哪里活动？这个世界的整体面貌和氛围是什么？'),
  'protagonist-situation': item('核心设定', '主角底板', '主角的身份、能力基础、性格驱动力、日常处境和绝不越过的底线是什么？这里只定人物底板，不提前规定具体剧情。'),
  opposition: item('早期条目', '旧版对立方向', '这项内容已由分卷阶段承担；旧书已填写内容继续保留为卷设计参考。'),
  'rules-costs': item('核心设定', '规矩与代价', '这个世界运转的关键规矩是什么（力量、社会、行业都行）？得到好处必须付出什么代价？什么事再急也做不到？'),
  'boundaries-blanks': item('核心设定', '边界与留白', '哪些内容是作者明确要求必须遵守或绝不能写的？哪些谜题和空白要刻意留给后文，不能提前解释？'),
  geography: item('世界与环境', '地理地图与初始地点', '核心地理结构、交通边界和主角初始活动区域是什么？'),
  civilization: item('世界与环境', '文明、科技与生产水平', '文明和科技发展到什么程度，哪些能力普及或稀缺？'),
  history: item('世界与环境', '历史背景与历法', '哪些历史事件塑造了当下，各方如何记录时间？'),
  hazards: item('世界与环境', '灾难、禁区与自然限制', '环境中有哪些不可忽视的危险、禁区和客观限制？'),
  'strength-flaw': item('人物与命名', '优势、缺陷与成长边界', '主角的可靠优势、真实缺陷和不能无代价突破的边界是什么？'),
  supporting: item('人物与命名', '配角类型与功能边界', '需要哪些人物类型，如何避免配角只成为主角工具？'),
  relations: item('人物与命名', '人物关系基本原则', '亲缘、利益、情感和权力关系由哪些长期因素维持或改变？'),
  'relationship-premise': item('人物关系', '核心关系与吸引基础', '核心人物因什么持续接触并产生不可替代的吸引？', '言情扩展'),
  'relationship-obstacle': item('人物关系', '关系阻力与不可速解矛盾', '阻碍关系发展的矛盾是什么，为什么不能靠一次坦白解决？', '言情扩展'),
  'relationship-growth': item('人物关系', '关系变化与双向成长', '双方的信任、依赖和边界如何逐步改变？', '言情扩展'),
  'emotional-boundaries': item('人物关系', '情感边界与相处原则', '这段关系明确不能越过哪些人格、伦理和表达边界？', '言情扩展'),
  'life-circle': item('都市生活', '生活圈、职业与日常压力', '工作、家庭和社交关系如何持续影响人物选择？', '都市扩展'),
  class: item('社会与秩序', '阶层、身份与流动', '身份如何取得，阶层能否流动，特权与义务怎样对应？'),
  culture: item('社会与秩序', '文化、礼俗与禁忌', '共同信念、礼俗和禁忌如何影响人物选择？'),
  information: item('社会与秩序', '信息传播与舆论', '消息传播速度、可信度和控制权分别如何？'),
  'game-entry': item('游戏规则', '游戏世界接入方式', '通过头盔、穿越、现实融合还是其他方式进入，边界是什么？', '游戏扩展'),
  'player-npc': item('游戏规则', '玩家与NPC边界', '玩家和NPC如何识别、互动、死亡和承担后果？', '游戏扩展'),
  'game-panel': item('游戏规则', '属性面板与数据可见性', '哪些属性可见，谁能查看，信息是否可能伪装或延迟？', '游戏扩展'),
  'class-skill': item('游戏规则', '职业、转职与技能树', '职业如何获得、成长、转职和组合，技能如何学习？', '游戏扩展'),
  loot: item('游戏规则', '装备、掉落与绑定规则', '物品如何掉落、交易、绑定、强化、损坏和回收？', '游戏扩展'),
  levels: item('力量与成长', '等级、境界与晋升', '成长阶段如何划分，晋升需要什么条件并带来什么变化？'),
  costs: item('力量与成长', '消耗、代价与限制', '使用力量消耗什么，失败和过度使用会造成什么后果？'),
  abilities: item('力量与成长', '能力、特性与技能', '主动、被动、天赋和职业能力分别遵守什么规则？'),
  equipment: item('物品与资源', '装备、道具与品阶', '装备道具如何分类、获得、损坏、升级和流通？'),
  'quest-instance': item('游戏规则', '任务、副本与奖励', '任务和副本如何生成、失败、重置并结算奖励？', '游戏扩展'),
  ranking: item('游戏规则', '排行榜、赛季与竞技', '榜单计算什么，怎样防刷榜，赛季重置会保留什么？', '游戏扩展'),
  'power-source': item('力量与成长', '力量来源', '力量从哪里来，谁可以获得，是否能够被夺取或继承？'),
  factions: item('势力与组织', '国家、阵营与主要势力', '主要势力分别追求什么，依靠什么资源存在？'),
  counters: item('力量与成长', '克制、免疫与平衡', '哪些反制可以防止能力无限膨胀？'),
  cultivation: item('超凡体系', '功法、修炼与传承', '修炼体系如何学习、传承、改进和走火入魔？', '超凡扩展'),
  bloodline: item('超凡体系', '血脉、体质与天赋', '先天条件如何影响成长，能否改变，代价是什么？', '超凡扩展'),
  treasures: item('超凡体系', '丹药、法宝与天材地宝', '超凡资源如何分级、获得、炼制和限制使用？', '超凡扩展'),
  causality: item('超凡体系', '天劫、因果与气运', '超自然约束如何作用且避免成为万能解释？', '超凡扩展'),
  'history-baseline': item('历史与架空', '历史基线', '故事以哪段历史为基线，哪些事实必须保持一致？', '历史扩展'),
  governance: item('社会与秩序', '政权、法律与治理', '谁制定规则，法律如何执行，违规的真实代价是什么？'),
  'politics-military': item('历史与架空', '政治、官制与军制', '权力、行政和军事制度如何真实运转？', '历史扩展'),
  'technology-spread': item('历史与架空', '技术传播与时代限制', '技术改进需要哪些前置条件，传播速度和阻力是什么？', '历史扩展'),
  'historical-names': item('历史与架空', '年代、地名与人物校验', '年代、称谓、地名和历史人物如何保持可核对？', '历史扩展'),
  divergence: item('历史与架空', '架空分歧点', '世界从哪个事件开始偏离历史，直接和长期影响是什么？', '历史扩展'),
  territory: item('领地经营', '领地、城市与建筑等级', '领地和建筑如何升级，解锁条件、时间和成本是什么？', '领地扩展'),
  population: item('领地经营', '人口、民心与劳动力', '人口如何增长、迁移、分工并影响秩序？', '领地扩展'),
  yield: item('领地经营', '资源产出与生产队列', '资源和建筑产出如何计算，生产队列受什么限制？', '领地扩展'),
  production: item('物品与资源', '生产、产出与消耗', '关键资源怎样生产、运输、储存和消耗？'),
  currency: item('物品与资源', '货币、价格与交易', '价值如何衡量，信用和货币由谁保证？'),
  army: item('领地经营', '将领、士兵与兵种', '军队如何招募、训练、编制、补给和承担伤亡？', '领地扩展'),
  'case-rules': item('悬疑调查', '案件与作案边界', '案件成立必须满足哪些客观条件，行为者能力边界是什么？', '悬疑扩展'),
  'evidence-chain': item('悬疑调查', '证据链与验证规则', '哪些证据有效，如何验证、污染、隐藏或误导？', '悬疑扩展'),
  'truth-layers': item('悬疑调查', '真相层级与公平线索', '读者何时接触关键线索，怎样避免事后补设定？', '悬疑扩展'),
  investigation: item('悬疑调查', '调查、证据与信息差', '事实如何查明，证据如何验证，谁能接触哪些信息？', '悬疑扩展'),
  'technology-boundary': item('科技与未来', '核心科技与能力边界', '核心科技能做什么、不能做什么，需要哪些前置条件？', '科幻扩展'),
  'science-cost': item('科技与未来', '技术代价与失效条件', '技术的能源、维护、伦理和失效代价是什么？', '科幻扩展'),
  'social-impact': item('科技与未来', '科技的社会影响', '核心科技如何改变职业、阶层、治理与生活？', '科幻扩展'),
  'space-rules': item('科技与未来', '空间、星域与航行规则', '距离、通信、航行和补给遵守什么客观限制？', '科幻扩展')
};

function item(groupTitle: string, label: string, prompt: string, sourceLabel = '通用'): Metadata {
  return { groupTitle, label, prompt, sourceLabel };
}

export function resolveSettingOutlineTemplate(blueprint: OpeningBlueprintInput): SettingOutlineTemplateItem[] {
  return templateFromProfile(resolveSettingOutlineProfile(blueprint));
}

export function resolveContinuationSettingOutlineTemplate(): SettingOutlineTemplateItem[] {
  return templateFromProfile(resolveContinuationSettingOutlineProfile());
}

function templateFromProfile(profile: SettingOutlineProfile): SettingOutlineTemplateItem[] {
  const keys = [...profile.required, ...profile.recommended];
  return keys.map((itemKey, index) => {
    const metadata = CATALOG[itemKey] ?? item('本书扩展', itemKey, `请明确“${itemKey}”在本书中的定义、边界与代价。`, profile.profileLabel);
    return {
      itemKey,
      ...metadata,
      required: profile.required.includes(itemKey),
      sortOrder: index
    };
  });
}
