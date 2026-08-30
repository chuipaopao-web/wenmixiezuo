import { createHash } from 'node:crypto';
import {
  V7_GLOBAL_MEMBERS,
  V7_PROMPT_SOURCE_ASSETS,
  V7_ROLE_CONTRACTS,
  compilePromptManifest,
  defaultSkillAssets,
  modelBindingForProfile,
  sha256,
  stableStringify,
  type V7AgentTaskKind,
  type V7BookGenreProfile,
  type V7ContextSourceTrace,
  type V7ContextPackTrace,
  type V7FixedRoleKey,
  type V7PromptAssetVersion,
  type V7PromptManifest,
  type V7TaskContract,
  type V7TaskOperationMode,
  type V7WorkstationKey,
  type V7WorkstationPromptContent
} from '@wenmi/v7-backend';

/**
 * Existing V7 task builders already produce a complete, stage-specific prompt.
 * This adapter freezes that payload inside the new role/workstation/task/skill/
 * context manifest without trying to reinterpret its semantics in TypeScript.
 * Newer callers can progressively provide individually traced source items.
 */
export interface V7RuntimePromptCompilationRequest {
  requestId: string;
  ownerId: string;
  bookId: string;
  taskId: string;
  memberKey: string;
  runtimeRoleKey: string;
  /** 本次任务实际调用模型对应的治理档案键；调用方必须从冻结模型绑定解析后显式传入。 */
  modelProfileKey: string;
  taskKind: V7AgentTaskKind;
  workstationKey: V7WorkstationKey;
  operationMode?: V7TaskOperationMode;
  /** 仅在调用方已经持久化作者意见版本时传入；不得用时间或当前条目版本伪造。 */
  authorInstructionVersion?: number | null;
  /** 作者重新设计/修改任务所依据的原模型任务；必须是当前书籍内真实存在的任务。 */
  basedOnTaskId?: string | null;
  objective?: string;
  sourcePrompt: string;
  sourceTraces?: readonly V7ContextSourceTrace[];
  /** 本次任务明确选择的少量 Skill；省略时按任务类型选择并冻结默认集合。 */
  skillKeys?: readonly string[];
  /** 调用方可以收紧、但不能放宽当前任务的默认资料预算。 */
  contextTokenBudget?: number;
  /**
   * 本次实际模型调用的最大输出 Token。旧调用方省略时使用任务级兼容值；
   * 新调用方应显式传入，技术重试必须与首次冻结值完全一致。
   */
  maxOutputTokens?: number;
  genreProfile?: V7BookGenreProfile | null;
  /** Exact published snapshots selected by the runtime governance store. */
  promptAssets?: readonly V7PromptAssetVersion[];
  governanceRevision: number;
  temperature: number;
  createdAt: string;
  /**
   * 技术重试不能重新读取当前已发布提示资产并生成另一份快照。调用方应
   * 传回首次模型请求已经冻结的完整结果；编译器只核对范围和内容后原样
   * 复用。作者主动重新设计不使用此字段，而是创建新的 taskId，并在新
   * 任务载荷的 taskContract 中写入 basedOnTaskId 和
   * authorInstructionVersion。
   */
  retrySnapshot?: V7RuntimePromptCompilationResult | undefined;
}

export interface V7RuntimePromptCompilationResult {
  manifest: V7PromptManifest;
  taskContract: V7TaskContract;
  contextPack: V7ContextPackTrace;
  fixedRoleKey: V7FixedRoleKey;
}

