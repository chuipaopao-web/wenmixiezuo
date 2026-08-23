import { createHash } from 'node:crypto';
import type { ModelAdapter, ModelRequest, ModelResult } from './model-adapter.js';

export function deterministicCreativeFixtureAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test'
    || env.WENMI_ALLOW_DETERMINISTIC_CREATIVE_FIXTURE === '1'
    || env.WENMI_ALLOW_DETERMINISTIC_NOVEL_FIXTURE === '1';
}

export function assertDeterministicCreativeFixtureAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (deterministicCreativeFixtureAllowed(env)) return;
  throw new Error('尚未连接可用于创作的AI模型。设定、分卷、规划、章纲、正文和点评会暂停，不会用测试模板代替；请先在设置中连接创作模型。');
}
export class DeterministicModelAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic';
  public constructor(public readonly modelId = 'wenmi-fixture-v1') {}

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    assertDeterministicCreativeFixtureAllowed();
    if (signal?.aborted === true) {
      throw signal.reason ?? new DOMException('调用已取消', 'AbortError');
    }
    const digest = createHash('sha256')
      .update(`${request.bookId}\n${request.agentId}\n${request.prompt}`)
      .digest('hex');
    const volumePlan = deterministicVolumePlan(request.prompt);
    const eventChain = deterministicEventChain(request.prompt);
    const storyEvent = deterministicStoryEvent(request.prompt);
    const eventChapterSequence = deterministicEventChapterSequence(request.prompt);
    const eventChapterDetails = deterministicEventChapterDetails(request.prompt);
    const eventChapterChallenge = deterministicEventChapterChallenge(request.prompt);
    const continuationAnalysis = deterministicContinuationAnalysis(request.prompt);
    const synthesis = reviewSynthesis(request.prompt);
    const stageOutlineWorkflow = deterministicStageOutlineWorkflow(request.prompt);
    const settingGuidance = deterministicSettingGuidance(request.prompt);
    const bookBranding = deterministicBookBranding(request.prompt);
    const settlementFollowUp = deterministicSettlementFollowUp(request.prompt);
    const discussion = deterministicDiscussion(request.prompt);
    const output = volumePlan ?? eventChain ?? storyEvent ?? eventChapterSequence ?? eventChapterDetails ?? eventChapterChallenge ?? continuationAnalysis ?? synthesis ?? stageOutlineWorkflow ?? settingGuidance ?? bookBranding ?? settlementFollowUp ?? discussion ?? `【确定性假模型 ${digest.slice(0, 12)}】已根据任务 ${request.taskId} 生成可复现结果。`;
    return {
      provider: this.provider,
      modelId: this.modelId,
      output,
      inputTokens: Math.ceil(request.prompt.length / 2),
      outputTokens: Math.ceil(output.length / 2),
      cashCostCny: 0,
      state: 'succeeded'
    };
  }
}

function deterministicSettlementFollowUp(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || root.operation !== 'settlement_follow_up_v1') return null;
  const seat = isRecord(root.seat) ? root.seat : {};
  const subject = isRecord(root.subject) ? root.subject : {};
  const title = typeof subject.title === 'string' && subject.title.trim().length > 0 ? subject.title.trim() : '当前阶段';
  const range = isRecord(subject.chapterRange) ? subject.chapterRange : {};
  const start = typeof range.start === 'number' ? range.start : 1;
  const end = typeof range.end === 'number' ? range.end : start;
  if (seat.mode === 'chief_editor_storyline_growth') {
    const make = (summary: string, reason: string, question: string, risk: string, horizon: number) => ({
      summary,
      continuationReason: reason,
      protagonistInvolvement: '主角刚刚公开承担责任，新获得的行动资格和关系代价都会逼他继续处理后果。',
      coreQuestion: question,
      pushesStorylineIds: [],
      mayCreateStoryline: false,
      inferences: ['以下是依据结算事实作出的下一段推断，尚未在正文发生。'],
      unknowns: ['对手下一步的具体手段仍未确定', '盟友条件是否会升级仍需观察'],
      misreadRisk: risk,
      recommendedHorizonVolumes: horizon
    });
    return JSON.stringify({ candidates: [
      { candidateKind: 'next_direction', storylineId: null, title: '追查反制来源',
        content: make('下一卷先追查旧秩序维护者的反制来源，把本阶段获得的证据转化为主动调查。',
          '结算确认对手已经开始正面反制，且仍有悬而未决的行动线索。', '主角能否在反制成形前锁定幕后推动者？', '如果反制只是局部善后，这个方向可能高估了幕后组织性。', 1) },
      { candidateKind: 'next_direction', storylineId: null, title: '兑现盟友条件',
        content: make('下一段从盟友提出的新条件切入，让阶段胜利的关系代价先兑现，再决定是否扩大冲突。',
          '结算确认关键关系因公开担责而变化，未解决条件会直接影响行动资格。', '主角愿意用什么代价换取盟友继续同行？', '如果正文没有持续强化盟友条件，关系冲突可能显得突兀。', 2) },
      { candidateKind: 'next_direction', storylineId: null, title: '继续观察一段',
        content: make('暂不固定新故事线，先用下一事件观察反制与盟友条件哪一项真正形成持续压力。',
          '当前只有一次阶段结算，证据足以提出方向但不足以确认长期线路。', '哪一个未解决压力会被人物行动连续推进？', '观察过久可能减弱下一卷目标感，需要保留一个短期可验证任务。', 1) }
    ] });
  }  if (seat.mode === 'deputy_editor_summary') {
    return JSON.stringify({
      summary: `《${title}》这段时间（第${start}到${end}章）里，主角把上一阶段的后果变成了新的行动资格，关键关系因为公开担责变得更牢，旧秩序的维护者开始正面反制；本阶段核心问题已经解决，但对手的新动作和盟友提出的条件还悬着，会直接影响下一阶段。（确定性假模型摘要，供本地与测试环境走通流程。）`
    });
  }
  return JSON.stringify({
    overallAssessment: `《${title}》整体节奏成立：进展、反制和反击依次落地，没有长时间原地踏步。`,
    payoffPlacement: `第${start}到${end}章内每个事件末尾都有一次可验证兑现，卷末反击兑现了整段积累；开局兑现可以再提前半章。`,
    climaxSpacing: `相邻高潮之间隔着一段反制与证据积累，间隔在当前篇幅内可接受，中段注意不要连续两章没有明显进展。`,
    pressureDuration: '反制造成的压抑集中在低点前后，没有超过三章的连续压抑，符合当前题材容忍度。',
    recoveryBeats: '每次高压之后都有一次靠行动兑现承诺换来的喘息，恢复节拍够用，但都比较短，可以适当给人物一段安静的收拢时间。',
    risks: ['中段反制章节若拖长，追读动力会下降', '兑现节奏若全压在各段末尾，开头抓力会变弱'],
    suggestions: ['把下一阶段的第一次兑现提前到开局两章内', '高潮前安排一次短恢复，让最终反击的落差更明显']
  });
}

function deterministicBookBranding(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || root.operation !== 'book_branding_design_v1') return null;
  const kind = root.kind === 'synopsis' ? 'synopsis' : 'title';
  const current = isRecord(root.current) ? root.current : {};
  const base = typeof current.text === 'string' ? current.text.trim() : '';
  const options = kind === 'title'
    ? [
      { text: '长夜举火', note: '抓住第一卷主角孤身反抗黑暗的基调。' },
      { text: '我要举报', note: '直接沿用开书冲突的核心动作，口语、有钩子。' },
      { text: '山河有证', note: '强调证据与公道，适合正剧向的第一卷。' },
      { text: '开局即掀桌', note: '突出第一卷开局反转的爽感。' },
      { text: '人间联名书', note: '从个人抗争走向众人响应的群像方向。' }
    ]
    : [1, 2, 3, 4, 5].map((index) => ({
      text: `【方案${index}】${base === '' ? '主角' : '主角'}被卷入第一卷的核心冲突，从孤身一人到握住关键证据，在一次次反制中付出真实代价，最终撬动了看似不可撼动的旧秩序。（确定性假模型简介，供本地与测试环境走通流程。）`,
      note: '确定性假模型生成的占位简介，结构完整但不含真实创作判断。'
    }));
  return JSON.stringify({ options });
}

