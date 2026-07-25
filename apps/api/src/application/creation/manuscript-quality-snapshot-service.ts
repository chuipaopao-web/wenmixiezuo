import type { DatabaseSync } from 'node:sqlite';
import type { ProductionReview } from '../../contracts/production-review.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { ManuscriptQualitySnapshotRepository } from '../../infrastructure/db/repositories/manuscript-quality-snapshot-repository.js';

const POLICY_VERSION = 'manuscript-quality-vector-v1';
const REGRESSION_DELTA = 8;
const IMPROVEMENT_DELTA = 5;

export interface ManuscriptQualityDecision {
  snapshotId: string;
  manuscriptVersionId: string;
  previousBestVersionId: string | null;
  bestVersionId: string | null;
  hardBlocked: boolean;
  hardImproved: boolean;
  subjectiveRegression: boolean;
  retainPreviousBest: boolean;
  regressedDimensions: string[];
  improvedDimensions: string[];
}

/**
 * Records independent review dimensions without collapsing them into a single score.
 *
 * "Best" is a workflow safety pointer, not a claim that literary quality is objectively
 * measurable. Hard evidence always wins. Soft regression protection only activates when
 * at least two comparable literary/experience dimensions fall materially and none improves.
 */
export class ManuscriptQualitySnapshotService {
  private readonly repository: ManuscriptQualitySnapshotRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new ManuscriptQualitySnapshotRepository(database);
  }

  public record(scope: BookScope, input: {
    chapterId: string;
    manuscriptVersionId: string;
    reviewPanelId: string;
    reports: ProductionReview[];
  }): ManuscriptQualityDecision {
    assertBookScope(scope);
    assertCompletePanel(input.reports, input.manuscriptVersionId);
    return new UnitOfWork(this.database).run(() => {
      const existing = this.repository.findByPanel(
        scope, input.manuscriptVersionId, input.reviewPanelId
      );
      const previous = this.repository.best(scope, input.chapterId);
      const dimensions = dimensionVector(input.reports);
      const hardBlocked = hasHardProblem(input.reports);
      const comparison = compareSubjective(
        previous === null ? null : parseDimensions(previous.dimensionsJson),
        dimensions
      );
      const hardImproved = previous?.hardBlocked === true && !hardBlocked;
      const retainPreviousBest = previous !== null
        && previous.manuscriptVersionId !== input.manuscriptVersionId
        && !hardImproved
        && (hardBlocked || comparison.regressed);
      const chooseCurrent = !hardBlocked && !retainPreviousBest;
      const snapshotId = existing?.snapshotId ?? this.ids.next();

      if (existing === null) {
        this.repository.insert(scope, {
          snapshotId,
          chapterId: input.chapterId,
          manuscriptVersionId: input.manuscriptVersionId,
          reviewPanelId: input.reviewPanelId,
          parentSnapshotId: previous?.snapshotId ?? null,
          dimensionsJson: JSON.stringify(dimensions),
          hardBlocked,
          policyVersion: POLICY_VERSION,
          now: this.clock.now().toISOString()
        });
      }
      if (chooseCurrent) {
        this.repository.selectBest(scope, input.chapterId, snapshotId);
      }

      return {
        snapshotId,
        manuscriptVersionId: input.manuscriptVersionId,
        previousBestVersionId: previous?.manuscriptVersionId ?? null,
        bestVersionId: chooseCurrent
          ? input.manuscriptVersionId
          : previous?.manuscriptVersionId ?? null,
        hardBlocked,
        hardImproved,
        subjectiveRegression: comparison.regressed,
        retainPreviousBest,
        regressedDimensions: comparison.regressedDimensions,
        improvedDimensions: comparison.improvedDimensions
      };
    });
  }

  public restoreBest(scope: BookScope, input: {
    chapterId: string;
    rejectedVersionId: string;
    bestVersionId: string;
    pipelineRunId: string;
  }): void {
    assertBookScope(scope);
    new UnitOfWork(this.database).run(() => {
      this.repository.restoreBest(scope, {
        ...input,
        now: this.clock.now().toISOString()
      });
    });
  }
}

function assertCompletePanel(reports: ProductionReview[], manuscriptVersionId: string): void {
  if (reports.length !== 3
    || new Set(reports.map((report) => report.reviewerRole)).size !== 3
    || reports.some((report) => report.manuscriptVersionId !== manuscriptVersionId)) {
    throw new Error('质量快照必须绑定同一稿件的事实、文学、体验三份独立报告');
  }
}

function dimensionVector(reports: ProductionReview[]): Record<string, number> {
  const vector: Record<string, number> = {};
  for (const report of reports) {
    for (const [dimension, score] of Object.entries(report.scores)) {
      vector[`${report.reviewerRole}:${dimension}`] = score;
    }
    if (report.reviewerRole === 'literary' && report.aiStyle !== undefined) {
      vector['literary:ai_style_naturalness'] = 100 - report.aiStyle.riskScore;
    }
  }
  return vector;
}

function hasHardProblem(reports: ProductionReview[]): boolean {
  if (reports.some((report) => report.verdict === 'blocked'
    || report.issues.some((issue) => issue.severity === 'blocker'))) return true;
  const fact = reports.find((report) => report.reviewerRole === 'fact');
  if (fact?.issues.some((issue) => issue.severity === 'major')) return true;
  const experience = reports.find((report) => report.reviewerRole === 'experience');
  return [experience?.politicalRisk?.level, experience?.sexualContentRisk?.level]
    .some((level) => level === 'medium' || level === 'high' || level === 'blocked');
}

function compareSubjective(
  previous: Record<string, number> | null,
  current: Record<string, number>
): { regressed: boolean; regressedDimensions: string[]; improvedDimensions: string[] } {
  if (previous === null) return { regressed: false, regressedDimensions: [], improvedDimensions: [] };
  const comparable = Object.keys(current)
    .filter((key) => (key.startsWith('literary:') || key.startsWith('experience:'))
      && Number.isFinite(previous[key]));
  const regressedDimensions = comparable.filter((key) => previous[key]! - current[key]! >= REGRESSION_DELTA);
  const improvedDimensions = comparable.filter((key) => current[key]! - previous[key]! >= IMPROVEMENT_DELTA);
  return {
    regressed: regressedDimensions.length >= 2 && improvedDimensions.length === 0,
    regressedDimensions,
    improvedDimensions
  };
}

function parseDimensions(json: string): Record<string, number> {
  const value = JSON.parse(json) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('历史质量快照维度无效');
  }
  const dimensions: Record<string, number> = {};
  for (const [key, score] of Object.entries(value)) {
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new Error('历史质量快照分值无效');
    dimensions[key] = score;
  }
  return dimensions;
}
