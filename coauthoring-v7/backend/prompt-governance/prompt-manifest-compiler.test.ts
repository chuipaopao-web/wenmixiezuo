import { describe, expect, it } from 'vitest';
import {
  V7_GENRE_PERSONA_ASSETS,
  V7_TASK_ALLOWED_WORKSTATIONS,
  V7_ROLE_PROMPT_ASSETS,
  V7_SKILL_PROMPT_ASSETS,
  V7_WORKSTATION_PROMPT_ASSETS,
  compileGenreFusionPrompt,
  compilePromptManifest,
  defaultSkillAssets,
  matchGenreAssets,
  sha256,
  validateBookGenreProfile,
  type V7BookGenreProfile,
  type V7ContextPackTrace,
  type V7TaskContract
} from './index.js';
import {
  V7_ROLE_CONTRACTS,
  V7_TASK_TEMPERATURE_POLICIES,
  modelBindingForProfile,
  taskTemperaturePolicy
} from '../agent-governance/agent-governance-registry.js';

const now = '2026-08-28T08:00:00.000Z';
const glmExecution = { ...modelBindingForProfile('glm-5.3'), maxOutputTokens: 6_000 } as const;
const contract: V7TaskContract = {
  contractId: 'contract-1', version: 1, ownerId: 'owner-1', bookId: 'book-1', taskId: 'task-1',
  taskKind: 'planning_tree', workstationKey: 'full_book_route', operationMode: 'fresh', objective: '设计三套全书粗路线',
  mustPreserve: ['主角是张三', '时代是北宋'], allowedChanges: ['卷数与阶段路线'],
  forbiddenChanges: ['替换主角', '把候选当正文'], successCriteria: ['容量匹配300万字', '卷间因果递进'],
  outputContract: { options: '三套差异明确的候选' },
  selectedSkillKeys: ['data-boundary', 'option-differentiation'],
  authorInstructionVersion: 1, basedOnTaskId: null, createdAt: now
};
const context: V7ContextPackTrace = {
  contextPackId: 'pack-1', ownerId: 'owner-1', bookId: 'book-1', taskId: 'task-1', policyVersion: 'v1',
  tokenBudget: 8_000, estimatedTokens: 300, contentHash: 'pack-hash', createdAt: now,
  sources: [{ ownerId: 'owner-1', bookId: 'book-1', sourceKey: 'opening', sourceType: 'book_profile', sourceId: 'profile-1', sourceVersion: '3',
    authority: 'confirmed', decision: 'included', reason: '全书路线必需', contentHash: 'source-hash', estimatedTokens: 300 }],
  content: { opening: { protagonist: '张三', era: '北宋' } }
};

