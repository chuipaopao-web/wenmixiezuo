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

type ProtagonistRole = 'male_lead' | 'female_lead' | 'co_lead' | 'ensemble' | 'non_human';

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
      ['character-nonhuman', '非人角色', '器灵、精怪、人工智能与异族角色'],
      ['character-villain-code', '反派与代号', '反派称号、行动代号与隐秘身份'],
      ['character-game-handle', '游戏昵称', '玩家ID、战队昵称与虚拟身份']
    ])
  },
  {
    id: 'place', label: '地点', description: '自然地貌、聚落、地域与特殊空间',
    targets: defineTargets('place', [
      ['place-mountain', '山岳', '山、峰、岭、谷等地貌'],
      ['place-river', '江河', '江、河、川、溪等水系'],
      ['place-lake', '湖海', '湖、海、泽、湾等水域'],
      ['place-village', '村庄', '村、寨、屯、聚落'],
      ['place-town', '城镇', '镇、集、港、坊'],
      ['place-city', '城市', '城、都市与大型聚居地'],
      ['place-capital', '都城', '王都、帝都、京城与首府'],
      ['place-region', '国家与地域', '州郡、领地、国度与大陆'],
      ['place-realm', '秘境与副本', '秘境、遗迹、禁区与副本'],
      ['place-planet', '星球与星域', '星球、星系、星域与太空设施']
    ])
  },
  {
    id: 'faction', label: '势力', description: '组织、国家、门派与经营单位',
    targets: defineTargets('faction', [
      ['faction-sect', '宗门', '宗门、门派、仙府与道场'],
      ['faction-family', '家族', '世家、氏族与血脉家系'],
      ['faction-dynasty', '王朝与国家', '王朝、帝国、王国与政权'],
      ['faction-army', '军团', '军团、卫队、舰队与战部'],
      ['faction-guild', '公会', '玩家公会、冒险团与战队'],
      ['faction-chamber', '商会', '商会、公司、工坊与财团'],
      ['faction-academy', '学院', '学院、学宫、研究院与训练营'],
      ['faction-church', '教会与组织', '教会、协会、议会与秘密组织']
    ])
  },
  {
    id: 'item', label: '物品', description: '常用道具、装备、药品与稀有资源',
    targets: defineTargets('item', [
      ['item-prop', '道具', '任务道具、机关、钥匙与消耗品'],
      ['item-medicine', '药品与丹药', '药剂、丹药、毒物与治疗品'],
      ['item-artifact', '法宝', '法宝、神器、圣物与奇物'],
      ['item-weapon', '武器', '刀剑枪弓、法杖与科技武器'],
      ['item-armor', '防具', '铠甲、法袍、护盾与饰品'],
      ['item-material', '材料', '矿石、灵材、药材与科技材料'],
      ['item-gem', '宝石与核心', '宝石、晶核、能源核心与符石'],
      ['item-manual', '秘籍与典籍', '功法、图纸、配方与知识载体']
    ])
  },
  {
    id: 'creature', label: '生灵', description: '坐骑、灵兽、宠物与敌对生物',
    targets: defineTargets('creature', [
      ['creature-mount', '坐骑', '陆地、飞行、水域与机械坐骑'],
      ['creature-spirit-beast', '灵兽', '灵兽、神兽与契约兽'],
      ['creature-demon-beast', '妖兽', '妖兽、凶兽与异变生物'],
      ['creature-monster', '魔物', '魔物、怪物与副本首领'],
      ['creature-pet', '宠物', '伙伴宠物、萌宠与辅助生物'],
      ['creature-mechanical', '机械单位', '机甲、无人机、傀儡与构装体']
    ])
  },
  {
    id: 'ability', label: '能力', description: '魔法、技能、功法与成长路线',
    targets: defineTargets('ability', [
      ['ability-magic', '魔法', '元素魔法、奥术与禁咒'],
      ['ability-skill', '技能', '主动、被动、职业与生活技能'],
      ['ability-cultivation', '功法', '修炼法、心法与传承'],
      ['ability-martial-art', '武技', '招式、身法、拳法与剑诀'],
      ['ability-spell', '法术', '术法、符法、咒术与神通'],
      ['ability-talent', '天赋', '天赋、专长、特性与被动能力'],
      ['ability-bloodline', '血脉与体质', '血脉、体质、灵根与种族特性'],
      ['ability-class', '职业与序列', '职业、途径、序列与进阶称号']
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
  if (role === 'male_lead') return 'character-male';
  if (role === 'female_lead') return 'character-female';
  if (role === 'non_human') return 'character-nonhuman';
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
      note: `${styleLabel(style)}语感的${target.label}候选，请结合人物、地域和世界规则确认。`,
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
  const lexicon = TARGET_LEXICON[targetId];
  if (lexicon === undefined) return [];
  const prefixes = STYLE_TOKENS[style];
  return Array.from({ length: limit }, (_, index) => {
    const prefix = prefixes[indexAt(seed, index, prefixes.length, 13)];
    const core = lexicon.cores[indexAt(seed, index, lexicon.cores.length, 31)];
    const suffix = lexicon.suffixes[indexAt(seed, index, lexicon.suffixes.length, 47)];
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
