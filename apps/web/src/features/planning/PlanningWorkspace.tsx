import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FileTextIcon } from '@phosphor-icons/react';
import {
  workspaceFunctionLabel,
  workspacePrimaryFunctionKeys,
  type WorkspacePrimaryFunctionKey
} from '@wenmi/contracts';
import {
  addArtifactVersion,
  compareArtifactVersions,
  confirmSettingBaseline,
  fetchArtifactVersions,
  fetchBookProfile,
  fetchPlanningState,
  type SettingOutlineWorkspaceData,
  fetchSettingOutlineWorkspace,
  fetchSettingReadiness,
  initializeSettingOutlineWorkspace,
  updateBookProfile,
  rejectArtifactVersion,
  saveSettingOutlineItem,
  selectArtifactVersion,
  type ArtifactVersionData,
  type BookProfileViewData,
  type PlanningStateData,
  type WorkspaceData
} from '../../lib/api/client';
import { toAuthorFacingText } from '../../app/author-presentation';
import { bookDisplayTitle } from '../../app/display-labels';
import { PROTAGONIST_ROLES } from '../onboarding/opening-options';
import { EmptyReference, StructuredContent, artifactTypeLabel, authorityLabel, fieldLabel, formatValue, isRecord, isTechnicalField } from '../shared/StructuredContent';
import { AuthorIdeaComposer } from '../creation-desk/AuthorIdeaComposer';
import { CompleteCreateBookDialog } from '../onboarding/CompleteCreateBookDialog';
import { BrandingDesignDialog } from './BrandingDesignDialog';
import { SettingCollaborationPanel } from './SettingCollaborationPanel';
import { VolumePlanningPanel } from './VolumePlanningPanel';
import { EventPlanningPanel } from './EventPlanningPanel';
import { EventChapterPlanningPanel } from './EventChapterPlanningPanel';

type PlanningTab = WorkspacePrimaryFunctionKey;

type ArtifactProjection = 'complete' | 'framework' | 'basic';

const storyFrameworkFields = ['title', 'positioning', 'tags', 'openingReference', 'theme', 'mainPlot', 'characters', 'initialOrganizations', 'openQuestions', 'planningHistory'] as const;
const storyBasicFields = ['worldView', 'worldRules', 'powerSystem', 'resourceSystem', 'equipmentTiers', 'economicRules', 'attributeFields', 'settingCandidates'] as const;
const basicSettingDefaults: Record<string, unknown> = {
  worldView: '', powerSystem: '', resourceSystem: '', equipmentTiers: [], economicRules: [], attributeFields: [], worldRules: []
};

const SETTING_CATALOG: Array<{ group: string; description: string; kind: 'common' | 'extension' | 'formula'; items: string[] }> = [
  { group: '世界与环境', description: '时代、空间、地点和自然限制', kind: 'common', items: ['时代背景', '世界层级', '地理地图', '气候环境', '国家地区', '城市地点', '种族物种', '文明科技', '历法时间', '灾难与禁区'] },
  { group: '社会与秩序', description: '社会怎样运转，人们遵守什么，冲突从哪里来', kind: 'common', items: ['政权制度', '法律规则', '社会阶层', '宗教信仰', '组织势力', '行业职业', '教育传承', '风俗文化', '道德禁忌', '信息传播'] },
  { group: '力量与成长', description: '能力来源、成长路线、代价与克制', kind: 'common', items: ['力量来源', '等级境界', '职业路线', '天赋资质', '血脉体质', '能量消耗', '成长方式', '突破条件', '克制关系', '代价与限制', '死亡与复活'] },
  { group: '人物与命名', description: '引用同书人物实体，起名前先查重', kind: 'common', items: ['主角', '重要配角', '普通配角', '反派', '导师', '队友', '家族成员', '别名与称号', '名字占用表', '人物关系', '当前状态'] },
  { group: '势力与组织', description: '组织结构、资源和相互关系', kind: 'common', items: ['国家', '宗门', '家族', '公司', '学校', '军队', '联盟', '公会', '阵营', '秘密组织', '组织结构', '势力资源', '势力关系'] },
  { group: '物品与资源', description: '物品用途、来源、稀缺性与流转', kind: 'common', items: ['货币', '材料', '道具', '武器', '装备', '药品', '宝物', '消耗品', '稀有度', '获取方式', '制造方式', '交易规则'] },
  { group: '能力、特性与技能', description: '主动与被动能力的完整规则', kind: 'common', items: ['被动特性', '主动技能', '天赋能力', '血脉能力', '职业技能', '组合技能', '羁绊效果', '触发条件', '作用目标', '持续时间', '冷却时间', '消耗', '效果系数', '克制与免疫', '使用限制', '副作用'] },
  { group: '冲突与战术', description: '战斗、商战、权谋和调查均可复用', kind: 'common', items: ['战斗规则', '主流战术', '阵型', '团队分工', '信息战', '资源战', '心理战', '谈判策略', '权谋手段', '调查手段', '常见反制', '优势条件', '失败代价'] },
  { group: '经济与运转', description: '收入、生产、消耗和时间闭环', kind: 'common', items: ['货币体系', '收入来源', '生产与产出', '消耗与维护', '物价', '税收', '交易', '库存容量', '资源循环', '稀缺资源', '升级成本', '时间成本'] },
  { group: '游戏与领主扩展', description: '仅在相关题材中按需启用', kind: 'extension', items: ['属性面板', '职业', '任务', '成就', '称号', '副本', '竞技对战', '赛季', '排行榜', '个人战力榜', '掉落概率', '宠物', '坐骑', '召唤物', '兵种', '军团', '领地等级', '城池等级', '建筑等级', '人口民心', '生产队列', '资源产量', '升级时间'] },
  { group: '玄幻与修真扩展', description: '境界、功法与传承类题材按需启用', kind: 'extension', items: ['功法', '法术', '丹药', '法宝', '灵根', '体质', '宗门等级', '洞天秘境', '天劫', '因果气运'] },
  { group: '悬疑与调查扩展', description: '案件、证据和信息差按需启用', kind: 'extension', items: ['案件', '证据链', '嫌疑人', '作案条件', '时间线', '不在场证明', '调查权限', '线索误导', '真相层级', '信息差'] },
  { group: '计算公式', description: '只计算声明变量，不执行脚本', kind: 'formula', items: ['基础属性', '衍生属性', '个人战力', '装备战力', '综合战力', '军队战力', '伤害结算', '治疗结算', '概率规则', '资源产出', '升级成本', '升级时间', '排行榜积分'] }
];

export const FORMULA_CATEGORIES = SETTING_CATALOG.find((item) => item.group === '计算公式')!.items;

type SettingOutlineStatus = '待讨论' | '讨论中' | '候选待确认' | '已确认' | '稍后补充' | '刻意留白' | '不适用';
interface SettingOutlineItem {
  key: string;
  label: string;
  prompt: string;
  source: string;
  groupTitle?: string;
  required?: boolean;
}
interface SettingOutlineGroup {
  key: string;
  title: string;
  description: string;
  items: SettingOutlineItem[];
}

