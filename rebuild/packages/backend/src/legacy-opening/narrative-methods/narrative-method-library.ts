export const V7_NARRATIVE_METHOD_LIBRARY_VERSION = '2.0.0';

export type NarrativeScope = 'book' | 'storyline' | 'volume' | 'event' | 'scene' | 'chapter';

export const NARRATIVE_SCOPES: readonly NarrativeScope[] = [
  'book', 'storyline', 'volume', 'event', 'scene', 'chapter'
];

export type NarrativeDimension =
  | 'story_form'
  | 'macro_architecture'
  | 'chronology'
  | 'causal_dynamics'
  | 'conflict_pressure'
  | 'scene_structure'
  | 'character_arc'
  | 'relationship_arc'
  | 'information_design'
  | 'emotional_rhythm'
  | 'pacing_control'
  | 'serial_rhythm'
  | 'viewpoint_voice'
  | 'narrative_presentation'
  | 'theme_meaning'
  | 'closure_payoff';

export type NarrativeMethodKind = 'foundation' | 'framework' | 'modifier' | 'technique';
export type RecommendationTier = 'default' | 'recommended' | 'advanced';

export interface NarrativeDimensionDefinition {
  key: NarrativeDimension;
  internalLabel: string;
  responsibility: string;
  authorQuestion: string;
}

export interface NarrativeMethodDefinition {
  key: string;
  professionalName: string;
  dimension: NarrativeDimension;
  kind: NarrativeMethodKind;
  recommendationTier: RecommendationTier;
  primaryScope: NarrativeScope;
  applicableScopes: readonly NarrativeScope[];
  exclusiveGroup: string | null;
  publicExplanation: string;
  fitSignals: readonly string[];
  cautionSignals: readonly string[];
  responsibilities: readonly string[];
  legacyKeys: readonly string[];
}

export interface NarrativeSelectionResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CompiledNarrativeResponsibilities {
  scope: NarrativeScope;
  responsibilities: string[];
  publicExplanations: string[];
  guardrails: string[];
  warnings: string[];
}

export interface NarrativeLibrarySummary {
  version: string;
  totalMethods: number;
  dimensionCounts: Readonly<Record<NarrativeDimension, number>>;
  scopeCounts: Readonly<Record<NarrativeScope, number>>;
}

export const NARRATIVE_DIMENSIONS: readonly NarrativeDimensionDefinition[] = [
  dimension('story_form', '故事形态与收束', '决定全书由几条主线组织、怎样交汇，以及结尾如何收拢。', '这本书怎样组织起来，最后留下什么感觉？'),
  dimension('macro_architecture', '宏观结构', '把全书、故事线、卷或事件组织成职责清楚的大阶段。', '全书或这一卷大概怎样开始、发展、转折和结束？'),
  dimension('chronology', '时间结构', '决定故事事实时间与读者接收顺序之间的关系。', '事情按什么顺序告诉读者？'),
  dimension('causal_dynamics', '因果结构', '保证人物行动、阻力、结果和下一步互相推动。', '为什么会发生下一件事？'),
  dimension('conflict_pressure', '冲突与压力', '决定阻力从哪里来、怎样升级，以及人物为什么不能轻易退出。', '什么在阻止人物，局面为什么越来越难？'),
  dimension('scene_structure', '场景结构', '把一次具体行动写成有目标、有碰撞、有变化的戏，而不是资料说明。', '这一场戏里谁想做什么，最后什么变了？'),
  dimension('character_arc', '人物弧线', '决定人物在长期选择和代价中发生什么变化。', '主角最终会变成怎样的人？'),
  dimension('relationship_arc', '关系弧线', '决定人物之间的信任、权力、距离和承诺怎样随事件改变。', '这些人为什么靠近、疏远、结盟或决裂？'),
  dimension('information_design', '信息结构', '安排读者与角色各自知道什么、何时知道以及怎样揭晓。', '哪些答案先藏住，什么时候让读者知道？'),
  dimension('emotional_rhythm', '情绪节奏', '安排期待、压力、释放、喘息和余韵，避免情绪单调。', '读者这一段应该紧张、期待、痛快还是回味？'),
  dimension('pacing_control', '叙事速度', '控制场景、概述、停顿、跳时和交叉剪辑，让重要内容得到合适篇幅。', '哪里细写、哪里快过、哪里停下来？'),
  dimension('serial_rhythm', '连载节奏', '维持长篇追更动力，让承诺、进展、回报和下一期待持续循环。', '读者为什么愿意继续读下一章、下一卷？'),
  dimension('viewpoint_voice', '视角与声音', '决定读者贴着谁看、能够知道什么，以及叙述声音怎样保持一致。', '读者跟着谁看，由谁的感受和语言来过滤故事？'),
  dimension('narrative_presentation', '叙事表现', '选择档案、意识流、蒙太奇等特殊呈现手法，但不改变客观事实。', '这个故事需要用什么特殊方式呈现？'),
  dimension('theme_meaning', '主题与意义', '把价值冲突放进人物选择、对照和反复意象中，不用作者直接说教。', '故事最终让读者感受到什么问题和代价？'),
  dimension('closure_payoff', '收束与兑现', '决定承诺、故事线和人物代价怎样结算，以及结尾留下何种余味。', '哪些必须回答，哪些可以留白，最后落在什么感觉上？')
];

const STORY_FORM_METHODS: readonly NarrativeMethodDefinition[] = [
  method('single-core-line', '单核心线结构', 'story_form', 'framework', 'default', 'book', ['book'], 'book-topology',
    '围绕一条最重要的长期问题推进，其他内容都服务或反衬它。', ['单主角', '目标清楚', '新手友好'], ['群像是核心', '多个主角同等重要'],
    ['明确唯一长期承诺', '让辅助线在关键处服务、阻碍或照见主线', '避免支线长期夺走主线结果'], []),
  method('dual-lead-braid', '双主角交织结构', 'story_form', 'framework', 'recommended', 'book', ['book'], 'book-topology',
    '两位核心人物各自推进，又不断影响对方的选择和结局。', ['双主角', '对手变盟友', '双向关系'], ['一位角色明显只是工具人'],
    ['分别建立两位主角的目标与代价', '设计相互改变而不是轮流占篇幅', '在交汇处让双方行动共同改变局面'], []),
  method('multi-line-network', '多线并进结构', 'story_form', 'framework', 'recommended', 'book', ['book'], 'book-topology',
    '多条故事线各自有目标和进度，只在共享因果需要时切换和交汇。', ['群像', '权谋', '史诗', '多势力'], ['主线尚未成立', '角色过多但目标模糊'],
    ['为每条线定义独立问题与当前状态', '每次切线都带来新信息或新后果', '交汇必须来自共同人物、资源、秘密或冲突'], ['multi-line']),
  method('multi-line-convergence', '多线汇流', 'story_form', 'modifier', 'recommended', 'book', ['book', 'volume'], null,
    '前期分别发展的线索和人物，在关键阶段因同一件事汇合。', ['伏笔回收', '多势力决战', '群像高潮'], ['为了整齐强行让所有人同时出现'],
    ['提前保留共享因果', '让每条线带着自己的结果进入交汇', '交汇后必须形成所有参与线都能感受到的新局面'], []),
  method('episodic-spine', '单元故事串联主线', 'story_form', 'framework', 'recommended', 'book', ['book', 'volume'], 'book-topology',
    '每个单元解决一个相对完整的问题，同时长期人物、关系或谜团持续积累。', ['探案', '职业', '日常', '副本'], ['单元结束后一切归零'],
    ['为每个单元设置独立进入与退出状态', '让单元结果留下至少一项长期变化', '定期兑现贯穿主线而不是无限拖延'], ['unit-story']),
  method('ensemble-network', '群像关系网结构', 'story_form', 'framework', 'advanced', 'book', ['book'], 'book-topology',
    '不是一个人带着配角前进，而是一组人物的选择共同改变整体局势。', ['群像', '战争', '家族', '时代史诗'], ['没有清楚的共同问题', '人物只靠标签区分'],
    ['为核心人物分别建立目标、资源与盲区', '用关系和共同后果连接人物', '保持阶段焦点，避免平均分配戏份'], []),
  method('frame-story', '框架故事', 'story_form', 'modifier', 'advanced', 'book', ['book', 'volume'], null,
    '用一个现在时的讲述、调查或记录包住内部故事，让两层内容互相解释。', ['回忆录', '调查档案', '传说', '故事中故事'], ['外层只是装饰', '两层没有相互改变'],
    ['说明外层人物为什么要接触内部故事', '让内层信息改变外层判断', '结尾回应讲述行为本身的意义'], []),
  method('parallel-contrast-structure', '平行对照结构', 'story_form', 'framework', 'recommended', 'book', ['book', 'volume'], 'book-topology',
    '两条相对独立的线互相映照，让相似处境中的不同选择形成意义，不要求强行汇合。', ['双城', '双家庭', '敌我对照', '时代对照'], ['只轮流叙述没有对照价值'],
    ['为两条线建立可比较的共同问题', '让差异来自人物选择和条件', '在关键节点形成回应或反差'], []),
  method('linked-anthology', '关联式单篇合集', 'story_form', 'framework', 'advanced', 'book', ['book'], 'book-topology',
    '各个故事可以独立阅读，但共享世界、地点、物件或主题，累积出更大的整体。', ['短篇合集', '共同世界', '城市故事'], ['只有同一背景没有累计变化'],
    ['明确各篇独立闭环', '选择稳定的共享连接物', '让后篇重新解释或承接前篇留下的影响'], []),
  method('nested-thread-weave', '故事线开合编织', 'story_form', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume'], null,
    '像打开和合上盒子一样管理多条任务、地点、人物和谜团，避免同时铺开后集体遗忘。', ['长篇', '多线', '探索', '悬疑'], ['只开新线不结算旧线'],
    ['登记当前打开的故事问题', '在注意力过载前完成或暂停部分线', '让新线由旧线结果打开', '保留可回查的未决状态'], []),
  method('mosaic-network', '马赛克拼图结构', 'story_form', 'framework', 'advanced', 'book', ['book'], 'book-topology',
    '由不同人物、地点或材料提供局部碎片，读者逐渐看见一个没有单一中心的整体。', ['群像', '城市', '时代', '灾难'], ['碎片彼此无因果也无共同意义'],
    ['为每个碎片建立独立观察价值', '用共享事件或主题连接碎片', '逐步形成超出单个视角的整体理解'], [])
];

