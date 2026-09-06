import {
  decideV7AgentFailure,
  nextFallbackMember,
  type V7AgentFailureClass
} from '../agents/agent-failure-policy.js';
import {
  buildOpeningFallbackChain,
  type V7OpeningMemberDefinition,
  type V7OpeningRoleKey
} from '../agents/agent-roster.js';
import { openingRosterFromGlobal } from '../agent-governance/runtime-rosters.js';
import type { V7OpeningNodeKey } from '../agents/agent-tools.js';
import {
  sha256,
  stableStringify,
  type V7ContextSourceTrace
} from '../prompt-governance/index.js';
import {
  type OpeningAgentOperationMode,
  OpeningAgentModelError,
  OpeningAgentStoppedError,
  type OpeningAgentModelGateway,
  type OpeningAgentTaskState,
  type OpeningAgentToolGateway,
  type OpeningCandidateContent,
  type OpeningIdeaSnapshot,
  type OpeningReferencePack,
  type OpeningModelAttempt,
  type OpeningModelResult,
  type OpeningNodeSpecification,
  type OpeningPackage,
  type OpeningPublishingPlatform,
  type OpeningReview,
  type OpeningSavedCandidate,
  type OpeningStructuredGeneration,
  type OpeningTaxonomyReference
} from './opening-agent-contracts.js';
import {
  parseOpeningPackage,
  parseOpeningReview
} from './opening-output-validation.js';
import {
  buildOpeningAgentPrompt
} from './opening-prompt-compiler.js';
import { buildOpeningReferencePack } from './opening-reference-tools.js';

const DEFAULT_OPENING_ROSTER = openingRosterFromGlobal();

interface OpeningAttemptPromptContext {
  operationMode: OpeningAgentOperationMode;
  basedOnTaskId: string | null;
  authorInstructionVersion: number | null;
}

export interface RunOpeningAgentInput {
  ownerId: string;
  taskId: string;
  selectedChiefMemberKey?: string;
  selectedScreenwriterMemberKey?: string;
  /** 创建任务时冻结的有效成员表；恢复任务时必须继续传入同一快照。 */
  memberRoster?: readonly V7OpeningMemberDefinition[];
}

export class OpeningAgentEngine {
  public constructor(
    private readonly modelGateway: OpeningAgentModelGateway,
    private readonly toolGateway: OpeningAgentToolGateway,
    private readonly taxonomy: OpeningTaxonomyReference | null = null
  ) {}

