export type BookChannel = 'male' | 'female' | 'unlimited' | 'undecided';

export interface ChannelOption {
  id: BookChannel;
  label: string;
  description: string;
}

export interface TagOption {
  name: string;
  channels?: BookChannel[];
}

export interface BoundaryGroup {
  name: string;
  description: string;
  options: string[];
}

export const BOOK_CHANNELS: ChannelOption[] = [
  { id: 'male', label: '男频', description: '偏成长、冒险、事业与强情节' },
  { id: 'female', label: '女频', description: '偏关系、情感、成长与人物体验' },
  { id: 'unlimited', label: '不限', description: '跨频道或暂不按频道约束' },
  { id: 'undecided', label: '待确定', description: '先建书，后续讨论再确认' }
];

export const PRIMARY_GENRES: TagOption[] = [
  { name: '玄幻', channels: ['male', 'unlimited', 'undecided'] },
  { name: '仙侠', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '都市', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '历史', channels: ['male', 'unlimited', 'undecided'] },
  { name: '军事', channels: ['male', 'unlimited', 'undecided'] },
  { name: '科幻', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '游戏', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '悬疑', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '奇幻', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '武侠', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '体育', channels: ['male', 'unlimited', 'undecided'] },
  { name: '现实', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '古代言情', channels: ['female', 'unlimited', 'undecided'] },
  { name: '现代言情', channels: ['female', 'unlimited', 'undecided'] },
  { name: '幻想言情', channels: ['female', 'unlimited', 'undecided'] },
  { name: '青春校园', channels: ['female', 'unlimited', 'undecided'] },
  { name: '同人衍生', channels: ['male', 'female', 'unlimited', 'undecided'] },
  { name: '短篇故事', channels: ['male', 'female', 'unlimited', 'undecided'] }
];

export const SECONDARY_GENRES: TagOption[] = [
  { name: '高武' }, { name: '东方玄幻' }, { name: '异世大陆' }, { name: '洪荒神话' }, { name: '修仙' },
  { name: '凡人流' }, { name: '灵气复苏' }, { name: '都市异能' }, { name: '商战职场' }, { name: '娱乐圈' },
  { name: '医生' }, { name: '律师' }, { name: '警察' }, { name: '年代' }, { name: '乡村' }, { name: '抗战谍战' },
  { name: '架空历史' }, { name: '历史脑洞' }, { name: '宫斗宅斗', channels: ['female', 'unlimited', 'undecided'] },
  { name: '权谋朝堂' }, { name: '星际' }, { name: '末世' }, { name: '赛博朋克' }, { name: '未来世界' },
  { name: '无限流' }, { name: '诸天万界' }, { name: '网游' }, { name: '电竞' }, { name: '游戏异界' },
  { name: '规则怪谈' }, { name: '推理探案' }, { name: '惊悚' }, { name: '克苏鲁' }, { name: '盗墓' },
  { name: '民俗悬疑' }, { name: '西方奇幻' }, { name: '魔法学院' }, { name: '蒸汽朋克' }, { name: '兽世' },
  { name: '种田' }, { name: '美食' }, { name: '萌宝' }, { name: '豪门' }, { name: '婚恋' }, { name: '破镜重圆' },
  { name: '先婚后爱' }, { name: '穿越' }, { name: '重生' }, { name: '快穿' }, { name: '穿书' }, { name: '双向救赎' }
];

export const STORY_TRAITS: TagOption[] = [
  { name: '热血' }, { name: '爽感' }, { name: '轻松' }, { name: '幽默' }, { name: '治愈' }, { name: '温馨' },
  { name: '群像' }, { name: '成长' }, { name: '逆袭' }, { name: '升级' }, { name: '争霸' }, { name: '经营' },
  { name: '权谋' }, { name: '智斗' }, { name: '探案' }, { name: '冒险' }, { name: '生存' }, { name: '日常' },
  { name: '慢热' }, { name: '快节奏' }, { name: '强情节' }, { name: '强设定' }, { name: '感情细腻' },
  { name: '双强' }, { name: '单元剧' }, { name: '多线叙事' }, { name: '反套路' }, { name: '黑色幽默' },
  { name: '无厘头' }, { name: '暗黑' }, { name: '悲剧底色' }, { name: '正剧' }, { name: '现实向' },
  { name: '家国情怀' }, { name: '女性成长' }, { name: '男性成长' }, { name: '非遗文化' }, { name: '文化考据' }
];

export const BOUNDARY_GROUPS: BoundaryGroup[] = [
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
];

const CHANNEL_PRIORITY: Record<BookChannel, string[]> = {
  male: ['玄幻', '都市', '仙侠', '历史', '科幻', '游戏', '高武', '东方玄幻', '都市异能', '架空历史', '热血', '爽感', '成长', '升级', '争霸', '经营'],
  female: ['古代言情', '现代言情', '幻想言情', '悬疑', '仙侠', '青春校园', '宫斗宅斗', '权谋朝堂', '种田', '年代', '群像', '成长', '感情细腻', '双强', '治愈', '女性成长'],
  unlimited: ['悬疑', '科幻', '奇幻', '现实', '都市', '仙侠', '群像', '成长', '强情节', '强设定', '反套路', '现实向'],
  undecided: ['玄幻', '都市', '悬疑', '古代言情', '科幻', '仙侠', '成长', '群像', '轻松', '强情节', '慢热', '现实向']
};

export function sortTagsForChannel(options: TagOption[], channel: BookChannel): TagOption[] {
  const visible = options.filter((option) => option.channels === undefined || option.channels.includes(channel));
  const priority = CHANNEL_PRIORITY[channel];
  return [...visible].sort((left, right) => {
    const leftRank = priority.indexOf(left.name);
    const rightRank = priority.indexOf(right.name);
    if (leftRank === -1 && rightRank === -1) return left.name.localeCompare(right.name, 'zh-CN');
    if (leftRank === -1) return 1;
    if (rightRank === -1) return -1;
    return leftRank - rightRank;
  });
}

export function channelLabel(channel: BookChannel): string {
  return BOOK_CHANNELS.find((option) => option.id === channel)?.label ?? '待确定';
}
