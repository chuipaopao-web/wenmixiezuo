import { getNarrativeMethod } from '../narrative-methods/narrative-method-library.js';

export const V7_PLOT_PATTERN_LIBRARY_VERSION = '1.0.0';

export const GENRE_FAMILY_KEYS = [
  'eastern_fantasy', 'xianxia', 'wuxia', 'western_fantasy', 'historical',
  'alternate_history', 'military_war', 'urban', 'workplace', 'business',
  'entertainment', 'sports', 'campus_youth', 'family_reality', 'modern_romance',
  'ancient_romance', 'fantasy_romance', 'marriage_family', 'mystery_detective',
  'crime', 'thriller', 'horror_supernatural', 'science_fiction', 'apocalypse',
  'game_esports', 'infinite_flow', 'system_progression', 'adventure_exploration',
  'survival', 'farming_management', 'kingdom_building', 'light_novel', 'comedy',
  'ensemble'
] as const;

export type GenreFamily = typeof GENRE_FAMILY_KEYS[number];

export interface GenreFamilyDefinition {
  key: GenreFamily;
  publicName: string;
  includes: readonly string[];
}

export const GENRE_FAMILIES: readonly GenreFamilyDefinition[] = [
  genre('eastern_fantasy', '东方玄幻', ['玄幻', '高武', '异世大陆']),
  genre('xianxia', '仙侠修真', ['修仙', '仙侠', '凡人流']),
  genre('wuxia', '武侠江湖', ['武侠', '江湖', '国术']),
  genre('western_fantasy', '西方奇幻', ['魔法', '骑士', '龙与地下城']),
  genre('historical', '历史', ['正史', '架空前历史', '朝堂']),
  genre('alternate_history', '历史穿越与架空', ['穿越历史', '架空历史', '时代改写']),
  genre('military_war', '军事战争', ['战争', '军旅', '谍战']),
  genre('urban', '都市', ['都市异能', '都市生活', '神豪']),
  genre('workplace', '职场职业', ['职场', '行业', '专业成长']),
  genre('business', '商业经营', ['商战', '创业', '金融']),
  genre('entertainment', '文娱娱乐圈', ['娱乐圈', '文娱', '直播']),
  genre('sports', '体育竞技', ['足球', '篮球', '综合竞技']),
  genre('campus_youth', '校园青春', ['校园', '青春', '成长']),
  genre('family_reality', '现实与家庭', ['现实', '年代', '家庭生活']),
  genre('modern_romance', '现代言情', ['都市言情', '甜宠', '现实情感']),
  genre('ancient_romance', '古代言情', ['古言', '宫斗宅斗', '种田古言']),
  genre('fantasy_romance', '幻想言情', ['仙侠言情', '奇幻爱情', '兽世']),
  genre('marriage_family', '婚恋家庭', ['婚姻', '家庭伦理', '先婚后爱']),
  genre('mystery_detective', '悬疑推理', ['推理', '刑侦', '探案']),
  genre('crime', '犯罪法治', ['犯罪', '黑道', '法庭']),
  genre('thriller', '惊悚冒险', ['惊悚', '逃亡', '危机']),
  genre('horror_supernatural', '恐怖灵异', ['灵异', '规则怪谈', '民俗恐怖']),
  genre('science_fiction', '科幻', ['太空', '人工智能', '赛博朋克']),
  genre('apocalypse', '末世灾变', ['末日', '灾难', '重建']),
  genre('game_esports', '游戏电竞', ['网游', '电竞', '虚拟现实']),
  genre('infinite_flow', '无限流', ['副本', '轮回', '多世界']),
  genre('system_progression', '系统与成长流', ['系统流', '升级流', '签到']),
  genre('adventure_exploration', '冒险探索', ['探险', '寻宝', '秘境']),
  genre('survival', '生存求生', ['荒野', '荒岛', '极限求生']),
  genre('farming_management', '种田经营', ['种田', '基建', '经营']),
  genre('kingdom_building', '领主争霸', ['领主', '王朝', '势力建设']),
  genre('light_novel', '轻小说与日常幻想', ['轻小说', '日常', '治愈']),
  genre('comedy', '喜剧', ['沙雕', '轻喜剧', '讽刺喜剧']),
  genre('ensemble', '群像史诗', ['群像', '多主角', '时代史诗'])
];

export const PLOT_PATTERN_CATEGORIES = [
  'container', 'strategy', 'pressure', 'turn', 'payoff', 'bridge'
] as const;

export type PlotPatternCategory = typeof PLOT_PATTERN_CATEGORIES[number];
export type PlotPatternScope = 'volume' | 'unit' | 'event' | 'scene';

export interface PlotPatternCategoryDefinition {
  key: PlotPatternCategory;
  publicName: string;
  responsibility: string;
  authorQuestion: string;
}

export const PLOT_PATTERN_CATEGORY_DEFINITIONS: readonly PlotPatternCategoryDefinition[] = [
  category('container', '剧情容器', '提供人物能够持续行动的一组场合、任务或阶段规则。', '这一段主要在做什么事？'),
  category('strategy', '主角策略', '决定人物靠什么方法解决问题，避免所有冲突都靠硬碰硬。', '主角准备怎么做？'),
  category('pressure', '冲突压力', '让人物不能轻易退出，并迫使选择与代价逐步升级。', '什么让这件事越来越难？'),
  category('turn', '转折机制', '用前置因果改变目标、理解、关系或力量平衡。', '哪项变化会让后半段不能照旧进行？'),
  category('payoff', '兑现效果', '结算此前承诺，让能力、关系、真相或地位出现可见结果。', '读者最后具体得到什么回报？'),
  category('bridge', '过桥与调剂', '承接大战后的后果、恢复、关系和下一任务，避免剧情只会连续爆炸。', '完成以后，人物怎样消化结果并进入下一段？')
];

export interface PlotPatternDefinition {
  key: string;
  professionalName: string;
  aliases: readonly string[];
  category: PlotPatternCategory;
  primaryScope: PlotPatternScope;
  applicableScopes: readonly PlotPatternScope[];
  publicExplanation: string;
  commonGenreFamilies: readonly GenreFamily[];
  fitSignals: readonly string[];
  requiredConditions: readonly string[];
  caution: string;
  irreversibleResult: string;
  variationAxes: readonly string[];
  narrativeMethodKeys: readonly string[];
}

export interface PlotPatternLibrarySummary {
  version: string;
  totalPatterns: number;
  categoryCounts: Readonly<Record<PlotPatternCategory, number>>;
  genreCoverage: Readonly<Record<GenreFamily, number>>;
}

type PatternSeed = readonly [
  key: string,
  name: string,
  aliases: readonly string[],
  genres: readonly GenreFamily[],
  explanation: string,
  result: string,
  caution: string,
  methods?: readonly string[]
];

const UNIVERSAL: readonly GenreFamily[] = [];