  public async run(input: RunOpeningAgentInput): Promise<OpeningAgentTaskState> {
    const idea = await this.toolGateway.readOpeningIdea(input.ownerId, input.taskId);
    let state = await this.toolGateway.loadTask(input.ownerId, input.taskId);
    if (state === null) {
      state = await this.toolGateway.createTask(initialState(input, idea.version, idea.hash));
    } else {
      assertTaskSource(state, input.ownerId, idea.version, idea.hash);
      if (state.status === 'interrupted' && state.attempts.some((attempt) => attempt.status === 'unknown')) {
        state = { ...state, status: 'working', errorCode: null, errorMessage: null };
        await this.toolGateway.saveTask(state);
      }
    }
    if (state.status !== 'working') return state;
    if (state.phase === 'work_order' || state.workOrderCandidateId !== null) {
      return this.stop(
        state,
        'failed',
        'workflow_retired',
        '这项历史开书任务不能按当前流程继续，已有结果已经保留。请重新提交开书想法。'
      );
    }
    const references = buildOpeningReferencePack(idea.text);

    while (state.status === 'working') {
      if (state.phase === 'package_design' || state.phase === 'package_revision') {
        const previousPackage: OpeningSavedCandidate<OpeningPackage> | null = state.activePackageCandidateId === null
          ? null
          : await this.requireCandidate<OpeningPackage>(state, state.activePackageCandidateId, '开书资料包');
        const previousReview: OpeningSavedCandidate<OpeningReview> | null = state.activeReviewCandidateId === null
          ? null
          : await this.requireCandidate<OpeningReview>(state, state.activeReviewCandidateId, '主编审查');
        const authorInstructionVersion = previousPackage?.createdByMemberKey === 'author'
          ? previousPackage.version : null;
        const generated: GeneratedWithState<OpeningPackage> = await this.generateStructured(
          state,
          this.packageSpecification(idea.text, idea.publishingPlatform),
          input.memberRoster,
          openingSourceTraces(
            state,
            idea,
            references,
            [...savedCandidate(previousPackage), ...savedCandidate(previousReview)],
            this.taxonomy
          ),
          authorInstructionVersion,
          (validationRepair, member, contract) => (
          buildOpeningAgentPrompt({
            taskId: state!.taskId, nodeKey: 'opening_package_design', authorIdea: idea.text,
            roleKey: PACKAGE_SPEC.roleKey,
            taskKind: PACKAGE_SPEC.taskKind,
            workstationKey: PACKAGE_SPEC.workstationKey,
            operation: contract.operationMode === 'revise'
              ? 'v7_opening_package_revision_v1'
              : 'v7_opening_package_design_v1',
            ...contract,
            publishingPlatform: idea.publishingPlatform,
            ideaVersion: idea.version, referencePack: references,
            openingPackage: previousPackage?.content ?? null, review: previousReview?.content ?? null,
            taxonomy: this.taxonomy, validationRepair, memberInstruction: member.promptInstruction,
            authorInstructionVersion
          })
        ));
        if (previousPackage?.content.revisionDirective !== undefined) {
          generated.generation.content = constrainOpeningRevision(
            previousPackage.content,
            generated.generation.content,
            previousPackage.content.revisionDirective.allowedFields
          );
        }
        if ((previousPackage?.content.authorInstructions?.length ?? 0) > 0) {
          generated.generation.content.authorInstructions = [...previousPackage!.content.authorInstructions!];
        }
        state = await this.commit(
          state,
          generated,
          'opening_package',
          state.phase === 'package_revision' ? 'package_re_review' : 'package_review',
          [...candidateId(previousPackage), ...candidateId(previousReview)]
        );
        continue;
      }

      if (state.phase === 'package_review' || state.phase === 'package_re_review') {
        const packageCandidate: OpeningSavedCandidate<OpeningPackage> = await this.requireCandidate<OpeningPackage>(state, state.activePackageCandidateId, '开书资料包');
        const generated: GeneratedWithState<OpeningReview> = await this.generateStructured(
          state,
          REVIEW_SPEC,
          input.memberRoster,
          openingSourceTraces(state, idea, references, [packageCandidate], null),
          null,
          (validationRepair, member, contract) => (
          buildOpeningAgentPrompt({
            taskId: state!.taskId, nodeKey: 'opening_package_review', authorIdea: idea.text,
            roleKey: REVIEW_SPEC.roleKey,
            taskKind: REVIEW_SPEC.taskKind,
            workstationKey: REVIEW_SPEC.workstationKey,
            operation: 'v7_opening_package_review_v1',
            ...contract,
            publishingPlatform: idea.publishingPlatform,
            ideaVersion: idea.version, referencePack: references,
            openingPackage: packageCandidate.content, review: null, taxonomy: this.taxonomy, validationRepair,
            memberInstruction: member.promptInstruction
          })),
          [modelSignatureForCandidate(packageCandidate, input.memberRoster ?? DEFAULT_OPENING_ROSTER)]
        );
        const review = generated.generation.content;
        if (review.verdict === 'pass') {
          state = await this.commit(state, generated, 'opening_review', 'complete', [packageCandidate.candidateId], 'awaiting_author_confirmation');
          continue;
        }
        state = await this.commit(state, generated, 'opening_review', 'complete', [packageCandidate.candidateId], 'awaiting_author_decision');
        continue;
      }

      if (state.phase === 'complete') return state;
      throw new Error(`不支持的开书任务阶段：${state.phase}`);
    }
    return state;
  }