function deterministicVolumePlan(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || !['volume_plan_generation_v1', 'volume_direction_generation_v2'].includes(String(root.operation))) return null;
  const seat = isRecord(root.seat) ? root.seat : {};
  const roleKey = typeof seat.roleKey === 'string' ? seat.roleKey : 'chief_editor';
  const book = isRecord(root.book) ? root.book : {};
  const volumeNumber = typeof book.volumeNumber === 'number' ? book.volumeNumber : 1;
  const fusion = seat.mode === 'chief_editor_fusion';
  const alternative = roleKey === 'second_screenwriter';
  const eventRoot = `volume-${volumeNumber}-${fusion ? 'fusion' : alternative ? 'b' : 'a'}`;
  const openingState = '主角刚取得有限立足点，但旧秩序留下的责任、关系裂痕和未知威胁同时压来。';
  const events = [
    {
      eventId: `${eventRoot}-1`,
      order: 1,
      title: fusion ? '胜利留下的缺口' : alternative ? '被忽略的代价' : '新责任落到肩上',
      responsibility: '把上一阶段结果转化为本卷必须处理的现实问题',
      entryState: openingState,
      trigger: '上一阶段的有限胜利暴露出一项无法继续回避的后果',
      action: '主角主动核验局势并选择承担最难但可持续的路径',
      result: '主角取得第一项可验证进展，同时失去一条轻松退路',
      leadsToNext: '被触动的既得利益者开始反制，并利用主角刚暴露的软肋',
      estimatedChapterRange: { minimum: 6, likely: 8, maximum: 10 }
    },
    {
      eventId: `${eventRoot}-2`,
      order: 2,
      title: fusion ? '错误胜利' : alternative ? '盟友提出代价' : '反制逼近',
      responsibility: '升级冲突并让人物关系真正承受选择后果',
      entryState: '主角获得局部主动，但对手已经摸清他的目标与限制',
      trigger: '对手把局部进展包装成主角的失误，迫使盟友重新站队',
      action: alternative
        ? '主角接受盟友的质疑，改变原计划并公开承担由此产生的损失'
        : '主角坚持核心目标，却主动放弃一项短期利益来保护关键关系',
      result: '表面局势跌入低点，但主角获得理解真正矛盾所需的证据与信任',
      leadsToNext: '新证据证明本卷冲突并非个人恩怨，而是规则和利益结构的问题',
      estimatedChapterRange: { minimum: 7, likely: 9, maximum: 12 }
    },
    {
      eventId: `${eventRoot}-3`,
      order: 3,
      title: fusion ? '用新选择改变规则' : alternative ? '把关系变成力量' : '承担代价后的反击',
      responsibility: '完成本卷核心对抗并留下下一卷必然承接的新局面',
      entryState: '主角看清真正矛盾，也明确知道取胜会付出什么',
      trigger: '对手发动最后一次封锁，迫使所有人公开选择立场',
      action: '主角利用前两次事件积累的证据、关系和能力发起有代价的反击',
      result: '本卷核心危机得到可验证解决，主角身份与关系发生不可逆变化',
      leadsToNext: null,
      estimatedChapterRange: { minimum: 8, likely: 10, maximum: 13 }
    }
  ];
  if (root.operation === 'volume_direction_generation_v2') {
    const direction = {
      title: `第${volumeNumber}卷·代价与新局`,
      openingSituation: openingState,
      protagonistDrive: alternative
        ? '主角必须先保住被带走的目击者，借盟友网络追查铜铃来源。'
        : '主角必须在下一次失物齐鸣前查出铜铃是谁送来的，否则会被当成失踪案制造者。',
      volumeGoal: '让主角把有限立足点变成能够承担下一阶段冲突的真实位置。',
      centralOpposition: '既得利益、关系裂痕和能力边界同时要求主角付出代价。',
      escalationPath: alternative
        ? ['争取一名不信任他的记录员', '用矛盾证词逼出泄密者', '盟友被抓后改走公开听证', '让证据链由多人共同保管']
        : ['铜铃异响引来追捕', '失物主人指向被篡改档案', '短暂脱身换来记忆缺失', '用累积证据反制封锁'],
      majorChoices: [alternative ? '公开能力秘密换取盟友验证。' : '再次触碰铜铃换取证词并失去一段真实记忆。'],
      relationshipMovement: [alternative ? '主角把不信任的记录员变成有条件的共同决策者。' : '主角与盟友因隐瞒代价产生裂痕后重建信任。'],
      expressionFocus: ['破局爽感', '选择的代价', '关系拉扯'],
      climaxResponsibility: alternative
        ? '让普通人共同保管的证据拆穿统一口径，并救回目击者。'
        : '把分散证词拼成航路记录，反证追捕者才是规则破坏者。',
      costAndConsequence: '主角公开能力并永久失去一段与姐姐相处的记忆，从此无法抽身。',
      closingState: '眼前罪名洗清并取得查档资格，但姐姐线索指向更深航路。',
      benefits: alternative ? ['群体协作与信任拉扯更强'] : ['个人危机与亲情目标紧密相扣'],
      risks: alternative ? ['多人物并行时要保持主角主动性'] : ['失忆代价不能随用随丢'],
      openSpaces: ['姐姐如何保持自我留到事件设计继续探索'],
      ...(volumeNumber === 1 ? {
        firstVolumeLaunch: {
          primaryDrivers: ['异常谜团', '人物危机', '破局回报'],
          immersionAnchor: '跟随沈砚在追捕和记忆流失中抓住姐姐仍活着的希望。',
          first500Interest: {
            readerQuestion: '十年前失踪姐姐的铜铃为什么在今夜重新响起？',
            immediateSituation: '暴雨夜所有失物同时发声，巡夜人破门并认定沈砚是源头。',
            emotionalGrip: '他既想抓住姐姐活着的希望，又怕触碰铜铃会忘掉她。',
            promisedMovement: '一件失物将撕开失踪案与记忆航路的隐藏规则。'
          },
          goldenThree: [
            { chapterNumber: 1, responsibility: '人物与核心危机同时登场', protagonistAction: '带着铜铃逃出招领处', pressureOrPull: '巡夜人封锁且铜铃夺走记忆', deliveredPayoff: '用失物遗言识破第一次围堵', nextExpectation: '送铃人仍在封锁区' },
            { chapterNumber: 2, responsibility: '展示能力边界并给小回报', protagonistAction: '核验两件失物的矛盾证词', pressureOrPull: '每次触碰都会丢失记忆', deliveredPayoff: '锁定一份被篡改档案', nextExpectation: '经手人正在被灭口' },
            { chapterNumber: 3, responsibility: '闭合开局冲突并打开卷目标', protagonistAction: '在追捕中救下经手人', pressureOrPull: '救人会暴露能力', deliveredPayoff: '反证自己不是异响源头', nextExpectation: '真正源头指向封闭航路' }
          ],
          earlyMomentum: ['每次调查都产生证据、关系或处境变化', '阶段回报之后立即打开更大的责任'],
          majorClimax: {
            promiseToFulfill: '用前三章建立的证据与盟友立场撕开巡夜规则。',
            centralChoice: '公开姐姐的私人记忆以拯救更多失踪者。',
            cost: '永久失去一段与姐姐相处的往事并暴露能力。',
            centralConflictChange: '巡夜人的统一口径被公开证据打破。',
            irreversibleChange: '主角从被追捕者变成有查档资格的调查者。',
            nextStageTrigger: '证据证明姐姐仍在更深航路中。',
            noLaterThanEffectiveChars: 100000
          },
          variationAndRecovery: ['追捕、证据核验和关系选择轮换', '重大揭示前安排人物恢复与情感蓄力'],
          forbiddenShortcuts: ['不能连续靠敌人降智脱险', '不能重复用失忆制造廉价反转']
        }
      } : {})
    };
    return JSON.stringify({
      direction,
      ...(volumeNumber === 1 ? {
        storySpine: {
          longTermReaderPromises: ['破解带着遗憾的失物，并持续兑现规则破局与亲情真相。'],
          protagonistLongArc: '从孤立寻亲者成长为保护他人选择权的新航路守门人。',
          centralQuestion: '当记忆被城市用来维持秩序，人还能凭什么确认自己的爱与选择？',
          escalationLadder: ['个人失踪与铜铃来源', '港区档案与巡夜规则', '整座雾港的记忆航路真相'],
          optionalEndingDirections: ['终止以失踪者记忆维持航路的规则并建立可监督的新规则。'],
          protectedOpenSpaces: ['姐姐这些年如何保持自我', '更远航路和其他城市的规则']
        }
      } : {})
    });
  }
  return JSON.stringify({
    title: `第${volumeNumber}卷·代价与新局`,
    openingState,
    coreGoal: '让主角把有限立足点变成能够承担下一阶段冲突的真实位置。',
    coreConflict: '主角想用新的选择改变局面，但既得利益、关系裂痕和自身能力边界不断要求他付出代价。',
    failureCost: '失去刚建立的信任与行动资格，并让下一阶段威胁在无人制衡的情况下成形。',
    characterChanges: ['主角从证明自己转向主动承担选择后果', '关键盟友从被动协助转向有条件的共同决策'],
    eventSequence: events,
    informationPlan: ['先揭示表面危机', '再证明危机背后的利益结构', '卷末只揭开更大问题的一层入口'],
    escalationAndRecovery: ['每次局部进展都引发更具体的反制', '人物通过行动兑现承诺获得有限喘息', '高潮前让一次错误判断造成真实损失'],
    endingState: '本卷核心问题已经解决，人物关系和行动资格发生不可逆变化，更大冲突因本卷结果而被触发。',
    openThreads: ['真正推动旧规则的人仍未完全现身', '盟友提出的条件将在下一阶段继续生效'],
    nextVolumeTrigger: '本卷胜利改变了力量平衡，受影响的新势力主动介入，迫使主角进入更大的局面。',
    routeCard: {
      protagonistStart: '沈砚带着会响的旧铜铃逃离失物招领处，既不知道姐姐是否活着，也无法公开解释自己听见的未尽之言。',
      drivingMotivation: alternative ? '他必须先保住被巡夜人带走的目击者，借盟友网络追查铜铃来源。' : fusion ? '他要同时救下目击者并锁定铜铃记录的缺口，把个人寻亲变成能公开核验的案件。' : '他必须在下一次失物齐鸣前查出铜铃是谁送来的，否则自己会被当成失踪案的制造者。',
      escalationPath: alternative ? ['先争取一名不信任他的港区记录员', '用两次互相矛盾的失物证词逼出内部泄密者', '盟友被抓后改走公开听证路线', '在航路封锁前让证据链由多人共同保管'] : ['铜铃异响引来追捕并留下第一条可核验记录', '调查失物主人时发现十年前档案被同一规则篡改', '短暂脱身换来记忆缺失，主角误伤一段重要关系', '主角用前面累积的证据反制封锁并逼出执行者'],
      keyChoiceAndCost: alternative ? '沈砚把自己听见失物遗言的秘密交给盟友验证，代价是失去独占线索和随时抽身的可能。' : '沈砚主动再触碰一次铜铃换取关键证词，代价是遗失与姐姐相处的一段真实记忆。',
      climaxResolution: alternative ? '多名普通人用各自保管的证据拆穿巡夜人的统一口径，沈砚在公开场合救回目击者并取得查档资格。' : '沈砚把此前分散的失物证词拼成同一条航路记录，在港口封锁最严时反向证明追捕者才是规则破坏者。',
      endingChange: alternative ? '沈砚从孤立嫌疑人变成有条件被港区居民支持的调查者，盟友也掌握了制约他的秘密。' : '沈砚洗清眼前罪名并拿到姐姐仍可能活着的证据，但失去的记忆让亲情目标出现新的空洞。',
      benefits: alternative ? ['群体协作与信任拉扯更强', '悬疑证据可以多线交汇'] : ['个人危机抓力直接', '能力代价与亲情目标紧密相扣'],
      risks: alternative ? ['多人物并行时要防止主角失去主动性'] : ['失忆代价不能沦为随用随丢的方便工具']
    },
    ...(volumeNumber === 1 ? {
      storySpine: {
        longTermPromise: '跟随沈砚破解一件件带着遗憾的失物，在规则反制与亲情真相中持续获得破局和情感兑现。',
        protagonistLongArc: '从只想找回姐姐的孤立记录员，成长为愿意承担记忆代价、保护他人选择权的新航路守门人。',
        centralQuestion: '当记忆可以被城市拿来维持秩序，一个人还能凭什么确认自己爱过谁、选择过什么？',
        escalationLadder: ['先查个人失踪与铜铃来源', '再触及港区档案和巡夜规则', '最终面对整座雾港以记忆维持航路的真相'],
        endingDirection: '终止以失踪者记忆维持航路的献祭规则，救回姐姐并建立可被监督的新规则。',
        protectedOpenSpace: ['姐姐这些年如何保持自我暂不提前解释', '更远航路与其他城市的规则留待后续卷结算后设计']
      },
      firstVolumeLaunch: {
        first500: {
          readerQuestion: '十年前失踪姐姐的铜铃为什么会在今夜重新响起？',
          immediateSituation: '暴雨夜所有失物同时发声，巡夜人破门而入并把沈砚认定为源头。',
          emotionalGrip: '沈砚既想抓住姐姐仍活着的希望，又害怕再次触碰铜铃会忘掉她。',
          changePromise: '一件普通失物将撕开雾港失踪案与记忆航路的隐藏规则。'
        },
        goldenThree: [
          { chapterNumber: 1, responsibility: '让主角与核心危机同时登场', action: '沈砚带着铜铃逃出招领处并留下可追查线索', pressure: '巡夜人封锁港区且铜铃持续夺走记忆', payoff: '主角用失物遗言识破第一次围堵', nextExpectation: '送来铜铃的人就在封锁区内' },
          { chapterNumber: 2, responsibility: '展示能力边界并兑现第一次小回报', action: '沈砚核验两件失物的矛盾证词', pressure: '每次触碰都会丢失自己的记忆', payoff: '他锁定一份被篡改的十年前档案', nextExpectation: '档案经手人正在被灭口' },
          { chapterNumber: 3, responsibility: '闭合开局小冲突并打开本卷目标', action: '沈砚在追捕中救下档案经手人', pressure: '救人会暴露能力和姐姐线索', payoff: '他反证自己不是异响源头并取得有限盟友', nextExpectation: '真正源头指向封闭航路' }
        ],
        majorClimax: {
          latestEffectiveCharacters: 90000,
          setup: '前三个事件累积失物证词、篡改档案和盟友立场，让封港行动成为无法回避的公开冲突。',
          choice: '沈砚必须在保留姐姐私人记忆与公开证据拯救更多失踪者之间作出选择。',
          cost: '他公开关键记忆后永久失去一段与姐姐相处的往事，并让能力秘密暴露。',
          irreversibleChange: '巡夜规则被撕开缺口，沈砚从被追捕者变成拥有有限查档资格的公开调查者。',
          nextStage: '卷末证据证明姐姐仍在更深航路中，下一阶段由第一卷结算后再设计。'
        },
        immersionPriorities: ['让读者先跟随沈砚感受追捕与记忆流失，再逐步理解规则', '每次破局都来自已见证据和人物选择，不靠敌人降智']
      }
    } : {}),
    boundaries: {
      mustAchieve: ['本卷核心危机必须得到可验证结果', '主角的选择必须造成后续可见变化'],
      mustNotViolate: ['不能用无来源的新能力或巧合解决高潮', '不能让人物忘记前面已经付出的代价'],
      creativeFreedom: ['事件内的具体场景、对白、局部反转和配角行动', '事件章数可随实际叙事密度调整'],
      openQuestions: ['下一卷介入势力的具体身份由事件结算后再确认']
    },
    ...(fusion ? {
      fusionNotes: {
        payoffDesign: '爽点设计说明：每个事件末尾各兑现一次可验证进展，卷末用反击兑现整卷积累，兑现前先让对手反制制造落差。',
        logicChain: '逻辑链说明：上一阶段胜利暴露后果，后果引来反制，反制逼出证据与立场选择，证据积累支撑卷末反击，因果环环相接。',
        freshness: '新鲜感说明：差异来自“胜利本身制造新问题”的结构和盟友有条件的共同决策，不靠新奇能力或巧合推进。'
      }
    } : {})
  });
}
function deterministicEventChain(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || root.operation !== 'event_chain_generation_v1') return null;
  const outputContract = isRecord(root.outputContract) ? root.outputContract : {};
  const chainContract = isRecord(outputContract.eventChain) ? outputContract.eventChain : {};
  const directionVersionId = typeof chainContract.volumeDirectionVersionId === 'string'
    ? chainContract.volumeDirectionVersionId : 'direction-fixture';
  const requiredCoverage = Array.isArray(root.requiredCoverage)
    ? root.requiredCoverage.filter((item): item is string => typeof item === 'string') : [];
  const firstResponsibilities = Array.isArray(root.firstVolumeResponsibilities)
    ? root.firstVolumeResponsibilities.filter((item): item is string => typeof item === 'string') : [];
  const availableStorylines = Array.isArray(root.availableStorylines)
    ? root.availableStorylines.filter(isRecord).map((item) => ({
      storylineId: typeof item.storylineId === 'string' ? item.storylineId : '',
      title: typeof item.title === 'string' ? item.title : '已确认故事线'
    })).filter((item) => item.storylineId.length > 0)
    : [];
  const skeletonFields = (index: number) => {
    const leading = availableStorylines.length === 0 ? null : availableStorylines[index % availableStorylines.length]!;
    const supporting = availableStorylines.length > 1 && index % 2 === 1
      ? [availableStorylines[(index + 1) % availableStorylines.length]!] : [];
    return {
      leadingStorylineId: leading?.storylineId ?? null,
      supportingStorylineIds: supporting.map((item) => item.storylineId),
      intersectionNote: supporting.length === 0 ? null : (leading?.title ?? '主导线') + '的选择改变' + supporting[0]!.title + '的推进条件。',
      roleFunctions: leading === null ? [] : [{ roleFunctionKey: 'event-' + (index + 1) + '-opposition', roleFunctionLabel: '对立功能承担者',
        requirement: '制造与本事件卷责任直接相关、可由人物行动回应的阻力。', importance: 'core' as const }]
    };
  };
  const nodes = [
    {
      nodeId: 'event-chain-1', order: 1, title: '异常迫使主角公开行动',
      volumeResponsibility: '承接开卷局面，让主角作出无法撤回的第一次选择。',
      entryState: '主角仍有退路，但异常事实已威胁最在意的人。',
      protagonistAction: '主角主动核验证据并公开采取行动。',
      oppositionEscalation: '维护旧秩序的人封锁消息并夺走主角的安全身份。',
      stagePayoffOrCost: '主角证实异常并救下一个人，同时暴露自己。',
      exitState: '异常被证实，主角失去退路并获得一名有条件的盟友。',
      leadsToNext: '对手利用主角暴露的身份反向追查盟友和证据。',
      ...skeletonFields(0),
      plantThreadIds: ['thread-core-secret'], payoffThreadIds: [],
      consequenceThreadIds: ['thread-exposed-identity'],
      firstVolumeResponsibilities: firstResponsibilities.filter((item) => ['opening_launch','golden_three'].includes(item))
    },
    {
      nodeId: 'event-chain-2', order: 2, title: '第一次回报引来反制',
      volumeResponsibility: '兑现早期回报，并把局部胜利变成更难处理的现实问题。',
      entryState: '主角有证据和盟友，但身份已经暴露。',
      protagonistAction: '主角用已有证据争取公开验证。',
      oppositionEscalation: '对手制造一份更可信的假证据并迫使盟友表态。',
      stagePayoffOrCost: '主角拆穿一层假象，却伤害了关键关系。',
      exitState: '主角保住证据，但盟友不再无条件信任他。',
      leadsToNext: '关系裂痕让对手有机会切断证据链，主角必须改变路径。',
      ...skeletonFields(1),
      plantThreadIds: ['thread-relationship-debt'], payoffThreadIds: [],
      consequenceThreadIds: ['thread-trust-fracture'],
      firstVolumeResponsibilities: firstResponsibilities.filter((item) => item === 'early_payoff')
    },
    {
      nodeId: 'event-chain-3', order: 3, title: '改变路径后逼近真相',
      volumeResponsibility: '升级冲突和情绪拉扯，让主角的选择真正改变关系与局面。',
      entryState: '证据链将断，盟友对主角的做法产生怀疑。',
      protagonistAction: '主角放弃独占线索，允许盟友共同验证并承担失败责任。',
      oppositionEscalation: '对手转而攻击普通参与者并封锁公开渠道。',
      stagePayoffOrCost: '多人保住关键证据，但主角付出资源和信任代价。',
      exitState: '证据由多人掌握，冲突从个人追捕升级为公开规则之争。',
      leadsToNext: '公开证据迫使真正执行者提前发动最后封锁。',
      ...skeletonFields(2),
      plantThreadIds: ['thread-public-proof'], payoffThreadIds: ['thread-trust-fracture'],
      consequenceThreadIds: ['thread-open-conflict'],
      firstVolumeResponsibilities: firstResponsibilities.filter((item) => item === 'conflict_and_emotion_escalation')
    },
    {
      nodeId: 'event-chain-4', order: 4, title: '高潮前的选择与蓄力',
      volumeResponsibility: '完成高潮所需铺垫，并逼主角确认愿意支付的代价。',
      entryState: '真相已有公开可能，但最后封锁会让所有参与者受损。',
      protagonistAction: '主角组织证据分散保管，并坦白自己的能力边界。',
      oppositionEscalation: '对手扣押目击者并要求主角用核心秘密交换。',
      stagePayoffOrCost: '盟友重新选择同行，但主角必须放弃一段珍贵记忆。',
      exitState: '证据、关系与代价全部到位，主角拥有发动最后行动的条件。',
      leadsToNext: '交换期限到来，主角只能在保全私人记忆和公开真相之间选择。',
      ...skeletonFields(3),
      plantThreadIds: [], payoffThreadIds: ['thread-relationship-debt'],
      consequenceThreadIds: ['thread-memory-cost'],
      firstVolumeResponsibilities: firstResponsibilities.filter((item) => item === 'climax_setup')
    },
    {
      nodeId: 'event-chain-5', order: 5, title: '兑现承诺并进入新局',
      volumeResponsibility: '完成卷高潮、兑现主要承诺，并留下不可逆后果和下一阶段入口。',
      entryState: '主角已具备行动条件，也清楚胜利会失去什么。',
      protagonistAction: '主角支付既定代价，利用全卷累积的证据和关系公开破局。',
      oppositionEscalation: '对手启动最后封锁并迫使所有人公开站队。',
      stagePayoffOrCost: '核心问题得到可验证解决，主角身份、关系和资源发生不可逆变化。',
      exitState: '本卷问题已解决，新势力因力量平衡改变而进入局面。',
      leadsToNext: null,
      ...skeletonFields(4),
      plantThreadIds: ['thread-next-stage'], payoffThreadIds: ['thread-core-secret','thread-public-proof'],
      consequenceThreadIds: ['thread-irreversible-status'],
      firstVolumeResponsibilities: firstResponsibilities.filter((item) => ['major_climax_before_100k','climax_consequence'].includes(item))
    }
  ];
  return JSON.stringify({
    eventChain: {
      volumeDirectionVersionId: directionVersionId,
      events: nodes,
      coverage: requiredCoverage.map((responsibility, index) => ({
        responsibility,
        eventNodeIds: [nodes[Math.min(nodes.length - 1, Math.floor(index * nodes.length / Math.max(1, requiredCoverage.length)))]!.nodeId],
        status: 'covered'
      }))
    }
  });
}