const CONTAINER_SEEDS: readonly PatternSeed[] = [
  ['mission-chain', '连续任务', ['任务链'], UNIVERSAL, '人物围绕一个长期目标依次完成互相承接的阶段任务。', '上一任务的结果改变资源、目标或下一任务入口。', '任务若互不影响，就会像可替换的日常清单。'],
  ['dungeon-expedition', '副本冒险', ['秘境闯关'], ['eastern_fantasy', 'xianxia', 'western_fantasy', 'game_esports', 'infinite_flow'], '人物进入规则、资源和出口相对封闭的危险区域，探索并完成阶段目标。', '离开时至少带出资源、伤亡、秘密或新的追击者。', '只换怪物和地图而不改变长期状态，会变成重复刷关。'],
  ['tournament-bracket', '淘汰赛竞技', ['擂台比赛'], ['sports', 'game_esports', 'eastern_fantasy', 'xianxia', 'campus_youth'], '人物通过多轮公开对抗争夺名次、资格或认可。', '排名、声望、对手关系和后续资格至少改变一项。', '每轮只换更强对手会疲劳，必须让策略和代价变化。'],
  ['qualification-trial', '资格试炼', ['入门考核'], ['xianxia', 'eastern_fantasy', 'western_fantasy', 'workplace', 'system_progression'], '人物必须证明自己达到某项门槛，才能进入更大的舞台。', '获得或失去资格，并暴露当前能力边界。', '规则不能临时改来刁难主角，考核结果也不能没有后续影响。'],
  ['academy-assessment', '学院考核', ['校内大考'], ['campus_youth', 'eastern_fantasy', 'xianxia', 'light_novel'], '以课程、实战、排名和同伴关系共同构成阶段考验。', '能力评价、同伴位置或师生关系形成新状态。', '不能只写分数，考核要检验此前训练和人物选择。'],
  ['workplace-project', '职场项目', ['项目攻坚'], ['workplace', 'business', 'urban'], '团队在期限、资源和客户要求下完成一项可验证成果。', '项目结果改变职业信用、组织关系或下一阶段权限。', '专业细节必须服务冲突，不能用术语堆砌冒充真实行业。'],
  ['commercial-bidding-war', '商业竞标', ['竞标争夺'], ['business', 'workplace', 'urban'], '多方围绕同一客户、资源或合同提出方案并互相博弈。', '资源归属、商业联盟或行业位置发生变化。', '主角胜利不能只靠对手泄密或突然降智。'],
  ['public-performance', '公开演出', ['舞台竞演'], ['entertainment', 'campus_youth', 'modern_romance'], '人物在公开舞台接受观众、评委与同行的即时检验。', '作品口碑、公众身份或团队关系出现可见变化。', '围观反应不能替代表演过程和专业选择。'],
  ['sports-match', '正式赛事', ['关键比赛'], ['sports', 'game_esports', 'campus_youth'], '双方在明确规则下争夺比分与晋级机会，临场策略和团队协作决定结果。', '比分、晋级、伤病或队内位置形成不可撤销的赛后状态。', '不能靠最后一秒无铺垫开挂；输赢都要结算赛前承诺。'],
  ['military-campaign', '连续战役', ['军事行动'], ['military_war', 'historical', 'alternate_history', 'science_fiction'], '围绕战略目标连续展开侦察、机动、交锋和补给争夺。', '控制区、兵力、士气和政治局势至少改变一项。', '不能只写战斗场面，战略目标与平民代价必须可见。'],
  ['siege-defense', '守城攻防', ['据点保卫'], ['military_war', 'historical', 'eastern_fantasy', 'apocalypse', 'kingdom_building'], '人物在封闭据点承受外部围攻和内部资源压力。', '据点存亡、民众信任和防线能力形成新状态。', '若补给、时间和内部意见都不变化，围城会失去真实压力。'],
  ['infiltration-operation', '潜入行动', ['秘密渗透'], ['crime', 'military_war', 'mystery_detective', 'science_fiction'], '人物在不能公开暴露的前提下进入敌方场所完成目标。', '获得目标、留下暴露痕迹或改变敌方警戒状态。', '潜入不能全靠守卫愚蠢，身份、路线和撤离都要有成本。'],
  ['undercover-assignment', '卧底任务', ['长期潜伏'], ['crime', 'military_war', 'business', 'mystery_detective'], '人物以伪装身份长期进入某个群体，同时维持双重关系和目标。', '身份风险、忠诚信任或证据积累进入不可逆阶段。', '卧底的情感和道德压力不能只在暴露前突然出现。'],
  ['heist-operation', '夺取行动', ['盗取计划'], ['crime', 'adventure_exploration', 'western_fantasy', 'science_fiction'], '团队为取得严密保护的物品、信息或资源进行分工策划与执行。', '目标物归属、团队信任或追捕风险改变。', '计划顺利到没有变数会失去戏剧性，变数又必须来自已知条件。'],
  ['escort-mission', '护送任务', ['押运护航'], ['wuxia', 'historical', 'military_war', 'western_fantasy', 'science_fiction'], '人物必须把人或物送到目的地，并在途中处理追击、路线和信任问题。', '护送对象到达、失踪或改变立场，旅程关系留下长期影响。', '沿途袭击不能只是重复打架，每次应改变路线、资源或认识。'],
  ['rescue-operation', '救援行动', ['营救人质'], UNIVERSAL, '人物在时间和风险限制下寻找并带回受困者。', '被救者、救援者和敌方关系形成新后果。', '被救者不能永远只是道具，救援选择必须有代价。'],
  ['pursuit-escape', '追捕与逃亡', ['逃亡追击'], ['thriller', 'crime', 'military_war', 'survival', 'horror_supernatural'], '人物一边躲避持续追踪，一边寻找证明、出口或反击机会。', '追逃关系被打破、反转或进入更大区域。', '每次脱险都靠巧合会削弱紧张，路线和资源必须递减。'],
  ['survival-shelter', '据点求生', ['避难所生存'], ['survival', 'apocalypse', 'horror_supernatural', 'science_fiction'], '人物围绕食物、安全、秩序与长期生存建立临时据点。', '据点稳定度、内部规则和成员关系发生变化。', '只盘点物资会像经营报表，资源选择要牵动人物利益。'],
  ['disaster-response', '灾难应对', ['危机救灾'], ['apocalypse', 'family_reality', 'science_fiction', 'thriller'], '突发灾害打破日常，人物必须在混乱中救人、判断与重建秩序。', '伤亡、责任、公共信任和生存条件形成新现实。', '灾难不能只作刺激背景，普通人的后果与系统性限制要真实。'],
  ['investigation-case', '案件调查', ['查案追凶'], ['mystery_detective', 'crime', 'horror_supernatural', 'historical'], '人物围绕一个可回答的问题收集、校验和解释证据。', '本层问题获得答案，并改变嫌疑、目标或危险程度。', '答案不能依赖从未展示的证据，调查行动也必须制造后果。'],
  ['closed-circle-case', '封闭空间谜案', ['暴风雪山庄'], ['mystery_detective', 'crime', 'horror_supernatural', 'infinite_flow'], '有限人物被困在难以离开的空间，危险与嫌疑都来自内部。', '真相、幸存关系和封闭空间秩序被打破。', '不能为了反转临时添加陌生凶手，人物行动轨迹要可追溯。'],
  ['treasure-hunt', '寻宝竞逐', ['宝藏争夺'], ['adventure_exploration', 'wuxia', 'xianxia', 'historical'], '人物依据线索寻找高价值目标，同时面对竞争者和环境门槛。', '宝藏归属、地图真相或竞争关系改变。', '宝藏不能只是一件强力道具，它应与历史、选择或代价相关。'],
  ['frontier-expedition', '未知远征', ['远征探索'], ['adventure_exploration', 'science_fiction', 'western_fantasy', 'ensemble'], '队伍离开已知安全区，进入未知环境完成考察、开路或接触任务。', '地图、知识、队伍结构或文明关系发生长期变化。', '奇观不能替代目标，探索发现必须反过来改变决策。'],
  ['lost-realm-exploration', '失落遗迹探索', ['遗迹探秘'], ['xianxia', 'western_fantasy', 'science_fiction', 'adventure_exploration'], '人物进入承载旧文明秘密的遗迹，逐步理解规则与灾难来源。', '旧文明信息、遗产归属或封印状态改变。', '遗迹说明不能全靠壁画讲解，应由行动、机关和后果揭示。'],
  ['road-journey', '公路旅程', ['一路同行'], UNIVERSAL, '人物在持续移动中遇见不同局面，外部路程与关系或认知变化并行。', '到达新地点时，人物已不再是出发时的关系与心态。', '每一站都归零会像散点合集，必须保留累积后果。'],
  ['migration-exodus', '迁徙与撤离', ['逃难迁移'], ['historical', 'military_war', 'apocalypse', 'survival', 'ensemble'], '群体为离开危险或寻找生存地而长距离移动，资源与秩序不断受考验。', '群体规模、目的地、领导权和共同记忆发生变化。', '不能把普通人只写成背景数字，路线选择要有群体代价。'],
  ['rebellion-uprising', '反抗与起义', ['揭竿而起'], ['historical', 'alternate_history', 'eastern_fantasy', 'science_fiction'], '受压群体从零散不满走向组织行动，并面对镇压、分歧与新秩序问题。', '权力结构、群众立场和主角责任不可逆改变。', '反抗不能只靠口号，组织、资源和胜利后的治理都要承担。'],
  ['succession-contest', '继承权争夺', ['夺嫡争位'], ['historical', 'ancient_romance', 'western_fantasy', 'kingdom_building'], '多方围绕合法性、血缘、能力和联盟竞争同一权位。', '继承顺位、联盟与制度稳定性发生变化。', '不能只靠阴谋堆叠，各方必须有真实支持基础和不能让步的利益。'],
  ['court-debate', '朝堂议决', ['议事博弈'], ['historical', 'alternate_history', 'ancient_romance', 'kingdom_building'], '多方在公开制度场合争夺政策、名分或资源决定。', '政策、官职、阵营或公众立场形成正式结果。', '台词机锋不能替代证据、制度与实际利益。'],
  ['institutional-purge', '组织清洗', ['肃清内患'], ['historical', 'crime', 'business', 'kingdom_building'], '组织试图识别并排除内鬼、腐败或敌对派系，同时承担误伤风险。', '组织权力、成员信任和公开规则发生改变。', '清洗不能等同于主角随意杀人，证据、程序和反噬必须存在。'],
  ['negotiation-summit', '谈判峰会', ['多方会谈'], ['business', 'historical', 'military_war', 'science_fiction'], '多方在冲突尚未解决时交换条件、威胁和承诺，争取可接受方案。', '协议、破裂、让步或新联盟形成可执行后果。', '谈判不能只拼口才，底牌、替代方案和履约能力决定结果。'],
  ['trial-courtroom', '审判与庭审', ['法庭对决'], ['crime', 'mystery_detective', 'historical', 'family_reality'], '争议事实在程序、证据和证词中接受公开裁决。', '法律身份、公众判断或案件方向被正式改变。', '不能用突然证人解决一切，程序限制和证据链必须公平。'],
  ['reform-pilot', '改革试点', ['制度改革'], ['historical', 'alternate_history', 'workplace', 'kingdom_building'], '人物把新规则投入有限范围实践，并遭遇既得利益与现实摩擦。', '制度获得证明、修正或失败，并重排利益关系。', '改革不能靠一句命令成功，也不能把反对者全部写成坏人。'],
  ['territory-development', '领地开发', ['开荒建设'], ['kingdom_building', 'farming_management', 'alternate_history', 'western_fantasy'], '人物围绕土地、人口、资源与防卫建立可持续基本盘。', '领地生产力、人口信任或外部地位发生变化。', '数字增长不能替代人物冲突，发展选择必须有机会成本。'],
  ['settlement-building', '聚落建立', ['基地建设'], ['apocalypse', 'survival', 'science_fiction', 'farming_management'], '一群人从临时求生转向共同建设秩序、设施和分工。', '生存方式、公共规则和成员归属形成稳定版本。', '不能跳过谁劳动、谁分配、谁承担风险的冲突。'],
  ['production-crisis', '生产危机', ['断供危机'], ['farming_management', 'business', 'apocalypse', 'family_reality'], '关键生产链因天灾、人事或资源断裂而濒临停摆。', '供应链被修复、替代或彻底重构。', '危机不能靠突然发现无限资源解决，损失和取舍要结算。'],
  ['auction-trade-fair', '拍卖与交易会', ['大型交易'], ['xianxia', 'business', 'urban', 'western_fantasy'], '稀缺物品在公开或半公开市场流通，价格、身份和情报同时博弈。', '物品归属、资金状态与敌友关注发生变化。', '拍卖不能只靠主角无限加价，资源上限和交易后风险要真实。'],
  ['banquet-social-game', '宴会与社交局', ['社交宴席'], ['historical', 'ancient_romance', 'business', 'modern_romance'], '人物在礼仪和公开关系限制下试探、结盟、表态或隐藏冲突。', '社会关系、名誉和隐性联盟形成新状态。', '不能全靠含沙射影台词，行动、座次、礼物和退出代价应有意义。'],
  ['wedding-ceremony', '婚礼与婚约节点', ['订婚婚礼'], ['modern_romance', 'ancient_romance', 'marriage_family', 'fantasy_romance'], '公开承诺把私人关系推向家庭、社会和长期责任的检验。', '关系法律或社会状态、家庭联盟与个人边界发生改变。', '婚礼不能只当抓马舞台，双方自主选择和后续责任必须清楚。'],
  ['family-gathering', '家庭聚会', ['家宴团聚'], ['family_reality', 'marriage_family', 'modern_romance', 'comedy'], '多代人或多支家庭在同一场合暴露旧账、期待和现实利益。', '家庭边界、秘密或照护责任进入新阶段。', '不能把所有冲突都写成吵架，沉默、行动和长期角色也要变化。'],
  ['reunion-return', '故地重返', ['久别重逢'], UNIVERSAL, '人物回到旧人旧地，现实变化迫使其重新理解过去与现在。', '旧关系获得修复、决裂或新的相处边界。', '不能只靠回忆煽情，重返必须带来当前行动与选择。'],
  ['relationship-crossroads', '关系十字路口', ['关系抉择'], ['modern_romance', 'ancient_romance', 'fantasy_romance', 'marriage_family'], '关系双方因未来目标、边界或承诺不同，必须作出不可含糊的选择。', '关系被确认、重订、暂停或结束，并改变后续生活。', '不能用无沟通误会拖延，核心矛盾应是真实价值或现实条件。'],
  ['caregiving-period', '照护共处', ['陪护疗愈'], ['family_reality', 'marriage_family', 'modern_romance', 'light_novel'], '人物因病痛、创伤或生活危机长期共处，在具体照护中改变关系。', '信任、责任分配与自我边界发生变化。', '照护者不能被美化为无限牺牲，被照护者也不能失去主体性。'],
  ['mentorship-apprenticeship', '师徒历练', ['传承教学'], ['xianxia', 'wuxia', 'workplace', 'sports'], '导师通过任务、示范和纠错帮助新人掌握能力，同时传递或冲突于价值观。', '能力传承、师徒信任或独立资格形成新状态。', '导师不能替学生解决关键问题，教学要通过实践结果验证。'],
  ['team-formation', '团队组建', ['小队集结'], UNIVERSAL, '不同能力和目标的人因共同问题形成临时或长期团队。', '分工、领导权与最低信任规则被建立。', '不能只靠招募介绍人物，每名成员要通过行动证明位置。'],
  ['recruitment-selection', '招募选拔', ['人才招募'], ['workplace', 'business', 'kingdom_building', 'sports'], '组织在有限名额下寻找合适成员，应聘者也评估组织是否值得加入。', '成员归属、岗位权责和未入选关系形成新状态。', '选择标准不能只为主角量身定制，落选者也应有合理去向。'],
  ['ritual-festival', '仪式与节庆', ['庆典仪式'], ['historical', 'xianxia', 'western_fantasy', 'family_reality'], '群体通过庆典、祭祀或传统仪式公开表达秩序、身份和共同记忆。', '公开身份、群体关系或被隐藏的冲突显形。', '世界观说明不能盖过人物当下目标，仪式必须改变参与者处境。'],
  ['time-loop-scenario', '时间循环困局', ['重复时间'], ['science_fiction', 'horror_supernatural', 'infinite_flow', 'fantasy_romance'], '人物反复经历同一时间段，靠保留的信息和变化寻找出口。', '循环规则被理解、打破或人物选择被永久改变。', '重复段落必须每次增加信息或代价，不能只靠试错清单。', ['time-ellipsis', 'progressive-reveal']]
];

