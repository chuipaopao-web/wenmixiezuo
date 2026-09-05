export type NamingGroupId = 'character' | 'place' | 'faction' | 'item' | 'creature' | 'ability';
export type NamingStyle = 'xianxia' | 'historical' | 'game' | 'science-fiction' | 'western' | 'modern' | 'mystery' | 'general';

export interface NamingTarget {
  id: string;
  groupId: NamingGroupId;
  label: string;
  description: string;
}

export interface NamingTargetGroup {
  id: NamingGroupId;
  label: string;
  description: string;
  targets: NamingTarget[];
}

export interface NamingContext {
  channel?: 'male' | 'female' | null;
  category?: string | null;
  subjects?: string[];
  tags?: string[];
  storyDirection?: string | null;
}

export interface NamingRequest {
  targetId: string;
  context?: NamingContext;
  count?: number;
  batch?: number;
  exclude?: string[];
  hint?: string;
}

export interface NamingCandidate {
  name: string;
  note: string;
  style: NamingStyle;
  status: 'candidate';
}

type ProtagonistRole = 'male_lead' | 'female_lead' | 'co_lead' | 'ensemble' | 'non_human'
  | 'male_support' | 'female_support' | 'male_villain' | 'female_villain';

function defineTargets(groupId: NamingGroupId, entries: Array<[string, string, string]>): NamingTarget[] {
  return entries.map(([id, label, description]) => ({ id, groupId, label, description }));
}

