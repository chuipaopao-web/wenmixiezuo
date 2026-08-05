import { describe, expect, it } from 'vitest';
import {
  parseChapterOutlineV2,
  validateArtifactContent
} from '../../../apps/api/src/domain/artifact-schemas.js';
import {
  compileChapterOutlineForWriter
} from '../../../apps/api/src/application/creation/chapter-outline-compiler.js';
import {
  bindChapterOutlineToAuthoritativeStage,
  chapterOutlineStageBoundaryFailure,
  stageBoundaryContractLine
} from '../../../apps/api/src/domain/chapter-outline-stage-boundary.js';

function chapterOutlineV2(): Record<string, unknown> {
  return {
    outlineSchema: 'chapter_outline_v2',
    chapterNumber: 11,
    title: '王都来的账单',
    sourceStage: {
      stageNumber: 1,
      title: '夺回身份',
      chapterRange: { start: 1, end: 50 }
    },
    chapterFunction: '让主角第一次用公开规则击穿平台的私下封锁',
    openingState: '夏炎刚夺回参赛资格，但队伍的结算账户仍被冻结。',
    requiredEndingState: '夏炎取得第一份可公开复核的结算记录，同时暴露审计员受平台控制。',
    cast: [
      {
        name: '夏炎',
        objective: '解除结算冻结并保住队伍',
        knowledgeBoundary: '知道账目异常，不知道审计员已受指使',
        chapterRole: '主动验证规则',
        stateChange: '从申诉转为公开举证'
      },
      {
        name: '周老六',
        objective: '保住自己的灰色渠道',
        knowledgeBoundary: '知道审计员与平台的交易',
        chapterRole: '提供有代价的内部线索'
      }
    ],
    conflict: {
      surface: '审计员以手续不全拒绝放款',
      underlying: '平台利用解释权决定谁能获得收益',
      oppositionGoal: '逼夏炎签下排他合同',
      failureCost: '队伍当天解散并失去参赛席位',
      successCost: '公开证据会暴露周老六的渠道'
    },
    plotBeats: [
      { order: 1, trigger: '账户冻结通知送达', action: '夏炎核对结算条款', resistance: '审计员拒绝提供原始记录', turn: '发现通知时间早于比赛结束', result: '确认冻结并非正常风控' },
      { order: 2, trigger: '周老六交出内部编号', action: '夏炎在公开终端复核编号', resistance: '终端只显示删节记录', turn: '观众缓存保留了完整回执', result: '形成第一份多源证据' },
      { order: 3, trigger: '平台提出私下解冻', action: '夏炎公开拒绝排他合同', resistance: '队员担心当日失去收入', turn: '转账在直播中短暂到账', result: '证明收益真实且平台能够放款' }
    ],
    experience: {
      primaryTone: '紧绷后释放',
      emotionalCurve: ['压抑', '怀疑', '兴奋', '警惕'],
      payoffPoints: ['直播核验迫使平台当场放款'],
      pressurePoints: ['队伍可能当天解散'],
      readerEffect: '爽点成立，但意识到胜利会带来更大追杀'
    },
    descriptionFocus: {
      primary: ['公开终端核验过程', '夏炎拒绝合同时的队员反应'],
      secondary: ['王都审计员的克制表情'],
      compress: ['往返办手续的过程']
    },
    informationControl: {
      reveals: ['平台可以人为控制结算'],
      concealed: ['审计员背后的具体指使者'],
      gaps: ['周老六知道交易内情，夏炎只知道编号异常']
    },
    threadActions: [
      { action: 'plant', summary: '审计记录中出现零号印章' }
    ],
    ending: {
      result: '结算到账，公开证据被观众保存',
      stateChanges: ['队伍暂时保住', '夏炎被列入重点审计名单'],
      hook: '零号印章来自一名已经死亡的冠军',
      nextChapterInterface: '下一章调查零号印章与失踪冠军'
    },
    mustImplement: ['结算到账必须由多源证据推动，不能靠巧合'],
    mustNotViolate: ['夏炎此时不知道审计员的幕后指使者'],
    allowedCandidates: ['周老六可以索要人情，也可以索要收益分成'],
    creativeFreedom: ['对白、动作、终端界面细节和群众反应由主笔创造']
  };
}