const STRATEGY_SEEDS: readonly PatternSeed[] = [
  ['conceal-capability', '隐藏实力', ['藏拙'], UNIVERSAL, '人物暂不暴露全部能力，以换取观察、准备或保护空间。', '暴露时机改变敌我判断和力量平衡。', '隐藏必须有合理代价和原因，不能只为制造围观震惊。'],
  ['disguise-identity', '伪装身份', ['易容换身'], UNIVERSAL, '人物以另一身份接近目标、躲避追踪或体验不同阶层。', '真实身份风险、关系真实性或社会位置发生变化。', '伪装不能无成本完美，习惯、知识和关系都会留下破绽。'],
  ['embed-and-observe', '打入内部', ['混入敌营'], UNIVERSAL, '人物先进入目标群体观察规则和关键人物，再选择行动。', '获得内部信息，同时被新的关系和责任绑定。', '内部人物不能全是工具，长期相处应改变判断和选择。'],
  ['bait-and-catch', '设饵引出', ['引蛇出洞'], UNIVERSAL, '人物故意暴露目标或机会，诱使隐藏对手主动行动。', '对手身份、证据或行动路径被迫显形。', '诱饵必须真的有吸引力，失败风险也要由主角承担。'],
  ['feint-and-shift', '声东击西', ['佯攻转移'], ['military_war', 'historical', 'crime', 'business'], '人物让对手把资源投入错误方向，再从真正目标处突破。', '资源分布和战场重点被重新安排。', '对手被骗要基于可信信息，不能靠突然失去判断力。'],
  ['divide-coalition', '分化联盟', ['各个击破'], ['historical', 'business', 'crime', 'kingdom_building'], '人物利用对方内部利益差异，削弱其共同立场。', '联盟裂缝公开化，一方退出、中立或倒向新阵营。', '分化不能只靠挑拨一句话，需要真实利益和长期不信任。'],
  ['borrow-power', '借势破局', ['借刀借力'], UNIVERSAL, '人物利用制度、舆论、强者或现成矛盾完成自己无法独立完成的目标。', '借来的力量改变局面，也产生债务或新的约束。', '借势不是免费外挂，事后责任和反噬必须结算。'],
  ['information-arbitrage', '信息差获利', ['先知先手'], ['business', 'historical', 'crime', 'science_fiction'], '人物利用比别人更早、更完整或更准确的信息取得主动。', '资源、位置或谈判权发生变化。', '信息来源和有效期必须可信，不能把作者全知直接送给主角。'],
  ['negotiated-exchange', '谈判交换', ['利益置换'], UNIVERSAL, '人物用对方真正需要的条件换取资源、时间、合作或停战。', '双方形成可执行承诺、债务或新的边界。', '谈判不能只靠气势，必须有底线、替代方案和履约能力。'],
  ['exploit-rules', '利用规则', ['卡规则漏洞'], ['game_esports', 'workplace', 'crime', 'infinite_flow'], '人物不直接破坏规则，而是理解其边界并在规则允许范围内获得优势。', '规则解释、公众判断或后续修正规则发生变化。', '漏洞必须提前存在，使用后也可能引来修补和惩罚。'],
  ['build-alliance', '建立联盟', ['合纵结盟'], UNIVERSAL, '人物让目标不同的多方围绕最低共同利益合作。', '联盟规则、利益分配和共同敌人被明确。', '联盟不能靠主角魅力自动成立，成员要保留各自目标。'],
  ['turn-opponent', '争取对手', ['策反转化'], UNIVERSAL, '人物找到对手的真实矛盾，使其停止敌对、提供帮助或改变立场。', '敌我边界与信任成本发生变化。', '转化不能靠一场嘴炮，对手要看到具体利益、证据或价值选择。'],
  ['sacrifice-short-term', '舍短取长', ['以退换进'], UNIVERSAL, '人物主动放弃眼前收益，保护更重要的长期目标或建立可信承诺。', '短期资源减少，但长期位置、信任或机会改变。', '牺牲必须真实且不能立刻全部返还，否则选择没有重量。'],
  ['strategic-retreat', '主动撤退', ['退守重整'], UNIVERSAL, '人物承认当前条件不足，带着关键资源退出并重新选择战场。', '战线、目标或团队状态被重新设置。', '撤退不能只是暂停，要保住什么、失去什么都应清楚。'],
  ['proxy-contest', '代理人博弈', ['借人出手'], ['historical', 'business', 'crime', 'kingdom_building'], '人物通过代理人、附属组织或公开规则间接竞争，隐藏自身投入。', '代理人的利益和主导者责任开始分离或冲突。', '代理人不能没有主体性，失控风险必须成为剧情的一部分。'],
  ['parallel-plans', '双线备选计划', ['明暗两案'], UNIVERSAL, '人物同时准备主方案与失败后的替代方案，在信息变化时切换。', '至少一个方案的执行暴露新成本或新目标。', '不能事后宣布“全在计划中”，备选方案必须提前留下证据。'],
  ['countertrap', '识局反制', ['将计就计'], UNIVERSAL, '人物识别对方布置后不立即拆穿，而是利用已知陷阱反向收集证据或改变结果。', '陷阱控制权、证据和敌我认知发生变化。', '识破必须有线索，反制也不能完全消除风险。'],
  ['public-demonstration', '公开证明', ['当众验证'], UNIVERSAL, '人物选择可被他人独立检验的方式证明能力、清白或方案。', '公众判断、资格或制度决定形成正式变化。', '证明过程不能被围观惊叹取代，证据与标准要清楚。'],
  ['evidence-sting', '证据诱捕', ['钓鱼取证'], ['mystery_detective', 'crime', 'workplace', 'business'], '人物布置受控机会，让对方在可记录的条件下暴露真实行为。', '可核验证据和对方应对策略形成新状态。', '取证必须考虑合法性、伦理和对无辜者的风险。'],
  ['controlled-disclosure', '分层放出信息', ['选择性公开'], UNIVERSAL, '人物按对象和时机公开不同程度的信息，以换取合作并控制风险。', '知情范围、信任和舆论方向被改变。', '隐瞒不能无后果，信息一旦公开就应视为不可收回。'],
  ['empathy-repair', '理解与补偿', ['真诚修复'], ['modern_romance', 'marriage_family', 'family_reality', 'campus_youth'], '人物先理解伤害的真实影响，再用对方可接受的行动承担责任。', '关系边界、信任程度或分离方式发生变化。', '道歉不能自动换来原谅，补偿也不能替代尊重对方选择。'],
  ['learn-by-apprenticeship', '拜师学习', ['跟师学艺'], UNIVERSAL, '人物通过观察、练习、失败和纠错获得原本缺失的专业能力。', '能力边界、师徒关系和独立资格发生变化。', '训练不能只是时间跳过，关键错误和认知变化要可见。'],
  ['team-specialization', '团队分工', ['各司其职'], UNIVERSAL, '人物把复杂目标拆给不同专长成员，并处理接口、信任与指挥问题。', '团队协作方式和成员不可替代性被建立。', '分工不能让主角包办收尾，每个岗位的决定都应影响结果。'],
  ['innovation-breakthrough', '创新破局', ['技术革新'], ['science_fiction', 'business', 'workplace', 'farming_management', 'alternate_history'], '人物组合已有知识、资源和失败经验，创造新的解决方案。', '技术能力、生产方式或竞争规则发生变化。', '创新不能凭空出现，试验成本、缺陷和扩散后果都要存在。']
];

