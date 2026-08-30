import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { PlanningTreeDocument, PlanningTreeKind, V7ContextSourceTrace } from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { V7SettingLedgerReader, type V7CompactSettingLedger } from '../books/v7-setting-ledger-reader.js';
import {
  V7PlanningRuntimeRepository,
  type V7PlanningSnapshotAuthority,
  type V7PlanningSnapshotPurpose,
  type V7PlanningSnapshotSourceKind,
  type V7PlanningSourceItemRow,
  type V7PlanningSnapshotRow
} from '../../infrastructure/db/repositories/v7-planning-runtime-repository.js';

interface SourceCandidate {
  sourceKind: V7PlanningSnapshotSourceKind;
  sourceId: string;
  sourceVersion: string;
  authority: V7PlanningSnapshotAuthority;
  label: string;
  content: unknown;
  contentHash: string;
  includedReason: string;
}

interface OpeningRow {
  opening_blueprint_id: string;
  version: number;
  blueprint_json: string;
  content_hash: string;
  title: string;
}

interface SettingRow {
  item_key: string;
  item_label: string;
  version_id: string;
  revision: number;
  content_json: string;
}

interface ConfirmedTreeRow {
  tree_version_id: string;
  tree_kind: PlanningTreeKind;
  scope_id: string;
  revision: number;
  content_json: string;
  content_hash: string;
}

export interface V7PlanningCompiledSnapshot {
  snapshotId: string;
  ownerId: string;
  bookId: string;
  treeKind: PlanningTreeKind;
  scopeId: string;
  purpose: V7PlanningSnapshotPurpose;
  sourceFingerprint: string;
  sources: Array<{
    sourceKind: V7PlanningSnapshotSourceKind;
    sourceId: string;
    sourceVersion: string;
    authority: V7PlanningSnapshotAuthority;
    label: string;
    content: unknown;
    contentHash: string;
    includedReason: string;
  }>;
  excludedSources: string[];
  excludedSourceDecisions: Array<{
    sourceKind: V7PlanningSnapshotSourceKind;
    sourceId: string;
    sourceVersion: string;
    authority: V7PlanningSnapshotAuthority;
    label: string;
    contentHash: string;
    reason: string;
  }>;
  createdAt: string;
}

export interface V7PlanningScaleProfile {
  publishingPlatform: string;
  expectedTotalWords: number;
}

export class V7PlanningSourceCompiler {
  private readonly repository: V7PlanningRuntimeRepository;
  private readonly settingLedger: V7SettingLedgerReader;

  public constructor(
    database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new V7PlanningRuntimeRepository(database);
    this.settingLedger = new V7SettingLedgerReader(database);
  }

