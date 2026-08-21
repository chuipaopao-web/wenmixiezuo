import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';
import { ContinuationImportRepository } from '../../infrastructure/db/repositories/continuation-import-repository.js';
import { OwnerManuscriptRepository } from '../../infrastructure/db/repositories/owner-manuscript-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { ArtifactService } from '../artifacts/artifact-service.js';
import { SettingOutlineWorkspaceService, type SettingOutlineWorkspaceItem } from './setting-outline-workspace-service.js';
import { SettingQualityReportRepository, type SettingQualityIssue } from '../../infrastructure/db/repositories/setting-quality-report-repository.js';
import { hashConfirmedSettings, hashSettingItemContent } from './setting-quality-shared.js';
import {
  isMacroSettingItem,
  resolveContinuationSettingOutlineProfile,
  resolveSettingOutlineProfile,
  type SettingOutlineProfile
} from './setting-outline-profile.js';

export interface SettingBaselineReadiness extends SettingOutlineProfile {
  ready: boolean;
  missing: string[];
  unresolved: string[];
  hasCanonChapters: boolean;
}

export class SettingBaselineService {
  private readonly repository: PlanningWorkflowRepository;
  private readonly continuations: ContinuationImportRepository;
  private readonly artifacts: ArtifactService;
  private readonly workspace: SettingOutlineWorkspaceService;

  public constructor(
    private readonly database: DatabaseSync,
    ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new PlanningWorkflowRepository(database);
    this.continuations = new ContinuationImportRepository(database);
    this.artifacts = new ArtifactService(database, ids, clock);
    this.workspace = new SettingOutlineWorkspaceService(database, clock);
  }

  public inspect(scope: BookScope): SettingBaselineReadiness {
    assertBookScope(scope);
    const profile = this.profile(scope);
    const rows = this.repository.settingStatuses(scope);
    const statuses = new Map(rows.map((row) => [row.item_key, row.item_status]));
    const unresolved = profile.required.filter((key) => {
      const status = statuses.get(key);
      return status === '讨论中' || status === '候选待确认';
    });
    const unresolvedSet = new Set(unresolved);
    const missing = profile.required.filter((key) => statuses.get(key) !== '已确认' && !unresolvedSet.has(key));
    return { ...profile, ready: missing.length === 0 && unresolved.length === 0, missing, unresolved, hasCanonChapters: this.hasCanonChapters(scope) };
  }

