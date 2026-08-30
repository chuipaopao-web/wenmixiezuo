import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  V7_PLANNING_MEMBERS,
  buildPlanningFallbackChain,
  parsePlanningRecipeComparison,
  parsePlanningRecipeProposal,
  planningComparisonPrompt,
  planningRecipePrompt,
  validatePlanningEditorialRoster,
  type LayeredPlanningRecipe,
  type V7PlanningMemberDefinition,
  type V7PlanningRecipeComparison,
  type V7PlanningRecipeProposal
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7PlanningRuntimeRepository,
  type V7PlanningRecipeProposalRow,
  type V7PlanningRecipeRunRow
} from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';
import {
  V7PlanningModelError,
  V7PlanningModelGateway,
  type V7PlanningModelAdapterResolver
} from '../../infrastructure/models/v7-planning-model-gateway.js';
import {
  V7PlanningSourceCompiler,
  planningSnapshotSourceTraces
} from './v7-planning-source-compiler.js';

type RecipeSeatKey = 'chief_editor' | 'structure_deputy' | 'commercial_deputy';
type RecipeChoice = 'chief' | 'structure' | 'commercial' | 'comparison';
type PlanningMemberSource = readonly V7PlanningMemberDefinition[] | (() => readonly V7PlanningMemberDefinition[]);

export interface V7PlanningRecipeRunView {
  runId: string;
  status: 'waiting' | 'working' | 'waiting_for_you' | 'completed' | 'failed';
  message: string;
  completedSeats: number;
  totalSeats: 3;
  proposals: Array<{
    proposalId: string;
    seat: '全案主编一席' | '全案主编二席' | '全案主编三席';
    memberName: string;
    summary: string;
    strengths: string[];
    risks: string[];
    authorDecisions: string[];
  }>;
  comparison: null | {
    proposalId: string;
    memberName: string;
    summary: string;
    recommendedProposalId: string;
    differences: V7PlanningRecipeComparison['differences'];
    risks: string[];
    authorDecisions: string[];
  };
  canConfirm: boolean;
  errorMessage: string | null;
}

export class V7PlanningEditorialService {
  private readonly repository: V7PlanningRuntimeRepository;
  private readonly sources: V7PlanningSourceCompiler;
  private readonly models: V7PlanningModelGateway;
  private readonly activeRuns = new Set<string>();

  public constructor(
    database: DatabaseSync,
    adapters: V7PlanningModelAdapterResolver,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly memberSource: PlanningMemberSource = V7_PLANNING_MEMBERS
  ) {
    this.repository = new V7PlanningRuntimeRepository(database);
    this.sources = new V7PlanningSourceCompiler(database, ids, clock);
    this.models = new V7PlanningModelGateway(database, adapters, clock);
    assertRoster(this.members());
  }