const PRESSURE_SEEDS: readonly PatternSeed[] = [
  ['deadline-pressure', '倒计时', ['限时危机'], UNIVERSAL, '人物必须在明确期限前完成目标，否则后果自动发生。', '期限到达后目标成功、失败或付出替代代价。', '倒计时不能反复延长，否则读者不再相信期限。', ['ticking-clock']],
  ['resource-scarcity', '资源匮乏', ['物资短缺'], UNIVERSAL, '时间、金钱、食物、灵力或人手不足，迫使人物排序与取舍。', '资源分配与人物关系形成不可逆后果。', '不能在最紧要时突然补给，稀缺规则要持续可信。', ['resource-squeeze']],
  ['overwhelming-opponent', '强敌压制', ['实力碾压'], UNIVERSAL, '对手在能力、资源或制度位置上明显强于人物，正面对抗代价高昂。', '人物找到新战场、付出损失或改写力量差距。', '强敌不能只靠数值更大，要有能针对主角的真实优势。'],
  ['public-scrutiny', '公开注视', ['舆论审视'], UNIVERSAL, '人物的行动被群众、媒体、同僚或历史记录持续观察。', '声誉、合法性与可行动空间发生变化。', '公众不能是一种声音，支持、怀疑和利益群体要有差异。'],
  ['reputation-risk', '名誉风险', ['口碑危机'], UNIVERSAL, '人物若失败或暴露，将失去长期建立的信用与关系。', '信用被损伤、重建或转化为新的身份。', '名誉不能只靠声明恢复，行动证据和时间成本必须存在。'],
  ['hierarchy-pressure', '等级压制', ['上位者压力'], UNIVERSAL, '人物受制于掌握晋升、资源或惩罚权的上位者。', '服从边界、组织位置或权力关系发生变化。', '上位者不能只有蛮横，制度基础和自身风险也应可理解。'],
  ['institutional-constraint', '制度限制', ['规则阻碍'], UNIVERSAL, '合法程序、组织规章或社会习惯限制了人物最直接的解决方式。', '规则被遵守、解释、修订或付代价突破。', '制度不能随剧情方便忽强忽弱，违反后的后果必须执行。'],
  ['hostage-bind', '人质牵制', ['软肋被控'], UNIVERSAL, '对手控制人物在意的人、物或秘密，使其无法只按自身利益行动。', '被控制对象的状态与人物选择共同改变。', '人质不能只是增加怒气的工具，其安全和主体选择都要真实。'],
  ['collateral-risk', '连带伤害', ['无辜代价'], UNIVERSAL, '最有效的行动可能伤及无辜、环境或长期公共利益。', '人物选择明确承担或避免某类代价，并影响公众与自我认知。', '不能把无辜者只当主角道德考试，后果要真正被看见。'],
  ['injury-illness', '伤病限制', ['身体倒计时'], UNIVERSAL, '伤病、残障或精神创伤限制人物行动方式与持续时间。', '身体状态、照护关系和能力策略发生变化。', '不能需要时发作、不需要时消失；病痛也不能只作煽情工具。'],
  ['hostile-environment', '恶劣环境', ['天灾地险'], ['survival', 'adventure_exploration', 'apocalypse', 'science_fiction'], '气候、地形、辐射或生态规则持续消耗人物资源。', '路线、生存方式或环境知识形成新状态。', '环境不能只在战斗时出现，日常行动也应受同一规则影响。'],
  ['isolation-pressure', '孤立无援', ['失联困境'], UNIVERSAL, '人物失去可信援助、通讯或社会支持，只能依赖有限同伴与自身判断。', '重新建立联系、形成新共同体或彻底失去旧支持。', '孤立不能靠人物集体忘记求援，断联原因要可验证。'],
  ['persistent-pursuit', '持续追捕', ['猎杀追踪'], UNIVERSAL, '对手能够不断缩小距离，迫使人物边移动边解决问题。', '追踪手段被破坏、反向利用或逼出正面对决。', '追捕者不能每次都刚好差一步，双方信息和资源要动态变化。'],
  ['betrayal-suspicion', '背叛疑云', ['内鬼怀疑'], UNIVERSAL, '团队证据不足却出现异常，信任与行动效率同时下降。', '嫌疑获得证实、排除或留下更深裂缝。', '不能靠所有人拒绝沟通制造误会，怀疑必须有合理证据。'],
  ['internal-faction-split', '内部路线分裂', ['队内分歧'], UNIVERSAL, '同一阵营对目标、方法或代价产生无法忽视的路线冲突。', '领导权、分工或阵营组成发生变化。', '分歧双方都应有可辩护理由，不能只留一个蠢坏反对者。'],
  ['moral-dilemma', '两难选择', ['价值冲突'], UNIVERSAL, '两个都重要的价值无法同时保全，人物必须承担选择损失。', '人物公开证明优先价值，并永久失去另一项可能。', '不能提供隐形完美第三解，否则此前两难失去重量。', ['true-dilemma']],
  ['secret-exposure', '秘密暴露风险', ['身份将揭'], UNIVERSAL, '隐瞒的信息越来越难维持，一旦公开会改变关系、资格或安全。', '秘密被保护、部分公开或彻底揭露。', '秘密不能无限靠巧合遮住，每次维护都应增加成本。'],
  ['debt-obligation', '债务与承诺', ['人情债'], UNIVERSAL, '人物此前获得的帮助、资源或承诺如今要求兑现。', '债务被偿还、违背、重订或转化为长期关系。', '债务不能只在需要制造麻烦时出现，受益阶段就应登记。'],
  ['responsibility-expansion', '责任升级', ['位置越高责任越大'], UNIVERSAL, '人物获得地位或能力后，不再只为自己承担结果。', '保护范围、决策权和失败代价同步扩大。', '只给权力不给责任会让成长失真，责任也不能只靠口号。'],
  ['conflicting-objectives', '双重目标冲突', ['任务相撞'], UNIVERSAL, '人物同时承担两个时间或手段上互不兼容的目标。', '其中一项目标被放弃、延期或用新方案重新兼容。', '两个目标都轻松完成会让冲突失效，取舍必须真实。'],
  ['unreliable-intelligence', '情报不完整', ['错误情报'], UNIVERSAL, '人物必须在信息缺失、过时或可能被操纵的情况下行动。', '情报可信度、决策方法和损失发生变化。', '错误不能只是作者藏信息，人物应有机会评估来源与风险。'],
  ['rule-trap', '规则陷阱', ['程序困局'], ['infinite_flow', 'game_esports', 'crime', 'workplace'], '表面规则看似明确，但组合执行会把人物逼入不利选择。', '规则边界被识别、利用或推动修订。', '规则必须提前可见，不能在主角行动后临时追加。'],
  ['repeated-failure', '连续失败', ['屡败压力'], UNIVERSAL, '人物用相近思路多次受挫，资源和信心逐步下降，旧办法必须改变。', '人物放弃旧认知、换策略或承认当前目标不可达。', '失败不能只是重复惩罚，每次都要提供新信息或损失。', ['try-fail-cycle']],
  ['irreversible-loss', '不可逆失去', ['永久代价'], UNIVERSAL, '人物失去无法恢复的人、机会、身份或能力，后续只能带着缺口前进。', '故事进入不能恢复旧平衡的新阶段。', '不能用复活、替代品或时间倒流轻易撤销，除非撤销本身代价更大。']
];