const MACRO_ARCHITECTURE_METHODS: readonly NarrativeMethodDefinition[] = [
  method('story-completeness', '开端—发展—结果完形', 'macro_architecture', 'foundation', 'default', 'book', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '先让读者进入一个明确局面，再让局面发生变化，最后给出阶段结果。', ['所有故事'], [],
    ['建立可理解的进入状态', '让中间变化由行动和后果推动', '结束时形成不同于开头的新状态'], []),
  method('three-act', '三幕式结构', 'macro_architecture', 'framework', 'recommended', 'book', ['book', 'volume', 'event', 'chapter'], 'macro-framework',
    '先建立目标，中段持续对抗并改变理解，最后用主动选择解决核心问题。', ['商业', '冒险', '目标驱动'], ['中段容易重复阻力'],
    ['尽快建立人物目标与不可回避的问题', '让中段结果迫使人物调整方法或理解', '用人物主动选择集中解决阶段冲突'], ['three-act']),
  method('four-act', '四幕式／起承转合', 'macro_architecture', 'framework', 'recommended', 'book', ['book', 'storyline', 'volume', 'event', 'chapter'], 'macro-framework',
    '先立住处境，再深化发展，用一次真正转向重排选择，最后收束结果。', ['情感', '智斗', '悬疑', '通用'], ['把“转”写成无因果的突然反转'],
    ['建立人物与局面', '让发展积累可见变化', '用有前因的转折改变理解或目标', '收束当前责任并留下后续空间'], ['four-act']),
  method('five-act', '五幕式／弗赖塔格', 'macro_architecture', 'framework', 'advanced', 'book', ['book', 'volume', 'event', 'chapter'], 'macro-framework',
    '让压力持续上升，在高点后暴露更深代价，经历下落或低谷再完成结局。', ['史诗', '历史', '悲剧', '大起大落'], ['机械追求对称', '高潮之后失去推进'],
    ['铺设冲突条件', '让行动推动压力上升', '在高点兑现重大变化', '展示高点造成的后果', '用结局回应人物最终选择'], ['five-act']),
  method('six-act', '六幕式', 'macro_architecture', 'framework', 'advanced', 'volume', ['volume', 'event'], 'macro-framework',
    '把进入、第一次转向、升级、危机、重整和解决拆成六项清楚责任。', ['动作', '群像', '多阶段卷'], ['阶段过多导致切碎', '把六项换算成固定章数'],
    ['建立进入局面', '制造第一次不可逆转向', '持续升级阻力', '让旧办法进入危机', '让人物重整方法', '集中解决阶段问题'], ['six-act']),
  method('hero-journey', '英雄之旅', 'macro_architecture', 'framework', 'advanced', 'book', ['book', 'storyline', 'volume'], 'macro-framework',
    '让人物离开熟悉处境，经受考验与代价，带着新的能力或认知进入下一阶段。', ['成长', '冒险', '奇幻'], ['把导师、门槛等名词机械逐项打卡'],
    ['建立人物原有处境与缺口', '让人物主动或被迫跨入陌生局面', '用盟友、对手和考验逼出变化', '让获得伴随真实代价', '让回归或新阶段体现人物改变'], ['hero-journey']),
  method('eight-sequence', '八序列结构', 'macro_architecture', 'framework', 'advanced', 'volume', ['volume'], 'macro-framework',
    '把较长的一卷分成数个职责不同的推进区段，每段都造成新状态。', ['长卷', '多事件', '电影感'], ['固定每段章数', '每段只是重复小高潮'],
    ['为每个推进区段定义进入问题与退出变化', '让相邻区段由结果连接', '中段必须改变后半卷的策略或意义'], ['eight-sequence']),
  method('seven-point', '七点式故事结构', 'macro_architecture', 'framework', 'advanced', 'volume', ['volume', 'event'], 'macro-framework',
    '围绕核心问题安排主动转向、外部施压和中点变化，形成强冲突路线。', ['悬疑', '惊悚', '强对抗'], ['节点比人物动机更显眼'],
    ['先明确结尾要解决的问题', '用两次主动转向改变行动方向', '用外部压力检验人物选择', '让中点重释前后内容'], ['seven-point']),
  method('story-circle', '故事圈', 'macro_architecture', 'framework', 'advanced', 'storyline', ['book', 'storyline', 'volume'], 'macro-framework',
    '围绕人物需要、进入陌生局面、得到与付出、回归与改变组织变化。', ['人物驱动', '情感', '成长'], ['只有内心变化没有外部行动'],
    ['区分人物想要与真正需要', '让人物进入必须改变旧习惯的局面', '让得到伴随代价', '用回归或新平衡证明改变'], ['story-circle']),
  method('save-the-cat', '拯救猫咪节拍表', 'macro_architecture', 'framework', 'advanced', 'volume', ['volume'], 'macro-framework',
    '尽快兑现作品卖点，中段改变胜负意义，逼近代价后用新选择完成高潮。', ['商业类型', '快节奏', '高概念'], ['逐拍照搬', '固定比例', '用打脸代替变化'],
    ['尽早让读者看到作品核心承诺', '让中段结果改变人物以为自己在做什么', '让压力逼出旧办法失效', '用新的选择完成高潮'], ['save-the-cat']),
  method('truby-22', '特鲁比22步', 'macro_architecture', 'framework', 'advanced', 'storyline', ['book', 'storyline'], 'macro-framework',
    '把欲望、弱点、对手、计划、道德选择和自我揭示织成一条长期变化链。', ['复杂人物', '道德冲突', '长线剧情'], ['一次注入全部步骤', '人物被结构工具化'],
    ['绑定外部欲望与内部弱点', '让对手攻击人物真实缺口', '让计划和反计划互相改变', '用关键选择产生自我认识和新平衡'], ['truby-22']),
  method('field-paradigm', '悉德·菲尔德范式', 'macro_architecture', 'framework', 'advanced', 'volume', ['volume'], 'macro-framework',
    '前段尽快进入本卷任务，中段用明确转折改变策略，后段集中解决。', ['商业叙事', '目标明确', '单卷'], ['换算成固定页码或比例'],
    ['建立任务前的必要条件', '用第一转折让人物正式入局', '用中段变化提高代价或改变策略', '用第二转折关闭退路并进入解决'], ['field-paradigm']),
  method('fichtean-curve', '菲希特式危机曲线', 'macro_architecture', 'framework', 'advanced', 'volume', ['volume', 'event'], 'macro-framework',
    '快速进入冲突，用一连串因果相连的危机逼近高潮，最后用较短篇幅结算。', ['惊悚', '求生', '动作', '强对抗'], ['一直加压没有人物反应', '危机彼此无因果'],
    ['尽早让人物进入必须行动的危机', '让每次解决制造下一次更难的局面', '在高潮前逼出关键选择', '高潮后完成必要后果结算'], []),
  method('kishotenketsu', '起承转结的非对抗结构', 'macro_architecture', 'framework', 'advanced', 'event', ['book', 'volume', 'event', 'chapter'], 'macro-framework',
    '先建立和发展日常或现象，再用意外视角改变理解，最后把前后内容重新连起来。', ['日常', '治愈', '寓言', '氛围'], ['没有转变只剩流水账', '把突然信息当作转'],
    ['建立可感受的初始状态', '通过细节深化而非强行冲突', '引入能重释前文的变化', '让结尾把变化与原内容连成新意义'], []),
  method('story-spine', '故事脊柱', 'macro_architecture', 'foundation', 'default', 'storyline', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '用“原来如此—直到某天—因此不断—最后—从此”快速检查故事是否真的在前进。', ['提案', '蓝图', '方向检查'], ['把简化句式直接写进正文'],
    ['说明改变发生前的稳定状态', '指出打破稳定的触发变化', '让后续行动由前一结果推动', '形成阶段性解决和新状态'], [])
];

const CHRONOLOGY_METHODS: readonly NarrativeMethodDefinition[] = [
  method('linear-chronology', '线性时间结构', 'chronology', 'framework', 'default', 'book', ['book', 'volume', 'event', 'chapter'], 'chronology-primary',
    '按事情实际发生的顺序讲，因果最清楚，也最适合长篇持续追读。', ['通用', '长篇', '成长'], ['需要隐藏关键前因时可能过早泄露'],
    ['保持事实时间连续', '回顾信息只补当前理解所需部分', '避免无意义跳时'], []),
  method('reverse-opening-backfill', '结果开场后回溯', 'chronology', 'framework', 'advanced', 'book', ['book', 'volume', 'event'], 'chronology-primary',
    '先展示一个强烈结果或危机，再回到过去说明人物怎样走到这里。', ['悬疑', '犯罪', '救赎', '传记'], ['结果剧透削弱过程', '回溯过长忘记开场'],
    ['让开场结果提出明确问题', '回溯过程不断改变读者对结果的理解', '在适当位置回到开场并继续产生新结果'], []),
  method('flashback-insertion', '插叙／闪回', 'chronology', 'modifier', 'recommended', 'event', ['book', 'volume', 'event', 'chapter'], null,
    '在当前行动需要时补出过去片段，用来改变人物选择或读者理解。', ['人物秘密', '创伤', '关系前史'], ['把背景资料整段搬进正文'],
    ['只在当前问题需要时进入过去', '每次闪回提供新的行动依据或情绪意义', '迅速返回当前线并产生影响'], []),
  method('dual-timeline', '双时间线结构', 'chronology', 'framework', 'advanced', 'book', ['book', 'volume'], 'chronology-primary',
    '两段不同时间各自推进，读者通过对应和差异逐渐理解共同真相。', ['历史谜团', '代际关系', '调查'], ['两条时间线只是轮流讲故事', '交汇答案过弱'],
    ['为两条时间线分别建立目标和悬念', '让对应细节产生重释', '设计真正改变现在的交汇点'], []),
  method('nonlinear-mosaic', '非线性拼图叙事', 'chronology', 'framework', 'advanced', 'book', ['book', 'volume'], 'chronology-primary',
    '打乱呈现顺序，让读者通过证据拼出事实，但客观时间和因果仍可回查。', ['心理', '悬疑', '实验'], ['故意混乱冒充深度', '事实顺序无法还原'],
    ['后台保存唯一可追溯事实时间', '每次跳转都增加理解或悬念', '在关键阶段提供足够锚点让读者重建真相'], ['nonlinear']),
  method('circular-chronology', '循环时间结构', 'chronology', 'framework', 'advanced', 'book', ['book', 'storyline', 'volume'], 'chronology-primary',
    '故事回到类似起点，但人物选择、理解或代价已经不同。', ['宿命', '成长', '悲剧', '寓言'], ['只做形式重复', '循环规则不一致'],
    ['定义循环中保持不变和发生变化的部分', '让每次重复积累信息或代价', '用最终差异回答人物是否真正改变'], []),
  method('in-medias-res', '从事件中段切入', 'chronology', 'modifier', 'recommended', 'event', ['book', 'volume', 'event', 'chapter'], null,
    '先让人物处在正在发生的行动里，再在读者需要时补足身份、目标和前因。', ['开场', '动作', '危机'], ['只制造混乱', '背景补充打断行动'],
    ['用可理解的即时目标给读者抓手', '延后但不隐瞒理解行动所需信息', '在行动后自然补足前因'], []),
  method('reverse-chronology', '逆向时间叙事', 'chronology', 'framework', 'advanced', 'book', ['book', 'volume'], 'chronology-primary',
    '从结果向前一层层倒推原因，每次回到更早时间都改变读者对结果的判断。', ['犯罪', '悲剧', '谜题'], ['只把章节倒排', '因果无法重建'],
    ['先建立值得追问的结果', '每段向前提供新的原因证据', '保证读者最终能够还原正向因果链'], []),
  method('flashforward-prolepsis', '预叙／闪前', 'chronology', 'modifier', 'advanced', 'chapter', ['book', 'volume', 'event', 'chapter'], null,
    '短暂展示未来画面、结果或预感，用来建立期待，但不能提前消耗核心兑现。', ['命运感', '悬念', '预言'], ['把答案直接剧透', '未来画面与主线无关'],
    ['只透露足以形成问题的未来信息', '让当前行动持续改变未来含义', '在兑现时解释画面的真实上下文'], []),
  method('parallel-simultaneous-time', '同时空平行推进', 'chronology', 'framework', 'recommended', 'event', ['book', 'volume', 'event'], 'chronology-primary',
    '在同一时间段切换不同地点或人物，让行动在时间压力下互相影响。', ['营救', '战争', '权谋', '群像'], ['切换只是拖延结果'],
    ['建立清楚的共同时间锚点', '每次切换都推进独有行动', '让一条线的结果改变另一条线的条件'], []),
  method('time-ellipsis', '省略与时间跳跃', 'chronology', 'modifier', 'default', 'chapter', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '跳过没有关键变化的过程，用进入状态和退出状态让读者理解时间已经过去。', ['长篇', '成长', '旅途', '训练'], ['跳过本应呈现的关键选择', '时间跳跃后人物突变'],
    ['说明跳时前后的事实差异', '保留造成长期变化的关键节点', '用具体痕迹表现时间与代价'], [])
];