export function compileV7RuntimePrompt(
  request: V7RuntimePromptCompilationRequest
): V7RuntimePromptCompilationResult {
  if (request.sourcePrompt.trim().length === 0) throw new Error('V7任务提示不能为空');
  const stageTaskPayload = sanitizeV7PromptBoundary(structuredTaskPayload(request.sourcePrompt));
  const embeddedContract = embeddedTaskContract(stageTaskPayload);
  const operationMode = request.operationMode ?? embeddedContract.operationMode ?? 'fresh';
  if (operationMode === 'retry') {
    if (request.retrySnapshot === undefined) {
      throw new Error('V7技术重试必须复用首次调用已经冻结的PromptManifest快照');
    }
    return reuseTechnicalRetrySnapshot(request, request.retrySnapshot, stageTaskPayload);
  }
  if (request.retrySnapshot !== undefined) {
    throw new Error('只有技术重试可以传入冻结的PromptManifest快照');
  }
  const fixedRoleKey = resolveFixedRoleKey(request.memberKey, request.runtimeRoleKey);
  // Validate the canonical governance key up front. A provider model id such
  // as doubao-seedream-5-0-260128 is deliberately not accepted here.
  const modelBinding = modelBindingForProfile(request.modelProfileKey);
  const maxOutputTokens = normalizeMaxOutputTokens(
    request.maxOutputTokens ?? defaultMaxOutputTokens(request.taskKind)
  );
  const promptAssets = request.promptAssets ?? V7_PROMPT_SOURCE_ASSETS;
  const rolePrompt = promptAssets.find(
    (candidate) => (candidate.content as { roleKey?: string }).roleKey === fixedRoleKey
  );
  const workstationPrompt = promptAssets.find(
    (candidate) => (candidate.content as { workstationKey?: string }).workstationKey === request.workstationKey
  );
  if (rolePrompt === undefined) throw new Error(`V7岗位提示尚未发布：${fixedRoleKey}`);
  if (workstationPrompt === undefined) throw new Error(`V7工位提示尚未发布：${request.workstationKey}`);
  const roleContract = V7_ROLE_CONTRACTS.find((candidate) => candidate.roleKey === fixedRoleKey);
  if (roleContract === undefined || !roleContract.taskKinds.includes(request.taskKind)) {
    throw new Error(`V7固定岗位不能执行当前任务：${fixedRoleKey}/${request.taskKind}`);
  }

  const estimatedTokens = estimateTokens(request.sourcePrompt);
  const defaultBudget = contextTokenBudget(request.taskKind);
  const tokenBudget = request.contextTokenBudget === undefined
    ? defaultBudget
    : Math.min(defaultBudget, normalizeContextBudget(request.contextTokenBudget));
  if (estimatedTokens > tokenBudget) {
    throw new Error(`V7资料包超过当前工位预算：${estimatedTokens}/${tokenBudget}，请上游只保留本次任务需要的正式资料。`);
  }
  // Most V7 stage builders already emit a structured JSON contract. Preserve
  // that structure inside the manifest instead of double-encoding it as an
  // escaped string; plain-text stage prompts remain plain text.
  const contextContent = { stageTaskPayload } as const;
  const workstationContent = workstationPrompt.content as V7WorkstationPromptContent;
  const contextHash = sha256(stableStringify(contextContent));
  const contextPackId = `ctx-${shortHash(`${request.requestId}:${contextHash}`)}`;
  const contractId = `contract-${shortHash(`${request.requestId}:${request.taskKind}:${request.workstationKey}`)}`;
  const manifestId = `manifest-${shortHash(`${request.requestId}:${fixedRoleKey}:${contextHash}:${modelBinding.provider}:${modelBinding.modelId}:${modelBinding.plan}:${maxOutputTokens}`)}`;
  const compatibleSkills = request.promptAssets === undefined
    ? defaultSkillAssets(request.taskKind)
    : promptAssets.filter((candidate) => candidate.kind === 'skill'
      && (candidate.content as { triggerTaskKinds?: readonly string[] }).triggerTaskKinds?.includes(request.taskKind));
  const requestedSkillKeys = request.skillKeys ?? compatibleSkills.map((skill) => skill.assetKey);
  if (requestedSkillKeys.length === 0 || new Set(requestedSkillKeys).size !== requestedSkillKeys.length) {
    throw new Error('V7任务必须明确选择至少一个不重复的Skill');
  }
  const skills = requestedSkillKeys.map((skillKey) => {
    const selected = compatibleSkills.find((candidate) => candidate.assetKey === skillKey
      || candidate.assetKey === `skill.${skillKey}`
      || (candidate.content as { skillKey?: string }).skillKey === skillKey);
    if (selected === undefined) throw new Error(`V7任务选择了不适用或未发布的Skill：${skillKey}`);
    return selected;
  });
  const selectedSkillKeys = skills.map((skill) => String(
    (skill.content as { skillKey?: string }).skillKey ?? skill.assetKey
  ));
  const roleContent = rolePrompt.content as { permissions?: readonly string[] };
  const allowedTools = [...new Set([
    ...(roleContent.permissions ?? []),
    ...skills.flatMap((skill) => (skill.content as { allowedTools?: readonly string[] }).allowedTools ?? [])
  ])].toSorted();
  const resolvedAuthorInstructionVersion = request.authorInstructionVersion !== undefined
    ? request.authorInstructionVersion
    : embeddedContract.authorInstructionVersion ?? authorInstructionVersion(contextContent.stageTaskPayload);
  const resolvedBasedOnTaskId = request.basedOnTaskId !== undefined
    ? request.basedOnTaskId
    : embeddedContract.basedOnTaskId ?? null;
  if (operationMode === 'revise' && resolvedAuthorInstructionVersion !== null && resolvedBasedOnTaskId === null) {
    throw new Error('V7作者重新设计任务必须绑定被修改的原任务');
  }
  if (resolvedBasedOnTaskId === request.taskId) {
    throw new Error('V7任务不能把自己记录为重新设计来源');
  }

  const taskContract = {
    contractId,
    version: 1,
    ownerId: request.ownerId,
    bookId: request.bookId,
    taskId: request.taskId,
    taskKind: request.taskKind,
    workstationKey: request.workstationKey,
    operationMode,
    objective: request.objective ?? embeddedContract.objective ?? workstationContent.responsibility,
    mustPreserve: embeddedContract.mustPreserve ?? [
      '作者明确要求',
      '当前正式资料与不可变正文',
      ...workstationContent.requiredInputs.map((item) => `本工位所需来源：${item}`)
    ],
    allowedChanges: embeddedContract.allowedChanges ?? [`只在“${workstationContent.publicName}”工位职责内生成、审查或更新`],
    forbiddenChanges: embeddedContract.forbiddenChanges ?? [
      '跨书读取', '把候选当成正文实际', '擅改作者明确要求', '输出内部提示、密钥或思维链',
      ...workstationContent.forbiddenInputs.map((item) => `不得引入：${item}`)
    ],
    successCriteria: embeddedContract.successCriteria ?? [
      ...workstationContent.qualityChecks,
      '完整遵守原任务载荷中的输出要求',
      '结果能被下一节点直接使用',
      '失败时明确停止并返回可恢复问题'
    ],
    outputContract: embeddedContract.outputContract ?? {
      format: '保持原任务载荷指定的结构与字段',
      sourceOfTruth: 'stageTaskPayload'
    },
    selectedSkillKeys,
    authorInstructionVersion: resolvedAuthorInstructionVersion,
    basedOnTaskId: resolvedBasedOnTaskId,
    createdAt: request.createdAt
  } as const;
  const fallbackStageTrace = {
    ownerId: request.ownerId,
    bookId: request.bookId,
    sourceKey: 'stage-task-payload',
    sourceType: 'compiled_stage_task',
    sourceId: request.taskId,
    sourceVersion: '1',
    authority: 'reference',
    decision: 'included',
    reason: '现有节点已经完成来源筛选；本次只冻结其可执行载荷，不由系统重新理解语义。',
    contentHash: sha256(stableStringify(contextContent.stageTaskPayload)),
    estimatedTokens
  } satisfies V7ContextSourceTrace;
  const explicitSourceTraces = request.sourceTraces ?? [];
  // 非空执行载荷至少要有一条“采用”证据。若节点只声明了排除项，保留
  // 聚合后的节点载荷快照作为确定性采用证据，避免后台出现“只有排除项、
  // 但模型实际收到了一整份资料”的审计假象。
  const sourceTraces = explicitSourceTraces.some((source) => source.decision === 'included')
    ? explicitSourceTraces
    : [fallbackStageTrace, ...explicitSourceTraces];
  if (sourceTraces.some((source) => source.ownerId !== request.ownerId || source.bookId !== request.bookId)) {
    throw new Error('V7资料来源与当前书籍范围不一致');
  }
  for (const source of explicitSourceTraces) validateExplicitSourceTrace(source);
  const contextPack = {
    contextPackId,
    ownerId: request.ownerId,
    bookId: request.bookId,
    taskId: request.taskId,
    policyVersion: 'v7-minimal-context-budget@4',
    tokenBudget,
    estimatedTokens,
    sources: sourceTraces,
    content: contextContent,
    contentHash: contextHash,
    createdAt: request.createdAt
  } as const;
  const manifest = compilePromptManifest({
    manifestId,
    memberKey: request.memberKey,
    modelProfileKey: request.modelProfileKey,
    provider: modelBinding.provider,
    modelId: modelBinding.modelId,
    plan: modelBinding.plan,
    maxOutputTokens,
    governanceRevision: request.governanceRevision,
    temperature: request.temperature,
    rolePrompt,
    workstationPrompt,
    genreProfile: request.genreProfile ?? null,
    skills,
    taskContract,
    contextPack,
    allowedTools,
    createdAt: request.createdAt
  });
  return { manifest, taskContract, contextPack, fixedRoleKey };
}

