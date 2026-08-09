import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { parseEditorReviewSynthesis, parseProductionReview, type EditorReviewSynthesis, type ProductionReview, type ReviewerRole } from '../../contracts/production-review.js';
import { ReviewModelCompatibilityService } from '../agents/model-binding-v2-service.js';
import type { TeamAgentRow } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import type { ProductionWorkflowRepository } from '../../infrastructure/db/repositories/production-workflow-repository.js';

export interface FrozenReviewer {
  role: ReviewerRole;
  agent: TeamAgentRow;
}

export class ProductionReviewService {
  public constructor(private readonly repository: ProductionWorkflowRepository, private readonly ids: IdGenerator, private readonly clock: Clock) {}

  public openPanel(scope: BookScope, input: {
    chapterId: string; manuscriptVersionId: string; manuscriptHash: string; reviewRound: number;
    writerAgentId: string; writerProvider: string; writerModelId: string; writerModelSnapshotId: string;
    writerEpoch: number; writingOrderId: string; canonRevision: number; bindingRevisionId?: string | null;
  }): { panelId: string; reviewers: FrozenReviewer[] } {
    const team = this.repository.currentTeam(scope, input.bindingRevisionId);
    const writerBase = team.find((agent) => agent.agentId === input.writerAgentId);
    if (writerBase === undefined) throw new Error('活动写手不在当前创作团队中');
    const writer: TeamAgentRow = { ...writerBase, provider: input.writerProvider, modelId: input.writerModelId, modelSnapshotId: input.writerModelSnapshotId };
    const selected = new ReviewModelCompatibilityService().select(writer, team);
    const panelId = this.ids.next();
    this.repository.createReviewPanel(scope, {
      id: panelId, chapterId: input.chapterId, manuscriptVersionId: input.manuscriptVersionId, manuscriptHash: input.manuscriptHash,
      reviewRound: input.reviewRound, writerModelSnapshotId: input.writerModelSnapshotId, writerEpoch: input.writerEpoch,
      bindingRevisionId: input.bindingRevisionId ?? null, writingOrderId: input.writingOrderId, canonRevision: input.canonRevision,
      tokenBudget: 30_000, fact: selected.fact, literary: selected.literary, experience: selected.experience,
      selectionReason: {
        policy: 'three-distinct-models-v1',
        factSubstitution: /glm/iu.test(input.writerModelId) ? 'writer_is_glm_use_deepseek' : 'default_glm',
        writer: `${input.writerProvider}/${input.writerModelId}`
      }, now: this.clock.now().toISOString()
    });
    return { panelId, reviewers: [
      { role: 'fact', agent: selected.fact },
      { role: 'literary', agent: selected.literary },
      { role: 'experience', agent: selected.experience }
    ] };
  }

  public resumeIncompletePanel(scope: BookScope, input: {
    manuscriptVersionId: string; manuscriptHash: string; writerModelSnapshotId: string;
    canonRevision: number; bindingRevisionId: string | null;
  }): { panelId: string; reviewRound: number; reviewers: FrozenReviewer[] } | null {
    const panel = this.repository.resumeIncompleteReviewPanel(scope, input);
    if (panel === null) return null;
    return {
      panelId: panel.reviewPanelId,
      reviewRound: panel.reviewRound,
      reviewers: [
        { role: 'fact', agent: panel.fact },
        { role: 'literary', agent: panel.literary },
        { role: 'experience', agent: panel.experience }
      ]
    };
  }

  public existingReport(scope: BookScope, input: {
    panelId: string; role: ReviewerRole; manuscriptVersionId: string; modelSnapshotId: string;
  }): ProductionReview | null {
    const report = this.repository.reviewReportJson(scope, input.panelId, input.role);
    return report === null ? null : parseProductionReview(report, {
      reviewerRole: input.role,
      manuscriptVersionId: input.manuscriptVersionId,
      modelSnapshotId: input.modelSnapshotId
    });
  }

