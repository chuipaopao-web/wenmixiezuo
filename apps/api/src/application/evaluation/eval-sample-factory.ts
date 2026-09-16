import { createHash } from 'node:crypto';

/**
 * MODEL-NODE-EVAL合成样本工厂（合同"模型与样本"节）：
 * - 全部合成新书资料，不读真实作品；三题材（历史融合/玄幻成长/都市感情）×三长度档（短/中/长）。
 * - 正反例兼有：生成节点正例；审查节点干净候选（正）与植入已知错误候选（反，测漏报/误报）。
 * - 开发调参样本（screen）与保留验证样本（holdout）分离：SCREEN_SET用于初筛与参数方案比较，
 *   HOLDOUT_SET只在固定配置后用于准入验证，不用初筛结果冒充保留验证。
 * - 确定性生成：同输入同内容，样本hash可复算；作者已确认故事线写入fixture以测"关键约束零漏失"。
 */

export type EvalGenre = '历史融合' | '玄幻成长' | '都市感情';
export type EvalLengthBand = 'short' | 'medium' | 'long';
export type EvalTimeSlot = 'T1' | 'T2';

export interface SyntheticFixture {
  readonly genre: EvalGenre;
  readonly lengthBand: EvalLengthBand;
  /** 作者已确认故事线（关键约束：骨架必须全部承接）。 */
  readonly authorStorylines: readonly { title: string; note: string }[];
  readonly intent: string;
  readonly documents: readonly { key: string; text: string }[];
  /** 参考短卡fields（供骨架/卷卡/审查节点输入；card-extract节点只给documents）。 */
  readonly cardFields: Record<string, { text: string; sourceKeys: string[] }[]>;
  /** 参考骨架（供卷卡与审查节点输入）。 */
  readonly skeleton: Record<string, unknown>;
  /** 干净候选方案（审查正例）。 */
  readonly cleanPlan: Record<string, unknown>;
  /** 植入错误的候选（审查反例）：与cleanPlan差异处即已知错误清单。 */
  readonly flawedPlan: Record<string, unknown>;
  readonly seededErrors: readonly string[];
}

export interface BuiltSample {
  readonly sampleHash: string;
  readonly genre: EvalGenre;
  readonly lengthBand: EvalLengthBand;
  readonly timeSlot: EvalTimeSlot;
  readonly kind: 'positive' | 'negative';
  readonly fixture: SyntheticFixture;
  readonly setName: 'screen' | 'holdout';
}

const LENGTH_CHARS: Record<EvalLengthBand, number> = { short: 3000, medium: 10000, long: 26000 };

interface GenreSeed {
  readonly genre: EvalGenre;
  readonly protagonist: string;
  readonly premise: string;
  readonly world: string;
  readonly openingBeat: string;
  readonly conflict: string;
  readonly paragraphs: readonly string[];
}