function reuseTechnicalRetrySnapshot(
  request: V7RuntimePromptCompilationRequest,
  snapshot: V7RuntimePromptCompilationResult,
  stageTaskPayload: unknown
): V7RuntimePromptCompilationResult {
  const { manifest, taskContract, contextPack } = snapshot;
  if (taskContract.ownerId !== request.ownerId || taskContract.bookId !== request.bookId
    || taskContract.taskId !== request.taskId || contextPack.ownerId !== request.ownerId
    || contextPack.bookId !== request.bookId || contextPack.taskId !== request.taskId
    || manifest.ownerId !== request.ownerId || manifest.bookId !== request.bookId
    || manifest.taskId !== request.taskId) {
    throw new Error('V7技术重试快照与当前任务或书籍范围不一致');
  }
  if (manifest.memberKey !== request.memberKey || manifest.modelProfileKey !== request.modelProfileKey
    || manifest.taskKind !== request.taskKind || manifest.workstationKey !== request.workstationKey) {
    throw new Error('V7技术重试不能更换成员、模型、任务类型或工位；请改走交接或重新设计');
  }
  const currentBinding = modelBindingForProfile(request.modelProfileKey);
  const requestedMaxOutputTokens = normalizeMaxOutputTokens(
    request.maxOutputTokens ?? defaultMaxOutputTokens(request.taskKind)
  );
  if (manifest.provider !== currentBinding.provider || manifest.modelId !== currentBinding.modelId
    || manifest.plan !== currentBinding.plan || manifest.maxOutputTokens !== requestedMaxOutputTokens) {
    throw new Error('V7技术重试不能更换具体模型绑定或最大输出Token；请改走交接或重新设计');
  }
  const expectedContent = { stageTaskPayload } as const;
  if (stableStringify(expectedContent) !== stableStringify(contextPack.content)) {
    throw new Error('V7技术重试不能带入新的作者意见或资料；请创建重新设计任务');
  }
  if (sha256(stableStringify(contextPack.content)) !== contextPack.contentHash
    || sha256(manifest.compiledPrompt) !== manifest.compiledPromptHash
    || manifest.taskContractId !== taskContract.contractId
    || manifest.taskContractVersion !== taskContract.version
    || manifest.contextPackId !== contextPack.contextPackId
    || manifest.contextPackHash !== contextPack.contentHash) {
    throw new Error('V7技术重试快照校验失败');
  }
  // retry 是一次新的执行尝试，不是新的创作任务。岗位、工位、Skill、
  // ContextPack、模型参数和最终提示都继续使用首次请求的不可变快照；重试
  // 次数与失败原因应记录在模型调用/任务运行记录，而不是伪造新合同版本。
  return snapshot;
}

