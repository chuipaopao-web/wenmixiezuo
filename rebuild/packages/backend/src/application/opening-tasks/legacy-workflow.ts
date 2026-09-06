import { DomainError } from "../../domain/errors.js";
import type { PgClient } from "../../infrastructure/postgres/client.js";
import { ModelAdapterError } from "../../infrastructure/models/model-adapter.js";
import { OpeningAgentEngine } from "../../legacy-opening/opening-agent/opening-agent-engine.js";
import { OpeningAgentModelError, OpeningAgentStoppedError, type OpeningAgentToolGateway, type OpeningAgentTaskState,
  type OpeningCandidateContent, type OpeningCandidateCommit, type OpeningSavedCandidate, type OpeningModelRequest,
  type OpeningModelResult, type OpeningReconciliation, type OpeningReconciliationRequest,
  type OpeningTaxonomyReference } from "../../legacy-opening/opening-agent/opening-agent-contracts.js";
import { validateEffectiveOpeningAgentRoster, type V7OpeningMemberDefinition } from "../../legacy-opening/agents/agent-roster.js";
import { openingRosterFromGlobal } from "../../legacy-opening/agent-governance/runtime-rosters.js";
import { modelProfileKeyForBinding, taskTemperaturePolicy } from "../../legacy-opening/agent-governance/agent-governance-registry.js";
import { sha256, stableStringify, V7_PROMPT_SOURCE_ASSETS, type V7PromptAssetVersion } from "../../legacy-opening/prompt-governance/index.js";
import { compileV7RuntimePrompt, type V7RuntimePromptCompilationResult } from "../../legacy-opening/runtime-prompt-compiler.js";
import { OPENING_TAXONOMY } from "../bookshelf/taxonomy-source/opening-blueprint.js";
import { ExistingOpeningModelExecutor } from "./existing-model-executor.js";
import { OpeningTaskService, type OpeningLease, type OpeningTask, type OpeningPolicy } from "./service.js";

interface Snapshot {
  version: 1;
  roster: V7OpeningMemberDefinition[];
  chief: string | null;
  designer: string | null;
  promptAssets: V7PromptAssetVersion[];
  governanceRevision: number;
  temperatures: Record<string, Record<"opening_design" | "opening_review", number>>;
}
export interface OpeningWorkflowOptions {
  memberRoster?: readonly V7OpeningMemberDefinition[];
  promptAssets?: readonly V7PromptAssetVersion[];
  governanceRevision?: number;
  /** Trusted published policy values, keyed by member then task kind. */
  temperatures?: Record<string, Partial<Record<"opening_design" | "opening_review", number>>>;
}
type CandidateRow = { candidate_id: string; kind: OpeningSavedCandidate["kind"]; version: number; content: OpeningCandidateContent;
  member_key: string; model_request_id: string; source_candidate_ids: string[] };
type PromptRow = { request: OpeningModelRequest; request_hash: string; compilation: V7RuntimePromptCompilationResult };
type CallRow = { receipt: null | { outcome: string; result: Record<string, unknown> } };

/** Same engine and prompt compilation as V7. Only its storage/model tool boundaries are adapted. */
export class ExistingOpeningWorkflow {
  constructor(private readonly tasks: OpeningTaskService, private readonly executor: ExistingOpeningModelExecutor) {}