const TURN_SEEDS: readonly PatternSeed[] = [
  ['false-victory', '假胜利', ['胜中藏祸'], UNIVERSAL, '人物真实完成眼前目标，却发现结果触发更大问题或暴露更深代价。', '胜利保留，同时下一阶段目标被改写。', '不能宣布前面胜利全无意义，新的代价必须来自胜利本身。', ['false-victory-defeat']],
  ['false-defeat', '假失败', ['败中得机'], UNIVERSAL, '表面失败丢失眼前成果，却带来关键信息、位置或摆脱旧束缚的机会。', '损失保留，但人物获得新的行动路径。', '不能靠宣布“故意输”抹掉失败，所得必须小于或不同于所失。'],
  ['identity-reveal', '身份揭露', ['真实身份曝光'], UNIVERSAL, '隐藏身份被公平证据揭开，重新解释人物关系与资格。', '关系、权力和安全状态同步变化。', '揭露不能只带来震惊，所有受影响人物都应作出后续选择。'],
  ['ally-betrayal', '盟友背叛', ['自己人反戈'], UNIVERSAL, '已有信任基础的盟友因利益、恐惧或价值选择改变立场。', '联盟、资源和人物信任模型发生不可逆变化。', '背叛要有前置动机，不能为了转折把稳定人物突然改性。'],
  ['enemy-cooperation', '敌手暂时合作', ['宿敌联手'], UNIVERSAL, '共同威胁或更高利益迫使敌对双方有限合作。', '敌我边界、信息与债务关系进入复杂新状态。', '合作不能抹去旧账，边界、目标和再次分裂条件要清楚。'],
  ['goal-redefinition', '目标重定', ['换目标'], UNIVERSAL, '新事实证明原目标错误、不完整或代价不可接受，人物主动改换方向。', '长期或阶段目标形成新版本，旧投入产生后果。', '不能用作者临时换题，重定必须回应此前证据和人物价值。'],
  ['hidden-cost-reveal', '隐藏代价显形', ['代价揭开'], UNIVERSAL, '原本看似可行的力量、交易或成功暴露持续成本。', '资源使用方式、关系或目标优先级发生变化。', '代价应在早期留痕，不能在主角过强后临时补丁。'],
  ['evidence-reframed', '证据重释', ['线索翻面'], ['mystery_detective', 'crime', 'historical', 'horror_supernatural'], '关键新信息不推翻旧证据，而是改变旧证据的含义。', '嫌疑、时间线或因果判断发生变化。', '重释后读者应能回看验证，而不是依赖未展示设定。'],
  ['rule-reinterpreted', '规则重释', ['规则真意'], ['infinite_flow', 'game_esports', 'xianxia', 'science_fiction'], '人物发现规则的适用对象、边界或目的与最初理解不同。', '行动策略和世界理解进入新层。', '新解释必须兼容已发生事实，不能让规则随胜负变形。'],
  ['status-reversal', '地位反转', ['上下易位'], UNIVERSAL, '优势方因公开结果、制度变化或资源断裂失去位置，弱势方承担新权力。', '权责、社会关系和风险重新分配。', '地位提升必须连带责任，地位下降也不能让旧影响瞬间消失。'],
  ['location-becomes-trap', '目的地成陷阱', ['安全地不安全'], UNIVERSAL, '人物抵达以为安全或有答案的地方，却发现这里正是更大控制的一部分。', '撤退路径、信任与当前目标改变。', '陷阱要有事前迹象，不能把所有选择都写成无意义。'],
  ['loop-clue-breakthrough', '循环差异突破', ['重复中的异样'], ['science_fiction', 'infinite_flow', 'horror_supernatural'], '重复局面中出现一项此前不存在的差异，证明规则可以被影响。', '人物获得打破循环的新假设和不可重复机会。', '差异不能凭空降临，应由此前尝试或另一角色行动造成。'],
  ['presumed-dead-return', '失踪者归来', ['死者归来'], UNIVERSAL, '被认为死亡或离开的关键人物重新出现，带回不同立场或信息。', '继承、关系和旧事件解释被迫调整。', '归来不能撤销他人哀痛和成长，也要解释其缺席期间的行动。'],
  ['legacy-inheritance-reveal', '遗产真相', ['传承反转'], UNIVERSAL, '人物发现继承的不只是资源，还包括债务、责任或被篡改的历史。', '遗产用途、身份责任和旧敌关系发生变化。', '遗产不能只送外挂，责任和历史后果必须同等重要。'],
  ['culprit-reversal', '真凶换位', ['嫌疑倒转'], ['mystery_detective', 'crime', 'horror_supernatural'], '已锁定的责任人被新证据排除或降级，真正操作者从已出现人物中浮出。', '案件目标和人物关系重组。', '必须遵守公平线索，不能让新角色承担所有责任。'],
  ['third-force-intervention', '第三方入局', ['新势力介入'], UNIVERSAL, '此前已有迹象的第三方在关键时刻行动，打破双方稳定对抗。', '冲突从两方变多方，旧计划必须重做。', '不能用从未出现的天降势力救场，介入者要有自身目标。'],
  ['success-triggers-crisis', '成功触发危机', ['越赢越危险'], UNIVERSAL, '人物的成功越过某个阈值，引来监管、强敌、责任或系统性反应。', '舞台扩大且人物不能退回原有规模。', '危机要来自世界对成功的合理响应，不能只为拖延奖励。'],
  ['sacrifice-shifts-balance', '牺牲改写局势', ['舍身换局'], UNIVERSAL, '一名人物主动付出不可撤销代价，为他人创造原本不存在的机会。', '力量、情感和道德责任同时改变。', '牺牲不能只用配角换主角爆发，人物应有独立愿望和选择。'],
  ['misunderstanding-clarified', '误解澄清后仍需选择', ['真相说开'], UNIVERSAL, '误解被证据或沟通解决，但真实价值冲突仍然存在。', '关系从假问题转向必须面对的真问题。', '不能把一切矛盾都归咎误会，澄清后要留下可行动的真实分歧。'],
  ['plan-within-plan-exposed', '暗案显形', ['局中局揭开'], UNIVERSAL, '人物发现公开行动只是另一计划的外层，已发生结果被用于更深目标。', '对手能力、当前损失和反制方向同时更新。', '深层计划必须提前留下证据，也不能做到全知全能。']
];