  public compile(input: {
    ownerId: string;
    bookId: string;
    treeKind: PlanningTreeKind;
    scopeId: string;
    purpose: V7PlanningSnapshotPurpose;
    authorGoal?: string;
  }): V7PlanningCompiledSnapshot {
    const authorGoal = normalizeAuthorGoal(input.authorGoal);
    const opening = this.requireOpening(input.ownerId, input.bookId);
    const settings = this.confirmedSettings(input.ownerId, input.bookId);
    const excludedSources: string[] = [];
    if (settings.length === 0) {
      throw new DomainError(errorCodes.validation, '请先确认至少一项设定，再开始规划全书。', {}, false, 409);
    }

    const rawOpeningContent = { title: opening.title, ...jsonObject(opening.blueprint_json, '开书资料') };
    if (input.treeKind === 'book') requirePlanningScaleProfileFromOpening(rawOpeningContent);
    const openingContent = planningOpeningProjection(rawOpeningContent);
    const settingLedger = this.settingLedger.readCurrent({
      ownerId: input.ownerId,
      bookId: input.bookId,
      openingVersion: opening.version,
      settings
    });

    const sources: SourceCandidate[] = [{
      sourceKind: 'opening',
      sourceId: opening.opening_blueprint_id,
      sourceVersion: String(opening.version),
      authority: 'formal',
      label: '当前正式开书资料',
      content: openingContent,
      contentHash: sha256(stableJson(openingContent)),
      includedReason: '这是作者已经确认并正在使用的开书资料；旧版卷数、商业受众和追读定位不会约束本轮新方案。'
    }];
    sources.push({
      sourceKind: 'setting',
      sourceId: settingLedger.sourceId,
      sourceVersion: settingLedger.sourceVersion,
      authority: 'formal',
      label: '主编签发的当前设定事实总账',
      content: planningLedgerSummary(settingLedger.content),
      contentHash: sha256(stableJson(planningLedgerSummary(settingLedger.content))),
      includedReason: '这是整书设定摘要、分组边界和统一决定；逐项硬事实在同一快照中按版本单独提供。'
    });
    const reviewedFacts = new Map(settingLedger.content.factLedger.map((entry) => [entry.itemKey, entry.facts]));
    for (const projection of settingLedger.projections) {
      const content = {
        schema: 'v7-setting-fact-source-v1',
        itemKey: projection.itemKey,
        label: projection.label,
        contextSummary: projection.contextSummary,
        facts: reviewedFacts.get(projection.itemKey) ?? projection.factEntries
      };
      sources.push({
        sourceKind: 'setting',
        sourceId: projection.versionId,
        sourceVersion: String(projection.revision),
        authority: 'formal',
        label: `正式设定：${projection.label}`,
        content,
        contentHash: sha256(stableJson(content)),
        includedReason: '这是当前设定条目的Agent语义事实索引，保留精确版本用于本轮相关性选择。'
      });
    }
    if (authorGoal.length > 0) {
      const goalHash = sha256(authorGoal);
      sources.push({
        sourceKind: 'author_goal',
        sourceId: `author-goal:${goalHash.slice(0, 24)}`,
        sourceVersion: goalHash,
        authority: 'goal',
        label: '作者本次规划目标',
        content: { text: authorGoal },
        contentHash: goalHash,
        includedReason: '这是作者为本次规划补充的目标，只影响候选方案。'
      });
    } else {
      excludedSources.push('作者没有补充本次规划目标，成员只依据正式开书资料和已确认设定工作。');
    }

    for (const suggestion of this.repository.acceptedAdjustmentSuggestions(input.ownerId, input.bookId)) {
      const content = {
        target: { treeKind: suggestion.tree_kind, scopeId: suggestion.scope_id, nodeKey: suggestion.node_key },
        ...jsonObject(suggestion.suggestion_json, '已采纳规划建议')
      };
      const contentHash = sha256(stableJson(content));
      sources.push({
        sourceKind: 'author_goal',
        sourceId: suggestion.suggestion_id,
        sourceVersion: suggestion.decided_at ?? suggestion.created_at,
        authority: 'goal',
        label: '作者已采纳的未来调整方向',
        content,
        contentHash,
        includedReason: '作者已经采纳这条建议；它只指导下一版候选规划，不会改写已确认规划或正文实际。'
      });
    }

    const parent = this.resolveConfirmedParent(input.ownerId, input.bookId, input.treeKind, input.scopeId);
    if (input.treeKind !== 'book' && parent === undefined) {
      throw new DomainError(errorCodes.validation, '请先确认上一级规划，再设计这一层。', {}, false, 409);
    }
    if (parent !== undefined) {
      sources.push({
        sourceKind: 'confirmed_tree',
        sourceId: parent.tree_version_id,
        sourceVersion: String(parent.revision),
        authority: 'formal',
        label: parent.tree_kind === 'book' ? '已确认全书方向' : '已确认本卷方向',
        content: jsonObject(parent.content_json, '确认规划'),
        contentHash: parent.content_hash,
        includedReason: '当前层必须承接这份已确认的上级方向。'
      });
    }

    for (const actual of this.relevantActuals(input.ownerId, input.bookId, input.treeKind, input.scopeId, parent)) {
      sources.push({
        sourceKind: 'settlement',
        sourceId: actual.source_version_id,
        sourceVersion: String(actual.revision),
        authority: 'actual',
        label: `正文实际：${actual.node_key}`,
        content: {
          nodeKey: actual.node_key,
          state: actual.state,
          summary: actual.summary,
          emotionResult: actual.emotion_result,
          experienceResult: actual.experience_result,
          outcome: actual.outcome,
          evidenceRefs: JSON.parse(actual.evidence_refs_json) as unknown
        },
        contentHash: sha256(stableJson(actual)),
        includedReason: '这是正式结算产生的最新实际进展，未来规划不能覆盖它。'
      });
    }

    const budgetChars = planningBudgetChars(input.treeKind);
    const sourceCharacters = Array.from(stableJson(sources.map((source) => ({
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      label: source.label,
      content: source.content
    })))).length;
    if (sourceCharacters > budgetChars) {
      throw new DomainError(
        errorCodes.validation,
        `对不起，当前规划资料仍有${sourceCharacters}字，超过本步骤${budgetChars}字的安全范围。请先整理设定事实账本或缩小本次规划范围。`,
        { sourceCharacters, budgetChars, treeKind: input.treeKind },
        true,
        409
      );
    }

    const sourceFingerprint = sha256(stableJson({
      treeKind: input.treeKind,
      scopeId: input.scopeId,
      purpose: input.purpose,
      sources: sources.map((source) => ({
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        contentHash: source.contentHash
      }))
    }));
    const now = this.clock.now().toISOString();
    const existing = this.repository.snapshotByFingerprint({ ...input, sourceFingerprint });
    const row = existing ?? this.repository.saveSnapshot({
      snapshotId: this.ids.next(),
      ownerId: input.ownerId,
      bookId: input.bookId,
      treeKind: input.treeKind,
      scopeId: input.scopeId,
      purpose: input.purpose,
      sourceFingerprint,
      compiledContent: {
        schema: 'v7-planning-source-snapshot-v1',
        treeKind: input.treeKind,
        scopeId: input.scopeId,
        purpose: input.purpose,
        sources: sources.map((source) => ({
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          sourceVersion: source.sourceVersion,
          authority: source.authority,
          label: source.label,
          content: source.content,
          includedReason: source.includedReason
        }))
      },
      excludedSources,
      createdAt: now,
      items: sources.map((source, index) => ({
        sourceItemId: this.ids.next(),
        sourceKind: source.sourceKind,
        sourceId: source.sourceId,
        sourceVersion: source.sourceVersion,
        authority: source.authority,
        label: source.label,
        content: source.content,
        contentHash: source.contentHash,
        includedReason: source.includedReason,
        sequence: index + 1
      }))
    });
    return this.toCompiled(row, this.repository.snapshotItems(input.ownerId, input.bookId, row.snapshot_id));
  }

