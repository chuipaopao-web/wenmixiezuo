import { describe, expect, it } from 'vitest';
import { parseVolumePlanContent } from '../../apps/contracts/src/workflow.js';
import { composeStyleToneText } from '../../apps/api/src/contracts/opening-blueprint.js';

function volumeContent() {
  return {
    title: '第一卷', openingState: '主角失去退路', coreGoal: '取得行动资格', coreConflict: '与旧规则冲突',
    failureCost: '盟友受损', characterChanges: ['学会承担选择'], eventSequence: [{ eventId: 'seed-1', order: 1, title: '公开选择',
      responsibility: '建立卷冲突', entryState: '只有线索', trigger: '同伴受损', action: '公开行动', result: '取得有限资格',
      leadsToNext: null, estimatedChapterRange: { minimum: 3, likely: 3, maximum: 5 } }], informationPlan: ['揭示规则由人操纵'],
    escalationAndRecovery: ['进展引发反制'], endingState: '站稳脚跟', openThreads: ['幕后人'], nextVolumeTrigger: '幕后人出手',
    boundaries: { mustAchieve: ['主角行动改变局面'], mustNotViolate: ['不能无代价变强'], creativeFreedom: ['对白与场景自由'], openQuestions: [] }
  };
}

describe('本卷重点表达（focusExpression）', () => {
  it('卷规划合同解析保留重点表达，缺省为 null 兼容旧版本', () => {
    const withFocus = parseVolumePlanContent({ ...volumeContent(), focusExpression: '权谋智斗＋智商在线＋热血爽' });
    expect(withFocus.focusExpression).toBe('权谋智斗＋智商在线＋热血爽');
    const legacy = parseVolumePlanContent(volumeContent());
    expect(legacy.focusExpression).toBeNull();
  });

  it('正文基调文本携带重点表达软参考说明，未填写时只输出基调', () => {
    const withFocus = composeStyleToneText('爽', null, '权谋智斗＋热血爽');
    expect(withFocus).toContain('本卷基调：爽');
    expect(withFocus).toContain('本卷重点表达：权谋智斗＋热血爽');
    expect(withFocus).toContain('软参考');
    expect(withFocus).toContain('不推翻全书基调');
    const withoutFocus = composeStyleToneText('爽', null, null);
    expect(withoutFocus).toContain('本卷基调：爽');
    expect(withoutFocus).not.toContain('重点表达');
    expect(composeStyleToneText(null, null, null)).toBe('');
  });

  it('六维表达方案严格解析、示例强制标注且兼容旧卷版本', () => {
    const parsed = parseVolumePlanContent({ ...volumeContent(), expressionPlan: {
      narrativeOrder: '先结果后追因', pointOfView: '主角限知视角', emotionalTone: '压抑中逐步转燃',
      proseStyle: '短句动作推进，关键选择处放慢', informationRelease: '每次只揭示足够改变选择的一层',
      transitions: '以动作结果切换场景', coordinatedBy: 'deputy_editor', sampleText: '钟声落下，他先看见了门外的影子。'
    } });
    expect(parsed.expressionPlan).toMatchObject({ coordinatedBy: 'deputy_editor', sampleDisclaimer: '示意，非正式正文' });
    expect(parseVolumePlanContent(volumeContent()).expressionPlan).toBeUndefined();
    expect(() => parseVolumePlanContent({ ...volumeContent(), expressionPlan: { narrativeOrder: '只有一项' } })).toThrow(/叙事视角/u);
  });
});