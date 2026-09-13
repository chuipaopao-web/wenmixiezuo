/** 用途是主索引；阶段只是另一筛选维度。values与当前后台用途树一致。 */
export const CREATIVE_USAGE_NAV = [
 {value:'题材与融合',label:'设计创意与题材',children:['题材特征','横向机制','融合取舍','规则兼容']},
 {value:'卖点与阅读体验',label:'设计卖点与体验',children:['核心吸引力','反差','情绪回报','阅读期待']},
 {value:'人物与关系',label:'设计人物与关系',children:['欲望动机','人物变化','群像','合作对抗','亲密关系']},
 {value:'故事与因果',label:'组织故事与行动',children:['目标行动','阻力选择','事件发展','信息因果','故事交织']},
 {value:'结构与节奏',label:'安排结构与节奏',children:['宏观节奏','阶段结构','场景结构','情绪节奏','叙述速度']},
 {value:'信息与表达',label:'设计信息与表达',children:['悬念伏笔','视角声音','时间组织','对白描写','叙述表现']},
 {value:'衔接与收束',label:'安排衔接与结局',children:['承接转场','阶段回报','长期兑现','结局']},
 {value:'审查与修订',label:'检查与修改',children:['事实连续','意图一致','结构检查','文学修订']}
];
export function usageParent(value:string):string{return CREATIVE_USAGE_NAV.find(g=>g.value===value||g.children.includes(value))?.value??'';}