const CAUSAL_METHODS: readonly NarrativeMethodDefinition[] = [
  method('goal-action-consequence', '目标—行动—后果闭环', 'causal_dynamics', 'foundation', 'default', 'event', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '人物因为想得到某个结果而行动，行动造成后果，后果再决定下一步。', ['所有故事'], [],
    ['说明人物此刻为什么行动', '让阻力回应人物行动而不是凭空出现', '让结果改变资源、关系、信息或选择'], []),
  method('causal-chain', '强因果链', 'causal_dynamics', 'modifier', 'recommended', 'volume', ['book', 'storyline', 'volume', 'event'], null,
    '下一件事由上一件事的结果自然引发，尽量减少巧合和作者强推。', ['逻辑', '权谋', '电影感'], ['因果过紧没有喘息和偶然空间'],
    ['为关键转折写出可回查前因', '让人物决定比巧合更能改变方向', '允许偶然发生但不允许偶然解决核心问题'], []),
  method('escalation-ladder', '升级阶梯', 'causal_dynamics', 'modifier', 'recommended', 'volume', ['book', 'storyline', 'volume', 'event'], null,
    '每次冲突升级的不只是敌人强度，还包括代价、范围、责任或选择难度。', ['升级', '战争', '冒险', '成长'], ['只换更强敌人', '数值增长没有状态变化'],
    ['定义每级升级改变的具体维度', '让上一阶段的解决方式触发新门槛', '让人物成长与责任同步扩大'], []),
  method('consequence-reversal', '后果型反转', 'causal_dynamics', 'modifier', 'recommended', 'event', ['storyline', 'volume', 'event'], null,
    '反转来自人物此前选择造成的真实后果，而不是突然公布隐藏答案。', ['权谋', '悬疑', '商战'], ['为了惊讶否定前文', '反派无证据全知'],
    ['提前放置能够回看的条件', '让人物误判有合理信息边界', '反转后必须改变行动、关系或目标'], []),
  method('mckee-causality', '麦基价值转折与危机选择', 'causal_dynamics', 'modifier', 'advanced', 'event', ['storyline', 'volume', 'event'], null,
    '让每次关键行动改变局势价值，并用无法两全的选择逼出人物真实立场。', ['强因果', '道德抉择', '电影感'], ['每场戏强行反转', '伪造没有真实代价的二选一'],
    ['标明场景前后价值怎样变化', '让危机选择来自已建立的冲突', '让高潮选择同时解决外部问题并暴露人物价值'], ['mckee-causality']),
  method('try-fail-cycle', '尝试—失败—升级循环', 'causal_dynamics', 'modifier', 'recommended', 'event', ['storyline', 'volume', 'event', 'scene'], null,
    '人物每次尝试都获得部分进展或新认识，但失败后问题以更难的形式回来。', ['冒险', '调查', '求生', '闯关'], ['重复同一种失败', '失败不产生新信息'],
    ['让每次尝试采用不同策略', '让失败留下信息、代价或局部成果', '用失败结果改变下一次行动条件'], []),
  method('yes-but-no-and', '成功有代价／失败更糟', 'causal_dynamics', 'modifier', 'default', 'scene', ['volume', 'event', 'scene', 'chapter'], null,
    '行动不能轻易归零：成功会带来代价或新责任，失败会让局面进一步恶化。', ['推进', '转折', '场景'], ['每次结果都故意为难人物', '不给真实成功'],
    ['给行动明确结果', '让结果改变至少一项资源、关系、信息或风险', '保持成功与失败的强度符合前因'], []),
  method('consequence-propagation', '后果传导链', 'causal_dynamics', 'modifier', 'recommended', 'volume', ['book', 'storyline', 'volume', 'event'], null,
    '重大行动的影响会穿过人物、关系和势力继续扩散，而不是下一章就被遗忘。', ['长篇', '战争', '权谋', '经营'], ['所有后果同时爆发', '只写口头议论'],
    ['列出直接后果与延迟后果', '让不同角色按自身利益响应', '把已发生后果编译成后续条件'], []),
  method('forced-decision-fork', '逼迫式选择分岔', 'causal_dynamics', 'modifier', 'advanced', 'event', ['storyline', 'volume', 'event', 'scene'], null,
    '把人物推进到不能兼得的选择点，选择本身关闭一条路并打开新的因果链。', ['道德选择', '关系决裂', '权力'], ['伪二选一', '人物没有拒绝或第三方案的理由'],
    ['建立各选项真实收益与代价', '说明为什么不能继续拖延', '让选择由人物价值和已知信息决定', '持续兑现被放弃选项的后果'], [])
];

const CONFLICT_METHODS: readonly NarrativeMethodDefinition[] = [
  method('direct-opposition', '目标对冲', 'conflict_pressure', 'foundation', 'default', 'event', ['book', 'storyline', 'volume', 'event', 'scene'], null,
    '双方都在主动争取互不相容的结果，所以不是一个人做事、另一个人临时来挡路。', ['所有冲突'], [],
    ['分别说明各方想得到什么', '让双方行动互相改变条件', '避免只靠误会维持冲突'], []),
  method('antagonist-counterplan', '对手反计划', 'conflict_pressure', 'modifier', 'recommended', 'volume', ['storyline', 'volume', 'event', 'scene'], null,
    '对手会观察主角的行动、调整策略并利用主角弱点，而不是固定站着等主角升级。', ['强对手', '权谋', '竞技', '战争'], ['反派无证据全知', '对手只靠临时加能力'],
    ['给对手独立目标、资源和信息边界', '让反制回应主角真实行动', '让双方都能犯错并承担后果'], []),
  method('internal-external-bind', '内外冲突咬合', 'conflict_pressure', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '外部难题会击中人物内在缺口，人物的旧习惯又会让外部局面更难。', ['人物成长', '关系', '道德抉择'], ['外部剧情和内心戏各写各的'],
    ['明确外部问题触发了什么内在防御', '让人物旧方式造成现实后果', '用外部选择验证内在变化'], []),
  method('true-dilemma', '真实两难', 'conflict_pressure', 'modifier', 'advanced', 'event', ['storyline', 'volume', 'event', 'scene'], null,
    '两个选项都保护某种重要价值，也都必须牺牲某种重要东西，不能靠隐藏第三按钮轻松化解。', ['道德', '亲情', '责任', '权力'], ['一边明显正确', '代价事后被取消'],
    ['建立两个选项各自正当性', '让人物没有无限拖延空间', '让选择永久改变关系、资源或自我认识'], []),
  method('ticking-clock', '倒计时压力', 'conflict_pressure', 'modifier', 'recommended', 'event', ['volume', 'event', 'scene', 'chapter'], null,
    '一个可信的截止点迫使人物取舍，时间减少会改变可用方案，而不只是反复提醒“来不及了”。', ['营救', '比赛', '战争', '灾难'], ['虚假倒计时', '每次都最后一秒'],
    ['说明截止点为何真实存在', '让时间流逝关闭部分方案', '让人物因时间压力承担选择代价'], []),
  method('resource-squeeze', '资源挤压', 'conflict_pressure', 'modifier', 'recommended', 'volume', ['book', 'storyline', 'volume', 'event'], null,
    '用金钱、体力、信誉、时间、人手或机会的有限性逼人物作出策略选择。', ['求生', '经营', '战争', '凡人流'], ['资源数量随作者方便变化'],
    ['登记关键资源当前数量或状态', '让消耗与行动直接对应', '允许人物通过交换和创造改变资源结构'], []),
  method('multi-front-pressure', '多战线压力', 'conflict_pressure', 'modifier', 'advanced', 'volume', ['book', 'storyline', 'volume'], null,
    '人物同时面对不同性质的问题，处理一边会牵动另一边，形成真正的优先级选择。', ['权谋', '战争', '群像', '经营'], ['同时开太多线导致失焦'],
    ['限制同时活跃的主要压力数量', '让各战线通过人物、资源或信息互相影响', '定期关闭、暂停或降级压力'], []),
  method('false-victory-defeat', '假胜利／假失败', 'conflict_pressure', 'modifier', 'advanced', 'event', ['volume', 'event'], null,
    '阶段结果表面与真实意义不同：赢了眼前却暴露更大代价，或输了眼前却得到关键条件。', ['中点', '反转', '悬疑'], ['事后强行改口', '否定读者刚看到的事实'],
    ['先让表面结果真实成立', '用既有证据揭示更深意义', '让新理解改变后续策略而不是抹掉结果'], [])
];