  public persist(scope: BookScope, input: {
    panelId: string; role: ReviewerRole; manuscriptVersionId: string; modelSnapshotId: string; agentId: string;
    raw: string; inputTokens: number; allowDroppingInvalidFactCandidates?: boolean; normalizeLocalBlockers?: boolean;
    normalizeAiStyleEvidence?: boolean;
    normalizeRepairedVerdict?: boolean;
    normalizeMalformedJsonStrings?: boolean;
    normalizeRiskArrays?: boolean;
    normalizeScoreArray?: boolean;
    normalizeIssueLocations?: boolean;
    normalizeRepairedSeverity?: boolean;
    normalizeIssueFieldAliases?: boolean;
    normalizeFrozenBindings?: boolean;
    normalizeProvisionalDraftBlockers?: boolean;
    normalizeFactOmissionMajor?: boolean;
  }): ProductionReview {
    const report = parseProductionReview(input.raw, {
      reviewerRole: input.role, manuscriptVersionId: input.manuscriptVersionId, modelSnapshotId: input.modelSnapshotId
    }, {
      allowDroppingInvalidFactCandidates: input.allowDroppingInvalidFactCandidates === true,
      normalizeLocalBlockers: input.normalizeLocalBlockers === true,
      normalizeAiStyleEvidence: input.normalizeAiStyleEvidence === true,
      normalizeRepairedVerdict: input.normalizeRepairedVerdict === true,
      normalizeMalformedJsonStrings: input.normalizeMalformedJsonStrings === true,
      normalizeRiskArrays: input.normalizeRiskArrays === true,
      normalizeScoreArray: input.normalizeScoreArray === true,
      normalizeIssueLocations: input.normalizeIssueLocations === true,
      normalizeRepairedSeverity: input.normalizeRepairedSeverity === true,
      normalizeIssueFieldAliases: input.normalizeIssueFieldAliases === true,
      normalizeFrozenBindings: input.normalizeFrozenBindings === true,
      normalizeProvisionalDraftBlockers: input.normalizeProvisionalDraftBlockers === true,
      normalizeFactOmissionMajor: input.normalizeFactOmissionMajor === true
    });
    const reportJson = JSON.stringify(report);
    this.repository.insertReviewReport(scope, {
      id: this.ids.next(), panelId: input.panelId, manuscriptVersionId: input.manuscriptVersionId, role: input.role,
      agentId: input.agentId, modelSnapshotId: input.modelSnapshotId, report, reportHash: createHash('sha256').update(reportJson).digest('hex'),
      inputTokens: input.inputTokens, now: this.clock.now().toISOString()
    });
    return report;
  }

  public persistEditorSynthesis(scope: BookScope, input: {
    panelId: string; manuscriptVersionId: string; editorAgentId: string; modelSnapshotId: string;
    raw: string; issueCount: number; normalizeRepairedShape?: boolean; normalizeMalformedJsonStrings?: boolean;
  }): EditorReviewSynthesis {
    const synthesis = parseEditorReviewSynthesis(input.raw, {
      panelId: input.panelId, manuscriptVersionId: input.manuscriptVersionId, issueCount: input.issueCount
    }, {
      normalizeRepairedShape: input.normalizeRepairedShape === true,
      normalizeMalformedJsonStrings: input.normalizeMalformedJsonStrings === true
    });
    const json = JSON.stringify(synthesis);
    this.repository.insertEditorSynthesis(scope, {
      id: this.ids.next(), panelId: input.panelId, manuscriptVersionId: input.manuscriptVersionId,
      editorAgentId: input.editorAgentId, modelSnapshotId: input.modelSnapshotId,
      synthesis, synthesisHash: createHash('sha256').update(json).digest('hex'), now: this.clock.now().toISOString()
    });
    return synthesis;
  }