export const NAMING_TARGET_GROUPS: NamingTargetGroup[] = [
  {
    id: 'character', label: '人物', description: '人物本名、化名、代号与游戏昵称',
    targets: defineTargets('character', [
      ['character-male', '男性人物', '男主、男性配角与普通男性角色'],
      ['character-female', '女性人物', '女主、女性配角与普通女性角色'],
      ['character-neutral', '中性人物', '不强调性别或适合群像的姓名'],
      ['character-ai', '人工智能', '数字生命、智能中枢与虚拟助手'],
      ['character-robot', '机器人', '服务、战斗、工程与探索机器人'],
      ['character-android', '仿生人', '具有人类外形与人格的人工生命'],
      ['character-artifact-spirit', '器灵', '寄宿在兵器、法宝或遗物中的灵识'],
      ['character-sprite', '精怪', '草木、山石、器物或自然现象化形'],
      ['character-demon-race', '妖族', '具有族群与传承体系的妖族人物'],
      ['character-alien-race', '异族', '非人文明、异世界族群与外星种族人物'],
      ['character-deity', '神明', '神祇、古神、司掌者与神性化身'],
      ['character-undead', '亡灵', '幽魂、骸骨、死灵与不死者人物'],
      ['character-villain-title', '反派称号', '反派公开或暗中的身份称号'],
      ['character-operation-code', '行动代号', '行动、实验、组织成员与隐秘身份代号'],
      ['character-game-handle', '游戏昵称', '玩家ID、战队昵称与虚拟身份']
    ])
  },
  {
    id: 'place', label: '地点', description: '自然地貌、聚落、地域与特殊空间',
    targets: defineTargets('place', [
      ['place-mountain-range', '山脉', '连绵山系与大型山脉'],
      ['place-peak', '山峰', '独立山峰、主峰与险峰'],
      ['place-valley', '山谷', '谷地、峡谷、山坳与深渊谷'],
      ['place-river', '江河', '大型江河与主要水系'],
      ['place-stream', '溪流', '溪、涧、泉与支流水道'],
      ['place-lake', '湖泊', '湖、泽、池与内陆水域'],
      ['place-sea', '海域', '海、洋、海湾与海峡'],
      ['place-island', '岛屿', '海岛、群岛与浮空岛'],
      ['place-village', '村庄', '村、寨、屯、聚落'],
      ['place-town', '城镇', '镇、集、港、坊'],
      ['place-city', '城市', '城、都市与大型聚居地'],
      ['place-capital', '都城', '王都、帝都、京城与首府'],
      ['place-country', '国家', '国家、王国与政治疆域'],
      ['place-prefecture', '州郡', '州、郡、府、道与行政区'],
      ['place-territory', '领地', '封地、辖区、领地与边境区'],
      ['place-continent', '大陆', '大陆、洲域与世界板块'],
      ['place-secret-realm', '秘境', '独立秘境、洞天与特殊空间'],
      ['place-ruin', '遗迹', '古代遗址、废墟与失落建筑群'],
      ['place-dungeon', '副本', '游戏副本、迷宫与挑战空间'],
      ['place-forbidden-zone', '禁区', '危险禁地、无人区与封锁区域'],
      ['place-planet', '星球', '行星、殖民星与资源星'],
      ['place-star-system', '星系', '恒星系与多行星系统'],
      ['place-star-region', '星域', '跨星系区域与宇宙疆域'],
      ['place-space-station', '太空设施', '空间站、星港、环城与轨道设施']
    ])
  },
  {
    id: 'faction', label: '势力', description: '组织、国家、门派与经营单位',
    targets: defineTargets('faction', [
      ['faction-sect', '宗门', '修炼宗门与仙府'],
      ['faction-school', '门派', '武学门派、流派与道场'],
      ['faction-family', '家族', '世家与血脉家系'],
      ['faction-clan', '氏族', '部族、氏族与宗族共同体'],
      ['faction-dynasty', '王朝', '以朝代与皇权组织的政权'],
      ['faction-empire', '帝国', '大型帝国与跨地域政权'],
      ['faction-kingdom', '王国', '王国、公国与地方政权'],
      ['faction-army', '军团', '成建制军团与战部'],
      ['faction-guard', '卫队', '禁卫、亲卫、守备与护卫队'],
      ['faction-fleet', '舰队', '海军、空舰与星际舰队'],
      ['faction-guild', '公会', '玩家公会与职业公会'],
      ['faction-adventure-party', '冒险团', '冒险者小队与远征团'],
      ['faction-team', '战队', '竞技、行动与专业战队'],
      ['faction-chamber', '商会', '贸易商会与商业联合体'],
      ['faction-company', '公司', '现代或未来企业组织'],
      ['faction-workshop', '工坊', '制造、炼金与手工业工坊'],
      ['faction-consortium', '财团', '资本集团与跨行业财团'],
      ['faction-academy', '学院', '教学、修炼与职业学院'],
      ['faction-research-institute', '研究院', '科研、实验与学术机构'],
      ['faction-church', '教会', '宗教教会与神殿体系'],
      ['faction-association', '协会', '行业、能力者与民间协会'],
      ['faction-secret-organization', '秘密组织', '隐秘结社、地下网络与情报机关']
    ])
  },
  {
    id: 'item', label: '物品', description: '常用道具、装备、药品与稀有资源',
    targets: defineTargets('item', [
      ['item-quest', '任务道具', '剧情、任务与身份验证道具'],
      ['item-device', '机关装置', '机关、机械装置与功能设备'],
      ['item-potion', '药剂', '液体药剂、恢复剂与强化药剂'],
      ['item-pill', '丹药', '修炼丹药、疗伤丹药与特殊灵丹'],
      ['item-poison', '毒物', '毒药、毒粉、毒液与致幻物'],
      ['item-artifact', '法宝', '修炼者驱使的法宝与奇物'],
      ['item-divine-artifact', '神器', '神级武装、神器与世界级遗物'],
      ['item-sacred-object', '圣物', '宗教、族群与文明传承圣物'],
      ['item-weapon', '武器', '刀剑枪弓、法杖与科技武器'],
      ['item-armor', '防具', '铠甲、法袍、护盾与防护装备'],
      ['item-accessory', '饰品', '戒指、项链、护符与佩饰'],
      ['item-material', '材料', '通用制造、强化与任务材料'],
      ['item-ore', '矿石', '矿物、金属原矿与特殊矿石'],
      ['item-herb', '药材', '草药、灵植与炼药材料'],
      ['item-gem', '宝石', '宝石、符石与镶嵌物'],
      ['item-crystal-core', '晶核', '魔物晶核、能量结晶与内核'],
      ['item-energy-core', '能源核心', '机械、科技与设施能源核心'],
      ['item-manual', '秘籍', '功法、武技与知识传承载体'],
      ['item-formula', '配方', '药剂、炼金、烹饪与制造配方'],
      ['item-blueprint', '图纸', '装备、建筑、机械与工艺图纸'],
      ['item-vehicle', '载具', '车辆、船舶、飞行器与特殊交通工具'],
      ['item-currency', '货币', '钱币、点数、信用与特殊交换物']
    ])
  },
  {
    id: 'creature', label: '生灵', description: '坐骑、灵兽、宠物与敌对生物',
    targets: defineTargets('creature', [
      ['creature-land-mount', '陆地坐骑', '地面骑乘与载重坐骑'],
      ['creature-flying-mount', '飞行坐骑', '空中骑乘与飞行伙伴'],
      ['creature-water-mount', '水域坐骑', '水面与水下骑乘生物'],
      ['creature-mechanical-mount', '机械坐骑', '机械骑乘、载具型生物与机动平台'],
      ['creature-spirit-beast', '灵兽', '吸收灵气并具灵性的兽类'],
      ['creature-divine-beast', '神兽', '神话血统、神性与文明图腾生物'],
      ['creature-contract-beast', '契约兽', '与角色建立契约关系的生物'],
      ['creature-demon-beast', '妖兽', '妖化、修炼与族群化兽类'],
      ['creature-ferocious-beast', '凶兽', '危险野兽、灾兽与原始巨兽'],
      ['creature-monster', '魔物', '受魔力、污染或异界力量影响的生物'],
      ['creature-boss', '副本首领', '关卡、秘境与副本首领'],
      ['creature-pet', '宠物', '伙伴宠物、萌宠与辅助生物'],
      ['creature-summon', '召唤物', '技能、法术与契约召唤出的单位'],
      ['creature-mechanical', '机械生命', '机甲、无人机、傀儡与构装生命'],
      ['creature-alien', '异星生物', '外星生态、异维生命与陌生物种']
    ])
  },
  {
    id: 'ability', label: '能力', description: '魔法、技能、功法与成长路线',
    targets: defineTargets('ability', [
      ['ability-elemental-magic', '元素魔法', '火、水、风、土、雷、光暗等元素魔法'],
      ['ability-arcane', '奥术', '奥术理论、秘法与法师体系能力'],
      ['ability-forbidden-spell', '禁咒', '高代价、大范围与禁忌魔法'],
      ['ability-active-skill', '主动技能', '需要主动释放与操作的技能'],
      ['ability-passive-skill', '被动技能', '持续生效或条件触发的技能'],
      ['ability-profession-skill', '职业技能', '职业、兵种与身份专属技能'],
      ['ability-life-skill', '生活技能', '采集、制造、经营与生活职业技能'],
      ['ability-cultivation', '功法', '修炼境界、能量与肉身的功法'],
      ['ability-mental-art', '心法', '内在运转、精神与悟性修炼法'],
      ['ability-martial-art', '武技', '战斗招式与武学技艺'],
      ['ability-movement', '身法', '移动、闪避与空间步法'],
      ['ability-sword-art', '剑诀', '剑法、剑阵与御剑法门'],
      ['ability-spell', '术法', '施术者运用规则与能量的法术'],
      ['ability-talisman', '符法', '符箓、符阵与符文能力'],
      ['ability-curse', '咒术', '诅咒、言灵与仪式咒法'],
      ['ability-divine-power', '神通', '超越普通术法的天赋神通'],
      ['ability-talent', '天赋', '天赋、专长、特性与被动能力'],
      ['ability-bloodline', '血脉', '血脉传承、返祖与种族遗传能力'],
      ['ability-constitution', '体质', '特殊体质、圣体与身体特性'],
      ['ability-spiritual-root', '灵根', '灵根、灵脉与修炼资质'],
      ['ability-class', '职业', '职业、道路与战斗定位'],
      ['ability-sequence', '序列', '序列、途径、阶位与晋升称号'],
      ['ability-formation', '阵法', '战阵、法阵、结界与大型仪式结构'],
      ['ability-domain', '领域', '领域、权能范围与规则空间']
    ])
  }
];

