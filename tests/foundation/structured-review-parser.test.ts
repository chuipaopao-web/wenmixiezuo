import { describe, expect, it } from 'vitest';
import { parseStructuredReview } from '../../apps/api/src/application/creation/chapter-pipeline-service.js';

describe('真实审校模型结构化输出解析', () => {
  it('接受JSON代码围栏并严格校验字段', () => {
    const review = parseStructuredReview(`\`\`\`json
      {"verdict":"rewrite","summary":"有一处节奏问题","issues":[{"location":"中段","issueType":"pacing","severity":"minor","evidence":"连续说明","requiredAction":"改为行动"}],"scores":{"continuity":90,"character":88,"pacing":72,"style":86,"hook":91}}
    \`\`\``);
    expect(review).toMatchObject({ verdict: 'rewrite', issues: [{ severity: 'minor' }], scores: { pacing: 72 } });
  });

  it('拒绝缺字段或越界评分，防止不合格输出进入正式审校记录', () => {
    expect(() => parseStructuredReview('{"verdict":"pass","summary":"好","issues":[],"scores":{"continuity":101}}'))
      .toThrow(/评分|scores/u);
    expect(() => parseStructuredReview('不是JSON')).toThrow(/JSON/u);
  });

  it('拒绝用空白文本伪装可执行审校问题', () => {
    expect(() => parseStructuredReview(JSON.stringify({
      verdict: 'rewrite', summary: '需要修改',
      issues: [{ location: '  ', issueType: 'continuity', severity: 'major', evidence: '证据', requiredAction: '修复' }],
      scores: { continuity: 80, character: 80, pacing: 80, style: 80, hook: 80 }
    }))).toThrow('location');
  });
});