function resolveFixedRoleKey(memberKey: string, runtimeRoleKey: string): V7FixedRoleKey {
  const member = V7_GLOBAL_MEMBERS.find((candidate) => candidate.memberKey === memberKey);
  if (member !== undefined) return member.fixedRoleKey;
  if (runtimeRoleKey === 'chief_editor' || runtimeRoleKey === 'structure_deputy'
    || runtimeRoleKey === 'commercial_deputy' || runtimeRoleKey === 'chief_comparison') return 'chief_editor';
  if (runtimeRoleKey === 'deputy_editor' || runtimeRoleKey === 'context_editor') return 'deputy_editor';
  if (runtimeRoleKey === 'screenwriter' || runtimeRoleKey === 'planning_writer'
    || runtimeRoleKey === 'outline_writer') return 'planning_writer';
  if (runtimeRoleKey === 'lead_writer') return 'lead_writer';
  if (runtimeRoleKey === 'independent_reviewer') return 'independent_reviewer';
  if (runtimeRoleKey === 'continuity_editor' || runtimeRoleKey === 'planning_maintainer' || runtimeRoleKey === 'settlement_editor'
    || runtimeRoleKey === 'character_curator') return 'continuity_editor';
  if (runtimeRoleKey === 'visual_renderer') return 'visual_renderer';
  throw new Error(`无法确认成员固定岗位：${memberKey}/${runtimeRoleKey}`);
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(Array.from(value).length / 2.5));
}

