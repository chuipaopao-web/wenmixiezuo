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
      challenger: selected.challenger,
      selectionReason: {
        policy: selected.challenger === null ? 'three-distinct-models-v1' : 'four-distinct-models-v2',
        factSubstitution: /glm/iu.test(input.writerModelId) ? 'writer_is_glm_use_deepseek' : 'default_glm',
        writer: `${input.writerProvider}/${input.writerModelId}`
      }, now: this.clock.now().toISOString()
    });
    return { panelId, reviewers: [
      { role: 'fact', agent: selected.fact },
      { role: 'literary', agent: selected.literary },
      { role: 'experience', agent: selected.experience },
      ...(selected.challenger === null ? [] : [{ role: 'challenger' as const, agent: selected.challenger }])
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
        { role: 'experience', agent: panel.experience },
        ...(panel.challenger === null ? [] : [{ role: 'challenger' as const, agent: panel.challenger }])
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
    raw: string; inputTokens: number; currentManuscript: string;
    allowDroppingInvalidFactCandidates?: boolean; normalizeLocalBlockers?: boolean;
    normalizeAiStyleEvidence?: boolean;
    normalizeRepairedVerdict?: boolean;
    normalizeMalformedJsonStrings?: boolean;
    normalizeRiskArrays?: boolean;
    normalizeScoreArray?: boolean;
    normalizeIssueLocations?: boolean;
    normalizeIssueLimit?: boolean;
    normalizeRepairedSeverity?: boolean;
    normalizeIssueFieldAliases?: boolean;
    normalizeFrozenBindings?: boolean;
    normalizeProvisionalDraftBlockers?: boolean;
    normalizeFactOmissionMajor?: boolean;
    allowDroppingUngroundedIssues?: boolean;
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
      normalizeIssueLimit: input.normalizeIssueLimit === true,
      normalizeRepairedSeverity: input.normalizeRepairedSeverity === true,
      normalizeIssueFieldAliases: input.normalizeIssueFieldAliases === true,
      normalizeFrozenBindings: input.normalizeFrozenBindings === true,
      normalizeProvisionalDraftBlockers: input.normalizeProvisionalDraftBlockers === true,
      normalizeFactOmissionMajor: input.normalizeFactOmissionMajor === true
    });
    const responsibilityBoundReport = enforceReviewerResponsibilityBoundary(removeDeterministicLengthIssues(report));
    const groundedReport = groundProductionReviewEvidence(responsibilityBoundReport, input.currentManuscript, {
      allowDroppingUngroundedFactCandidates: input.allowDroppingInvalidFactCandidates === true,
      allowGroundedEvidenceExcerptRecovery: input.allowDroppingInvalidFactCandidates === true,
      allowDroppingUngroundedAiStyleEvidence: input.normalizeAiStyleEvidence === true,
      allowDroppingUngroundedIssues: input.allowDroppingUngroundedIssues === true
    });
    const reportJson = JSON.stringify(groundedReport);
    this.repository.insertReviewReport(scope, {
      id: this.ids.next(), panelId: input.panelId, manuscriptVersionId: input.manuscriptVersionId, role: input.role,
      agentId: input.agentId, modelSnapshotId: input.modelSnapshotId, report: groundedReport, reportHash: createHash('sha256').update(reportJson).digest('hex'),
      inputTokens: input.inputTokens, now: this.clock.now().toISOString()
    });
    return groundedReport;
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
    const expectedRoles = this.repository.panelReviewerRoles(scope, input.panelId);
    if (input.reports.length !== expectedRoles.length
      || new Set(input.reports.map((report) => report.reviewerRole)).size !== expectedRoles.length
      || expectedRoles.some((role) => !input.reports.some((report) => report.reviewerRole === role))) {
      throw new Error('必须收齐本轮全部点评席的独立点评');
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
    if (rewrite && hardActions.length === 0) hardActions.push('按各点评席共同结论完成一次定点重写，不改动无问题段落。');
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

export function removeDeterministicLengthIssues(report: ProductionReview): ProductionReview {
  const issues = report.issues.filter((issue) => {
    const text = `${issue.issueType}\n${issue.location}\n${issue.requiredAction}`;
    return !/(?:正文)?字数(?:不足|超出|超限|范围|约束)?|有效字数|字符数(?:不足|超出|超限)?|tokenCount|输入Token|输出Token|2350|3650/iu.test(text);
  });
  if (issues.length === report.issues.length) return report;
  const hasHardIssue = issues.some((issue) => issue.severity === 'major' || issue.severity === 'blocker');
  return {
    ...report,
    summary: hasHardIssue
      ? '机械字数、格式等已由确定性硬检查独立裁决；本报告只保留仍需处理的内容问题。'
      : '机械字数、格式等已由确定性硬检查独立裁决；本席未发现需要改写的内容问题。',
    issues,
    verdict: report.verdict === 'blocked' ? 'blocked' : hasHardIssue ? report.verdict : 'pass'
  };
}

export function enforceReviewerResponsibilityBoundary(report: ProductionReview): ProductionReview {
  if (report.reviewerRole === 'fact') return report;
  let downgraded = false;
  const issues = report.issues.map((issue) => {
    if ((issue.severity !== 'major' && issue.severity !== 'blocker')
      || (!isObjectiveContinuityIssue(issue.issueType) && !isLocalSubjectiveRepair(issue))) return issue;
    downgraded = true;
    return { ...issue, severity: 'minor' as const };
  });
  if (!downgraded) return report;
  const hasHardContentIssue = issues.some((issue) => issue.severity === 'major' || issue.severity === 'blocker');
  const hasBlockingComplianceRisk = report.reviewerRole === 'experience'
    && [report.politicalRisk?.level, report.sexualContentRisk?.level]
      .some((level) => level === 'medium' || level === 'high' || level === 'blocked');
  return {
    ...report,
    summary: `${report.summary} 客观事实与连续性由事实席独立裁决；本席相关意见仅保留为阅读或表达建议。`,
    issues,
    verdict: hasBlockingComplianceRisk
      ? report.verdict
      : hasHardContentIssue ? report.verdict : 'pass'
  };
}

function isLocalSubjectiveRepair(issue: ProductionReview['issues'][number]): boolean {
  const action = issue.requiredAction.trim();
  const repairScope = `${issue.issueType}\n${action}`;
  const explicitlyLocal = /(?:删除|删去|改为|替换|补充|补入|增加|添加|插入|加上|加一句|加一个|保留).{0,24}(?:此句|一句|一处|两句|两处|半句|短句|细节|动作|微反应|过渡)/u.test(action)
    || /(?:此句|一句|一处|两句|两处|半句|一个动作|一个细节).{0,24}(?:删除|删去|改为|替换|补充|补入|增加|添加|插入|加上)/u.test(action)
    || /(?:删除或(?:大幅)?压缩|删除并压缩|删去并压缩|压缩).{0,80}(?:具体拆解|具体列举|这段列举|该段列举|这一句|该句|一段|一行|两三句|三项|三选|三处).{0,120}(?:只保留|改为|后移|推迟|留到)/u.test(action)
    || /(?:推迟|后移|提前|挪到|调整).{0,18}(?:一两句|两三句|一句|两句|几句|下一句|后一句)/u.test(action)
    || /(?:先|改让|让).{0,40}(?:一个动作|一个细节|一句反应|一拍反应).{0,40}(?:再|之后|随后|然后)/u.test(action);
  // Models sometimes put a local sentence under a broad location label such as 全文节奏.
  // Severity follows the requested repair scope, not that imprecise location label.
  const trulyStructural = /(?:全文|全章|持续性|核心人物动机无法成立|人物动机无法成立|场景因果断裂|主线因果断裂|章末钩子失效|整体重构|整章重写)/u.test(repairScope);
  return explicitlyLocal && !trulyStructural;
}

export function groundProductionReviewEvidence(
  report: ProductionReview,
  currentManuscript: string,
  options: {
    allowDroppingUngroundedFactCandidates?: boolean;
    allowGroundedEvidenceExcerptRecovery?: boolean;
    allowDroppingUngroundedAiStyleEvidence?: boolean;
    allowDroppingUngroundedIssues?: boolean;
  } = {}
): ProductionReview {
  const manuscript = normalizedEvidenceText(currentManuscript);
  if (manuscript.length === 0) throw new Error('当前完整正文为空，不能保存点评报告');
  const ground = (evidence: string, field: string, allowExcerptRecovery: boolean): string => {
    const normalized = normalizedEvidenceText(evidence);
    // A short quotation can still be decisive evidence. Time markers such as
    // “三天。” or “午时。” are only three Chinese characters, so rejecting
    // every exact excerpt below four characters makes valid continuity
    // findings impossible to persist. Empty and one/two-character fragments
    // remain too weak to count as review evidence.
    if ([...normalized].length >= 3 && manuscript.includes(normalized)) return normalized;
    if (allowExcerptRecovery) {
      const excerpt = longestSharedEvidenceExcerpt(manuscript, normalized);
      if (excerpt !== null) return excerpt;
    }
    {
      throw new Error(`${field}必须逐字来自当前完整正文，不能引用章纲、旧稿、作者要求或模型猜测`);
    }
  };
  const allowExcerptRecovery = options.allowGroundedEvidenceExcerptRecovery === true;
  let droppedUngroundedIssue = false;
  const issues = report.issues.flatMap((issue, index) => {
    try {
      return [{ ...issue, evidence: ground(issue.evidence, `issues[${index}].evidence`, allowExcerptRecovery) }];
    } catch (error) {
      if (options.allowDroppingUngroundedIssues === true && report.reviewerRole !== 'fact') {
        droppedUngroundedIssue = true;
        return [];
      }
      throw error;
    }
  });
  const aiStyle = report.aiStyle === undefined ? undefined : {
    ...report.aiStyle,
    evidence: report.aiStyle.evidence.flatMap((evidence, index) => {
      try {
        return [ground(evidence, `aiStyle.evidence[${index}]`, allowExcerptRecovery)];
      } catch (error) {
        if (options.allowDroppingUngroundedAiStyleEvidence === true) return [];
        throw error;
      }
    })
  };
  const groundedRisks: Partial<Pick<ProductionReview, 'politicalRisk' | 'sexualContentRisk'>> = {};
  for (const [riskName, risk] of [
    ['politicalRisk', report.politicalRisk],
    ['sexualContentRisk', report.sexualContentRisk]
  ] as const) {
    if (risk !== undefined) groundedRisks[riskName] = {
      ...risk,
      evidence: risk.evidence.map((evidence, index) =>
        ground(evidence, `${riskName}.evidence[${index}]`, allowExcerptRecovery))
    };
  }
  const hasHardIssue = issues.some((issue) => issue.severity === 'major' || issue.severity === 'blocker');
  const hasBlockingComplianceRisk = report.reviewerRole === 'experience'
    && [report.politicalRisk?.level, report.sexualContentRisk?.level]
      .some((level) => level === 'medium' || level === 'high' || level === 'blocked');
  const groundedBase: ProductionReview = {
    ...report,
    ...groundedRisks,
    issues,
    ...(aiStyle === undefined ? {} : { aiStyle }),
    verdict: droppedUngroundedIssue && !hasHardIssue && !hasBlockingComplianceRisk ? 'pass' : report.verdict
  };
  if (report.factCandidates === undefined) return groundedBase;
  const groundedFacts = report.factCandidates.filter((candidate, index) => {
    try {
      ground(candidate.evidenceQuote, `factCandidates[${index}].evidenceQuote`, false);
      return true;
    } catch (error) {
      if (options.allowDroppingUngroundedFactCandidates === true) return false;
      throw error;
    }
  });
  return { ...groundedBase, factCandidates: groundedFacts };
}

function normalizedEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[“”„‟]/gu, String.fromCharCode(34))
    .replace(/\s+/gu, ' ')
    .trim();
}

