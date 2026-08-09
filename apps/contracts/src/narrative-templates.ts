import type { PlanningScope, TemplateSelectionMode } from './workflow.js';

export const NARRATIVE_TEMPLATE_REGISTRY_VERSION = 2 as const;

export interface NarrativeTemplateBeat {
  beatId: string;
  publicFunction: string;
  expectedChange: string;
  optional: boolean;
  order: number;
}

export interface NarrativeTemplateDefinition {
  templateKey: string;
  templateVersion: number;
  contentHash: string;
  sourceMethod: string;
  sourceLabel?: string;
  scope: PlanningScope;
  publicTitle: string;
  publicExplanation: string;
  fitConditions: string[];
  knownRisks: string[];
  authorQuestions: string[];
  beats: NarrativeTemplateBeat[];
  previewPrompt: string;
  suitableSignals: string[];
  legacyIds: string[];
}

export interface PublicNarrativeTemplate {
  templateKey: string;
  templateVersion: number;
  contentHash: string;
  scope: PlanningScope;
  sourceLabel: string;
  publicTitle: string;
  publicExplanation: string;
  fitConditions: string[];
  knownRisks: string[];
  authorQuestions: string[];
  beats: NarrativeTemplateBeat[];
  previewPrompt: string;
  recommended: boolean;
}

export interface NarrativeTemplateChoice {
  mode: Exclude<TemplateSelectionMode, 'template'>;
  publicTitle: string;
  publicExplanation: string;
}

export interface NarrativeTemplateCatalogView {
  contractVersion: 1;
  registryVersion: number;
  registryHash: string;
  scope: PlanningScope;
  templates: PublicNarrativeTemplate[];
  alternativeChoices: NarrativeTemplateChoice[];
}

type TemplateInput = Omit<NarrativeTemplateDefinition, 'templateVersion' | 'contentHash'>;
const beat = (beatId: string, publicFunction: string, expectedChange: string, order: number, optional = false): NarrativeTemplateBeat => ({
  beatId, publicFunction, expectedChange, optional, order
});

function defineTemplate(input: TemplateInput): NarrativeTemplateDefinition {
  const versioned = { ...input, templateVersion: NARRATIVE_TEMPLATE_REGISTRY_VERSION };
  return Object.freeze({ ...versioned, contentHash: hashStableContractContent(versioned) });
}

