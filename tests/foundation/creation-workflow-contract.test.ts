import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CREATION_WORKFLOW_CONTRACT_VERSION,
  LEGACY_NARRATIVE_TEMPLATE_IDS,
  NARRATIVE_TEMPLATE_REGISTRY,
  NARRATIVE_TEMPLATE_REGISTRY_HASH,
  buildNarrativeTemplatePreview,
  creationWorkflowStages,
  getPublicNarrativeTemplateCatalog,
  hashStableContractContent,
  parseAuthorPlanningInputDraft,
  resolveNarrativeTemplate,
  workspaceFunctionAuthorInputSurfaces,
  workspaceFunctionLabel,
  workspacePrimaryFunctionKeys,
  workspaceUtilityFunctionKeys
} from '@wenmi/contracts';

const previousPatternIds = [
  'hidden-power-reveal', 'face-slap-reversal', 'underdog-counterattack', 'trap-countertrap',
  'continuous-leveling', 'trial-breakthrough', 'territory-building', 'career-rise',
  'mutual-redemption', 'wife-chasing', 'enemies-to-lovers', 'reunion-repair',
  'closed-circle-mystery', 'dual-timeline-truth', 'hidden-identity', 'countdown-rescue',
  'court-power-rise', 'campaign-victory', 'reform-resistance', 'dungeon-first-clear',
  'season-championship', 'guild-war', 'startup-survival', 'family-comeback',
  'revenge-settlement', 'rebirth-correction', 'system-task-chain', 'farming-development',
  'academy-competition', 'mentor-legacy', 'contract-romance', 'secret-love-realized',
  'family-repair', 'serial-investigation', 'survival-evacuation', 'post-disaster-rebuild',
  'interstellar-expedition', 'entertainment-rise', 'medical-breakthrough', 'legal-reversal',
  'espionage-infiltration', 'succession-struggle', 'slice-of-life-healing', 'rule-horror',
  'folklore-investigation'
] as const;

describe('创作工作流共享合同', () => {
  it('统一功能名称并保持数据库surface键稳定', () => {
    expect(workspacePrimaryFunctionKeys.map(workspaceFunctionLabel)).toEqual([
      '信息', '设定', '分卷', '规划', '章纲', '正文', '资料库', '取名'
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

  it('卷与事件使用不同模板集合，公开字段不泄漏内部方法名', () => {
    const volume = getPublicNarrativeTemplateCatalog('volume', ['悬疑', '秘密']);
    const event = getPublicNarrativeTemplateCatalog('event', ['关系']);
    expect(CREATION_WORKFLOW_CONTRACT_VERSION).toBe(1);
    expect(volume.registryHash).toBe(NARRATIVE_TEMPLATE_REGISTRY_HASH);
    expect(volume.templates.length).toBeGreaterThanOrEqual(6);
    expect(event.templates.length).toBeGreaterThanOrEqual(6);
    expect(volume.templates.every((item) => item.scope === 'volume')).toBe(true);
    expect(event.templates.every((item) => item.scope === 'event')).toBe(true);
    expect(JSON.stringify(volume)).not.toMatch(/sourceMethod|legacyIds|Save the Cat/iu);
    expect(volume.templates.every((item) => !/三幕|五幕|猫咪/iu.test(`${item.publicTitle}${item.publicExplanation}`))).toBe(true);
    expect(JSON.stringify(volume)).not.toMatch(/sourceLabel|三幕式|五幕式|救猫咪结构/iu);
    expect(volume.templates[0]).toMatchObject({ recommended: true });
    expect(volume.alternativeChoices.map((item) => item.mode)).toEqual(['custom', 'none']);
  });

  it('模板版本与内容哈希稳定、唯一且不包含作品事实', () => {
    expect(NARRATIVE_TEMPLATE_REGISTRY_HASH).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(new Set(NARRATIVE_TEMPLATE_REGISTRY.map((item) => item.templateKey)).size).toBe(NARRATIVE_TEMPLATE_REGISTRY.length);
    expect(NARRATIVE_TEMPLATE_REGISTRY.every((item) => item.templateVersion === 2 && /^sha256:[0-9a-f]{64}$/u.test(item.contentHash))).toBe(true);
    expect(hashStableContractContent('abc')).toBe(`sha256:${createHash('sha256').update(JSON.stringify('abc')).digest('hex')}`);
    const serialized = JSON.stringify(NARRATIVE_TEMPLATE_REGISTRY);
    expect(serialized).not.toContain('ownerId');
    expect(serialized).not.toContain('bookId');
    expect(serialized).not.toContain('chapterNumber');
  });

  it('旧模式ID全部可以解析为当前模板，但不重新成为公开标题', () => {
    expect(LEGACY_NARRATIVE_TEMPLATE_IDS).toEqual(expect.arrayContaining([...previousPatternIds]));
    for (const legacyId of previousPatternIds) {
      const resolved = resolveNarrativeTemplate(legacyId);
      expect(resolved, legacyId).not.toBeNull();
      expect(resolved?.publicTitle).not.toBe(legacyId);
    }
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

  it('状态机覆盖从开书到下一卷，预览不替作者虚构桥段', () => {
    expect(creationWorkflowStages[0]).toBe('book_profile_draft');
    expect(creationWorkflowStages.at(-1)).toBe('ready_for_next_volume');
    const template = getPublicNarrativeTemplateCatalog('volume').templates[0]!;
    expect(buildNarrativeTemplatePreview(template, {
      bookTitle: '长夜', protagonistName: '林澈', currentGoal: '守住同伴'
    })).toContain('《长夜》可以围绕“守住同伴”');
  });
});