  public merge(scope: BookScope, input: {
    panelId: string; manuscriptVersionId: string; revisionRound: number;
    reports: ProductionReview[]; editorSynthesis: EditorReviewSynthesis;
  }): {
    verdict: 'pass' | 'rewrite' | 'blocked'; requiredActions: string[];
  } {
    if (input.reports.length !== 3 || new Set(input.reports.map((report) => report.reviewerRole)).size !== 3) {
      throw new Error('必须收到事实、文学和体验三份独立点评');
    }
    const issues = input.reports.flatMap((report) => report.issues.map((issue) => ({ ...issue, reviewerRole: report.reviewerRole })));
    const decision = decideProductionReviewOutcome({
      reports: input.reports,
      editorSynthesis: input.editorSynthesis,
      revisionRound: input.revisionRound
    });
    const { blocked, rewrite } = decision;
    const prioritized = prioritizedIssues(issues, input.editorSynthesis.priorityIssueIndexes);
    const hardActions = unique(prioritized.filter((issue) => issue.severity === 'blocker' || issue.severity === 'major')
      .map((issue) => `${issue.location}：${issue.requiredAction}（证据：${issue.evidence}；来源：${issue.reviewerRole}）`));
    const softActions = unique(prioritized.filter((issue) => issue.severity === 'minor' || issue.severity === 'observation')
      .map((issue) => `${issue.location}：${issue.requiredAction}（仅作软建议）`));
    if (rewrite && hardActions.length === 0) hardActions.push('按三席共同结论完成一次定点重写，不改动无问题段落。');
    if (blocked && hardActions.length === 0) hardActions.push('政治或情色风险达到高等级；停止自动重写，由主编定位证据并等待老板决定。');
    if ((blocked || rewrite) && input.revisionRound <= 2) this.repository.createRevisionOrder(scope, {
      id: this.ids.next(), panelId: input.panelId, manuscriptVersionId: input.manuscriptVersionId,
      round: input.revisionRound, hardActions, softActions,
      disagreements: [
        ...disagreements(input.reports),
        ...input.editorSynthesis.preservedDisagreements.map((item) => ({ status: 'chief_editor_preserved', detail: item }))
      ], now: this.clock.now().toISOString()
    });
    this.repository.finishReviewPanel(scope, input.panelId, blocked);
    return { verdict: blocked ? 'blocked' : rewrite ? 'rewrite' : 'pass', requiredActions: hardActions };
  }
}

export function isSelfContradictoryFactFinding(report: ProductionReview): boolean {
  // P0-7 自洽门禁：事实席证据含"可共存/数学一致/不矛盾/仅新增/尚未确认"软化词，却把同一问题标为硬冲突(major/blocker)，
  // 视为结构无效的自相矛盾报告（如三百步反例：先称冲突又说数学一致）。该席硬问题不触发重写。
  if (report.reviewerRole !== 'fact') return false;
  const soften = ['可共存', '不矛盾', '仅新增', '尚未确认', '数学上', '语义上', '一致的'];
  const hardConflict = ['冲突', '矛盾', '互斥'];
  return report.issues.some((issue) => (issue.severity === 'major' || issue.severity === 'blocker')
    && soften.some((word) => (issue.evidence ?? '').includes(word))
    && hardConflict.some((word) => (issue.issueType ?? '').includes(word)));
}