const SCENE_METHODS: readonly NarrativeMethodDefinition[] = [
  method('scene-goal-conflict-turn-result', '场景目标—冲突—转折—结果', 'scene_structure', 'foundation', 'default', 'scene', ['event', 'scene', 'chapter'], null,
    '一场戏里有人想完成一件具体的事，遇到阻力后局面发生变化，并带着结果离场。', ['所有场景'], [],
    ['确定视角人物进入场景的即时目标', '让阻力在场内实际发生', '制造理解、权力或行动方向的变化', '留下可影响下一场的结果'], []),
  method('scene-sequel-cycle', '行动场景—反应场景循环', 'scene_structure', 'modifier', 'recommended', 'scene', ['event', 'scene', 'chapter'], null,
    '高行动之后给人物反应、判断和决定的空间，再由新决定启动下一轮行动。', ['长篇', '人物', '高压'], ['每个行动后都机械停一场', '反应只是复述'],
    ['行动场景造成不可忽略的结果', '反应阶段处理情绪与信息', '由新的决定连接下一次行动'], []),
  method('reaction-dilemma-decision', '反应—权衡—决定', 'scene_structure', 'modifier', 'recommended', 'scene', ['event', 'scene', 'chapter'], null,
    '人物先真实承受刚发生的事，再权衡无法兼得的选项，最后作出推动剧情的决定。', ['低谷', '转折后', '关系变化'], ['角色刚受重创就立刻理性规划'],
    ['让即时反应符合人物和伤害程度', '权衡现有信息与代价', '用明确决定结束停滞'], []),
  method('scene-value-shift', '场景价值转变', 'scene_structure', 'modifier', 'default', 'scene', ['event', 'scene', 'chapter'], null,
    '场景结束时至少一项重要状态发生变化，例如信任变怀疑、主动变被动、安全变危险。', ['所有场景'], [],
    ['标明场景进入时的关键状态', '用人物行动造成变化', '确保退出状态不同且可被后文读取'], []),
  method('enter-late-exit-early', '晚进早出', 'scene_structure', 'technique', 'recommended', 'scene', ['scene', 'chapter'], null,
    '从真正有变化前不久进入，在核心结果已经成立后及时离开，减少寒暄和重复解释。', ['快节奏', '对话', '行动'], ['省掉必要因果', '所有场景都突然切断'],
    ['删去不改变关系和行动的开场准备', '保留理解冲突所需的最少前因', '在结果清楚后把余波交给合适位置'], []),
  method('motivation-reaction-unit', '刺激—反应单元', 'scene_structure', 'technique', 'recommended', 'scene', ['scene', 'chapter'], null,
    '外界刺激先发生，人物再按感知、身体、情绪、思考和行动自然反应，避免倒因为果。', ['动作', '沉浸', '第一视角'], ['每个动作拆得过细', '反应顺序机械'],
    ['先呈现人物能够感知的刺激', '让反应速度符合危险程度', '只保留改变体验或行动的反应细节'], []),
  method('scene-question-turn', '场景问题与答案转向', 'scene_structure', 'modifier', 'recommended', 'scene', ['event', 'scene', 'chapter'], null,
    '开场提出一个即时问题，结尾给出答案、部分答案或更准确的问题，让场景不是原地聊天。', ['调查', '关系', '谈判'], ['只换一个问题继续拖延'],
    ['提出本场可处理的明确问题', '让人物用行动或对话争取答案', '让结尾信息改变下一步'], []),
  method('action-reaction-balance', '行动与反应配平', 'scene_structure', 'modifier', 'default', 'chapter', ['event', 'scene', 'chapter'], null,
    '重要行为既有动作过程，也有相关人物的有效反应，避免只有事件清单或只有情绪独白。', ['所有正文'], [],
    ['把篇幅给真正改变局面的动作', '让反应体现人物差异', '删除没有新意义的重复感叹'], [])
];

const CHARACTER_ARC_METHODS: readonly NarrativeMethodDefinition[] = [
  method('positive-growth-arc', '正向成长弧线', 'character_arc', 'framework', 'recommended', 'storyline', ['book', 'storyline', 'volume'], 'character-arc-primary',
    '人物从能力、认知或责任不足，经过选择和代价成长为更完整的人。', ['成长', '升级', '冒险'], ['成长只靠别人教导', '能力成长代替人格变化'],
    ['明确人物初始缺口', '用行动失败证明旧方式的限制', '让人物通过自己的选择获得新能力或认知', '让结尾行为证明变化'], []),
  method('steadfast-arc', '坚守型／平弧线', 'character_arc', 'framework', 'recommended', 'storyline', ['book', 'storyline', 'volume'], 'character-arc-primary',
    '人物核心信念相对稳定，主要变化是影响周围的人和世界，同时接受更严格检验。', ['成熟主角', '英雄', '改革者'], ['主角永远正确', '没有代价和自我修正'],
    ['明确值得坚守的核心信念', '让世界用不同方式检验它', '允许人物修正方法而不是丢弃核心', '展示信念对他人和局面的真实影响'], []),
  method('corruption-arc', '腐化弧线', 'character_arc', 'framework', 'advanced', 'storyline', ['book', 'storyline'], 'character-arc-primary',
    '人物不断用看似合理的小妥协换取结果，最终成为自己曾经反对的人。', ['黑暗', '权力', '犯罪'], ['突然黑化', '只靠外界逼迫没有主动选择'],
    ['建立人物最初底线', '让每次越界带来真实收益和代价', '让合理化逐步改变自我认识', '用最终选择完成腐化'], []),
  method('tragic-fall-arc', '悲剧坠落弧线', 'character_arc', 'framework', 'advanced', 'storyline', ['book', 'storyline'], 'character-arc-primary',
    '人物的优点与盲点共同推动成功，也共同造成无法挽回的失败。', ['悲剧', '历史', '枭雄'], ['用命运强行惩罚人物', '失败与人物选择无关'],
    ['让人物优点在前期真实有效', '让同一倾向逐渐暴露盲点', '让关键失败来自可理解但错误的选择', '结局回应人物是否看见真相'], []),
  method('redemption-arc', '救赎弧线', 'character_arc', 'framework', 'recommended', 'storyline', ['book', 'storyline', 'volume'], 'character-arc-primary',
    '人物承认自己造成的伤害，并通过有代价的行动重新承担责任。', ['情感', '现实', '关系'], ['一句道歉完成救赎', '受害者必须原谅'],
    ['明确人物需要面对的旧债', '让承认发生在无法逃避的事实前', '用持续行动而不是口头悔悟完成补偿', '允许救赎与被原谅分离'], []),
  method('circular-character-arc', '回到原点的变化弧线', 'character_arc', 'framework', 'advanced', 'storyline', ['book', 'storyline'], 'character-arc-primary',
    '人物回到类似处境，却因经历过一切而作出不同选择或接受不同答案。', ['宿命', '哲思', '成长'], ['变化只靠解释', '回到原点抹去全部经历'],
    ['设置可重复检验的初始选择', '让经历逐步改变人物理解', '在结尾用相似处境验证真正变化'], []),
  method('disillusionment-arc', '祛魅弧线', 'character_arc', 'framework', 'advanced', 'storyline', ['book', 'storyline', 'volume'], 'character-arc-primary',
    '人物失去一个曾经相信的错误答案，虽然更痛苦，却开始看清真实世界和自己的责任。', ['现实', '成长', '理想破灭'], ['把成熟写成冷漠', '只拆掉信念不给新选择'],
    ['建立人物真诚信奉的错误答案', '用事实逐步暴露其限制', '让人物承受承认错误的代价', '形成更诚实但不必乐观的新立场'], []),
  method('want-need-gap', '欲望与真实需要的落差', 'character_arc', 'modifier', 'default', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '人物追逐自己以为想要的东西，事件逐渐暴露他真正需要面对的缺口。', ['成长', '情感', '喜剧', '悲剧'], ['真实需要由作者说教宣布'],
    ['分别写清外在欲望和内在缺口', '让追逐欲望同时暴露缺口', '用选择决定人物是否接受真实需要'], []),
  method('lie-truth-transition', '错误信念到可承担真相', 'character_arc', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume'], null,
    '人物依靠一个能自我保护却限制人生的信念活着，直到代价迫使他接受更难的真相。', ['创伤', '成长', '关系'], ['一句点醒完成转变', '真相只是正确口号'],
    ['说明错误信念曾怎样保护人物', '用重复选择暴露其代价', '让真相通过行动被验证', '保留改变后的旧习惯反弹'], []),
  method('wound-defense-choice', '创伤—防御—选择链', 'character_arc', 'modifier', 'recommended', 'event', ['storyline', 'volume', 'event', 'scene'], null,
    '过去伤害形成当下防御习惯，防御会影响关系和判断，关键选择决定人物继续逃避还是尝试改变。', ['心理', '关系', '救赎'], ['用创伤替人物开脱一切', '反复闪回代替行动'],
    ['把创伤与当前防御行为连接', '展示防御带来的现实收益和伤害', '用当前选择而非回忆完成变化'], [])
];

const RELATIONSHIP_METHODS: readonly NarrativeMethodDefinition[] = [
  method('trust-ladder', '信任阶梯', 'relationship_arc', 'foundation', 'default', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '关系通过一次次有风险的托付和回应逐步变化，不靠突然交心或作者宣布亲密。', ['友情', '爱情', '团队', '师徒'], [],
    ['记录当前信任程度与未开放边界', '用具体托付检验关系', '让回应改变下一次可共享的信息或责任'], []),
  method('attraction-obstacle-commitment', '靠近—阻碍—承诺', 'relationship_arc', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '两个人因为真实价值互相靠近，又因目标、身份或恐惧受阻，最终用行动决定关系。', ['爱情', '搭档', '知己'], ['只靠误会拖延', '表白代替共同经历'],
    ['建立互相吸引的具体原因', '让阻碍来自人物或现实目标', '用有代价的行动确认或拒绝关系'], []),
  method('rivalry-respect-arc', '竞争到尊重', 'relationship_arc', 'modifier', 'recommended', 'storyline', ['storyline', 'volume', 'event'], null,
    '对手在持续竞争中看见彼此能力和底线，关系可能走向尊重、合作或更深决裂。', ['竞技', '宿敌', '职场'], ['对手突然惺惺相惜', '竞争结果不影响关系'],
    ['建立双方都重视的竞争标准', '让胜负暴露能力与品格', '让尊重不等于取消利益冲突'], []),
  method('alliance-under-pressure', '压力下的联盟', 'relationship_arc', 'modifier', 'recommended', 'volume', ['storyline', 'volume', 'event'], null,
    '原本目标不同的人因共同威胁合作，合作过程不断暴露利益边界与未来裂缝。', ['权谋', '冒险', '战争'], ['共同敌人消失后关系自动维持'],
    ['说明各方合作的最低共同利益', '保留不能共享的秘密和红线', '让关键选择决定联盟升级或破裂'], []),
  method('betrayal-repair-arc', '背叛与信任修复', 'relationship_arc', 'framework', 'advanced', 'storyline', ['book', 'storyline', 'volume'], 'relationship-arc-primary',
    '背叛造成的事实伤害不会因解释消失，关系只能通过真相、责任和持续行动决定是否重建。', ['情感', '权谋', '团队'], ['一句误会解除恢复原样', '受害者被迫原谅'],
    ['明确背叛行为与实际伤害', '区分原因解释和责任承担', '用长期可验证行动重建有限信任', '允许关系不恢复'], []),
  method('mentor-inheritance-arc', '师承与超越', 'relationship_arc', 'framework', 'recommended', 'storyline', ['book', 'storyline', 'volume'], 'relationship-arc-primary',
    '人物从依赖导师到理解传承，再通过独立选择继承、修正或超越导师。', ['师徒', '传承', '成长'], ['导师只负责送技能', '弟子复制导师'],
    ['建立导师能教与不能替代的部分', '让分歧暴露双方局限', '用弟子独立行动完成传承变化'], []),
  method('family-repair-boundary', '家庭修复与边界重建', 'relationship_arc', 'framework', 'recommended', 'storyline', ['book', 'storyline', 'volume'], 'relationship-arc-primary',
    '家庭成员面对旧伤和角色固化，通过承担、拒绝或重新协商建立新的相处边界。', ['亲情', '现实', '家族'], ['血缘自动获得原谅', '和解抹去伤害'],
    ['说明旧家庭角色怎样限制人物', '让冲突暴露不同成员需求', '用新的责任和边界定义关系结果'], [])
];