  public require(ownerId: string, bookId: string, snapshotId: string): V7PlanningCompiledSnapshot {
    const row = this.repository.snapshot(ownerId, bookId, snapshotId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '规划资料快照不存在或不属于本书。', {}, false, 404);
    return this.toCompiled(row, this.repository.snapshotItems(ownerId, bookId, snapshotId));
  }

  private requireOpening(ownerId: string, bookId: string): OpeningRow {
    const row = this.repository.formalOpening(ownerId, bookId) as unknown as OpeningRow | undefined;
    if (row === undefined) throw new DomainError(errorCodes.validation, '本书还没有可用于规划的正式开书资料。', {}, false, 409);
    return row;
  }

  private confirmedSettings(ownerId: string, bookId: string): SettingRow[] {
    return this.repository.confirmedSettings(ownerId, bookId) as unknown as SettingRow[];
  }

  private resolveConfirmedParent(
    ownerId: string,
    bookId: string,
    treeKind: PlanningTreeKind,
    scopeId: string
  ): ConfirmedTreeRow | undefined {
    if (treeKind === 'book') return undefined;
    if (treeKind === 'volume') return this.confirmedTree(ownerId, bookId, 'book', bookId);
    const rows = this.repository.confirmedTrees(ownerId, bookId, 'volume') as unknown as ConfirmedTreeRow[];
    return rows.find((row) => documentLinksTo(row.content_json, 'chain', scopeId));
  }