describe('chapter outline v2', () => {
  it('validates the hard causal frame while allowing optional experience fields to be absent', () => {
    const value = chapterOutlineV2();
    delete value.experience;
    delete value.descriptionFocus;
    delete value.informationControl;
    delete value.threadActions;

    expect(parseChapterOutlineV2(value)).toEqual(expect.objectContaining({
      outlineSchema: 'chapter_outline_v2',
      chapterNumber: 11,
      chapterFunction: expect.stringContaining('公开规则')
    }));
    expect(() => validateArtifactContent('chapter_outline', value)).not.toThrow();
  });

  it('rejects missing causal boundaries, oversized beats and fabricated mandatory soft fields', () => {
    const missingEnding = chapterOutlineV2();
    delete missingEnding.requiredEndingState;
    expect(() => parseChapterOutlineV2(missingEnding)).toThrow(/结束状态/u);

    const tooManyBeats = chapterOutlineV2();
    tooManyBeats.plotBeats = Array.from({ length: 6 }, (_, index) => ({
      order: index + 1, trigger: `触发${index + 1}`, action: `行动${index + 1}`, result: `结果${index + 1}`
    }));
    expect(() => parseChapterOutlineV2(tooManyBeats)).toThrow(/三至五个/u);
  });

  it('keeps legacy outlines readable without silently inventing v2 fields', () => {
    const legacy = {
      chapterNumber: 1,
      goal: '进入灰塔',
      beats: ['打开塔门'],
      hook: '塔内有人回应'
    };
    expect(() => validateArtifactContent('chapter_outline', legacy)).not.toThrow();
    expect(() => parseChapterOutlineV2(legacy)).toThrow(/结构版本/u);
  });

  it('normalizes harmless model shorthand without discarding description or knowledge boundaries', () => {
    const value = chapterOutlineV2();
    value.descriptionFocus = ['重点描写失物登记核验', '补充描写人物停顿'];
    value.informationControl = {
      林澄: ['知道反查已经启动', '不知道通知由谁转交'],
      罗知: ['知道登记表被调阅']
    };

    expect(parseChapterOutlineV2(value)).toEqual(expect.objectContaining({
      descriptionFocus: {
        primary: ['重点描写失物登记核验', '补充描写人物停顿'],
        secondary: [],
        compress: []
      },
      informationControl: {
        reveals: [],
        concealed: [],
        gaps: [
          '林澄：知道反查已经启动；不知道通知由谁转交',
          '罗知：知道登记表被调阅'
        ]
      }
    }));
  });

  it('compiles a Chinese minimum work order without raw schema keys and never truncates hard facts', () => {
    const compiled = compileChapterOutlineForWriter(chapterOutlineV2(), 1_350);
    expect(compiled.length).toBeLessThanOrEqual(1_350);
    expect(compiled).toContain('本章功能');
    expect(compiled).toContain('人物与当下状态');
    expect(compiled).toContain('核心冲突');
    expect(compiled).toContain('必须实现');
    expect(compiled).toContain('不得违反');
    expect(compiled).not.toMatch(/outlineSchema|sourceStage|knowledgeBoundary|plotBeats/u);

    const oversized = chapterOutlineV2();
    oversized.mustImplement = ['必须保留'.repeat(800)];
    expect(() => compileChapterOutlineForWriter(oversized, 1_350)).toThrow(/硬信息超过/u);
  });

  it('keeps a detailed outline usable by prioritizing essential facts within a tight writer budget', () => {
    const detailed = chapterOutlineV2();
    detailed.cast = [
      ...(detailed.cast as Array<Record<string, unknown>>),
      {
        name: '配角乙', objective: '确认关键证据', knowledgeBoundary: '只知道证据位置，不知道幕后身份',
        chapterRole: '提供侧面证言', stateChange: '从回避转为愿意作证'
      }
    ];
    detailed.creativeFreedom = ['对白节奏可自由调整', '动作细节可自由选择', '环境意象可自由发挥'];
    const compiled = compileChapterOutlineForWriter(detailed, 1_050);
    expect(compiled.length).toBeLessThanOrEqual(1_050);
    expect(compiled).toContain('配角乙：目标确认关键证据；知情边界只知道证据位置，不知道幕后身份');
    expect(compiled).toContain('必须实现');
    expect(compiled).toContain('不得违反');
  });

  it('rejects a stage-ending outline that postpones the confirmed resolution', () => {
    const master = {
      outlineSchema: 'stage_master_v2',
      premise: '失主必须在期限前找到证人',
      coreConflict: '公开证据与私下操控冲突',
      protagonistArc: '从被动应对到主动举证',
      majorStages: [{
        stageNumber: 1,
        title: '明日归还单',
        chapterRange: { start: 1, end: 10 },
        mainline: {
          encounter: '主角收到来源可疑的归还单',
          resolution: '找到陈月并公开核对原始登记记录',
          result: '确认直接造假者并恢复陈月证人身份'
        },
        structure: { setup: '收到归还单', development: '追查记录', turn: '找到陈月', conclusion: '公开证据' },
        stageSummary: '主角完成第一次公开举证',
        pendingThreads: ['幕后指使者身份'],
        followUpDirection: '追查幕后指使者'
      }],
      endingDirection: '完成公开追责',
      storyPromises: ['证据可追溯'],
      openQuestions: []
    };
    const line = stageBoundaryContractLine([{ sourceType: 'planning:master_outline', content: JSON.stringify(master) }]);
    expect(line).not.toBeNull();
    const bad = parseChapterOutlineV2({
      ...chapterOutlineV2(),
      chapterNumber: 10,
      sourceStage: { stageNumber: 1, title: '明日归还单', chapterRange: { start: 1, end: 10 } },
      requiredEndingState: '证据仍未闭合，陈月身份不得恢复',
      stageBoundary: {
        mustCloseStage: true,
        resolution: '找到陈月并公开核对原始登记记录',
        result: '确认直接造假者并恢复陈月证人身份',
        pendingThreads: ['幕后指使者身份']
      }
    });
    expect(chapterOutlineStageBoundaryFailure(line!, bad)).toMatch(/未完成状态/u);

    const good = parseChapterOutlineV2({
      ...chapterOutlineV2(),
      chapterNumber: 10,
      sourceStage: { stageNumber: 1, title: '明日归还单', chapterRange: { start: 1, end: 10 } },
      requiredEndingState: '陈月恢复证人身份，直接造假者被公开确认',
      stageBoundary: {
        mustCloseStage: true,
        resolution: '找到陈月并公开核对原始登记记录',
        result: '确认直接造假者并恢复陈月证人身份',
        pendingThreads: ['幕后指使者身份']
      }
    });
    expect(chapterOutlineStageBoundaryFailure(line!, good)).toBeNull();
    expect(compileChapterOutlineForWriter({ ...good }, 1_500)).toContain('阶段终章硬要求');
  });

  it('server-binds an exact stage-final contract instead of trusting a model paraphrase', () => {
    const stage = {
      stageNumber: 1,
      title: '明日归还单',
      chapterRange: { start: 1, end: 10 },
      mainline: {
        encounter: '主角收到来源可疑的归还单',
        resolution: '找到陈月并公开核对原始登记记录，依法固定完整证据链',
        result: '确认直接造假者并恢复陈月证人身份，案件正式进入调查程序'
      },
      structure: { setup: '收到归还单', development: '追查记录', turn: '找到陈月', conclusion: '公开证据' },
      stageSummary: '主角完成第一次公开举证',
      pendingThreads: ['幕后指使者身份', '缺失的审批签名'],
      followUpDirection: '追查幕后指使者'
    };
    const modelCandidate = parseChapterOutlineV2({
      ...chapterOutlineV2(),
      chapterNumber: 10,
      sourceStage: { stageNumber: 9, title: '模型自拟阶段', chapterRange: { start: 10, end: 10 } },
      stageBoundary: {
        mustCloseStage: true,
        resolution: '找到陈月并交证据',
        result: '案件进入调查',
        pendingThreads: ['幕后是谁']
      }
    });

    const bound = bindChapterOutlineToAuthoritativeStage(modelCandidate, stage);
    expect(bound.sourceStage).toEqual({
      stageNumber: 1,
      title: '明日归还单',
      chapterRange: { start: 1, end: 10 }
    });
    expect(bound.stageBoundary).toEqual({
      mustCloseStage: true,
      resolution: stage.mainline.resolution,
      result: stage.mainline.result,
      pendingThreads: stage.pendingThreads
    });
  });

  it('removes a model-invented stage boundary from a non-final chapter', () => {
    const stage = {
      stageNumber: 1,
      title: '明日归还单',
      chapterRange: { start: 1, end: 10 },
      mainline: { encounter: '收到归还单', resolution: '公开核验', result: '案件立案' },
      structure: { setup: '收到', development: '追查', turn: '找到证人', conclusion: '公开' },
      stageSummary: '完成举证',
      pendingThreads: ['幕后身份'],
      followUpDirection: '继续追查'
    };
    const modelCandidate = parseChapterOutlineV2({
      ...chapterOutlineV2(),
      chapterNumber: 9,
      sourceStage: { stageNumber: 1, title: '明日归还单', chapterRange: { start: 1, end: 10 } },
      stageBoundary: {
        mustCloseStage: true,
        resolution: '提前解决全部问题',
        result: '提前完结',
        pendingThreads: []
      }
    });

    const bound = bindChapterOutlineToAuthoritativeStage(modelCandidate, stage);
    expect(bound.stageBoundary).toBeUndefined();
  });
});