function deterministicStoryEvent(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || root.operation !== 'story_event_generation_v1') return null;
  const seat = isRecord(root.seat) ? root.seat : {};
  const roleKey = typeof seat.roleKey === 'string' ? seat.roleKey : 'lead_screenwriter';
  const fusion = seat.mode === 'chief_editor_fusion';
  const alternative = roleKey === 'second_screenwriter';
  const title = fusion ? '代价之后的新入口' : alternative ? '盟友提出的第三条路' : '胜利留下的缺口';
  const mainChoice = alternative
    ? '主角放弃最省力的正面对抗，接受盟友带有条件的合作，并公开承担合作失败的责任'
    : '主角主动放弃短期收益，以已有证据和关系换取一次风险更高但可持续的行动机会';
  return JSON.stringify({
    title,
    volumeResponsibility: '把本卷当前阶段的局部进展转化为必须处理的现实矛盾，并推动人物向卷高潮迈进一步',
    startingState: '主角刚取得有限进展，但旧秩序留下的责任、关系裂痕和未知威胁同时压来',
    trigger: '上一事件的结果暴露出一项无法继续回避的后果，迫使主角立即选择立场',
    participants: ['主角', alternative ? '立场摇摆的盟友' : '掌握关键证据的同伴', '维护旧秩序的对手'],
    characterGoals: ['主角要守住已取得的行动资格', '同伴要验证主角是否值得继续信任', '对手要把局部进展解释成主角的失误'],
    obstacles: ['证据不足以直接定论', '盟友的信任附带条件', '主角现有能力无法无代价解决冲突'],
    choicesAndCosts: [mainChoice, '主角若坚持目标，就必须失去一条轻松退路，并让关系承担可见后果'],
    informationMoves: ['先确认表面危机并非偶然', '再发现危机背后存在可追查的利益关系', '结尾只揭开更大问题的一层入口'],
    localProgression: ['后果落地，主角不能再旁观', '第一次方案受挫并暴露人物分歧', '主角修正判断，作出带代价的选择', '局部目标完成，但新状态触发下一事件'],
    requiredResult: '本事件结束时必须产生可验证的状态变化，主角获得有限主动权，同时承担下一阶段会继续生效的代价',
    flexibleExecution: ['具体场景地点和对话方式', '配角采取行动的局部顺序', '不改变核心因果的惊喜与误判'],
    endingConditions: ['事件核心问题得到有限解决', '人物关系因选择发生可见变化', '下一事件的触发条件已经在行动结果中形成'],
    nextEventImpact: '受到局部结果影响的一方开始反制，并利用主角刚暴露的软肋制造新的必然冲突',
    characterArcImpact: '主角从证明自己转向承担选择后果，关键同伴从被动协助转向有条件的共同决策',
    volumeClimaxImpact: '为卷高潮积累可使用的证据、关系和代价，避免最终胜利依靠临时能力或巧合',
    estimatedChapterRange: { minimum: 5, likely: 8, maximum: 12 },
    uncertaintyNotes: fusion ? ['融合方案仍需作者确认具体对手身份与场景表达'] : ['若需要新增核心能力、道具或人物身份，必须先由作者确认'],
    ...(fusion ? {
      fusionNotes: {
        payoffDesign: '爽点设计说明：在事件后段兑现一次带代价的局部胜利，结尾用对手反制留下新的期待缺口。',
        logicChain: '逻辑链说明：上一事件后果触发选择，选择带来代价，代价换来证据与关系，证据与关系直接支撑下一事件。',
        freshness: '新鲜感说明：差异来自盟友附带条件的合作与主角公开担责，而不是常规的正面对抗升级。'
      }
    } : {})
  });
}