  private confirmedTree(ownerId: string, bookId: string, treeKind: PlanningTreeKind, scopeId: string): ConfirmedTreeRow | undefined {
    return this.repository.confirmedTree(ownerId, bookId, treeKind, scopeId) as unknown as ConfirmedTreeRow | undefined;
  }

  private relevantActuals(
    ownerId: string,
    bookId: string,
    treeKind: PlanningTreeKind,
    scopeId: string,
    parent: ConfirmedTreeRow | undefined
  ): Array<Record<string, unknown> & {
    node_key: string; revision: number; state: string; summary: string; emotion_result: string;
    experience_result: string; outcome: string; source_version_id: string; evidence_refs_json: string;
  }> {
    const scopes = [{ treeKind, scopeId }, ...(parent === undefined ? [] : [{ treeKind: parent.tree_kind, scopeId: parent.scope_id }])];
    const result: ReturnType<V7PlanningSourceCompiler['relevantActuals']> = [];
    for (const scope of scopes) {
      const rows = this.repository.latestNodeActuals(
        ownerId,
        bookId,
        scope.treeKind,
        scope.scopeId
      ) as ReturnType<V7PlanningSourceCompiler['relevantActuals']>;
      result.push(...rows);
    }
    return result;
  }

  private toCompiled(row: V7PlanningSnapshotRow, items: V7PlanningSourceItemRow[]): V7PlanningCompiledSnapshot {
    return {
      snapshotId: row.snapshot_id,
      ownerId: row.owner_id,
      bookId: row.book_id,
      treeKind: row.tree_kind,
      scopeId: row.scope_id,
      purpose: row.purpose,
      sourceFingerprint: row.source_fingerprint,
      sources: items.map((item) => ({
        sourceKind: item.source_kind,
        sourceId: item.source_id,
        sourceVersion: item.source_version,
        authority: item.authority,
        label: item.label,
        content: JSON.parse(item.content_json) as unknown,
        contentHash: item.content_hash,
        includedReason: item.included_reason
      })),
      excludedSources: JSON.parse(row.excluded_sources_json) as string[],
      excludedSourceDecisions: [],
      createdAt: row.created_at
    };
  }
}

/**
 * 规划节点已经由 Agent 完成资料取舍后，这里只把冻结来源和取舍结果
 * 确定性投影成统一追溯结构。旧快照若只有聚合排除说明、没有具体来源
 * 决策，则返回空数组，让统一编译器继续保留聚合载荷快照兼容。
 */
export function planningSnapshotSourceTraces(snapshot: V7PlanningCompiledSnapshot): V7ContextSourceTrace[] {
  const excludedDecisions = snapshot.excludedSourceDecisions ?? [];
  const hasUnstructuredExclusion = snapshot.excludedSources.some((reason) =>
    !excludedDecisions.some((decision) => decision.reason === reason));
  if (snapshot.sources.length === 0 || hasUnstructuredExclusion) return [];
  const included = snapshot.sources.map((source) => ({
    ownerId: snapshot.ownerId,
    bookId: snapshot.bookId,
    sourceKey: planningTraceKey('included', source.sourceKind, source.sourceId, source.sourceVersion),
    sourceType: source.sourceKind,
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    authority: contextAuthority(source.authority),
    decision: 'included' as const,
    reason: source.includedReason,
    contentHash: source.contentHash,
    estimatedTokens: estimateSourceTokens(source.content)
  }));
  const excluded = excludedDecisions.map((source) => ({
    ownerId: snapshot.ownerId,
    bookId: snapshot.bookId,
    sourceKey: planningTraceKey('excluded', source.sourceKind, source.sourceId, source.sourceVersion),
    sourceType: source.sourceKind,
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    authority: contextAuthority(source.authority),
    decision: 'excluded' as const,
    reason: source.reason,
    contentHash: source.contentHash,
    estimatedTokens: 0
  }));
  return [...included, ...excluded];
}