  async create(token: string, key: string, input: { idea: string; selectedChiefMemberKey?: string; selectedScreenwriterMemberKey?: string }, policy: OpeningPolicy, options: OpeningWorkflowOptions = {}): Promise<OpeningTask> {
    const roster = structuredClone(options.memberRoster ?? openingRosterFromGlobal()).map(member => ({ ...member, promptInstruction: "" }));
    if (validateEffectiveOpeningAgentRoster(roster).length) throw new DomainError("TASK_REQUEST_INVALID", "当前开书团队配置不完整。");
    const select = (key: string | undefined, role: "chief_editor" | "screenwriter") => {
      if (key === undefined) return null;
      if (!roster.some(m => m.memberKey === key && m.roleKey === role && m.enabledByDefault)) throw new DomainError("TASK_REQUEST_INVALID", "所选成员当前不可用于该岗位。");
      return key;
    };
    const temperatures: Snapshot["temperatures"] = {};
    for (const member of roster) {
      temperatures[member.memberKey] = { opening_design: 0, opening_review: 0 };
      for (const kind of ["opening_design", "opening_review"] as const) {
        const spec = taskTemperaturePolicy(kind);
        const value = options.temperatures?.[member.memberKey]?.[kind] ?? spec.defaultTemperature;
        if (!Number.isFinite(value) || value < spec.minimumTemperature || value > spec.maximumTemperature) throw new DomainError("TASK_REQUEST_INVALID", "成员创作参数不在当前岗位允许范围内。");
        temperatures[member.memberKey]![kind] = value;
      }
    }
    const snapshot: Snapshot = { version: 1, roster, chief: select(input.selectedChiefMemberKey, "chief_editor"),
      designer: select(input.selectedScreenwriterMemberKey, "screenwriter"), promptAssets: structuredClone([...(options.promptAssets ?? V7_PROMPT_SOURCE_ASSETS)]),
      governanceRevision: options.governanceRevision ?? 0, temperatures };
    if (!Number.isSafeInteger(snapshot.governanceRevision) || snapshot.governanceRevision < 0) throw new DomainError("TASK_REQUEST_INVALID", "提示配置版本不正确。");
    return this.tasks.enqueue(token, key, { idea: input.idea, ...(snapshot.designer ? { memberId: snapshot.designer } : {}), workflow: snapshot }, policy);
  }

  async run(taskId: string, ownerId: string, workerId: string): Promise<{ task: OpeningTask; state: OpeningAgentTaskState | null }> {
    const task = await this.tasks.claim(taskId, ownerId, workerId);
    if (task.status !== "running") return { task, state: task.engine_state as unknown as OpeningAgentTaskState | null };
    const lease = { taskId, ownerId, workerId, token: task.lease_token };
    const snapshot = snapshotOf(task);
    const tools = new PostgresOpeningTools(this.tasks, lease);
    const gateway = new ExistingEngineModelGateway(this.tasks, this.executor, lease, snapshot);
    const engine = new OpeningAgentEngine(gateway, tools, TAXONOMY);
    let state: OpeningAgentTaskState;
    try {
      state = await engine.run({ taskId, ownerId, memberRoster: snapshot.roster,
        ...(snapshot.chief ? { selectedChiefMemberKey: snapshot.chief } : {}),
        ...(snapshot.designer ? { selectedScreenwriterMemberKey: snapshot.designer } : {}) });
    } catch (error) {
      if (!(error instanceof OpeningAgentStoppedError)) throw error;
      state = error.state;
    }
    const outcome = state.status === "awaiting_author_confirmation" || state.status === "awaiting_author_decision"
      ? "awaiting_author" : state.status === "interrupted" ? "interrupted" : "failed";
    return { task: await this.tasks.finishExecution(lease, outcome), state };
  }
}