  private async generateStructured<T extends OpeningCandidateContent>(
    initial: OpeningAgentTaskState,
    specification: OpeningNodeSpecification<T>,
    memberRoster: readonly V7OpeningMemberDefinition[] | undefined,
    sourceTraces: readonly V7ContextSourceTrace[],
    authorInstructionVersion: number | null,
    promptFactory: (
      validationRepair: string | null,
      member: V7OpeningMemberDefinition,
      contract: OpeningAttemptPromptContext
    ) => string,
    excludedModelSignatures: readonly string[] = []
  ): Promise<{ generation: OpeningStructuredGeneration<T>; state: OpeningAgentTaskState }> {
    let state = initial;
    const selectedMemberKey = specification.roleKey === 'chief_editor'
      ? state.selectedChiefMemberKey ?? undefined
      : state.selectedScreenwriterMemberKey ?? undefined;
    const effectiveRoster = memberRoster ?? DEFAULT_OPENING_ROSTER;
    const fallbackChain = buildOpeningFallbackChain(specification.roleKey, {
      ...(selectedMemberKey === undefined ? {} : { selectedMemberKey }),
      members: effectiveRoster
    }).filter((member) => !excludedModelSignatures.includes(modelSignature(member)));
    if (fallbackChain.length === 0) throw new OpeningAgentModelError('没有与设计者底座不同的可用审查成员', 'provider_unavailable');
    const attempted = new Set(state.attemptedMemberKeys[state.phase] ?? []);
    let member = this.pendingMember(state, specification.nodeKey, memberRoster)
      ?? nextFallbackMember(fallbackChain, attempted);
    let validationRepair: string | null = null;

    while (member !== null) {
      const pending = findPendingAttempt(state, specification.nodeKey, member.memberKey);
      let result: OpeningModelResult | null = null;
      let failure: {
        failureClass: V7AgentFailureClass;
        message: string;
        taskErrorCode: string | null;
      } | null = null;
      if (pending !== undefined) {
        const reconciliation = await this.modelGateway.reconcile({
          requestId: pending.requestId,
          ownerId: state.ownerId,
          taskId: state.taskId,
          nodeKey: specification.nodeKey,
          memberKey: member.memberKey
        });
        if (reconciliation.status === 'unknown') {
          updateAttempt(state, pending.requestId, 'unknown', 'outcome_unknown', '供应商结果仍未知');
          state = await this.stop(state, 'interrupted', 'outcome_unknown', '模型结果仍未知，已保留检查点等待调和。');
          throw new OpeningAgentStoppedError(state.errorMessage!, state);
        }
        if (reconciliation.status === 'failed') {
          failure = {
            failureClass: reconciliation.failureClass,
            message: reconciliation.message,
            taskErrorCode: null
          };
          updateAttempt(state, pending.requestId, 'failed', failure.failureClass, failure.message);
          await this.toolGateway.saveTask(state);
        } else {
          result = reconciliation.result;
        }
      } else {
        const contract = openingAttemptContract(
          state,
          specification,
          validationRepair,
          authorInstructionVersion,
          member.memberKey
        );
        const requestId = nextRequestId(state, specification.nodeKey, member.memberKey);
        const attempt: OpeningModelAttempt = {
          requestId,
          nodeKey: specification.nodeKey,
          phase: state.phase,
          memberKey: member.memberKey,
          status: 'working',
          failureClass: null,
          failureMessage: null,
          taskKind: specification.taskKind,
          workstationKey: specification.workstationKey,
          operationMode: contract.operationMode,
          basedOnTaskId: contract.basedOnTaskId,
          authorInstructionVersion: contract.authorInstructionVersion
        };
        state = { ...state, attempts: [...state.attempts, attempt] };
        await this.toolGateway.saveTask(state);
        try {
          result = await this.modelGateway.generate({
            requestId,
            taskId: state.taskId,
            ownerId: state.ownerId,
            nodeKey: specification.nodeKey,
            taskKind: specification.taskKind,
            workstationKey: specification.workstationKey,
            operationMode: contract.operationMode,
            basedOnTaskId: contract.basedOnTaskId,
            authorInstructionVersion: contract.authorInstructionVersion,
            sourceTraces,
            member,
            prompt: promptFactory(validationRepair, member, contract),
            maxOutputTokens: specification.maxOutputTokens
          });
        } catch (error) {
          const normalized = normalizeModelError(error);
          if (normalized.outcomeUnknown) {
            updateAttempt(state, requestId, 'unknown', 'outcome_unknown', normalized.message);
            await this.toolGateway.saveTask(state);
            continue;
          }
          failure = {
            failureClass: normalized.failureClass,
            message: normalized.message,
            taskErrorCode: normalized.taskErrorCode
          };
          updateAttempt(state, requestId, 'failed', failure.failureClass, failure.message);
          await this.toolGateway.saveTask(state);
        }
      }

      if (result !== null) {
        const activeAttempt = findAttempt(state, result.requestId);
        try {
          assertModelIdentity(member, result);
          const content = specification.parse(result.output);
          updateAttempt(state, result.requestId, 'succeeded', null, null);
          await this.toolGateway.saveTask(state);
          return { generation: { content, member, result }, state };
        } catch (error) {
          const normalized = error instanceof OpeningAgentModelError
            ? error
            : new OpeningAgentModelError(error instanceof Error ? error.message : '结构化输出无效', 'invalid_output');
          const message = normalized.message;
          updateAttempt(state, activeAttempt.requestId, 'failed', normalized.failureClass, message);
          await this.toolGateway.saveTask(state);
          failure = {
            failureClass: normalized.failureClass,
            message,
            taskErrorCode: normalized.taskErrorCode
          };
        }
      }

      if (failure === null) throw new Error('模型执行没有结果也没有失败原因');
      const repairs = state.structureRepairs[state.phase] ?? 0;
      const decision = decideV7AgentFailure({
        failureClass: failure.failureClass,
        sameMemberStructureRepairs: repairs,
        automaticMemberSwitches: state.automaticMemberSwitches
      });
      if (decision.action === 'reconcile') continue;
      if (decision.action === 'repair_same_member') {
        state = {
          ...state,
          structureRepairs: { ...state.structureRepairs, [state.phase]: repairs + 1 }
        };
        validationRepair = failure.message;
        await this.toolGateway.saveTask(state);
        continue;
      }
      if (decision.action === 'switch_member') {
        attempted.add(member.memberKey);
        state = {
          ...state,
          automaticMemberSwitches: state.automaticMemberSwitches + 1,
          attemptedMemberKeys: { ...state.attemptedMemberKeys, [state.phase]: [...attempted] }
        };
        validationRepair = null;
        await this.toolGateway.saveTask(state);
        member = nextFallbackMember(fallbackChain, attempted);
        continue;
      }
      state = await this.stop(
        state,
        'failed',
        failure.taskErrorCode ?? failure.failureClass,
        failure.taskErrorCode === null ? decision.reason : failure.message
      );
      throw new OpeningAgentStoppedError(state.errorMessage!, state);
    }
    state = await this.stop(state, 'failed', 'provider_unavailable', '没有可用的备用成员，已保留所有成功检查点。');
    throw new OpeningAgentStoppedError(state.errorMessage!, state);
  }