const PAYOFF_SEEDS: readonly PatternSeed[] = [
  ['public-vindication', '公开洗清与认可', ['当众正名'], UNIVERSAL, '用可验证事实推翻此前误判，让受影响群体正式改变判断。', '名誉、资格和关系获得公开新状态。', '围观震惊不能替代证据和制度性后果。'],
  ['capability-breakthrough', '能力突破', ['升级破境'], ['eastern_fantasy', 'xianxia', 'sports', 'system_progression'], '此前训练、失败与选择累积成可验证的新能力。', '人物能完成过去做不到的行动，同时进入更高难度。', '不能只报等级，突破应改变解题方式并伴随成本。'],
  ['rank-promotion', '身份晋升', ['升职进阶'], UNIVERSAL, '人物因成果获得新的职位、等级或社会承认。', '权限、责任和他人称谓正式改变。', '晋升不能只领奖励，新的责任与敌意也要进入后续。'],
  ['resource-acquisition', '关键资源到手', ['夺宝收获'], UNIVERSAL, '人物取得此前承诺的重要资金、装备、领地、证据或入口。', '资源归属与可行动范围发生变化。', '资源不能无限解决所有问题，使用条件和保有风险要清楚。'],
  ['rescue-completed', '救援完成', ['成功救回'], UNIVERSAL, '受困者被带离主要危险，并开始面对获救后的现实后果。', '人员安全、关系和敌方反应形成新状态。', '获救不是剧情归零，创伤、债务和追责仍需结算。'],
  ['escape-secured', '脱离险境', ['成功脱困'], UNIVERSAL, '人物切断追捕或离开封闭危险区，获得新的行动空间。', '追逃关系终止或转为主动反击。', '出口不能靠巧合出现，逃脱也应留下资源损失或身份暴露。'],
  ['truth-revealed', '本层真相揭晓', ['谜底揭开'], UNIVERSAL, '公平线索汇合成能够回答当前核心问题的解释。', '人物和读者对过去事件形成新认知，并改变下一步。', '答案必须兑现已承诺问题，不能只再抛一个更大谜团。'],
  ['justice-enforced', '责任追究', ['公道兑现'], ['crime', 'historical', 'family_reality', 'mystery_detective'], '造成伤害者通过制度、群体或人物行动承担相称后果。', '责任归属、受害者处境和公共规则发生变化。', '追责不能让受害者恢复如初，也不能只靠私刑替代所有制度。'],
  ['revenge-stage-settled', '阶段复仇结算', ['清算一债'], UNIVERSAL, '人物清算一名责任人或一层旧债，同时发现复仇带来的真实后果。', '仇怨关系减少一层，人物价值和下一目标改变。', '复仇不能只提供爽感，证据、无辜影响和人物变化都要保留。'],
  ['relationship-confirmed', '关系确认', ['确定心意'], ['modern_romance', 'ancient_romance', 'fantasy_romance', 'campus_youth'], '双方在了解风险和边界后，自主确认新的关系承诺。', '关系状态、公开程度和未来责任改变。', '确认不能代替后续相处，也不能用危险逼迫当作自由选择。'],
  ['trust-repaired', '信任修复', ['重建信任'], UNIVERSAL, '伤害方持续承担责任，受伤方依据行动决定恢复何种程度的信任。', '双方形成新的边界和可验证承诺。', '修复不是回到从前，原伤害和拒绝权都必须保留。'],
  ['family-reconciled', '家庭和解或重订边界', ['家人和解'], ['family_reality', 'marriage_family', 'modern_romance'], '家庭成员承认旧伤与现实限制，选择新的相处规则。', '照护、经济、联系或情感边界形成新版本。', '和解不等于强迫团圆，有时清楚分开也是有效结果。'],
  ['team-cohesion', '团队成形', ['小队磨合完成'], UNIVERSAL, '成员通过共同结果建立分工、最低信任和解决分歧的方式。', '团队从临时拼组变成可持续行动单元。', '团结不能抹去个人目标，冲突处理机制比口号重要。'],
  ['territory-gained', '地盘与基本盘扩大', ['扩张领地'], ['kingdom_building', 'farming_management', 'historical', 'business'], '人物取得可管理的空间、市场或人口，并开始承担治理责任。', '控制范围、产出和外部承认发生变化。', '占领不等于治理，人口、制度和防卫成本必须进入下一阶段。'],
  ['institution-changed', '规则改变', ['制度落地'], UNIVERSAL, '人物推动一项公共规则经过冲突后正式生效或被修订。', '相关群体的权利、义务和利益分配改变。', '制度效果不能立即完美，执行偏差与反弹应被记录。'],
  ['championship-result', '赛事结果兑现', ['夺冠晋级'], ['sports', 'game_esports', 'campus_youth'], '一段训练和比赛承诺在正式结果中得到结算。', '名次、资格、队伍去留和职业机会改变。', '赛后不能只庆祝，伤病、转会和新目标也要结算。'],
  ['commercial-win', '商业阶段胜利', ['拿下市场'], ['business', 'workplace', 'urban'], '产品、合同或经营策略获得真实市场与财务验证。', '现金流、客户、团队位置或竞争格局发生变化。', '不能把销售额当唯一证明，成本、履约和对手反应必须存在。'],
  ['artistic-recognition', '作品获得认可', ['一作成名'], ['entertainment', 'campus_youth', 'modern_romance'], '创作成果被真实观众、同行或专业机制看见。', '公众身份、创作自由和商业压力改变。', '认可不能全靠数据飙升，作品过程和不同反馈应具体。'],
  ['survival-secured', '阶段生存稳定', ['安全期建立'], ['survival', 'apocalypse', 'farming_management'], '人物把最迫切的食物、安全或医疗风险降到可管理水平。', '群体获得临时稳定并能考虑更长期目标。', '稳定不是永久无危机，维护成本和新责任要清楚。'],
  ['secret-protected', '秘密得到有代价的保护', ['守住秘密'], UNIVERSAL, '人物通过选择暂时控制秘密传播范围，同时承担维护成本。', '知情人、风险等级和未来公开条件明确。', '秘密不能永远零成本隐藏，保护结果必须留下可追踪债务。'],
  ['moral-victory', '价值上的胜利', ['守住底线'], UNIVERSAL, '人物可能没有赢得全部外部目标，却在关键选择中守住核心价值。', '人物自我认知、他人信任或长期方向被确认。', '不能用“精神胜利”掩盖实际失败，外部损失要如实结算。'],
  ['tragic-sacrifice', '悲剧性牺牲兑现', ['牺牲成全'], UNIVERSAL, '人物以不可逆代价完成比个人生存更重要的目标。', '目标被推进，幸存者和世界永久背负这项代价。', '不能把牺牲者工具化，也不能随后轻易复活撤销重量。'],
  ['bittersweet-exchange', '有得有失的结算', ['苦甜收获'], UNIVERSAL, '人物得到核心目标，却永久失去另一项重要可能。', '胜利与损失同时进入后续事实。', '不能先写圆满再临时加悲伤，得失应来自同一选择。'],
  ['new-world-opened', '更大舞台开启', ['新地图开启'], UNIVERSAL, '阶段目标完成后，人物获得进入更大世界、组织或问题的真实入口。', '可行动范围与长期承诺扩大。', '新舞台必须由已有结果打开，不能无视尚未结算的旧问题。']
];