export class PostgresOpeningTools implements OpeningAgentToolGateway {
  constructor(private readonly tasks: OpeningTaskService, private readonly lease: OpeningLease) {}
  async readOpeningIdea(ownerId: string, taskId: string) {
    this.scope(ownerId, taskId);
    return this.tasks.withExecution(this.lease, async (_client, task) => {
      const text = ideaOf(task);
      return { text, hash: sha256(text), version: 1, publishingPlatform: "fanqie" as const };
    }, true);
  }
  async loadTask(ownerId: string, taskId: string): Promise<OpeningAgentTaskState | null> {
    this.scope(ownerId, taskId);
    return this.tasks.withExecution(this.lease, async (_client, task) => {
      const state = task.engine_state as unknown as OpeningAgentTaskState | null;
      if (state) this.stateScope(task, state);
      return state;
    }, true);
  }
  async createTask(state: OpeningAgentTaskState) {
    return this.tasks.withExecution(this.lease, async (client, task) => {
      this.stateScope(task, state);
      if (task.engine_state) return task.engine_state as unknown as OpeningAgentTaskState;
      await this.writeState(client, state);
      return state;
    });
  }
  async saveTask(state: OpeningAgentTaskState): Promise<void> {
    await this.tasks.withExecution(this.lease, async (client, task) => {
      this.stateScope(task, state);
      // Parsed success precedes commitCandidate in the existing engine. Until the
      // candidate and next phase commit, recovery must reconcile the saved receipt.
      const durable = structuredClone(state);
      for (const attempt of durable.attempts) {
        if (attempt.phase !== durable.phase || attempt.status !== "succeeded") continue;
        const saved = await client.query("SELECT candidate_id FROM opening_workflow_candidates WHERE task_id=$1 AND model_request_id=$2", [task.task_id, attempt.requestId]);
        if (!saved.rows.length) attempt.status = "working";
      }
      await this.writeState(client, durable);
    }, true);
  }
  async readCandidate<T extends OpeningCandidateContent>(ownerId: string, taskId: string, candidateId: string): Promise<OpeningSavedCandidate<T>> {
    this.scope(ownerId, taskId);
    return this.tasks.withExecution(this.lease, async client => {
      const row = (await client.query<CandidateRow>("SELECT * FROM opening_workflow_candidates WHERE task_id=$1 AND candidate_id=$2", [taskId, candidateId])).rows[0];
      if (!row) throw new OpeningAgentModelError("候选结果不存在或不属于本次开书。", "version_changed");
      return candidate(row) as OpeningSavedCandidate<T>;
    }, true);
  }
  async commitCandidate<T extends OpeningCandidateContent>(ownerId: string, taskId: string, input: OpeningCandidateCommit<T>): Promise<OpeningSavedCandidate<T>> {
    this.scope(ownerId, taskId);
    return this.tasks.withExecution(this.lease, async (client, task) => {
      this.stateScope(task, input.nextState);
      const existing = (await client.query<CandidateRow>("SELECT * FROM opening_workflow_candidates WHERE task_id=$1 AND model_request_id=$2", [taskId, input.modelRequestId])).rows[0];
      if (existing) {
        if (existing.candidate_id !== input.candidateId || existing.kind !== input.kind || existing.member_key !== input.createdByMemberKey
          || digest(existing.content) !== digest(input.content) || digest(existing.source_candidate_ids) !== digest(input.sourceCandidateIds)) {
          throw new DomainError("TASK_IDEMPOTENCY_CONFLICT", "该模型结果已经保存为不同候选。");
        }
        return candidate(existing) as OpeningSavedCandidate<T>;
      }
      const call = await callForRequest(client, taskId, input.modelRequestId);
      const prompt = (await client.query<PromptRow>("SELECT * FROM opening_workflow_prompts WHERE task_id=$1 AND request_id=$2", [taskId, input.modelRequestId])).rows[0];
      if (call?.receipt?.outcome !== "continue" || prompt?.request.member.memberKey !== input.createdByMemberKey) throw new OpeningAgentModelError("候选缺少同源成功模型结果。", "version_changed");
      for (const source of input.sourceCandidateIds) {
        const found = await client.query("SELECT candidate_id FROM opening_workflow_candidates WHERE task_id=$1 AND candidate_id=$2", [taskId, source]);
        if (!found.rows.length) throw new OpeningAgentModelError("候选来源不属于本次开书。", "version_changed");
      }
      const row = (await client.query<CandidateRow>(`INSERT INTO opening_workflow_candidates
        (task_id,candidate_id,kind,version,content,member_key,model_request_id,source_candidate_ids)
        VALUES ($1,$2,$3,(SELECT COALESCE(MAX(version),0)+1 FROM opening_workflow_candidates WHERE task_id=$1 AND kind=$3),$4,$5,$6,$7) RETURNING *`,
        [taskId, input.candidateId, input.kind, JSON.stringify(input.content), input.createdByMemberKey, input.modelRequestId, JSON.stringify(input.sourceCandidateIds)])).rows[0]!;
      await this.writeState(client, input.nextState);
      return candidate(row) as OpeningSavedCandidate<T>;
    });
  }
  private async writeState(client: PgClient, state: OpeningAgentTaskState) {
    await client.query("UPDATE opening_tasks SET engine_state=$2 WHERE task_id=$1", [this.lease.taskId, JSON.stringify(state)]);
  }
  private scope(ownerId: string, taskId: string) {
    if (ownerId !== this.lease.ownerId || taskId !== this.lease.taskId) throw new DomainError("TASK_SCOPE_DENIED", "开书任务范围不一致。");
  }
  private stateScope(task: OpeningTask, state: OpeningAgentTaskState) {
    this.scope(state.ownerId, state.taskId);
    if (state.ideaVersion !== 1 || state.ideaHash !== sha256(ideaOf(task))) throw new OpeningAgentModelError("开书原始输入版本不一致。", "version_changed");
  }
}

