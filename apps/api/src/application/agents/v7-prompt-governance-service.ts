import {
  V7_ROLE_CONTRACTS,
  V7_WORKSTATION_PROMPT_ASSETS,
  compilePromptManifest,
  modelBindingForProfile,
  sha256,
  stableStringify,
  type V7AgentTaskKind,
  type V7BookGenreProfile,
  type V7ContextPackTrace,
  type V7GenrePersonaContent,
  type V7PromptAssetKind,
  type V7PromptAssetVersion,
  type V7PromptCompilationInput,
  type V7PromptManifest,
  type V7TaskContract,
  type V7WorkstationKey
} from '@wenmi/v7-backend';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import {
  V7PromptGovernanceRepository,
  type V7RuntimeBundleInput,
  type V7RuntimeBundleResult,
  type V7StoredPromptAssetVersion
} from '../../infrastructure/db/repositories/v7-prompt-governance-repository.js';

const ASSET_KINDS = new Set<V7PromptAssetKind>(['role_prompt', 'workstation_prompt', 'genre_persona', 'skill']);
const ASSET_KEY_PATTERN = /^(?:role|workstation|genre|skill)\.[a-z0-9][a-z0-9._-]{1,150}$/u;
const CONTENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,100}$/u;
const SECRET_PATTERN = /(?:Bearer\s+[A-Za-z0-9._-]+|\b(?:sk|ak)-[A-Za-z0-9_-]{8,}|\bark-(?!(?:agent-plan|coding-plan|image)\b)[A-Za-z0-9_-]{8,}|api[_-]?key["']?\s*[:=])/iu;
const HIDDEN_REASONING_PATTERN = /"(?:chainOfThought|reasoningTrace|hiddenReasoning|思维链)"\s*:/iu;
const KNOWN_ROLE_KEYS = new Set<string>(V7_ROLE_CONTRACTS.map((role) => role.roleKey));
const KNOWN_TASK_KINDS = new Set<string>(V7_ROLE_CONTRACTS.flatMap((role) => role.taskKinds));
const KNOWN_WORKSTATIONS = new Map<string, Set<string>>(V7_WORKSTATION_PROMPT_ASSETS.map((asset) => {
  const content = asset.content as { workstationKey: string; taskKinds: readonly string[] };
  return [content.workstationKey, new Set<string>(content.taskKinds)] as const;
}));

export class V7PromptGovernanceService {
  public constructor(
    private readonly repository: V7PromptGovernanceRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository.ensureSourceRegistrySeeded(this.clock.now().toISOString());
  }

  public summary(): object {
    return {
      ...this.repository.summary(),
      safeguards: {
        immutableHistory: true,
        optimisticRevision: true,
        secretPersistenceBlocked: true,
        hiddenReasoningPersistenceBlocked: true,
        runtimeBundleScopeBound: true
      }
    };
  }

  public assets(query: Record<string, unknown>): object[] {
    const kind = optionalKind(query.kind);
    const search = optionalText(query.search, 120);
    return this.repository.listAssets({ ...(kind === undefined ? {} : { kind }), ...(search === undefined ? {} : { search }) });
  }

  public versions(assetKey: string): V7StoredPromptAssetVersion[] {
    assertAssetKey(assetKey);
    const versions = this.repository.assetVersions(assetKey);
    if (versions.length === 0) throw notFound('提示资产不存在。');
    return versions;
  }

  public createDraft(actorId: string, assetKey: string, body: Record<string, unknown>): V7StoredPromptAssetVersion {
    assertAssetKey(assetKey);
    const expectedRevision = requiredInteger(body.expectedRevision, '配置版本无效。');
    const basedOnAssetId = optionalText(body.basedOnAssetId, 200);
    const base = basedOnAssetId === undefined
      ? this.repository.publishedAsset(assetKey)
      : this.repository.assetById(basedOnAssetId);
    if (basedOnAssetId !== undefined && (base === null || base.assetKey !== assetKey)) throw notFound('草稿来源版本不存在。');
    const kind = optionalKind(body.kind) ?? base?.kind;
    if (kind === undefined) throw validation('新提示资产必须选择类型。');
    const title = optionalText(body.title, 200) ?? base?.title;
    const summary = optionalText(body.summary, 1000) ?? base?.summary;
    const content = optionalRecord(body.content) ?? base?.content;
    if (title === undefined || summary === undefined || content === undefined) throw validation('草稿标题、说明和内容不能为空。');
    assertAssetContent(assetKey, kind, content);
    try {
      return this.repository.createDraft({
        assetKey,
        kind,
        title,
        summary,
        content,
        basedOnAssetId: base?.assetId ?? null,
        expectedRevision,
        actorId,
        eventId: this.ids.next(),
        reason: optionalText(body.reason, 1000) ?? '管理员创建V7提示资产草稿',
        now: this.clock.now().toISOString()
      });
    } catch (error) {
      throw governanceError(error);
    }
  }

  public preview(actorId: string, assetKey: string, body: Record<string, unknown>): object {
    assertAssetKey(assetKey);
    const assetId = requiredText(body.assetId, 200, '请选择要预览的草稿版本。');
    const asset = this.repository.assetById(assetId);
    if (asset === null || asset.assetKey !== assetKey) throw notFound('提示资产版本不存在。');
    const checks = inspectAssetContent(assetKey, asset.kind, asset.content);
    this.repository.recordPreview({ eventId: this.ids.next(), actorId, asset, now: this.clock.now().toISOString() });
    const requestedManifestId = optionalText(body.manifestId, 240);
    const historicalDetail = requestedManifestId === undefined ? null : this.repository.manifestDetail(requestedManifestId);
    const historical = historicalDetail === null ? null : historicalPreviewInput(asset, historicalDetail);
    const compilation = historical ?? simulatedPreviewInput(asset, this.repository.publishedAssets(), this.clock.now().toISOString());
    let compiledPrompt = '';
    try {
      compiledPrompt = compilePromptManifest(compilation.input).compiledPrompt;
      checks.push({ key: 'runtimeCompilation', passed: true });
    } catch (error) {
      checks.push({ key: 'runtimeCompilation', passed: false,
        message: error instanceof Error ? error.message : '整套运行时提示无法编译。' });
    }
    return {
      asset: assetView(asset),
      preview: {
        contextMode: compilation.mode,
        contextLabel: compilation.label,
        baseManifestId: compilation.baseManifestId,
        compiledPrompt,
        compiledPromptHash: compiledPrompt.length === 0 ? null : sha256(compiledPrompt),
        characterCount: Array.from(compiledPrompt).length,
        estimatedTokens: compiledPrompt.length === 0 ? 0 : Math.max(1, Math.ceil(Array.from(compiledPrompt).length / 2)),
        checks,
        limitations: compilation.limitations
      }
    };
  }

  public publish(actorId: string, assetKey: string, body: Record<string, unknown>): V7StoredPromptAssetVersion {
    assertAssetKey(assetKey);
    try {
      const assetId = requiredText(body.assetId, 200, '请选择要发布的草稿版本。');
      const asset = this.repository.assetById(assetId);
      if (asset === null || asset.assetKey !== assetKey) throw notFound('提示资产版本不存在。');
      assertAssetContent(assetKey, asset.kind, asset.content);
      return this.repository.publish({
        assetKey,
        assetId,
        expectedRevision: requiredInteger(body.expectedRevision, '配置版本无效。'),
        actorId,
        eventId: this.ids.next(),
        reason: optionalText(body.reason, 1000) ?? '管理员发布V7提示资产版本',
        now: this.clock.now().toISOString()
      });
    } catch (error) {
      throw governanceError(error);
    }
  }

  public restoreDraft(actorId: string, assetKey: string, body: Record<string, unknown>): V7StoredPromptAssetVersion {
    assertAssetKey(assetKey);
    try {
      return this.repository.restoreAsDraft({
        assetKey,
        sourceAssetId: requiredText(body.sourceAssetId, 200, '请选择要恢复的历史版本。'),
        expectedRevision: requiredInteger(body.expectedRevision, '配置版本无效。'),
        actorId,
        eventId: this.ids.next(),
        reason: optionalText(body.reason, 1000) ?? '从历史版本创建新的V7提示资产草稿',
        now: this.clock.now().toISOString()
      });
    } catch (error) {
      throw governanceError(error);
    }
  }

  public manifests(query: Record<string, unknown>): object[] {
    const ownerId = optionalText(query.ownerId, 160);
    const bookId = optionalText(query.bookId, 160);
    const taskId = optionalText(query.taskId, 200);
    const limit = optionalInteger(query.limit, 1, 200) ?? 50;
    return this.repository.listManifests({
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(bookId === undefined ? {} : { bookId }),
      ...(taskId === undefined ? {} : { taskId }),
      limit
    });
  }

  public manifest(manifestId: string): object {
    const result = this.repository.manifestDetail(requiredText(manifestId, 240, '提示清单编号无效。'));
    if (result === null) throw notFound('提示清单不存在。');
    return result;
  }

  /**
   * Rebuilds a historical prompt from its frozen inputs and compares it with
   * the immutable snapshot.  This is deliberately read-only: a mismatch is
   * evidence for an administrator, never a reason to rewrite history.
   */
  public verifyManifestRebuild(manifestId: string): object {
    const normalizedId = requiredText(manifestId, 240, '提示清单编号无效。');
    const detail = this.repository.manifestDetail(normalizedId);
    if (detail === null) throw notFound('提示清单不存在。');
    const snapshot = rebuildInput(detail);
    if (snapshot === null) {
      return {
        manifestId: normalizedId,
        matched: false,
        storedHash: manifestFromDetail(detail)?.compiledPromptHash ?? null,
        rebuiltHash: null,
        checkedAt: this.clock.now().toISOString(),
        summary: '历史快照缺少冻结的任务合同、资料包或提示资产，无法完成重建核对。',
        components: rebuildComponentSummary(detail)
      };
    }
    const stored = snapshot.stored;
    let rebuilt: V7PromptManifest;
    try {
      rebuilt = compilePromptManifest(snapshot.input);
    } catch {
      return {
        manifestId: normalizedId,
        matched: false,
        storedHash: stored.compiledPromptHash,
        rebuiltHash: null,
        checkedAt: this.clock.now().toISOString(),
        summary: '冻结来源齐全，但当前编译器无法重建这条历史快照；历史记录未被修改。',
        components: rebuildComponentSummary(detail)
      };
    }
    const matched = rebuilt.compiledPromptHash === stored.compiledPromptHash
      && rebuilt.compiledPrompt === stored.compiledPrompt;
    return {
      manifestId: normalizedId,
      matched,
      storedHash: stored.compiledPromptHash,
      rebuiltHash: rebuilt.compiledPromptHash,
      checkedAt: this.clock.now().toISOString(),
      summary: matched
        ? '已用冻结的岗位、工位、Skill、任务合同、资料包和题材档案重建，结果与历史快照一致。'
        : '重建结果与历史快照不一致；历史记录未被修改，请检查冻结来源或编译器兼容性。',
      components: rebuildComponentSummary(detail)
    };
  }

  public recordBookGenreProfile(profile: V7BookGenreProfile, actorId = 'runtime'): V7BookGenreProfile {
    try {
      return this.repository.recordBookGenreProfile(profile, actorId);
    } catch (error) {
      throw governanceError(error);
    }
  }

  public saveRuntimeBundle(input: V7RuntimeBundleInput): V7RuntimeBundleResult {
    try {
      return this.repository.saveRuntimeBundle(input);
    } catch (error) {
      throw governanceError(error);
    }
  }
}

interface RuntimeDetail {
  manifest: V7PromptManifest & { lifecycleStatus?: string };
  taskContract: (V7TaskContract & { selectedSkillKeys?: readonly string[] }) | null;
  contextPack: V7ContextPackTrace | null;
  promptAssets: {
    rolePrompt: V7StoredPromptAssetVersion | null;
    workstationPrompt: V7StoredPromptAssetVersion | null;
    skills: V7StoredPromptAssetVersion[];
  };
  genreProfile: V7BookGenreProfile | null;
}

interface PreviewCompilation {
  mode: 'historical' | 'simulated';
  label: string;
  baseManifestId: string | null;
  limitations: string[];
  input: V7PromptCompilationInput;
}

function rebuildInput(detail: object): { stored: V7PromptManifest; input: V7PromptCompilationInput } | null {
  const value = detail as Partial<RuntimeDetail>;
  const manifest = value.manifest;
  const contract = value.taskContract;
  const contextPack = value.contextPack;
  const rolePrompt = value.promptAssets?.rolePrompt;
  const workstationPrompt = value.promptAssets?.workstationPrompt;
  const skills = value.promptAssets?.skills;
  if (manifest === undefined || contract == null || contextPack == null || rolePrompt == null
    || workstationPrompt == null || skills === undefined || skills.length !== manifest.skillVersionIds.length
    || (manifest.genreProfileId !== null && value.genreProfile == null)) return null;
  const reconstructedContract: V7TaskContract = {
    ...contract,
    selectedSkillKeys: contract.selectedSkillKeys ?? skillKeys(skills)
  };
  return {
    stored: manifest,
    input: {
      manifestId: manifest.manifestId,
      memberKey: manifest.memberKey,
      modelProfileKey: manifest.modelProfileKey,
      provider: manifest.provider,
      modelId: manifest.modelId,
      plan: manifest.plan,
      maxOutputTokens: manifest.maxOutputTokens,
      governanceRevision: manifest.governanceRevision,
      temperature: manifest.temperature,
      rolePrompt: asPublished(rolePrompt),
      workstationPrompt: asPublished(workstationPrompt),
      genreProfile: value.genreProfile ?? null,
      skills: skills.map(asPublished),
      taskContract: reconstructedContract,
      contextPack,
      allowedTools: manifest.allowedTools,
      createdAt: manifest.createdAt
    }
  };
}

function manifestFromDetail(detail: object): V7PromptManifest | null {
  return (detail as Partial<RuntimeDetail>).manifest ?? null;
}

function rebuildComponentSummary(detail: object): object {
  const value = detail as Partial<RuntimeDetail>;
  const manifest = value.manifest;
  return {
    taskContract: value.taskContract == null ? 'missing' : 'frozen',
    contextPack: value.contextPack == null ? 'missing' : 'frozen',
    rolePrompt: value.promptAssets?.rolePrompt == null ? 'missing' : 'frozen',
    workstationPrompt: value.promptAssets?.workstationPrompt == null ? 'missing' : 'frozen',
    skills: `${value.promptAssets?.skills.length ?? 0}/${manifest?.skillVersionIds.length ?? 0}`,
    genreProfile: manifest?.genreProfileId == null ? 'not_used' : value.genreProfile == null ? 'missing' : 'frozen',
    modelBinding: manifest === undefined ? 'missing' : {
      provider: manifest.provider,
      modelId: manifest.modelId,
      plan: manifest.plan,
      temperature: manifest.temperature,
      maxOutputTokens: manifest.maxOutputTokens
    }
  };
}

function historicalPreviewInput(asset: V7StoredPromptAssetVersion, detail: object): PreviewCompilation | null {
  if (asset.kind === 'genre_persona') return null;
  const rebuilt = rebuildInput(detail);
  if (rebuilt === null) return null;
  const input = rebuilt.input;
  let rolePrompt = input.rolePrompt;
  let workstationPrompt = input.workstationPrompt;
  let skills = [...input.skills];
  let exactFrozenVersion = false;
  if (asset.kind === 'role_prompt') {
    if ((asset.content as { roleKey?: string }).roleKey !== rebuilt.stored.roleKey) return null;
    exactFrozenVersion = asset.assetId === input.rolePrompt.assetId;
    rolePrompt = asPublished(asset);
  } else if (asset.kind === 'workstation_prompt') {
    const content = asset.content as { workstationKey?: string; taskKinds?: readonly string[] };
    if (content.workstationKey !== rebuilt.stored.workstationKey || !content.taskKinds?.includes(rebuilt.stored.taskKind)) return null;
    exactFrozenVersion = asset.assetId === input.workstationPrompt.assetId;
    workstationPrompt = asPublished(asset);
  } else {
    const triggers = (asset.content as { triggerTaskKinds?: readonly string[] }).triggerTaskKinds;
    if (!triggers?.includes(rebuilt.stored.taskKind)) return null;
    exactFrozenVersion = skills.some((skill) => skill.assetId === asset.assetId);
    skills = [...skills.filter((skill) => skill.assetKey !== asset.assetKey), asPublished(asset)];
  }
  return {
    mode: 'historical',
    label: `基于历史任务 ${rebuilt.stored.manifestId} 的真实冻结上下文；仅替换当前配置版本。`,
    baseManifestId: rebuilt.stored.manifestId,
    limitations: ['这是只读重编译预览，不会改动历史任务、运行结果或作者资料。'],
    input: {
      ...input,
      manifestId: `preview-${rebuilt.stored.manifestId}`,
      rolePrompt,
      workstationPrompt,
      skills,
      taskContract: { ...input.taskContract, selectedSkillKeys: skillKeys(skills) },
      allowedTools: exactFrozenVersion ? input.allowedTools : allowedToolsFor(rolePrompt, skills)
    }
  };
}

function simulatedPreviewInput(
  asset: V7StoredPromptAssetVersion,
  publishedAssets: readonly V7StoredPromptAssetVersion[],
  now: string
): PreviewCompilation {
  const taskKind = previewTaskKind(asset);
  const roleContract = asset.kind === 'role_prompt'
    ? V7_ROLE_CONTRACTS.find((role) => role.roleKey === (asset.content as { roleKey?: string }).roleKey)
    : V7_ROLE_CONTRACTS.find((role) => role.taskKinds.includes(taskKind));
  if (roleContract === undefined) throw validation('找不到可用于整套编译预览的固定岗位。');
  const rolePrompt = asset.kind === 'role_prompt' ? asPublished(asset) : requirePreviewAsset(publishedAssets,
    (candidate) => candidate.kind === 'role_prompt'
      && (candidate.content as { roleKey?: string }).roleKey === roleContract.roleKey, '岗位提示');
  const workstationPrompt = asset.kind === 'workstation_prompt' ? asPublished(asset) : requirePreviewAsset(publishedAssets,
    (candidate) => candidate.kind === 'workstation_prompt'
      && (candidate.content as { taskKinds?: readonly string[] }).taskKinds?.includes(taskKind) === true, '工位提示');
  const workstationKey = (workstationPrompt.content as { workstationKey: V7WorkstationKey }).workstationKey;
  let skills = publishedAssets.filter((candidate) => candidate.kind === 'skill'
    && (candidate.content as { triggerTaskKinds?: readonly string[] }).triggerTaskKinds?.includes(taskKind) === true)
    .map(asPublished);
  if (asset.kind === 'skill') skills = [...skills.filter((skill) => skill.assetKey !== asset.assetKey), asPublished(asset)];
  const ownerId = 'admin-preview-owner';
  const bookId = 'admin-preview-book';
  const taskId = 'admin-preview-task';
  const contextContent = { preview: '这是一份不包含作者真实内容的安全示例资料，只用于验证整套运行时编译。' };
  const contextPack: V7ContextPackTrace = {
    contextPackId: 'admin-preview-context', ownerId, bookId, taskId, policyVersion: 'admin-preview@1',
    tokenBudget: 2_000, estimatedTokens: 40, sources: [], content: contextContent,
    contentHash: sha256(stableStringify(contextContent)), createdAt: now
  };
  const taskContract: V7TaskContract = {
    contractId: 'admin-preview-contract', version: 1, ownerId, bookId, taskId, taskKind,
    workstationKey, operationMode: 'fresh', objective: '验证当前配置能否与岗位、工位、Skill和资料包一起完整编译。',
    mustPreserve: ['资料可信边界'], allowedChanges: ['只替换本次预览的配置版本'],
    forbiddenChanges: ['不读取或写入作者真实资料'], successCriteria: ['整套运行时提示可以编译'],
    outputContract: { type: 'admin_runtime_preview' }, selectedSkillKeys: skillKeys(skills),
    authorInstructionVersion: null, basedOnTaskId: null, createdAt: now
  };
  const previewModelProfileKey = 'glm-5.3';
  const previewBinding = modelBindingForProfile(previewModelProfileKey);
  return {
    mode: 'simulated',
    label: '使用安全示例任务进行整套运行时编译；没有读取作者真实书籍。',
    baseManifestId: null,
    limitations: asset.kind === 'genre_persona'
      ? ['题材人设这里只模拟单题材工作档案；真实融合题材仍由语义 Agent 生成。']
      : ['示例资料只能验证编译完整性，不能代替真实任务的文学质量验收。'],
    input: {
      manifestId: 'admin-preview-manifest', memberKey: 'admin-preview-member', modelProfileKey: previewModelProfileKey,
      provider: previewBinding.provider, modelId: previewBinding.modelId, plan: previewBinding.plan, maxOutputTokens: 6_000,
      governanceRevision: asset.governanceRevision, temperature: 0.4, rolePrompt, workstationPrompt,
      genreProfile: asset.kind === 'genre_persona' ? simulatedGenreProfile(asset, ownerId, bookId, taskId, now) : null,
      skills, taskContract, contextPack,
      allowedTools: allowedToolsFor(rolePrompt, skills),
      createdAt: now
    }
  };
}

function previewTaskKind(asset: V7StoredPromptAssetVersion): V7AgentTaskKind {
  if (asset.kind === 'role_prompt') {
    const role = V7_ROLE_CONTRACTS.find((candidate) => candidate.roleKey === (asset.content as { roleKey?: string }).roleKey);
    if (role?.taskKinds[0] !== undefined) return role.taskKinds[0];
  }
  if (asset.kind === 'workstation_prompt') {
    const task = (asset.content as { taskKinds?: readonly V7AgentTaskKind[] }).taskKinds?.[0];
    if (task !== undefined) return task;
  }
  if (asset.kind === 'skill') {
    const task = (asset.content as { triggerTaskKinds?: readonly V7AgentTaskKind[] }).triggerTaskKinds?.[0];
    if (task !== undefined) return task;
  }
  return 'opening_design';
}

function simulatedGenreProfile(
  asset: V7StoredPromptAssetVersion,
  ownerId: string,
  bookId: string,
  taskId: string,
  now: string
): V7BookGenreProfile {
  const content = asset.content as V7GenrePersonaContent;
  return {
    profileId: 'admin-preview-genre', ownerId, bookId, version: 1, status: 'active',
    primaryGenreKey: content.genreKey, supportingGenreKeys: [], sourceAssetVersionIds: [asset.assetId], sourceBookVersion: 1,
    publicLabel: content.publicName, workingIdentity: `以${content.publicName}为主体的预览工作档案，只验证提示编译。`,
    primaryPromise: content.readerPromise[0] ?? '保持题材阅读承诺', supportingFunctions: [],
    writingPriorities: [...content.creativePriorities], authenticityChecks: [...content.authenticityChecks],
    avoidPatterns: [...content.commonFailures], conflictResolutions: ['预览不处理融合题材冲突。'],
    compiledByTaskId: taskId, createdAt: now
  };
}

function requirePreviewAsset(
  assets: readonly V7StoredPromptAssetVersion[],
  predicate: (asset: V7StoredPromptAssetVersion) => boolean,
  label: string
): V7PromptAssetVersion {
  const asset = assets.find(predicate);
  if (asset === undefined) throw validation(`缺少可用于预览的${label}。`);
  return asPublished(asset);
}

function asPublished(asset: V7PromptAssetVersion): V7PromptAssetVersion {
  return { ...asset, status: 'published' };
}

function skillKeys(skills: readonly V7PromptAssetVersion[]): string[] {
  return skills.map((skill) => String(
    (skill.content as { skillKey?: string }).skillKey ?? skill.assetKey.replace(/^skill\./u, '')
  )).toSorted();
}

function allowedToolsFor(
  rolePrompt: V7PromptAssetVersion,
  skills: readonly V7PromptAssetVersion[]
): string[] {
  return [...new Set([
    ...((rolePrompt.content as { permissions?: readonly string[] }).permissions ?? []),
    ...skills.flatMap((skill) => (skill.content as { allowedTools?: readonly string[] }).allowedTools ?? [])
  ])].toSorted();
}

function assetView(asset: V7StoredPromptAssetVersion): object {
  return {
    assetId: asset.assetId,
    assetKey: asset.assetKey,
    kind: asset.kind,
    version: asset.version,
    status: asset.status,
    title: asset.title,
    summary: asset.summary,
    contentHash: asset.contentHash,
    basedOnAssetId: asset.basedOnAssetId
  };
}

interface AssetCheck {
  key: string;
  passed: boolean;
  message?: string;
}

function assertAssetContent(assetKey: string, kind: V7PromptAssetKind, content: Readonly<Record<string, unknown>>): void {
  const failed = inspectAssetContent(assetKey, kind, content).find((check) => !check.passed);
  if (failed !== undefined) throw validation(failed.message ?? '提示资产内容没有通过检查。');
}

function inspectAssetContent(assetKey: string, kind: V7PromptAssetKind, content: Readonly<Record<string, unknown>>): AssetCheck[] {
  const requirements: Record<V7PromptAssetKind, readonly string[]> = {
    role_prompt: ['roleKey', 'responsibility', 'capabilities', 'permissions', 'boundaries', 'failureContract'],
    workstation_prompt: ['workstationKey', 'publicName', 'taskKinds', 'responsibility', 'requiredInputs', 'forbiddenInputs', 'qualityChecks', 'stageBoundary'],
    genre_persona: ['genreKey', 'publicName', 'aliases', 'readerPromise', 'creativePriorities', 'authenticityChecks', 'commonFailures', 'fusionBoundary'],
    skill: ['skillKey', 'responsibility', 'triggerTaskKinds', 'procedure', 'allowedTools', 'stopConditions', 'outputRequirements']
  };
  const missing = requirements[kind].filter((key) => !(key in content));
  const serialized = stableStringify(content);
  const identity = inspectIdentity(assetKey, kind, content);
  const invalidField = Object.entries(content).find(([, value]) => value === undefined
    || typeof value === 'function' || typeof value === 'symbol');
  const invalidList = Object.entries(content).find(([, value]) => Array.isArray(value)
    && value.some((item) => typeof item !== 'string' || item.trim().length === 0));
  const invalidRequiredString = requiredStringKeys(kind).find((key) => typeof content[key] !== 'string'
    || (content[key] as string).trim().length === 0);
  const requiredLists = requiredListKeys(kind);
  const emptyRequiredList = requiredLists.find((key) => !Array.isArray(content[key]) || content[key].length === 0);
  const taskKinds = kind === 'workstation_prompt' || kind === 'skill'
    ? (content[kind === 'workstation_prompt' ? 'taskKinds' : 'triggerTaskKinds'] as unknown)
    : undefined;
  const invalidTaskKind = Array.isArray(taskKinds)
    ? taskKinds.find((item) => typeof item !== 'string' || !KNOWN_TASK_KINDS.has(item))
    : taskKinds === undefined ? undefined : taskKinds;
  const checks: AssetCheck[] = [
    { key: 'requiredFields', passed: missing.length === 0,
      message: `提示资产缺少必要内容：${missing.join('、')}。` },
    identity,
    { key: 'fieldTypes', passed: invalidField === undefined,
      message: `提示资产字段无效：${invalidField?.[0] ?? '未知字段'}。` },
    { key: 'requiredStrings', passed: invalidRequiredString === undefined,
      message: `提示资产文字字段不能为空：${invalidRequiredString ?? '必要字段'}。` },
    { key: 'listItems', passed: invalidList === undefined,
      message: `提示资产列表存在空项：${invalidList?.[0] ?? '未知列表'}。` },
    { key: 'requiredLists', passed: emptyRequiredList === undefined,
      message: `提示资产列表不能为空：${emptyRequiredList ?? '必要列表'}。` },
    { key: 'taskKinds', passed: invalidTaskKind === undefined,
      message: `提示资产包含不存在的任务类型：${String(invalidTaskKind ?? '')}。` },
    { key: 'length', passed: Array.from(serialized).length <= 60_000,
      message: '提示资产内容过长。' },
    { key: 'secretBoundary', passed: !SECRET_PATTERN.test(serialized),
      message: '提示资产疑似密钥内容，不能保存或发布。' },
    { key: 'reasoningBoundary', passed: !HIDDEN_REASONING_PATTERN.test(serialized),
      message: '提示资产不能要求或保存模型思维链。' }
  ];
  return checks;
}

function inspectIdentity(assetKey: string, kind: V7PromptAssetKind, content: Readonly<Record<string, unknown>>): AssetCheck {
  const identityKeys: Record<V7PromptAssetKind, string> = {
    role_prompt: 'roleKey', workstation_prompt: 'workstationKey', genre_persona: 'genreKey', skill: 'skillKey'
  };
  const prefixes: Record<V7PromptAssetKind, string> = {
    role_prompt: 'role.', workstation_prompt: 'workstation.', genre_persona: 'genre.', skill: 'skill.'
  };
  const identityKey = identityKeys[kind];
  const value = content[identityKey];
  let passed = typeof value === 'string' && CONTENT_KEY_PATTERN.test(value)
    && assetKey === `${prefixes[kind]}${value}`;
  if (passed && kind === 'role_prompt') passed = KNOWN_ROLE_KEYS.has(value as string);
  if (passed && kind === 'workstation_prompt') {
    const allowedTasks = KNOWN_WORKSTATIONS.get(value as string);
    const taskKinds = content.taskKinds;
    passed = allowedTasks !== undefined && Array.isArray(taskKinds) && taskKinds.length > 0
      && taskKinds.every((task) => typeof task === 'string' && allowedTasks.has(task));
  }
  return passed
    ? { key: 'assetIdentity', passed: true }
    : { key: 'assetIdentity', passed: false,
        message: `提示资产编号与${identityKey}不一致，或引用了不存在的固定岗位/工位。` };
}

function requiredListKeys(kind: V7PromptAssetKind): readonly string[] {
  if (kind === 'role_prompt') return ['capabilities', 'permissions', 'boundaries'];
  if (kind === 'workstation_prompt') return ['taskKinds', 'requiredInputs', 'forbiddenInputs', 'qualityChecks'];
  if (kind === 'genre_persona') return ['aliases', 'readerPromise', 'creativePriorities', 'authenticityChecks', 'commonFailures'];
  return ['triggerTaskKinds', 'procedure', 'allowedTools', 'stopConditions', 'outputRequirements'];
}

function requiredStringKeys(kind: V7PromptAssetKind): readonly string[] {
  if (kind === 'role_prompt') return ['roleKey', 'responsibility', 'failureContract'];
  if (kind === 'workstation_prompt') return ['workstationKey', 'publicName', 'responsibility', 'stageBoundary'];
  if (kind === 'genre_persona') return ['genreKey', 'publicName', 'fusionBoundary'];
  return ['skillKey', 'responsibility'];
}

function assertAssetKey(value: string): void {
  if (!ASSET_KEY_PATTERN.test(value)) throw validation('提示资产编号无效。');
}

function optionalKind(value: unknown): V7PromptAssetKind | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !ASSET_KINDS.has(value as V7PromptAssetKind)) throw validation('提示资产类型无效。');
  return value as V7PromptAssetKind;
}

function requiredInteger(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw validation(message);
  return value;
}

function optionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < min || parsed > max) throw validation('数量范围无效。');
  return parsed;
}

function requiredText(value: unknown, max: number, message: string): string {
  const result = optionalText(value, max);
  if (result === undefined) throw validation(message);
  return result;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw validation('文字内容无效。');
  const result = value.trim();
  if (result.length === 0 || Array.from(result).length > max) throw validation('文字内容长度无效。');
  return result;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw validation('提示资产内容必须是对象。');
  return value as Readonly<Record<string, unknown>>;
}

function validation(message: string): DomainError {
  return new DomainError(errorCodes.validation, message);
}

function notFound(message: string): DomainError {
  return new DomainError('V7_PROMPT_CONTEXT_NOT_FOUND', message, {}, false, 404);
}

function governanceError(error: unknown): DomainError {
  if (error instanceof DomainError) return error;
  const message = error instanceof Error ? error.message : '提示词与上下文配置处理失败';
  const conflict = message.includes('刚刚') || message.includes('已存在') || message.includes('冲突') || message.includes('只有草稿');
  return new DomainError(conflict ? 'V7_PROMPT_CONTEXT_CONFLICT' : errorCodes.validation, message, {}, conflict, conflict ? 409 : 400);
}
