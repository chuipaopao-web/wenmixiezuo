import { hashStableContractContent } from '@wenmi/contracts';

export const HIDDEN_NARRATIVE_REGISTRY_VERSION = 1;

type MethodCategory = 'macro' | 'character' | 'causality' | 'serial' | 'presentation';

interface HiddenNarrativeMethod {
  methodKey: string;
  internalLabel: string;
  category: MethodCategory;
  signals: readonly string[];
  scaffold: string;
}

export interface HiddenVolumeRouteRecipe {
  recipeKey: string;
  registryVersion: number;
  methodKeys: string[];
  methodVersionIds: string[];
  selectionReason: string;
  scaffold: string[];
}

const METHODS: readonly HiddenNarrativeMethod[] = [
  method('three-act', '三幕式结构', 'macro', ['商业', '冒险', '都市'], '建立清晰目标，让中段对抗改变人物理解，最终用主动选择解决核心问题。'),
  method('four-act', '四幕式/起承转合', 'macro', ['情感', '智斗', '悬疑'], '先立住人物与局面，再深化因果，用一次改变理解的转折重排选择，最后收束并留下余韵。'),
  method('five-act', '五幕式/弗赖塔格', 'macro', ['史诗', '历史', '悲剧'], '让压力持续上升，在高点后暴露更深代价，经历低谷后再完成真正解决。'),
  method('six-act', '六幕式', 'macro', ['影视', '动作', '群像'], '把开端、第一次转向、持续升级、危机、重整和解决分成六个职责清楚的阶段。'),
  method('save-the-cat', '拯救猫咪节拍表', 'macro', ['网文', '爽', '快节奏'], '尽快兑现核心卖点，中段让胜负意义改变，随后逼近代价与至暗选择，再用新办法完成高潮。'),
  method('hero-journey', '英雄之旅', 'character', ['玄幻', '仙侠', '成长', '冒险'], '让人物跨出熟悉边界，经受盟友、敌人与考验，在付出代价后带着能力或认知变化进入新阶段。'),
  method('eight-sequence', '八序列结构', 'macro', ['长篇', '连载', '电影感'], '把本卷分成数个职责不同的推进区段，每段造成新状态，不按固定章数机械切分。'),
  method('seven-point', '七点式故事结构', 'macro', ['悬疑', '惊悚', '强对抗'], '从抓人的问题出发，让两次主动转向和两次外部施压围绕中点认知变化形成因果链。'),
  method('story-circle', '故事圈', 'character', ['人物', '文艺', '情感'], '围绕人物需要、进入陌生局面、得到与付出、回归与改变组织人物内在变化。'),
  method('truby-22', '特鲁比22步', 'character', ['心理', '复杂人物', '道德'], '把欲望、弱点、对手、计划、关键抉择与自我揭示绑定，让外部胜负同时逼出人物真实变化。'),
  method('mckee-causality', '麦基故事结构', 'causality', ['因果', '电影感'], '每次行动都改变价值与局势，使下一次选择成为前一结果的必然后果；危机必须迫使人物二选一。'),
  method('field-paradigm', '悉德·菲尔德范式', 'causality', ['商业', '节奏'], '在前段尽快进入本卷任务，中段用明确转折改变策略，后段集中解决，不把节点换算成固定页码。'),
  method('golden-three', '黄金三章', 'serial', ['网文', '开局', '第一卷'], '前三章连续完成抓住读者、让主角行动并承受压力、给出首次回报并打开更大目标。'),
  method('upgrade-loop', '升级打怪节奏', 'serial', ['玄幻', '修仙', '游戏', '无限流'], '新环境带来新门槛，人物以行动获取能力或资源并承担代价，胜利后进入更高层问题。'),
  method('payoff-loop', '爽点/打脸节奏', 'serial', ['都市', '重生', '系统', '爽'], '让压制、准备、反证、结果与收获形成有因果的回报，不把轻视和打脸当成每次必用动作。'),
  method('continuation-hook', '悬念钩子节奏', 'serial', ['悬疑', '连载', '追更'], '每个阶段留下自然的下一期待，可来自未解问题、人物决定、情绪余波或新危机，不强制悬崖式断章。'),
  method('unit-story', '单元剧结构', 'serial', ['探案', '职业', '日常'], '每个小故事独立闭环一个问题，同时让人物成长、关系或长期主线留下累计变化。'),
  method('multi-line', '多线并进结构', 'serial', ['群像', '史诗', '权谋'], '每条线都有独立目标与状态变化，只在共享因果或高潮职责需要时切换和汇合。'),
  method('nonlinear', '非线性叙事', 'presentation', ['倒叙', '插叙', '时间谜题'], '只在能增加理解或悬念时改变信息呈现顺序，事实因果和故事时间仍保持可追溯。'),
  method('meta', '元叙事', 'presentation', ['元叙事', '第四面墙', '实验'], '把叙述层本身变成可见的故事装置，同时保护人物目标和情绪真实。'),
  method('unreliable', '不可靠叙述', 'presentation', ['心理', '悬疑', '叙述者'], '区分人物所信、叙述所说与客观事实，用可回查证据支持后续揭示。'),
  method('symbolic', '寓言/象征结构', 'presentation', ['寓言', '象征', '讽刺', '文学'], '让重复意象服务人物选择和主题变化，表层事件仍须独立成立，不能只剩解释。')
];

export const HIDDEN_NARRATIVE_METHOD_COUNT = METHODS.length;

