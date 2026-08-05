import { describe, expect, it } from 'vitest';
import { parseProductionReview } from '../../apps/api/src/contracts/production-review.js';

describe('事实审校的权威层级', () => {
  it('修复后的事实报告把临时稿与已定稿前文冲突降为可重写问题，而不是要求老板重裁正史', () => {
    const expected = {
      reviewerRole: 'fact' as const,
      manuscriptVersionId: 'draft-2',
      modelSnapshotId: 'fact-model'
    };
    const raw = JSON.stringify({
      ...expected,
      verdict: 'blocked',
      summary: '本章临时稿写错了已定稿物证，应服从前章正史。',
      issues: [{
        location: '本章伞柄描写',
        issueType: '当前正文与已确认正史冲突',
        severity: 'blocker',
        evidence: '本章写塑料伞柄，前章定稿写木质伞柄。',
        requiredAction: '修正本章描写，统一为前章已经定稿的木质伞柄。'
      }],
      scores: { continuity: 20 },
      factCandidates: []
    });

    const report = parseProductionReview(raw, expected, {
      normalizeLocalBlockers: true,
      normalizeRepairedVerdict: true,
      normalizeProvisionalDraftBlockers: true
    });
    expect(report).toMatchObject({
      verdict: 'rewrite',
      issues: [{ severity: 'major' }]
    });
  });

  it.each([
    ['颜色漂移', '本章写卡包是灰色，前章定稿明确写同一卡包为深蓝色，前后不一致。', '统一为前章定稿的深蓝色。'],
    ['编号种类混淆', '本章把TEMP-0614-02称为物证袋编号，前章定稿明确它是临时账号，两个编号种类发生混淆。', '修正本章，区分临时账号与物证袋编号。'],
    ['尺寸冲突', '本章写同一碎片为4×2毫米，前章定稿写约3厘米长、12毫米宽，尺寸明确矛盾。', '修正本章尺寸，统一到前章定稿。'],
    ['时间线矛盾', '本章说今天是6月16日，却把前章6月15日的归还日期称为明天，时间线冲突。', '更正本章相对日期称呼。']
  ])('把模型已明确写出的%s从minor/pass校正为major/rewrite', (issueType, evidence, requiredAction) => {
    const expected = {
      reviewerRole: 'fact' as const,
      manuscriptVersionId: 'draft-2',
      modelSnapshotId: 'fact-model'
    };
    const report = parseProductionReview(JSON.stringify({
      ...expected,
      verdict: 'pass',
      summary: '发现一处可以定点修复的事实问题。',
      issues: [{ location: '当前正文与前章定稿对照', issueType, severity: 'minor', evidence, requiredAction }],
      scores: { continuity: 45 },
      factCandidates: []
    }), expected);

    expect(report).toMatchObject({ verdict: 'rewrite', issues: [{ severity: 'major' }] });
  });

  it('不把可选解释或前文未复述误判为客观矛盾', () => {
    const expected = {
      reviewerRole: 'fact' as const,
      manuscriptVersionId: 'draft-2',
      modelSnapshotId: 'fact-model'
    };
    const report = parseProductionReview(JSON.stringify({
      ...expected,
      verdict: 'pass',
      summary: '只有一项可选说明。',
      issues: [{
        location: '本章开头', issueType: '说明不足', severity: 'minor',
        evidence: '前章提过雨伞，本章没有再次复述颜色，但正文也没有否认或改变该事实。',
        requiredAction: '可以补一句前情，也可以保持留白。'
      }],
      scores: { continuity: 88 },
      factCandidates: []
    }), expected);

    expect(report).toMatchObject({ verdict: 'pass', issues: [{ severity: 'minor' }] });
  });
});