  public createRecipeRun(ownerId: string, bookId: string, input: {
    authorGoal?: unknown;
    idempotencyKey?: unknown;
  }): V7PlanningRecipeRunView {
    const idempotencyKey = actionKey(input.idempotencyKey);
    const authorGoal = optionalText(input.authorGoal, '本次规划想法', 2_000);
    const snapshot = this.sources.compile({
      ownerId, bookId, treeKind: 'book', scopeId: bookId, purpose: 'recipe_design', authorGoal
    });
    const requestHash = sha256(stableJson({ snapshotId: snapshot.snapshotId, authorGoal }));
    const existing = this.repository.recipeRunByKey(ownerId, bookId, idempotencyKey);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw conflict('本次操作编号已经用于另一份规划，请重新操作。');
      this.start(existing);
      return this.view(existing);
    }
    const roster = (['chief_editor', 'structure_deputy', 'commercial_deputy'] as const).map((seatKey) => ({
      seatKey,
      fallback: buildPlanningFallbackChain(seatKey, { members: this.members() }).map(memberSnapshot)
    }));
    const now = this.clock.now().toISOString();
    const run = this.repository.createRecipeRun({
      runId: this.ids.next(), ownerId, bookId, snapshotId: snapshot.snapshotId,
      idempotencyKey, requestHash, roster, now
    });
    this.start(run);
    return this.view(run);
  }

  public getRecipeRun(ownerId: string, bookId: string, runId: string): V7PlanningRecipeRunView {
    const run = this.requireRun(ownerId, bookId, runId);
    this.start(run);
    return this.view(this.requireRun(ownerId, bookId, runId));
  }

  public confirmRecipe(ownerId: string, bookId: string, runId: string, input: {
    choice?: unknown;
    authorNote?: unknown;
    idempotencyKey?: unknown;
  }): { recipeVersionId: string; revision: number; status: 'confirmed'; nextStep: 'book_tree' } {
    const choice = recipeChoice(input.choice);
    const authorNote = optionalText(input.authorNote, '作者补充意见', 2_000);
    const idempotencyKey = actionKey(input.idempotencyKey);
    const prior = this.repository.recipeDecisionByKey(ownerId, bookId, idempotencyKey);
    if (prior !== undefined) {
      if (prior.run_id !== runId || prior.decision_kind !== `accept_${choice}` || prior.author_note !== authorNote) {
        throw conflict('本次操作编号已经用于另一项确认，请重新操作。');
      }
      const confirmed = this.repository.recipeVersion(ownerId, bookId, prior.recipe_version_id);
      if (confirmed === undefined || confirmed.lifecycle !== 'confirmed') {
        throw conflict('已确认的规划版本状态异常，请稍后重试。');
      }
      return { recipeVersionId: confirmed.recipe_version_id, revision: confirmed.revision, status: 'confirmed', nextStep: 'book_tree' };
    }
    const run = this.requireRun(ownerId, bookId, runId);
    if (run.status !== 'awaiting_author') throw conflict('三份规划方案还没有全部整理完成。');
    const proposals = this.repository.recipeProposals(ownerId, bookId, runId);
    const selected = proposalForChoice(proposals, choice);
    const payload = JSON.parse(selected.proposal_json) as V7PlanningRecipeProposal | V7PlanningRecipeComparison;
    const recipe = choice === 'comparison'
      ? (payload as V7PlanningRecipeComparison).recommendedRecipe
      : (payload as V7PlanningRecipeProposal).recipe;
    const sourceProposalIds = choice === 'comparison'
      ? JSON.parse(selected.source_proposal_ids_json) as string[]
      : [selected.proposal_id];
    let candidate = this.repository.activeRecipe(ownerId, bookId, 'candidate');
    const recipeHash = sha256(stableJson(recipe));
    if (candidate === undefined || candidate.recipe_hash !== recipeHash) {
      candidate = this.repository.saveCandidateRecipe({
        recipeVersionId: this.ids.next(), ownerId, bookId, recipe, recipeHash,
        sourceSnapshotId: run.snapshot_id, sourceProposalIds,
        createdBy: choice === 'comparison' ? 'chief_comparison' : selected.member_key,
        now: this.clock.now().toISOString()
      });
    }
    const confirmed = this.repository.confirmRecipe({
      ownerId, bookId, recipeVersionId: candidate.recipe_version_id, runId,
      decisionId: this.ids.next(), idempotencyKey,
      decisionKind: `accept_${choice}`, authorNote, now: this.clock.now().toISOString()
    });
    return { recipeVersionId: confirmed.recipe_version_id, revision: confirmed.revision, status: 'confirmed', nextStep: 'book_tree' };
  }

  public adminRun(ownerId: string, bookId: string, runId: string): unknown {
    const run = this.requireRun(ownerId, bookId, runId);
    const snapshot = this.sources.require(ownerId, bookId, run.snapshot_id);
    const proposals = this.repository.recipeProposals(ownerId, bookId, runId);
    const calls = this.repository.modelCallsForRun(ownerId, bookId, runId);
    return {
      run: { ...run, roster: JSON.parse(run.roster_json), checkpoint: JSON.parse(run.checkpoint_json) },
      snapshot,
      proposals: proposals.map((proposal) => ({
        ...proposal,
        memberSnapshot: JSON.parse(proposal.member_snapshot_json),
        proposal: JSON.parse(proposal.proposal_json),
        sourceProposalIds: JSON.parse(proposal.source_proposal_ids_json)
      })),
      calls
    };
  }

  private start(run: V7PlanningRecipeRunRow): void {
    if (!['queued', 'working'].includes(run.status)) return;
    if (this.activeRuns.has(run.run_id)) return;
    this.activeRuns.add(run.run_id);
    void this.execute(run).catch((error) => {
      const current = this.repository.recipeRun(run.owner_id, run.book_id, run.run_id);
      if (current === undefined || ['awaiting_author', 'completed'].includes(current.status)) return;
      this.repository.markRecipeRun({
        ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id, status: 'failed', phase: 'failed',
        errorMessage: publicFailure(error), checkpoint: JSON.parse(current.checkpoint_json), now: this.clock.now().toISOString()
      });
    }).finally(() => {
      this.activeRuns.delete(run.run_id);
    });
  }

  private async execute(run: V7PlanningRecipeRunRow): Promise<void> {
    const current = this.requireRun(run.owner_id, run.book_id, run.run_id);
    if (current.status === 'awaiting_author' || current.status === 'completed') return;
    const snapshot = this.sources.require(run.owner_id, run.book_id, run.snapshot_id);
    this.repository.markRecipeRun({
      ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id, status: 'working',
      phase: 'independent_proposals', checkpoint: { completedSeats: completedSeatKeys(this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id)) },
      now: this.clock.now().toISOString()
    });
    const existing = this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id);
    const outcomes = await Promise.allSettled((['chief_editor', 'structure_deputy', 'commercial_deputy'] as const).map(async (seatKey) => {
      if (existing.some((proposal) => proposal.seat_key === seatKey)) return;
      await this.runIndependentSeat(run, snapshot, seatKey);
    }));
    const proposals = this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id);
    const independent = proposals.filter((proposal) => proposal.seat_key !== 'chief_comparison');
    if (independent.length < 3) {
      const failures = outcomes.filter((outcome) => outcome.status === 'rejected') as PromiseRejectedResult[];
      this.repository.markRecipeRun({
        ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
        status: independent.length === 0 ? 'failed' : 'partially_failed', phase: 'independent_proposals',
        checkpoint: { completedSeats: completedSeatKeys(proposals) },
        errorMessage: failures.length === 0 ? '抱歉，还有成员没有完成方案，系统会保留已完成内容。' : publicFailure(failures[0]?.reason),
        now: this.clock.now().toISOString()
      });
      return;
    }
    const comparison = proposals.find((proposal) => proposal.seat_key === 'chief_comparison')
      ?? await this.runComparison(run, snapshot, independent);
    let candidate = this.repository.activeRecipe(run.owner_id, run.book_id, 'candidate');
    if (candidate === undefined) {
      const content = JSON.parse(comparison.proposal_json) as V7PlanningRecipeComparison;
      candidate = this.repository.saveCandidateRecipe({
        recipeVersionId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id,
        recipe: content.recommendedRecipe, recipeHash: sha256(stableJson(content.recommendedRecipe)),
        sourceSnapshotId: run.snapshot_id, sourceProposalIds: independent.map((proposal) => proposal.proposal_id),
        createdBy: comparison.member_key, now: this.clock.now().toISOString()
      });
    }
    this.repository.markRecipeRun({
      ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id, status: 'awaiting_author',
      phase: 'author_confirmation', checkpoint: {
        completedSeats: completedSeatKeys(this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id)),
        comparisonProposalId: comparison.proposal_id,
        candidateRecipeVersionId: candidate.recipe_version_id
      },
      now: this.clock.now().toISOString()
    });
  }

  private async runIndependentSeat(
    run: V7PlanningRecipeRunRow,
    snapshot: ReturnType<V7PlanningSourceCompiler['require']>,
    seatKey: RecipeSeatKey
  ): Promise<V7PlanningRecipeProposalRow> {
    const failures: string[] = [];
    for (const member of buildPlanningFallbackChain(seatKey, { members: this.members() })) {
      const requestId = `planning-recipe:${run.run_id}:${seatKey}:${member.memberKey}`;
      try {
        const result = await this.models.generate({
          requestId, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          runKind: 'recipe', nodeKey: seatKey, member,
          taskKind: 'planning_recipe', workstationKey: 'full_book_route',
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(snapshot),
          prompt: planningRecipePrompt({ seatKey, sourceSnapshot: snapshot, recipeId: `${run.run_id}:${seatKey}` }),
          maxOutputTokens: 12_000, temperature: 0.62
        });
        const proposal = parsePlanningRecipeProposal(result.output, seatKey);
        return this.repository.saveRecipeProposal({
          proposalId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          seatKey, memberKey: member.memberKey, memberSnapshot: memberSnapshot(member),
          sourceSnapshotId: run.snapshot_id, proposal, proposalHash: sha256(stableJson(proposal)),
          sourceProposalIds: [], requestId, now: this.clock.now().toISOString()
        });
      } catch (error) {
        failures.push(`${member.displayName}：${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) break;
      }
    }
    throw new Error(`对不起，${seatName(seatKey)}这次没有完成。${failures.join('；')}`);
  }

  private async runComparison(
    run: V7PlanningRecipeRunRow,
    snapshot: ReturnType<V7PlanningSourceCompiler['require']>,
    independent: V7PlanningRecipeProposalRow[]
  ): Promise<V7PlanningRecipeProposalRow> {
    const comparisonInput = independent.map((proposal) => ({
      proposalId: proposal.proposal_id,
      publicName: seatName(proposal.seat_key as RecipeSeatKey),
      proposal: JSON.parse(proposal.proposal_json) as V7PlanningRecipeProposal
    }));
    const failures: string[] = [];
    for (const member of buildPlanningFallbackChain('chief_editor', { members: this.members() })) {
      const requestId = `planning-recipe:${run.run_id}:comparison:${member.memberKey}`;
      try {
        const result = await this.models.generate({
          requestId, ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          runKind: 'recipe', nodeKey: 'chief_comparison', member,
          taskKind: 'planning_review', workstationKey: 'full_book_route',
          operationMode: 'fresh', basedOnTaskId: null, authorInstructionVersion: null,
          sourceTraces: planningSnapshotSourceTraces(snapshot),
          prompt: planningComparisonPrompt({ sourceSnapshot: snapshot, proposals: comparisonInput }),
          maxOutputTokens: 12_000, temperature: 0.48
        });
        const comparison = parsePlanningRecipeComparison(result.output, independent.map((proposal) => proposal.proposal_id));
        return this.repository.saveRecipeProposal({
          proposalId: this.ids.next(), ownerId: run.owner_id, bookId: run.book_id, runId: run.run_id,
          seatKey: 'chief_comparison', memberKey: member.memberKey, memberSnapshot: memberSnapshot(member),
          sourceSnapshotId: run.snapshot_id, proposal: comparison, proposalHash: sha256(stableJson(comparison)),
          sourceProposalIds: independent.map((proposal) => proposal.proposal_id), requestId,
          now: this.clock.now().toISOString()
        });
      } catch (error) {
        failures.push(`${member.displayName}：${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof V7PlanningModelError && error.outcomeUnknown) break;
      }
    }
    throw new Error(`对不起，主编这次没有完成三案整理。${failures.join('；')}`);
  }

  private members(): readonly V7PlanningMemberDefinition[] {
    const members = typeof this.memberSource === 'function' ? this.memberSource() : this.memberSource;
    assertRoster(members);
    return members;
  }

  private view(run: V7PlanningRecipeRunRow): V7PlanningRecipeRunView {
    const proposals = this.repository.recipeProposals(run.owner_id, run.book_id, run.run_id);
    const independent = proposals.filter((proposal) => proposal.seat_key !== 'chief_comparison');
    const comparisonRow = proposals.find((proposal) => proposal.seat_key === 'chief_comparison');
    const comparison = comparisonRow === undefined ? null : JSON.parse(comparisonRow.proposal_json) as V7PlanningRecipeComparison;
    return {
      runId: run.run_id,
      status: publicStatus(run.status),
      message: publicMessage(run, independent.length),
      completedSeats: independent.length,
      totalSeats: 3,
      proposals: independent.map((proposal) => {
        const content = JSON.parse(proposal.proposal_json) as V7PlanningRecipeProposal;
        return {
          proposalId: proposal.proposal_id,
          seat: seatName(proposal.seat_key as RecipeSeatKey),
          memberName: memberName(proposal.member_snapshot_json),
          summary: content.publicSummary,
          strengths: content.strengths,
          risks: content.risks,
          authorDecisions: content.authorDecisions
        };
      }),
      comparison: comparisonRow === undefined || comparison === null ? null : {
        proposalId: comparisonRow.proposal_id,
        memberName: memberName(comparisonRow.member_snapshot_json),
        summary: comparison.publicSummary,
        recommendedProposalId: comparison.recommendedProposalId,
        differences: comparison.differences,
        risks: comparison.risks,
        authorDecisions: comparison.authorDecisions
      },
      canConfirm: run.status === 'awaiting_author' && comparison !== null,
      errorMessage: run.error_message
    };
  }

  private requireRun(ownerId: string, bookId: string, runId: string): V7PlanningRecipeRunRow {
    const run = this.repository.recipeRun(ownerId, bookId, runId);
    if (run === undefined) throw new DomainError(errorCodes.validation, '规划任务不存在或不属于本书。', {}, false, 404);
    return run;
  }
}