const BASE_SETTING_OUTLINE: SettingOutlineGroup[] = [
  { key: 'creative', title: '作品策划', description: '先明确为什么写、写给谁以及提供什么独特体验。', items: [
    { key: 'creative-concept', label: '核心看点', prompt: '这本书最吸引人的地方是什么，为什么读者愿意一直看下去？', source: '通用', required: true },
    { key: 'theme-intent', label: '小说立意', prompt: '作品希望探讨什么问题？不要求写成口号或道德结论。', source: '通用' },
    { key: 'reader-promise', label: '读者承诺与核心体验', prompt: '读者持续追读时，稳定获得什么感受和满足？', source: '通用', required: true },
    { key: 'differentiator', label: '和同类作品有什么不同', prompt: '和同类作品相比，这本书在哪些设定、视角或阅读感受上不一样？', source: '通用', required: true },
    { key: 'tone-boundary', label: '作品气质与禁写内容', prompt: '整体想写成什么感觉？哪些内容明确不能写？', source: '通用' }
  ] },
  { key: 'world', title: '世界与环境', description: '这个世界是什么样，故事发生在哪里，过去发生过什么。', items: [
    { key: 'era', label: '时代与世界类型', prompt: '故事处于什么时代和世界类型，现实、架空或多世界如何并存？', source: '通用', required: true },
    { key: 'world-layer', label: '世界层级与空间结构', prompt: '世界由哪些层级、位面、区域或服务器构成？', source: '通用' },
    { key: 'geography', label: '地理地图与初始地点', prompt: '重要地点怎么分布，交通能到哪里，主角最初在哪里活动？', source: '通用', required: true },
    { key: 'civilization', label: '文明、科技与生产水平', prompt: '文明和科技发展到什么程度，哪些能力普及或稀缺？', source: '通用' },
    { key: 'history', label: '历史背景与历法', prompt: '哪些历史事件塑造了当下，各方如何记录时间？', source: '通用' },
    { key: 'hazards', label: '灾难、禁区与自然限制', prompt: '环境中有哪些不可忽视的危险、禁区和客观限制？', source: '通用' }
  ] },
  { key: 'society', title: '社会与秩序', description: '谁在管理社会，普通人怎么生活，违规会有什么后果。', items: [
    { key: 'governance', label: '政权、法律与治理', prompt: '谁制定规则，法律如何执行，违规的真实代价是什么？', source: '通用', required: true },
    { key: 'class', label: '阶层、身份与流动', prompt: '身份如何取得，阶层能否流动，特权与义务怎样对应？', source: '通用' },
    { key: 'culture', label: '文化、宗教与禁忌', prompt: '共同信念、礼俗、宗教和社会禁忌如何影响人物选择？', source: '通用' },
    { key: 'education', label: '教育与知识传承', prompt: '知识、技能和秘密通过什么体系传播与垄断？', source: '通用' },
    { key: 'information', label: '信息传播与舆论', prompt: '消息传播速度、可信度和控制权分别如何？', source: '通用' }
  ] },
  { key: 'growth', title: '力量与成长', description: '力量从哪里来，怎么变强，要付出什么代价。', items: [
    { key: 'power-source', label: '力量来源', prompt: '力量从哪里来，谁可以获得，是否能够被夺取或继承？', source: '通用', required: true },
    { key: 'levels', label: '等级、境界与晋升', prompt: '成长阶段如何划分，晋升需要什么条件并带来什么变化？', source: '通用', required: true },
    { key: 'abilities', label: '能力、特性与技能', prompt: '主动、被动、天赋和职业能力分别遵守什么规则？', source: '通用' },
    { key: 'costs', label: '消耗、代价与限制', prompt: '使用力量消耗什么，失败和过度使用会造成什么后果？', source: '通用', required: true },
    { key: 'counters', label: '克制、免疫与平衡', prompt: '强弱关系如何成立，哪些反制可以防止能力无限膨胀？', source: '通用' },
    { key: 'death', label: '死亡、复活与继承', prompt: '死亡是否可逆，复活、继承和损失分别遵循什么规则？', source: '通用' }
  ] },
  { key: 'characters', title: '人物与命名', description: '只建立人物运行基础，不提前规定具体剧情结果。', items: [
    { key: 'protagonist', label: '主角身份、起点与处境', prompt: '主角开始时拥有什么、缺少什么、处于怎样的社会位置？', source: '通用', required: true },
    { key: 'motivation', label: '核心欲望、动机与底线', prompt: '主角真正想要什么，害怕失去什么，哪些事绝不会做？', source: '通用', required: true },
    { key: 'strength-flaw', label: '优势、缺点与成长限制', prompt: '主角擅长什么、欠缺什么？哪些困难不能不付代价就轻易突破？', source: '通用' },
    { key: 'supporting', label: '配角类型与人物作用', prompt: '故事需要哪些配角？他们各自想要什么，怎样避免只为主角服务？', source: '通用' },
    { key: 'naming', label: '姓名库、称谓与命名规则', prompt: '不同地区、身份和种族如何命名，已占用名字有哪些？', source: '通用' },
    { key: 'relations', label: '人物关系基本原则', prompt: '亲缘、利益、情感和权力关系由哪些长期因素维持或改变？', source: '通用' }
  ] },
  { key: 'organizations', title: '势力与组织', description: '定义国家、阵营和组织的结构、资源与相互关系。', items: [
    { key: 'factions', label: '国家、阵营与主要势力', prompt: '主要势力分别追求什么，依靠什么资源存在？', source: '通用', required: true },
    { key: 'structure', label: '组织结构与权力来源', prompt: '组织如何决策、晋升和监督，真实权力掌握在谁手里？', source: '通用' },
    { key: 'military', label: '军队、兵种与武装体系', prompt: '武装力量如何组织、补给、训练和承担损失？', source: '通用' },
    { key: 'diplomacy', label: '联盟、敌对与外交规则', prompt: '势力关系如何建立、维持和破裂？', source: '通用' }
  ] },
  { key: 'resources', title: '物品、经济与资源', description: '东西从哪里来，怎么交易和消耗，什么最稀缺。', items: [
    { key: 'currency', label: '货币、价格与交易', prompt: '价值如何衡量，交易如何发生，信用和货币由谁保证？', source: '通用' },
    { key: 'production', label: '生产、产出与消耗', prompt: '关键资源怎样生产、运输、储存和消耗？', source: '通用', required: true },
    { key: 'equipment', label: '装备、道具与品阶', prompt: '装备道具如何分类、获得、损坏、升级和流通？', source: '通用' },
    { key: 'scarcity', label: '稀缺资源与争夺规则', prompt: '真正稀缺的资源是什么，为什么不能无限复制？', source: '通用' },
    { key: 'formula', label: '属性与计算方法', prompt: '哪些数值必须精确计算？分别用什么单位，允许多大范围，怎样取整？', source: '通用' }
  ] },
  { key: 'conflict', title: '冲突与战术', description: '战斗、权谋和调查怎样分出胜负，不能靠什么强行解决。', items: [
    { key: 'combat', label: '战斗与胜负规则', prompt: '战斗如何判定优势和胜负，环境、信息和士气如何影响结果？', source: '通用' },
    { key: 'tactics', label: '主流战术与团队分工', prompt: '常见战术、阵型、职业分工和反制分别是什么？', source: '通用' },
    { key: 'war', label: '战争、补给与损失', prompt: '大规模冲突如何动员、补给、结算伤亡并承担后果？', source: '通用' },
    { key: 'investigation', label: '调查、证据与信息差', prompt: '事实如何查明，证据如何验证，谁有权接触哪些信息？', source: '通用' }
  ] },
  { key: 'boundaries', title: '必须遵守、留白与未知', description: '哪些要求不能改，哪些以后再定，哪些故意不说透。', items: [
    { key: 'must-follow', label: '必须遵守', prompt: '作者明确要求永远遵守的事实、尺度和禁区是什么？', source: '通用', required: true },
    { key: 'open', label: '开放问题', prompt: '目前还没有答案、需要在后续创作中探索的问题是什么？', source: '通用' },
    { key: 'intentional-unknown', label: '刻意留白', prompt: '哪些内容应保持未知，避免过早解释削弱悬念和创造性？', source: '通用' }
  ] }
];