  public confirm(scope: BookScope, expectedPlanningVersion: number, acknowledgedIssueIds: string[] = []): { stage: string; version: number } {
    const readiness = this.inspect(scope);
    if (!readiness.ready) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '设定尚未准备完成：题材必备项必须确认，其余可选择稍后补充、刻意留白或不适用',
        { ...readiness },
        false,
        409
      );
    }
    // 定稿门禁：必须先有一份覆盖当前设定内容的主编质检报告；
    // 内容在质检后有任何改动，旧报告自动作废（指纹不匹配）。
    const confirmedItems = this.workspace.list(scope)
      .filter((item) => isMacroSettingItem(item) && item.status === '已确认' && item.content !== null);
    const fingerprint = hashConfirmedSettings(confirmedItems);
    const report = new SettingQualityReportRepository(this.database).latest(scope);
    if (report === undefined || report.content_hash !== fingerprint) {
      throw new DomainError(
        errorCodes.settingQualityAuditRequired,
        '定稿前需要主编先把整份设定检查一遍',
        { ...readiness },
        false,
        409
      );
    }
    const reportIssues = JSON.parse(report.issues_json) as SettingQualityIssue[];
    const acknowledged = new Set(acknowledgedIssueIds);
    const unacknowledgedHard = reportIssues.filter((issue) => issue.severity === 'hard' && !acknowledged.has(issue.id));
    if (unacknowledgedHard.length > 0) {
      throw new DomainError(
        errorCodes.settingQualityIssuesUnacknowledged,
        '主编发现了硬伤；逐项确认“我已知晓，仍要保留”后才能定稿',
        { issues: unacknowledgedHard, verdict: report.verdict, summary: report.summary_text },
        false,
        409
      );
    }
    const activeStoryBibleId = this.repository.activeArtifactVersion(scope, 'story_bible');
    if (activeStoryBibleId === undefined) {
      throw new DomainError(errorCodes.operationIncomplete, '缺少设定资料版本', {}, false, 409);
    }
    const now = this.clock.now().toISOString();
    return new UnitOfWork(this.database).run(() => {
      const activeStoryBible = this.artifacts.requireVersion(scope, activeStoryBibleId);
      const confirmedItems = this.workspace.list(scope)
        .filter((item) => isMacroSettingItem(item) && item.status === '已确认' && item.content !== null)
        .map((item) => ({
          itemKey: item.itemKey,
          groupTitle: item.groupTitle,
          label: item.label,
          content: item.content,
          sourceDiscussionId: item.sourceDiscussionId,
          sourceDecisionId: item.sourceDecisionId,
          confirmedAt: item.confirmedAt
        }));
      const nextStoryBible = this.artifacts.addVersion(scope, activeStoryBible.artifactId, {
        ...activeStoryBible.content,
        settingOutline: {
          schemaVersion: 1,
          confirmedAt: now,
          items: confirmedItems
        }
      }, activeStoryBible.artifactVersionId);
      this.artifacts.select(scope, activeStoryBible.artifactId, nextStoryBible.artifactVersionId);
      this.repository.synchronizeCreationWorkflowAfterSetting(scope, now);
      const synchronized = this.repository.planningState(scope);
      if (
        synchronized?.version === expectedPlanningVersion + 1
        && synchronized.stage === 'setting_ready'
        && synchronized.setting_baseline_version_id === nextStoryBible.artifactVersionId
      ) {
        return { stage: 'setting_ready', version: synchronized.version };
      }
      const changed = this.repository.advanceSetting(
        scope, expectedPlanningVersion, nextStoryBible.artifactVersionId, now
      );
      if (!changed) {
        throw new DomainError(
          errorCodes.bookVersionConflict,
          '规划状态已经变化，请刷新后重试',
          {},
          true,
          409
        );
      }
      return { stage: 'setting_ready', version: expectedPlanningVersion + 1 };
    });
  }

  /** 单项移除会使当前设定基线失效；保留其他条目、历史基线版本和正文。 */
  public removeCurrentItem(scope: BookScope, itemKey: string): SettingOutlineWorkspaceItem {
    assertBookScope(scope);
    const now = this.clock.now().toISOString();
    return new UnitOfWork(this.database).run(() => {
      const removed = this.workspace.removeCurrent(scope, itemKey);
      this.repository.resetSettingBaseline(scope, now);
      return removed;
    });
  }

  public clear(scope: BookScope): { clearedItems: number; hasCanonChapters: boolean } {
    assertBookScope(scope);
    const now = this.clock.now().toISOString();
    return new UnitOfWork(this.database).run(() => {
      const clearedItems = this.workspace.clearAll(scope);
      this.repository.resetSettingBaseline(scope, now);
      return { clearedItems, hasCanonChapters: this.hasCanonChapters(scope) };
    });
  }

  /** 该书是否已有正文正史：有正文的书清空设定前要给出更强的警告。 */
  public hasCanonChapters(scope: BookScope): boolean {
    assertBookScope(scope);
    return new OwnerManuscriptRepository(this.database).hasCanonChapters(scope);
  }

  /** 当前质检报告状态：最新报告、是否仍覆盖当前设定内容、最近一次质检任务状态。 */
  public qualityReport(scope: BookScope): {
    report: {
      reportId: string;
      verdict: 'pass' | 'warn' | 'fail';
      summary: string;
      issues: Array<SettingQualityIssue & { applicable: boolean }>;
      createdAt: string;
    } | null;
    fresh: boolean;
    taskStatus: string | null;
  } {
    assertBookScope(scope);
    const confirmedItems = this.workspace.list(scope)
      .filter((item) => isMacroSettingItem(item) && item.status === '已确认' && item.content !== null);
    const currentByKey = new Map(confirmedItems.map((item) => [item.itemKey, item]));
    const issues = (row: { issues_json: string }): Array<SettingQualityIssue & { applicable: boolean }> =>
      (JSON.parse(row.issues_json) as SettingQualityIssue[]).map((issue) => {
        const content = currentByKey.get(issue.itemKey)?.content ?? null;
        return { ...issue, applicable: issue.itemKey !== 'whole' && issue.replacement.length > 0
          && content !== null && hashSettingItemContent(content) === issue.baseContentHash };
      });
    const fingerprint = hashConfirmedSettings(confirmedItems);
    const qualityReports = new SettingQualityReportRepository(this.database);
    const row = qualityReports.latest(scope);
    const taskStatus = qualityReports.latestAuditTaskStatus(scope);
    return {
      report: row === undefined ? null : {
        reportId: row.report_id,
        verdict: row.verdict,
        summary: row.summary_text,
        issues: issues(row),
        createdAt: row.created_at
      },
      fresh: row !== undefined && row.content_hash === fingerprint,
      taskStatus
    };
  }

  public applyQualitySuggestion(
    scope: BookScope,
    reportId: string,
    issueId: string
  ): SettingOutlineWorkspaceItem {
    assertBookScope(scope);
    const report = new SettingQualityReportRepository(this.database).latest(scope);
    if (report === undefined || report.report_id !== reportId) {
      throw new DomainError(
        errorCodes.operationIncomplete,
        '这份主编检查报告已经不是最新报告，请刷新后重试',
        {},
        true,
        409
      );
    }
    const issue = (JSON.parse(report.issues_json) as SettingQualityIssue[])
      .find((candidate) => candidate.id === issueId);
    if (issue === undefined || issue.itemKey === 'whole' || issue.replacement.trim().length === 0) {
      throw new DomainError(errorCodes.validation, '这条建议不能直接修改具体设定项');
    }
    const current = this.workspace.list(scope).find((item) => item.itemKey === issue.itemKey);
    if (current?.status !== '已确认' || current.content === null) {
      throw new DomainError(errorCodes.operationIncomplete, '对应设定项当前不是已确认状态，请刷新后处理', {}, true, 409);
    }
    if (hashSettingItemContent(current.content) !== issue.baseContentHash) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '这项设定在主编检查后已经改过，不能再套用旧修改稿',
        { itemKey: issue.itemKey },
        true,
        409
      );
    }
    return new UnitOfWork(this.database).run(() => this.workspace.save(scope, {
      itemKey: current.itemKey,
      groupTitle: current.groupTitle,
      label: current.label,
      prompt: current.prompt,
      sourceLabel: current.sourceLabel,
      status: '已确认',
      custom: current.custom,
      sortOrder: current.sortOrder,
      content: issue.replacement
    }));
  }
  private profile(scope: BookScope): SettingOutlineProfile {
    const blueprint = this.repository.openingBlueprint(scope);
    if (blueprint !== undefined) {
      const parsed = JSON.parse(blueprint) as Record<string, unknown>;
      if (Object.keys(parsed).length > 0) {
        return resolveSettingOutlineProfile(parsed as unknown as OpeningBlueprintInput);
      }
    }
    if (this.continuations.latestReadyBaseline(scope) !== undefined) {
      return resolveContinuationSettingOutlineProfile();
    }
    throw new DomainError(errorCodes.operationIncomplete, '缺少开书资料或可用的已有正文分析', {}, false, 409);
  }
}