function completedSeatKeys(proposals: V7PlanningRecipeProposalRow[]): string[] {
  return proposals.filter((proposal) => proposal.seat_key !== 'chief_comparison').map((proposal) => proposal.seat_key);
}

function proposalForChoice(proposals: V7PlanningRecipeProposalRow[], choice: RecipeChoice): V7PlanningRecipeProposalRow {
  const seat = ({ chief: 'chief_editor', structure: 'structure_deputy', commercial: 'commercial_deputy', comparison: 'chief_comparison' } as const)[choice];
  const proposal = proposals.find((candidate) => candidate.seat_key === seat);
  if (proposal === undefined) throw conflict('所选规划方案还没有完成。');
  return proposal;
}

function recipeChoice(value: unknown): RecipeChoice {
  if (value === 'chief' || value === 'structure' || value === 'commercial' || value === 'comparison') return value;
  throw new DomainError(errorCodes.validation, '请选择一份规划方案。');
}

function memberSnapshot(member: V7PlanningMemberDefinition): unknown {
  return {
    memberKey: member.memberKey, displayName: member.displayName, roleKey: member.roleKey,
    provider: member.model.provider, modelId: member.model.modelId, plan: member.model.plan,
    fallbackPriority: member.fallbackPriority
  };
}

function memberName(snapshotJson: string): string {
  const value = JSON.parse(snapshotJson) as { displayName?: unknown };
  return typeof value.displayName === 'string' && value.displayName.length > 0 ? value.displayName : '编辑部成员';
}