const INFORMATION_METHODS: readonly NarrativeMethodDefinition[] = [
  method('shared-mystery', '共同未知的谜团', 'information_design', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '读者和主角都不知道答案，通过行动和证据一起接近真相。', ['悬疑', '探索', '身世'], ['无限拖延答案', '答案与证据无关'],
    ['提出可追查的核心问题', '每次进展增加证据或排除可能', '阶段揭晓必须改变下一步'], []),
  method('withheld-secret', '角色持有的秘密', 'information_design', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '某个角色知道关键信息但没有告诉读者，行为细节会留下可回看的痕迹。', ['关系', '权谋', '身份'], ['角色无理由保密', '揭晓前毫无线索'],
    ['说明角色保密的利益和代价', '让秘密影响当前行动', '留下不泄底但可回看的异常', '在揭晓时重释关系或事件'], []),
  method('dramatic-irony', '戏剧反讽', 'information_design', 'modifier', 'advanced', 'event', ['storyline', 'volume', 'event', 'chapter'], null,
    '读者知道角色不知道的事实，因此会期待、担忧或看见人物判断中的讽刺。', ['悲剧', '喜剧', '情感', '权谋'], ['读者优势维持过久导致角色显蠢'],
    ['明确读者比角色多知道什么', '让角色在其信息范围内保持聪明', '让信息差产生具体选择后果', '在合适时机改变双方信息状态'], []),
  method('information-asymmetry', '角色间信息差', 'information_design', 'modifier', 'recommended', 'event', ['book', 'storyline', 'volume', 'event'], null,
    '不同角色掌握不同事实，信息本身成为交易、欺骗、保护或博弈资源。', ['权谋', '商战', '谍战', '推理'], ['所有人靠作者方便选择性失明'],
    ['记录每个参与者实际知道与误以为知道的内容', '让行动严格服从其信息边界', '让信息流动改变关系和局势'], []),
  method('progressive-reveal', '分层揭晓', 'information_design', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '每次答案都解决一部分问题，同时改变读者对更大问题的理解。', ['长线谜团', '身世', '世界真相'], ['每次只加新谜团不回答旧问题'],
    ['把真相拆成有因果关系的层级', '每次揭晓同时兑现旧期待和打开新理解', '最终答案必须解释关键证据'], []),
  method('suspense-pressure', '未决危险与期待', 'information_design', 'modifier', 'default', 'chapter', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '保留一个读者真正在意的未决问题，让下一步行动具有期待，而不是每次强行卡断。', ['所有连载'], ['只提问不兑现', '章末固定制造突发危险'],
    ['建立与人物目标相关的未决问题', '按承诺大小安排兑现距离', '允许用情绪余韵、决定或新信息形成下一期待'], ['continuation-hook']),
  method('central-dramatic-question', '核心戏剧问题', 'information_design', 'foundation', 'default', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '用一个读者能够持续追踪的问题组织期待，例如“他能否救回妹妹”，并让进展不断改变答案概率。', ['所有故事'], [],
    ['把问题绑定人物目标和代价', '让每个阶段提供新证据或新条件', '在承诺范围内给出明确回答'], []),
  method('fair-play-clue-chain', '公平线索链', 'information_design', 'modifier', 'recommended', 'storyline', ['storyline', 'volume', 'event', 'scene'], null,
    '真相揭晓前已经放出可识别证据，读者可以误判但不会被作者临时换答案。', ['悬疑', '推理', '身世', '权谋'], ['线索只有揭晓后才能勉强解释'],
    ['为真相准备至少一种可回查证据', '让线索在当时有合理表面含义', '确保揭晓能够解释关键异常'], []),
  method('red-herring-control', '误导线索控制', 'information_design', 'technique', 'advanced', 'event', ['storyline', 'volume', 'event'], null,
    '利用人物和读者已有假设制造合理误判，但误导本身也必须是真实事实而非作者撒谎。', ['推理', '悬疑', '权谋'], ['无意义假线索', '叙述故意隐去眼前事实'],
    ['让误导建立在真实证据和合理偏见上', '控制误导持续时间', '揭晓后说明为何曾经判断错误'], []),
  method('setup-payoff', '铺设与回收', 'information_design', 'foundation', 'default', 'storyline', ['book', 'storyline', 'volume', 'event', 'scene', 'chapter'], null,
    '前面自然出现的人物、规则、物件或承诺，在后面以改变局面的方式重新发挥作用。', ['所有长篇'], [],
    ['铺设时先服务当前场景', '按重要程度安排回收距离', '回收必须符合已建立能力与条件', '避免事后新增关键设定'], []),
  method('delayed-context-reframe', '延迟语境重释', 'information_design', 'modifier', 'advanced', 'event', ['storyline', 'volume', 'event', 'chapter'], null,
    '先让读者看到真实但不完整的行为，后来补足语境，使同一事实产生新的理解。', ['关系', '悬疑', '悲剧'], ['故意隐瞒视角人物明知的关键信息'],
    ['确保前后呈现的客观事实一致', '延迟内容必须有合理信息边界', '新语境要改变判断或行动'], [])
];

const EMOTIONAL_METHODS: readonly NarrativeMethodDefinition[] = [
  method('anticipation-pressure-release', '铺垫—压制—释放', 'emotional_rhythm', 'modifier', 'default', 'event', ['book', 'storyline', 'volume', 'event'], null,
    '先建立读者期待，再让阻力和代价积累，最后用符合前因的结果释放情绪。', ['通用', '爽感', '情感', '悬疑'], ['压制过久', '释放没有前置积累'],
    ['明确读者期待什么结果', '让压力逐步作用于人物在意的东西', '用行动兑现爽、泪、惊或释然', '保留结果余波'], []),
  method('tension-relief', '紧张与舒缓交替', 'emotional_rhythm', 'modifier', 'default', 'volume', ['book', 'volume', 'event', 'chapter'], null,
    '高压之后给人物和读者消化、关系或日常空间，再进入下一轮压力。', ['长篇', '战争', '冒险'], ['舒缓段完全没有变化', '紧张段密度始终相同'],
    ['根据上一段压力安排恢复需要', '让舒缓段推进关系、信息或价值感', '从恢复中自然长出下一问题'], []),
  method('hope-despair-cycle', '希望与绝望循环', 'emotional_rhythm', 'modifier', 'advanced', 'event', ['volume', 'event'], null,
    '给出真实希望，再让既有因果造成挫败，最终由人物行动争取新的可能。', ['求生', '惊悚', '战争', '冒险'], ['连续假希望欺骗读者', '绝望只靠临时加难'],
    ['让希望具有可相信的依据', '让挫败来自已存在的限制', '每轮循环增加信息、代价或人物变化', '最终希望必须由行动赢得'], []),
  method('emotional-staircase', '情绪阶梯', 'emotional_rhythm', 'modifier', 'recommended', 'volume', ['book', 'volume', 'event'], null,
    '相似情绪每次作用到更重要的人、目标或代价上，形成层层加深的体验。', ['升级', '复仇', '关系'], ['只把对手身份变高', '重复同一种场景'],
    ['改变情绪触发条件而不是复制桥段', '逐级提高人物真正失去或获得的东西', '在高点改变关系或自我认识'], []),
  method('payoff-afterglow', '兑现与余韵', 'emotional_rhythm', 'modifier', 'recommended', 'event', ['volume', 'event', 'chapter'], null,
    '重要结果发生后不立刻跳走，让人物、关系和世界对结果作出反应。', ['高潮', '关系确认', '真相揭晓'], ['用解释重复刚发生的事'],
    ['展示结果对关键人物的具体影响', '让收获与代价同时落地', '用余韵形成新的期待或阶段结束感'], []),
  method('emotional-contrast', '情绪对照', 'emotional_rhythm', 'modifier', 'recommended', 'chapter', ['volume', 'event', 'scene', 'chapter'], null,
    '用相邻但不同的情绪状态互相衬托，让喜悦、恐惧或悲伤更鲜明。', ['群像', '悲喜', '战争', '情感'], ['为了反差破坏人物反应真实性'],
    ['确定主情绪与对照情绪', '让转换来自人物或局面变化', '保留上一情绪的余波'], []),
  method('cathartic-release', '情感宣泄与净化', 'emotional_rhythm', 'modifier', 'advanced', 'event', ['storyline', 'volume', 'event', 'scene'], null,
    '长期压抑的恐惧、愧疚、愤怒或爱在关键行动中得到释放，让读者和人物共同完成情绪结算。', ['悲剧', '救赎', '复仇', '亲情'], ['靠长篇哭喊代替行动兑现'],
    ['提前积累具体情感债务', '让宣泄发生在有意义的行动或承认中', '展示释放后的关系与生活变化'], []),
  method('dread-accumulation', '不祥感累积', 'emotional_rhythm', 'modifier', 'advanced', 'event', ['volume', 'event', 'scene', 'chapter'], null,
    '通过越来越具体的异常和选择后果累积不安，让恐惧来自理解正在逼近而不是突然音效。', ['恐怖', '惊悚', '灾难'], ['只重复气氛描写', '危险规则任意改变'],
    ['从轻微但可解释的异常开始', '逐步减少安全解释', '让人物行动确认或加剧威胁'], []),
  method('comic-relief', '喜剧缓冲', 'emotional_rhythm', 'modifier', 'recommended', 'scene', ['volume', 'event', 'scene', 'chapter'], null,
    '在高压中用人物性格、关系或处境产生短暂轻松，同时不取消正在发生的危险和代价。', ['长篇', '冒险', '群像'], ['严肃后果被玩笑抹掉', '角色沦为固定逗哏'],
    ['让幽默符合人物和处境', '控制时机不打断核心情绪', '让轻松同时推进关系或信息'], [])
];

