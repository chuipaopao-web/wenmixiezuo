import { getNarrativeMethod } from '../narrative-methods/narrative-method-library.js';
import {
  GENRE_FAMILY_KEYS,
  getPlotPattern,
  type GenreFamily,
  type PlotPatternCategory
} from './plot-pattern-library.js';

export const V7_PLOT_RECIPE_LIBRARY_VERSION = '1.0.0';

export interface PlotRecipeStageDefinition {
  key: string;
  publicTitle: string;
  responsibility: string;
  requiredChange: string;
  preferredPatternKeys: readonly string[];
  requiredCategories: readonly PlotPatternCategory[];
}

export interface PlotRecipeDefinition {
  key: string;
  publicTitle: string;
  publicExplanation: string;
  commonGenreFamilies: readonly GenreFamily[];
  fitSignals: readonly string[];
  caution: string;
  stages: readonly PlotRecipeStageDefinition[];
  narrativeMethodKeys: readonly string[];
  legacyTemplateKeys: readonly string[];
}

type StageSeed = readonly [
  key: string,
  title: string,
  responsibility: string,
  change: string,
  preferredPatternKeys: readonly string[],
  requiredCategories: readonly PlotPatternCategory[]
];

function stage(...value: StageSeed): PlotRecipeStageDefinition {
  return {
    key: value[0],
    publicTitle: value[1],
    responsibility: value[2],
    requiredChange: value[3],
    preferredPatternKeys: [...value[4]],
    requiredCategories: [...value[5]]
  };
}

function recipe(input: PlotRecipeDefinition): PlotRecipeDefinition {
  return Object.freeze(input);
}