export function selectHiddenVolumeRouteRecipes(signalText: string, firstVolume: boolean): [HiddenVolumeRouteRecipe, HiddenVolumeRouteRecipe] {
  const normalized = signalText.toLocaleLowerCase('zh-CN');
  const macros = ranked('macro', normalized);
  const primaryA = macros[0] ?? requireMethod('three-act');
  const primaryB = macros.find((candidate) => candidate.methodKey !== primaryA.methodKey) ?? requireMethod('four-act');
  const character = ranked('character', normalized)[0] ?? requireMethod('story-circle');
  const serial = ranked('serial', normalized)[0] ?? requireMethod('continuation-hook');
  const presentation = ranked('presentation', normalized)[0];
  const causality = ranked('causality', normalized)[0] ?? requireMethod('mckee-causality');
  const firstVolumeMethod = firstVolume ? requireMethod('golden-three') : null;

  return [
    recipe('route-a', [primaryA, causality, character, firstVolumeMethod].filter(isMethod)),
    recipe('route-b', [primaryB, causality, serial, presentation, firstVolumeMethod].filter(isMethod))
  ];
}

function ranked(category: MethodCategory, normalized: string): HiddenNarrativeMethod[] {
  return METHODS.filter((candidate) => candidate.category === category)
    .map((candidate, index) => ({
      candidate,
      index,
      score: candidate.signals.reduce((total, signal) => total + (normalized.includes(signal.toLocaleLowerCase('zh-CN')) ? 1 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ candidate }) => candidate);
}

function recipe(prefix: string, selected: HiddenNarrativeMethod[]): HiddenVolumeRouteRecipe {
  const unique = selected.filter((candidate, index, all) => all.findIndex((other) => other.methodKey === candidate.methodKey) === index);
  return {
    recipeKey: `${prefix}-v${HIDDEN_NARRATIVE_REGISTRY_VERSION}-${unique.map((candidate) => candidate.methodKey).join('.')}`,
    registryVersion: HIDDEN_NARRATIVE_REGISTRY_VERSION,
    methodKeys: unique.map((candidate) => candidate.methodKey),
    methodVersionIds: unique.map((candidate) => methodVersionId(candidate.methodKey)),
    selectionReason: `根据本卷题材、长度、当前任务与${prefix === 'route-a' ? '人物主动推进' : '压力变化和连载期待'}选择互补工具；只使用职责映射，不照搬节拍。`,
    scaffold: [
      ...unique.map((candidate) => candidate.scaffold),
      '这些参考只描述节点职责：把人物变化、连载期待和叙述方式映射到同一条因果链，不得把多套完整节拍首尾拼接。'
    ]
  };
}

function method(methodKey: string, internalLabel: string, category: MethodCategory, signals: readonly string[], scaffold: string): HiddenNarrativeMethod {
  return { methodKey, internalLabel, category, signals, scaffold };
}

function requireMethod(methodKey: string): HiddenNarrativeMethod {
  const value = METHODS.find((candidate) => candidate.methodKey === methodKey);
  if (value === undefined) throw new Error(`隐藏叙事方法不存在：${methodKey}`);
  return value;
}

function isMethod(value: HiddenNarrativeMethod | null | undefined): value is HiddenNarrativeMethod {
  return value !== null && value !== undefined;
}

export interface HiddenNarrativeMethodVersion {
  id: string;
  methodKey: string;
  version: string;
  category: 'macro' | 'character_arc' | 'causal_principle' | 'serial_rhythm' | 'narration';
  contentFingerprint: string;
  content: {
    internalLabel: string;
    suitableProblems: string[];
    organization: string[];
    fitLengths: string[];
    fitGenres: string[];
    routineRisks: string[];
    adaptability: { movable: boolean; mergeable: boolean; deletable: boolean; note: string };
  };
}

export function hiddenNarrativeMethodVersions(): HiddenNarrativeMethodVersion[] {
  return METHODS.map((item) => {
    const content: HiddenNarrativeMethodVersion['content'] = {
      internalLabel: item.internalLabel,
      suitableProblems: [item.scaffold],
      organization: [item.scaffold],
      fitLengths: item.category === 'serial' ? ['连载长篇', '单卷', '事件链'] : item.category === 'presentation' ? ['单卷', '事件', '章节'] : ['整本书', '单卷'],
      fitGenres: [...item.signals],
      routineRisks: [methodRisk(item)],
      adaptability: {
        movable: true,
        mergeable: true,
        deletable: true,
        note: '只保留对当前故事有用的节点职责；允许移动、合并或删除，不得强迫故事逐拍执行。'
      }
    };
    return {
      id: methodVersionId(item.methodKey),
      methodKey: item.methodKey,
      version: '1.0.0',
      category: databaseCategory(item.category),
      contentFingerprint: hashStableContractContent(content).slice('sha256:'.length),
      content
    };
  });
}

function methodVersionId(methodKey: string): string {
  return `structure-method:${methodKey}:1.0.0`;
}

function databaseCategory(category: MethodCategory): HiddenNarrativeMethodVersion['category'] {
  return ({
    macro: 'macro', character: 'character_arc', causality: 'causal_principle',
    serial: 'serial_rhythm', presentation: 'narration'
  } as const)[category];
}

function methodRisk(item: HiddenNarrativeMethod): string {
  if (item.methodKey === 'save-the-cat' || item.methodKey === 'payoff-loop') return '容易把有效变化误写成同一种打脸、反转或奖励循环。';
  if (item.methodKey === 'golden-three') return '容易只留悬念不兑现，或为了快而牺牲人物可信度。';
  if (item.category === 'macro') return '容易把阶段职责机械换算成固定章数或固定比例。';
  if (item.category === 'character') return '容易只写内心变化而缺少外部行动、因果和代价。';
  if (item.category === 'serial') return '容易重复同一种刺激，造成疲劳和模板感。';
  if (item.category === 'presentation') return '容易让叙述技巧压过人物、事实与情绪。';
  return '容易只追求结构整齐，削弱人物意外但合理的选择。';
}