const SETTING_EXTENSION_PACKS: Array<{ match: RegExp; group: SettingOutlineGroup }> = [
  { match: /言情|现言|恋爱|爱情|甜宠|婚恋|豪门|情感|青春/u, group: { key: 'romance-extension', title: '题材扩展：人物关系', description: '言情、都市情感和人物关系类作品按需启用。', items: [
    { key: 'relationship-premise', label: '核心关系与吸引基础', prompt: '核心人物因什么相遇、持续接触并产生不可替代的吸引，关系成立的现实基础是什么？', source: '言情扩展', required: true },
    { key: 'relationship-obstacle', label: '关系阻力与不可速解矛盾', prompt: '阻碍关系发展的内外矛盾是什么，为什么不能靠一次坦白或误会解除就解决？', source: '言情扩展', required: true },
    { key: 'relationship-growth', label: '关系变化与双向成长', prompt: '双方怎样逐步信任或依赖对方，相处分寸怎么变化，各自要付出什么代价？', source: '言情扩展' },
    { key: 'emotional-boundaries', label: '相处分寸与底线', prompt: '两人相处时哪些事绝不能做？哪些人格和伦理底线不能越过？', source: '言情扩展' },
    { key: 'life-circle', label: '生活圈、职业与日常压力', prompt: '人物日常生活由哪些工作、家庭和社交关系构成，现实压力如何持续影响选择？', source: '都市言情扩展' }
  ] } },
  { match: /游戏|电竞|网游|系统/u, group: { key: 'game-extension', title: '题材扩展：游戏规则', description: '由游戏相关分类或题材自动加入。', items: [
    { key: 'game-entry', label: '怎样进入游戏世界', prompt: '通过头盔、穿越、现实融合还是其他方式进入？进去后哪些事能做，哪些不能？', source: '游戏扩展', required: true },
    { key: 'player-npc', label: '玩家与NPC规则', prompt: '玩家和NPC怎样互相识别、互动？死亡后各自要承担什么后果？', source: '游戏扩展', required: true },
    { key: 'game-panel', label: '属性面板与数据可见性', prompt: '哪些属性可见，谁能查看，信息是否可能伪装或延迟？', source: '游戏扩展', required: true },
    { key: 'class-skill', label: '职业、转职与技能树', prompt: '职业如何获得、成长、转职和组合，技能如何学习？', source: '游戏扩展', required: true },
    { key: 'loot', label: '装备、掉落与绑定规则', prompt: '物品如何掉落、交易、绑定、强化、损坏和回收？', source: '游戏扩展', required: true },
    { key: 'quest-instance', label: '任务、副本与奖励', prompt: '任务和副本如何生成、失败、重置并结算奖励？', source: '游戏扩展' },
    { key: 'ranking', label: '排行榜、赛季与竞技', prompt: '榜单计算什么，怎样防刷榜，赛季重置会保留什么？', source: '游戏扩展' }
  ] } },
  { match: /历史|古代|三国|架空/u, group: { key: 'history-extension', title: '题材扩展：历史与架空', description: '由历史、古代或架空相关题材自动加入。', items: [
    { key: 'history-baseline', label: '历史基线', prompt: '故事以哪段历史为基线，哪些事实必须保持一致？', source: '历史扩展', required: true },
    { key: 'divergence', label: '架空分歧点', prompt: '世界从哪个事件开始偏离历史，直接和长期影响是什么？', source: '历史扩展', required: true },
    { key: 'politics-military', label: '政治、官制与军制', prompt: '权力、行政和军事制度如何真实运转？', source: '历史扩展' },
    { key: 'technology-spread', label: '技术传播与时代限制', prompt: '技术改进需要哪些前置条件，传播速度和阻力是什么？', source: '历史扩展' },
    { key: 'historical-names', label: '年代、地名与人物校验', prompt: '年代、称谓、地名和历史人物如何保持可核对？', source: '历史扩展' }
  ] } },
  { match: /领主|种田|经营|基建/u, group: { key: 'lord-extension', title: '题材扩展：领地经营', description: '由领主、种田、经营或基建题材自动加入。', items: [
    { key: 'territory', label: '领地、城市与建筑等级', prompt: '领地和建筑如何升级，解锁条件、时间和成本是什么？', source: '领地扩展', required: true },
    { key: 'population', label: '人口、民心与劳动力', prompt: '人口如何增长、迁移、分工并影响秩序？', source: '领地扩展', required: true },
    { key: 'army', label: '将领、士兵与兵种', prompt: '军队如何招募、训练、编制、补给和承担伤亡？', source: '领地扩展', required: true },
    { key: 'yield', label: '资源产出与生产队列', prompt: '资源和建筑产出如何计算，生产队列受什么限制？', source: '领地扩展', required: true }
  ] } },
  { match: /玄幻|仙侠|修仙|奇幻|魔法/u, group: { key: 'fantasy-extension', title: '题材扩展：超凡体系', description: '由玄幻、仙侠、奇幻或魔法题材自动加入。', items: [
    { key: 'cultivation', label: '功法、修炼与传承', prompt: '修炼体系如何学习、传承、改进和走火入魔？', source: '超凡扩展' },
    { key: 'bloodline', label: '血脉、体质与天赋', prompt: '先天条件如何影响成长，能否改变，代价是什么？', source: '超凡扩展' },
    { key: 'treasures', label: '丹药、法宝与天材地宝', prompt: '超凡资源如何分级、获得、炼制和限制使用？', source: '超凡扩展' },
    { key: 'causality', label: '天劫、因果与气运', prompt: '这些力量是否真的存在，会怎样影响人物，又有哪些事情做不到？', source: '超凡扩展' }
  ] } },
  { match: /悬疑|推理|探案|灵异/u, group: { key: 'mystery-extension', title: '题材扩展：悬疑调查', description: '由悬疑、推理、探案或灵异题材自动加入。', items: [
    { key: 'case-rules', label: '案件成立条件', prompt: '案件成立必须满足哪些客观条件？凶手能做到什么，不能做到什么？', source: '悬疑扩展' },
    { key: 'evidence-chain', label: '证据链与验证规则', prompt: '哪些证据有效，如何验证、污染、隐藏或误导？', source: '悬疑扩展' },
    { key: 'truth-layers', label: '真相层级与公平线索', prompt: '读者何时能够接触关键线索，怎样避免事后补设定？', source: '悬疑扩展' }
  ] } },
  { match: /科幻|末世|星际|未来世界|赛博|机甲/u, group: { key: 'scifi-extension', title: '题材扩展：科技与未来', description: '由科幻、末世、星际、赛博或机甲题材按需启用。', items: [
    { key: 'technology-boundary', label: '核心科技能做什么', prompt: '核心科技能做到什么、不能做到什么？使用前需要满足哪些条件？', source: '科幻扩展', required: true },
    { key: 'science-cost', label: '技术代价与失效条件', prompt: '技术的能源、维护、伦理和失效代价是什么，为什么不能无限解决冲突？', source: '科幻扩展', required: true },
    { key: 'social-impact', label: '科技的社会影响', prompt: '核心科技如何改变职业、阶层、治理、战争与普通人的生活？', source: '科幻扩展' },
    { key: 'space-rules', label: '空间、星域与航行规则', prompt: '涉及星际或多空间时，距离、通信、航行和补给遵守什么客观限制？', source: '科幻扩展' }
  ] } }
];

const ALL_SETTING_TEMPLATE_GROUPS: SettingOutlineGroup[] = [
  ...BASE_SETTING_OUTLINE,
  ...SETTING_EXTENSION_PACKS.map((pack) => pack.group)
];

type SettingReadinessView = Awaited<ReturnType<typeof fetchSettingReadiness>>;