const LEGACY_MIGRATED_RECIPES: readonly PlotRecipeDefinition[] = [
  recipe({
    key: 'grow-into-responsibility', publicTitle: '从没准备好，到真正担起责任',
    publicExplanation: '先让人物的能力或心性缺口在行动中暴露，再用失败、责任和主动选择完成阶段成长。',
    commonGenreFamilies: [], fitSignals: ['成长', '责任', '晋升', '接班', '首卷'],
    caution: '成长必须由选择和后果证明，不能只靠等级或他人宣布。',
    stages: [
      stage('expose-gap', '缺口暴露', '用真实任务暴露人物还不足以承担的部分。', '读者和人物都知道必须补哪项能力或心性。', ['qualification-trial', 'workplace-project'], ['container', 'pressure']),
      stage('old-way', '旧办法受挫', '让人物用符合当前状态的办法认真尝试。', '旧办法的上限与代价变得可见。', ['repeated-failure'], ['strategy', 'pressure']),
      stage('responsibility', '责任压上来', '把他人的安危、团队或公共结果交到人物手中。', '逃避的成本高于继续行动。', ['responsibility-expansion'], ['pressure', 'turn']),
      stage('active-choice', '无人代替的选择', '让人物在两项真实代价之间自行决定。', '选择证明人物发生了变化。', ['moral-dilemma', 'sacrifice-short-term'], ['strategy', 'pressure']),
      stage('proof', '结果检验成长', '用公开或关键结果检验新能力与新责任。', '身份、关系或局势形成不可逆新状态。', ['public-demonstration', 'rank-promotion'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['positive-growth-arc', 'try-fail-cycle', 'moral-choice-proof'],
    legacyTemplateKeys: ['volume-grow-into-role']
  }),
  recipe({
    key: 'loss-and-rebuild', publicTitle: '先站稳，再失去依靠，最后重建优势',
    publicExplanation: '先让人物拥有可感知的阶段成果，再让旧基本盘因前置隐患崩塌，最后以新方法重建。',
    commonGenreFamilies: [], fitSignals: ['逆袭', '低谷', '重建', '翻盘'],
    caution: '低谷不能来自突然惩罚，重建也不能恢复成原样。',
    stages: [
      stage('foothold', '建立立足点', '让人物取得真实但尚不牢固的成果。', '人物拥有一项值得失去的资源或关系。', ['resource-acquisition', 'survival-secured'], ['payoff', 'bridge']),
      stage('warning', '隐患显形', '用小异常证明旧优势存在结构性缺口。', '成功开始带着可追踪风险。', ['hidden-cost-reveal'], ['pressure', 'turn']),
      stage('collapse', '核心依靠失效', '让关键资源、身份或关系真正失去。', '人物无法回到旧平衡。', ['irreversible-loss'], ['pressure', 'turn']),
      stage('reframe', '从失败重想', '让人物从实际损失中改写判断与方法。', '形成不同于旧办法的新方案。', ['innovation-breakthrough'], ['strategy', 'turn']),
      stage('rebuild', '带着代价重建', '用新方法建立不同性质的优势并结算损失。', '新基本盘成立，旧代价保留。', ['team-cohesion', 'territory-gained'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['false-victory-defeat', 'reaction-dilemma-decision', 'bittersweet-ending'],
    legacyTemplateKeys: ['volume-pressure-to-rebuild']
  }),
  recipe({
    key: 'escalating-consequences', publicTitle: '解决一个麻烦，又引出更大的目标',
    publicExplanation: '每次阶段解决都制造新的事实和责任，使事件靠因果逐步扩大。',
    commonGenreFamilies: [], fitSignals: ['快节奏', '任务链', '升级', '连续事件'],
    caution: '不能只换更强敌人；每一次扩大都要改变问题性质。',
    stages: [
      stage('first-problem', '从可理解的小问题开始', '用人物当前能力可触及的问题启动行动。', '人物进入事件并暴露边界。', ['mission-chain'], ['container', 'pressure']),
      stage('first-result', '解决并留下后果', '给出真实小兑现，同时让结果影响更大关系。', '下一问题由本次结果触发。', ['false-victory'], ['payoff', 'turn']),
      stage('wider-stakes', '问题扩大', '把私人得失推向团队、组织或公共局势。', '人物责任和对手层级改变。', ['responsibility-expansion'], ['pressure', 'container']),
      stage('irreversible-choice', '关闭简单退路', '让人物为长期目标放弃一项短期安全。', '高潮前不能恢复原计划。', ['sacrifice-short-term'], ['strategy', 'pressure']),
      stage('climax-result', '集中结算', '用此前累积的资源与因果完成阶段冲突。', '当前问题关闭，并自然打开下一层。', ['new-world-opened'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['causal-chain', 'escalation-ladder', 'arc-close-next-open'],
    legacyTemplateKeys: ['volume-escalating-goals']
  }),
  recipe({
    key: 'layered-truth', publicTitle: '围绕一个疑问，逐层改变理解',
    publicExplanation: '从清楚问题出发，以公平证据建立判断，再让关键线索重释旧事实并回答本层谜团。',
    commonGenreFamilies: [], fitSignals: ['悬疑', '秘密', '调查', '身世'],
    caution: '必须回答本层承诺，不能永远只抛出更大的谜。',
    stages: [
      stage('question', '问题落到人物身上', '建立一个人物必须知道答案的问题。', '调查目标和不调查的代价清楚。', ['investigation-case'], ['container', 'pressure']),
      stage('evidence', '收集互相校正的证据', '让行动获得多源信息而非听一人解释。', '形成第一个有依据的判断。', ['evidence-sting', 'unreliable-intelligence'], ['strategy', 'pressure']),
      stage('wrong-picture', '合理但不完整的结论', '让当前证据支持一个会指导行动的暂时解释。', '人物按暂时判断付出行动成本。', ['controlled-disclosure', 'false-victory'], ['strategy', 'turn']),
      stage('reinterpret', '关键证据重释前文', '用已出现信息改变旧证据的意义。', '目标、嫌疑或关系发生转向。', ['evidence-reframed'], ['turn', 'pressure']),
      stage('layer-answer', '回答本层真相', '给出可验证答案并结算人物反应。', '旧问题关闭，新后果而非空谜语进入下一层。', ['truth-revealed', 'investigation-followup'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['fair-play-clue-chain', 'progressive-reveal', 'delayed-context-reframe'],
    legacyTemplateKeys: ['volume-truth-layer-by-layer']
  }),
  recipe({
    key: 'balance-of-power', publicTitle: '多方各有所求，靠选择重排局势',
    publicExplanation: '写清各方利益、资源和底线，通过试探、反制、换边与结算产生新格局。',
    commonGenreFamilies: [], fitSignals: ['权谋', '商战', '战争', '多势力'],
    caution: '谋略不能依赖对手突然变笨，后手都要有事前依据。',
    stages: [
      stage('positions', '利益与底线显形', '让参与方在行动中暴露真正所求。', '读者能理解各方为什么不能直接让步。', ['negotiation-summit'], ['container', 'pressure']),
      stage('probe', '互相试探', '用有限合作、交易或小行动交换信息。', '联盟和误判同时形成。', ['negotiated-exchange'], ['strategy', 'pressure']),
      stage('countermove', '对手有效反制', '让对方针对主角真实弱点行动。', '旧计划失效，利益格局开始移动。', ['parallel-plans'], ['strategy', 'turn']),
      stage('switch', '关键一方换边', '用利益或价值选择改变临时阵营。', '力量平衡发生不可逆变化。', ['divide-coalition', 'enemy-cooperation'], ['strategy', 'turn']),
      stage('rebalance', '结算新格局', '明确胜负、损失、债务和新责任。', '新权力关系成为后续起点。', ['political-aftermath'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['multi-line-convergence', 'antagonist-counterplan', 'consequence-propagation'],
    legacyTemplateKeys: ['volume-strategy-changes-balance']
  }),
  recipe({
    key: 'relationship-redefines-goal', publicTitle: '关系变化也改变人物目标',
    publicExplanation: '通过共同行动、真实分歧、责任与自由选择，让关系不再只是主线旁边的装饰。',
    commonGenreFamilies: [], fitSignals: ['爱情', '友情', '家庭', '搭档', '关系'],
    caution: '不用重复误会拖延，也不让一方只服务另一方成长。',
    stages: [
      stage('distance', '建立真实分歧', '让双方在目标或边界上存在可行动的差异。', '关系张力与主线任务绑定。', ['relationship-crossroads'], ['container', 'pressure']),
      stage('shared-action', '共同承担一件事', '用具体协作修正双方对彼此的判断。', '信任获得第一项行动证据。', ['team-specialization', 'team-formation', 'workplace-project', 'caregiving-period'], ['strategy', 'container']),
      stage('boundary-test', '边界受检验', '让重大代价逼双方表明不能让步之处。', '旧相处方式无法继续。', ['moral-dilemma'], ['pressure', 'turn']),
      stage('responsibility', '为伤害和承诺负责', '让每一方承担自己的行为后果。', '关系能否继续有了现实条件。', ['empathy-repair'], ['strategy', 'bridge']),
      stage('new-choice', '确认新的关系位置', '让双方在可拒绝的条件下作出新选择。', '关系状态与主线目标同步更新。', ['relationship-confirmed', 'trust-repaired'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['trust-ladder', 'alliance-under-pressure', 'scene-sequel-cycle'],
    legacyTemplateKeys: ['volume-relationships-change-goal']
  }),
  recipe({
    key: 'accumulate-and-stress-test', publicTitle: '一点点建立成果，再用危机检验',
    publicExplanation: '从迫切缺口开始建立资源、制度或团队，在利益冲突后用一次真实危机检验体系。',
    commonGenreFamilies: [], fitSignals: ['经营', '种田', '创业', '领主', '事业'],
    caution: '建设不能写成清单，最后检验的是体系而不只是主角个人。',
    stages: [
      stage('gap', '找出迫切缺口', '把需要建设的原因落到具体人物与风险。', '阶段目标可测量且有时间成本。', ['production-crisis'], ['container', 'pressure']),
      stage('first-loop', '建立第一条运转路径', '用有限资源完成最小可用循环。', '获得小成果并暴露瓶颈。', ['innovation-breakthrough'], ['strategy', 'payoff']),
      stage('people-cost', '利益和分配发生冲突', '让建设选择影响不同成员。', '分工、领导或公平问题进入明面。', ['internal-faction-split'], ['pressure', 'turn']),
      stage('stress-test', '外部危机检验体系', '让组织而不是主角外挂承担关键压力。', '体系缺陷和有效部分同时被证明。', ['disaster-response'], ['container', 'pressure']),
      stage('settle', '结算基本盘', '清点成果、损失和下一阶段责任。', '资源、规则与组织形成可持续新状态。', ['territory-gained', 'institution-changed'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['progression-loop', 'consequence-propagation', 'denouement'],
    legacyTemplateKeys: ['volume-build-and-prove']
  }),
  recipe({
    key: 'trigger-and-response', publicTitle: '麻烦找上门，人物必须回应',
    publicExplanation: '用改变日常的具体问题启动事件，人物尝试、受阻并作出会留下后果的选择。',
    commonGenreFamilies: [], fitSignals: ['开局', '触发事件', '新任务'], caution: '麻烦必须切中人物利益，外力不能替人物完成结果。',
    stages: [
      stage('trigger', '日常被改变', '让问题直接改变人物当前处境。', '人物无法继续假装无事发生。', ['mission-chain'], ['container', 'pressure']),
      stage('first-response', '按本能回应', '让人物用当前性格和信息作出第一反应。', '目标与能力边界显形。', ['negotiated-exchange', 'strategic-retreat'], ['strategy']),
      stage('resistance', '回应遇到阻力', '用对手或规则让简单办法失效。', '人物必须调整或增加投入。', ['institutional-constraint'], ['pressure']),
      stage('choice', '主动选择路线', '让人物决定真正要保护或争取什么。', '事件从被动麻烦变成主动目标。', ['goal-redefinition'], ['turn', 'strategy']),
      stage('result', '形成可承接结果', '完成、失败或付代价结束当前事件。', '状态变化能触发下一事件。', ['bittersweet-exchange'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['goal-action-consequence', 'scene-goal-conflict-turn-result'],
    legacyTemplateKeys: ['event-problem-demands-response']
  }),
  recipe({
    key: 'capability-under-pressure', publicTitle: '被低估或受限制，最后用行动改变判断',
    publicExplanation: '先建立具体误判和限制，再让人物准备、选择出手，以可验证结果重排关系。',
    commonGenreFamilies: [], fitSignals: ['扮猪吃虎', '打脸', '证明能力', '逆袭'], caution: '爽点必须留下资格、关系或资源变化，不能只写围观震惊。',
    stages: [
      stage('misread', '具体误判成立', '说明别人错估了人物哪项能力，以及这种误判为何合理。', '人物受到现实限制。', ['hierarchy-pressure'], ['pressure']),
      stage('prepare', '在限制下准备', '让人物积累证据、能力或出手机会。', '成功所需条件逐步具备。', ['conceal-capability'], ['strategy']),
      stage('worse-pressure', '误判带来更大代价', '让不出手的成本升高。', '人物必须决定是否公开自己。', ['public-scrutiny'], ['pressure', 'turn']),
      stage('demonstrate', '用行动完成检验', '让结果符合公开标准而非主角自说。', '旧判断被事实推翻。', ['public-demonstration'], ['strategy', 'payoff']),
      stage('reorder', '结算新的位置', '让受影响者依结果调整资格、资源或态度。', '爽点进入后续因果。', ['public-vindication', 'rank-promotion'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['pressure-payoff-loop', 'setup-payoff', 'consequence-propagation'],
    legacyTemplateKeys: ['event-pressure-reveals-capability']
  }),
  recipe({
    key: 'victory-with-cost', publicTitle: '看似解决了，却带来更大的代价',
    publicExplanation: '先给真实的小胜与情绪回报，再让胜利本身触发新的成本和下一问题。',
    commonGenreFamilies: [], fitSignals: ['假胜利', '转折', '升级'], caution: '小胜不能立刻作废，新代价必须来自胜利的合理后果。',
    stages: [
      stage('attempt', '认真争取眼前目标', '投入真实资源并承担失败风险。', '读者理解这次胜利为何重要。', ['mission-chain'], ['container', 'strategy']),
      stage('win', '取得真实结果', '兑现当前承诺并允许情绪释放。', '人物得到可保留的成果。', ['resource-acquisition'], ['payoff']),
      stage('cost-sign', '结果出现异常', '让胜利影响更大系统并留下不安。', '新成本有可追踪迹象。', ['success-triggers-crisis'], ['turn']),
      stage('cost-arrives', '更大代价到来', '让人物承担胜利触发的责任或反制。', '旧目标已不足以指导后续。', ['responsibility-expansion'], ['pressure']),
      stage('new-need', '确定下一问题', '结算保留下来的胜利与新增危机。', '下一事件拥有清楚因果接口。', ['next-mission-intake'], ['bridge'])
    ],
    narrativeMethodKeys: ['false-victory-defeat', 'yes-but-no-and', 'arc-close-next-open'],
    legacyTemplateKeys: ['event-false-win-higher-cost']
  }),
  recipe({
    key: 'failure-to-breakthrough', publicTitle: '旧办法失败，找到真正突破口',
    publicExplanation: '让失败暴露认知问题并造成损失，人物据此换方法，成功也保留余波。',
    commonGenreFamilies: [], fitSignals: ['失败', '突破', '智取', '成长'], caution: '突破口必须来自此前信息，不能在失败后突然开挂。',
    stages: [
      stage('old-way', '执行旧办法', '让人物按当前最佳判断认真尝试。', '旧方法被充分检验。', ['qualification-trial'], ['container', 'strategy']),
      stage('failure', '失败造成损失', '让结果暴露真正问题。', '人物失去资源、机会或信心。', ['repeated-failure'], ['pressure']),
      stage('reframe', '重看规则与目标', '从失败证据中找出错误假设。', '新的理解替换旧判断。', ['rule-reinterpreted'], ['turn']),
      stage('new-method', '采用不同方法', '让人物以新理解作出主动选择。', '行动方式发生可见变化。', ['innovation-breakthrough'], ['strategy']),
      stage('breakthrough', '阶段突破', '用结果检验新方法，并结算旧失败的余波。', '能力、关系或目标形成新状态。', ['capability-breakthrough'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['try-fail-cycle', 'reaction-dilemma-decision', 'positive-growth-arc'],
    legacyTemplateKeys: ['event-failure-finds-breakthrough']
  }),
  recipe({
    key: 'clues-reframe-understanding', publicTitle: '线索越多，事情显出另一层真相',
    publicExplanation: '以一个小问题为边界，收集证据、形成判断、重释旧线索，再让新理解改变行动。',
    commonGenreFamilies: [], fitSignals: ['线索', '调查', '秘密', '解谜'], caution: '线索数量不能替代证据链，关键答案必须可回看验证。',
    stages: [
      stage('question', '限定当前问题', '明确这次调查必须回答什么。', '调查边界和代价清楚。', ['investigation-case'], ['container']),
      stage('clues', '获得多源线索', '让线索互相支持也互相冲突。', '人物形成暂时判断。', ['unreliable-intelligence'], ['strategy', 'pressure']),
      stage('act-on-belief', '按暂时判断行动', '让判断接受现实检验。', '错误或缺口产生实际后果。', ['evidence-sting'], ['strategy']),
      stage('reframe', '旧线索被重新理解', '用关键证据改变因果解释。', '嫌疑、目标或关系转向。', ['evidence-reframed'], ['turn']),
      stage('decision', '依据新理解决定下一步', '回答当前小问题并改变行动。', '真相推进而非只增加资料。', ['truth-revealed'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['fair-play-clue-chain', 'progressive-reveal', 'partial-answer-new-question'],
    legacyTemplateKeys: ['event-clues-change-understanding']
  }),
  recipe({
    key: 'factions-change-sides', publicTitle: '几方目标碰撞，局势在选择中换边',
    publicExplanation: '从公开位置与隐藏利益出发，经试探和反制后，由一项可理解选择重排阵营。',
    commonGenreFamilies: [], fitSignals: ['多方', '换边', '策反', '联盟'], caution: '换边必须符合长期利益或价值，不能只为主角服务。',
    stages: [
      stage('positions', '表面位置', '让各方公开目标和当前限制。', '读者理解局面。', ['negotiation-summit'], ['container']),
      stage('probe', '行动试探', '用有限交易暴露真实利益。', '误判与暂时联盟形成。', ['negotiated-exchange'], ['strategy']),
      stage('counter', '有效反制', '让一方利用另一方弱点。', '原有安排失衡。', ['bait-and-catch'], ['strategy', 'pressure']),
      stage('switch', '关键选择换边', '让人物根据真实利益改变合作对象。', '阵营关系不可逆变化。', ['turn-opponent'], ['strategy', 'turn']),
      stage('settle', '新阵营结算', '明确每方所得、所失和未清债务。', '新平衡能承接下一事件。', ['political-aftermath'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['antagonist-counterplan', 'multi-line-convergence', 'consequence-propagation'],
    legacyTemplateKeys: ['event-factions-change-sides']
  }),
  recipe({
    key: 'relationship-forces-choice', publicTitle: '共同经历把关系推到必须表态的位置',
    publicExplanation: '让真实分歧落到行动，再通过共同承担、边界检验和自由选择改变关系。',
    commonGenreFamilies: [], fitSignals: ['关系', '爱情', '友情', '家庭'], caution: '不能把危险强迫当爱情证明，也不能强迫受伤者原谅。',
    stages: [
      stage('tension', '分歧落到行动', '让双方目标在具体事情上冲突。', '关系问题不再能回避。', ['relationship-crossroads'], ['container', 'pressure']),
      stage('shared-action', '共同承担', '安排必须协作才能完成的目标。', '双方获得新的行动证据。', ['team-specialization'], ['strategy']),
      stage('test', '信任与边界受检验', '让代价迫使双方展示真正优先级。', '旧关系位置失效。', ['collateral-risk'], ['pressure', 'turn']),
      stage('responsibility', '承担各自后果', '让每个人对伤害和承诺负责。', '关系修复或分离具有现实条件。', ['empathy-repair'], ['strategy', 'bridge']),
      stage('choice', '作出可拒绝的选择', '确认继续、重订或结束关系。', '关系和主线进入新状态。', ['trust-repaired', 'relationship-confirmed'], ['payoff'])
    ],
    narrativeMethodKeys: ['trust-ladder', 'betrayal-repair-arc', 'moral-choice-proof'],
    legacyTemplateKeys: ['event-relationship-forces-choice']
  }),
  recipe({
    key: 'hope-loss-choice', publicTitle: '先获得希望，再失去依靠，最后被迫选择',
    publicExplanation: '建立可信希望并让人物投入，再由前置因果使依靠失效，以价值选择完成高潮。',
    commonGenreFamilies: [], fitSignals: ['希望', '绝望', '牺牲', '强情绪'], caution: '失去不能只为虐，最后不能突然出现无代价第三解。',
    stages: [
      stage('hope', '希望出现', '给出真实可行的解决路径。', '人物和读者愿意投入期待。', ['rescue-operation'], ['container', 'payoff']),
      stage('investment', '为希望投入', '让人物付出时间、资源或信任。', '希望被赋予不可替代的重量。', ['sacrifice-short-term'], ['strategy', 'pressure']),
      stage('loss', '依靠失效', '让前置风险兑现并关闭简单道路。', '人物进入无法回避的低点。', ['irreversible-loss'], ['pressure', 'turn']),
      stage('choice', '两种代价间选择', '让人物主动决定保住什么。', '人物价值被行动证明。', ['moral-dilemma'], ['strategy', 'pressure']),
      stage('aftermath', '保留选择余波', '结算得到、失去和幸存关系。', '真实变化进入下一事件。', ['bittersweet-exchange', 'mourning-ritual'], ['payoff', 'bridge'])
    ],
    narrativeMethodKeys: ['hope-despair-cycle', 'moral-choice-proof', 'payoff-afterglow'],
    legacyTemplateKeys: ['event-hope-loss-choice']
  })
];

const GENRE_RECIPES: readonly PlotRecipeDefinition[] = [
  compactRecipe('dungeon-expedition-run', '一次有后果的副本冒险', '进入未知规则区，探索、受困、改变策略并带着长期后果离开。',
    ['eastern_fantasy', 'xianxia', 'western_fantasy', 'game_esports', 'infinite_flow'], ['副本', '秘境', '遗迹', '闯关'], '不能把每层写成换皮打怪，发现必须改变路线和后续。',
    ['dungeon-expedition', 'lost-realm-exploration', 'rule-trap', 'hidden-cost-reveal', 'resource-acquisition'], ['episodic-spine', 'progressive-reveal', 'escalation-ladder']),
  compactRecipe('tournament-run', '从预选到关键赛的竞技单元', '用资格、对手研究、受挫、变招和赛后结果组织一段完整竞技。',
    ['sports', 'game_esports', 'campus_youth', 'eastern_fantasy', 'xianxia'], ['比赛', '竞技', '擂台', '夺冠'], '每轮必须检验不同能力，输赢后都要更新排名、伤病和关系。',
    ['qualification-trial', 'tournament-bracket', 'overwhelming-opponent', 'innovation-breakthrough', 'championship-result'], ['eight-sequence', 'escalation-ladder', 'denouement']),
  compactRecipe('academy-growth-cycle', '学院考核与成长单元', '围绕入学、训练、同伴竞争、实战失误和资格兑现推进。',
    ['campus_youth', 'eastern_fantasy', 'xianxia', 'light_novel'], ['学院', '考试', '同学', '校赛'], '校园关系不能只服务考试，考核也必须回收训练和选择。',
    ['academy-assessment', 'learn-by-apprenticeship', 'internal-faction-split', 'innovation-breakthrough', 'rank-promotion'], ['positive-growth-arc', 'rivalry-respect-arc', 'promise-progress-payoff']),
  compactRecipe('staged-revenge', '分层复仇与真相清算', '从确认责任、接近目标、发现更深因果到阶段清算并承担后果。',
    [], ['复仇', '清算', '旧债', '仇人'], '不能把所有障碍都写成更大幕后黑手，也不能忽略无辜者。',
    ['investigation-case', 'embed-and-observe', 'evidence-reframed', 'moral-dilemma', 'revenge-stage-settled'], ['causal-chain', 'progressive-reveal', 'moral-choice-proof']),
  compactRecipe('fair-case-investigation', '公平线索的案件调查', '从案发问题、证据采集、错误判断、关键重释到本层真相与追责。',
    ['mystery_detective', 'crime', 'historical', 'horror_supernatural'], ['查案', '推理', '凶手', '调查'], '答案必须来自已展示证据，真相揭晓后还要结算人的后果。',
    ['investigation-case', 'evidence-sting', 'unreliable-intelligence', 'culprit-reversal', 'justice-enforced'], ['fair-play-clue-chain', 'red-herring-control', 'denouement']),
  compactRecipe('infiltration-and-extraction', '潜入、取物与撤离', '从情报和伪装开始，进入目标区、遇到变数、完成取物并承担暴露后果。',
    ['crime', 'military_war', 'science_fiction', 'adventure_exploration'], ['潜入', '偷取', '卧底', '撤离'], '计划必须提前可见，变数来自环境和人物而非凭空改规则。',
    ['infiltration-operation', 'disguise-identity', 'secret-exposure', 'plan-within-plan-exposed', 'escape-secured'], ['antagonist-counterplan', 'ticking-clock', 'arc-close-next-open']),
  compactRecipe('countdown-rescue', '限时救援', '确认受困状态、制定路线、失去时间或资源、做艰难选择并结算获救余波。',
    [], ['救援', '营救', '人质', '倒计时'], '被救者不能只是道具，倒计时不可随意暂停。',
    ['rescue-operation', 'team-specialization', 'deadline-pressure', 'collateral-risk', 'rescue-completed'], ['ticking-clock', 'multi-front-pressure', 'cathartic-release']),
  compactRecipe('survival-collapse-rebuild', '生存体系崩塌与重建', '从临时稳定、资源断裂、内部冲突到新规则和据点检验。',
    ['survival', 'apocalypse', 'science_fiction', 'farming_management'], ['求生', '据点', '物资', '重建'], '不能靠无限仓库解决，也不能只报物资数量。',
    ['survival-shelter', 'production-crisis', 'internal-faction-split', 'innovation-breakthrough', 'survival-secured'], ['resource-squeeze', 'alliance-under-pressure', 'progression-loop']),
  compactRecipe('campaign-to-aftermath', '从战略目标到战后格局的战役', '确定战略目标，经侦察和交锋改变计划，在决战后结算控制区与政治后果。',
    ['military_war', 'historical', 'alternate_history', 'science_fiction'], ['战争', '战役', '攻城', '军队'], '战斗不能脱离补给、平民和政治，决战胜利不等于治理成功。',
    ['military-campaign', 'feint-and-shift', 'resource-scarcity', 'sacrifice-shifts-balance', 'political-aftermath'], ['multi-line-convergence', 'crosscutting-pressure', 'closure-hierarchy']),
  compactRecipe('court-power-struggle', '朝堂与组织权力争夺', '从利益盘点、公开议决、暗中反制到关键换边和正式权力结果。',
    ['historical', 'ancient_romance', 'kingdom_building', 'business'], ['权谋', '朝堂', '夺嫡', '派系'], '不能只写嘴炮和密谋，各方资源、制度与群众基础要真实。',
    ['court-debate', 'build-alliance', 'institutional-constraint', 'turn-opponent', 'institution-changed'], ['information-asymmetry', 'antagonist-counterplan', 'consequence-propagation']),
  compactRecipe('kingdom-building-cycle', '领地建设与外部检验', '盘点缺口、建设生产、处理分配、承受外部危机并结算新基本盘。',
    ['kingdom_building', 'farming_management', 'alternate_history', 'western_fantasy'], ['领主', '基建', '种田', '建国'], '发展数据必须通过人物生活和冲突体现，扩张后要承担治理。',
    ['territory-development', 'innovation-breakthrough', 'internal-faction-split', 'siege-defense', 'territory-gained'], ['progression-loop', 'consequence-propagation', 'denouement']),
  compactRecipe('business-war-cycle', '从产品到市场反制的商战', '发现需求、做出方案、争夺客户、承受对手反制并用真实经营结果结算。',
    ['business', 'workplace', 'urban'], ['商战', '创业', '竞标', '市场'], '商业胜负不能只靠发布会和舆论，现金、履约与组织能力要进入剧情。',
    ['workplace-project', 'innovation-breakthrough', 'commercial-bidding-war', 'reputation-risk', 'commercial-win'], ['goal-action-consequence', 'antagonist-counterplan', 'consequence-propagation']),
  compactRecipe('workplace-project-cycle', '一项改变职业位置的项目', '从接项目、分工、专业失误、危机交付到组织内结算。',
    ['workplace', 'business', 'urban'], ['职场', '项目', '升职', '专业'], '不能用术语代替专业判断，项目成功也不等于所有关系和解。',
    ['workplace-project', 'team-specialization', 'institutional-constraint', 'innovation-breakthrough', 'rank-promotion'], ['scene-goal-conflict-turn-result', 'alliance-under-pressure', 'denouement']),
  compactRecipe('entertainment-rise-cycle', '作品从创作到公开检验', '创作准备、团队磨合、公开演出、舆论波动和行业结果共同推进。',
    ['entertainment', 'campus_youth', 'modern_romance'], ['娱乐圈', '作品', '舞台', '成名'], '作品质量和行业选择要可见，不能只写热搜和全网吹捧。',
    ['public-performance', 'team-formation', 'public-scrutiny', 'hidden-cost-reveal', 'artistic-recognition'], ['opening-promise', 'pressure-payoff-loop', 'consequence-propagation']),
  compactRecipe('sports-championship-cycle', '赛季关键阶段与冠军检验', '通过训练、资格赛、关键失利、战术调整和终局比赛完成竞技承诺。',
    ['sports', 'game_esports', 'campus_youth'], ['联赛', '冠军', '球队', '电竞'], '必须让团队、伤病和对手策略改变比赛，不能只靠主角个人爆发。',
    ['sports-match', 'training-consolidation', 'injury-illness', 'team-specialization', 'championship-result'], ['rivalry-respect-arc', 'escalation-ladder', 'cathartic-release']),
  compactRecipe('romance-commitment-cycle', '从靠近到作出关系承诺', '建立吸引与现实阻力，经共同行动和边界危机后，让双方自由选择关系。',
    ['modern_romance', 'ancient_romance', 'fantasy_romance', 'campus_youth'], ['恋爱', '感情', '暧昧', '确定关系'], '不能用误会拖满全程，也不能让一方丧失独立目标。',
    ['reunion-return', 'caregiving-period', 'relationship-crossroads', 'empathy-repair', 'relationship-confirmed'], ['attraction-obstacle-commitment', 'trust-ladder', 'scene-sequel-cycle']),
  compactRecipe('marriage-crisis-repair', '婚姻危机与边界重建', '让生活与责任问题显形，经历分离或后果，再决定修复、重订或结束。',
    ['marriage_family', 'family_reality', 'modern_romance'], ['婚姻', '夫妻', '家庭危机', '追妻'], '修复不等于强迫原谅，结束关系也可以是完整结算。',
    ['family-gathering', 'debt-obligation', 'secret-exposure', 'empathy-repair', 'trust-repaired'], ['betrayal-repair-arc', 'family-repair-boundary', 'bittersweet-ending']),
  compactRecipe('family-legacy-cycle', '家庭旧账与传承选择', '从一次团聚或照护打开旧事，经秘密和责任冲突，最后重订家庭边界。',
    ['family_reality', 'marriage_family', 'historical'], ['家庭', '亲情', '传承', '年代'], '不能用血缘强迫和解，也不能把老一代只写成阻碍。',
    ['family-gathering', 'caregiving-period', 'legacy-inheritance-reveal', 'moral-dilemma', 'family-reconciled'], ['family-repair-boundary', 'progressive-reveal', 'moral-choice-proof']),
  compactRecipe('science-discovery-cycle', '科学发现与伦理后果', '从异常现象、验证假设、突破发现、隐藏代价到公开或封存选择。',
    ['science_fiction', 'workplace', 'thriller'], ['科学', '实验', '发现', '人工智能'], '科学突破不能靠一句天才灵感，验证、复现和伦理后果要存在。',
    ['frontier-expedition', 'innovation-breakthrough', 'unreliable-intelligence', 'hidden-cost-reveal', 'controlled-disclosure'], ['causal-chain', 'progressive-reveal', 'true-dilemma']),
  compactRecipe('apocalypse-refuge-cycle', '末世避难所的建立与检验', '从逃难集结、资源分配、内部规则、外部袭击到新共同体结算。',
    ['apocalypse', 'survival', 'science_fiction'], ['末世', '避难所', '丧尸', '灾变'], '据点不是万能安全区，普通成员的劳动、恐惧和规则要可见。',
    ['migration-exodus', 'settlement-building', 'resource-scarcity', 'siege-defense', 'survival-secured'], ['resource-squeeze', 'alliance-under-pressure', 'closure-hierarchy']),
  compactRecipe('infinite-instance-cycle', '规则副本的进入、识别与脱离', '从进入规则区、试探规则、承担错误代价、识别关键漏洞到带着影响离开。',
    ['infinite_flow', 'game_esports', 'horror_supernatural', 'science_fiction'], ['无限流', '规则怪谈', '副本', '轮回'], '规则必须稳定可验证，通关不能让人物和长期线全部归零。',
    ['dungeon-expedition', 'rule-trap', 'repeated-failure', 'rule-reinterpreted', 'escape-secured'], ['fair-play-clue-chain', 'try-fail-cycle', 'episodic-spine'])
];

export const V7_PLOT_RECIPES: readonly PlotRecipeDefinition[] = [
  ...LEGACY_MIGRATED_RECIPES,
  ...GENRE_RECIPES
];

export const LEGACY_PLOT_RECIPE_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(V7_PLOT_RECIPES.flatMap((item) => item.legacyTemplateKeys.map((legacyKey) => [legacyKey, item.key])))
);

export const LEGACY_MIGRATED_TEMPLATE_KEYS: readonly string[] = [
  'volume-grow-into-role', 'volume-pressure-to-rebuild', 'volume-escalating-goals',
  'volume-truth-layer-by-layer', 'volume-strategy-changes-balance',
  'volume-relationships-change-goal', 'volume-build-and-prove',
  'event-problem-demands-response', 'event-pressure-reveals-capability',
  'event-false-win-higher-cost', 'event-failure-finds-breakthrough',
  'event-clues-change-understanding', 'event-factions-change-sides',
  'event-relationship-forces-choice', 'event-hope-loss-choice'
];

export function getPlotRecipe(recipeKey: string): PlotRecipeDefinition | null {
  return V7_PLOT_RECIPES.find((item) => item.key === recipeKey) ?? null;
}

export function listPlotRecipes(filter: { genreFamily?: GenreFamily; query?: string } = {}): PlotRecipeDefinition[] {
  const query = normalize(filter.query ?? '');
  return V7_PLOT_RECIPES.filter((item) => query.length === 0 || normalize([
    item.key, item.publicTitle, item.publicExplanation, ...item.fitSignals
  ].join(' ')).includes(query)).sort((left, right) => {
    if (filter.genreFamily === undefined) return left.key.localeCompare(right.key);
    const leftFit = left.commonGenreFamilies.length === 0 || left.commonGenreFamilies.includes(filter.genreFamily) ? 1 : 0;
    const rightFit = right.commonGenreFamilies.length === 0 || right.commonGenreFamilies.includes(filter.genreFamily) ? 1 : 0;
    return rightFit - leftFit || left.key.localeCompare(right.key);
  });
}

export function validatePlotRecipeRegistry(): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  const legacyKeys = new Set<string>();
  for (const item of V7_PLOT_RECIPES) {
    if (keys.has(item.key)) errors.push(`剧情配方键重复：${item.key}`);
    keys.add(item.key);
    // 第86批：节奏段数不定死，按内容需要取 2~7 段（原为硬编码必须 5 段）。
    if (item.stages.length < 2 || item.stages.length > 7) errors.push(`${item.key} 阶段数必须在 2~7 之间`);
    const stageKeys = new Set<string>();
    for (const stageValue of item.stages) {
      if (stageKeys.has(stageValue.key)) errors.push(`${item.key} 阶段键重复：${stageValue.key}`);
      stageKeys.add(stageValue.key);
      if (stageValue.requiredCategories.length === 0) errors.push(`${item.key}/${stageValue.key} 缺少模式类别`);
      for (const patternKey of stageValue.preferredPatternKeys) {
        if (getPlotPattern(patternKey) === null) errors.push(`${item.key}/${stageValue.key} 引用了不存在的剧情模式：${patternKey}`);
      }
    }
    for (const methodKey of item.narrativeMethodKeys) {
      if (getNarrativeMethod(methodKey) === null) errors.push(`${item.key} 引用了不存在的叙事方法：${methodKey}`);
    }
    for (const legacyKey of item.legacyTemplateKeys) {
      if (legacyKeys.has(legacyKey)) errors.push(`历史剧情模板重复迁移：${legacyKey}`);
      legacyKeys.add(legacyKey);
    }
  }
  for (const legacyKey of LEGACY_MIGRATED_TEMPLATE_KEYS) {
    if (!legacyKeys.has(legacyKey)) errors.push(`历史剧情模板未迁移：${legacyKey}`);
  }
  for (const genreKey of GENRE_FAMILY_KEYS) {
    const count = V7_PLOT_RECIPES.filter((item) => item.commonGenreFamilies.length === 0 || item.commonGenreFamilies.includes(genreKey)).length;
    if (count < 15) errors.push(`题材 ${genreKey} 可用剧情配方不足：${count}`);
  }
  return errors;
}

function compactRecipe(
  key: string,
  title: string,
  explanation: string,
  genres: readonly GenreFamily[],
  signals: readonly string[],
  caution: string,
  patterns: readonly [string, string, string, string, string],
  methods: readonly string[]
): PlotRecipeDefinition {
  const stageTitles = ['进入与承诺', '准备与第一次推进', '压力升级', '关键转向', '结果与余波'] as const;
  const responsibilities = [
    '建立本单元的进入条件、目标和无法忽视的问题。',
    '让人物采用具体方法行动，并获得第一项结果。',
    '让阻力针对已有弱点升级，迫使人物增加投入。',
    '用前置因果改变目标、理解、关系或解决方法。',
    '兑现当前承诺，结算代价并留下可承接的新状态。'
  ] as const;
  const changes = [
    '人物从日常或上一结果进入明确任务。',
    '资源、关系或信息获得第一项变化。',
    '旧办法不能无成本继续。',
    '后半段不能照旧计划进行。',
    '当前任务关闭或形成清楚的下一接口。'
  ] as const;
  return recipe({
    key, publicTitle: title, publicExplanation: explanation, commonGenreFamilies: genres,
    fitSignals: signals, caution, narrativeMethodKeys: methods, legacyTemplateKeys: [],
    stages: patterns.map((patternKey, index) => ({
      key: `stage-${index + 1}`,
      publicTitle: stageTitles[index]!,
      responsibility: responsibilities[index]!,
      requiredChange: changes[index]!,
      preferredPatternKeys: [patternKey],
      requiredCategories: [getRequiredCategory(patternKey)]
    }))
  });
}

function getRequiredCategory(patternKey: string): PlotPatternCategory {
  const value = getPlotPattern(patternKey);
  if (value === null) throw new Error(`剧情配方引用了不存在的模式：${patternKey}`);
  return value.category;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s·—_／/]+/g, '');
}