  private pendingMember(
    state: OpeningAgentTaskState,
    nodeKey: V7OpeningNodeKey,
    memberRoster: readonly V7OpeningMemberDefinition[] | undefined
  ): V7OpeningMemberDefinition | null {
    const pending = [...state.attempts].reverse().find((attempt) => (
      attempt.nodeKey === nodeKey && attempt.phase === state.phase
      && (attempt.status === 'working' || attempt.status === 'unknown')
    ));
    if (pending === undefined) return null;
    return (memberRoster ?? DEFAULT_OPENING_ROSTER)
      .find((candidate) => candidate.memberKey === pending.memberKey) ?? null;
  }

  private packageSpecification(
    authorIdea: string,
    publishingPlatform: OpeningPublishingPlatform
  ): OpeningNodeSpecification<OpeningPackage> {
    return {
      ...PACKAGE_SPEC,
      parse: (output) => {
        const openingPackage = parseOpeningPackage(
          output,
          this.taxonomy ?? undefined,
          publishingPlatform
        );
        return openingPackage;
      }
    };
  }

  private async commit<T extends OpeningCandidateContent>(
    incomingState: OpeningAgentTaskState,
    generated: { generation: OpeningStructuredGeneration<T>; state: OpeningAgentTaskState },
    kind: 'opening_package' | 'opening_review',
    nextPhase: OpeningAgentTaskState['phase'],
    sourceCandidateIds: string[],
    nextStatus: OpeningAgentTaskState['status'] = 'working'
  ): Promise<OpeningAgentTaskState> {
    const candidateId = `candidate-${generated.generation.result.requestId}`;
    const nextState: OpeningAgentTaskState = {
      ...generated.state,
      status: nextStatus,
      phase: nextPhase,
      workOrderCandidateId: generated.state.workOrderCandidateId,
      activePackageCandidateId: kind === 'opening_package' ? candidateId : generated.state.activePackageCandidateId,
      activeReviewCandidateId: kind === 'opening_review' ? candidateId : generated.state.activeReviewCandidateId,
      errorCode: null,
      errorMessage: null
    };
    const saved = await this.toolGateway.commitCandidate(incomingState.ownerId, incomingState.taskId, {
      candidateId,
      kind,
      content: generated.generation.content,
      createdByMemberKey: generated.generation.member.memberKey,
      modelRequestId: generated.generation.result.requestId,
      sourceCandidateIds,
      nextState
    });
    if (saved.candidateId !== candidateId) throw new Error('候选提交返回了不一致的标识');
    return nextState;
  }