function deterministicEventChapterSequence(prompt: string): string | null {
  const root = parseOperation(prompt, 'event_chapter_sequence_generation_v1');
  if (root === null) return null;
  const event = parsedSource(root, 'planning:story_event');
  if (!isRecord(event)) return null;
  const start = typeof root.startChapterNumber === 'number' && Number.isInteger(root.startChapterNumber)
    ? root.startChapterNumber : 1;
  const title = textValue(event.title, '当前事件');
  const opening = textValue(event.startingState, '人物正站在当前事件的起点');
  const required = textValue(event.requiredResult, '事件产生可验证的状态变化');
  const nextImpact = textValue(event.nextEventImpact, '结果自然触发下一事件');
  const conditions = textArray(event.endingConditions, [required]);
  const localProgression = textArray(event.localProgression, []);
  const estimatedRange = isRecord(event.estimatedChapterRange) ? event.estimatedChapterRange : {};
  const likelyCount = typeof estimatedRange.likely === 'number' && Number.isInteger(estimatedRange.likely)
    && estimatedRange.likely >= 1 && estimatedRange.likely <= 50 ? estimatedRange.likely : 3;
  const titles = title.includes('试剑台')
    ? ['生死状锁命', '药钱被扣', '废阵藏刃', '剑修拦路', '第一次布阵', '阿九的价码', '封阵区取证', '公议坪反咬', '旧台决战', '救人后反杀']
    : title.includes('黑风猎场')
      ? ['猎场错传', '赤松谷夺旗', '裂石涧接应', '废矿分队', '救人碎阵盘', '无阵盘反制', '阵眼取黑账', '出口反追杀', '主峰破封山阵', '祭旗台见真章']
      : ['后果落地', '第一条线索', '阻力现身', '判断受挫', '代价兑现', '主动修正', '证据合流', '反制逼近', '最后选择', '局面改写'];
  const phaseTitleMap = [
    ['压力落到主角身上并迫使表态', '局势逼人'],
    ['确认规则与第一处异常', '异常初现'],
    ['让同伴主动加入并提出不同判断', '队友异议'],
    ['第一次执行受阻并暴露真实代价', '首战受阻'],
    ['对手根据主角行动调整策略', '对手变招'],
    ['队伍因目标差异发生分歧', '队内分歧'],
    ['用可核验证据找到新路径', '证据破局'],
    ['付出代价完成中段反制', '代价反制'],
    ['多名角色并行完成决战准备', '决战并行'],
    ['兑现事件结果并形成下一事件接口', '结果兑现']
  ] as const;
  const progressionTitles = localProgression.map((step, index) => {
    const firstPhrase = step.trim().split(/[，。；：:!?！？]/u)[0]?.replace(/\s+/gu, '') ?? '';
    const phase = phaseTitleMap.find(([suffix]) => firstPhrase.endsWith(suffix));
    if (phase !== undefined) {
      const prefix = firstPhrase.slice(0, -phase[0].length).slice(0, 6);
      return prefix.length > 0 ? `${prefix}·${phase[1]}` : phase[1];
    }
    const readable = firstPhrase.length > 0 ? firstPhrase : titles[index] ?? ('推进与代价·' + (index + 1));
    return readable.length <= 12 ? readable : readable.slice(0, 12);
  });
  const chapters = [];
  let previousState = opening;
  for (let index = 0; index < likelyCount; index += 1) {
    const chapterNumber = start + index;
    const finalChapter = index === likelyCount - 1;
    const endingState = finalChapter
      ? required
      : '人物完成事件第' + (index + 1) + '步行动，获得有限进展，同时暴露下一步必须处理的阻力与代价';
    chapters.push({
      chapterNumber,
      title: progressionTitles[index] ?? titles[index] ?? ('推进与代价·' + (index + 1)),
      eventResponsibility: index === 0
        ? '让事件触发条件真正落地，并让人物不能继续旁观'
        : finalChapter
          ? '完成事件必须得到的结果，并形成下一事件的接口'
          : '推进事件第' + (index + 1) + '项因果责任，让进展、阻力和人物代价同步升级',
      openingState: previousState,
      characterGoals: ['主角要在现有能力和关系边界内推进当前目标'],
      conflicts: ['对手与现实限制同时阻止主角取得无代价的胜利'],
      choicesAndCosts: ['主角必须放弃一条轻松退路，换取可持续的推进机会'],
      informationChanges: [finalChapter ? '事件核心事实得到验证，但更大的后果开始显现' : '新证据改变人物对当前阻力的判断'],
      storyBeats: ['状态变化落地', '行动遭遇有效阻力', '人物作出带代价的选择', '结果改变下一步条件'],
      endingState,
      nextChapterInterface: finalChapter ? nextImpact : endingState,
      softSuggestions: ['具体场景、对话和局部反转可由写作阶段依据人物即时反应调整'],
      creativeFreedom: ['场景调度、语言节奏、人物微反应与不破坏因果链的合理惊喜']
    });
    previousState = endingState;
  }
  return JSON.stringify({
    eventTitle: title,
    startChapterNumber: start,
    chapters,
    eventEndingConditions: conditions,
    closureCoverage: conditions.map((endingCondition) => ({
      endingCondition,
      evidenceChapterNumber: start + chapters.length - 1
    })),
    flexibilityNotes: ['章节数量和局部节拍可在尚未冻结时根据实际叙事密度调整']
  });
}