class ExistingEngineModelGateway {
  constructor(private readonly tasks: OpeningTaskService, private readonly executor: ExistingOpeningModelExecutor,
    private readonly lease: OpeningLease, private readonly snapshot: Snapshot) {}

  async generate(request: OpeningModelRequest): Promise<OpeningModelResult> {
    this.scope(request);
    const compiled = await this.freezePrompt(request);
    const saved = await this.lookup({ requestId: request.requestId, taskId: request.taskId,
      ownerId: request.ownerId, nodeKey: request.nodeKey, memberKey: request.member.memberKey });
    if (saved) return this.unwrap(saved);
    try {
      const result = await this.executor.execute({ lease: this.lease, step: sha256(request.requestId), memberKey: request.member.memberKey,
        provider: request.member.model.provider, modelId: request.member.model.modelId, prompt: compiled.manifest.compiledPrompt,
        maxOutputTokens: request.maxOutputTokens, temperature: this.snapshot.temperatures[request.member.memberKey]![request.taskKind] }, undefined, true);
      return { ...result, requestId: request.requestId };
    } catch (error) {
      if (error instanceof ModelAdapterError) throw new OpeningAgentModelError(error.message,
        error.outcomeUnknown ? "outcome_unknown" : error.failureClass === "authentication_failure" ? "credential_unavailable" : "provider_unavailable", error.outcomeUnknown);
      if (error instanceof DomainError && error.code.startsWith("USAGE_")) throw new OpeningAgentModelError(error.message, "budget_exhausted");
      if (error instanceof DomainError && error.code === "CONFIGURATION_INVALID") throw new OpeningAgentModelError(error.message, "credential_unavailable");
      throw error;
    }
  }
  async reconcile(request: OpeningReconciliationRequest): Promise<OpeningReconciliation> {
    this.scope(request);
    return await this.lookup(request) ?? { status: "failed", failureClass: "provider_unavailable", message: "该请求尚未发送，已有阶段结果保留。" };
  }
  private async lookup(request: OpeningReconciliationRequest): Promise<OpeningReconciliation | null> {
    return this.tasks.withExecution(this.lease, async client => {
      const prompt = (await client.query<PromptRow>("SELECT * FROM opening_workflow_prompts WHERE task_id=$1 AND request_id=$2", [request.taskId, request.requestId])).rows[0];
      if (prompt && (prompt.request.nodeKey !== request.nodeKey || prompt.request.member.memberKey !== request.memberKey)) throw new OpeningAgentModelError("调用恢复范围不一致。", "version_changed");
      const call = await callForRequest(client, request.taskId, request.requestId);
      if (!call) return null;
      if (!call.receipt) return { status: "unknown" };
      if (call.receipt.outcome === "not_started") return { status: "failed", failureClass: call.receipt.result?.failureClass === "authentication_failure" ? "credential_unavailable" : "provider_unavailable", message: "供应商明确拒绝了该请求。" };
      const result = call.receipt.result;
      if (typeof result?.output !== "string" || typeof result.inputTokens !== "number" || typeof result.outputTokens !== "number") return { status: "unknown" };
      return { status: "succeeded", result: { requestId: request.requestId, provider: String(result.provider), modelId: String(result.modelId),
        output: result.output, inputTokens: result.inputTokens, outputTokens: result.outputTokens } };
    }, true);
  }
  private async freezePrompt(request: OpeningModelRequest): Promise<V7RuntimePromptCompilationResult> {
    const member = this.snapshot.roster.find(m => m.memberKey === request.member.memberKey);
    if (!member || digest(member) !== digest(request.member)) throw new OpeningAgentModelError("成员与冻结的开书团队不一致。", "version_changed");
    return this.tasks.withExecution(this.lease, async client => {
      const existing = (await client.query<PromptRow>("SELECT * FROM opening_workflow_prompts WHERE task_id=$1 AND request_id=$2", [request.taskId, request.requestId])).rows[0];
      if (existing) {
        if (existing.request_hash !== digest(request)) throw new OpeningAgentModelError("本次调用与已保存输入不一致。", "version_changed");
        return existing.compilation;
      }
      if (request.basedOnTaskId) {
        const source = await callForRequest(client, request.taskId, request.basedOnTaskId);
        const prompt = (await client.query<PromptRow>("SELECT * FROM opening_workflow_prompts WHERE task_id=$1 AND request_id=$2", [request.taskId, request.basedOnTaskId])).rows[0];
        if (source?.receipt?.outcome !== "continue" || (request.operationMode === "repair" && prompt?.request.member.memberKey !== request.member.memberKey)) throw new OpeningAgentModelError("修订或修复缺少同源模型结果。", "version_changed");
      }
      const compiled = compileV7RuntimePrompt({ requestId: request.requestId, ownerId: request.ownerId, bookId: `v7-prebook:${request.taskId}`,
        taskId: request.requestId, memberKey: request.member.memberKey, runtimeRoleKey: request.member.roleKey,
        modelProfileKey: modelProfileKeyForBinding(request.member.model), taskKind: request.taskKind, workstationKey: request.workstationKey,
        operationMode: request.operationMode, authorInstructionVersion: request.authorInstructionVersion, basedOnTaskId: request.basedOnTaskId,
        sourcePrompt: request.prompt, sourceTraces: request.sourceTraces, promptAssets: this.snapshot.promptAssets,
        governanceRevision: this.snapshot.governanceRevision, maxOutputTokens: request.maxOutputTokens,
        temperature: this.snapshot.temperatures[request.member.memberKey]![request.taskKind], createdAt: new Date().toISOString() });
      await client.query("INSERT INTO opening_workflow_prompts (task_id,request_id,request_hash,request,compilation) VALUES ($1,$2,$3,$4,$5)",
        [request.taskId, request.requestId, digest(request), JSON.stringify(request), JSON.stringify(compiled)]);
      return compiled;
    });
  }
  private scope(request: { ownerId: string; taskId: string }) {
    if (request.ownerId !== this.lease.ownerId || request.taskId !== this.lease.taskId) throw new OpeningAgentModelError("模型请求范围不一致。", "version_changed");
  }
  private unwrap(result: OpeningReconciliation): OpeningModelResult {
    if (result.status === "succeeded") return result.result;
    if (result.status === "unknown") throw new OpeningAgentModelError("供应商结果仍未知。", "outcome_unknown", true);
    throw new OpeningAgentModelError(result.message, result.failureClass);
  }
}

