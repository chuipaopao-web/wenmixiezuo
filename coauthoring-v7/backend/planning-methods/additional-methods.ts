import type { AuditedMethod, AuditSupply } from './audited-method-catalog.js';
const card=(key:string,title:string,category:string,intro:string,when:string,states:string):AuditedMethod=>({key,title,category,intro,when,states:states.split('') as AuditSupply[],family:'叙事方法',originalIntro:intro,aliases:[]});
export const ADDITIONAL_METHODS:AuditedMethod[]=[
 card('dialogue-objectives','对话中的不同目的','viewpoint_voice','让人物带着各自目的说话，通过应答、回避和行动改变关系或局面。','写具体对话时使用；闲聊也可用于陪伴，不要求句句争夺或泄露信息。','----o'),
 card('subtext-through-action','潜台词与行动落差','narrative_presentation','用话语、动作和实际选择的差别，让读者读到人物没有直说的意思。','关系拉扯、隐瞒或自我掩饰需要含蓄表达时使用；不把所有人物写成故弄玄虚。','---oo'),
 card('character-speech-signature','人物语言辨识','viewpoint_voice','依据身份、经历、关系和当下情绪区分用词与说话方式。','确定主要人物声音或执行对话时使用；不靠重复口头禅替代人物，不限制成长后的变化。','--ooo'),
 card('action-spatial-clarity','行动空间与动作衔接','scene_structure','交代必要的位置、障碍和动作结果，让读者跟得上追逐、战斗或现场操作。','空间关系影响行动时使用；写清关键动作即可，不逐帧列流水账，也不要求现实物理压过作品规则。','---oo'),
 card('sensory-point-of-view','感官细节与当前关注','narrative_presentation','选择当前人物会注意到的感官细节，让环境服务情绪、行动或信息。','正文场景需要具体感时使用；不堆五感清单，不在宏观规划中扩写景物。','----o'),
 card('comic-incongruity','错位趣味与笑点回响','emotional_rhythm','让身份、期待和实际反应形成有趣落差，并用后续反应或变化延续笑点。','作者希望搞怪、反差或荒诞时使用；笑点应符合角色和当前尺度，不固定每章次数。','oiooo'),
 card('ensemble-focus-rotation','群像阶段聚焦','story_form','让不同人物在各阶段承担关键选择，其他人的行动通过后果连接进来。','已有群像或多线需要安排关注重点时使用；不平均分配戏份，不将暂时退场人物的目标遗忘。','oiooo'),
 card('relationship-micro-moments','关系中的小变化','relationship_arc','通过小行动、回应和习惯变化积累亲近、疏远、信任或误解。','日常、情感或群像关系需要渐进发展时使用；不要求每次互动发生重大转折。','--ooo')
];
