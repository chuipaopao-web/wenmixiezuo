import { describe, expect, it } from 'vitest';
import { manuscriptPrompt, reviewPrompt } from '../../coauthoring-v7/backend/creation-runtime/creation-runtime.js';

describe('V7正文质量提示合同', () => {
  const outline = {
    chapterNumber: 1,
    title: '夜查粮册',
    objective: '确认粮草去向',
    openingHook: '粮车少了一辆。',
    sceneSetup: '边寨粮仓',
    protagonistChoice: '张三决定核对交接记录',
    opposition: '值守者拒绝配合',
    turn: '交接时刻与巡检记录不一致',
    emotionalMovement: '怀疑转为警惕',
    payoff: '锁定需要复查的时段',
    continuity: '承接入营',
    openQuestions: ['谁改了记录？'],
    nextChapterInterface: '寻找第二份可核对证据'
  };

  it('正文和审校同时拦截缺少证据的伪聪明推断', () => {
    expect(manuscriptPrompt({ outline, contextPack: {} })).toContain('不能用脚印深浅、表情或单一巧合直接断定');
    expect(reviewPrompt({ outline, contextPack: {}, manuscript: '待审正文' })).toContain('伪聪明和假推理');
  });
});