describe('V7 prompt governance', () => {
  it('provides complete versioned source registries and task workstation mapping', () => {
    expect(V7_ROLE_PROMPT_ASSETS).toHaveLength(7);
    expect(V7_WORKSTATION_PROMPT_ASSETS.length).toBeGreaterThanOrEqual(12);
    expect(V7_GENRE_PERSONA_ASSETS.length).toBeGreaterThanOrEqual(16);
    expect(V7_SKILL_PROMPT_ASSETS.length).toBeGreaterThanOrEqual(7);
    expect(matchGenreAssets(['历史脑洞', '悬疑推理']).map((item) => item.assetKey)).toEqual(['genre.history', 'genre.suspense']);
  });

  it('maps every governed task to a fixed role, legal workstation, default Skill and temperature contract', () => {
    for (const policy of V7_TASK_TEMPERATURE_POLICIES) {
      expect(V7_ROLE_CONTRACTS.some((role) => role.taskKinds.includes(policy.taskKind))).toBe(true);
      expect(V7_TASK_ALLOWED_WORKSTATIONS[policy.taskKind]?.length).toBeGreaterThan(0);
      expect(defaultSkillAssets(policy.taskKind).length).toBeGreaterThan(0);
      expect(taskTemperaturePolicy(policy.taskKind)).toEqual(policy);
    }
  });

  it('builds one semantic fusion task instead of concatenating genre prompts', () => {
    const genres = matchGenreAssets(['历史脑洞', '悬疑推理']);
    const prompt = compileGenreFusionPrompt({ taskContract: { ...contract, taskKind: 'planning_context', workstationKey: 'full_book_route', operationMode: 'fusion' },
      primaryGenre: genres[0]!, supportingGenres: [genres[1]!], confirmedBookBrief: { protagonist: '张三', era: '北宋' } });
    expect(prompt).toContain('主体题材决定主要阅读承诺');
    expect(prompt).toContain('不是拼接题材卡');
    expect(prompt).not.toContain('思维过程');
  });

  it('compiles deterministically and freezes all version references', () => {
    const role = V7_ROLE_PROMPT_ASSETS.find((item) => item.assetKey === 'role.planning_writer')!;
    const workstation = V7_WORKSTATION_PROMPT_ASSETS.find((item) => item.assetKey === 'workstation.full_book_route')!;
    const genre: V7BookGenreProfile = {
      profileId: 'genre-profile-1', ownerId: 'owner-1', bookId: 'book-1', version: 1, status: 'active',
      primaryGenreKey: 'history', supportingGenreKeys: ['suspense'], sourceAssetVersionIds: ['genre.history@1', 'genre.suspense@1'],
      sourceBookVersion: 3, publicLabel: '历史穿越×悬疑权谋', workingIdentity: '用北宋真实秩序约束穿越者行动，以谜案推动势力与人物关系变化。',
      primaryPromise: '在时代限制中改变历史局面', supportingFunctions: ['悬疑只负责持续问题与公平揭晓'],
      writingPriorities: ['人物行动先于知识炫技'], authenticityChecks: ['年代与制度一致'], avoidPatterns: ['现代知识无成本碾压'],
      conflictResolutions: ['历史真实性优先，谜案不改写已确认史实'], compiledByTaskId: 'genre-task-1', createdAt: now
    };
    expect(validateBookGenreProfile(genre, matchGenreAssets(['历史脑洞', '悬疑推理']))).toEqual([]);
    const input = { manifestId: 'manifest-1', memberKey: 'planner-deepseek-v4-pro', modelProfileKey: 'deepseek-v4-pro',
      ...modelBindingForProfile('deepseek-v4-pro'), maxOutputTokens: 12_000,
      governanceRevision: 4, temperature: .66, rolePrompt: role, workstationPrompt: workstation, genreProfile: genre,
      skills: V7_SKILL_PROMPT_ASSETS.filter((item) => ['skill.data-boundary', 'skill.option-differentiation'].includes(item.assetKey)),
      taskContract: contract, contextPack: context, allowedTools: ['正式资料读取', '方法候选读取'], createdAt: now } as const;
    const first = compilePromptManifest(input);
    const second = compilePromptManifest(input);
    expect(first.compiledPromptHash).toBe(second.compiledPromptHash);
    expect(first.compiledPromptHash).toBe(sha256(first.compiledPrompt));
    expect(first.skillVersionIds).toEqual(['skill.data-boundary@2', 'skill.option-differentiation@1']);
    expect(first.workstationKey).toBe('full_book_route');
    expect(first).toMatchObject({ provider: 'volcengine-ark-coding-plan', modelId: 'deepseek-v4-pro', plan: 'coding', maxOutputTokens: 12_000 });
    expect(first.compiledPrompt).not.toContain('memberSupplement');
    expect(first.compiledPrompt).not.toContain('owner-1');
    expect(first.compiledPrompt).not.toContain('source-hash');
    expect(first.compiledPrompt).not.toContain('genre.history@1');
  });

  it('allows no supporting function only when there is no supporting genre', () => {
    const standalone: V7BookGenreProfile = {
      profileId: 'genre-profile-single', ownerId: 'owner-1', bookId: 'book-1', version: 1, status: 'active',
      primaryGenreKey: 'history', supportingGenreKeys: [], sourceAssetVersionIds: ['genre.history@1'], sourceBookVersion: 3,
      publicLabel: '历史成长', workingIdentity: '以真实历史条件约束人物选择，让小人物在代价中逐步改变自己的处境。',
      primaryPromise: '在历史限制中兑现持续成长与选择后果。', supportingFunctions: [],
      writingPriorities: ['人物行动先于知识炫技'], authenticityChecks: ['年代与制度一致'], avoidPatterns: ['现代知识无成本碾压'],
      conflictResolutions: [], compiledByTaskId: 'genre-task-single', createdAt: now
    };
    expect(validateBookGenreProfile(standalone, matchGenreAssets(['历史脑洞']))).toEqual([]);
    expect(validateBookGenreProfile({
      ...standalone,
      supportingGenreKeys: ['suspense'],
      sourceAssetVersionIds: ['genre.history@1', 'genre.suspense@1']
    }, matchGenreAssets(['历史脑洞', '悬疑推理']))).toContain('辅助功能需要1至8项');
  });

  it('rejects cross-book context and secret-like content', () => {
    const role = V7_ROLE_PROMPT_ASSETS.find((item) => item.assetKey === 'role.planning_writer')!;
    const workstation = V7_WORKSTATION_PROMPT_ASSETS.find((item) => item.assetKey === 'workstation.full_book_route')!;
    expect(() => compilePromptManifest({ manifestId: 'bad', memberKey: 'm', modelProfileKey: 'glm-5.3', ...glmExecution, governanceRevision: 1,
      temperature: .6, rolePrompt: role, workstationPrompt: workstation, genreProfile: null, skills: [], taskContract: contract,
      contextPack: { ...context, bookId: 'other-book' }, allowedTools: [], createdAt: now })).toThrow('范围不一致');
    expect(() => compilePromptManifest({ manifestId: 'bad-source', memberKey: 'm', modelProfileKey: 'glm-5.3', ...glmExecution, governanceRevision: 1,
      temperature: .6, rolePrompt: role, workstationPrompt: workstation, genreProfile: null, skills: [], taskContract: contract,
      contextPack: { ...context, sources: context.sources.map((source) => ({ ...source, bookId: 'other-book' })) },
      allowedTools: [], createdAt: now })).toThrow('资料来源与任务合同范围不一致');
    const crossBookGenre: V7BookGenreProfile = {
      profileId: 'cross-book-profile', ownerId: 'owner-1', bookId: 'other-book', version: 1, status: 'active',
      primaryGenreKey: 'history', supportingGenreKeys: [], sourceAssetVersionIds: ['genre.history@1'], sourceBookVersion: 1,
      publicLabel: '历史', workingIdentity: '只用于验证跨书边界的完整题材工作身份。', primaryPromise: '历史阅读体验',
      supportingFunctions: ['无'], writingPriorities: ['准确'], authenticityChecks: ['年代'], avoidPatterns: ['错置'],
      conflictResolutions: [], compiledByTaskId: 'genre-task', createdAt: now
    };
    expect(() => compilePromptManifest({ manifestId: 'bad-genre', memberKey: 'm', modelProfileKey: 'glm-5.3', ...glmExecution, governanceRevision: 1,
      temperature: .6, rolePrompt: role, workstationPrompt: workstation, genreProfile: crossBookGenre, skills: [], taskContract: contract,
      contextPack: context, allowedTools: [], createdAt: now })).toThrow('题材工作档案与任务合同范围不一致');
    expect(() => compilePromptManifest({ manifestId: 'bad', memberKey: 'm', modelProfileKey: 'glm-5.3', ...glmExecution, governanceRevision: 1,
      temperature: .6, rolePrompt: role, workstationPrompt: workstation, genreProfile: null,
      skills: V7_SKILL_PROMPT_ASSETS.filter((item) => ['skill.data-boundary', 'skill.option-differentiation'].includes(item.assetKey)),
      taskContract: contract,
      contextPack: { ...context, content: { key: 'ark-secret-value-123456789' } }, allowedTools: [], createdAt: now })).toThrow('疑似密钥');
    expect(() => compilePromptManifest({ manifestId: 'bad-binding', memberKey: 'm', modelProfileKey: 'glm-5.3',
      provider: 'volcengine-ark-agent-plan', modelId: 'glm-5.3', plan: 'agent', maxOutputTokens: 6_000,
      governanceRevision: 1, temperature: .6, rolePrompt: role, workstationPrompt: workstation, genreProfile: null,
      skills: V7_SKILL_PROMPT_ASSETS.filter((item) => ['skill.data-boundary', 'skill.option-differentiation'].includes(item.assetKey)),
      taskContract: contract, contextPack: context, allowedTools: [], createdAt: now })).toThrow('具体模型绑定');
  });
});