const PACING_METHODS: readonly NarrativeMethodDefinition[] = [
  method('scene-summary-balance', '场景与概述配比', 'pacing_control', 'foundation', 'default', 'chapter', ['book', 'volume', 'event', 'chapter'], null,
    '关键选择和关系变化用场景呈现，重复过程和过渡用概述压缩，避免全书一个速度。', ['所有长篇'], [],
    ['识别必须亲历的关键时刻', '压缩不产生新选择的重复过程', '用具体结果连接概述前后'], []),
  method('narrative-compression', '叙事压缩', 'pacing_control', 'modifier', 'default', 'chapter', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '用代表性细节和结果快速跨过较长过程，同时保留影响人物和事实的关键变化。', ['训练', '旅途', '经营', '时间跨度'], ['把成长过程一句带过', '跳过关键代价'],
    ['选择能代表阶段变化的细节', '保留转折和不可逆选择', '明确压缩后的新状态'], []),
  method('dramatic-expansion', '关键时刻扩写', 'pacing_control', 'modifier', 'recommended', 'scene', ['event', 'scene', 'chapter'], null,
    '在决定、危险或关系转折处放慢，让感知、行动与微小反应承载重量。', ['高潮', '告白', '真相', '战斗'], ['所有动作都慢镜头', '细节没有选择意义'],
    ['只扩写不可替代的关键时刻', '让细节服务感知和决定', '在结果成立后恢复正常速度'], []),
  method('acceleration-deceleration', '加速与减速', 'pacing_control', 'modifier', 'recommended', 'event', ['volume', 'event', 'scene', 'chapter'], null,
    '随着风险和任务变化调整场景长度、信息密度与转场速度，让节奏有方向而非随机快慢。', ['动作', '悬疑', '高潮'], ['越紧张句子越碎的机械规则'],
    ['根据人物可用时间与认知压力调整速度', '在关键选择前后留出可理解空间', '避免速度变化破坏因果'], []),
  method('crosscutting-pressure', '交叉剪辑推进', 'pacing_control', 'technique', 'advanced', 'event', ['volume', 'event', 'chapter'], null,
    '在同时发生且彼此影响的行动之间切换，利用时间压力和信息差共同推高结果。', ['营救', '战争', '群像', '倒计时'], ['为了卡点频繁切断', '各线没有共同结果'],
    ['建立共享时间或因果锚点', '每次切换带来新的进展', '在交汇或错失处完成共同结果'], []),
  method('montage-compression', '蒙太奇式组接', 'pacing_control', 'technique', 'advanced', 'chapter', ['volume', 'event', 'chapter'], null,
    '用一组有共同方向的短片段快速表现训练、扩张、衰败或关系变化。', ['时间跨度', '成长', '战争准备'], ['片段只是装饰', '缺少进入和退出状态'],
    ['为片段组设定统一变化方向', '选择彼此递进而非重复的瞬间', '用最后片段落到新状态'], []),
  method('strategic-pause', '有意义的停顿', 'pacing_control', 'modifier', 'recommended', 'scene', ['volume', 'event', 'scene', 'chapter'], null,
    '在重大信息或决定前后短暂停下，让人物和读者理解重量，但停顿本身仍包含观察、选择或关系。', ['情感', '真相', '死亡', '决断'], ['停顿变成长篇解释'],
    ['说明停顿在处理什么变化', '用具体感知或行为承载沉默', '在意义落地后重新行动'], [])
];

const SERIAL_METHODS: readonly NarrativeMethodDefinition[] = [
  method('opening-promise', '开篇承诺与早期兑现', 'serial_rhythm', 'modifier', 'default', 'volume', ['book', 'volume', 'event'], null,
    '开篇尽快让读者看见核心卖点、主角行动和第一次有效结果，具体篇幅由故事需要决定。', ['开书', '首卷', '连载'], ['只留钩子不兑现', '为了快牺牲人物可信度'],
    ['尽早建立读者问题和主角处境', '让主角作出能够体现作品特色的行动', '在合适篇幅给出第一次真实回报', '用回报打开更大的长期承诺'], ['golden-three']),
  method('progression-loop', '成长推进循环', 'serial_rhythm', 'modifier', 'recommended', 'volume', ['book', 'storyline', 'volume', 'event'], null,
    '新门槛促使人物行动获取能力、资源或地位，胜利与代价共同打开更高层问题。', ['玄幻', '修仙', '游戏', '职业成长'], ['重复换地图和更强敌人', '成长没有选择与代价'],
    ['建立当前门槛的具体限制', '让成长来自行动和付出', '让获得改变解决问题的方式', '让新阶段问题来自本次结果'], ['upgrade-loop']),
  method('pressure-payoff-loop', '压力与回报循环', 'serial_rhythm', 'modifier', 'recommended', 'event', ['volume', 'event'], null,
    '让压制、准备、反证、结果和收获形成因果闭环，不把打脸当成唯一回报。', ['爽文', '逆袭', '竞技'], ['重复轻视—反杀', '回报脱离人物目标'],
    ['建立读者认可的压力来源', '让人物进行可见准备或承担风险', '用行动结果完成回报', '让回报改变资源、关系、身份或认知'], ['payoff-loop']),
  method('promise-progress-payoff', '承诺—进展—兑现', 'serial_rhythm', 'foundation', 'default', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '先让读者知道值得期待什么，再持续给出有效进展，最后按承诺大小完成兑现。', ['所有长篇'], [],
    ['登记长期与短期承诺', '每次回访都提供新进展而不是重复提醒', '在读者耐心耗尽前完成相称兑现', '兑现后建立下一层承诺'], []),
  method('arc-close-next-open', '阶段收束与下一期待', 'serial_rhythm', 'modifier', 'default', 'volume', ['volume', 'event', 'chapter'], null,
    '完成当前阶段责任，同时从结果本身自然产生下一阶段值得追的内容。', ['卷末', '事件结束', '章末'], ['当前问题没解决就急着开新坑'],
    ['先结算当前问题的真实结果', '保留结果带来的新责任、代价或机会', '让下一期待来自当前结果而不是空降危机'], []),
  method('recovery-window', '恢复与关系窗口', 'serial_rhythm', 'modifier', 'recommended', 'volume', ['volume', 'event', 'chapter'], null,
    '在连续高压之间安排恢复、日常和关系推进，让人物有机会消化变化。', ['长篇', '高压', '战斗', '悬疑'], ['恢复内容与主线完全断裂'],
    ['结算身体、资源和情绪损耗', '让人物关系回应刚发生的事', '用恢复阶段暴露新的需求或矛盾'], []),
  method('chapter-micro-arc', '章节微弧线', 'serial_rhythm', 'foundation', 'default', 'chapter', ['chapter'], null,
    '一章围绕一个当前问题发生可感知变化，即使问题未解决，人物也不能完全回到章首状态。', ['所有连载'], [],
    ['建立本章即时问题', '让至少一次行动改变条件', '用结果、决定或新理解形成章尾状态'], []),
  method('partial-answer-new-question', '部分回答并升级问题', 'serial_rhythm', 'modifier', 'default', 'chapter', ['event', 'chapter'], null,
    '本章回答读者已经等待的问题，同时让答案自然暴露一个更准确或更大的问题。', ['悬疑', '连载', '探索'], ['永远只加问题不回答'],
    ['选择本章必须兑现的旧问题', '给出实质答案或结果', '让新问题来自答案后果'], []),
  method('cliffhanger-spectrum', '章尾期待谱系', 'serial_rhythm', 'modifier', 'recommended', 'chapter', ['chapter'], null,
    '章尾可以是危险、决定、发现、关系变化或情绪余韵，不必每章都在动作中硬切断。', ['所有连载'], ['每章同一种悬崖', '为了追更破坏场景完整'],
    ['根据本章结果选择匹配的期待类型', '优先完成本章核心变化', '让下一期待与人物目标相关'], []),
  method('open-loop-budget', '未决问题预算', 'serial_rhythm', 'modifier', 'recommended', 'volume', ['book', 'storyline', 'volume', 'event'], null,
    '控制同时打开的长期和短期问题数量，及时回访、兑现、暂停或关闭，避免读者和 AI 一起遗忘。', ['长篇', '多线', '悬疑'], ['无限开坑', '所有问题同时回收'],
    ['登记未决问题及承诺层级', '为活跃问题安排进展或兑现窗口', '关闭失效问题并保留历史结果'], []),
  method('recap-through-consequence', '以后果代替复述', 'serial_rhythm', 'modifier', 'default', 'chapter', ['volume', 'event', 'chapter'], null,
    '通过伤势、关系、资源和决定的当前变化提醒读者前情，而不是让角色重新讲一遍。', ['长篇', '断更恢复', '复杂剧情'], ['开章大段前情提要混入正文'],
    ['选择当前行动真正需要的旧事实', '用事实后果或人物态度自然唤起', '不重复读者刚看过的内容'], [])
];

