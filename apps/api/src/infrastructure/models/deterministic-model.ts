import { createHash } from 'node:crypto';
import type { ModelAdapter, ModelRequest, ModelResult } from './model-adapter.js';

export class DeterministicModelAdapter implements ModelAdapter {
  public readonly provider = 'local-deterministic';
  public constructor(public readonly modelId = 'wenmi-fixture-v1') {}

  public async generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult> {
    if (signal?.aborted === true) {
      throw signal.reason ?? new DOMException('调用已取消', 'AbortError');
    }
    const digest = createHash('sha256')
      .update(`${request.bookId}\n${request.agentId}\n${request.prompt}`)
      .digest('hex');
    const volumePlan = deterministicVolumePlan(request.prompt);
    const storyEvent = deterministicStoryEvent(request.prompt);
    const eventChapterSequence = deterministicEventChapterSequence(request.prompt);
    const eventChapterDetails = deterministicEventChapterDetails(request.prompt);
    const continuationAnalysis = deterministicContinuationAnalysis(request.prompt);
    const synthesis = reviewSynthesis(request.prompt);
    const stageOutlineWorkflow = deterministicStageOutlineWorkflow(request.prompt);
    const settingGuidance = deterministicSettingGuidance(request.prompt);
    const discussion = deterministicDiscussion(request.prompt);
    const output = volumePlan ?? storyEvent ?? eventChapterSequence ?? eventChapterDetails ?? continuationAnalysis ?? synthesis ?? stageOutlineWorkflow ?? settingGuidance ?? discussion ?? `【确定性假模型 ${digest.slice(0, 12)}】已根据任务 ${request.taskId} 生成可复现结果。`;
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

function deterministicVolumePlan(prompt: string): string | null {
  let root: unknown;
  try { root = JSON.parse(prompt) as unknown; } catch { return null; }
  if (!isRecord(root) || root.operation !== 'volume_plan_generation_v1') return null;
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
    boundaries: {
      mustAchieve: ['本卷核心危机必须得到可验证结果', '主角的选择必须造成后续可见变化'],
      mustNotViolate: ['不能用无来源的新能力或巧合解决高潮', '不能让人物忘记前面已经付出的代价'],
      creativeFreedom: ['事件内的具体场景、对白、局部反转和配角行动', '事件章数可随实际叙事密度调整'],
      openQuestions: ['下一卷介入势力的具体身份由事件结算后再确认']
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
    uncertaintyNotes: fusion ? ['融合方案仍需作者确认具体对手身份与场景表达'] : ['若需要新增核心能力、道具或人物身份，必须先由作者确认']
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
  const middleState = '人物第一次行动后发现表面问题背后还有必须承担的代价';
  const pressureState = '人物修正判断并作出不能轻易撤回的选择，冲突进入收束阶段';
  const endings = [middleState, pressureState, required];
  const responsibilities = [
    '让事件触发条件真正落地，并让人物不能继续旁观',
    '升级阻力，让人物通过选择和代价推动因果链',
    '完成事件必须得到的结果，并形成下一事件的接口'
  ];
  const chapters = endings.map((endingState, index) => {
    const chapterNumber = start + index;
    return {
      chapterNumber,
      title: index === 0 ? '后果落地' : index === 1 ? '选择的代价' : '局面改写',
      eventResponsibility: responsibilities[index],
      openingState: index === 0 ? opening : endings[index - 1],
      characterGoals: ['主角要在现有能力和关系边界内推进当前目标'],
      conflicts: ['对手与现实限制同时阻止主角取得无代价的胜利'],
      choicesAndCosts: ['主角必须放弃一条轻松退路，换取可持续的推进机会'],
      informationChanges: [index === 2 ? '事件核心事实得到验证，但更大的后果开始显现' : '新证据改变人物对当前阻力的判断'],
      storyBeats: ['状态变化落地', '行动遭遇有效阻力', '人物作出带代价的选择', '结果改变下一步条件'],
      endingState,
      nextChapterInterface: index === 2 ? nextImpact : endings[index],
      softSuggestions: ['具体场景、对话和局部反转可由写作阶段依据人物即时反应调整'],
      creativeFreedom: ['场景调度、语言节奏、人物微反应与不破坏因果链的合理惊喜']
    };
  });
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
  const slots = parsedSource(root, 'planning:recent_chapter_slots');
  const planned = Array.isArray(slots) ? slots.filter(isRecord) : [];
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
  if (!isRecord(root) || root.operation !== '设定大纲逐项引导' || !isRecord(root.settingGuidance)) return null;
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
  const settingProposalMatch = prompt.match(/正在参加本书“([^”]+)”独立提案/u);
  if (settingProposalMatch !== null) {
    const base = deterministicDiscussionReply();
    const itemLabel = settingProposalMatch[1] ?? '当前设定项';
    if (prompt.includes('人物欲望、关系变化')) {
      base.fields.answer = itemLabel === '策划理念'
        ? '让人物在互相拯救与互相利用之间不断重新选择，借关系变化讨论爱能否承受真相，并给读者兼具心疼、悬念和主动成长的体验。'
        : `${itemLabel}从人物真正想要什么开始写，再说明他会怎么做、不能做什么，以及这样做要付出什么代价。`;
    } else if (prompt.includes('打破最直觉的同类套路')) {
      base.fields.answer = itemLabel === '策划理念'
        ? '把看似被拯救的一方写成更早看清真相的人，借认知错位讨论善意是否也会成为控制，并让读者在反转后重新理解两个人的每次靠近。'
        : `${itemLabel}不走同类题材最常见的路，让人物因为知道的信息不同而作出不同选择，而且每个选择都会带来现实后果。`;
    } else {
      base.fields.answer = itemLabel === '策划理念'
        ? '用一段必须付出真实代价的双向救赎，讨论人在被欺骗后是否仍能自主选择信任，让读者既获得现实共鸣，也持续期待关系真相被逐层揭开。'
        : `${itemLabel}先写清读者会看到什么、人物会怎么受影响；现在只定必要内容，不把后面的剧情提前写死。`;
    }
    base.fields.keyPoints = [];
    base.fields.alternatives = [];
    base.fields.risks = [];
    base.fields.questions = [];
    base.fields.nextStep = '等待作者选择、组合或提交自己的版本';
    base.fields.details = '';
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