function deterministicEventChapterDetails(prompt: string): string | null {
  const root = parseOperation(prompt, 'event_chapter_detail_generation_v1');
  if (root === null) return null;
  const sequence = parsedSource(root, 'planning:event_chapter_sequence');
  const planned = isRecord(sequence) && Array.isArray(sequence.targetChapters)
    ? sequence.targetChapters.filter(isRecord)
    : [];
  const numbers = Array.isArray(root.chapterNumbers)
    ? root.chapterNumbers.filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
    : [];
  const outlines = numbers.map((chapterNumber) => {
    const slot = planned.find((item) => item.chapterNumber === chapterNumber) ?? {};
    const title = textValue(slot.title, '推进中的选择');
    const openingState = textValue(slot.openingState, '承接上一章已经发生的状态变化');
    const endingState = textValue(slot.endingState, '本章行动形成可验证的新状态');
    const chapterFunction = textValue(slot.eventResponsibility, '推进当前事件的一项明确责任');
    const nextInterface = textValue(slot.nextChapterInterface, endingState);
    return {
      outlineSchema: 'chapter_outline_v2',
      chapterNumber,
      title,
      sourceStage: { stageNumber: 1, title: '当前事件', chapterRange: { start: chapterNumber, end: chapterNumber } },
      chapterFunction,
      openingState,
      requiredEndingState: endingState,
      cast: [{
        name: '主角',
        objective: '在既有约束下完成本章目标',
        knowledgeBoundary: '只知道当前已经获得的证据，不预知后续真相',
        chapterRole: '作出推动因果链的关键选择',
        stateChange: '因本章选择承担新的代价或获得有限主动权'
      }],
      conflict: {
        surface: textArray(slot.conflicts, ['当前阻力直接阻止目标完成']).join('；'),
        underlying: '人物想得到结果，却不能回避选择带来的真实代价',
        oppositionGoal: '迫使主角退出或接受不利条件',
        failureCost: '失去当前行动机会并损害关键关系',
        successCost: '即使推进成功也必须暴露弱点或承担承诺'
      },
      plotBeats: [
        { order: 1, trigger: openingState, action: '人物确认眼前最急迫的问题并开始行动', resistance: '已有条件不足以直接解决问题', result: '行动目标和风险被具体化' },
        { order: 2, trigger: '第一次行动没有得到预期结果', action: '人物依据新信息修正办法', resistance: '对手或环境抓住人物的限制反制', turn: '一个已存在但被忽略的条件改变判断', result: '人物被迫在两种代价之间选择' },
        { order: 3, trigger: '退路被压缩到不能继续拖延', action: '人物作出符合性格与当前目标的选择', resistance: '选择立即产生可见损失', result: endingState }
      ],
      experience: {
        primaryTone: '逐步加压后释放有限回报',
        emotionalCurve: ['警觉', '受阻', '权衡', '决断', '余波'],
        payoffPoints: ['人物用行动兑现此前建立的能力或关系'],
        pressurePoints: ['成功不能抹去已经付出的代价'],
        readerEffect: '既得到本章推进，也愿意追看选择造成的后果'
      },
      descriptionFocus: {
        primary: ['关键选择发生时的人物动作与反应'],
        secondary: ['场景中能够成为证据或阻力的具体细节'],
        compress: ['重复解释已经明确的设定和目标']
      },
      informationControl: {
        reveals: textArray(slot.informationChanges, ['揭示足以改变当前判断的一项信息']),
        concealed: ['暂不提前说明下一事件的完整答案'],
        gaps: ['保留人物尚未验证的推断']
      },
      threadActions: [],
      ending: {
        result: endingState,
        stateChanges: [endingState],
        hook: nextInterface,
        nextChapterInterface: nextInterface
      },
      mustImplement: [chapterFunction, endingState],
      mustNotViolate: ['不得凭空增加解决冲突的核心能力、道具或身份', '不得让人物无代价撤回已经作出的关键选择'],
      allowedCandidates: ['局部场景顺序、配角反应和表达方式可形成候选'],
      creativeFreedom: textArray(slot.creativeFreedom, ['对话、动作、意象、节奏和局部合理惊喜'])
    };
  });
  return JSON.stringify({ outlines });
}