const VIEWPOINT_METHODS: readonly NarrativeMethodDefinition[] = [
  method('limited-viewpoint', '单一限知视角', 'viewpoint_voice', 'framework', 'default', 'book', ['book', 'volume', 'event', 'scene', 'chapter'], 'viewpoint-primary',
    '读者主要贴着一个人物感受和判断，只知道这个人物能够接触的信息。', ['代入', '悬疑', '成长'], ['为了保密让人物忽略眼前事实'],
    ['明确当前视角人物能感知和理解什么', '避免无来源读取他人内心', '用人物盲区制造自然信息边界'], []),
  method('multi-viewpoint', '多视角叙事', 'viewpoint_voice', 'framework', 'recommended', 'book', ['book', 'volume'], 'viewpoint-primary',
    '在不同核心人物之间切换，让读者看见同一局势的不同目标和盲区。', ['群像', '权谋', '战争'], ['切换只为补资料', '视角声音没有区别'],
    ['每次切换都带来独有行动或信息', '保持视角人物语言和关注差异', '在交汇处让视角之间产生影响'], []),
  method('omniscient-viewpoint', '全知叙事', 'viewpoint_voice', 'framework', 'advanced', 'book', ['book', 'volume'], 'viewpoint-primary',
    '叙述者可以跨人物和空间观察，但仍应有清楚焦点，不能把所有答案提前说完。', ['史诗', '时代', '群像'], ['信息泛滥', '人物失去主体感'],
    ['为每个场景选择主要关注对象', '控制叙述者透露信息的目的', '用宏观视野扩大意义而不是替人物解释'], []),
  method('unreliable-narrator', '不可靠叙述', 'viewpoint_voice', 'modifier', 'advanced', 'book', ['book', 'volume', 'chapter'], null,
    '叙述呈现人物相信或声称的版本，同时用可回查细节保留客观事实。', ['心理', '悬疑', '第一人称'], ['无证据翻案', '作者故意撒谎'],
    ['区分客观事实、人物认知和叙述表达', '建立不可靠的具体原因', '留下公平的矛盾证据', '揭示后重释而不是否定前文'], ['unreliable']),
  method('objective-camera-viewpoint', '客观镜头视角', 'viewpoint_voice', 'framework', 'advanced', 'event', ['book', 'volume', 'event', 'scene', 'chapter'], 'viewpoint-primary',
    '只呈现可观察的行为、语言和环境，不直接进入人物内心，让读者自己判断。', ['悬疑', '冷峻', '戏剧', '群像'], ['人物情感变得不可理解'],
    ['只写当前可观察事实', '用行为和选择承载心理', '在关键信息处保持公平可读'], []),
  method('first-person-voice', '第一人称亲历声音', 'viewpoint_voice', 'modifier', 'recommended', 'book', ['book', 'volume', 'event', 'scene', 'chapter'], 'person-mode',
    '由“我”讲述亲历内容，语言、判断和遗漏都体现这个人的身份与局限。', ['代入', '成长', '自述'], ['所有角色说话像同一个作者', '我知道不可能知道的事'],
    ['建立叙述者稳定的关注和语言习惯', '严格限制可知信息', '让叙述声音随经历发生有证据的变化'], []),
  method('second-person-address', '第二人称指向', 'viewpoint_voice', 'technique', 'advanced', 'chapter', ['book', 'event', 'chapter'], 'person-mode',
    '用“你”制造自我分裂、直接召唤或特殊互动感，只在有明确叙事理由时使用。', ['实验', '创伤', '互动', '书信'], ['只为显得特别', '指代对象不清'],
    ['明确“你”实际指向谁', '让称呼方式服务人物关系或心理', '保持指向规则稳定'], []),
  method('free-indirect-discourse', '自由间接引语', 'viewpoint_voice', 'technique', 'advanced', 'scene', ['event', 'scene', 'chapter'], null,
    '第三人称叙述自然染上视角人物的词汇和判断，不用反复写“他想”。', ['贴近人物', '文学表达', '心理'], ['叙述者与人物声音混乱'],
    ['保持事实叙述与人物判断可区分', '让词汇符合人物身份', '在切换视角时重新建立声音边界'], [])
];

const PRESENTATION_METHODS: readonly NarrativeMethodDefinition[] = [
  method('documentary-narrative', '书信／档案／记录叙事', 'narrative_presentation', 'technique', 'advanced', 'event', ['book', 'volume', 'event', 'chapter'], null,
    '用书信、日志、卷宗、聊天记录等带来源的材料推进故事和信息差。', ['调查', '历史', '网络', '档案'], ['材料只是说明书', '所有角色写作声音相同'],
    ['说明材料由谁在何时为何留下', '让缺失、删改和偏见成为信息的一部分', '让材料改变当前人物的行动'], []),
  method('meta-narrative', '元叙事', 'narrative_presentation', 'technique', 'advanced', 'book', ['book', 'volume', 'event'], null,
    '把讲故事、读故事或作品规则本身变成剧情装置，同时保持人物情感真实。', ['实验', '第四面墙', '作品内作品'], ['只靠玩梗', '叙述装置压过人物'],
    ['明确叙事层与故事层的关系', '让越界行为产生真实后果', '保证即使去掉技巧，人物目标仍然成立'], ['meta']),
  method('symbolic-motif', '象征与重复意象', 'narrative_presentation', 'technique', 'advanced', 'book', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '让反复出现的物件、场景或动作随着人物选择改变意义，表层故事仍独立成立。', ['主题', '寓言', '文学表达'], ['只剩象征解释', '意象重复但意义不变'],
    ['选择与人物核心问题相关的意象', '让意象随情境和选择改变含义', '避免人物直接解释象征答案'], ['symbolic']),
  method('stream-of-consciousness', '意识流呈现', 'narrative_presentation', 'technique', 'advanced', 'scene', ['event', 'scene', 'chapter'], null,
    '按人物当下感知、联想和记忆流动呈现意识，让形式贴近心理状态。', ['心理', '创伤', '梦境', '文艺'], ['没有锚点的随机句子', '长时间失去行动'],
    ['保留触发联想的现实感知锚点', '让意识流暴露当前冲突', '在读者失去方向前回到可追踪行动'], []),
  method('interior-monologue', '内心独白', 'narrative_presentation', 'technique', 'recommended', 'scene', ['event', 'scene', 'chapter'], null,
    '直接呈现人物没有说出口的思考，用于选择、矛盾和自我欺骗，而不是解释全部背景。', ['心理', '抉择', '第一人称'], ['把作者分析塞进人物脑中', '内心与行动重复'],
    ['让独白使用人物自己的语言', '聚焦当前无法外显的矛盾', '让思考最终影响行动或沉默'], []),
  method('counterpoint-juxtaposition', '对位并置', 'narrative_presentation', 'technique', 'advanced', 'chapter', ['book', 'volume', 'event', 'chapter'], null,
    '把意义相反或互相照见的场面、语言和行动并置，让读者自行感受反差。', ['讽刺', '战争', '阶层', '群像'], ['并置内容没有共同问题'],
    ['选择共享主题或后果的片段', '保持每段自身真实成立', '让顺序产生超出单段的意义'], []),
  method('defamiliarization', '陌生化', 'narrative_presentation', 'technique', 'advanced', 'scene', ['event', 'scene', 'chapter'], null,
    '从不常见的感知、身份或尺度重新呈现熟悉事物，让读者重新注意其意义。', ['奇幻', '科幻', '寓言', '文艺'], ['晦涩表达冒充新鲜'],
    ['选择与人物经验一致的陌生角度', '保证基本行动仍可理解', '让新角度改变判断或情绪'], [])
];

const THEME_METHODS: readonly NarrativeMethodDefinition[] = [
  method('thematic-question', '主题问题', 'theme_meaning', 'foundation', 'default', 'storyline', ['book', 'storyline', 'volume'], null,
    '把主题写成故事愿意反复检验的问题，而不是预先宣布正确答案。', ['所有故事'], [],
    ['用人物会遇到的具体问题表达主题', '允许不同人物给出有力量的不同答案', '让结局由选择和后果形成作品立场'], []),
  method('value-opposition', '价值对立', 'theme_meaning', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume', 'event'], null,
    '把两种都有吸引力或代价的价值放进人物与阵营，让冲突不只是好人打坏人。', ['权谋', '现实', '成长', '战争'], ['一方只是错误稻草人'],
    ['为对立价值各自提供现实收益', '让人物行动而非演讲代表价值', '用后果检验价值边界'], []),
  method('foil-character', '人物镜像与反衬', 'theme_meaning', 'modifier', 'recommended', 'storyline', ['book', 'storyline', 'volume'], null,
    '让另一个人物面对相似问题却作出不同选择，从差异中照见主角可能成为的样子。', ['宿敌', '兄弟', '双主角', '成长'], ['配角只为证明主角正确'],
    ['建立双方真实共同点', '让差异来自选择和条件', '允许反衬人物拥有独立合理性'], []),
  method('counterargument-character', '主题反方人物', 'theme_meaning', 'modifier', 'advanced', 'storyline', ['book', 'storyline', 'volume'], null,
    '由有能力、有成果的人物代表主题反方，使主角必须通过行动而非口号回应。', ['思想冲突', '权谋', '现实'], ['反方故意降智或作恶'],
    ['给反方完整利益与经验依据', '让反方方法取得真实成功', '让主角回答其最强论点而非最弱版本'], []),
  method('moral-choice-proof', '关键选择证明主题', 'theme_meaning', 'modifier', 'recommended', 'event', ['storyline', 'volume', 'event', 'scene'], null,
    '在人物必须付出代价的选择中体现作品价值，避免结尾用旁白总结主题。', ['高潮', '成长', '悲剧'], ['选择代价事后撤销'],
    ['让选择与长期主题问题相关', '保证各选项都有真实代价', '用结果展示人物和作品的答案'], []),
  method('motif-transformation', '母题意义变形', 'theme_meaning', 'technique', 'advanced', 'book', ['book', 'storyline', 'volume'], null,
    '同一动作、物件或句子在不同阶段反复出现，但因人物变化而获得不同意义。', ['主题', '镜像', '文学表达'], ['原样重复只求回环感'],
    ['选择与核心问题相连的母题', '每次出现都改变语境或关系', '最终出现承担结算作用'], [])
];