const STYLE_KEYWORDS: Record<NamingStyle, string[]> = {
  xianxia: ['仙侠', '修仙', '玄幻', '东方玄幻', '武侠', '古典', '宗门', '灵气', '高武'],
  historical: ['历史', '古代', '朝堂', '三国', '王朝', '架空历史', '战争', '领主'],
  game: ['游戏', '电竞', '网游', '副本', '玩家', '系统', '领主争霸', '游戏异界'],
  'science-fiction': ['科幻', '星际', '机甲', '未来', '末世', '赛博', '太空'],
  western: ['西幻', '奇幻', '魔法', '骑士', '龙', '教会', '巫师'],
  modern: ['都市', '现实', '职场', '校园', '现代', '娱乐圈', '商战'],
  mystery: ['悬疑', '灵异', '推理', '惊悚', '克苏鲁', '怪谈', '刑侦'],
  general: []
};

const STYLE_TOKENS: Record<NamingStyle, string[]> = {
  xianxia: ['玄', '青', '云', '太初', '九霄', '归元', '照夜', '问心', '凌虚', '赤霄'],
  historical: ['安', '定', '武', '昭', '靖', '永宁', '河西', '北府', '开元', '临川'],
  game: ['零号', '荣耀', '先锋', '星火', '破阵', '天梯', '终局', '开拓', '秘钥', '永恒'],
  'science-fiction': ['星环', '量子', '深空', '新纪', '曙光', '引力', '光锥', '航迹', '矩阵', '跃迁'],
  western: ['银月', '圣辉', '暮影', '龙息', '晨星', '霜冠', '秘银', '鸦羽', '荆棘', '琥珀'],
  modern: ['新城', '远山', '晴川', '南风', '长街', '海棠', '星河', '云端', '望江', '清和'],
  mystery: ['雾隐', '夜巡', '无声', '旧日', '镜后', '灰烬', '回声', '暗潮', '残响', '黑函'],
  general: ['苍', '明', '远', '长', '白', '赤', '天', '风', '星', '云']
};