export function PlanningWorkspace({ tab, onTabChange, data, workspace, manuscript, library, naming, onBookProfileChanged }: {
  tab: PlanningTab;
  onTabChange: (tab: PlanningTab) => void;
  data: unknown;
  workspace: WorkspaceData | null;
  manuscript: ReactNode;
  library: ReactNode;
  naming: ReactNode;
  onBookProfileChanged?: () => Promise<void> | void;
}): React.JSX.Element {
  const [bookProfile, setBookProfile] = useState<BookProfileViewData | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [brandingKind, setBrandingKind] = useState<'title' | 'synopsis' | null>(null);
  const [planningState, setPlanningState] = useState<PlanningStateData | null>(null);
  const bookId = workspace?.book.bookId ?? null;
  const refreshPlanningState = useCallback(async (): Promise<void> => {
    if (bookId === null) return;
    setPlanningState(await fetchPlanningState(bookId));
  }, [bookId]);
  useEffect(() => {
    if (bookId === null) return;
    const controller = new AbortController();
    void Promise.all([
      fetchBookProfile(bookId, controller.signal),
      fetchPlanningState(bookId, controller.signal)
    ]).then(([profile, state]) => {
      setBookProfile(profile); setPlanningState(state);
    }).catch(() => {
      if (!controller.signal.aborted) {
        setBookProfile(null); setPlanningState(null);
      }
    });
    return () => controller.abort();
  }, [bookId]);
  const saveBookProfile = async (input: Parameters<typeof updateBookProfile>[1]): Promise<boolean> => {
    if (bookId === null) return false;
    setProfileSaving(true);
    try {
      const updated = await updateBookProfile(bookId, input);
      setBookProfile(updated);
      setProfileEditing(false);
      await onBookProfileChanged?.();
      return true;
    } finally {
      setProfileSaving(false);
    }
  };
  const artifacts = Array.isArray(data) ? data.filter(isRecord) : [];
  const visible = artifacts.flatMap<{ artifact: Record<string, unknown>; projection: ArtifactProjection }>((artifact) => {
    const type = String(artifact.artifact_type);
    if (type === 'story_bible' && (tab === 'framework' || tab === 'basic')) return [{ artifact, projection: tab }];
    if (tab === 'framework' && type === 'creative_plan') return [{ artifact, projection: 'complete' }];
    if (tab === 'chapter' && type === 'chapter_outline') return [{ artifact, projection: 'complete' }];
    return [];
  });
  const renderableArtifacts = visible.filter(({ artifact, projection }) => {
    if (projection !== 'basic') return true;
    const source = isRecord(artifact.active_content) ? artifact.active_content : {};
    return hasMeaningfulArtifactValue(projectArtifactContent(source, projection));
  });
  const tabs: Array<[PlanningTab, string]> = workspacePrimaryFunctionKeys.map((key) => [key, workspaceFunctionLabel(key)]);
  const ideaContext: Partial<Record<PlanningTab, { surface: 'book_profile' | 'setting' | 'volume_plan' | 'chapter_outline' | 'manuscript'; subjectType: string; title: string }>> = {
    basic: { surface: 'setting', subjectType: 'setting', title: '补充设定想法' },
    master: { surface: 'volume_plan', subjectType: 'volume_plan', title: '补充当前卷想法' },
    event: { surface: 'volume_plan', subjectType: 'story_event', title: '补充当前事件想法' },
    chapter: { surface: 'chapter_outline', subjectType: 'chapter_outline', title: '补充章纲想法' },
    manuscript: { surface: 'manuscript', subjectType: 'manuscript', title: '给正文创作的提示' }
  };
  const currentIdeaContext = ideaContext[tab] ?? null;
  return (
    <section className={`creation-desk ${tab === 'manuscript' ? 'manuscript-mode' : ''} ${['library','naming'].includes(tab) ? 'tool-mode' : ''}`} aria-labelledby="creation-desk-title">
      <header className="creation-desk-header">
        <h2 id="creation-desk-title">创作台</h2>
      </header>
      <div className="creation-desk-body">
      {tab === 'manuscript' ? manuscript : tab === 'library' ? library : tab === 'naming' ? naming : <>
      {tab === 'master' && bookId !== null ? <VolumePlanningPanel bookId={bookId} /> : tab === 'event' && bookId !== null ? <EventPlanningPanel bookId={bookId} /> : tab === 'chapter' && bookId !== null ? <EventChapterPlanningPanel bookId={bookId} onOpenManuscript={()=>onTabChange('manuscript')} {...(onBookProfileChanged===undefined?{}:{onChanged:onBookProfileChanged})} /> : tab === 'framework' && bookProfile !== null ? <BookProfilePanel profile={bookProfile} workspace={workspace} onEdit={() => setProfileEditing(true)} onBrandingDesign={(kind) => setBrandingKind(kind)} /> : renderableArtifacts.length === 0 ? (
        tab === 'basic' ? null : <EmptyReference icon={<FileTextIcon />} title={`暂无${tabs.find(([key]) => key === tab)?.[1] ?? '内容'}`} description="" />
      ) : <div className="artifact-list">{renderableArtifacts.map(({ artifact, projection }) => <ArtifactCard key={`${String(artifact.artifact_id)}:${projection}`} bookId={workspace?.book.bookId ?? null} artifact={artifact} projection={projection} />)}</div>}
      {tab === 'basic' && <SettingCatalog
        bookId={workspace?.book.bookId ?? null}
        planningState={planningState}
        onPlanningStateChanged={refreshPlanningState}
      />}
      </>}
      {bookId !== null && currentIdeaContext !== null && tab !== 'basic' && tab !== 'master' && tab !== 'event' && tab !== 'chapter' && <AuthorIdeaComposer
        bookId={bookId}
        surface={currentIdeaContext.surface}
        subjectType={currentIdeaContext.subjectType}
        subjectId={tab === 'framework' ? bookId : null}
        title={currentIdeaContext.title}
        agents={(workspace?.agents ?? []).map((agent) => ({
          agentId: agent.agentId, displayName: agent.displayName, roleName: agent.roleName
        }))}
      />}
      </div>
      {profileEditing && bookProfile !== null && <CompleteCreateBookDialog
        busy={profileSaving}
        initialProfile={bookProfile}
        onCancel={() => setProfileEditing(false)}
        onUpdate={saveBookProfile}
      />}
      {brandingKind !== null && bookId !== null && bookProfile !== null && <BrandingDesignDialog
        bookId={bookId}
        kind={brandingKind}
        profile={bookProfile}
        onClose={() => setBrandingKind(null)}
        onApplied={async (updated) => {
          setBookProfile(updated);
          setBrandingKind(null);
          await onBookProfileChanged?.();
        }}
      />}
    </section>
  );
}

function BookProfilePanel({ profile, workspace, onEdit, onBrandingDesign }: { profile: BookProfileViewData; workspace: WorkspaceData | null; onEdit: () => void; onBrandingDesign: (kind: 'title' | 'synopsis') => void }): React.JSX.Element {
  const settledCount = workspace === null ? 0 : workspace.chapters.filter((chapter) => chapter.canonManuscriptVersionId !== null).length;
  const totalChapters = workspace?.chapters.length ?? 0;
  const pendingConfirmations = workspace?.confirmations.count ?? 0;
  const progressRatio = totalChapters === 0 ? 0 : settledCount / totalChapters;
  return <section className="book-profile-panel">
    <header><div><div className="book-title-row"><h3>{bookDisplayTitle(profile.title)}</h3><button className="text-button branding-design-trigger" type="button" onClick={() => onBrandingDesign('title')}>主编设计</button></div><p>{profile.channel} · {profile.category}</p></div><button className="secondary-button" type="button" onClick={onEdit}>修改开书资料</button></header>
    {workspace !== null && <section className="book-progress-banner" aria-label="当前进度">
      <div className="book-progress-row">
        <strong>{totalChapters === 0 ? '还没有章节' : `已写定稿 ${settledCount} / ${totalChapters} 章`}</strong>
        {pendingConfirmations > 0
          ? <span className="book-progress-attention">有 {pendingConfirmations} 项重要内容等您确认，去「任务」页处理</span>
          : <span>{totalChapters === 0 ? '确认设定与分卷后，团队会开始规划事件。' : '没有等您确认的事项，团队可以继续推进。'}</span>}
      </div>
      {totalChapters > 0 && <div className="book-progress-meter" role="presentation"><i style={{ width: `${Math.max(2, Math.round(progressRatio * 100))}%` }} /></div>}
    </section>}
    <section className="book-synopsis"><div className="book-synopsis-heading"><h4>书籍简介</h4><button className="text-button branding-design-trigger" type="button" onClick={() => onBrandingDesign('synopsis')}>主编设计</button></div><p>{profile.synopsis || '暂无简介。确认第一卷方案后，可以让主编依据第一卷的故事和设定设计多套简介供您选择。'}</p></section>
    <dl><div><dt>融合题材</dt><dd>{profile.subjects.join('、') || '无'}</dd></div></dl>
    <h4>初始角色</h4>
    <div className="profile-card-grid">{profile.protagonists.map((item) => {
      const backgroundLines = [
        item.familyBackground ? `家庭背景：${item.familyBackground}` : '',
        item.careerBackground ? `职业背景：${item.careerBackground}` : '',
        item.goldenFinger ? `金手指：${item.goldenFinger}` : '',
        ...(!item.familyBackground && !item.careerBackground && !item.goldenFinger && item.background ? [item.background] : [])
      ].filter(Boolean);
      return <article key={item.name}><strong>{item.name}</strong><span>{PROTAGONIST_ROLES.find((role) => role.id === item.role)?.label ?? '主角'} · {item.age}</span>{backgroundLines.map((line) => <p key={line}>{line}</p>)}<small>{item.personalities.join('、')}</small></article>;
    })}</div>
    <h4>必须遵守</h4><ul>{profile.mustFollow.map((item) => <li key={item}>{item}</li>)}</ul>
  </section>;
}