const BRIDGE_SEEDS: readonly PatternSeed[] = [
  ['recovery-period', '恢复期', ['休整疗伤'], UNIVERSAL, '人物处理身体、资源与心理损耗，为下一次行动恢复基本能力。', '伤病、物资和行动准备被更新为明确状态。', '恢复不能一笔带过，也不能让所有代价自动消失。'],
  ['daily-life-window', '日常窗口', ['生活调剂'], UNIVERSAL, '通过吃住、工作和小关系展示人物在重大事件之外怎样生活。', '关系、习惯或世界状态留下细小但可累计变化。', '日常不能完全不推进任何东西，否则会失去长篇价值。'],
  ['training-consolidation', '训练巩固', ['复盘训练'], UNIVERSAL, '人物针对刚暴露的缺口练习、试错并形成更稳定的方法。', '能力从偶然成功转为可重复使用。', '训练不能只写时间流逝，必须对应具体失败和下一任务。'],
  ['travel-transition', '旅途过桥', ['转场赶路'], UNIVERSAL, '人物从一个地点移动到下一地点，同时消化信息、调整关系和观察世界。', '位置、准备和同行关系进入下一场景状态。', '赶路不应只是地图说明，也不能每次都靠随机袭击制造内容。'],
  ['investigation-followup', '线索复盘', ['案后整理'], UNIVERSAL, '人物整理已知、未知和证据可信度，决定下一步调查重点。', '问题清单、嫌疑和行动方案形成新版本。', '复盘不能重复读者已知内容，要产生新的判断或取舍。'],
  ['resource-settlement', '资源结算', ['战利品分配'], UNIVERSAL, '团队清点收获、损失、债务和分配方式，让资源变化真正落地。', '物品归属、经济状态和成员公平感改变。', '不能只列数值，分配选择要触发关系和未来行动。'],
  ['relationship-aftercare', '关系余波', ['事后沟通'], UNIVERSAL, '人物在大事件后回应伤害、承诺、感谢和未解决边界。', '信任、距离或责任形成新的日常状态。', '不能用一次谈话自动治好创伤，行动承诺要可跟踪。'],
  ['mourning-ritual', '哀悼与送别', ['葬礼告别'], UNIVERSAL, '人物与群体承认失去，通过仪式和选择决定怎样带着记忆继续。', '死亡或离开被纳入关系、责任和公共记忆。', '不能把哀悼只当催泪段落，也不能下一章集体遗忘。'],
  ['celebration-window', '庆祝与奖励', ['胜后庆功'], UNIVERSAL, '人物在阶段成功后获得情绪释放、公开认可和关系互动。', '奖励、声誉与下一期待形成状态。', '庆祝不应只剩众人吹捧，可让不同人物对胜利有不同感受。'],
  ['political-aftermath', '局势余波', ['战后格局'], ['historical', 'military_war', 'kingdom_building', 'ensemble'], '重大胜负后结算权力空缺、联盟反应和制度安排。', '新格局、责任人与不稳定点被明确。', '不能把赢得战斗等同于赢得政治，治理和反弹要出现。'],
  ['career-market-aftermath', '行业余波', ['项目后续'], ['workplace', 'business', 'entertainment', 'sports'], '成果公布后处理合同、口碑、团队流动和竞争者回应。', '职业资源和下阶段机会形成新状态。', '不能在成功后直接跳到下一项目，履约与组织变化要结算。'],
  ['world-reaction', '世界回应', ['外界反应'], UNIVERSAL, '从受影响人物和组织的行动展示主角行为怎样传遍世界。', '公众认知、敌友关注和环境反应进入后续。', '不能只写震惊弹幕，要让外界反应产生实际行动。'],
  ['foreshadow-seed', '埋下后续触发', ['伏笔落种'], UNIVERSAL, '用可感知但暂不解释完的信息、物件或选择建立未来问题。', '一个可追踪的开放问题进入计划区。', '伏笔不能伪装成已经发生的未来事实，也不能无限只种不收。'],
  ['next-mission-intake', '接入新任务', ['新委托'], UNIVERSAL, '人物在结算旧任务后接触下一问题，先明确选择和拒绝成本。', '下一阶段目标由旧结果自然开启。', '不能突然弹窗强塞任务，新任务应与已有关系或后果相连。'],
  ['time-skip-transition', '有结算的时间跳跃', ['阶段跳时'], UNIVERSAL, '跳过重复稳定期，只保留对人物、关系和资源有影响的变化摘要。', '时间、年龄、能力和未决问题形成新的起点快照。', '不能用跳时逃避关键冲突或让成长无过程。', ['time-ellipsis']],
  ['perspective-handoff', '视角交接', ['切线过桥'], ['ensemble', 'historical', 'military_war', 'mystery_detective'], '在一个行动结果影响到另一人物时切换视角，让不同线路通过因果接力。', '新视角继承前一线结果并打开不同信息。', '不能只为悬念随意切线，交接点必须有共享事件或后果。', ['multi-viewpoint']]
];

export function getPlotPattern(patternKey: string): PlotPatternDefinition | null {
  return V7_PLOT_PATTERNS.find((item) => item.key === patternKey) ?? null;
}

export function listPlotPatterns(filter: {
  category?: PlotPatternCategory;
  scope?: PlotPatternScope;
  genreFamily?: GenreFamily;
  query?: string;
} = {}): PlotPatternDefinition[] {
  const query = normalize(filter.query ?? '');
  return V7_PLOT_PATTERNS.filter((item) => (
    (filter.category === undefined || item.category === filter.category)
    && (filter.scope === undefined || item.applicableScopes.includes(filter.scope))
    // 题材是排序和说明信号，不是使用许可；这里不按题材删掉跨类型模式。
    && (query.length === 0 || normalize([
      item.key, item.professionalName, ...item.aliases, item.publicExplanation,
      ...item.fitSignals, ...item.commonGenreFamilies.map(getGenreFamilyName)
    ].join(' ')).includes(query))
  )).sort((left, right) => {
    if (query.length > 0) {
      const leftQueryFit = getQueryFit(left, query);
      const rightQueryFit = getQueryFit(right, query);
      if (leftQueryFit !== rightQueryFit) return rightQueryFit - leftQueryFit;
    }
    if (filter.genreFamily === undefined) return left.key.localeCompare(right.key);
    const leftFit = left.commonGenreFamilies.includes(filter.genreFamily) ? 1 : 0;
    const rightFit = right.commonGenreFamilies.includes(filter.genreFamily) ? 1 : 0;
    return rightFit - leftFit || left.key.localeCompare(right.key);
  });
}

