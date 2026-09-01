import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { V7SettingFinalReviewResult } from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import {
  V7SettingEditorialRepository,
  type V7SettingBatchRow
} from '../../infrastructure/db/repositories/v7-setting-editorial-repository.js';
import {
  confirmedSettingProjection,
  requireUsableSettingProjections,
  type V7ConfirmedSettingProjectionInput,
  type V7SettingContextProjection
} from './v7-setting-context-projection.js';

const MAXIMUM_COMPATIBILITY_ITEMS_WITHOUT_FINAL_REVIEW = 8;
const MAXIMUM_COMPACT_LEDGER_CHARACTERS = 8_000;

export interface V7CompactSettingLedger {
  sourceId: string;
  sourceVersion: string;
  contentHash: string;
  content: {
    schema: 'v7-compact-setting-ledger-v1';
    summary: string;
    groups: Array<{ groupTitle: string; summary: string; itemKeys: string[] }>;
    unifiedDecisions: Array<{ topic: string; decision: string; reason: string }>;
    unresolvedConflicts: Array<{ itemKeys: string[]; problem: string; decision: string; impact: string }>;
    factLedger: Array<{
      itemKey: string;
      label: string;
      versionId: string;
      revision: number;
      facts: string[];
    }>;
    itemIndex: Array<{
      itemKey: string;
      label: string;
      versionId: string;
      revision: number;
      summary: string;
    }>;
  };
  projections: V7SettingContextProjection[];
}

/**
 * Reads the latest chief-authored book-level setting ledger without treating it
 * as canon. The complete confirmed setting versions remain the authority and
 * every index entry keeps its exact version reference for later retrieval.
 */
export class V7SettingLedgerReader {
  private readonly repository: V7SettingEditorialRepository;

  public constructor(database: DatabaseSync) {
    this.repository = new V7SettingEditorialRepository(database);
  }

  public readCurrent(input: {
    ownerId: string;
    bookId: string;
    openingVersion: number;
    settings: readonly V7ConfirmedSettingProjectionInput[];
  }): V7CompactSettingLedger {
    const projections = input.settings.map(confirmedSettingProjection);
    try {
      requireUsableSettingProjections(projections);
    } catch (error) {
      throw gate(error instanceof Error ? error.message : String(error));
    }
    const latest = this.repository.latestFinalReview(input.ownerId, input.bookId);
    if (latest === undefined) return this.compatibilityLedger(input.bookId, projections);
    // A failed or still-unusable whole-book review must not permanently lock a
    // small set of settings that the author has already confirmed.  In that
    // case the confirmed versions remain the authority and the compact
    // compatibility ledger is sufficient.  Large sets still keep the existing
    // review gate so they cannot silently overflow downstream context.
    if (latest.status !== 'awaiting_author' && latest.status !== 'completed') {
      return this.compatibilityLedger(input.bookId, projections);
    }
    let result: V7SettingFinalReviewResult;
    try {
      result = this.currentFinalReviewResult(input, latest, projections);
    } catch (error) {
      if (projections.length <= MAXIMUM_COMPATIBILITY_ITEMS_WITHOUT_FINAL_REVIEW) {
        return this.compatibilityLedger(input.bookId, projections);
      }
      throw error;
    }
    const content: V7CompactSettingLedger['content'] = {
      schema: 'v7-compact-setting-ledger-v1',
      summary: result.contextSummary,
      groups: result.groupSummaries,
      unifiedDecisions: result.unifiedDecisions,
      unresolvedConflicts: result.conflicts,
      factLedger: result.factLedger.map((entry) => {
        const projection = projections.find((candidate) => candidate.itemKey === entry.itemKey);
        if (projection === undefined) throw gate(`设定事实账本引用了不存在的条目“${entry.label}”`);
        return {
          itemKey: entry.itemKey,
          label: entry.label,
          versionId: projection.versionId,
          revision: projection.revision,
          facts: [...entry.facts]
        };
      }),
      // A successful final review already provides the broad semantic map.
      // Item summaries remain separately available as retrieval candidates and
      // are not repeated in every downstream prompt.
      itemIndex: []
    };
    requireCompactLedger(content);
    const resultHash = finalReviewResultHash(latest) ?? latest.request_hash;
    return {
      sourceId: latest.batch_id,
      sourceVersion: resultHash,
      contentHash: sha256(stableJson(content)),
      content,
      projections
    };
  }