const GENRES: readonly GenreSeed[] = [
  {
    genre: '玄幻成长',
    protagonist: '林舟',
    premise: '无灵根修理工以机甲修理手艺立足，从街边小铺到建立自己的机甲工坊',
    world: '灵能机甲世界：修士以灵根驾驭机甲，无灵根者被视为废人；机甲核心依赖稀有的星髓矿',
    openingBeat: '林舟在废弃机甲堆里发现一台刻着他父亲名字的旧机甲',
    conflict: '灵根贵族垄断机甲修理行会，无灵根者不得开业',
    paragraphs: [
      '林舟的手指抚过机甲胸腔内锈蚀的线路，这台老古董的灵能导管竟然还保持着完整的回路。',
      '修理铺的门被推开，风铃响了两声。来人穿着行会的灰袍，腰间挂着三品灵师的铜牌。',
      '父亲留下的笔记本里夹着一张星髓矿脉的手绘地图，边缘用红笔标着一个他从未听过的地名。',
      '第一次试机那天，整个街区都听见了引擎的轰鸣。没有灵根的驾驶员，靠的是齿轮与杠杆的精密配合。',
      '行会的最后通牒贴在铺子门口：三日内停业，否则以私造机甲论处。'
    ]
  },
  {
    genre: '历史融合',
    protagonist: '沈恪',
    premise: '现代历史学者穿越南宋，以现代组织方法重建地方保甲，在守城战中证明制度的力量',
    world: '南宋末年边城：蒙古大军压境，城内保甲废弛、粮仓空虚、豪强各自为政',
    openingBeat: '沈恪在城头醒来，身上穿着不属于这个时代的衣服，城外是连营十里的敌军',
    conflict: '守将不信制度只信私兵，豪强抵制编户，粮草只够四十日',
    paragraphs: [
      '沈恪接过保甲册时，册子上三分之一的名字早已不在城中。他做的第一件事是重新点数。',
      '粮仓的锁开了三次，三次的数目都对不上。他没有声张，只在心里记下了每一个经手人。',
      '他把徭役编成轮换表贴在城门口，第一天有人撕了，第二天有人来看，第三天有人开始按表上工。',
      '敌军的第一波云梯架上城头时，新编的保甲队第一次没有溃散。',
      '守将在城楼里摆酒，酒过三巡问他：你这法子，能教给别的城吗？'
    ]
  },
  {
    genre: '都市感情',
    protagonist: '许照',
    premise: '急诊医生与事故调查记者在连环医疗纠纷中从对立到并肩，揭开器械召回被压下的真相',
    world: '现代都市三甲医院：急诊科人手长期不足，医疗器械公司与医院有千丝万缕的合作',
    openingBeat: '许照值夜班的第三十七个小时，推进来一个和三年前那起事故症状完全相同的病人',
    conflict: '医院要求低调处理，记者穷追不舍，两人都被各自单位施压',
    paragraphs: [
      '抢救室的灯灭了又亮。许照摘下手套时，发现自己的手在抖——不是因为累，是因为那份似曾相识的监护数据。',
      '记者的录音笔递到他面前，他问的第一个问题却是：你三年前采访过仁和器械的质检员，对吗？',
      '院办的电话打到急诊科，措辞很客气，意思很清楚：那份病历不要再查了。',
      '他们在天台交换了各自掌握的半份证据，拼在一起，正好是一份完整的召回记录。',
      '发布会前十分钟，许照把工牌摘下来放进口袋。从今天起他只说真话，不管以什么身份。'
    ]
  }
];

function expandText(seed: GenreSeed, targetChars: number, band: EvalLengthBand): string {
  const parts: string[] = [
    `【${seed.genre}】${seed.premise}。`,
    `世界观：${seed.world}。`,
    `开篇：${seed.openingBeat}。`,
    `核心冲突：${seed.conflict}。`
  ];
  let i = 0;
  while (parts.join('\n').length < targetChars) {
    const base = seed.paragraphs[i % seed.paragraphs.length]!;
    parts.push(`${base}（${band}档扩写第${Math.floor(i / seed.paragraphs.length) + 1}轮·场景${(i % seed.paragraphs.length) + 1}：${seed.protagonist}面对${seed.conflict}的又一次具体考验，行动留下可核对的痕迹。）`);
    i++;
  }
  return parts.join('\n');
}

function sourceKey(kind: string, id: string, revision: string): string { return `${kind}:${id}:${revision}`; }