function normalizeContextBudget(value: number): number {
  if (!Number.isInteger(value) || value < 2_000 || value > 64_000) {
    throw new Error('V7资料包预算必须是2000至64000之间的整数');
  }
  return value;
}

function contextTokenBudget(taskKind: V7AgentTaskKind): number {
  if (taskKind === 'manuscript' || taskKind === 'manuscript_review') return 32_000;
  if (taskKind === 'planning_tree' || taskKind === 'planning_review' || taskKind === 'planning_maintenance'
    || taskKind === 'settlement' || taskKind === 'character_maintenance') return 24_000;
  if (taskKind === 'cover_render' || taskKind === 'cover_brief' || taskKind === 'title_design') return 12_000;
  return 20_000;
}

export function defaultMaxOutputTokens(taskKind: V7AgentTaskKind): number {
  const budgets: Readonly<Partial<Record<V7AgentTaskKind, number>>> = {
    opening_design: 6_000,
    opening_review: 3_000,
    title_design: 1_200,
    setting_recommendation: 4_500,
    setting_design: 6_000,
    setting_review: 4_000,
    planning_context: 4_500,
    planning_recipe: 7_000,
    planning_tree: 12_000,
    planning_review: 5_000,
    planning_maintenance: 6_000,
    chapter_outline: 12_000,
    manuscript: 18_000,
    manuscript_review: 6_000,
    settlement: 8_000,
    character_context: 3_000,
    character_maintenance: 6_000,
    cover_brief: 1_600,
    cover_render: 1_024
  };
  return budgets[taskKind] ?? 6_000;
}

function normalizeMaxOutputTokens(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 200_000) {
    throw new Error('V7最大输出Token必须是1至200000之间的整数');
  }
  return value;
}

function structuredTaskPayload(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

const V7_RUNTIME_SECRET_PATTERN = /(?:Bearer\s+[A-Za-z0-9._-]+|\b(?:sk|ak)-[A-Za-z0-9_-]{8,}|\bark-(?!(?:agent-plan|coding-plan|image)\b)[A-Za-z0-9_-]{8,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?(?:id|token)|cookie)["']?\s*[:=])/iu;
const V7_RUNTIME_EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}\b/giu;
const V7_RUNTIME_MOBILE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/gu;
const V7_RUNTIME_ID_CARD_PATTERN = /(?<!\d)\d{17}[\dXx](?!\d)/gu;

/**
 * Only the model-bound copy is sanitized. The confirmed author source remains
 * immutable in its own store. Clear secrets are rejected; common real-person
 * contact identifiers are replaced before PromptManifest persistence.
 */
export function sanitizeV7PromptBoundary(value: unknown): unknown {
  const serialized = stableStringify(value);
  if (V7_RUNTIME_SECRET_PATTERN.test(serialized)) {
    throw new Error('提示词或资料包包含疑似密钥、会话或登录凭据，已拒绝编译');
  }
  return sanitizeBoundaryValue(value);
}

function sanitizeBoundaryValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeBoundaryText(value);
  if (Array.isArray(value)) return value.map(sanitizeBoundaryValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, sanitizeBoundaryValue(item)]));
  }
  return value;
}