const templates: NarrativeTemplateDefinition[] = [
  defineTemplate({
    templateKey: 'volume-save-the-cat', sourceMethod: 'save-the-cat', sourceLabel: '救猫咪结构', scope: 'volume',
    publicTitle: '先让读者在意主角，再把他推入无法回头的变化',
    publicExplanation: '先用具体行动建立人物好感和缺口，再打破日常、升级压力、制造最低谷，最后让主角用新的选择完成本卷兑现。',
    fitConditions: ['希望首卷人物与主线都清楚', '需要一条由触发到低谷再反击的完整情绪线'],
    knownRisks: ['节拍只是顺序参考，不能机械卡章数', '最低谷必须来自前面选择而非突然惩罚'],
    authorQuestions: ['读者最先因什么愿意跟随主角？', '什么变化让他不能回到原来的生活？', '卷末的新选择证明了什么？'],
    beats: [beat('care', '用行动让读者认识人物的欲望、优点和缺口', '读者愿意跟随主角', 1), beat('break', '发生一件打破日常的事', '旧生活不再稳定', 2), beat('commit', '让主角主动跨过不能轻易回头的门槛', '本卷目标真正启动', 3), beat('pressure', '让收获、对抗和代价持续升级', '能力与关系同时受检验', 4), beat('lowest', '让旧办法在关键处失效', '人物不得不面对核心缺口', 5), beat('new_choice', '用新的选择完成高潮并结算余波', '卷末状态发生不可逆变化', 6)],
    previewPrompt: '用本书人物和本卷目标说明“建立在意—打破日常—主动进入—压力升级—低谷—新选择”的推进，不机械分配章节。', suitableSignals: ['首卷', '成长', '快节奏', '修仙', '都市', '冒险'], legacyIds: []
  }),
  defineTemplate({
    templateKey: 'volume-three-act', sourceMethod: 'three-act-structure', sourceLabel: '三幕式', scope: 'volume',
    publicTitle: '先把目标推上轨道，中段不断加码，最后集中解决',
    publicExplanation: '前段建立人物、目标和进入行动的理由；中段用连续后果扩大难题；后段关闭退路，集中兑现本卷核心冲突。',
    fitConditions: ['希望大方向清晰但保留事件自由', '本卷有明确的启动、对抗和收束'],
    knownRisks: ['中段不能只是重复遭遇', '收束不能跳过人物选择和前置积累'],
    authorQuestions: ['主角何时真正进入本卷行动？', '中段哪次变化会改写目标？', '最后必须解决哪一个卷级问题？'],
    beats: [beat('setup', '建立当前处境、欲望和卷级矛盾', '读者知道为什么要行动', 1), beat('enter', '用主动选择进入主要对抗', '目标与代价清楚', 2), beat('escalate', '用因果相连的事件升级局势', '每次结果都改变下一步', 3), beat('turn', '让中段变化迫使主角调整方法或目标', '后半卷不再重复前半卷', 4), beat('resolve', '关闭退路并集中解决卷级问题', '高潮兑现并形成下一卷接口', 5)],
    previewPrompt: '把本卷按“进入—升级—调整—解决”的大方向展示，事件数量由故事自然决定。', suitableSignals: ['通用', '冒险', '悬疑', '成长', '言情'], legacyIds: []
  }),
  defineTemplate({
    templateKey: 'volume-five-act', sourceMethod: 'five-act-structure', sourceLabel: '五幕式', scope: 'volume',
    publicTitle: '分五次抬高局势，让高潮前的每一步都改变玩法',
    publicExplanation: '从建立矛盾、主动推进、局势反转、危机逼近到最终结算，适合人物多、事件多、阵营和信息持续变化的卷。',
    fitConditions: ['本卷人物或势力较多', '希望中段有两次以上实质变化'],
    knownRisks: ['不能为了五段硬塞转折', '每段必须改变状态而非只换场景'],
    authorQuestions: ['哪次变化会把私人问题变成更大局势？', '谁会在中后段改变立场？', '高潮前最后失去的退路是什么？'],
    beats: [beat('establish', '建立人物、冲突与不稳定平衡', '多方目标可理解', 1), beat('rise', '让主角主动行动并取得带代价的进展', '冲突范围扩大', 2), beat('reverse', '用信息、关系或结果改变原先判断', '故事玩法发生变化', 3), beat('crisis', '让反制和代价逼近，关闭简单退路', '人物必须作价值选择', 4), beat('climax', '让前面累积的人物与因果共同结算', '卷末新格局成立', 5)],
    previewPrompt: '用本卷现有人物与冲突展示五次状态变化，不预设固定章数或固定高潮频率。', suitableSignals: ['群像', '权谋', '多事件', '战争', '宗门', '长卷'], legacyIds: []
  }),
  defineTemplate({
    templateKey: 'volume-grow-into-role', sourceMethod: 'hero-journey-and-coming-of-age', scope: 'volume',
    publicTitle: '从还没准备好，到真正担起责任',
    publicExplanation: '先让主角看见自己欠缺什么，再用一连串选择和后果逼他成长，卷末用一次真正承担责任的行动兑现变化。',
    fitConditions: ['本卷重点是人物成长', '主角身份或责任会明显变化'],
    knownRisks: ['成长只靠升级会显得空', '导师或外力不能替主角完成关键选择'],
    authorQuestions: ['主角开卷时最逃避什么？', '哪次失败会让旧办法彻底失效？', '卷末他愿意承担什么代价？'],
    beats: [beat('lack', '先让缺口在具体事件中暴露', '读者理解主角为什么必须改变', 1), beat('attempt', '让主角用旧办法争取一次', '获得希望，也暴露旧办法的上限', 2), beat('cost', '让更大的责任和代价找上门', '逃避开始比行动更昂贵', 3), beat('choice', '安排一次没人能代替他的选择', '人物主动性和价值观被看见', 4), beat('proof', '让行动结果检验成长', '卷末身份、关系或局势发生不可逆变化', 5)],
    previewPrompt: '用本卷目标说明主角怎样从逃避走到承担，不预写具体桥段。', suitableSignals: ['成长', '玄幻', '修仙', '学院', '冒险', '职场'], legacyIds: ['continuous-leveling', 'trial-breakthrough', 'career-rise', 'academy-competition', 'mentor-legacy']
  }),
  defineTemplate({
    templateKey: 'volume-pressure-to-rebuild', sourceMethod: 'fall-crisis-recovery', scope: 'volume',
    publicTitle: '先站稳，再失去依靠，最后重新建立优势',
    publicExplanation: '前半卷让人物尝到阶段成果，中段让旧依靠失效，后半卷靠新的认知、关系或方法重建局面。',
    fitConditions: ['希望有明显高低起伏', '卷中失败需要真正改变后续'],
    knownRisks: ['低谷太久会消耗阅读耐心', '反击若没有前置积累会像突然开挂'],
    authorQuestions: ['前半卷最珍贵的阶段成果是什么？', '失去什么才会逼人物改变？', '新优势和旧优势的本质区别是什么？'],
    beats: [beat('foothold', '取得一个读者能感到的阶段成果', '人物相信旧路线可行', 1), beat('warning', '让隐患逐步显形', '成功开始带着不安和代价', 2), beat('loss', '让核心依靠真正失效', '人物与局势落到不能原样返回的位置', 3), beat('reframe', '从失败中找到新理解', '下一步来自选择而非巧合', 4), beat('rebuild', '用新办法重建优势并结算余波', '高潮改变卷末状态，也留下下一卷触发', 5)],
    previewPrompt: '用本卷已有资源和失败代价生成一条“建立—失去—重建”的短预览。', suitableSignals: ['逆袭', '复仇', '生存', '商战', '言情', '爽文'], legacyIds: ['underdog-counterattack', 'revenge-settlement', 'family-comeback', 'survival-evacuation']
  }),
  defineTemplate({
    templateKey: 'volume-escalating-goals', sourceMethod: 'progressive-complications', scope: 'volume',
    publicTitle: '解决一个麻烦，又引出更大的目标',
    publicExplanation: '每次阶段解决都改变人物状态并暴露更大的问题，让升级来自因果后果，而不是重复更强的对手。',
    fitConditions: ['希望节奏持续向前', '本卷包含多个有因果关系的事件'],
    knownRisks: ['只加大敌人强度会疲劳', '小事件若不改变状态会像重复任务'],
    authorQuestions: ['第一个麻烦解决后会造成什么新后果？', '每次升级改变了人物的哪项选择？', '最终目标为什么只能在卷末解决？'],
    beats: [beat('first_problem', '用可理解的小目标启动', '人物进入行动并暴露能力边界', 1), beat('consequence', '让解决结果制造新状态', '下一事件由前一事件自然触发', 2), beat('wider_stakes', '把个人问题推向更大关系或局势', '人物不能只顾眼前得失', 3), beat('irreversible', '安排一次不可逆选择', '高潮前的退路被关闭', 4), beat('climax', '用累积后果完成核心对决', '卷级问题得到阶段结算并产生余波', 5)],
    previewPrompt: '把当前卷的核心目标拆成有因果关系的升级链，不固定事件数量。', suitableSignals: ['快节奏', '游戏', '竞技', '冒险', '系统', '玄幻'], legacyIds: ['system-task-chain', 'dungeon-first-clear', 'season-championship', 'guild-war']
  }),
  defineTemplate({
    templateKey: 'volume-truth-layer-by-layer', sourceMethod: 'mystery-revelation-arc', scope: 'volume',
    publicTitle: '围绕一个疑问，逐层改变读者的理解',
    publicExplanation: '每个事件既回答一部分问题，又用证据改变原先判断，卷末解决本层真相并留下更深但公平的新疑问。',
    fitConditions: ['本卷由谜团或调查推动', '信息变化会改变人物关系和目标'],
    knownRisks: ['答案依赖未展示信息会失去公平感', '只提新问题不回答旧问题会拖沓'],
    authorQuestions: ['开卷时读者最想知道什么？', '哪条证据会改变第一次判断？', '卷末必须回答到哪一层？'],
    beats: [beat('question', '用人物切身相关的疑问开局', '调查目标和代价清晰', 1), beat('evidence', '让多条证据互相校正', '读者能参与判断而非等解释', 2), beat('wrong_picture', '形成一个有依据但不完整的结论', '后续反转具备前置证据', 3), beat('reinterpret', '用关键证据重释已知事实', '人物目标或阵营随真相改变', 4), beat('layer_answer', '回答本卷承诺并留下更深后果', '获得满足感，同时自然进入下一卷', 5)],
    previewPrompt: '围绕本卷核心疑问展示“发现—误判—重释—回答”的短预览。', suitableSignals: ['悬疑', '推理', '刑侦', '灵异', '解谜', '秘密'], legacyIds: ['closed-circle-mystery', 'dual-timeline-truth', 'hidden-identity', 'serial-investigation', 'rule-horror', 'folklore-investigation']
  }),
  defineTemplate({
    templateKey: 'volume-strategy-changes-balance', sourceMethod: 'multi-faction-strategy-arc', scope: 'volume',
    publicTitle: '多方各有所求，靠选择重新划分局势',
    publicExplanation: '把冲突建立在真实利益和有限信息上，每次联盟、试探和反制都改变力量平衡，卷末的胜负同时带来责任。',
    fitConditions: ['存在三方以上利益', '人物主要靠谋略、谈判或制度行动'],
    knownRisks: ['后手没有证据会像强行聪明', '把对手写蠢会降低胜利含金量'],
    authorQuestions: ['各方真正不能让步的利益是什么？', '主角会误判谁？', '赢下本卷后要承担什么新责任？'],
    beats: [beat('interests', '先写清各方要什么和怕什么', '冲突不是简单好坏对立', 1), beat('probe', '让各方试探并交换有限利益', '联盟与误判同时形成', 2), beat('countermove', '让对手针对主角真实弱点反制', '旧计划必须调整', 3), beat('choice', '逼主角在两种代价间选择', '人物价值观改变局势', 4), beat('rebalance', '结算胜负、损失和权力变化', '新格局成为下一卷起点', 5)],
    previewPrompt: '用本书现有势力与利益，展示一次局势怎样因选择而换边。', suitableSignals: ['权谋', '历史', '商战', '谍战', '战争', '宫斗'], legacyIds: ['trap-countertrap', 'court-power-rise', 'campaign-victory', 'reform-resistance', 'espionage-infiltration', 'succession-struggle', 'legal-reversal']
  }),
  defineTemplate({
    templateKey: 'volume-relationships-change-goal', sourceMethod: 'relationship-transformation-arc', scope: 'volume',
    publicTitle: '关系在共同经历中改变，也改变人物的目标',
    publicExplanation: '不是用误会拖时间，而是让双方在真实事件中看见彼此、发生分歧、承担后果，并在卷末作出新的关系选择。',
    fitConditions: ['人物关系是本卷主要推动力', '情感变化必须影响主线选择'],
    knownRisks: ['一方长期当工具人会失去生命力', '只有嘴硬和误会会让关系停滞'],
    authorQuestions: ['双方最初对彼此的错误判断是什么？', '哪次共同选择会改变信任？', '卷末关系变化怎样影响主线？'],
    beats: [beat('distance', '建立真实分歧和相处分寸', '关系张力来自立场而非误会', 1), beat('shared_action', '让双方共同完成一件有代价的事', '认知开始被行动修正', 2), beat('boundary', '用重大分歧检验信任', '双方必须表达不能让步之处', 3), beat('responsibility', '让人物为伤害或承诺承担后果', '关系变化具有可信代价', 4), beat('new_choice', '以自由选择确认新关系', '关系和主线目标同时进入新状态', 5)],
    previewPrompt: '用本卷主线事件说明两人的关系怎样因行动改变，而非预设固定恋爱结局。', suitableSignals: ['言情', '关系', '家庭', '青春', '治愈', '群像'], legacyIds: ['mutual-redemption', 'wife-chasing', 'enemies-to-lovers', 'reunion-repair', 'contract-romance', 'secret-love-realized', 'family-repair', 'slice-of-life-healing']
  }),
  defineTemplate({
    templateKey: 'volume-build-and-prove', sourceMethod: 'accumulation-and-proof-arc', scope: 'volume',
    publicTitle: '一点点建立成果，再用危机检验它',
    publicExplanation: '把资源、能力、团队或事业的积累写成有冲突的选择，最后用外部危机检验成果是否真的能运转。',
    fitConditions: ['本卷强调经营、建设或专业成长', '成果需要可见且能被验证'],
    knownRisks: ['只列清单会像报表', '主角一人全能会挤压群像'],
    authorQuestions: ['最先要解决的生存缺口是什么？', '谁会反对当前建设方式？', '最后哪场危机会检验整个体系？'],
    beats: [beat('gap', '盘点一个具体而迫切的缺口', '阶段目标可见', 1), beat('first_loop', '建立第一条能运转的解决路径', '获得小成果并暴露新瓶颈', 2), beat('people_cost', '让资源分配和人物利益发生冲突', '建设与人物关系连接', 3), beat('stress_test', '用危机检验体系而非只检验主角', '群像和制度共同承担结果', 4), beat('settle', '结算成果、损失与新的责任', '卷末基本盘真实改变', 5)],
    previewPrompt: '把本卷建设目标转成“缺口—建立—冲突—检验—结算”的短预览。', suitableSignals: ['经营', '种田', '领主', '创业', '事业', '医疗', '文娱'], legacyIds: ['territory-building', 'startup-survival', 'farming-development', 'post-disaster-rebuild', 'entertainment-rise', 'medical-breakthrough', 'interstellar-expedition']
  }),
  defineTemplate({
    templateKey: 'event-problem-demands-response', sourceMethod: 'inciting-action-response', scope: 'event',
    publicTitle: '麻烦找上门，人物必须作出回应', publicExplanation: '从一个改变日常的具体麻烦开始，让人物尝试、受阻并作出会产生后果的选择。',
    fitConditions: ['需要启动新事件', '人物起初没有主动行动'], knownRisks: ['麻烦与人物无关会缺少推动力', '外力不能替人物解决结果'],
    authorQuestions: ['为什么这个麻烦偏偏现在发生？', '人物若不回应会失去什么？'],
    beats: [beat('trigger', '让麻烦直接改变当前状态', '人物不能假装无事发生', 1), beat('response', '人物用最符合当下性格的方式回应', '目标和能力边界显形', 2), beat('resistance', '让回应遇到真实阻力', '人物必须调整或付出代价', 3), beat('result', '用选择形成事件结果', '后果可以进入下一事件', 4)],
    previewPrompt: '根据上一事件结果生成一条“麻烦—回应—受阻—结果”的短预览。', suitableSignals: ['开局', '触发', '危机', '任务'], legacyIds: ['countdown-rescue', 'survival-evacuation']
  }),
  defineTemplate({
    templateKey: 'event-pressure-reveals-capability', sourceMethod: 'underestimation-reveal', scope: 'event',
    publicTitle: '被低估或受限制，最后用行动改变别人判断', publicExplanation: '先建立具体误判和限制，再让主角准备、选择出手，并让结果真正改变关系或局势。',
    fitConditions: ['希望兑现能力成长', '存在可验证的误判'], knownRisks: ['围观震惊不能代替后果', '压抑过久会让人物显得被动'],
    authorQuestions: ['别人具体误判了什么？', '主角为何不能一开始就亮出底牌？'],
    beats: [beat('misread', '明确误判和现实限制', '读者知道反差在哪里', 1), beat('prepare', '让人物暗中准备或寻找时机', '出手来自能力与判断', 2), beat('test', '用公开或关键局面检验', '真实结果推翻旧判断', 3), beat('reorder', '结算身份、关系或资源变化', '爽点继续服务后续因果', 4)],
    previewPrompt: '说明本事件怎样从受限走到改变判断，不预设打脸台词。', suitableSignals: ['逆袭', '能力', '身份', '竞赛'], legacyIds: ['hidden-power-reveal', 'face-slap-reversal', 'rebirth-correction']
  }),
  defineTemplate({
    templateKey: 'event-false-win-higher-cost', sourceMethod: 'false-victory-complication', scope: 'event',
    publicTitle: '看似解决了，结果却带来更大的代价', publicExplanation: '先让人物取得真实小胜，再揭示胜利触发的新成本，使下一事件自然升级。',
    fitConditions: ['需要连接两个事件', '不想用突然出现的新敌人硬升级'], knownRisks: ['小胜必须真实，不能立刻宣布无效', '代价要来自前因而不是作者惩罚'],
    authorQuestions: ['这次胜利真实带来了什么？', '哪个被忽略的后果会随后出现？'],
    beats: [beat('attempt', '围绕清晰目标行动', '人物投入资源和判断', 1), beat('win', '取得一个真实阶段结果', '情绪得到兑现', 2), beat('cost', '让结果触发未预料的成本', '局势改变而非简单反转', 3), beat('new_need', '确定下一步必须处理的问题', '事件链形成因果接口', 4)],
    previewPrompt: '用当前事件目标展示“小胜—后果—新问题”的短预览。', suitableSignals: ['反转', '升级', '连续事件'], legacyIds: []
  }),
  defineTemplate({
    templateKey: 'event-failure-finds-breakthrough', sourceMethod: 'failure-reframe-breakthrough', scope: 'event',
    publicTitle: '旧办法失败，人物找到真正的突破口', publicExplanation: '让第一次失败暴露认知问题，人物承担代价后换一种方法，最后的成功保留余波。',
    fitConditions: ['需要表现人物成长', '当前难题不能靠增加力量直接解决'], knownRisks: ['失败若无损失会像走流程', '突破口必须有前置信息'],
    authorQuestions: ['旧办法为什么注定不够？', '失败会让人物放弃什么误解？'],
    beats: [beat('old_way', '让人物认真执行旧办法', '失败具有说服力', 1), beat('failure', '用结果暴露真正问题', '人物付出明确代价', 2), beat('reframe', '重新理解规则、关系或目标', '突破口来自已知证据', 3), beat('breakthrough', '用新选择完成阶段目标', '人物与局势都留下变化', 4)],
    previewPrompt: '根据人物当前局限生成“旧办法—失败—重想—突破”的短预览。', suitableSignals: ['成长', '试炼', '专业', '智取'], legacyIds: ['underdog-counterattack', 'trial-breakthrough']
  }),
  defineTemplate({
    templateKey: 'event-clues-change-understanding', sourceMethod: 'fair-clue-reinterpretation', scope: 'event',
    publicTitle: '线索越多，事情反而显出另一层真相', publicExplanation: '用可追溯证据让人物先形成合理判断，再由关键线索重释旧信息并改变行动。',
    fitConditions: ['事件由调查或秘密推动', '信息变化需要影响人物选择'], knownRisks: ['不能靠未展示信息翻案', '线索数量不能替代因果'],
    authorQuestions: ['本事件先回答哪个小问题？', '哪条旧线索会被重新理解？'],
    beats: [beat('question', '确定本事件要回答的问题', '调查边界清楚', 1), beat('clues', '让线索支持又互相冲突', '人物形成有依据的判断', 2), beat('key', '出现能重释旧证据的关键线索', '理解发生变化', 3), beat('decision', '让新理解改变行动', '真相推进并留下下一接口', 4)],
    previewPrompt: '只用已存在的谜团和证据生成一条公平推理预览。', suitableSignals: ['悬疑', '调查', '秘密', '真相'], legacyIds: ['closed-circle-mystery', 'dual-timeline-truth', 'hidden-identity', 'serial-investigation', 'rule-horror', 'folklore-investigation', 'legal-reversal']
  }),
  defineTemplate({
    templateKey: 'event-factions-change-sides', sourceMethod: 'multi-party-reversal', scope: 'event',
    publicTitle: '几方目标碰撞，局势在选择中换边', publicExplanation: '写清各方利益和信息差，通过试探、反制与选择改变临时联盟，最后结算谁得到什么。',
    fitConditions: ['事件包含多方势力', '胜负主要由信息和选择决定'], knownRisks: ['临时后手必须有前置依据', '对手不能为了主角获胜突然变笨'],
    authorQuestions: ['谁表面合作但目标不同？', '哪个选择会迫使一方换边？'],
    beats: [beat('positions', '亮出各方表面目标和限制', '读者能理解局势', 1), beat('probe', '通过行动交换信息并试探', '误判和真实利益逐渐暴露', 2), beat('counter', '让一方针对弱点反制', '原计划失效', 3), beat('switch', '用人物选择改变阵营或优势', '结果重排局势并留下代价', 4)],
    previewPrompt: '用当前参与方生成一次“试探—反制—选择—换边”的短预览。', suitableSignals: ['权谋', '商战', '战争', '阵营'], legacyIds: ['trap-countertrap', 'guild-war', 'espionage-infiltration']
  }),
  defineTemplate({
    templateKey: 'event-relationship-forces-choice', sourceMethod: 'relationship-test-and-choice', scope: 'event',
    publicTitle: '共同经历把关系推到必须表态的位置', publicExplanation: '让关系变化来自共同行动、分歧和承担，不靠重复误会；事件结果要影响后续主线。',
    fitConditions: ['关系变化是事件核心', '双方都有自己的目标和边界'], knownRisks: ['不能强迫受伤一方原谅', '一方不能只服务另一方成长'],
    authorQuestions: ['双方各自不能退让的是什么？', '哪次行动会改变信任？'],
    beats: [beat('tension', '让真实目标产生分歧', '关系问题落到行动上', 1), beat('together', '安排一次必须共同承担的行动', '双方看到彼此新的一面', 2), beat('test', '让代价检验承诺和边界', '关系不能继续含糊', 3), beat('choice', '双方各自作出可负责的选择', '关系和主线都进入新状态', 4)],
    previewPrompt: '用本事件主线说明关系怎样被行动推动，不预设和好或恋爱结果。', suitableSignals: ['关系', '言情', '家庭', '友情'], legacyIds: ['mutual-redemption', 'wife-chasing', 'enemies-to-lovers', 'reunion-repair', 'contract-romance', 'secret-love-realized', 'family-repair']
  }),
  defineTemplate({
    templateKey: 'event-hope-loss-choice', sourceMethod: 'hope-loss-forced-choice', scope: 'event',
    publicTitle: '先获得希望，再失去依靠，最后被迫选择', publicExplanation: '先给人物一个可信的解决希望，再让关键依靠失效，最后用价值选择而非巧合完成事件。',
    fitConditions: ['需要强情绪转折', '人物选择比胜负本身更重要'], knownRisks: ['失去依靠不能只是为了虐', '最后的选择必须有两边真实代价'],
    authorQuestions: ['希望为什么值得相信？', '失去依靠后还剩哪些真实选择？'],
    beats: [beat('hope', '建立可信的希望或援手', '人物和读者愿意投入期待', 1), beat('investment', '让人物为希望作出投入', '失去时具有重量', 2), beat('loss', '让依靠因前置因果失效', '人物被推到不能回避的位置', 3), beat('choice', '在两种代价间主动选择', '事件高潮揭示人物并产生后果', 4), beat('aftermath', '保留选择后的情绪与局势余波', '下一事件承接真实变化', 5, true)],
    previewPrompt: '用当前人物最在意的东西生成“希望—失去—选择—余波”的短预览。', suitableSignals: ['情绪', '危机', '牺牲', '转折'], legacyIds: ['countdown-rescue', 'revenge-settlement']
  })
];

