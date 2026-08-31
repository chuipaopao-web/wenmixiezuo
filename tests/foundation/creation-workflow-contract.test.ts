import { describe, expect, it } from 'vitest';
import {
  CREATION_WORKFLOW_CONTRACT_VERSION,
  creationWorkflowStages,
  parseAuthorPlanningInputDraft,
  workspaceFunctionAuthorInputSurfaces,
  workspaceFunctionLabel,
  workspacePrimaryFunctionKeys,
  workspaceUtilityFunctionKeys
} from '@wenmi/contracts';

describe('创作工作流共享合同', () => {
  it('统一功能名称并保持数据库surface键稳定', () => {
    expect(workspacePrimaryFunctionKeys.map(workspaceFunctionLabel)).toEqual([
      '故事线', '设定', '分卷', '事件', '章节', '章节', '资料库', '取名'
    ]);
    expect(workspaceUtilityFunctionKeys.map(workspaceFunctionLabel)).toEqual(['团队', '任务', '灵感', '设置']);
    expect(workspaceFunctionAuthorInputSurfaces).toEqual({
      framework: 'book_profile', basic: 'setting', master: 'volume_plan', event: 'event',
      chapter: 'chapter_outline', manuscript: 'manuscript'
    });
    expect(Object.values(workspaceFunctionAuthorInputSurfaces).every((surface) =>
      surface === undefined || ['book_profile', 'setting', 'volume_plan', 'event', 'chapter_outline', 'manuscript'].includes(surface)
    )).toBe(true);
  });

  it('作者想法保留原话、意图和作用位置并拒绝非法值', () => {
    expect(parseAuthorPlanningInputDraft({
      surface: 'event', subjectType: 'story_event', subjectId: 'event-1', intentStrength: 'must',
      originalText: '  主角这次必须靠前文的阵法知识取胜。  ', attachmentRefs: ['note-1', 'note-1'],
      mentionedAgentIds: ['writer-1', 'writer-1'], scopeNotes: null
    })).toEqual({
      surface: 'event', subjectType: 'story_event', subjectId: 'event-1', intentStrength: 'must',
      originalText: '主角这次必须靠前文的阵法知识取胜。', attachmentRefs: ['note-1'],
      mentionedAgentIds: ['writer-1'], scopeNotes: null
    });
    expect(() => parseAuthorPlanningInputDraft({
      surface: 'event', subjectType: 'story_event', subjectId: null, intentStrength: 'hard',
      originalText: '想法', attachmentRefs: [], scopeNotes: null
    })).toThrow('意图强度');
    expect(parseAuthorPlanningInputDraft({
      surface: 'setting', subjectType: 'setting', subjectId: null, intentStrength: 'preference',
      originalText: '保留旧客户端写下的想法。', attachmentRefs: [], scopeNotes: null
    }).mentionedAgentIds).toEqual([]);
  });

  it('状态机覆盖从开书到下一卷', () => {
    expect(CREATION_WORKFLOW_CONTRACT_VERSION).toBe(1);
    expect(creationWorkflowStages[0]).toBe('book_profile_draft');
    expect(creationWorkflowStages.at(-1)).toBe('ready_for_next_volume');
  });
});
