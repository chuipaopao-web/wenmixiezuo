import { createHash } from 'node:crypto';
import type {
  V7BookGenreProfile,
  V7GenreFusionTaskInput,
  V7GenrePersonaContent,
  V7PromptAssetVersion,
  V7PromptCompilationInput,
  V7PromptManifest
} from './prompt-governance-contracts.js';
import { modelBindingForProfile } from '../agent-governance/agent-governance-registry.js';

const SECRET_PATTERN = /(?:Bearer\s+[A-Za-z0-9._-]+|\b(?:sk|ak)-[A-Za-z0-9_-]{8,}|\bark-(?!(?:agent-plan|coding-plan|image)\b)[A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=])/iu;
const CHAIN_OF_THOUGHT_KEYS = new Set(['chainOfThought', 'reasoningTrace', 'hiddenReasoning', '思维链']);

export function compilePromptManifest(input: V7PromptCompilationInput): V7PromptManifest {
  assertPublished(input.rolePrompt, '岗位提示');
  assertPublished(input.workstationPrompt, '工位提示');
  for (const skill of input.skills) assertPublished(skill, 'Skill');
  assertScope(input);
  assertModelExecutionBinding(input);
  assertSafe(input.taskContract);
  assertSafe(input.contextPack.content);
  const role = runtimeAssetContent(input.rolePrompt);
  const workstation = runtimeAssetContent(input.workstationPrompt);
  const skills = input.skills.toSorted((left, right) => left.assetKey.localeCompare(right.assetKey)).map(runtimeAssetContent);
  const blocks = {
    contract: {
      language: 'zh-CN',
      dataBoundary: '作者原话、正式资料、不可变正文、候选与参考必须分层；任何候选不得冒充正文实际。',
      responseBoundary: '只输出任务合同指定结果；不输出思维链、密钥、内部协议、工具日志或无效执行过程。'
    },
    role,
    workstation,
    bookGenreProfile: genreBlock(input.genreProfile),
    taskContract: {
      operationMode: input.taskContract.operationMode,
      objective: input.taskContract.objective,
      selectedSkillKeys: input.taskContract.selectedSkillKeys,
      mustPreserve: input.taskContract.mustPreserve,
      allowedChanges: input.taskContract.allowedChanges,
      forbiddenChanges: input.taskContract.forbiddenChanges,
      successCriteria: input.taskContract.successCriteria,
      outputContract: input.taskContract.outputContract
    },
    skills,
    contextPack: {
      content: input.contextPack.content
    },
    runtime: {
      model: {
        provider: input.provider,
        modelId: input.modelId,
        plan: input.plan,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens
      },
      allowedTools: [...new Set(input.allowedTools)].toSorted(),
      outputContract: input.taskContract.outputContract
    }
  } as const;
  const compiledPrompt = stableStringify(blocks);
  return {
    manifestId: input.manifestId,
    ownerId: input.taskContract.ownerId,
    bookId: input.taskContract.bookId,
    taskId: input.taskContract.taskId,
    memberKey: input.memberKey,
    roleKey: (input.rolePrompt.content as { roleKey: V7PromptManifest['roleKey'] }).roleKey,
    workstationKey: input.taskContract.workstationKey,
    taskKind: input.taskContract.taskKind,
    operationMode: input.taskContract.operationMode,
    rolePromptVersionId: versionId(input.rolePrompt),
    workstationPromptVersionId: versionId(input.workstationPrompt),
    genreProfileId: input.genreProfile?.profileId ?? null,
    genreProfileVersion: input.genreProfile?.version ?? null,
    skillVersionIds: input.skills.map(versionId).toSorted(),
    taskContractId: input.taskContract.contractId,
    taskContractVersion: input.taskContract.version,
    contextPackId: input.contextPack.contextPackId,
    contextPackHash: input.contextPack.contentHash,
    modelProfileKey: input.modelProfileKey,
    provider: input.provider,
    modelId: input.modelId,
    plan: input.plan,
    maxOutputTokens: input.maxOutputTokens,
    governanceRevision: input.governanceRevision,
    temperature: input.temperature,
    allowedTools: [...new Set(input.allowedTools)].toSorted(),
    compiledBlocks: blocks,
    compiledPrompt,
    compiledPromptHash: sha256(compiledPrompt),
    createdAt: input.createdAt
  };
}