function SettingCatalog({ bookId, planningState, onPlanningStateChanged }: {
  bookId: string | null;
  planningState: PlanningStateData | null;
  onPlanningStateChanged: () => Promise<void>;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [customItems, setCustomItems] = useState<SettingOutlineItem[]>([]);
  const [customDraft, setCustomDraft] = useState('');
  const [customGroupDraft, setCustomGroupDraft] = useState('本书扩展');
  const [statuses, setStatuses] = useState<Record<string, SettingOutlineStatus>>({});
  const [contents, setContents] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<SettingReadinessView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const allTemplateItems = ALL_SETTING_TEMPLATE_GROUPS.flatMap((group) => group.items);
  const customGroups = [...new Set(customItems.map((item) => item.groupTitle ?? '本书扩展'))].map((groupTitle, index) => ({
    key: `custom-${index}-${groupTitle}`,
    title: groupTitle,
    description: '由作者补充的本书专属设定项。',
    items: customItems.filter((item) => (item.groupTitle ?? '本书扩展') === groupTitle)
  }));
  const requiredKeys = new Set(profile?.required ?? []);
  const recommendedKeys = new Set(profile?.recommended ?? []);
  const alreadyUsedKeys = new Set([
    ...Object.entries(statuses).filter(([, status]) => status !== '待讨论').map(([key]) => key),
    ...Object.keys(contents)
  ]);
  const activeKeys = new Set([
    ...requiredKeys,
    ...recommendedKeys,
    ...alreadyUsedKeys,
    ...customItems.map((item) => item.key)
  ]);
  const activeTemplateGroups = ALL_SETTING_TEMPLATE_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => activeKeys.has(item.key))
  })).filter((group) => group.items.length > 0);
  const groups: SettingOutlineGroup[] = [...activeTemplateGroups, ...customGroups];
  const requiredGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => requiredKeys.has(item.key))
  })).filter((group) => group.items.length > 0);
  const recommendedGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !requiredKeys.has(item.key))
  })).filter((group) => group.items.length > 0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const optionalGroups = ALL_SETTING_TEMPLATE_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !activeKeys.has(item.key) && (normalizedQuery.length === 0
      || `${group.title}${item.label}${item.prompt}${item.source}`.toLocaleLowerCase().includes(normalizedQuery)))
  })).filter((group) => group.items.length > 0);
  const allItems = groups.flatMap((group) => group.items);
  const confirmedRequired = [...requiredKeys].filter((key) => statuses[key] === '已确认').length;
  const currentGuidanceItem = allItems.find((item) => requiredKeys.has(item.key) && statuses[item.key] === '讨论中')
    ?? allItems.find((item) => requiredKeys.has(item.key) && statuses[item.key] !== '已确认');
  const currentGuidanceGroup = currentGuidanceItem === undefined
    ? undefined
    : groups.find((group) => group.items.some((item) => item.key === currentGuidanceItem.key));

  const applySnapshot = useCallback((snapshot: SettingOutlineWorkspaceData): void => {
    setStatuses((current) => ({ ...current, [snapshot.itemKey]: snapshot.status }));
    setContents((current) => {
      const next = { ...current };
      if (snapshot.content === null) delete next[snapshot.itemKey];
      else next[snapshot.itemKey] = snapshot.content;
      return next;
    });
    if (snapshot.custom) {
      setCustomItems((current) => current.some((item) => item.key === snapshot.itemKey) ? current : [...current, {
        key: snapshot.itemKey,
        label: snapshot.label,
        prompt: snapshot.prompt,
        source: snapshot.sourceLabel,
        groupTitle: snapshot.groupTitle
      }]);
    }
  }, []);

  useEffect(() => {
    if (bookId === null) {
      setCustomItems([]);
      setStatuses({});
      setContents({});
      setProfile(null);
      return;
    }
    const controller = new AbortController();
    void Promise.all([
      fetchSettingOutlineWorkspace(bookId, controller.signal),
      fetchSettingReadiness(bookId)
    ]).then(async ([items, readiness]) => {
      if (controller.signal.aborted) return;
      const normalizedReadiness: SettingReadinessView = {
        ...readiness,
        recommended: readiness.recommended ?? [],
        profileKey: readiness.profileKey ?? 'common',
        profileLabel: readiness.profileLabel ?? '通用故事'
      };
      setProfile(normalizedReadiness);
      const initialKeys = new Set([...normalizedReadiness.required, ...normalizedReadiness.recommended]);
      const templateItems = ALL_SETTING_TEMPLATE_GROUPS.flatMap((group) => group.items
        .filter((item) => initialKeys.has(item.key))
        .map((item) => ({
          itemKey: item.key,
          groupTitle: group.title,
          label: item.label,
          prompt: item.prompt,
          sourceLabel: item.source,
          custom: false,
          sortOrder: allTemplateItems.findIndex((candidate) => candidate.key === item.key)
        })));
      const existingKeys = new Set(items.map((item) => item.itemKey));
      const missing = templateItems.filter((item) => !existingKeys.has(item.itemKey));
      const completeItems = missing.length === 0
        ? items
        : await initializeSettingOutlineWorkspace(bookId, missing);
      if (controller.signal.aborted) return;
      setStatuses(Object.fromEntries(completeItems.map((item) => [item.itemKey, item.status])));
      setContents(Object.fromEntries(completeItems.flatMap((item) => item.content === null ? [] : [[item.itemKey, item.content]])));
      setCustomItems(completeItems.filter((item) => item.custom).map((item) => ({
        key: item.itemKey,
        label: item.label,
        prompt: item.prompt,
        source: item.sourceLabel,
        groupTitle: item.groupTitle
      })));
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setNotice(reason instanceof Error ? reason.message : '设定清单读取失败');
    });
    return () => controller.abort();
  }, [bookId]);

  const persistItem = (group: SettingOutlineGroup, item: SettingOutlineItem, status: SettingOutlineStatus, custom = false): void => {
    if (bookId === null) return;
    const sortOrder = allTemplateItems.findIndex((candidate) => candidate.key === item.key);
    void saveSettingOutlineItem(bookId, {
      itemKey: item.key,
      groupTitle: group.title,
      label: item.label,
      prompt: item.prompt,
      sourceLabel: item.source,
      status,
      custom,
      sortOrder: sortOrder < 0 ? allTemplateItems.length + customItems.length : sortOrder,
      content: contents[item.key] ?? null
    }).then(applySnapshot).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '设定项保存失败'));
  };

  const confirmSetting = (): void => {
    if (bookId === null || planningState === null) return;
    setBusyKey('confirm-setting');
    void fetchSettingReadiness(bookId).then((readiness) => {
      if (!readiness.ready) {
        const outstanding = [...readiness.missing, ...readiness.unresolved].slice(0, 12);
        const labels = new Map(allTemplateItems.map((item) => [item.key, item.label]));
        setNotice(`设定还不能确认，请先处理：${outstanding.map((key) => labels.get(key) ?? key).join('、') || '未完成项目'}`);
        return;
      }
      return confirmSettingBaseline(bookId, planningState.version).then(async () => {
        setNotice('设定已形成新的正式稿。现在可以进入“分卷”，只规划当前一卷。');
        await onPlanningStateChanged();
      });
    }).catch((reason: unknown) => {
      setNotice(reason instanceof Error ? reason.message : '确认设定失败');
    }).finally(() => setBusyKey(null));
  };

  const addOptionalItem = (group: SettingOutlineGroup, item: SettingOutlineItem): void => {
    setStatuses((current) => ({ ...current, [item.key]: '稍后补充' }));
    persistItem(group, item, '稍后补充');
    setNotice(`“${item.label}”已加入本书的建议完善清单，不会阻塞进入卷纲设计。`);
  };

  const renderSettingGroups = (sectionGroups: SettingOutlineGroup[]): React.JSX.Element => <div className="setting-outline-list">
    {sectionGroups.map((group) => <section key={group.key} className="setting-outline-group">
      <header><h4>{group.title}</h4><span>{group.items.length} 项</span></header>
      <div>{group.items.map((item) => {
        const status = statuses[item.key] ?? '待讨论';
        const isCurrent = currentGuidanceItem?.key === item.key;
        return <article className={`setting-outline-row status-${settingStatusClass(status)}`} key={item.key}>
          <div className="setting-outline-copy">
            <div><h5>{item.label}</h5><span>{status === '候选待确认' ? '方案待确认' : status}</span></div>
            {contents[item.key] !== undefined && <p>{contents[item.key]}</p>}
          </div>
          <select aria-label={`${item.label}状态`} value={status} disabled={isCurrent && status === '候选待确认'} onChange={(event) => {
            const nextStatus = event.target.value as SettingOutlineStatus;
            setStatuses((current) => ({ ...current, [item.key]: nextStatus }));
            persistItem(group, item, nextStatus, item.source === '作者自定义');
          }}>
            {(['待讨论', '稍后补充', '刻意留白', '不适用'] as SettingOutlineStatus[]).map((value) => <option key={value} value={value}>{value}</option>)}
            {status === '讨论中' && <option value="讨论中">讨论中</option>}
            {status === '候选待确认' && <option value="候选待确认">方案待确认</option>}
            {status === '已确认' && <option value="已确认">已确认</option>}
          </select>
          <span className={`setting-row-position ${isCurrent ? 'current' : ''}`}>{isCurrent ? '正在上方处理' : status === '已确认' ? '已完成' : requiredKeys.has(item.key) ? '等待前一项' : '按需完善'}</span>
        </article>;
      })}</div>
    </section>)}
  </div>;

  return <section className="setting-outline-workbench">
    <header className="setting-outline-header">
      <h3 className="sr-only">设定</h3>
      <div className="setting-outline-progress"><strong>{confirmedRequired} / {requiredKeys.size}</strong><span>已确认</span><div><i style={{ width: `${requiredKeys.size === 0 ? 0 : Math.round(confirmedRequired / requiredKeys.size * 100)}%` }} /></div></div>
    </header>
    {bookId !== null && currentGuidanceItem !== undefined && currentGuidanceGroup !== undefined && <SettingCollaborationPanel
      key={currentGuidanceItem.key}
      bookId={bookId}
      item={{
        itemKey: currentGuidanceItem.key,
        groupTitle: currentGuidanceGroup.title,
        label: currentGuidanceItem.label,
        prompt: currentGuidanceItem.prompt,
        sourceLabel: currentGuidanceItem.source,
        status: statuses[currentGuidanceItem.key] ?? '待讨论',
        custom: currentGuidanceItem.source === '作者自定义',
        sortOrder: Math.max(0, allTemplateItems.findIndex((candidate) => candidate.key === currentGuidanceItem.key)),
        content: contents[currentGuidanceItem.key] ?? null
      }}
      onSnapshot={applySnapshot}
    />}
    <section className="setting-outline-section required">
      <header><strong>核心设定</strong></header>
      {requiredGroups.length === 0 ? <p className="setting-empty-state">正在整理本书设定清单……</p> : renderSettingGroups(requiredGroups)}
    </section>
    <details className="setting-optional-library setting-recommended">
      <summary><strong>建议完善</strong><b>{recommendedGroups.reduce((total, group) => total + group.items.length, 0)} 项</b></summary>
      {recommendedGroups.length === 0 ? <p className="setting-empty-state">暂无建议项。</p> : renderSettingGroups(recommendedGroups)}
    </details>
    <details className="setting-optional-library">
      <summary><strong>完整设定资料库</strong><b>{optionalGroups.reduce((total, group) => total + group.items.length, 0)} 项</b></summary>
      <label className="setting-search">搜索完整资料库<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：力量、死亡、装备、历史分歧点" /></label>
      <div className="setting-library-groups">{optionalGroups.map((group) => <section key={group.key}>
        <header><div><h4>{group.title}</h4><p>{group.description}</p></div><span>{group.items.length} 项</span></header>
        <div>{group.items.map((item) => <article key={item.key}><div><strong>{item.label}</strong><p>{item.prompt}</p></div><button type="button" disabled={bookId === null || busyKey !== null} onClick={() => addOptionalItem(group, item)}>加入本书</button></article>)}</div>
      </section>)}</div>
      {optionalGroups.length === 0 && <p className="setting-empty-state">没有匹配的可选设定项。</p>}
    </details>
    <section className="custom-setting-builder">
      <header><h4>本书自定义</h4><p>只添加这本书确实需要的设定问题。</p></header>
      <form onSubmit={(event) => {
        event.preventDefault();
        const value = customDraft.trim();
        if (value.length === 0 || customItems.some((item) => item.label === value)) return;
        const groupTitle = customGroupDraft.trim() || '本书扩展';
        const item = { key: `custom-${Date.now()}`, label: value, prompt: `请说明“${value}”是什么、能做什么、不能做什么、要付出什么代价，还有哪些内容暂时没定。`, source: '作者自定义', groupTitle };
        const group = { key: `custom-${groupTitle}`, title: groupTitle, description: '由作者补充的本书专属设定项。', items: [item] };
        setCustomItems((current) => [...current, item]);
        setStatuses((current) => ({ ...current, [item.key]: '待讨论' }));
        persistItem(group, item, '待讨论', true);
        setCustomDraft('');
      }}>
        <input aria-label="自定义板块名称" maxLength={24} value={customGroupDraft} onChange={(event) => setCustomGroupDraft(event.target.value)} placeholder="板块名称，例如：神名禁忌" />
        <input aria-label="自定义设定项" maxLength={40} value={customDraft} onChange={(event) => setCustomDraft(event.target.value)} placeholder="新增设定项，例如：梦境税" />
        <button className="primary-button" type="submit">添加到清单</button>
      </form>
    </section>
    <section className="planning-stage-action">
      <button className="primary-button" type="button" disabled={bookId === null || planningState === null || busyKey !== null || currentGuidanceItem !== undefined} onClick={confirmSetting}>
        {busyKey === 'confirm-setting' ? '正在检查…' : '确认整份设定'}
      </button>
    </section>
    {notice !== null && <p className="binding-status" role="status">{notice}</p>}
  </section>;
}
function settingStatusClass(status: SettingOutlineStatus): string {
  return status === '已确认' ? 'confirmed' : status === '讨论中' ? 'active' : status === '候选待确认' ? 'candidate' : 'pending';
}