function snapshotOf(task: OpeningTask): Snapshot {
  const value = (task.request as unknown as { workflow?: Snapshot }).workflow;
  if (!value || value.version !== 1 || !Array.isArray(value.roster)) throw new DomainError("TASK_REQUEST_INVALID", "该任务缺少已冻结的原开书流程配置。");
  return value;
}
function ideaOf(task: OpeningTask): string {
  const value = (task.request as unknown as { idea?: unknown }).idea;
  if (typeof value !== "string") throw new DomainError("TASK_REQUEST_INVALID", "开书原始输入无法读取。");
  return value;
}
function digest(value: unknown) { return sha256(stableStringify(value)); }
function candidate(row: CandidateRow): OpeningSavedCandidate { return { candidateId: row.candidate_id, kind: row.kind, version: row.version, content: row.content,
  createdByMemberKey: row.member_key, modelRequestId: row.model_request_id, sourceCandidateIds: row.source_candidate_ids }; }
async function callForRequest(client: PgClient, taskId: string, requestId: string): Promise<CallRow | undefined> {
  return (await client.query<CallRow>("SELECT receipt FROM opening_task_calls WHERE task_id=$1 AND step=$2", [taskId, sha256(requestId)])).rows[0];
}
const common = OPENING_TAXONOMY.tagGroups.find(g => g.key === "common");
const TAXONOMY: OpeningTaxonomyReference = { version: OPENING_TAXONOMY.version,
  categories: OPENING_TAXONOMY.categories.map(c => ({ key: c.key, name: c.name, channel: c.channel, description: c.description, recommendedTags: [...c.recommendedMainTags] })),
  subjects: OPENING_TAXONOMY.subjects.map(s => s.name),
  tagSuggestions: [...new Set([...OPENING_TAXONOMY.categories.flatMap(c => c.recommendedMainTags), ...(common ? [...common.mainTags, ...common.auxiliaryTags, ...common.storyTraits].slice(0,80) : [])])],
  allowedTags: [...OPENING_TAXONOMY.mainTags] };