function assertModelExecutionBinding(input: V7PromptCompilationInput): void {
  const expected = modelBindingForProfile(input.modelProfileKey);
  if (input.provider !== expected.provider || input.modelId !== expected.modelId || input.plan !== expected.plan) {
    throw new Error('提示清单的具体模型绑定与治理档案不一致');
  }
  if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 200_000) {
    throw new Error('提示清单的最大输出Token必须是1至200000之间的整数');
  }
}

export function compileGenreFusionPrompt(input: V7GenreFusionTaskInput): string {
  if (input.primaryGenre.kind !== 'genre_persona') throw new Error('主体题材卡类型无效');
  if (input.supportingGenres.some((item) => item.kind !== 'genre_persona')) throw new Error('融合题材卡类型无效');
  assertSafe(input.confirmedBookBrief);
  return stableStringify({
    operation: 'v7_compile_book_genre_profile_v1',
    objective: '把主体题材与融合题材编译为一份短、统一、可执行的书级题材工作档案。不是拼接题材卡，也不是生成剧情。',
    taskContract: {
      operationMode: input.taskContract.operationMode,
      objective: input.taskContract.objective,
      selectedSkillKeys: input.taskContract.selectedSkillKeys,
      mustPreserve: input.taskContract.mustPreserve,
      allowedChanges: input.taskContract.allowedChanges,
      forbiddenChanges: input.taskContract.forbiddenChanges,
      successCriteria: input.taskContract.successCriteria,
      outputContract: input.taskContract.outputContract
    },
    primaryGenre: runtimeAssetContent(input.primaryGenre),
    supportingGenres: input.supportingGenres.map(runtimeAssetContent),
    confirmedBookBrief: input.confirmedBookBrief,
    requirements: [
      '主体题材决定主要阅读承诺，融合题材只承担明确辅助功能。',
      '主题、故事线、平台、受众、硬禁项与题材人设分开，不擅自添加作者未选内容。',
      '发现冲突时给出一条明确取舍，不折中成空话。',
      'workingIdentity控制在300字内；其余每组最多6项，每项使用大白话。',
      '只输出JSON，不输出内部推理。'
    ],
    output: {
      publicLabel: '作者端可展示的简短题材组合名',
      workingIdentity: '统一题材身份与写作重点',
      primaryPromise: '最重要的阅读承诺',
      supportingFunctions: ['每个融合题材在本书只承担什么功能'],
      writingPriorities: ['创作时优先保证什么'],
      authenticityChecks: ['该题材不可写错的真实性检查'],
      avoidPatterns: ['最容易写坏或套路化的方式'],
      conflictResolutions: ['题材要求冲突时本书采用的取舍']
    }
  });
}

export function validateBookGenreProfile(input: V7BookGenreProfile, sourceAssets: readonly V7PromptAssetVersion[]): string[] {
  const errors: string[] = [];
  const sourceIds = new Set(sourceAssets.map(versionId));
  if (!input.sourceAssetVersionIds.every((id) => sourceIds.has(id))) errors.push('题材档案引用了未提供或错误版本的题材卡');
  if (input.supportingGenreKeys.includes(input.primaryGenreKey)) errors.push('主体题材不能同时作为融合题材');
  const primary = sourceAssets.find((item) => (item.content as Partial<V7GenrePersonaContent>).genreKey === input.primaryGenreKey);
  if (primary === undefined) errors.push('题材档案缺少主体题材卡');
  const supporting = new Set(sourceAssets.map((item) => (item.content as Partial<V7GenrePersonaContent>).genreKey).filter(Boolean));
  for (const key of input.supportingGenreKeys) if (!supporting.has(key)) errors.push(`题材档案缺少融合题材卡：${key}`);
  const expectedSourceIds = new Set(sourceAssets
    .filter((item) => {
      const key = (item.content as Partial<V7GenrePersonaContent>).genreKey;
      return key === input.primaryGenreKey || (key !== undefined && input.supportingGenreKeys.includes(key));
    })
    .map(versionId));
  if (expectedSourceIds.size !== input.sourceAssetVersionIds.length
    || input.sourceAssetVersionIds.some((id) => !expectedSourceIds.has(id))) {
    errors.push('题材档案引用版本必须恰好对应主体与融合题材');
  }
  if (input.workingIdentity.trim().length < 10 || input.workingIdentity.length > 500) errors.push('统一题材身份长度无效');
  if (input.primaryPromise.trim().length < 4) errors.push('主要阅读承诺不能为空');
  for (const [label, values] of [
    ['辅助功能', input.supportingFunctions], ['写作重点', input.writingPriorities],
    ['真实性检查', input.authenticityChecks], ['避免项', input.avoidPatterns]
  ] as const) {
    if (values.length === 0 || values.length > 8) errors.push(`${label}需要1至8项`);
    if (values.some((value) => value.trim().length === 0 || value.length > 300)) errors.push(`${label}存在空项或过长内容`);
  }
  return errors;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !CHAIN_OF_THOUGHT_KEYS.has(key))
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