function ArtifactCard({ artifact, bookId, projection }: { artifact: Record<string, unknown>; bookId: string | null; projection: ArtifactProjection }): React.JSX.Element {
  const artifactId = String(artifact.artifact_id ?? '');
  const artifactType = String(artifact.artifact_type ?? '');
  const initialStatus = String(artifact.active_version_status ?? artifact.status ?? 'candidate');
  const initialContent = isRecord(artifact.active_content) ? artifact.active_content : {};
  const [status, setStatus] = useState(initialStatus);
  const [content, setContent] = useState<Record<string, unknown>>(initialContent);
  const [versions, setVersions] = useState<ArtifactVersionData[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(initialContent);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState(String(artifact.active_version_id ?? ''));
  const visibleContent = projectArtifactContent(content, projection, projection === 'basic');
  const editableProjection = projectArtifactContent(draft, projection, true);
  const displayTitle = projection === 'framework' ? '作品定位与全书框架' : projection === 'basic' ? '基本设定' : String(artifact.title ?? '未命名规划');
  const reloadVersions = (): void => {
    if (bookId === null || artifactId.length === 0) return;
    setBusy(true);
    void fetchArtifactVersions(bookId, artifactId).then(setVersions).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '历史稿加载失败')).finally(() => setBusy(false));
  };
  const chapterOutlineV2 = artifactType === 'chapter_outline' && content.outlineSchema === 'chapter_outline_v2';
  const reverseChapterOutline = artifactType === 'chapter_outline'
    && content.reverseOutlineSchema === 'reverse_chapter_outline_v1';
  return <article className="artifact-card"><header><div><h3>{displayTitle}</h3><p>{artifactTypeLabel(artifactType)}</p></div><span className={`authority-badge ${status}`}>{authorityLabel(status)}</span></header>{chapterOutlineV2
      ? <ChapterOutlineV2Content value={visibleContent} />
      : reverseChapterOutline
        ? <ReverseChapterOutlineContent value={visibleContent} />
      : <StructuredContent value={visibleContent} />}
    {notice !== null && <p className="artifact-notice" role="status">{notice}</p>}
    {editing && <div className="artifact-editor"><h4>编辑一份待确认稿</h4><ArtifactEditFields value={editableProjection} onChange={(next) => setDraft(mergeArtifactProjection(draft, next, projection))} /><div className="artifact-actions"><button className="secondary-button" type="button" onClick={() => { setEditing(false); setDraft(content); }}>取消</button><button className="primary-button" type="button" disabled={busy || bookId === null} onClick={() => {
      if (bookId === null) return;
      setBusy(true); setNotice(null);
      void addArtifactVersion(bookId, artifactId, draft, activeVersionId || null).then((created) => { setVersions((current) => [...(current ?? []), created]); setEditing(false); setNotice(`第${created.version}稿已保存，确认后才会成为正式内容。`); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '保存失败')).finally(() => setBusy(false));
    }}>保存待确认稿</button></div></div>}
    {versions !== null && <div className="artifact-versions"><h4>历史稿件</h4>{versions.map((version) => <div key={version.artifactVersionId}><span><strong>第 {version.version} 稿</strong><small>{authorityLabel(version.status)}</small></span><div>{activeVersionId && version.artifactVersionId !== activeVersionId && <button type="button" disabled={busy} onClick={() => {
        if (bookId === null) return;
        setBusy(true); void compareArtifactVersions(bookId, artifactId, activeVersionId, version.artifactVersionId).then((result) => setNotice(result.same ? '与当前正式稿内容一致。' : `变化字段：${result.changedTopLevelKeys.map(fieldLabel).join('、')}`)).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '稿件比较失败')).finally(() => setBusy(false));
      }}>比较</button>}{version.status === 'candidate' && <><button type="button" disabled={busy} onClick={() => {
        if (bookId === null) return;
        setBusy(true); void selectArtifactVersion(bookId, artifactId, version.artifactVersionId).then((selected) => { setContent(selected.content); setStatus(selected.status); setActiveVersionId(selected.artifactVersionId); setNotice(`第${selected.version}稿已确认为正式规划。`); reloadVersions(); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '稿件确认失败')).finally(() => setBusy(false));
      }}>确认</button><button type="button" disabled={busy} onClick={() => {
        if (bookId === null) return;
        setBusy(true); void rejectArtifactVersion(bookId, artifactId, version.artifactVersionId).then(() => { setNotice(`第${version.version}稿本次未采用，仍会保留。`); reloadVersions(); }).catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : '操作没有完成')).finally(() => setBusy(false));
      }}>否决</button></>}</div></div>)}</div>}
    <footer><span>第 {String(artifact.version ?? 1)} 稿</span><span>原来的内容和修改记录都会保留</span><span className="artifact-footer-actions"><button type="button" disabled={busy || bookId === null} onClick={() => { setDraft(content); setEditing((value) => !value); }}>编辑内容</button><button type="button" disabled={busy || bookId === null} onClick={reloadVersions}>{versions === null ? '查看历史' : '刷新历史'}</button></span></footer></article>;
}

