import { describe, expect, it } from 'vitest';
import {
  buildCharacterFallbackChain,
  parseCharacterContextSelection,
  parseCharacterMaintenanceOutput,
  validateCharacterRoster
} from './character-memory-runtime.js';

describe('V7人物资料领域合同', () => {
  it('人物资料岗位有三名不同模型的可交接成员', () => {
    expect(validateCharacterRoster()).toEqual([]);
    expect(buildCharacterFallbackChain().map((item) => item.memberKey)).toEqual([
      'character-curator-deepseek-v4-pro', 'character-curator-glm-5-3', 'character-curator-kimi-k3'
    ]);
  });

  it('最小资料包拒绝选择候选范围外人物', () => {
    const valid = JSON.stringify({
      schema: 'v7-character-context-selection-v1',
      selected: [{ entityId: 'character-1', fields: ['profile', 'knowledge'], reason: '本章由她隐瞒真相推动。' }],
      excludedSummary: '其他人不参与本章。', openQuestions: []
    });
    expect(parseCharacterContextSelection(valid, ['character-1', 'character-2']).selected).toHaveLength(1);
    expect(() => parseCharacterContextSelection(valid, ['character-2'])).toThrow(/候选范围外/u);
  });

  it('人物维护结果必须引用本书人物和本次证据', () => {
    const output = JSON.stringify({
      schema: 'v7-character-maintenance-v1', publicSummary: '张三的阵营和知情范围发生变化。',
      affectedEntityIds: ['character-1'],
      changes: [{
        kind: 'profile_update', entityId: 'character-1', fieldPath: 'longTermGoal', proposedValue: '保护小队',
        publicSummary: '长期目标从独自求生转向保护小队。', reason: '结算明确写出主动承担责任。', evidenceRefs: ['settlement-1']
      }],
      issues: [{
        kind: 'continuity_risk', severity: 'important', entityId: 'character-1',
        publicSummary: '张三已经知道内奸身份，后续不能再次装作不知。', evidenceRefs: ['settlement-1'],
        suggestedAction: '后续章纲按已经知情处理。'
      }]
    });
    expect(parseCharacterMaintenanceOutput(output, ['character-1'], ['settlement-1']).issues).toHaveLength(1);
    expect(() => parseCharacterMaintenanceOutput(output, ['character-1'], ['other-evidence'])).toThrow(/未提供的证据/u);
  });

  it('无损兼容模型把人物维护字段换成常见同义键', () => {
    const output = parseCharacterMaintenanceOutput(JSON.stringify({
      schema: 'v7-character-maintenance-v1', publicSummary: '已整理林砚本章变化。',
      affectedEntityIds: ['character-1'],
      changes: [{ changeType: 'profile_update', entityId: 'character-1', field: 'state',
        summary: '林砚取得粮仓钥匙。', evidenceRefs: ['settlement-1'] }],
      issues: [{ category: 'continuity_risk', entityId: 'character-1',
        summary: '下一章不能忘记林砚已经持有钥匙。', evidenceRefs: ['settlement-1'] }]
    }), ['character-1'], ['settlement-1']);
    expect(output.changes[0]).toMatchObject({ kind: 'profile_update', fieldPath: 'state', proposedValue: '林砚取得粮仓钥匙。' });
    expect(output.issues[0]).toMatchObject({ kind: 'continuity_risk', severity: 'important' });
  });

  it('无损兼容模型常用的高、中、低严重度', () => {
    const output = parseCharacterMaintenanceOutput(JSON.stringify({
      schema: 'v7-character-maintenance-v1', publicSummary: '已整理林砚本章变化。',
      affectedEntityIds: ['character-1'], changes: [],
      issues: [
        { kind: 'hard_conflict', severity: 'high', entityId: 'character-1', publicSummary: '硬冲突。', evidenceRefs: ['settlement-1'], suggestedAction: '修正。' },
        { kind: 'continuity_risk', severity: 'medium', entityId: 'character-1', publicSummary: '连续性风险。', evidenceRefs: ['settlement-1'], suggestedAction: '承接。' },
        { kind: 'creative_quality', severity: 'low', entityId: 'character-1', publicSummary: '轻微质量建议。', evidenceRefs: ['settlement-1'], suggestedAction: '润色。' }
      ]
    }), ['character-1'], ['settlement-1']);
    expect(output.issues.map((issue) => issue.severity)).toEqual(['blocking', 'important', 'advisory']);
  });
});