function deterministicEventChapterChallenge(prompt: string): string | null {
  const root = parseOperation(prompt, 'event_chapter_challenge_v1');
  if (root === null) return null;
  const targetKind = root.targetKind === 'detail' ? 'detail' : 'sequence';
  const targetId = textValue(root.targetId, targetKind === 'sequence' ? '当前章链' : '当前单章');
  const targetVersionId = textValue(root.targetVersionId, '当前候选版本');
  const suggestions = targetKind === 'sequence' ? [
    { focus: 'turning_point', alternative: '把中段第一次受阻改成主角主动试错：他故意让对手看到一半计划，借对方的反制验证真正漏洞。', benefit: '转折来自人物判断和行动，主角会更主动，前后因果也更紧。', tradeoff: '主角必须承担盟友误解和部分证据暴露的风险，不能无代价成功。', downstreamImpact: '后续章节需要让盟友质疑主角，并让对手利用暴露的信息升级反制。' },
    { focus: 'ending_hook', alternative: '事件收束时先兑现局部胜利，再让被救下的证人说出一个与现有判断相反的细节。', benefit: '读者能得到本事件的回报，同时自然产生追看下一事件的疑问。', tradeoff: '新细节只能推翻人物判断，不能推翻已经确认的事实，否则会显得强行反转。', downstreamImpact: '下一事件需要先核验证人的说法，并处理主角因公开行动留下的身份风险。' }
  ] : [
    { focus: 'core_conflict', alternative: '让本章冲突不只来自外部阻拦，而是让同伴提出一条更安全却会牺牲无辜者的办法，逼主角当场表态。', benefit: '人物选择会推动剧情，冲突也能同时体现关系与价值观。', tradeoff: '必须给同伴合理动机，不能把他写成只为抬高主角的工具人。', downstreamImpact: '下一章要承接这次分歧，关系不能在结尾自动恢复。' },
    { focus: 'ending_hook', alternative: '章末不再只写敌人逼近，而是让主角发现自己刚保住的证据缺了一页，而且缺失处留下熟悉人物的痕迹。', benefit: '钩子更具体，能把外部危机和人物关系连在一起。', tradeoff: '熟悉人物的痕迹必须来自既有信息，不能临时新增身份或能力。', downstreamImpact: '下一章需要先确认痕迹真伪，再决定是否公开质疑对方。' }
  ];
  return JSON.stringify({
    targetKind, targetId, targetVersionId,
    summary: targetKind === 'sequence' ? '这条章链最值得再看的，是中段转折是否足够由人物主动选择推动。' : '这一章最值得再看的，是核心冲突和章末钩子能否同时推动人物关系。',
    suggestions
  });
}

function parseOperation(prompt: string, operation: string): Record<string, unknown> | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  return isRecord(root) && root.operation === operation ? root : null;
}

function parsedSource(root: Record<string, unknown>, sourceType: string): unknown {
  if (!Array.isArray(root.sources)) return null;
  const source = root.sources.find((item) => isRecord(item) && item.sourceType === sourceType);
  if (!isRecord(source) || typeof source.content !== 'string') return null;
  try { return JSON.parse(source.content) as unknown; } catch { return null; }
}

function textValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function textArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
  return items.length > 0 ? items : fallback;
}

function deterministicStageOutlineWorkflow(prompt: string): string | null {
  if (
    prompt.includes('正在为本书当前剧情阶段独立设计候选方案')
    && prompt.includes('只提交1个你真正推荐的独立候选')
  ) {
    const fields = deterministicDiscussionReply().fields;
    const variants = [
      '危机接管型：主角被迫接手一个即将崩溃的局面，先发现表面损失，再追到规则漏洞；中段首次方案失败并付出关系代价，最终靠重新分配责任守住底线。建议18—24章，满足点是夺回主动权，压力来自信任破裂，并埋下幕后受益者线索。',
      '身份误判型：众人把主角当成最不可能解决问题的人，她利用信息差逐步验证真因；中段因错误判断失去关键盟友，随后公开承担责任完成反转。建议15—20章，满足点是认知翻盘，虐点是被亲近者误解，伏笔指向一份被改写的旧记录。',
      '有限合作型：两个目标相反的人因共同危机短暂结盟，合作每推进一步都会暴露新的利益冲突；高潮不是彻底和解，而是在明确代价后完成一次可信选择。建议20—28章，满足点是强强协作，压力来自互不信任，结尾保留下一阶段可追查的第三方证据。'
    ];
    const digest = createHash('sha256').update(prompt).digest('hex');
    fields.answer = variants[Number.parseInt(digest.slice(0, 2), 16) % variants.length] ?? variants[0]!;
    fields.keyPoints = [];
    fields.alternatives = [];
    fields.risks = [];
    fields.questions = [];
    fields.nextStep = '看看三个人写出的不同走向，选一个，或告诉主编要把哪几部分合在一起';
    fields.details = '';
    return JSON.stringify({ version: 1, format: 'json_object', fields });
  }
  if (prompt.includes('workflowArtifact 使用 schema=stage_master_v2')) {
    const fields = deterministicDiscussionReply().fields;
    fields.answer = '我已经把你选中的内容合成这一阶段的剧情大纲：故事从哪里开始，中间怎么出事，最后人物得到什么结果都写清了。确认后不会马上写章纲或正文。';
    fields.keyPoints = ['这一段最多写50章', '这一阶段会解决眼前这件事，同时留下下一阶段要接的线索'];
    fields.alternatives = [];
    fields.risks = [];
    fields.questions = [];
    fields.nextStep = '请确认当前阶段剧情总纲';
    fields.details = '';
    (fields as Record<string, unknown>).workflowArtifact = {
      type: 'master_outline',
      payload: deterministicMasterOutline()
    };
    return JSON.stringify({ version: 1, format: 'json_object', fields });
  }
  return null;
}

function deterministicContinuationAnalysis(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || root.operation !== 'continuation_chapter_analysis_v1') return null;
  const source = typeof root.content === 'string' ? root.content.trim() : '';
  const chapter = isRecord(root.chapter) ? root.chapter : {};
  const chapterTitle = typeof chapter.title === 'string' ? chapter.title : '本章';
  const compact = source.replace(/\s+/gu, ' ').slice(0, 320);
  return JSON.stringify({
    summary: compact.length > 0 ? `${chapterTitle}：${compact}` : `${chapterTitle}暂无可提炼正文。`,
    characters: [],
    events: compact.length > 0 ? [{ event: chapterTitle, result: compact.slice(0, 180), evidence: compact.slice(0, 80) }] : [],
    locations: [],
    relations: [],
    rules: [],
    resources: [],
    openThreads: [],
    resolvedThreads: [],
    styleEvidence: compact.length > 0 ? [compact.slice(0, 120)] : [],
    endingState: compact.slice(-160),
    reverseOutline: {
      chapterGoal: compact.length > 0 ? `推进“${chapterTitle}”中已经发生的核心事件` : '原文不足，无法提炼本章目标',
      openingState: compact.slice(0, 100),
      plotBeats: compact.length > 0 ? [{ order: 1, action: compact.slice(0, 120), result: compact.slice(-120) }] : [],
      cast: [],
      centralConflict: compact.length > 0 ? '人物需要面对本章已经出现的新事实或阻力' : '',
      emotionalArc: compact.length > 0 ? ['察觉', '应对'] : [],
      payoffOrPressure: [],
      threadActions: [],
      descriptionFocus: compact.length > 0 ? ['本章核心事件'] : [],
      ending: {
        result: compact.slice(-120),
        hook: '',
        nextChapterInterface: compact.slice(-120)
      }
    },
    conflicts: [],
    unknowns: []
  });
}

function deterministicSettingGuidance(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || !['设定逐项引导', '设定' + '大纲逐项引导'].includes(String(root.operation)) || !isRecord(root.settingGuidance)) return null;
  const guidance = root.settingGuidance;
  const label = typeof guidance.label === 'string' ? guidance.label : '当前设定项';
  const itemKey = typeof guidance.itemKey === 'string' ? guidance.itemKey : 'unknown';
  const phase = guidance.phase;
  const feedbackMode = guidance.feedbackMode;
  const dissatisfactionRound = typeof guidance.dissatisfactionRound === 'number' ? guidance.dissatisfactionRound : 0;
  const fields: Record<string, unknown> = {
    answer: phase === 'ask' && itemKey === 'creative-concept'
      ? '推荐把这本书写成：人在外部记录与真实记忆冲突时，仍要靠自己的选择守住身份与关系。'
      : phase === 'ask'
        ? `根据当前开书信息，我建议先把“${label}”确定为一个简洁、可修改的版本，不延伸到剧情。`
      : feedbackMode === 'replace_direction' || (feedbackMode === 'vague_dissatisfaction' && dissatisfactionRound >= 2)
        ? `我换了一条明显不同的“${label}”方向，不沿用上一版的核心说法。`
        : feedbackMode === 'vague_dissatisfaction'
          ? `上一版不够贴合，我已经直接收紧重点，给出一个更具体的“${label}”候选。`
          : `我只合并了您指出的修改，保留“${label}”中未被否定的部分。`,
    keyPoints: [],
    alternatives: [],
    risks: [],
    questions: phase === 'revise' && ['vague_dissatisfaction', 'replace_direction'].includes(String(feedbackMode)) && dissatisfactionRound <= 2
      ? []
      : phase === 'ask' && itemKey === 'creative-concept'
      ? ['是否按这个确定？']
      : phase === 'ask' ? ['是否按这个确定？如需调整，直接告诉我修改哪一点。'] : ['这项是否按这个版本确认？如需调整，直接告诉我修改哪一点。'],
    nextStep: phase === 'ask' && itemKey === 'creative-concept'
      ? '回复“确认”，或直接说要修改哪一点'
      : phase === 'ask' ? '回复“确认”，或直接说要修改哪一点' : '回复“确认”后进入下一项设定',
    details: null
  };
  if (typeof phase === 'string') {
    const currentMessage = typeof root.currentMessage === 'string' ? root.currentMessage.trim() : '';
    const content = phase === 'ask' && itemKey === 'creative-concept'
      ? '通过外部记录与真实记忆的冲突，探讨人在被操控和怀疑中如何守住自我与重要关系，让读者获得悬疑推进中的共情、紧张与双向救赎。'
      : itemKey === 'creative-concept'
        ? '以人物在真相揭开后的主动选择推动双向救赎，探讨信任如何承受欺骗与控制，让读者同时获得现实共鸣、关系张力和悬疑反转。'
      : phase === 'ask'
        ? `${label}先按现在这本书最需要的内容来定，写清人物能做什么、不能做什么，其他细节以后遇到剧情时再补。`
      : feedbackMode === 'replace_direction' || (feedbackMode === 'vague_dissatisfaction' && dissatisfactionRound >= 2)
        ? `${label}改为采用与上一版核心机制明显不同、但仍符合本书定位的新方向。`
      : feedbackMode === 'vague_dissatisfaction'
        ? `${label}重新聚焦本书最独特的矛盾与读者体验，删去空泛表达，形成更具体的候选。`
      : currentMessage.length >= 8
      ? currentMessage.slice(0, 1_000)
      : `${label}按老板本轮说明确定为：${currentMessage || '保持简洁并等待进一步补充'}。`;
    fields.workflowArtifact = {
      type: 'setting_outline',
      payload: { items: [{ itemKey, content }] }
    };
  }
  return JSON.stringify({ version: 1, format: 'json_object', fields });
}