const TARGET_LEXICON: Record<string, { cores: string[]; suffixes: string[] }> = {
  'character-ai': { cores: ['阿尔法', '曙光', '零界', '白塔', '星图', '回声', '天穹', '织梦'], suffixes: ['中枢', '协议', '矩阵', '智能', '意识', '核心', '系统', '节点'] },
  'character-robot': { cores: ['守望', '开拓', '巡游', '壁垒', '猎隼', '工蜂', '星梭', '铁卫'], suffixes: ['号', '型', '机', '单元', '守卫', '执行体', '平台', '助手'] },
  'character-android': { cores: ['弥雅', '诺娅', '伊芙', '莱茵', '赛琳', '安珀', '洛恩', '希尔'], suffixes: ['型', '号', '原型', '个体', '序列', '样本', '单元', '迭代体'] },
  'character-artifact-spirit': { cores: ['青霜', '照夜', '问心', '山河', '惊鸿', '流光', '镇岳', '归元'], suffixes: ['剑灵', '器灵', '钟灵', '镜灵', '塔灵', '印灵', '书灵', '魂'] },
  'character-sprite': { cores: ['桃夭', '松墨', '石生', '荷露', '萤火', '蒲绒', '雪团', '芽衣'], suffixes: ['精', '怪', '童子', '小妖', '灵', '仙', '姬', '翁'] },
  'character-demon-race': { cores: ['赤瞳', '玄羽', '白泽', '青鳞', '霜尾', '墨角', '月狐', '金翅'], suffixes: ['妖王', '妖君', '妖将', '少主', '族长', '祭司', '行者', '公主'] },
  'character-alien-race': { cores: ['泽塔', '卡洛', '涅因', '索恩', '阿阙', '赫弥', '迦罗', '维萨'], suffixes: ['使者', '先知', '战士', '学者', '领航员', '祭司', '守望者', '继承者'] },
  'character-deity': { cores: ['晨曦', '群星', '潮汐', '丰穰', '终焉', '秩序', '命运', '长夜'], suffixes: ['之神', '女神', '神君', '司掌者', '圣母', '古神', '主宰', '化身'] },
  'character-undead': { cores: ['白骨', '幽烛', '灰冠', '亡钟', '夜墓', '魂灯', '朽王', '冥河'], suffixes: ['君王', '骑士', '巫妖', '幽魂', '亡者', '守墓人', '骸将', '引魂者'] },
  'character-villain-title': { cores: ['无面', '沉钟', '逆鳞', '白噪', '空席', '落幕', '蚀日', '断界'], suffixes: ['先生', '夫人', '主教', '执事', '君王', '导师', '代理人', '掌舵者'] },
  'character-operation-code': { cores: ['破晓', '长夜', '归零', '天穹', '回声', '渡鸦', '红潮', '静默'], suffixes: ['行动', '计划', '协议', '工程', '指令', '档案', '序列', '项目'] },
  'character-nonhuman': { cores: ['羽', '璃', '烬', '弦', '魄', '芽', '珀', '岚'], suffixes: ['灵', '使', '姬', '童', '君', '客', '核', '偶'] },
  'character-villain-code': { cores: ['断界', '逆鳞', '沉钟', '白噪', '空席', '无面', '落幕', '蚀日'], suffixes: ['者', '先生', '夫人', '执事', '主教', '零', '之手', '代行'] },
  'character-game-handle': { cores: ['不落', '独行', '折光', '听潮', '逐鹿', '藏锋', '逆风', '守夜'], suffixes: ['剑', '客', '星', '舟', '塔', '火', '人', '玩家'] },
  'place-mountain': { cores: ['天', '龙', '鹤', '岚', '剑', '岳', '石', '霜'], suffixes: ['山', '峰', '岭', '崖', '谷', '岳'] },
  'place-river': { cores: ['沧', '洛', '澜', '渭', '赤', '镜', '云', '寒'], suffixes: ['江', '河', '川', '溪', '水', '渡'] },
  'place-lake': { cores: ['镜', '月', '星', '苍', '烟', '碧', '暮', '风'], suffixes: ['湖', '海', '泽', '湾', '泊', '潭'] },
  'place-village': { cores: ['柳', '石', '河', '桑', '榆', '桃', '鹿', '麦'], suffixes: ['村', '寨', '屯', '庄', '坞', '聚落'] },
  'place-town': { cores: ['临河', '望山', '青石', '落霞', '白沙', '槐安', '渡云', '听潮'], suffixes: ['镇', '集', '港', '坊', '关', '堡'] },
  'place-city': { cores: ['长宁', '云州', '明川', '白鹿', '星海', '临渊', '赤河', '天工'], suffixes: ['城', '市', '港', '要塞', '新城', '都市'] },
  'place-capital': { cores: ['神京', '天启', '大梁', '曜京', '龙庭', '上都', '云京', '星都'], suffixes: ['城', '京', '都', '府', '王城', '首府'] },
  'place-region': { cores: ['东陆', '西境', '北原', '南洲', '中州', '天穹', '沧海', '星河'], suffixes: ['国', '域', '州', '领', '大陆', '联盟'] },
  'place-realm': { cores: ['归墟', '星坠', '古神', '万象', '失落', '镜界', '黄昏', '深渊'], suffixes: ['秘境', '遗迹', '禁区', '副本', '回廊', '裂隙'] },
  'place-planet': { cores: ['苍蓝', '赤曜', '新月', '天琴', '北辰', '远航', '晨曦', '深空'], suffixes: ['星', '星域', '星系', '环城', '空间站', '殖民地'] },
  'faction-sect': { cores: ['太一', '问剑', '归藏', '青冥', '天机', '万法', '灵霄', '玄岳'], suffixes: ['宗', '门', '宫', '府', '观', '院'] },
  'faction-family': { cores: ['林', '顾', '沈', '陆', '谢', '萧', '闻', '叶'], suffixes: ['氏', '家', '世家', '一族', '宗族', '门阀'] },
  'faction-dynasty': { cores: ['大曜', '承平', '天启', '赤霄', '瀚海', '北辰', '白银', '群星'], suffixes: ['朝', '国', '帝国', '王国', '联邦', '盟国'] },
  'faction-army': { cores: ['玄甲', '赤羽', '镇海', '北府', '破晓', '星槎', '铁壁', '夜巡'], suffixes: ['军', '卫', '军团', '战部', '舰队', '营'] },
  'faction-guild': { cores: ['不落', '远征', '星火', '逐鹿', '开拓', '山海', '白塔', '群英'], suffixes: ['公会', '战队', '冒险团', '联盟', '同盟', '旅团'] },
  'faction-chamber': { cores: ['四海', '万通', '天工', '远山', '星港', '九州', '白鹿', '金衡'], suffixes: ['商会', '公司', '工坊', '财团', '行会', '集团'] },
  'faction-academy': { cores: ['稷下', '白塔', '星海', '求真', '天工', '龙门', '新纪', '博闻'], suffixes: ['学院', '学宫', '研究院', '训练营', '书院', '大学'] },
  'faction-church': { cores: ['晨曦', '真理', '群星', '守夜', '圣火', '秘仪', '灰塔', '秩序'], suffixes: ['教会', '协会', '议会', '结社', '机关', '组织'] },
  'item-prop': { cores: ['回溯', '寻路', '破界', '传讯', '隐匿', '锁魂', '照影', '定位'], suffixes: ['符', '钥', '盘', '镜', '针', '盒', '卷轴', '装置'] },
  'item-medicine': { cores: ['回春', '凝神', '淬体', '续命', '破障', '净化', '醒灵', '止血'], suffixes: ['丹', '散', '露', '剂', '药', '膏', '丸', '针'] },
  'item-artifact': { cores: ['山河', '镇海', '照骨', '定界', '吞星', '问心', '万象', '时序'], suffixes: ['印', '镜', '钟', '塔', '图', '珠', '环', '权杖'] },
  'item-weapon': { cores: ['断潮', '逐日', '霜华', '破军', '星落', '惊雷', '无锋', '裂空'], suffixes: ['剑', '刀', '枪', '弓', '杖', '刃', '炮', '矛'] },
  'item-armor': { cores: ['玄鳞', '星纹', '守心', '铁壁', '龙脊', '月白', '秘银', '曙光'], suffixes: ['甲', '袍', '盾', '衣', '冠', '护符', '披风', '装甲'] },
  'item-material': { cores: ['星髓', '龙纹', '赤金', '月华', '虚空', '寒铁', '灵木', '光晶'], suffixes: ['矿', '石', '木', '砂', '液', '纤维', '合金', '精华'] },
  'item-gem': { cores: ['曜', '灵', '魂', '星', '炎', '霜', '风', '源'], suffixes: ['晶', '核', '石', '珠', '符石', '能源核', '宝玉', '结晶'] },
  'item-manual': { cores: ['归元', '万象', '天工', '问剑', '星图', '灵枢', '战阵', '炼金'], suffixes: ['经', '录', '图谱', '秘典', '要诀', '图纸', '配方', '手册'] },
  'creature-mount': { cores: ['踏云', '追风', '赤焰', '霜翼', '星驰', '逐日', '青角', '雷蹄'], suffixes: ['驹', '兽', '鹰', '龙', '虎机', '飞梭', '鹿', '狼'] },
  'creature-spirit-beast': { cores: ['月影', '青鸾', '白泽', '赤瞳', '星纹', '云翅', '玄角', '霜尾'], suffixes: ['狐', '鹿', '鸟', '兽', '貂', '虎', '蛟', '雀'] },
  'creature-demon-beast': { cores: ['裂岩', '噬火', '腐雾', '血棘', '铁脊', '寒爪', '狂潮', '影牙'], suffixes: ['兽', '狼', '蛛', '熊', '蜥', '鹰', '蟒', '犀'] },
  'creature-monster': { cores: ['深渊', '灰烬', '无面', '裂隙', '噬光', '梦魇', '黑潮', '腐化'], suffixes: ['魔', '领主', '巨像', '猎手', '行者', '母体', '守卫', '吞噬者'] },
  'creature-pet': { cores: ['团子', '米粒', '星点', '毛球', '阿福', '小满', '豆包', '雪球'], suffixes: ['猫', '犬', '鸟', '兽', '精灵', '团', '仔', '伙伴'] },
  'creature-mechanical': { cores: ['巡游', '壁垒', '蜂群', '开拓', '猎隼', '守望', '工程', '星梭'], suffixes: ['机', '无人机', '机甲', '傀儡', '构装体', '单元', '卫士', '平台'] },
  'ability-magic': { cores: ['炎爆', '冰棺', '风暴', '雷狱', '圣光', '暗影', '星坠', '空间'], suffixes: ['术', '魔法', '领域', '禁咒', '之环', '之门', '长矛', '壁垒'] },
  'ability-skill': { cores: ['洞察', '连击', '反击', '潜行', '统御', '采集', '锻造', '鼓舞'], suffixes: ['术', '技能', '专精', '姿态', '领域', '连携', '指令', '被动'] },
  'ability-cultivation': { cores: ['太初', '归元', '周天', '炼神', '锻体', '星辰', '混元', '长生'], suffixes: ['经', '诀', '法', '录', '功', '篇', '心法', '真解'] },
  'ability-martial-art': { cores: ['断潮', '惊雷', '叠浪', '逐日', '回风', '镇岳', '破阵', '流云'], suffixes: ['斩', '拳', '步', '枪', '剑诀', '掌', '刀法', '身法'] },
  'ability-spell': { cores: ['定身', '御风', '引雷', '照影', '封魂', '移形', '净尘', '唤灵'], suffixes: ['术', '咒', '法', '符', '印', '神通', '敕令', '诀'] },
  'ability-talent': { cores: ['战斗', '经营', '洞察', '适应', '共鸣', '幸运', '统御', '学习'], suffixes: ['天赋', '本能', '专长', '直觉', '亲和', '权能', '特性', '被动'] },
  'ability-bloodline': { cores: ['真龙', '星辰', '不灭', '太阴', '太阳', '古神', '虚空', '万灵'], suffixes: ['血脉', '圣体', '道体', '灵根', '体质', '遗传因子', '核心', '种族特性'] },
  'ability-class': { cores: ['守夜', '开拓', '御兽', '铸星', '秘仪', '战术', '边境', '时序'], suffixes: ['者', '师', '官', '骑士', '行者', '序列', '职业', '领主'] }
};

