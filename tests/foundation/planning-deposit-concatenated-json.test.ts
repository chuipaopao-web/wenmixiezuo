import { describe, expect, it } from 'vitest';
import { parsePlanningDepositOutput } from '../../apps/api/src/application/artifacts/planning-artifact-service.js';

describe('规划落库真实模型输出兼容', () => {
  it('识别连续输出且省略“规划落库”标记的第二个JSON对象', () => {
    const result = parsePlanningDepositOutput([
      '{"answer":"先完成资格确认","keyPoints":["保留旧法代价"]}',
      '{"arcTitle":"枯井审计","arcGoal":"查清旧账","endingState":"取得议事资格","estimatedChapterRange":{"minimum":3,"recommended":3,"maximum":5},"chapters":[{"title":"持器者言","goal":"取得老人会授权","beats":["陈述残页来源","老人会限定解释边界"],"hook":"稽核吏送来烂账抄本"}]}'
    ].join('\n'));

    expect(result).toMatchObject({
      arcTitle: '枯井审计',
      chapters: [{
        title: '持器者言',
        goal: '取得老人会授权',
        beats: ['陈述残页来源', '老人会限定解释边界'],
        hook: '稽核吏送来烂账抄本'
      }]
    });
  });
});