function deterministicDiscussion(prompt: string): string | null {
  if (prompt.includes('【整份设定质检资料包】')) {
    const base = deterministicDiscussionReply();
    Object.assign(base.fields, {
      verdict: 'pass',
      summary: '四项核心设定彼此不冲突，边界清楚且保留了后续卷与事件的创作空间。',
      issues: []
    });
    return JSON.stringify(base);
  }
  const settingProposalMatch = prompt.match(/正在参加本书“([^”]+)”独立提案/u);
  if (settingProposalMatch !== null) {
    const base = deterministicDiscussionReply();
    const itemLabel = settingProposalMatch[1] ?? '当前设定项';
    base.fields.answer = itemLabel === '策划理念'
      ? '用一段必须付出真实代价的双向救赎，讨论人在被欺骗后是否仍能自主选择信任，让读者既获得现实共鸣，也持续期待关系真相被逐层揭开。'
      : `${itemLabel}先写清读者会看到什么、人物会怎么受影响；现在只定必要内容，不把后面的剧情提前写死。`;
    base.fields.keyPoints = [];
    base.fields.alternatives = [];
    base.fields.risks = [];
    base.fields.questions = [];
    base.fields.nextStep = '等待作者选择、组合或提交自己的版本';
    base.fields.details = '';
    const sentences = String(base.fields.answer).split('。')
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length >= 4);
    while (sentences.length < 3) sentences.push(`${itemLabel}的其余细节随剧情需要再补，不提前写死`);
    const proposalFields = base.fields as typeof base.fields & {
      benefits?: string[];
      costs?: string[];
      fragments?: Array<{ fragmentNo: number; text: string }>;
    };
    proposalFields.benefits = [`让“${itemLabel}”直接支撑本书的核心看点`, '作者确认后全组按同一口径执行'];
    proposalFields.costs = ['确认后后续设定与剧情必须与它保持一致', '写得太满会压缩后续创作空间，所以只定必要部分'];
    proposalFields.fragments = sentences.slice(0, 3)
      .map((sentence, index) => ({ fragmentNo: index + 1, text: `${sentence}。` }));
    return JSON.stringify(base);
  }
  if (['【设定成组讨论资料包】', '【设定' + '大纲成组讨论资料包】'].some((marker) => prompt.includes(marker))) {
    const itemsLine = prompt.match(/本批设定项JSON：([^\n]+)/u)?.[1];
    let items: Array<{ itemKey: string; label?: string }> = [];
    try {
      const parsed = JSON.parse(itemsLine ?? '[]') as unknown;
      if (Array.isArray(parsed)) {
        items = parsed.filter((item): item is { itemKey: string; label?: string } => (
          isRecord(item) && typeof item.itemKey === 'string'
        ));
      }
    } catch {
      items = [];
    }
    const authorText = prompt.match(/作者本轮原话：([^\n]+)/u)?.[1]?.trim() ?? '';
    const base = deterministicDiscussionReply();
    base.fields.answer = '已按作者选中的独立方案和补充，整理为一份可确认的当前设定。';
    const fields = base.fields as typeof base.fields & {
      workflowArtifact?: { type: 'setting_outline'; payload: { items: Array<{ itemKey: string; content: string }> } };
      fusionSegments?: Array<{ text: string; source: string; fragmentId?: string; memberName?: string }>;
    };
    fields.workflowArtifact = {
      type: 'setting_outline',
      payload: {
        items: items.map((item) => ({
          itemKey: item.itemKey,
          content: authorText.length >= 8
            ? authorText.slice(0, 2_000)
            : `${item.label ?? item.itemKey}以本书开书信息、作者约束和已经确认的前置设定为边界，保留后续剧情的创作空间。`
        }))
      }
    };
    const fragmentsLine = prompt.match(/作者勾选的碎片：([^\n]+)/u)?.[1];
    let selectedFragments: Array<{ fragmentId?: unknown; memberName?: unknown; text?: unknown }> = [];
    try {
      const parsed = JSON.parse(fragmentsLine ?? '[]') as unknown;
      if (Array.isArray(parsed)) selectedFragments = parsed as typeof selectedFragments;
    } catch {
      selectedFragments = [];
    }
    const usableFragments = selectedFragments.filter((fragment) => (
      typeof fragment.fragmentId === 'string' && typeof fragment.text === 'string'
    ));
    if (usableFragments.length > 0) {
      fields.fusionSegments = [
        ...usableFragments.map((fragment) => ({
          text: fragment.text as string,
          source: 'fragment',
          fragmentId: fragment.fragmentId as string,
          ...(typeof fragment.memberName === 'string' ? { memberName: fragment.memberName } : {})
        })),
        { text: '以上按作者勾选的碎片融合为一项设定，衔接处由主编补写。', source: 'stitch' }
      ];
    }
    return JSON.stringify(base);
  }
  if (!prompt.includes('小说创作问题') && !prompt.includes('当前书籍的活动主编')) return null;
  // 主编汇总提示词会携带两名编剧已经提交的“章节跨度估算”。如果先按
  // 这个短语分支，适配器会误把编剧的中间产物当成主编最终答复，导致正式
  // 章纲合同缺失。最终落库合同必须优先于上下文里出现的中间产物。
  if (prompt.includes('章纲V2落库结构')) {
    const base = deterministicDiscussionReply();
    base.fields.details = `规划落库 ${JSON.stringify(deterministicChapterOutlines(prompt))}`;
    return JSON.stringify(base);
  }
  if (prompt.includes('章节跨度估算')) {
    return [
      '建议用三章完成当前滚动推进：第一章建立选择，第二章放大代价，第三章兑现转折。',
      '章节跨度估算 {"minimum":3,"recommended":3,"maximum":3,"units":[{"unit":"建立选择","suggestedChapters":1},{"unit":"放大代价","suggestedChapters":1},{"unit":"兑现转折","suggestedChapters":1}],"assumptions":["上游设定与剧情总纲已经确认"],"uncertainty":["具体场景仍由主笔创作"]}'
    ].join('\n');
  }
  const base = deterministicDiscussionReply();
  if (prompt.includes('现在进行且仅进行一次交叉质疑')) {
    base.fields.answer = '对方方案的阶段因果能够成立，但需要检查阶段结果是否真正成为下一阶段起点，并为未回收伏笔留下明确承接位置。';
    base.fields.keyPoints = ['保留两套方案真正不同的阶段升级方式', '检查章节范围连续性和阶段结果'];
    base.fields.risks = ['阶段结论若不改变人物处境，后续会变成重复升级'];
    base.fields.nextStep = '由主编只基于两份完整方案和本轮质疑形成阶段总纲';
    return JSON.stringify(base);
  }
  if (prompt.includes('剧情总纲落库')) {
    base.fields.details = `剧情总纲落库 ${JSON.stringify(deterministicMasterOutline())}`;
  } else if (prompt.includes('规划落库')) {
    base.fields.details = `规划落库 ${JSON.stringify(deterministicChapterOutlines(prompt))}`;
  }
  return JSON.stringify(base);
}