function ReverseChapterOutlineContent({ value }: { value: Record<string, unknown> }): React.JSX.Element {
  const cast = masterStageRecords(value.cast);
  const conflict = masterRecord(value.centralConflict);
  const emotion = masterRecord(value.emotionalArc);
  const experience = masterRecord(value.payoffOrPressure);
  const ending = masterRecord(value.ending);
  const threads = masterStageRecords(value.threadActions);
  return <section className="chapter-outline-v2 reverse-chapter-outline" aria-label="已有正文反向章纲">
    <header className="chapter-outline-heading">
      <div><small>第 {String(value.chapterNumber ?? '未记录')} 章</small><h4>{masterText(value.title) || '未命名章节'}</h4></div>
      <p>根据作者已有正文提炼，可由作者修改；原文仍是事实依据。</p>
    </header>
    <div className="chapter-outline-foundation">
      <MasterSummaryItem label="本章简介" value={masterText(value.summary)} />
      <MasterSummaryItem label="开场状态" value={masterText(value.openingState)} />
      <MasterSummaryItem label="本章作用" value={masterText(value.goal)} />
    </div>
    <section><h5>出场人物</h5><div className="chapter-outline-cast">{cast.map((member, index) => <article key={`${masterText(member.name)}-${index}`}>
      <h6>{masterText(member.name) || `人物${index + 1}`}</h6>
      <dl><dt>本章行动</dt><dd>{masterText(member.action) || masterText(member.chapterRole) || '正文未明确'}</dd><dt>状态变化</dt><dd>{masterText(member.stateChange) || '无明显变化'}</dd></dl>
    </article>)}</div></section>
    <section><h5>冲突与推进</h5><dl className="chapter-outline-conflict"><dt>冲突</dt><dd>{masterText(conflict.summary) || masterText(value.centralConflict) || '正文未形成明确冲突'}</dd><dt>剧情节点</dt><dd>{masterTextList(value.beats).join('；') || '暂无'}</dd></dl></section>
    <div className="chapter-outline-soft-grid">
      <section><h5>情绪变化</h5><p>{masterTextList(value.emotionalArc).join(' → ') || masterTextList(emotion.curve).join(' → ') || masterText(emotion.summary) || '正文未明确'}</p></section>
      <section><h5>爽点与压力</h5><p><strong>爽点</strong>{masterTextList(value.payoffPoints).join('；') || masterTextList(experience.payoffPoints).join('；') || masterText(experience.payoff) || '暂无'}</p><p><strong>压力 / 虐点</strong>{masterTextList(value.pressurePoints).join('；') || masterTextList(experience.pressurePoints).join('；') || masterText(experience.pressure) || '暂无'}</p></section>
      <section><h5>章末状态</h5><p>{masterText(ending.result) || masterText(value.hook) || '正文未明确'}</p></section>
    </div>
    {threads.length > 0 && <section><h5>伏笔与线索</h5><ul>{threads.map((thread, index) => <li key={index}>{masterText(thread.summary) || '未命名线索'}</li>)}</ul></section>}
  </section>;
}

