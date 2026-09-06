import type { V7AgentTaskKind, V7FixedRoleKey } from '../agent-governance/agent-governance-contracts.js';

export type V7PromptAssetKind = 'role_prompt' | 'workstation_prompt' | 'genre_persona' | 'skill';
export type V7PromptAssetStatus = 'draft' | 'published' | 'retired';
export type V7TaskOperationMode = 'fresh' | 'revise' | 'fusion' | 'repair' | 'retry';
export type V7ContextAuthority = 'author_source' | 'confirmed' | 'immutable_text' | 'derived' | 'candidate' | 'reference';
export type V7ContextDecision = 'included' | 'excluded';
export type V7PromptModelPlan = 'coding' | 'agent' | 'image';

export type V7WorkstationKey =
  | 'opening'
  | 'setting'
  | 'full_book_route'
  | 'volume'
  | 'chain'
  | 'chapter_outline'
  | 'manuscript'
  | 'review'
  | 'continuity_record'
  | 'title'
  | 'cover_brief'
  | 'cover_render';

export interface V7PromptAssetVersion {
  assetId: string;
  assetKey: string;
  kind: V7PromptAssetKind;
  version: number;
  status: V7PromptAssetStatus;
  title: string;
  summary: string;
  content: Readonly<Record<string, unknown>>;
  createdAt: string;
  createdBy: string;
  basedOnVersion: number | null;
}

export interface V7RolePromptContent extends Record<string, unknown> {
  roleKey: V7FixedRoleKey;
  responsibility: string;
  capabilities: readonly string[];
  permissions: readonly string[];
  boundaries: readonly string[];
  failureContract: string;
}

export interface V7WorkstationPromptContent extends Record<string, unknown> {
  workstationKey: V7WorkstationKey;
  publicName: string;
  taskKinds: readonly V7AgentTaskKind[];
  responsibility: string;
  requiredInputs: readonly string[];
  forbiddenInputs: readonly string[];
  qualityChecks: readonly string[];
  stageBoundary: string;
}

export interface V7GenrePersonaContent extends Record<string, unknown> {
  genreKey: string;
  publicName: string;
  aliases: readonly string[];
  readerPromise: readonly string[];
  creativePriorities: readonly string[];
  authenticityChecks: readonly string[];
  commonFailures: readonly string[];
  fusionBoundary: string;
}

export interface V7SkillContent extends Record<string, unknown> {
  skillKey: string;
  responsibility: string;
  triggerTaskKinds: readonly V7AgentTaskKind[];
  procedure: readonly string[];
  allowedTools: readonly string[];
  stopConditions: readonly string[];
  outputRequirements: readonly string[];
}

export interface V7BookGenreProfile {
  profileId: string;
  ownerId: string;
  bookId: string;
  version: number;
  status: 'candidate' | 'active' | 'superseded';
  primaryGenreKey: string;
  supportingGenreKeys: readonly string[];
  sourceAssetVersionIds: readonly string[];
  sourceBookVersion: number;
  publicLabel: string;
  workingIdentity: string;
  primaryPromise: string;
  supportingFunctions: readonly string[];
  writingPriorities: readonly string[];
  authenticityChecks: readonly string[];
  avoidPatterns: readonly string[];
  conflictResolutions: readonly string[];
  compiledByTaskId: string;
  createdAt: string;
}

export interface V7TaskContract {
  contractId: string;
  /**
   * 同一创作任务合同发生正式修订时才递增。作者主动“重新设计”会创建
   * 新 taskId/contractId，并用 basedOnTaskId 追溯原任务，因此新合同从
   * version=1 开始；技术重试不创建合同版本，只复用原 PromptManifest。
   */
  version: number;
  ownerId: string;
  bookId: string;
  taskId: string;
  taskKind: V7AgentTaskKind;
  workstationKey: V7WorkstationKey;
  operationMode: V7TaskOperationMode;
  objective: string;
  mustPreserve: readonly string[];
  allowedChanges: readonly string[];
  forbiddenChanges: readonly string[];
  successCriteria: readonly string[];
  outputContract: Readonly<Record<string, unknown>>;
  /** 本次任务明确启用的 Skill 资产键；具体不可变版本仍冻结在 PromptManifest。 */
  selectedSkillKeys: readonly string[];
  authorInstructionVersion: number | null;
  /** 作者主动重新设计时指向被替代任务；普通首次任务与技术重试不填写。 */
  basedOnTaskId: string | null;
  createdAt: string;
}

export interface V7ContextSourceTrace {
  ownerId: string;
  bookId: string;
  sourceKey: string;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  authority: V7ContextAuthority;
  decision: V7ContextDecision;
  reason: string;
  contentHash: string;
  estimatedTokens: number;
}

export interface V7ContextPackTrace {
  contextPackId: string;
  ownerId: string;
  bookId: string;
  taskId: string;
  policyVersion: string;
  tokenBudget: number;
  estimatedTokens: number;
  sources: readonly V7ContextSourceTrace[];
  content: Readonly<Record<string, unknown>>;
  contentHash: string;
  createdAt: string;
}

export interface V7PromptManifest {
  manifestId: string;
  ownerId: string;
  bookId: string;
  taskId: string;
  memberKey: string;
  roleKey: V7FixedRoleKey;
  workstationKey: V7WorkstationKey;
  taskKind: V7AgentTaskKind;
  operationMode: V7TaskOperationMode;
  rolePromptVersionId: string;
  workstationPromptVersionId: string;
  genreProfileId: string | null;
  genreProfileVersion: number | null;
  skillVersionIds: readonly string[];
  taskContractId: string;
  taskContractVersion: number;
  contextPackId: string;
  contextPackHash: string;
  modelProfileKey: string;
  /** 本次模型请求冻结的实际供应商，不随后台后续配置变化。 */
  provider: string;
  /** 本次模型请求冻结的实际模型编号。 */
  modelId: string;
  /** 本次模型请求冻结的实际套餐/调用通道。 */
  plan: V7PromptModelPlan;
  /** 本次模型请求允许生成的最大输出 Token。 */
  maxOutputTokens: number;
  governanceRevision: number;
  temperature: number;
  allowedTools: readonly string[];
  compiledBlocks: Readonly<Record<string, unknown>>;
  compiledPrompt: string;
  compiledPromptHash: string;
  createdAt: string;
}

export interface V7PromptCompilationInput {
  manifestId: string;
  memberKey: string;
  modelProfileKey: string;
  provider: string;
  modelId: string;
  plan: V7PromptModelPlan;
  maxOutputTokens: number;
  governanceRevision: number;
  temperature: number;
  rolePrompt: V7PromptAssetVersion;
  workstationPrompt: V7PromptAssetVersion;
  genreProfile: V7BookGenreProfile | null;
  skills: readonly V7PromptAssetVersion[];
  taskContract: V7TaskContract;
  contextPack: V7ContextPackTrace;
  allowedTools: readonly string[];
  createdAt: string;
}

export interface V7GenreFusionTaskInput {
  taskContract: V7TaskContract;
  primaryGenre: V7PromptAssetVersion;
  supportingGenres: readonly V7PromptAssetVersion[];
  confirmedBookBrief: Readonly<Record<string, unknown>>;
}
