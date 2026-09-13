/**
 * R209-B2 用途树父子规则（总规格18.3八主类及子类）。
 * 匹配规则：按主类筛选时，method匹配 usageTree=主类或其子类；
 * reference匹配 facets.purposes 包含主类或其子类。筛选下拉只提供主类。
 */
export const USAGE_TREE_MAIN_CLASSES = [
  '题材与融合', '卖点与阅读体验', '人物与关系', '故事与因果', '结构与节奏', '信息与表达', '衔接与收束', '审查与修订'
] as const;

export type UsageTreeMainClass = typeof USAGE_TREE_MAIN_CLASSES[number];

const USAGE_TREE_CHILDREN: Record<UsageTreeMainClass, readonly string[]> = {
  '题材与融合': ['题材特征', '横向机制', '融合取舍', '规则兼容'],
  '卖点与阅读体验': ['核心吸引力', '反差', '情绪回报', '阅读期待'],
  '人物与关系': ['欲望动机', '人物变化', '群像', '合作对抗', '亲密关系'],
  '故事与因果': ['目标行动', '阻力选择', '事件发展', '信息因果', '故事交织'],
  '结构与节奏': ['宏观节奏', '阶段结构', '场景结构', '情绪节奏', '叙述速度'],
  '信息与表达': ['悬念伏笔', '视角声音', '时间组织', '对白描写', '叙述表现'],
  '衔接与收束': ['承接转场', '阶段回报', '长期兑现', '结局'],
  '审查与修订': ['事实连续', '意图一致', '结构检查', '文学修订']
};

/** 主类及其子类的完整匹配词表；未知主类按精确值处理。 */
export function usageTreeTerms(mainClass: string): string[] {
  const children = USAGE_TREE_CHILDREN[mainClass as UsageTreeMainClass];
  return children === undefined ? [mainClass] : [mainClass, ...children];
}