export const NARRATIVE_TEMPLATE_REGISTRY: readonly NarrativeTemplateDefinition[] = Object.freeze(templates);
export const NARRATIVE_TEMPLATE_REGISTRY_HASH = hashStableContractContent(templates.map(({ contentHash }) => contentHash));

const directByKey = new Map(templates.map((item) => [item.templateKey, item]));
const legacyToKey = new Map<string, string>();
for (const template of templates) for (const legacyId of template.legacyIds) if (!legacyToKey.has(legacyId)) legacyToKey.set(legacyId, template.templateKey);

export const LEGACY_NARRATIVE_TEMPLATE_IDS = Object.freeze([...legacyToKey.keys()].sort());

export function resolveNarrativeTemplate(templateOrLegacyKey: string): NarrativeTemplateDefinition | null {
  const direct = directByKey.get(templateOrLegacyKey);
  if (direct !== undefined) return direct;
  const currentKey = legacyToKey.get(templateOrLegacyKey);
  return currentKey === undefined ? null : directByKey.get(currentKey) ?? null;
}

export function getPublicNarrativeTemplateCatalog(scope: PlanningScope, signals: readonly string[] = []): NarrativeTemplateCatalogView {
  const normalized = signals.join(' ').toLocaleLowerCase('zh-CN');
  const ranked = templates.filter((item) => item.scope === scope).map((item, index) => ({
    item,
    index,
    score: item.suitableSignals.reduce((total, signal) => total + (normalized.includes(signal.toLocaleLowerCase('zh-CN')) ? 1 : 0), 0)
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const recommendedKeys = new Set(ranked.slice(0, 3).map(({ item }) => item.templateKey));
  return {
    contractVersion: 1,
    registryVersion: NARRATIVE_TEMPLATE_REGISTRY_VERSION,
    registryHash: NARRATIVE_TEMPLATE_REGISTRY_HASH,
    scope,
    templates: ranked.map(({ item }) => toPublicTemplate(item, recommendedKeys.has(item.templateKey))),
    alternativeChoices: [
      { mode: 'custom', publicTitle: '我自己安排', publicExplanation: '只保留你的目标和想法，让AI协助检查因果、风险和衔接。' },
      { mode: 'none', publicTitle: '这次不用模板', publicExplanation: '不套任何预设推进方式，按人物与当前局势自然设计。' }
    ]
  };
}

export function toPublicTemplate(template: NarrativeTemplateDefinition, recommended = false): PublicNarrativeTemplate {
  return {
    templateKey: template.templateKey,
    templateVersion: template.templateVersion,
    contentHash: template.contentHash,
    scope: template.scope,
    sourceLabel: template.sourceLabel ?? '通用叙事经验',
    publicTitle: template.publicTitle,
    publicExplanation: template.publicExplanation,
    fitConditions: [...template.fitConditions],
    knownRisks: [...template.knownRisks],
    authorQuestions: [...template.authorQuestions],
    beats: template.beats.map((item) => ({ ...item })),
    previewPrompt: template.previewPrompt,
    recommended
  };
}

export function buildNarrativeTemplatePreview(template: PublicNarrativeTemplate, input: { bookTitle?: string; currentGoal?: string; protagonistName?: string }): string {
  const subject = input.protagonistName?.trim() || '主要人物';
  const book = input.bookTitle?.trim() ? `《${input.bookTitle.trim()}》` : '这本书';
  const goal = input.currentGoal?.trim() ? `围绕“${input.currentGoal.trim()}”` : '围绕当前目标';
  return `${book}可以${goal}，让${subject}按“${template.publicTitle}”的思路推进。${template.previewPrompt}`;
}

export function parsePlanningScope(value: unknown): PlanningScope {
  if (value === 'volume' || value === 'event') return value;
  throw new Error('模板范围必须是 volume 或 event。');
}

export function hashStableContractContent(value: unknown): string {
  const bytes = [...new TextEncoder().encode(stableJson(value))];
  const bitLength = BigInt(bytes.length) * 8n;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56n; shift >= 0n; shift -= 8n) bytes.push(Number((bitLength >> shift) & 0xffn));

  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      words[index] = (((bytes[base]! << 24) | (bytes[base + 1]! << 16) | (bytes[base + 2]! << 8) | bytes[base + 3]!) >>> 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15]!;
      const before2 = words[index - 2]!;
      const small0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const small1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] = (words[index - 16]! + small0 + words[index - 7]! + small1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index += 1) {
      const big1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + big1 + choice + constants[index]! + words[index]!) >>> 0;
      const big0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (big0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temporary1) >>> 0; d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0; state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0; state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0; state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0; state[7] = (state[7]! + h) >>> 0;
  }
  return `sha256:${state.map((word) => word.toString(16).padStart(8, '0')).join('')}`;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}