function longestSharedEvidenceExcerpt(manuscript: string, evidence: string): string | null {
  const manuscriptCharacters = [...manuscript];
  const evidenceCharacters = [...evidence];
  let previous = new Uint16Array(evidenceCharacters.length + 1);
  let bestLength = 0;
  let bestEnd = 0;
  for (let manuscriptIndex = 1; manuscriptIndex <= manuscriptCharacters.length; manuscriptIndex += 1) {
    const current = new Uint16Array(evidenceCharacters.length + 1);
    for (let evidenceIndex = 1; evidenceIndex <= evidenceCharacters.length; evidenceIndex += 1) {
      if (manuscriptCharacters[manuscriptIndex - 1] !== evidenceCharacters[evidenceIndex - 1]) continue;
      current[evidenceIndex] = previous[evidenceIndex - 1]! + 1;
      if (current[evidenceIndex]! > bestLength) {
        bestLength = current[evidenceIndex]!;
        bestEnd = manuscriptIndex;
      }
    }
    previous = current;
  }
  if (bestLength < 8) return null;
  const excerpt = manuscriptCharacters.slice(bestEnd - bestLength, bestEnd).join('').trim();
  return [...excerpt].length >= 8 ? excerpt : null;
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
  const uncorroboratedLiteraryObjectiveBlocker = blockedReports.every((report) => report.reviewerRole === 'literary')
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