function getQueryFit(item: PlotPatternDefinition, query: string): number {
  const direct = [item.key, item.professionalName, ...item.aliases].map(normalize);
  if (direct.some((value) => value === query)) return 4;
  if (direct.some((value) => value.includes(query))) return 3;
  if (normalize(item.publicExplanation).includes(query)) return 2;
  return item.fitSignals.some((value) => normalize(value).includes(query)) ? 1 : 0;
}

export function getPlotPatternLibrarySummary(): PlotPatternLibrarySummary {
  const categoryCounts = Object.fromEntries(PLOT_PATTERN_CATEGORIES.map((categoryKey) => [
    categoryKey, V7_PLOT_PATTERNS.filter((item) => item.category === categoryKey).length
  ])) as Record<PlotPatternCategory, number>;
  const genreCoverage = Object.fromEntries(GENRE_FAMILY_KEYS.map((genreKey) => [
    genreKey,
    V7_PLOT_PATTERNS.filter((item) => item.commonGenreFamilies.length === 0 || item.commonGenreFamilies.includes(genreKey)).length
  ])) as Record<GenreFamily, number>;
  return { version: V7_PLOT_PATTERN_LIBRARY_VERSION, totalPatterns: V7_PLOT_PATTERNS.length, categoryCounts, genreCoverage };
}

export function validatePlotPatternRegistry(): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const namesAndAliases = new Map<string, string>();
  for (const item of V7_PLOT_PATTERNS) {
    if (keys.has(item.key)) errors.push(`剧情模式键重复：${item.key}`);
    keys.add(item.key);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.key)) errors.push(`剧情模式键格式错误：${item.key}`);
    for (const value of [item.professionalName, ...item.aliases]) {
      const normalized = normalize(value);
      const existing = namesAndAliases.get(normalized);
      if (existing !== undefined && existing !== item.key) errors.push(`剧情模式名称或别名重复：${value}（${existing} / ${item.key}）`);
      namesAndAliases.set(normalized, item.key);
    }
    if (item.publicExplanation.trim().length < 12) errors.push(`${item.key} 缺少可理解说明`);
    if (item.requiredConditions.length === 0) errors.push(`${item.key} 缺少使用条件`);
    if (item.irreversibleResult.trim().length === 0) errors.push(`${item.key} 缺少不可逆结果`);
    if (item.variationAxes.length < 2) errors.push(`${item.key} 变体轴不足`);
    for (const methodKey of item.narrativeMethodKeys) {
      if (getNarrativeMethod(methodKey) === null) errors.push(`${item.key} 引用了不存在的叙事方法：${methodKey}`);
    }
  }
  for (const categoryKey of PLOT_PATTERN_CATEGORIES) {
    if (!V7_PLOT_PATTERNS.some((item) => item.category === categoryKey)) errors.push(`剧情模式类别为空：${categoryKey}`);
  }
  for (const genreKey of GENRE_FAMILY_KEYS) {
    const coverage = V7_PLOT_PATTERNS.filter((item) => item.commonGenreFamilies.length === 0 || item.commonGenreFamilies.includes(genreKey)).length;
    if (coverage < 70) errors.push(`题材 ${genreKey} 的可推荐模式不足：${coverage}`);
  }
  return errors;
}

export function getGenreFamilyName(key: GenreFamily): string {
  const value = GENRE_FAMILIES.find((item) => item.key === key);
  if (value === undefined) throw new Error(`题材家族不存在：${key}`);
  return value.publicName;
}

function makePatterns(categoryKey: PlotPatternCategory, seeds: readonly PatternSeed[]): PlotPatternDefinition[] {
  const defaults = CATEGORY_DEFAULTS[categoryKey];
  return seeds.map((seed) => ({
    key: seed[0],
    professionalName: seed[1],
    aliases: [...seed[2]],
    category: categoryKey,
    primaryScope: defaults.primaryScope,
    applicableScopes: [...defaults.scopes],
    publicExplanation: seed[4],
    commonGenreFamilies: [...seed[3]],
    fitSignals: unique([seed[1], ...seed[2], ...seed[3].flatMap((key) => {
      const definition = GENRE_FAMILIES.find((item) => item.key === key);
      return definition === undefined ? [] : [definition.publicName, ...definition.includes];
    })]),
    requiredConditions: [...defaults.requiredConditions],
    caution: seed[6],
    irreversibleResult: seed[5],
    variationAxes: [...defaults.variationAxes],
    narrativeMethodKeys: unique([...defaults.narrativeMethodKeys, ...(seed[7] ?? [])])
  }));
}

const CATEGORY_DEFAULTS: Readonly<Record<PlotPatternCategory, {
  primaryScope: PlotPatternScope;
  scopes: readonly PlotPatternScope[];
  requiredConditions: readonly string[];
  variationAxes: readonly string[];
  narrativeMethodKeys: readonly string[];
}>> = {
  container: {
    primaryScope: 'unit', scopes: ['volume', 'unit', 'event'],
    requiredConditions: ['有清楚的进入条件和阶段目标', '完成后会留下可进入下一单元的状态变化'],
    variationAxes: ['公开或秘密', '单人或群体', '主动进入或被迫卷入', '成功、失败或有代价完成'],
    narrativeMethodKeys: ['goal-action-consequence', 'story-completeness']
  },
  strategy: {
    primaryScope: 'event', scopes: ['unit', 'event', 'scene'],
    requiredConditions: ['人物有明确目标与可用资源', '方法符合人物当前能力和已知信息'],
    variationAxes: ['公开或隐蔽', '独自或协作', '合法或越界', '短期收益或长期布局'],
    narrativeMethodKeys: ['causal-chain', 'forced-decision-fork']
  },
  pressure: {
    primaryScope: 'event', scopes: ['volume', 'unit', 'event', 'scene'],
    requiredConditions: ['压力会实际限制行动而不只是口头威胁', '人物无法无成本退出'],
    variationAxes: ['外部或内部', '持续或倒计时', '个人或群体', '资源、关系、制度或道德'],
    narrativeMethodKeys: ['escalation-ladder', 'direct-opposition']
  },
  turn: {
    primaryScope: 'event', scopes: ['volume', 'unit', 'event', 'scene'],
    requiredConditions: ['转折前已有可回查的因果或线索', '转折会改变后续目标、方法或理解'],
    variationAxes: ['信息、关系、规则或力量', '主角主动或外部触发', '利好或危机', '即时或延迟显效'],
    narrativeMethodKeys: ['consequence-reversal', 'scene-value-shift']
  },
  payoff: {
    primaryScope: 'unit', scopes: ['volume', 'unit', 'event'],
    requiredConditions: ['此前已经建立对应承诺或期待', '结果会被后续人物与世界承认'],
    variationAxes: ['公开或私下', '完全或部分', '甜、苦或苦甜', '个人、关系、组织或世界'],
    narrativeMethodKeys: ['setup-payoff', 'denouement', 'payoff-afterglow']
  },
  bridge: {
    primaryScope: 'unit', scopes: ['volume', 'unit', 'event', 'scene'],
    requiredConditions: ['承接上一单元的真实结果', '至少更新一项人物、关系、资源或开放问题'],
    variationAxes: ['短场或完整单元', '安静或带轻冲突', '原视角或切换视角', '即时或跳时'],
    narrativeMethodKeys: ['scene-sequel-cycle', 'recovery-window', 'strategic-pause']
  }
};

export const V7_PLOT_PATTERNS: readonly PlotPatternDefinition[] = [
  ...makePatterns('container', CONTAINER_SEEDS),
  ...makePatterns('strategy', STRATEGY_SEEDS),
  ...makePatterns('pressure', PRESSURE_SEEDS),
  ...makePatterns('turn', TURN_SEEDS),
  ...makePatterns('payoff', PAYOFF_SEEDS),
  ...makePatterns('bridge', BRIDGE_SEEDS)
];

function genre(key: GenreFamily, publicName: string, includes: readonly string[]): GenreFamilyDefinition {
  return { key, publicName, includes };
}

function category(key: PlotPatternCategory, publicName: string, responsibility: string, authorQuestion: string): PlotPatternCategoryDefinition {
  return { key, publicName, responsibility, authorQuestion };
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s·—_／/]+/g, '');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