const TARGET_LEXICON_ALIASES: Record<string, string> = {
  'place-mountain-range': 'place-mountain', 'place-peak': 'place-mountain', 'place-valley': 'place-mountain',
  'place-stream': 'place-river', 'place-sea': 'place-lake', 'place-island': 'place-lake',
  'place-country': 'place-region', 'place-prefecture': 'place-region', 'place-territory': 'place-region', 'place-continent': 'place-region',
  'place-secret-realm': 'place-realm', 'place-ruin': 'place-realm', 'place-dungeon': 'place-realm', 'place-forbidden-zone': 'place-realm',
  'place-star-system': 'place-planet', 'place-star-region': 'place-planet', 'place-space-station': 'place-planet',
  'faction-school': 'faction-sect', 'faction-clan': 'faction-family', 'faction-empire': 'faction-dynasty', 'faction-kingdom': 'faction-dynasty',
  'faction-guard': 'faction-army', 'faction-fleet': 'faction-army', 'faction-adventure-party': 'faction-guild', 'faction-team': 'faction-guild',
  'faction-company': 'faction-chamber', 'faction-workshop': 'faction-chamber', 'faction-consortium': 'faction-chamber',
  'faction-research-institute': 'faction-academy', 'faction-association': 'faction-church', 'faction-secret-organization': 'faction-church',
  'item-quest': 'item-prop', 'item-device': 'item-prop', 'item-potion': 'item-medicine', 'item-pill': 'item-medicine', 'item-poison': 'item-medicine',
  'item-divine-artifact': 'item-artifact', 'item-sacred-object': 'item-artifact', 'item-accessory': 'item-armor',
  'item-ore': 'item-material', 'item-herb': 'item-material', 'item-crystal-core': 'item-gem', 'item-energy-core': 'item-gem',
  'item-formula': 'item-manual', 'item-blueprint': 'item-manual', 'item-vehicle': 'item-prop', 'item-currency': 'item-gem',
  'creature-land-mount': 'creature-mount', 'creature-flying-mount': 'creature-mount', 'creature-water-mount': 'creature-mount', 'creature-mechanical-mount': 'creature-mechanical',
  'creature-divine-beast': 'creature-spirit-beast', 'creature-contract-beast': 'creature-spirit-beast', 'creature-ferocious-beast': 'creature-demon-beast',
  'creature-boss': 'creature-monster', 'creature-summon': 'creature-spirit-beast', 'creature-alien': 'creature-demon-beast',
  'ability-elemental-magic': 'ability-magic', 'ability-arcane': 'ability-magic', 'ability-forbidden-spell': 'ability-magic',
  'ability-active-skill': 'ability-skill', 'ability-passive-skill': 'ability-skill', 'ability-profession-skill': 'ability-skill', 'ability-life-skill': 'ability-skill',
  'ability-mental-art': 'ability-cultivation', 'ability-movement': 'ability-martial-art', 'ability-sword-art': 'ability-martial-art',
  'ability-talisman': 'ability-spell', 'ability-curse': 'ability-spell', 'ability-divine-power': 'ability-spell',
  'ability-constitution': 'ability-bloodline', 'ability-spiritual-root': 'ability-bloodline', 'ability-sequence': 'ability-class',
  'ability-formation': 'ability-spell', 'ability-domain': 'ability-spell'
};

