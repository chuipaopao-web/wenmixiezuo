import { describe, expect, it } from 'vitest';
import {
  assessManuscriptMetaNarration,
  assessManuscriptParagraphReuse
} from '@wenmi/contracts';
import { reviewNovel } from '../../apps/api/src/infrastructure/models/deterministic-novel-models.js';
import { toAuthorFacingText } from '../../apps/web/src/app/author-presentation.js';

const ordinaryProse = `第1章 风雪夜归人

风雪压住山门，沈砚把最后一枚灵石塞进药囊。许小川没有接，只用冻红的手指点了点石阶下的新脚印。

“他们来过。”许小川说。

沈砚闻到风里一丝烧焦的阵灰。他没有解释阵纹如何运转，只拔出短剑，沿着脚印消失的方向走进夜色。`;

const leakedProse = `${ordinaryProse}

战后，资料能够回查，但没有人把尚未确认的推测写成正式结论。

本事件只结算正文实际发生的结果，并把新问题交给下一事件。`;

describe('正文故事性硬门禁', () => {
  it('允许自然小说叙事，阻止质量规范和数据审查口吻混入正文', () => {
    expect(assessManuscriptMetaNarration(ordinaryProse)).toEqual({ passed: true, issues: [] });
    expect(assessManuscriptMetaNarration('刑警把笔帽扣上，提醒新人不能把尚未核实的怀疑写成正式结论。').passed).toBe(true);
    const leaked = assessManuscriptMetaNarration(leakedProse);
    expect(leaked.passed).toBe(false);
    expect(leaked.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'source-audit', 'formal-conclusion', 'workflow-result'
    ]));
    expect(reviewNovel(leakedProse).verdict).toBe('rewrite');
  });

  it('跨章只换标题、数字和段落顺序仍判为模板复用', () => {
    const shared = [
      '沈砚踩着没过脚背的积雪绕到石门背后，听见追兵撞上铁索，仍决定先救被困的许小川并承担暴露退路的代价。',
      '许小川抱紧裂开的药箱躲进断墙，发现仅剩的一瓶止血药已经结冰，只能用体温慢慢把药液重新暖开。',
      '守门老人没有立刻相信他们，只把生锈的钥匙压在掌心，要求沈砚先说清昨夜山火究竟从哪一间仓房烧起。',
      '远处钟声突然少了一响，洛清弦意识到巡山队已经改了暗号，原先准备好的接应路线随时可能变成一张网。',
      '石岳把开裂的盾牌横在巷口，明知只能再挡三次冲击，仍催促伤员先走，自己留下计算下一次换位的时机。',
      '叶璃从灰烬里夹出半枚铜扣，纹路与失踪弟子的衣饰相同，但她只记录亲眼所见，没有急着认定凶手身份。',
      '银羽沿屋脊追到河岸，气味却在水边断成两股，它选择独自追较淡的一路，把更安全的判断留给了同伴。',
      '风雪盖住最后一串脚印时，沈砚主动放弃最近的出口，转身走向灯火最亮的客栈，因为那里藏着唯一还醒着的证人。'
    ];
    const first = `第1章 起风\n\n${shared.join('\n\n')}`;
    const second = `第2章 落雪\n\n${[...shared].reverse().join('\n\n').replaceAll('三次', '四次')}`;
    const result = assessManuscriptParagraphReuse(second, first);
    expect(result.passed).toBe(false);
    expect(result.sharedParagraphs).toBeGreaterThanOrEqual(7);
    expect(result.ratio).toBeGreaterThan(0.8);
  });

  it('前端不擅改正文，但遇到内部检查说明时停止裸露', () => {
    expect(toAuthorFacingText(ordinaryProse, 'story')).toBe(ordinaryProse);
    const visible = toAuthorFacingText(leakedProse, 'story');
    expect(visible).toContain('暂停展示');
    expect(visible).not.toContain('正式结论');
    expect(visible).not.toContain('结算正文实际发生');
    expect(toAuthorFacingText('人物刚走进雨巷，ContextPack开始编译。', 'story')).toContain('暂停展示');
  });
});