const CLOSURE_METHODS: readonly NarrativeMethodDefinition[] = [
  method('closed-ending', '闭合式收束', 'closure_payoff', 'framework', 'recommended', 'book', ['book', 'storyline', 'volume', 'event'], 'ending-shape',
    '结束时兑现当前核心问题，让读者明确知道这一阶段得到了什么结果。', ['完结', '单元案', '阶段目标'], ['需要保留续作空间但把所有入口封死'],
    ['回答当前核心问题', '结算人物选择的结果与代价', '区分完成当前阶段和解决全部世界问题'], []),
  method('open-ending', '开放式收束', 'closure_payoff', 'framework', 'advanced', 'book', ['book', 'storyline', 'volume', 'event'], 'ending-shape',
    '当前问题得到阶段结果，但关键余义或未来可能性仍留给读者。', ['余韵', '续作', '人物选择'], ['用没有写完冒充开放', '核心承诺完全不兑现'],
    ['先完成应兑现的核心责任', '只保留有意义且有证据的问题', '让开放来自人物或世界仍在继续'], []),
  method('mirror-structure', '前后镜像收束', 'closure_payoff', 'modifier', 'recommended', 'book', ['book', 'storyline', 'volume'], null,
    '结尾重现开头相似的场景或选择，用差异证明人物和局面已经改变。', ['成长', '悲剧', '宿命', '主题表达'], ['只重复画面却没有意义变化'],
    ['确定开头可被回看的核心选择', '让结尾在相似条件下出现不同决定或代价', '用具体行动呈现变化而不是解释主题'], []),
  method('bittersweet-ending', '苦甜交织结局', 'closure_payoff', 'framework', 'recommended', 'book', ['book', 'storyline', 'volume'], 'ending-shape',
    '人物实现重要目标但永久失去另一项珍贵之物，让胜利和代价同时成立。', ['成长', '战争', '爱情', '史诗'], ['先写圆满再临时加悲伤'],
    ['让收获与牺牲都来自长期选择', '不撤销已经发生的代价', '用余波展示人物怎样带着两者继续生活'], []),
  method('twist-ending', '重释型反转结局', 'closure_payoff', 'framework', 'advanced', 'book', ['book', 'storyline', 'volume', 'event'], 'ending-shape',
    '最后信息改变读者对前文的理解，但不否定已经看到的事实和人物情感。', ['悬疑', '心理', '讽刺'], ['无证据翻案', '只追求惊讶'],
    ['提前放置公平证据', '保证表层故事本身成立', '让重释改变主题、人物或因果意义'], []),
  method('denouement', '高潮后的解结', 'closure_payoff', 'modifier', 'default', 'event', ['book', 'storyline', 'volume', 'event', 'chapter'], null,
    '高潮结束后结算人物、关系、资源和世界的直接后果，让结果真正落地。', ['所有高潮'], [],
    ['区分高潮结果与后果结算', '回应关键人物和承诺', '控制篇幅但不跳过重要代价'], []),
  method('epilogue', '尾声', 'closure_payoff', 'technique', 'recommended', 'book', ['book', 'volume'], null,
    '跳到稍后时间展示长期后果或最后余味，只补主故事需要的结束感。', ['完结', '时代', '群像', '爱情'], ['用尾声补救正文未完成的核心冲突'],
    ['先在主故事内完成核心解决', '选择最能证明长期变化的时刻', '避免逐人点名汇报'], []),
  method('closure-hierarchy', '承诺分级收束', 'closure_payoff', 'foundation', 'default', 'volume', ['book', 'storyline', 'volume', 'event'], null,
    '按核心承诺、阶段承诺和装饰性问题分级结算，避免全部关闭或全部留坑。', ['长篇', '多线', '卷末'], [],
    ['列出当前必须兑现的核心问题', '为阶段问题给出结果或明确状态', '只保留仍有价值且可追踪的开放问题'], [])
];

export const V7_NARRATIVE_METHODS: readonly NarrativeMethodDefinition[] = [
  ...STORY_FORM_METHODS,
  ...MACRO_ARCHITECTURE_METHODS,
  ...CHRONOLOGY_METHODS,
  ...CAUSAL_METHODS,
  ...CONFLICT_METHODS,
  ...SCENE_METHODS,
  ...CHARACTER_ARC_METHODS,
  ...RELATIONSHIP_METHODS,
  ...INFORMATION_METHODS,
  ...EMOTIONAL_METHODS,
  ...PACING_METHODS,
  ...SERIAL_METHODS,
  ...VIEWPOINT_METHODS,
  ...PRESENTATION_METHODS,
  ...THEME_METHODS,
  ...CLOSURE_METHODS
];

export const LEGACY_NARRATIVE_METHOD_KEYS: readonly string[] = [
  'three-act', 'four-act', 'five-act', 'six-act', 'save-the-cat', 'hero-journey',
  'eight-sequence', 'seven-point', 'story-circle', 'truby-22', 'mckee-causality',
  'field-paradigm', 'golden-three', 'upgrade-loop', 'payoff-loop', 'continuation-hook',
  'unit-story', 'multi-line', 'nonlinear', 'meta', 'unreliable', 'symbolic'
];

export const LEGACY_NARRATIVE_METHOD_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(V7_NARRATIVE_METHODS.flatMap((item) => item.legacyKeys.map((legacyKey) => [legacyKey, item.key])))
);

export function getNarrativeMethod(methodKey: string): NarrativeMethodDefinition | null {
  return V7_NARRATIVE_METHODS.find((item) => item.key === methodKey) ?? null;
}

export function getNarrativeDimension(dimensionKey: NarrativeDimension): NarrativeDimensionDefinition {
  const value = NARRATIVE_DIMENSIONS.find((item) => item.key === dimensionKey);
  if (value === undefined) throw new Error(`叙事维度不存在：${dimensionKey}`);
  return value;
}

export function getNarrativeLibrarySummary(): NarrativeLibrarySummary {
  const dimensionCounts = Object.fromEntries(
    NARRATIVE_DIMENSIONS.map((item) => [
      item.key,
      V7_NARRATIVE_METHODS.filter((methodValue) => methodValue.dimension === item.key).length
    ])
  ) as Record<NarrativeDimension, number>;
  const scopeCounts = Object.fromEntries(
    NARRATIVE_SCOPES.map((scope) => [
      scope,
      V7_NARRATIVE_METHODS.filter((methodValue) => methodValue.applicableScopes.includes(scope)).length
    ])
  ) as Record<NarrativeScope, number>;
  return {
    version: V7_NARRATIVE_METHOD_LIBRARY_VERSION,
    totalMethods: V7_NARRATIVE_METHODS.length,
    dimensionCounts,
    scopeCounts
  };
}

export function listNarrativeMethods(filter: {
  dimension?: NarrativeDimension;
  scope?: NarrativeScope;
  tier?: RecommendationTier;
  query?: string;
} = {}): NarrativeMethodDefinition[] {
  const normalizedQuery = normalizeSearchText(filter.query ?? '');
  return V7_NARRATIVE_METHODS.filter((item) => (
    (filter.dimension === undefined || item.dimension === filter.dimension)
    && (filter.scope === undefined || item.applicableScopes.includes(filter.scope))
    && (filter.tier === undefined || item.recommendationTier === filter.tier)
    && (normalizedQuery.length === 0 || normalizeSearchText([
      item.key,
      item.professionalName,
      item.publicExplanation,
      ...item.fitSignals,
      ...item.cautionSignals
    ].join(' ')).includes(normalizedQuery))
  ));
}

export function validateNarrativeSelection(scope: NarrativeScope, methodKeys: readonly string[]): NarrativeSelectionResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const selected: NarrativeMethodDefinition[] = [];
  for (const methodKey of methodKeys) {
    if (seen.has(methodKey)) {
      errors.push(`叙事方法重复选择：${methodKey}`);
      continue;
    }
    seen.add(methodKey);
    const methodValue = getNarrativeMethod(methodKey);
    if (methodValue === null) {
      errors.push(`叙事方法不存在：${methodKey}`);
      continue;
    }
    if (!methodValue.applicableScopes.includes(scope)) {
      errors.push(`${methodValue.professionalName}不适用于${scope}`);
      continue;
    }
    selected.push(methodValue);
  }
  const exclusiveGroups = new Map<string, NarrativeMethodDefinition[]>();
  for (const item of selected) {
    if (item.exclusiveGroup === null) continue;
    const current = exclusiveGroups.get(item.exclusiveGroup) ?? [];
    current.push(item);
    exclusiveGroups.set(item.exclusiveGroup, current);
  }
  for (const [group, items] of exclusiveGroups.entries()) {
    if (items.length <= 1) continue;
    errors.push(`同一范围不能同时选择多项 ${group}：${items.map((item) => item.professionalName).join('、')}`);
  }
  if (selected.length > 6) warnings.push('当前任务选择的方法超过6项，建议只编译真正影响本次任务的最小组合。');
  if (selected.filter((item) => item.kind === 'technique').length > 2) {
    warnings.push('特殊表现手法超过2项，容易让技巧压过人物、因果和阅读流畅度。');
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function compileNarrativeResponsibilities(
  scope: NarrativeScope,
  methodKeys: readonly string[]
): CompiledNarrativeResponsibilities {
  const validation = validateNarrativeSelection(scope, methodKeys);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  const selected = methodKeys.map((methodKey) => getNarrativeMethod(methodKey)).filter(isMethod);
  return {
    scope,
    responsibilities: unique(selected.flatMap((item) => item.responsibilities)),
    publicExplanations: unique(selected.map((item) => item.publicExplanation)),
    guardrails: unique(selected.flatMap((item) => item.cautionSignals).map((item) => `避免：${item}`)),
    warnings: validation.warnings
  };
}

export function validateNarrativeRegistry(): string[] {
  const errors: string[] = [];
  const methodKeys = new Set<string>();
  const legacyKeys = new Set<string>();
  const dimensions = new Set(NARRATIVE_DIMENSIONS.map((item) => item.key));
  for (const item of V7_NARRATIVE_METHODS) {
    if (methodKeys.has(item.key)) errors.push(`叙事方法键重复：${item.key}`);
    methodKeys.add(item.key);
    if (!dimensions.has(item.dimension)) errors.push(`${item.key}引用未知维度：${item.dimension}`);
    if (!item.applicableScopes.includes(item.primaryScope)) errors.push(`${item.key}的主要层级未包含在可用层级中`);
    if (item.publicExplanation.trim().length === 0) errors.push(`${item.key}缺少作者可见解释`);
    if (item.responsibilities.length === 0) errors.push(`${item.key}缺少编译责任`);
    for (const legacyKey of item.legacyKeys) {
      if (legacyKeys.has(legacyKey)) errors.push(`旧方法键被重复迁移：${legacyKey}`);
      legacyKeys.add(legacyKey);
    }
  }
  for (const legacyKey of LEGACY_NARRATIVE_METHOD_KEYS) {
    if (!legacyKeys.has(legacyKey)) errors.push(`旧方法键没有迁移结果：${legacyKey}`);
  }
  for (const legacyKey of legacyKeys) {
    if (!LEGACY_NARRATIVE_METHOD_KEYS.includes(legacyKey)) errors.push(`登记了未知旧方法键：${legacyKey}`);
  }
  return errors;
}

function dimension(
  key: NarrativeDimension,
  internalLabel: string,
  responsibility: string,
  authorQuestion: string
): NarrativeDimensionDefinition {
  return { key, internalLabel, responsibility, authorQuestion };
}

function method(
  key: string,
  professionalName: string,
  dimensionValue: NarrativeDimension,
  kind: NarrativeMethodKind,
  recommendationTier: RecommendationTier,
  primaryScope: NarrativeScope,
  applicableScopes: readonly NarrativeScope[],
  exclusiveGroup: string | null,
  publicExplanation: string,
  fitSignals: readonly string[],
  cautionSignals: readonly string[],
  responsibilities: readonly string[],
  legacyKeys: readonly string[]
): NarrativeMethodDefinition {
  return {
    key,
    professionalName,
    dimension: dimensionValue,
    kind,
    recommendationTier,
    primaryScope,
    applicableScopes,
    exclusiveGroup,
    publicExplanation,
    fitSignals,
    cautionSignals,
    responsibilities,
    legacyKeys
  };
}

function isMethod(value: NarrativeMethodDefinition | null): value is NarrativeMethodDefinition {
  return value !== null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s\-_/／—]+/gu, '');
}