export function decideProductionReviewOutcome(input: {
  reports: ProductionReview[];
  editorSynthesis: EditorReviewSynthesis;
  revisionRound: number;
}): { blocked: boolean; rewrite: boolean; boundedSingleSubjectiveDissent: boolean } {
  const selfContradictoryFactReports = new Set(input.reports.filter(isSelfContradictoryFactFinding));
  const issues = input.reports.flatMap((report) => (selfContradictoryFactReports.has(report)
    ? []
    : report.issues.map((issue) => ({ ...issue, reviewerRole: report.reviewerRole }))));
  const experience = input.reports.find((report) => report.reviewerRole === 'experience');
  const riskLevels = [experience?.politicalRisk?.level, experience?.sexualContentRisk?.level].filter(Boolean);
  const rewriteReports = input.reports.filter((report) => report.verdict === 'rewrite' && !selfContradictoryFactReports.has(report));
  const hardIssueRoles = new Set(issues.filter((issue) => issue.severity === 'major' || issue.severity === 'blocker')
    .map((issue) => issue.reviewerRole));
  const objectiveRevisionRequired = issues.some((issue) => issue.reviewerRole === 'fact' && issue.severity === 'major')
    || riskLevels.some((level) => level === 'medium');
  const independentlyCorroboratedHardIssue = hardIssueRoles.size >= 2;
  const factReport = input.reports.find((report) => report.reviewerRole === 'fact');
  const experienceReport = input.reports.find((report) => report.reviewerRole === 'experience');
  const blockedReports = input.reports.filter((report) => report.verdict === 'blocked');
  const blockerIssues = issues.filter((issue) => issue.severity === 'blocker');
  const highComplianceRisk = riskLevels.some((level) => level === 'high' || level === 'blocked');
  // Literary review may discover a suspected canon problem, but it is not the authority for
  // objective continuity. When the fact seat explicitly passes and the experience seat does not
  // corroborate, retain the literary finding as an auditable disagreement and allow one bounded
  // rewrite/recheck. This does not weaken literary blockers about motivation, plot collapse or prose,
  // nor any fact, cross-seat, safety or compliance blocker.
  const uncorroboratedLiteraryObjectiveBlocker = blockedReports.length === 1
    && blockedReports[0]!.reviewerRole === 'literary'
    && factReport?.verdict === 'pass'
    && experienceReport?.verdict !== 'blocked'
    && blockerIssues.length > 0
    && blockerIssues.every((issue) => issue.reviewerRole === 'literary' && isObjectiveContinuityIssue(issue.issueType))
    && !highComplianceRisk;
  const reportBlocked = blockedReports.length > 0 && !uncorroboratedLiteraryObjectiveBlocker;
  const hardBlocked = (blockerIssues.length > 0 && !uncorroboratedLiteraryObjectiveBlocker)
    || highComplianceRisk;
  // The synthesis model may rank and combine submitted evidence, but it cannot promote fixable
  // major issues into a blocker by itself. Blocking severity must come from a reviewer report,
  // an explicit blocker issue, or high/blocked compliance evidence.
  const selfContradictoryBlocked = selfContradictoryFactReports.size > 0;
  const blocked = reportBlocked || hardBlocked || selfContradictoryBlocked;

  // After the two bounded rewrite opportunities, one remaining literary/experience dissent is preserved
  // for owner confirmation instead of becoming an unbounded moving style target. Fact, safety, compliance,
  // blocker and independently corroborated findings never use this convergence exception.
  const boundedSingleSubjectiveDissent = (input.revisionRound >= 3
    && rewriteReports.length === 1
    && rewriteReports[0]!.reviewerRole !== 'fact'
    && input.reports.filter((report) => report !== rewriteReports[0]).every((report) => report.verdict === 'pass')
    && !objectiveRevisionRequired
    && !independentlyCorroboratedHardIssue
    && !hardBlocked)
    || (input.revisionRound >= 3
      && uncorroboratedLiteraryObjectiveBlocker
      && factReport?.verdict === 'pass'
      && experienceReport?.verdict === 'pass'
      && !independentlyCorroboratedHardIssue);
  const rewriteRequested = rewriteReports.length > 0
    || objectiveRevisionRequired
    || independentlyCorroboratedHardIssue
    || uncorroboratedLiteraryObjectiveBlocker
    || (input.editorSynthesis.recommendedVerdict === 'rewrite' && hardIssueRoles.size > 0);
  const rewrite = !blocked && rewriteRequested && !boundedSingleSubjectiveDissent;
  return { blocked, rewrite, boundedSingleSubjectiveDissent };
}

function isObjectiveContinuityIssue(issueType: string): boolean {
  return /正史|连续|时间线|设定|事实|canon|continuity|lore|timeline|world.?rule/iu.test(issueType);
}

export function reportsForEditorSynthesis(reports: ProductionReview[]): Array<Omit<ProductionReview, 'factCandidates'>> {
  return reports.map(({ factCandidates: _factCandidates, ...report }) => report);
}

function unique(values: string[]): string[] { return [...new Set(values)]; }

function disagreements(reports: ProductionReview[]): unknown[] {
  const verdicts = new Set(reports.map((report) => report.verdict));
  return verdicts.size <= 1 ? [] : reports.map((report) => ({ role: report.reviewerRole, verdict: report.verdict, summary: report.summary }));
}

function prioritizedIssues<T>(issues: T[], indexes: number[]): T[] {
  const selected = indexes.map((index) => issues[index]!).filter((issue) => issue !== undefined);
  const selectedIndexes = new Set(indexes);
  return [...selected, ...issues.filter((_, index) => !selectedIndexes.has(index))];
}