const TARGET_SUFFIX_OVERRIDES: Record<string, string[]> = {
  'place-mountain-range': ['山脉', '山系', '群山', '岭'], 'place-peak': ['峰', '巅', '岳', '主峰'], 'place-valley': ['谷', '峡', '渊谷', '山坳'],
  'place-stream': ['溪', '涧', '泉', '支流'], 'place-sea': ['海', '洋', '海湾', '海峡'], 'place-island': ['岛', '群岛', '洲', '浮岛'],
  'place-country': ['国', '王国', '共和国', '联邦'], 'place-prefecture': ['州', '郡', '府', '道'], 'place-territory': ['领', '领地', '辖区', '边境'], 'place-continent': ['大陆', '洲', '陆', '大域'],
  'place-secret-realm': ['秘境', '洞天', '福地', '小界'], 'place-ruin': ['遗迹', '遗址', '废墟', '古城'], 'place-dungeon': ['副本', '迷宫', '回廊', '关卡'], 'place-forbidden-zone': ['禁区', '禁地', '无人区', '封锁区'],
  'place-star-system': ['星系', '恒星系', '星群', '星环'], 'place-star-region': ['星域', '星区', '宇域', '星海'], 'place-space-station': ['空间站', '星港', '环城', '轨道站'],
  'faction-school': ['门', '派', '流', '馆'], 'faction-clan': ['氏族', '部族', '宗族', '联盟'], 'faction-empire': ['帝国', '皇朝', '霸权', '星国'], 'faction-kingdom': ['王国', '公国', '侯国', '邦国'],
  'faction-guard': ['卫', '卫队', '禁军', '亲卫'], 'faction-fleet': ['舰队', '船团', '海军', '星舰群'], 'faction-adventure-party': ['冒险团', '远征队', '旅团', '探索团'], 'faction-team': ['战队', '小队', '代表队', '行动组'],
  'faction-company': ['公司', '集团', '企业', '实业'], 'faction-workshop': ['工坊', '作坊', '工场', '制造所'], 'faction-consortium': ['财团', '资本', '控股', '联合会'],
  'faction-research-institute': ['研究院', '研究所', '实验室', '科学院'], 'faction-association': ['协会', '学会', '联合会', '联盟'], 'faction-secret-organization': ['结社', '密会', '机关', '暗网'],
  'item-quest': ['信物', '钥匙', '凭证', '卷轴'], 'item-device': ['装置', '机关', '仪', '机'], 'item-potion': ['药剂', '试剂', '露', '合剂'], 'item-pill': ['丹', '丸', '散', '金丹'], 'item-poison': ['毒', '毒液', '毒粉', '蚀剂'],
  'item-divine-artifact': ['神器', '神剑', '神印', '神座'], 'item-sacred-object': ['圣物', '圣杯', '圣遗物', '圣徽'], 'item-accessory': ['戒', '链', '坠', '护符'],
  'item-ore': ['矿', '矿石', '原矿', '金属'], 'item-herb': ['草', '花', '果', '灵药'], 'item-crystal-core': ['晶核', '魔核', '结晶', '内核'], 'item-energy-core': ['能源核', '反应芯', '动力核', '电池'],
  'item-formula': ['配方', '药方', '合成式', '秘方'], 'item-blueprint': ['图纸', '蓝图', '设计图', '构造图'], 'item-vehicle': ['车', '舟', '舰', '飞梭'], 'item-currency': ['币', '点数', '金券', '信用'],
  'creature-land-mount': ['驹', '兽', '狼', '虎机'], 'creature-flying-mount': ['鹰', '鸾', '翼兽', '飞龙'], 'creature-water-mount': ['鲸', '鲛', '鳐', '水兽'], 'creature-mechanical-mount': ['虎机', '飞梭', '机车', '平台'],
  'creature-divine-beast': ['神兽', '圣兽', '瑞兽', '天兽'], 'creature-contract-beast': ['契约兽', '伴生兽', '魂兽', '战宠'], 'creature-ferocious-beast': ['凶兽', '巨兽', '灾兽', '荒兽'],
  'creature-boss': ['领主', '首领', '暴君', '守关者'], 'creature-summon': ['召唤兽', '使魔', '英灵', '化身'], 'creature-alien': ['异兽', '星兽', '外星种', '异维体'],
  'ability-elemental-magic': ['魔法', '术', '之环', '长矛'], 'ability-arcane': ['奥术', '秘法', '力场', '矩阵'], 'ability-forbidden-spell': ['禁咒', '大咒', '终式', '灭世术'],
  'ability-active-skill': ['技能', '指令', '连招', '战技'], 'ability-passive-skill': ['被动', '本能', '特性', '常驻'], 'ability-profession-skill': ['专精', '职业技', '行当', '奥义'], 'ability-life-skill': ['技艺', '手艺', '术', '专长'],
  'ability-mental-art': ['心法', '内篇', '观想法', '真解'], 'ability-movement': ['步', '身法', '遁法', '游身术'], 'ability-sword-art': ['剑诀', '剑法', '剑典', '御剑术'],
  'ability-talisman': ['符', '符法', '符阵', '敕令'], 'ability-curse': ['咒', '诅咒', '咒术', '言灵'], 'ability-divine-power': ['神通', '权能', '法相', '天威'],
  'ability-constitution': ['圣体', '道体', '体质', '战体'], 'ability-spiritual-root': ['灵根', '灵脉', '道根', '资质'], 'ability-sequence': ['序列', '途径', '阶位', '位格'],
  'ability-formation': ['阵', '阵法', '结界', '大阵'], 'ability-domain': ['领域', '界域', '权域', '法域']
};