  private currentFinalReviewResult(
    input: { ownerId: string; bookId: string; openingVersion: number },
    row: V7SettingBatchRow,
    projections: readonly V7SettingContextProjection[]
  ): V7SettingFinalReviewResult {
    if (row.status !== 'awaiting_author' && row.status !== 'completed') {
      throw gate('当前设定总审还没有完成，请先让主编完成统一整理');
    }
    const latestItemUpdate = this.repository.latestSettingItemUpdatedAt(input.ownerId, input.bookId);
    if (
      row.opening_version !== input.openingVersion
      || latestItemUpdate === null
      || Date.parse(latestItemUpdate) > Date.parse(row.updated_at)
    ) {
      throw gate('开书资料或设定已经更新，请让主编重新统一整理当前版本');
    }
    const parsed = parseStoredFinalReview(row.selected_items_json);
    if (parsed === null) throw gate('当前设定总审结果不完整，请重新统一整理');
    const currentKeys = new Set(projections.map((item) => item.itemKey));
    const ledgerKeys = new Set(parsed.factLedger.map((item) => item.itemKey));
    const groupedKeys = new Set(parsed.groupSummaries.flatMap((item) => item.itemKeys));
    if (
      currentKeys.size !== ledgerKeys.size
      || [...currentKeys].some((key) => !ledgerKeys.has(key) || !groupedKeys.has(key))
    ) {
      throw gate('设定总账没有完整覆盖当前条目，请让主编重新统一整理');
    }
    return parsed;
  }

  private compatibilityLedger(bookId: string, projections: readonly V7SettingContextProjection[]): V7CompactSettingLedger {
    if (projections.length > MAXIMUM_COMPATIBILITY_ITEMS_WITHOUT_FINAL_REVIEW) {
      throw gate('设定条目较多，请先让主编完成一次全书统一整理');
    }
    const content: V7CompactSettingLedger['content'] = {
      schema: 'v7-compact-setting-ledger-v1',
      summary: '当前按已确认设定的逐项轻量索引工作；完整原文仍按条目保存并可回查。',
      groups: [],
      unifiedDecisions: [],
      unresolvedConflicts: [],
      factLedger: projections.map((projection) => ({
        itemKey: projection.itemKey,
        label: projection.label,
        versionId: projection.versionId,
        revision: projection.revision,
        facts: [...projection.factEntries]
      })),
      itemIndex: projections.map((projection) => ({
        itemKey: projection.itemKey,
        label: projection.label,
        versionId: projection.versionId,
        revision: projection.revision,
        summary: projection.contextSummary
      }))
    };
    requireCompactLedger(content);
    const version = sha256(stableJson(projections.map((item) => [item.versionId, item.revision])));
    return {
      sourceId: `setting-ledger:${bookId}`,
      sourceVersion: version,
      contentHash: sha256(stableJson(content)),
      content,
      projections: [...projections]
    };
  }
}

function parseStoredFinalReview(value: string): V7SettingFinalReviewResult | null {
  try {
    const parsed = JSON.parse(value) as { taskKind?: unknown; result?: unknown };
    if (parsed.taskKind !== 'batch_final_review' || !isRecord(parsed.result)) return null;
    const result = parsed.result as unknown as V7SettingFinalReviewResult;
    if (
      typeof result.contextSummary !== 'string'
      || !Array.isArray(result.factLedger)
      || !Array.isArray(result.groupSummaries)
      || !Array.isArray(result.unifiedDecisions)
      || !Array.isArray(result.conflicts)
    ) return null;
    return result;
  } catch {
    return null;
  }
}

function finalReviewResultHash(row: V7SettingBatchRow): string | null {
  try {
    const parsed = JSON.parse(row.selected_items_json) as { resultHash?: unknown };
    return typeof parsed.resultHash === 'string' && parsed.resultHash.length > 0 ? parsed.resultHash : null;
  } catch {
    return null;
  }
}

/**
 * 门禁只校验真正会整体进入规划提示的导航投影字段：
 * schema、summary、groups、unifiedDecisions、unresolvedConflicts。
 * 逐项事实账 factLedger 与条目索引 itemIndex 只作为审计与精确取用来源，
 * 不会作为一个整体注入规划提示，因此不计入门禁，也绝不能被截断、删除或改写。
 */
function requireCompactLedger(content: V7CompactSettingLedger['content']): void {
  const navigationProjection = {
    schema: content.schema,
    summary: content.summary,
    groups: content.groups,
    unifiedDecisions: content.unifiedDecisions,
    unresolvedConflicts: content.unresolvedConflicts
  };
  const characters = Array.from(stableJson(navigationProjection)).length;
  if (characters > MAXIMUM_COMPACT_LEDGER_CHARACTERS) {
    // 导航投影本身确实超限时才安全失败。文案不泄漏内部字符预算，也不要求
    // 作者手工压缩资料；只指向既有恢复动作（在设定编辑部重新发起统一整理）。
    throw gate('设定总账的导航摘要还没有达到规划安全要求，请回到设定编辑部重新发起一次统一整理后再继续');
  }
}

function gate(message: string, details: Record<string, unknown> = {}): DomainError {
  return new DomainError(errorCodes.validation, `对不起，${message}。原设定不会丢失。`, details, true, 409);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