function seatName(seat: RecipeSeatKey): '全案主编一席' | '全案主编二席' | '全案主编三席' {
  return ({ chief_editor: '全案主编一席', structure_deputy: '全案主编二席', commercial_deputy: '全案主编三席' } as const)[seat];
}

function publicStatus(status: V7PlanningRecipeRunRow['status']): V7PlanningRecipeRunView['status'] {
  if (status === 'queued') return 'waiting';
  if (status === 'working') return 'working';
  if (status === 'awaiting_author') return 'waiting_for_you';
  if (status === 'completed') return 'completed';
  return 'failed';
}

function publicMessage(run: V7PlanningRecipeRunRow, completedSeats: number): string {
  if (run.status === 'awaiting_author') return '三份全书规划已经整理好了，请您选一份方向。';
  if (run.status === 'completed') return '这份全书规划已经确认，可以继续设计全书树。';
  if (run.status === 'failed') return run.error_message ?? '对不起，这次规划没有完成，请稍后重试。';
  if (run.status === 'partially_failed') {
    return `对不起，本轮只完成了${completedSeats}份方案，已保留完成内容；请重新开始一轮规划。`;
  }
  if (run.current_phase === 'chief_comparison') return '三份方案已经完成，主编正在整理差异和建议。';
  return `编辑部正在独立设计三份全书方案，已经完成${completedSeats}份。`;
}

function actionKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/u.test(value.trim())) {
    throw new DomainError(errorCodes.validation, '操作编号无效，请重新操作。');
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || Array.from(value.trim()).length > max) throw new DomainError(errorCodes.validation, `${label}最多${max}字。`);
  return value.trim();
}

function conflict(message: string): DomainError {
  return new DomainError(errorCodes.validation, message, {}, false, 409);
}

function publicFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.startsWith('对不起') ? detail : `对不起，这次规划没有完成。${detail}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertRoster(members: readonly V7PlanningMemberDefinition[]): void {
  const errors = validatePlanningEditorialRoster(members);
  if (errors.length > 0) throw new Error(`V7规划成员名册无效：${errors.join('；')}`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