export function requirePlanningScaleProfile(snapshot: V7PlanningCompiledSnapshot): V7PlanningScaleProfile {
  const opening = snapshot.sources.find((source) => source.sourceKind === 'opening');
  if (opening === undefined || typeof opening.content !== 'object' || opening.content === null || Array.isArray(opening.content)) {
    throw missingPlanningScaleProfile();
  }
  return requirePlanningScaleProfileFromOpening(opening.content as Record<string, unknown>);
}

function documentLinksTo(contentJson: string, treeKind: PlanningTreeKind, scopeId: string): boolean {
  const document = jsonObject(contentJson, '确认规划') as unknown as PlanningTreeDocument;
  const stack = [document.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.linkedTree?.treeKind === treeKind && node.linkedTree.scopeId === scopeId) return true;
    stack.push(...node.children);
  }
  return false;
}

function normalizeAuthorGoal(value: string | undefined): string {
  const text = value?.trim() ?? '';
  if (Array.from(text).length > 2_000) throw new DomainError(errorCodes.validation, '本次规划想法最多2000字。');
  return text;
}

function jsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DomainError(errorCodes.validation, `${label}内容不完整。`, {}, false, 409);
  }
  return parsed as Record<string, unknown>;
}

function requirePlanningScaleProfileFromOpening(opening: Record<string, unknown>): V7PlanningScaleProfile {
  const value = opening.planningProfile;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw missingPlanningScaleProfile();
  const profile = value as Record<string, unknown>;
  const publishingPlatform = typeof profile.publishingPlatform === 'string' && profile.publishingPlatform.trim().length > 0
    ? profile.publishingPlatform.trim()
    : 'fanqie';
  const expectedTotalWords = boundedInteger(profile.expectedTotalWords, 100_000, 10_000_000);
  if (expectedTotalWords === null) throw missingPlanningScaleProfile();
  return { publishingPlatform, expectedTotalWords };
}

function planningOpeningProjection(opening: Record<string, unknown>): Record<string, unknown> {
  const { planningProfile: ignoredProfile, targetAudience: ignoredAudience, ...stableOpening } = opening;
  void ignoredProfile;
  void ignoredAudience;
  const profile = (() => {
    try { return requirePlanningScaleProfileFromOpening(opening); }
    catch { return null; }
  })();
  return {
    ...stableOpening,
    ...(profile === null ? {} : { planningProfile: profile })
  };
}

function planningBudgetChars(treeKind: PlanningTreeKind): number {
  if (treeKind === 'book') return 18_000;
  if (treeKind === 'volume') return 14_000;
  return 10_000;
}

function planningLedgerSummary(content: V7CompactSettingLedger['content']): Omit<V7CompactSettingLedger['content'], 'factLedger' | 'itemIndex'> {
  const { factLedger: ignoredFacts, itemIndex: ignoredIndex, ...summary } = content;
  void ignoredFacts;
  void ignoredIndex;
  return summary;
}

function missingPlanningScaleProfile(): DomainError {
  return new DomainError(
    errorCodes.validation,
    '请先到开书资料补全预计总字数，再规划全书。',
    {},
    false,
    409
  );
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum ? Number(value) : null;
}

function planningTraceKey(
  decision: 'included' | 'excluded',
  sourceKind: V7PlanningSnapshotSourceKind,
  sourceId: string,
  sourceVersion: string
): string {
  return `planning:${decision}:${sourceKind}:${sourceId}:${sourceVersion}`;
}

function contextAuthority(authority: V7PlanningSnapshotAuthority): V7ContextSourceTrace['authority'] {
  if (authority === 'goal') return 'author_source';
  if (authority === 'actual') return 'derived';
  return 'confirmed';
}

function estimateSourceTokens(content: unknown): number {
  return Math.max(1, Math.ceil(stableJson(content).length / 4));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