const SURNAMES = ['林', '顾', '沈', '陆', '苏', '谢', '周', '江', '许', '叶', '萧', '温', '闻', '程', '秦', '楚', '季', '白', '宋', '陈', '夏', '宁', '裴', '唐'];
const MALE_GIVEN = ['舟', '川', '野', '峥', '珩', '昭', '砚', '朔', '行', '渊', '策', '衡', '骁', '景', '尧', '修', '辰', '远', '越', '安'];
const FEMALE_GIVEN = ['宁', '澜', '月', '微', '禾', '音', '遥', '清', '岚', '棠', '瑶', '霁', '夏', '昭', '弦', '念', '知', '晚', '灵', '若'];
const NEUTRAL_GIVEN = ['言', '简', '青', '一', '知', '时', '星', '临', '黎', '墨', '宁', '安', '朝', '云', '亦', '真', '鹿', '川', '白', '予'];

const WESTERN_NAMES = {
  male: ['莱恩', '艾登', '诺兰', '塞缪尔', '维克托', '伊莱', '罗文', '凯恩', '亚瑟', '西奥'],
  female: ['艾琳', '薇拉', '塞西莉亚', '诺拉', '伊芙琳', '露西亚', '黛安娜', '米拉', '芙蕾雅', '艾尔莎'],
  neutral: ['洛恩', '希尔', '艾尔', '诺亚', '西恩', '莱尔', '安珀', '瑞恩', '塔林', '米尔']
};

export function recommendCharacterTarget(role: ProtagonistRole): string {
  if (role === 'male_lead' || role === 'male_support' || role === 'male_villain') return 'character-male';
  if (role === 'female_lead' || role === 'female_support' || role === 'female_villain') return 'character-female';
  if (role === 'non_human') return 'character-neutral';
  return 'character-neutral';
}

export function getNamingTarget(targetId: string): NamingTarget | null {
  return NAMING_TARGET_GROUPS.flatMap((group) => group.targets).find((target) => target.id === targetId) ?? null;
}

