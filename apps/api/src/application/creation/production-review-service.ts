import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { parseEditorReviewSynthesis, parseProductionReview, type EditorReviewSynthesis, type ProductionReview, type ReviewerRole } from '../../contracts/production-review.js';
import { ReviewModelCompatibilityService } from '../agents/model-binding-v2-service.js';
import type { TeamAgentRow } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import type { ProductionWorkflowRepository, ReviewPanelRecord } from '../../infrastructure/db/repositories/production-workflow-repository.js';

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

  public persist(scope: BookScope, input: {
    panelId: string; role: ReviewerRole; manuscriptVersionId: string; modelSnapshotId: string; agentId: string;
    raw: string; inputTokens: number;
  }): ProductionReview {
    const report = parseProductionReview(input.raw, {
      reviewerRole: input.role, manuscriptVersionId: input.manuscriptVersionId, modelSnapshotId: input.modelSnapshotId
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
    raw: string; issueCount: number;
  }): EditorReviewSynthesis {
    const synthesis = parseEditorReviewSynthesis(input.raw, {
      panelId: input.panelId, manuscriptVersionId: input.manuscriptVersionId, issueCount: input.issueCount
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
    const experience = input.reports.find((report) => report.reviewerRole === 'experience');
    const riskLevels = [experience?.politicalRisk?.level, experience?.sexualContentRisk?.level].filter(Boolean);
    const blocked = input.editorSynthesis.recommendedVerdict === 'blocked' || input.reports.some((report) => report.verdict === 'blocked')
      || issues.some((issue) => issue.severity === 'blocker')
      || riskLevels.some((level) => level === 'high' || level === 'blocked');
    const rewrite = !blocked && (input.editorSynthesis.recommendedVerdict === 'rewrite' || input.reports.some((report) => report.verdict === 'rewrite')
      || issues.some((issue) => issue.severity === 'major')
      || riskLevels.some((level) => level === 'medium'));
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