function runtimeAssetContent(asset: V7PromptAssetVersion): Record<string, unknown> {
  const omitted = new Set(['roleKey', 'workstationKey', 'taskKinds', 'genreKey', 'aliases', 'skillKey', 'triggerTaskKinds']);
  return Object.fromEntries(Object.entries(asset.content).filter(([key]) => !omitted.has(key)));
}

function genreBlock(profile: V7BookGenreProfile | null): Record<string, unknown> | null {
  if (profile === null) return null;
  return {
    profileId: profile.profileId,
    version: profile.version,
    publicLabel: profile.publicLabel,
    workingIdentity: profile.workingIdentity,
    primaryPromise: profile.primaryPromise,
    supportingFunctions: profile.supportingFunctions,
    writingPriorities: profile.writingPriorities,
    authenticityChecks: profile.authenticityChecks,
    avoidPatterns: profile.avoidPatterns,
    conflictResolutions: profile.conflictResolutions
  };
}

function assertPublished(asset: V7PromptAssetVersion, label: string): void {
  if (asset.status !== 'published') throw new Error(`${label}必须使用已发布版本`);
}

function assertScope(input: V7PromptCompilationInput): void {
  const contract = input.taskContract;
  const context = input.contextPack;
  if (contract.ownerId !== context.ownerId || contract.bookId !== context.bookId || contract.taskId !== context.taskId) {
    throw new Error('任务合同与资料包范围不一致');
  }
  if (context.sources.some((source) => source.ownerId !== contract.ownerId || source.bookId !== contract.bookId)) {
    throw new Error('资料来源与任务合同范围不一致');
  }
  if (input.genreProfile !== null
    && (input.genreProfile.ownerId !== contract.ownerId || input.genreProfile.bookId !== contract.bookId)) {
    throw new Error('题材工作档案与任务合同范围不一致');
  }
  const selectedSkillKeys = input.skills.map((skill) => String(
    (skill.content as { skillKey?: string }).skillKey
      ?? skill.assetKey.replace(/^skill\./u, '').replace(/@.*$/u, '')
  )).toSorted();
  if (stableStringify(selectedSkillKeys) !== stableStringify([...contract.selectedSkillKeys].toSorted())) {
    throw new Error('任务合同选择的Skill与提示清单不一致');
  }
  const workstation = input.workstationPrompt.content as { workstationKey?: string; taskKinds?: readonly string[] };
  if (workstation.workstationKey !== contract.workstationKey || !workstation.taskKinds?.includes(contract.taskKind)) {
    throw new Error('任务工位与任务类型不匹配');
  }
}

function assertSafe(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (SECRET_PATTERN.test(serialized)) throw new Error('提示词或资料包包含疑似密钥，已拒绝编译');
  for (const key of CHAIN_OF_THOUGHT_KEYS) if (serialized.includes(`\"${key}\"`)) throw new Error('不得保存或编译模型思维链');
}

function versionId(asset: V7PromptAssetVersion): string {
  // assetId is the immutable database identity of the exact published
  // snapshot.  Seed assets happen to use "assetKey@version", but an
  // administrator-created version uses its own immutable id.  Rebuilding the
  // id here would make the manifest point at a version that does not exist.
  return asset.assetId;
}