function ChapterOutlineV2Content({ value }: { value: Record<string, unknown> }): React.JSX.Element {
  const sourceStage = masterRecord(value.sourceStage);
  const range = masterRecord(sourceStage.chapterRange);
  const cast = masterStageRecords(value.cast);
  const conflict = masterRecord(value.conflict);
  const beats = masterStageRecords(value.plotBeats);
  const experience = masterRecord(value.experience);
  const focus = masterRecord(value.descriptionFocus);
  const information = masterRecord(value.informationControl);
  const threads = masterStageRecords(value.threadActions);
  const ending = masterRecord(value.ending);
  const chapterNumber = Number(value.chapterNumber);
  const stageStart = Number(range.start);
  const stageEnd = Number(range.end);
  const list = (items: unknown, empty = '本章不强制'): React.JSX.Element => {
    const values = masterTextList(items);
    return values.length === 0 ? <p className="chapter-outline-empty">{empty}</p> : <ul>{values.map((item) => <li key={item}>{item}</li>)}</ul>;
  };
  return <section className="chapter-outline-v2" aria-label="详细章纲">
    <header className="chapter-outline-heading">
      <div><small>{Number.isInteger(chapterNumber) ? `第${chapterNumber}章` : '当前章'}</small><h4>{masterText(value.title) || '未命名章节'}</h4></div>
      <p>承接第{String(sourceStage.stageNumber ?? '未记录')}阶段《{masterText(sourceStage.title) || '当前卷规划'}》{Number.isInteger(stageStart) && Number.isInteger(stageEnd) ? `（第${stageStart}至${stageEnd}章）` : ''}</p>
    </header>
    <div className="chapter-outline-foundation">
      <MasterSummaryItem label="本章功能" value={masterText(value.chapterFunction)} />
      <MasterSummaryItem label="开场状态" value={masterText(value.openingState)} />
      <MasterSummaryItem label="必须结束状态" value={masterText(value.requiredEndingState)} />
    </div>
    <section><h5>人物与当下状态</h5><div className="chapter-outline-cast">{cast.map((member, index) => <article key={`${masterText(member.name)}-${index}`}>
      <h6>{masterText(member.name) || `人物${index + 1}`}</h6>
      <dl><dt>当前目标</dt><dd>{masterDisplayText(member.objective) || '待明确'}</dd><dt>知道哪些事</dt><dd>{masterDisplayText(member.knowledgeBoundary) || '待明确'}</dd><dt>本章作用</dt><dd>{masterDisplayText(member.chapterRole) || '待明确'}</dd>{masterText(member.stateChange).length > 0 && <><dt>状态变化</dt><dd>{masterDisplayText(member.stateChange)}</dd></>}</dl>
    </article>)}</div></section>
    <section><h5>核心冲突</h5><dl className="chapter-outline-conflict">
      <dt>表层冲突</dt><dd>{masterText(conflict.surface) || '待明确'}</dd>
      {masterText(conflict.underlying).length > 0 && <><dt>深层冲突</dt><dd>{masterText(conflict.underlying)}</dd></>}
      {masterText(conflict.oppositionGoal).length > 0 && <><dt>对手目标</dt><dd>{masterText(conflict.oppositionGoal)}</dd></>}
      <dt>失败代价</dt><dd>{masterText(conflict.failureCost) || '待明确'}</dd>
      {masterText(conflict.successCost).length > 0 && <><dt>成功代价</dt><dd>{masterText(conflict.successCost)}</dd></>}
    </dl></section>
    <section><h5>剧情推进</h5><ol className="chapter-outline-beats">{beats.map((beat, index) => <li key={String(beat.order ?? index + 1)}>
      <strong>节点 {String(beat.order ?? index + 1)}</strong>
      <p><b>触发</b>{masterText(beat.trigger)}</p><p><b>行动</b>{masterText(beat.action)}</p>
      {masterText(beat.resistance).length > 0 && <p><b>阻力</b>{masterText(beat.resistance)}</p>}
      {masterText(beat.turn).length > 0 && <p><b>转折</b>{masterText(beat.turn)}</p>}
      <p><b>结果</b>{masterText(beat.result)}</p>
    </li>)}</ol></section>
    <div className="chapter-outline-soft-grid">
      <section><h5>体验与情绪（软提示）</h5>{masterText(experience.primaryTone).length > 0 && <p><strong>主情绪</strong>{masterText(experience.primaryTone)}</p>}<p><strong>情绪变化</strong>{masterTextList(experience.emotionalCurve).join(' → ') || '不强制'}</p><p><strong>爽点</strong>{masterTextList(experience.payoffPoints).join('；') || '不强制'}</p><p><strong>压力 / 虐点</strong>{masterTextList(experience.pressurePoints).join('；') || '不强制'}</p>{masterText(experience.readerEffect).length > 0 && <p><strong>读者感受</strong>{masterText(experience.readerEffect)}</p>}</section>
      <section><h5>描写重点（软提示）</h5><p><strong>主要描写</strong>{masterTextList(focus.primary).join('；') || '不强制'}</p><p><strong>次要描写</strong>{masterTextList(focus.secondary).join('；') || '不强制'}</p><p><strong>压缩处理</strong>{masterTextList(focus.compress).join('；') || '不强制'}</p></section>
      <section><h5>信息控制（软提示）</h5><p><strong>本章揭示</strong>{masterTextList(information.reveals).join('；') || '不强制'}</p><p><strong>继续保留</strong>{masterTextList(information.concealed).join('；') || '不强制'}</p><p><strong>信息差</strong>{masterTextList(information.gaps).join('；') || '不强制'}</p></section>
    </div>
    {threads.length > 0 && <section><h5>伏笔动作</h5><ul>{threads.map((thread, index) => <li key={index}><strong>{threadActionDisplay(masterText(thread.action))}</strong>{masterText(thread.summary)}</li>)}</ul></section>}
    <section><h5>章末闭环</h5><dl className="chapter-outline-conflict"><dt>本章结果</dt><dd>{masterText(ending.result) || '待明确'}</dd><dt>状态变化</dt><dd>{masterTextList(ending.stateChanges).join('；') || '暂无'}</dd><dt>章末钩子</dt><dd>{masterText(ending.hook) || '待明确'}</dd><dt>下一章承接</dt><dd>{masterText(ending.nextChapterInterface) || '待明确'}</dd></dl></section>
    <div className="chapter-outline-rules">
      <section><h5>必须实现</h5>{list(value.mustImplement, '尚未填写')}</section>
      <section><h5>不得违反</h5>{list(value.mustNotViolate, '尚未填写')}</section>
      <section><h5>可以提出的新内容</h5>{list(value.allowedCandidates)}</section>
      <section className="creative"><h5>自由创作区</h5>{list(value.creativeFreedom, '对白、动作、意象与局部调度由主笔创造')}</section>
    </div>
  </section>;
}

function threadActionDisplay(action: string): string {
  return action === 'plant' ? '埋设：' : action === 'advance' ? '推进：' : action === 'payoff' ? '回收：' : '';
}

function MasterSummaryItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div><strong>{label}</strong><p>{value || '待补充'}</p></div>;
}

function masterStageRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function masterRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function masterText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function masterTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function masterDisplayText(value: unknown): string {
  return toAuthorFacingText(masterText(value));
}

function projectArtifactContent(content: Record<string, unknown>, projection: ArtifactProjection, includeDefaults = false): Record<string, unknown> {
  if (projection === 'complete') return content;
  const keys = projection === 'framework' ? storyFrameworkFields : storyBasicFields;
  const projected: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in content) projected[key] = content[key];
    else if (projection === 'basic' && includeDefaults) projected[key] = basicSettingDefaults[key];
  }
  return projected;
}

function hasMeaningfulArtifactValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulArtifactValue);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => !isTechnicalField(key) && hasMeaningfulArtifactValue(item));
}

function mergeArtifactProjection(content: Record<string, unknown>, projected: Record<string, unknown>, projection: ArtifactProjection): Record<string, unknown> {
  if (projection === 'complete') return projected;
  const allowed = new Set<string>(projection === 'framework' ? storyFrameworkFields : storyBasicFields);
  const merged = { ...content };
  for (const [key, value] of Object.entries(projected)) if (allowed.has(key)) merged[key] = value;
  return merged;
}

function ArtifactEditFields({ value, onChange, depth = 0 }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; depth?: number }): React.JSX.Element {
  return <div className={`artifact-edit-fields depth-${Math.min(depth, 2)}`}>{Object.entries(value).filter(([key]) => !isTechnicalField(key)).map(([key, item]) => {
    if (isRecord(item) && depth < 2) return <fieldset key={key}><legend>{fieldLabel(key)}</legend><ArtifactEditFields value={item} depth={depth + 1} onChange={(next) => onChange({ ...value, [key]: next })} /></fieldset>;
    if (Array.isArray(item) && item.every((entry) => ['string', 'number'].includes(typeof entry))) return <label key={key}><span>{fieldLabel(key)}</span><textarea rows={Math.min(8, Math.max(3, item.length + 1))} value={item.map(String).join('\n')} onChange={(event) => onChange({ ...value, [key]: event.target.value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean) })} /></label>;
    if (typeof item === 'boolean') return <label key={key}><span>{fieldLabel(key)}</span><select value={String(item)} onChange={(event) => onChange({ ...value, [key]: event.target.value === 'true' })}><option value="true">是</option><option value="false">否</option></select></label>;
    if (typeof item === 'number') return <label key={key}><span>{fieldLabel(key)}</span><input type="number" value={item} onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })} /></label>;
    if (isRecord(item) || Array.isArray(item)) return <div className="artifact-readonly-field" key={key}><span>{fieldLabel(key)}</span><StructuredContent value={item} /></div>;
    return <label key={key}><span>{fieldLabel(key)}</span><input value={formatValue(item)} onChange={(event) => onChange({ ...value, [key]: event.target.value })} /></label>;
  })}</div>;
}