  private async requireCandidate<T extends OpeningCandidateContent>(
    state: OpeningAgentTaskState,
    candidateId: string | null,
    label: string
  ): Promise<OpeningSavedCandidate<T>> {
    if (candidateId === null) {
      const stopped = await this.stop(state, 'failed', 'version_changed', `${label}检查点缺失，禁止继续生成。`);
      throw new OpeningAgentStoppedError(stopped.errorMessage!, stopped);
    }
    return this.toolGateway.readCandidate<T>(state.ownerId, state.taskId, candidateId);
  }

  private async stop(
    state: OpeningAgentTaskState,
    status: 'failed' | 'interrupted',
    errorCode: string,
    errorMessage: string
  ): Promise<OpeningAgentTaskState> {
    const stopped = { ...state, status, errorCode, errorMessage };
    await this.toolGateway.saveTask(stopped);
    return stopped;
  }
}

type GeneratedWithState<T extends OpeningCandidateContent> = {
  generation: OpeningStructuredGeneration<T>;
  state: OpeningAgentTaskState;
};

const PACKAGE_SPEC: OpeningNodeSpecification<OpeningPackage> = {
  roleKey: 'screenwriter', nodeKey: 'opening_package_design', kind: 'opening_package',
  taskKind: 'opening_design', workstationKey: 'opening',
  parse: parseOpeningPackage, maxOutputTokens: 6_000
};
const REVIEW_SPEC: OpeningNodeSpecification<OpeningReview> = {
  roleKey: 'chief_editor', nodeKey: 'opening_package_review', kind: 'opening_review',
  taskKind: 'opening_review', workstationKey: 'opening',
  parse: parseOpeningReview, maxOutputTokens: 3_000
};

function openingAttemptContract<T extends OpeningCandidateContent>(
  state: OpeningAgentTaskState,
  specification: OpeningNodeSpecification<T>,
  validationRepair: string | null,
  authorInstructionVersion: number | null,
  memberKey: string
): OpeningAttemptPromptContext {
  if (validationRepair !== null) {
    const source = [...state.attempts].reverse().find((attempt) => (
      attempt.nodeKey === specification.nodeKey
      && attempt.phase === state.phase
      && attempt.memberKey === memberKey
      && attempt.status === 'failed'
      && attempt.failureClass === 'invalid_output'
    ));
    if (source === undefined) {
      throw new OpeningAgentModelError('结构修复缺少上一份真实模型结果', 'version_changed');
    }
    return {
      operationMode: 'repair',
      basedOnTaskId: source.requestId,
      authorInstructionVersion
    };
  }
  const revising = state.phase === 'package_revision' || state.phase === 'package_re_review';
  if (!revising) {
    return { operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null };
  }
  const source = [...state.attempts].reverse().find((attempt) => (
    attempt.nodeKey === specification.nodeKey && attempt.status === 'succeeded'
  ));
  if (source === undefined) {
    throw new OpeningAgentModelError('开书修改缺少上一份真实模型结果', 'version_changed');
  }
  return {
    operationMode: 'revise',
    basedOnTaskId: source.requestId,
    authorInstructionVersion
  };
}