function sanitizeBoundaryText(value: string): string {
  return value
    .replace(V7_RUNTIME_EMAIL_PATTERN, (email) => isReservedFictionalEmail(email) ? email : '[邮箱已隐藏]')
    .replace(V7_RUNTIME_MOBILE_PATTERN, '[手机号已隐藏]')
    .replace(V7_RUNTIME_ID_CARD_PATTERN, '[证件号已隐藏]');
}

function isReservedFictionalEmail(value: string): boolean {
  const domain = value.toLowerCase().split('@').at(-1) ?? '';
  return domain.endsWith('.invalid') || domain.endsWith('.example')
    || domain === 'example.com' || domain === 'example.org' || domain === 'example.net';
}

interface EmbeddedTaskContract {
  operationMode?: V7TaskOperationMode;
  objective?: string;
  mustPreserve?: string[];
  allowedChanges?: string[];
  forbiddenChanges?: string[];
  successCriteria?: string[];
  outputContract?: Readonly<Record<string, unknown>>;
  authorInstructionVersion?: number;
  basedOnTaskId?: string;
}

function embeddedTaskContract(payload: unknown): EmbeddedTaskContract {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const value = (payload as Record<string, unknown>).taskContract;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const mode = record.operationMode;
  const output = record.outputContract;
  return {
    ...(mode === 'fresh' || mode === 'revise' || mode === 'fusion' || mode === 'repair' || mode === 'retry'
      ? { operationMode: mode } : {}),
    ...optionalText(record.objective, 'objective'),
    ...optionalStringList(record.mustPreserve, 'mustPreserve'),
    ...optionalStringList(record.allowedChanges, 'allowedChanges'),
    ...optionalStringList(record.forbiddenChanges, 'forbiddenChanges'),
    ...optionalStringList(record.successCriteria, 'successCriteria'),
    ...(output !== null && typeof output === 'object' && !Array.isArray(output)
      ? { outputContract: output as Readonly<Record<string, unknown>> } : {}),
    ...optionalPositiveInteger(record.authorInstructionVersion, 'authorInstructionVersion'),
    ...optionalText(record.basedOnTaskId, 'basedOnTaskId')
  };
}

function authorInstructionVersion(payload: unknown): number | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const direct = record.authorInstructionVersion;
  if (typeof direct === 'number' && Number.isInteger(direct) && direct >= 1) return direct;
  // 开书想法版本、资料版本和作者调整意见版本是三种不同证据，不能
  // 因字段恰好叫 version 就互相冒充。作者调整版本必须由节点任务合同
  // 显式提供，初始想法版本仍保留在 stageTaskPayload 中追溯。
  return null;
}

function optionalText(value: unknown, key: 'objective' | 'basedOnTaskId'): Partial<Record<typeof key, string>> {
  return typeof value === 'string' && value.trim().length > 0 ? { [key]: value.trim() } : {};
}

function optionalStringList(
  value: unknown,
  key: 'mustPreserve' | 'allowedChanges' | 'forbiddenChanges' | 'successCriteria'
): Partial<Record<typeof key, string[]>> {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) return {};
  return { [key]: value.map((entry) => entry.trim()) };
}

function optionalPositiveInteger(
  value: unknown,
  key: 'authorInstructionVersion'
): Partial<Record<typeof key, number>> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? { [key]: value } : {};
}

/**
 * 结构化任务载荷只保存为聚合证据。细粒度来源必须由调用方在完成范围与
 * 权威校验后，通过 sourceTraces 显式传入；编译器不再从载荷内部猜测。
 */

function validateExplicitSourceTrace(source: V7ContextSourceTrace): void {
  if ([source.sourceKey, source.sourceType, source.sourceId, source.sourceVersion, source.reason]
    .some((value) => value.trim().length === 0)) {
    throw new Error('V7显式资料来源缺少可追溯标识或选择原因');
  }
  if (!/^[a-f0-9]{64}$/u.test(source.contentHash)) {
    throw new Error('V7显式资料来源的内容哈希无效');
  }
  if (!Number.isInteger(source.estimatedTokens) || source.estimatedTokens < 0) {
    throw new Error('V7显式资料来源的Token估算无效');
  }
}

function shortHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 24);
}