function deterministicDiscussionReply(): {
  version: number;
  format: string;
  fields: {
    answer: string;
    keyPoints: string[];
    alternatives: unknown[];
    risks: string[];
    questions: string[];
    nextStep: string;
    details: string;
  };
} {
  return {
    version: 1,
    format: 'json_object',
    fields: {
      answer: '这一阶段已经整理好了：人物先碰上麻烦，再作出选择，最后承担这个选择带来的结果。你点头后，我们再往下拆每一章。',
      keyPoints: ['人物做出的选择会真的改变后面的局面', '你没有确认的内容只放在这里讨论，不会当成已经发生的故事'],
      alternatives: [],
      risks: ['还要看这条剧情是否符合你想要的题材味道，人物反应也不能写得不像本人'],
      questions: [],
      nextStep: '你确认这一阶段后，再开始拆分章纲',
      details: ''
    }
  };
}

function deterministicChapterOutlines(prompt: string): Record<string, unknown> {
  const range = prompt.match(/本次只能规划第(\d+)章至第(\d+)章，共(\d+)章/u);
  const first = range === null ? 1 : Number.parseInt(range[1]!, 10);
  const count = range === null ? 3 : Math.max(1, Math.min(3, Number.parseInt(range[3]!, 10)));
  const chapters = Array.from({ length: count }, (_, index) => {
    const chapterNumber = first + index;
    return {
      chapterNumber,
      title: index === 0 ? '必须作出的选择' : index === 1 ? '代价开始兑现' : '阶段结果落地',
      chapterFunction: index === 0
        ? '迫使主角在两种有代价的方案中作出明确选择'
        : index === 1 ? '让上一章的选择产生不可忽略的具体代价' : '让主角承担代价并取得有限成果',
      openingState: index === 0 ? '现实限制已经暴露，但主角尚未表态' : '上一章的选择已经生效',
      requiredEndingState: index === 0 ? '主角完成选择并承担第一项责任' : '本章代价或成果已经改变下一步局面',
      cast: [{
        name: '主角',
        objective: '推动当前阶段目标并守住核心底线',
        knowledgeBoundary: '只知道已经验证的当前信息，不知道幕后真相',
        chapterRole: '主动选择并承担结果'
      }],
      conflict: {
        surface: '现实限制阻止主角直接达成目标',
        underlying: '短期收益与长期责任互相冲突',
        failureCost: '失去继续推进当前阶段目标的资格'
      },
      plotBeats: [
        { order: 1, trigger: '限制条件公开', action: '主角核对事实并确认选择范围', result: '排除没有代价的虚假选项' },
        { order: 2, trigger: '对手或环境施压', action: '主角作出可验证的行动', resistance: '行动立即引发反制', result: '选择的代价开始兑现' },
        { order: 3, trigger: '新事实出现', action: '主角调整局部策略但不撤回选择', turn: '有限成果伴随新的责任', result: '局面进入下一章可承接状态' }
      ],
      experience: {
        emotionalCurve: ['压迫', '决断', '释放'],
        payoffPoints: ['主角用行动夺回局部主动权'],
        pressurePoints: ['选择立即带来现实损失']
      },
      ending: {
        result: '当前行动形成可验证结果',
        stateChanges: ['主角处境发生变化'],
        hook: '成果中出现指向更大冲突的异常',
        nextChapterInterface: '下一章核验异常并处理选择的后果'
      },
      mustImplement: ['因果必须由人物行动推动，不能靠巧合解决'],
      mustNotViolate: ['不得把未知信息写成主角已经知道'],
      allowedCandidates: ['具体场景地点和道具细节可按现有设定选择'],
      creativeFreedom: ['对白、动作、意象、局部调度和场景节奏由主笔创造']
    };
  });
  return {
    outlineSchema: 'chapter_outline_v2',
    arcTitle: '当前故事弧滚动推进',
    arcGoal: '用递进选择推进当前阶段目标',
    endingState: '主角完成阶段选择并面对新的可追踪问题',
    estimatedChapterRange: { minimum: count, recommended: count, maximum: count },
    chapters
  };
}

function deterministicMasterOutline(): Record<string, unknown> {
  return {
    outlineSchema: 'stage_master_v2',
    premise: '主角在既有秩序失效后被迫承担重建责任',
    coreConflict: '个人生存选择与重建公共秩序的责任持续冲突',
    protagonistArc: '从只保护自己成长为愿意承担选择后果的领导者',
    majorStages: [
      {
        detailSchema: 'stage_detail_v2',
        stageNumber: 1,
        title: '取得立足点',
        chapterRange: { start: 1, end: 24 },
        plotPatterns: {
          primary: { id: 'underdog-counterattack', name: '绝境逆袭', reason: '当前阶段需要用一次完整危机证明主角能够承担重建责任' },
          supporting: [{ id: 'territory-building', name: '领地经营', reason: '让胜利落实为资源、制度和关系的可见变化' }]
        },
        dramaticQuestion: '主角能否在资源断供与内部失信同时爆发时守住据点，并建立可持续的新规则？',
        stageGoal: '完成一次从危机暴露、寻找解法到新规则经受检验的完整事件闭环。',
        startState: '据点资源将尽、旧账失真、成员互不信任，主角只有临时管理权。',
        conflictDesign: '外部封锁制造生存倒计时，内部既得利益阻止查账，主角每推进一步都必须在效率、公平和关系代价间选择。',
        mainline: {
          encounter: '主角接管濒临崩溃的据点并发现资源断供并非偶然。',
          resolution: '查清账目、重建分配规则、团结关键成员并抵御一次外部施压。',
          result: '据点恢复基本运转，主角取得有限规则解释权，同时确认幕后操纵者仍未现身。'
        },
        structure: {
          setup: '1—5章：资源危机公开，主角被迫接手并锁定账目矛盾。',
          development: '6—13章：查账与求援并行，内部阻力升级，第一套方案失败并付出代价。',
          turn: '14—19章：主角发现真正断供链条，改变策略并联合此前不信任的成员。',
          conclusion: '20—24章：新规则在外部施压中经受检验，阶段危机结束并留下幕后线索。'
        },
        cast: [{ name: '主角', stageRole: '决策者与代价承担者', objective: '守住据点并建立可信规则', stateChange: '由临时接手转为获得有限信任' }],
        chapterBlocks: [
          { start: 1, end: 5, summary: '危机公开与接手', estimatedWords: 15000 },
          { start: 6, end: 13, summary: '查账、试错与代价升级', estimatedWords: 24000 },
          { start: 14, end: 19, summary: '真因揭示与策略反转', estimatedWords: 18000 },
          { start: 20, end: 24, summary: '规则验证与阶段结算', estimatedWords: 15000 }
        ],
        estimatedWords: 72000,
        completionCriteria: ['资源断供危机得到可验证解决', '新分配规则至少经历一次真实压力测试', '主角的阶段身份与关系发生可见变化'],
        hardConstraints: ['不能靠无来源资源或巧合解除危机', '幕后操纵者只留证据，不在本阶段被彻底解决'],
        creativeFreedom: ['具体冲突场景、配角行动和局部反转由后续章纲自由设计'],
        experience: { emotionalArc: ['压迫', '希望', '受挫', '反击', '释放'], payoffPoints: ['新规则首次成功运转'], pressurePoints: ['失败会造成真实人员与资源损失'] },
        turningPoints: ['第一次方案失败并暴露断供链条'],
        foreshadowing: [{ summary: '幕后操纵者的身份', action: 'plant', releaseWindow: '下一阶段继续推进' }],
        stageSummary: '主角守住据点、建立第一套可信规则，并确认局部危机背后存在更大的利益链。',
        pendingThreads: ['幕后操纵者的身份', '旧账中缺失的一页'],
        followUpDirection: '阶段结算后再规划下一段剧情；不提前锁死下一阶段的具体事件。'
      }
    ],
    endingDirection: '这里只约束当前阶段的结束状态，不预写全书结局。',
    storyPromises: ['每次胜利产生后续代价', '人物关系随选择真实变化'],
    openQuestions: ['幕后操纵者如何进入下一阶段，由阶段结算后再讨论']
  };
}

function reviewSynthesis(prompt: string): string | null {
  let value: unknown;
  try { value = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(value) || value.operation !== 'review_synthesis' || !Array.isArray(value.reports)) return null;
  const reports = value.reports.filter(isRecord);
  const issues = reports.flatMap((report) => Array.isArray(report.issues) ? report.issues.filter(isRecord) : []);
  const priorityIssueIndexes = issues.map((_, index) => index)
    .sort((left, right) => severityRank(String(issues[right]?.severity)) - severityRank(String(issues[left]?.severity)));
  const verdicts = reports.map((report) => String(report.verdict));
  const recommendedVerdict = verdicts.includes('blocked') ? 'blocked' : verdicts.includes('rewrite') ? 'rewrite' : 'pass';
  const distinct = new Set(verdicts);
  return JSON.stringify({
    panelId: value.panelId,
    manuscriptVersionId: value.manuscriptVersionId,
    recommendedVerdict,
    priorityIssueIndexes,
    preservedDisagreements: distinct.size > 1 ? ['三席结论不同，保留各席原始理由，不以多数票覆盖。'] : [],
    rationale: issues.length === 0 ? '三席均未提交可定位问题，建议通过。' : '按阻断级、重大、次要顺序合并可定位问题，保留原始证据。'
  });
}

function severityRank(severity: string): number {
  return severity === 'blocker' ? 4 : severity === 'major' ? 3 : severity === 'minor' ? 2 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