function openingSourceTraces(
  state: OpeningAgentTaskState,
  idea: OpeningIdeaSnapshot,
  references: OpeningReferencePack,
  candidates: readonly OpeningSavedCandidate[],
  taxonomy: OpeningTaxonomyReference | null
): V7ContextSourceTrace[] {
  const bookId = `v7-prebook:${state.taskId}`;
  const traces: V7ContextSourceTrace[] = [{
    ownerId: state.ownerId,
    bookId,
    sourceKey: 'author-opening-idea',
    sourceType: 'author_opening_idea',
    sourceId: state.taskId,
    sourceVersion: String(idea.version),
    authority: 'author_source',
    decision: 'included',
    reason: '作者本轮提交的开书原话，是当前任务最高优先级来源。',
    contentHash: idea.hash,
    estimatedTokens: estimateOpeningSourceTokens(idea.text)
  }];
  for (const candidate of candidates) {
    const content = stableStringify(candidate.content);
    traces.push({
      ownerId: state.ownerId,
      bookId,
      sourceKey: `opening-candidate:${candidate.kind}`,
      sourceType: candidate.kind,
      sourceId: candidate.candidateId,
      sourceVersion: String(candidate.version),
      authority: candidate.createdByMemberKey === 'author' ? 'author_source' : 'candidate',
      decision: 'included',
      reason: candidate.createdByMemberKey === 'author'
        ? '作者已直接修改的当前开书候选，本轮必须优先保留。'
        : '当前开书工作流已选定的上游候选，仅供本节点继续处理。',
      contentHash: sha256(content),
      estimatedTokens: estimateOpeningSourceTokens(content)
    });
  }
  if (taxonomy !== null) {
    const content = stableStringify({
      version: taxonomy.version,
      categories: taxonomy.categories,
      subjects: taxonomy.subjects,
      tagSuggestions: taxonomy.tagSuggestions
    });
    traces.push({
      ownerId: state.ownerId,
      bookId,
      sourceKey: 'opening-taxonomy',
      sourceType: 'opening_taxonomy',
      sourceId: 'v7-opening-taxonomy',
      sourceVersion: taxonomy.version,
      authority: 'reference',
      decision: 'included',
      reason: '用于约束频道、分类、融合题材和标签的合法目录，不替代创作判断。',
      contentHash: sha256(content),
      estimatedTokens: estimateOpeningSourceTokens(content)
    });
  }
  for (const reference of references.references) {
    const content = stableStringify(reference);
    traces.push({
      ownerId: state.ownerId,
      bookId,
      sourceKey: `${reference.source}:${reference.sourceKey}`,
      sourceType: reference.source,
      sourceId: reference.sourceKey,
      sourceVersion: reference.libraryVersion,
      authority: 'reference',
      decision: 'included',
      reason: `开书参考只承担“${reference.responsibility}”，不得覆盖作者原话。`,
      contentHash: sha256(content),
      estimatedTokens: estimateOpeningSourceTokens(content)
    });
  }
  return traces;
}

function estimateOpeningSourceTokens(value: string): number {
  return Math.max(1, Math.ceil(Array.from(value).length / 2));
}

function initialState(input: RunOpeningAgentInput, ideaVersion: number, ideaHash: string): OpeningAgentTaskState {
  return {
    taskId: input.taskId,
    ownerId: input.ownerId,
    ideaVersion,
    ideaHash,
    status: 'working',
    phase: 'package_design',
    selectedChiefMemberKey: input.selectedChiefMemberKey ?? null,
    selectedScreenwriterMemberKey: input.selectedScreenwriterMemberKey ?? null,
    workOrderCandidateId: null,
    activePackageCandidateId: null,
    activeReviewCandidateId: null,
    editorialRevisionCount: 0,
    automaticMemberSwitches: 0,
    structureRepairs: {},
    attemptedMemberKeys: {},
    attempts: [],
    requestSequence: 0,
    errorCode: null,
    errorMessage: null
  };
}