export function buildFixture(genre: EvalGenre, lengthBand: EvalLengthBand): SyntheticFixture {
  const seed = GENRES.find(g => g.genre === genre)!;
  const openingText = expandText(seed, Math.floor(LENGTH_CHARS[lengthBand] * 0.6), lengthBand);
  const settingText = expandText(seed, Math.floor(LENGTH_CHARS[lengthBand] * 0.4), lengthBand);
  const authorStorylines = [
    { title: `${seed.protagonist}的核心成长线`, note: `${seed.premise}` },
    { title: `${seed.conflict}的对抗线`, note: '作者明确要求这条线全书贯穿，不得中途消失' }
  ] as const;
  const intent = `作者选择：主线为「${authorStorylines[0].title}」，贯穿线「${authorStorylines[1].title}」。目标体量40万字，轻松向，不虐主。`;
  const documents = [
    { key: 'opening:main', text: openingText },
    { key: 'setting:world', text: settingText },
    { key: 'intent:author', text: intent }
  ];
  const srcOpening = sourceKey('opening', 'main', '1');
  const srcSetting = sourceKey('setting', 'world', '1');
  const srcIntent = sourceKey('intent', 'author', '1');
  const cardFields: SyntheticFixture['cardFields'] = {
    premise: [{ text: seed.premise, sourceKeys: [srcOpening] }],
    protagonists: [{ text: `${seed.protagonist}：${seed.openingBeat}`, sourceKeys: [srcOpening] }],
    world: [{ text: seed.world, sourceKeys: [srcSetting] }],
    openingEnding: [{ text: `开篇${seed.openingBeat}；结局方向：${seed.premise.split('，')[0]}达成`, sourceKeys: [srcOpening, srcSetting] }],
    preferences: [{ text: '轻松向，不虐主，目标体量40万字', sourceKeys: [srcIntent] }],
    prohibitions: [{ text: '不得让作者确认的对抗线中途消失', sourceKeys: [srcIntent] }]
  };
  const words = { target: 400000, min: null, max: null, hard: false, policy: 'chars-v1' };
  const skeleton: Record<string, unknown> = {
    structure: '四幕起承转合：第一幕立足、第二幕扩张、第三幕危机、第四幕兑现',
    baseline: '轻快成长，靠手艺与制度取胜',
    ending: seed.premise.split('，')[0],
    openingHooks: [`开篇钩子：${seed.openingBeat}`, '第一章末读者想知道他如何破局', '前三章建立最大期待：证明自己'],
    words,
    lines: [
      { id: 'main', role: 'main', title: authorStorylines[0].title, goal: '立足', answer: seed.premise.split('，')[0], process: '从被轻视到被需要', parentIds: [], covers: [authorStorylines[0].title], milestones: [{ id: 'ms1', summary: '第一次证明自己', suggestedVolumes: ['v1'], importance: 'required' }] },
      { id: 'rival', role: 'through', title: authorStorylines[1].title, goal: '压制主角', answer: '对抗线全书贯穿并在终卷收束', process: '逐步升级的正面对抗', parentIds: [], covers: [authorStorylines[1].title], milestones: [{ id: 'ms2', summary: '第一次正面冲突', suggestedVolumes: ['v2'], importance: 'flexible' }] }
    ],
    expectations: [{ id: 'promise', opening: '主角能否在压制下立足', change: '看到主角用方法而非运气取胜', answer: '以手艺与制度赢得认可', lineIds: ['main'] }],
    relations: [{ from: 'rival', to: 'main', kind: 'conflict', effect: '对抗压力推动成长' }],
    volumeBriefs: [
      { id: 'v1', title: '立足', beat: '第一幕·起', goal: '打开局面', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' } },
      { id: 'v2', title: '扩张', beat: '第二幕·承', goal: '建立根基', words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' } }
    ]
  };
  const volumeOf = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, title: id === 'v1' ? '立足' : '扩张', beat: id === 'v1' ? '第一幕·起' : '第二幕·承',
    start: '开局困境已成立', goal: '本卷目标', conflict: seed.conflict, turningPoint: '关键转折事件',
    gain: '伙伴与口碑', loss: null, arc: null, payoff: null, hook: null, mood: null,
    ending: '本卷结束条件达成', handoff: id === 'v1' ? '引出扩张' : '',
    words: { target: 200000, min: null, max: null, hard: false, policy: 'chars-v1' },
    anchors: [
      { id: 'in', ownerEntityId: id, kind: 'entry', summary: '开场状态成立', span: '本卷开篇', conditions: [{ summary: '开局困境已经成立', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补开场戏', keywords: [], aliases: [] },
      { id: 'out', ownerEntityId: id, kind: 'exit', summary: '收束条件达成', span: '本卷收束', conditions: [{ summary: '本卷目标已经达成', subjectIds: ['main', 'rival'] }], logic: 'all', importance: 'required', fallback: '补收束戏', keywords: [], aliases: [] }
    ],
    duties: [{ lineId: 'main', action: id === 'v1' ? 'start' : 'advance', result: '主线推进', anchorIds: [`${id}:out`], strength: 'required', reason: '主线本卷必须推进' }],
    ...overrides
  });
  const cleanPlan: Record<string, unknown> = { ...skeleton, anchors: [], volumes: [volumeOf('v1'), volumeOf('v2')] };
  // 反例植入三类已知错误：①分卷字数合计≠全书target；②作者确认对抗线在卷职责中无任何去向；
  // ③锚点条件把将来承诺当已达成（“获得认可后”不可按正文核对）。
  const flawedPlan: Record<string, unknown> = {
    ...skeleton,
    anchors: [],
    volumes: [
      volumeOf('v1', { words: { target: 150000, min: null, max: null, hard: false, policy: 'chars-v1' } }),
      volumeOf('v2', {
        anchors: [
          { id: 'in', ownerEntityId: 'v2', kind: 'entry', summary: '开场状态成立', span: '本卷开篇', conditions: [{ summary: '主角已经获得全城认可', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补开场戏', keywords: [], aliases: [] },
          { id: 'out', ownerEntityId: 'v2', kind: 'exit', summary: '收束条件达成', span: '本卷收束', conditions: [{ summary: '本卷目标已经达成', subjectIds: ['main'] }], logic: 'all', importance: 'required', fallback: '补收束戏', keywords: [], aliases: [] }
        ],
        duties: []
      })
    ]
  };
  const seededErrors = [
    '分卷字数合计350000≠全书target400000',
    '作者确认对抗线在第二卷无任何职责去向',
    'v2开场锚点条件“主角已经获得全城认可”是把将来承诺当已达成，无法按正文核对'
  ];
  return { genre, lengthBand, authorStorylines, intent, documents, cardFields, skeleton, cleanPlan, flawedPlan, seededErrors };
}

function hashOf(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

const SCREEN_COMBOS: readonly { genre: EvalGenre; band: EvalLengthBand; slot: EvalTimeSlot }[] = [
  { genre: '玄幻成长', band: 'medium', slot: 'T1' },
  { genre: '历史融合', band: 'short', slot: 'T1' }
];

const HOLDOUT_COMBOS: readonly { genre: EvalGenre; band: EvalLengthBand; slot: EvalTimeSlot }[] = [
  { genre: '历史融合', band: 'short', slot: 'T2' },
  { genre: '历史融合', band: 'medium', slot: 'T1' },
  { genre: '历史融合', band: 'long', slot: 'T2' },
  { genre: '玄幻成长', band: 'short', slot: 'T1' },
  { genre: '玄幻成长', band: 'medium', slot: 'T2' },
  { genre: '玄幻成长', band: 'long', slot: 'T1' },
  { genre: '都市感情', band: 'short', slot: 'T2' },
  { genre: '都市感情', band: 'medium', slot: 'T1' },
  { genre: '都市感情', band: 'long', slot: 'T2' },
  { genre: '都市感情', band: 'medium', slot: 'T2' } // 第10样本：跨时间段重复题材档
];

/**
 * 构建某节点的样本集。
 * 生成节点：screen=2个共同正例；holdout=10个正例（3题材×3长度档+1跨时段）。
 * 审查节点：正反各半——screen=1干净+1植入；holdout=5干净+5植入（测漏报与误报）。
 */
export function buildSamples(nodeKey: string, setName: 'screen' | 'holdout'): BuiltSample[] {
  const isReview = nodeKey.startsWith('review');
  const combos = setName === 'screen' ? SCREEN_COMBOS : HOLDOUT_COMBOS;
  const samples: BuiltSample[] = [];
  for (const combo of combos) {
    const fixture = buildFixture(combo.genre, combo.band);
    if (!isReview) {
      samples.push({
        sampleHash: hashOf([nodeKey, setName, combo.genre, combo.band, combo.slot, 'positive', fixture.documents.map(d => d.text.length)]),
        genre: combo.genre, lengthBand: combo.band, timeSlot: combo.slot, kind: 'positive', fixture, setName
      });
    } else {
      // 审查节点：holdout为5干净+5植入（前半组合干净、后半植入）；screen为1干净+1植入。
      const kinds: readonly ('positive' | 'negative')[] = setName === 'screen'
        ? [combo === combos[0] ? 'positive' : 'negative']
        : [combos.indexOf(combo) < 5 ? 'positive' : 'negative'];
      for (const kind of kinds) {
        samples.push({
          sampleHash: hashOf([nodeKey, setName, combo.genre, combo.band, combo.slot, kind, fixture.seededErrors]),
          genre: combo.genre, lengthBand: combo.band, timeSlot: combo.slot, kind, fixture, setName
        });
      }
    }
  }
  return samples;
}
