import { describe, expect, it } from 'vitest';
import { chapterOutlineHardBoundaryFailure } from '../../apps/api/src/domain/chapter-outline-boundaries.js';

function outline(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: '程序缝隙',
    chapterFunction: '主角依法申请调阅日志',
    openingState: '证据不足',
    requiredEndingState: '取得正式受理回执',
    cast: [{ name: '林澄', objective: '固定证据' }],
    conflict: { surface: '权限不足', failureCost: '日志将按制度覆盖' },
    plotBeats: [{ order: 1, trigger: '窗口将关闭', action: '提交申请', result: '获得回执' }],
    ending: { result: '申请获受理', hook: '日志仍缺一段', nextChapterInterface: '寻找纸质记录' },
    mustImplement: ['程序内取证'],
    mustNotViolate: ['不得出现超自然能力或万能黑客技术'],
    ...overrides
  };
}

describe('chapter outline hard-boundary guard', () => {
  it('allows an ordinary real-world deadline and archival process', () => {
    expect(chapterOutlineHardBoundaryFailure('', outline())).toBeNull();
  });

  it('rejects a rule engine that contradicts an explicit no-supernatural boundary', () => {
    expect(chapterOutlineHardBoundaryFailure('', outline({
      chapterFunction: '交出物件换延期并后移违约线',
      openingState: '违约线只剩十三分钟',
      conflict: { surface: '拿什么物件交换延期', failureCost: '系统惩罚立即触发' }
    }))).toMatch(/硬边界冲突/u);
  });

  it('does not turn a soft realistic preference into a hard ban', () => {
    expect(chapterOutlineHardBoundaryFailure('希望整体写实，但允许少量奇幻隐喻', outline({
      mustNotViolate: ['不得靠巧合解决真相'],
      chapterFunction: '用记忆实体化的意象表现创伤'
    }))).toBeNull();
  });

  it('uses an explicit owner boundary from the planning scope', () => {
    expect(chapterOutlineHardBoundaryFailure('老板要求：不出现超自然或万能黑客。', outline({
      mustNotViolate: ['不得让主角提前知道真相'],
      chapterFunction: '归还任务界面自行触发系统惩罚'
    }))).toMatch(/硬边界冲突/u);
  });

  it('does not mistake a negative implementation guard for supernatural story content', () => {
    expect(chapterOutlineHardBoundaryFailure('', outline({
      mustImplement: ['推力必须来自现实人物或机构的应激行为，不得使用系统自动推送或超自然干预']
    }))).toBeNull();
  });

  it('still rejects supernatural content in an actual plot beat', () => {
    expect(chapterOutlineHardBoundaryFailure('', outline({
      plotBeats: [{
        order: 1,
        trigger: '窗口将关闭',
        action: '提交申请',
        result: '超自然力量自动改写归还单'
      }]
    }))).toMatch(/硬边界冲突/u);
  });
});