function assertTaskSource(state: OpeningAgentTaskState, ownerId: string, ideaVersion: number, ideaHash: string): void {
  if (state.ownerId !== ownerId) throw new Error('开书任务不属于当前账号');
  if (state.ideaVersion !== ideaVersion || state.ideaHash !== ideaHash) {
    throw new Error('作者开书想法版本已经变化，旧任务必须失效后重新编译');
  }
}

function nextRequestId(state: OpeningAgentTaskState, nodeKey: V7OpeningNodeKey, memberKey: string): string {
  state.requestSequence += 1;
  return `${state.taskId}-${nodeKey}-${memberKey}-${state.requestSequence}`;
}

function findAttempt(state: OpeningAgentTaskState, requestId: string): OpeningModelAttempt {
  const attempt = state.attempts.find((candidate) => candidate.requestId === requestId);
  if (attempt === undefined) throw new Error(`找不到模型调用检查点：${requestId}`);
  return attempt;
}

function findPendingAttempt(
  state: OpeningAgentTaskState,
  nodeKey: V7OpeningNodeKey,
  memberKey: string
): OpeningModelAttempt | undefined {
  return [...state.attempts].reverse().find((attempt) => (
    attempt.nodeKey === nodeKey && attempt.phase === state.phase && attempt.memberKey === memberKey
    && (attempt.status === 'working' || attempt.status === 'unknown')
  ));
}

function updateAttempt(
  state: OpeningAgentTaskState,
  requestId: string,
  status: OpeningModelAttempt['status'],
  failureClass: V7AgentFailureClass | null,
  failureMessage: string | null
): void {
  const attempt = findAttempt(state, requestId);
  attempt.status = status;
  attempt.failureClass = failureClass;
  attempt.failureMessage = failureMessage;
}

function normalizeModelError(error: unknown): OpeningAgentModelError {
  if (error instanceof OpeningAgentModelError) return error;
  return new OpeningAgentModelError(error instanceof Error ? error.message : String(error), 'provider_unavailable');
}

function assertModelIdentity(member: V7OpeningMemberDefinition, result: OpeningModelResult): void {
  if (result.provider !== member.model.provider || result.modelId !== member.model.modelId) {
    throw new OpeningAgentModelError('模型返回来源与冻结成员绑定不一致', 'provider_unavailable');
  }
}

function candidateId(candidate: OpeningSavedCandidate | null): string[] {
  return candidate === null ? [] : [candidate.candidateId];
}

function savedCandidate(candidate: OpeningSavedCandidate | null): OpeningSavedCandidate[] {
  return candidate === null ? [] : [candidate];
}

function modelSignature(member: V7OpeningMemberDefinition): string {
  return `${member.model.provider}:${member.model.modelId}:${member.model.plan}`;
}

function modelSignatureForCandidate(
  candidate: OpeningSavedCandidate,
  roster: readonly V7OpeningMemberDefinition[]
): string {
  const member = roster.find((item) => item.memberKey === candidate.createdByMemberKey);
  return member === undefined ? '' : modelSignature(member);
}

function constrainOpeningRevision(
  authorDraft: OpeningPackage,
  generated: OpeningPackage,
  allowedFields: string[]
): OpeningPackage {
  const baseline = JSON.parse(JSON.stringify(authorDraft)) as OpeningPackage;
  delete baseline.revisionDirective;
  for (const field of allowedFields) {
    const nextValue = readOpeningField(generated, field);
    if (nextValue !== undefined) writeOpeningField(baseline, field, nextValue);
  }
  return baseline;
}

function readOpeningField(value: OpeningPackage, field: string): unknown {
  return field.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function writeOpeningField(value: OpeningPackage, field: string, nextValue: unknown): void {
  const segments = field.split('.');
  let current: unknown = value;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (typeof current !== 'object' || current === null) return;
    current = (current as Record<string, unknown>)[segments[index]!];
  }
  if (typeof current !== 'object' || current === null) return;
  (current as Record<string, unknown>)[segments.at(-1)!] = JSON.parse(JSON.stringify(nextValue)) as unknown;
}
