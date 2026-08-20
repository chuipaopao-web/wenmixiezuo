import { describe, expect, it } from 'vitest';
import {
  firstVolumeCoverageResponsibilityValues,
  parseEventChainContent,
  parseVolumeDirectionContent,
  parseVolumeRouteSelection
} from '../../apps/contracts/src/index.js';

function launchPlan() {
  return {
    primaryDrivers: ['人物魅力', '强冲突'],
    immersionAnchor: '读者跟着主角承受一次必须立刻表态的公开选择',
    first500Interest: {
      readerQuestion: '主角为什么宁可失去资格也不肯说出真相',
      immediateSituation: '公开审问已经开始，沉默也会被视为认罪',
      emotionalGrip: '主角既害怕牵连同伴，又无法背叛自己的承诺',
      promisedMovement: '他将在所有人面前作出改变局面的选择'
    },
    goldenThree: [
      { chapterNumber: 1, responsibility: '进入困境并启动故事', protagonistAction: '拒绝按既定口径认罪', pressureOrPull: '同伴被带到现场', deliveredPayoff: '读者确认主角并非被动挨打', nextExpectation: '他准备拿出什么证据' },
      { chapterNumber: 2, responsibility: '主动行动并展示独特看点', protagonistAction: '利用只有他能识别的规则漏洞反查', pressureOrPull: '对手提前销毁记录', deliveredPayoff: '找到一条可验证的异常', nextExpectation: '异常指向最不该被怀疑的人' },
      { chapterNumber: 3, responsibility: '完成第一次回报并打开更大问题', protagonistAction: '公开证明指控的一部分是伪造', pressureOrPull: '证明会暴露自己的秘密', deliveredPayoff: '暂时保住同伴和行动资格', nextExpectation: '伪造者为何知道他的秘密' }
    ],
    earlyMomentum: ['处境、关系和信息持续发生有效变化', '回报后立即形成更难的新选择'],
    majorClimax: {
      promiseToFulfill: '主角将亲手推翻公开审判背后的控制关系',
      centralChoice: '保住既得身份还是公开完整证据',
      cost: '失去原有身份与安全区',
      centralConflictChange: '对手从暗中操控转为公开对抗',
      irreversibleChange: '主角与旧组织彻底决裂',
      nextStageTrigger: '证据揭示更高层的共同敌人',
      noLaterThanEffectiveChars: 100000
    },
    variationAndRecovery: ['审问、追查、关系谈判和短暂日常交替', '高潮前留出关系回报和蓄力'],
    forbiddenShortcuts: ['连续重复身份曝光', '靠偶然证人解决核心冲突']
  };
}

function direction() {
  return {
    title: '失名者之卷',
    openingSituation: '主角在公开审问中失去解释权',
    protagonistDrive: '保护同伴并夺回对自己故事的定义权',
    volumeGoal: '查明伪造指控的来源并改变审判规则',
    centralOpposition: '掌握程序和证据解释权的旧组织',
    escalationPath: ['先证明一处异常', '追查异常背后的协作链', '被迫公开自己的秘密'],
    majorChoices: ['是否以自己的身份为代价公开完整证据'],
    relationshipMovement: ['主角与同伴从保护与被保护转为共同承担'],
    expressionFocus: ['选择的代价', '关系中的信任'],
    climaxResponsibility: '兑现主角夺回定义权的承诺并改变主要对抗局面',
    costAndConsequence: '主角保住同伴，却失去旧身份与退路',
    closingState: '主角获得主动权，同时进入更公开、更危险的新局面',
    benefits: ['人物行动与长期主题合一'],
    risks: ['审问信息过多时会削弱场景张力'],
    openSpaces: ['真正幕后者的身份保持开放'],
    firstVolumeLaunch: launchPlan()
  };
}

describe('分层创作正式合同', () => {
  it('第一卷方向只保存大故事方向和强启动，不内嵌事件链', () => {
    const parsed = parseVolumeDirectionContent(direction(), true);
    expect(parsed.title).toBe('失名者之卷');
    expect(parsed.firstVolumeLaunch?.majorClimax.noLaterThanEffectiveChars).toBe(100000);
    expect(parsed).not.toHaveProperty('eventSequence');
  });

  it('后续卷不能误带首卷强启动，第一卷也不能缺少它', () => {
    const withLaunch = direction();
    expect(() => parseVolumeDirectionContent(withLaunch, false)).toThrow('只属于第一卷');
    const { firstVolumeLaunch: _launch, ...withoutLaunch } = withLaunch;
    expect(() => parseVolumeDirectionContent(withoutLaunch, true)).toThrow('必须包含首卷强启动');
  });

  it('首卷事件链必须完整覆盖七类启动责任和卷责任', () => {
    const parsed = parseEventChainContent({
      volumeDirectionVersionId: 'direction-v1',
      events: [{
        nodeId: 'event-node-1',
        order: 1,
        title: '公开审问',
        volumeResponsibility: '启动、首次回报并建立高潮因果',
        entryState: '主角失去解释权',
        protagonistAction: '拒绝认罪并反查证据',
        oppositionEscalation: '对手销毁记录并牵连同伴',
        stagePayoffOrCost: '保住同伴但暴露秘密',
        exitState: '主角获得追查入口',
        leadsToNext: null,
        plantThreadIds: ['thread-1'],
        payoffThreadIds: [],
        consequenceThreadIds: ['thread-2'],
        firstVolumeResponsibilities: [...firstVolumeCoverageResponsibilityValues]
      }],
      coverage: [{
        responsibility: '完成本卷启动并把状态交给后续追查',
        eventNodeIds: ['event-node-1'],
        status: 'covered'
      }]
    }, true);
    expect(parsed.events[0]?.firstVolumeResponsibilities).toHaveLength(7);
  });

  it('拒绝没有责任承载事件的形式化事件链', () => {
    expect(() => parseEventChainContent({
      volumeDirectionVersionId: 'direction-v1',
      events: [{
        nodeId: 'event-node-1', order: 1, title: '空转事件', volumeResponsibility: '无',
        entryState: '原状', protagonistAction: '等待', oppositionEscalation: '无',
        stagePayoffOrCost: '无变化', exitState: '原状', leadsToNext: null,
        plantThreadIds: [], payoffThreadIds: [], consequenceThreadIds: [],
        firstVolumeResponsibilities: []
      }],
      coverage: [{ responsibility: '高潮兑现', eventNodeIds: [], status: 'gap' }]
    }, false)).toThrow('不能确认');
  });

  it('分段融合只接受稳定方案、版本和片段标识', () => {
    const parsed = parseVolumeRouteSelection({
      selectionMode: 'fragments',
      fragments: [{
        fragmentId: 'fragment-a-goal',
        field: 'volumeGoal',
        sourceProposalId: 'proposal-a',
        sourceVersionId: 'direction-a-v1'
      }],
      authorNotes: '高潮采用方案二，其余沿用方案一'
    });
    expect(parsed.fragments[0]).toEqual(expect.objectContaining({
      fragmentId: 'fragment-a-goal',
      sourceProposalId: 'proposal-a'
    }));
  });
});