export function detectNamingStyle(context: NamingContext = {}): NamingStyle {
  const text = [context.category, ...(context.subjects ?? []), ...(context.tags ?? []), context.storyDirection]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
  let best: NamingStyle = 'general';
  let bestScore = 0;
  for (const [style, keywords] of Object.entries(STYLE_KEYWORDS) as Array<[NamingStyle, string[]]>) {
    const score = keywords.reduce((total, keyword) => total + (text.includes(keyword) ? keyword.length : 0), 0);
    if (score > bestScore) {
      best = style;
      bestScore = score;
    }
  }
  return best;
}

export function generateNamingCandidates(request: NamingRequest): NamingCandidate[] {
  const target = getNamingTarget(request.targetId);
  if (target === null) return [];
  const hint = request.hint?.trim() ?? '';
  const style = detectNamingStyle({
    ...request.context,
    tags: [...(request.context?.tags ?? []), hint]
  });
  const count = Math.max(1, Math.min(24, request.count ?? 12));
  const batch = Math.max(0, Math.trunc(request.batch ?? 0));
  const excluded = new Set((request.exclude ?? []).map(normalizeName));
  const seed = hashText(JSON.stringify({ targetId: request.targetId, context: request.context ?? {}, hint, batch }));
  const names = target.id.startsWith('character-') && ['character-male', 'character-female', 'character-neutral'].includes(target.id)
    ? generatePersonNames(target.id, style, seed, count * 5, requestedChineseNameLength(hint))
    : generateComposedNames(target.id, style, seed, count * 5);
  const unique = new Set<string>();
  const result: NamingCandidate[] = [];
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized.length === 0 || excluded.has(normalized) || unique.has(normalized)) continue;
    unique.add(normalized);
    result.push({
      name,
      note: `这是偏${styleLabel(style)}的${target.label}名字，请结合人物、地域和世界规则判断是否合适。`,
      style,
      status: 'candidate'
    });
    if (result.length >= count) break;
  }
  return result;
}

function generatePersonNames(targetId: string, style: NamingStyle, seed: number, limit: number, requestedLength: 2 | 3 | null): string[] {
  const gender = targetId === 'character-male' ? 'male' : targetId === 'character-female' ? 'female' : 'neutral';
  if (style === 'western') {
    const pool = WESTERN_NAMES[gender];
    return Array.from({ length: Math.min(limit, pool.length * 3) }, (_, index) => {
      const base = pool[indexAt(seed, index, pool.length, 17)];
      const epithet = ['', '', '·晨星', '·维恩', '·洛克', '·艾尔'][indexAt(seed, index, 6, 29)];
      return `${base}${epithet}`;
    });
  }
  const givenPool = gender === 'male' ? MALE_GIVEN : gender === 'female' ? FEMALE_GIVEN : NEUTRAL_GIVEN;
  const styleGiven = STYLE_TOKENS[style].filter((token) => token.length === 1);
  const combined = [...givenPool, ...styleGiven];
  return Array.from({ length: limit }, (_, index) => {
    const surname = SURNAMES[indexAt(seed, index, SURNAMES.length, 11)];
    const first = combined[indexAt(seed, index, combined.length, 23)];
    const second = combined[indexAt(seed, index, combined.length, 41)];
    if (requestedLength === 2) return `${surname}${first}`;
    if (requestedLength === 3) return first === second ? `${surname}${first}${combined[(indexAt(seed, index, combined.length, 59) + 1) % combined.length]}` : `${surname}${first}${second}`;
    return index % 4 === 0 || first === second ? `${surname}${first}` : `${surname}${first}${second}`;
  });
}

function requestedChineseNameLength(hint: string): 2 | 3 | null {
  if (/(?:两个字|二字|2字)/u.test(hint)) return 2;
  if (/(?:三个字|三字|3字)/u.test(hint)) return 3;
  return null;
}

function generateComposedNames(targetId: string, style: NamingStyle, seed: number, limit: number): string[] {
  const lexicon = TARGET_LEXICON[TARGET_LEXICON_ALIASES[targetId] ?? targetId];
  if (lexicon === undefined) return [];
  const prefixes = STYLE_TOKENS[style];
  const suffixes = TARGET_SUFFIX_OVERRIDES[targetId] ?? lexicon.suffixes;
  return Array.from({ length: limit }, (_, index) => {
    const prefix = prefixes[indexAt(seed, index, prefixes.length, 13)];
    const core = lexicon.cores[indexAt(seed, index, lexicon.cores.length, 31)];
    const suffix = suffixes[indexAt(seed, index, suffixes.length, 47)];
    const base = index % 6 === 0 ? `${core}${suffix}` : `${prefix}${core}${suffix}`;
    return removeRepeatedBoundary(base);
  });
}

function indexAt(seed: number, index: number, length: number, salt: number): number {
  return Math.abs((seed + Math.imul(index + 1, salt * 2_654_435_761)) | 0) % length;
}

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizeName(value: string): string {
  return value.trim().replace(/[\s·・]/g, '').toLocaleLowerCase('zh-CN');
}

function removeRepeatedBoundary(value: string): string {
  return value.replace(/(.)\1+/g, '$1');
}

function styleLabel(style: NamingStyle): string {
  const labels: Record<NamingStyle, string> = {
    xianxia: '东方幻想', historical: '历史', game: '游戏', 'science-fiction': '科幻',
    western: '西方奇幻', modern: '现代', mystery: '悬疑', general: '通用'
  };
  return labels[style];
}

