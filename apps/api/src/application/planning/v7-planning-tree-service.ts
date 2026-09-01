import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  applyPlanningTreeOperations,
  assertValidPlanningTree,
  buildAuthorPlanningTreeView,
  compilePlanningTreeGenerationTask,
  containsNode,
  type AuthorPlanningTreeView,
  type PlanningNodeActual,
  type PlanningTreeDocument,
  type PlanningTreeGenerationTask,
  type PlanningTreeKind,
  type PlanningTreeOperation,
  type PlanningTreeSourceRef
} from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import {
  V7PlanningTreeRepository,
  type V7PlanningTreeVersionRow
} from '../../infrastructure/db/repositories/v7-planning-tree-repository.js';

export interface V7PlanningTreeHistoryItem {
  revision: number;
  status: 'candidate' | 'confirmed' | 'superseded';
  createdAt: string;
  confirmedAt: string | null;
  current: boolean;
}

export class V7PlanningTreeService {
  private readonly repository: V7PlanningTreeRepository;

  public constructor(
    database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.repository = new V7PlanningTreeRepository(database);
  }

  public get(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown): AuthorPlanningTreeView {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = scopeIdOf(scopeIdValue);
    const head = this.repository.head(ownerId, bookId, treeKind, scopeId);
    if (head === undefined) throw missingTree();
    const versionId = head.candidate_version_id ?? head.confirmed_version_id;
    if (versionId === null) throw missingTree();
    const row = this.repository.version(ownerId, bookId, versionId);
    if (row === undefined) throw missingTree();
    return this.view(ownerId, bookId, row, head.revision);
  }

  public getConfirmed(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown): AuthorPlanningTreeView {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = scopeIdOf(scopeIdValue);
    const head = this.repository.head(ownerId, bookId, treeKind, scopeId);
    if (head?.confirmed_version_id === null || head?.confirmed_version_id === undefined) throw missingTree();
    const row = this.repository.version(ownerId, bookId, head.confirmed_version_id);
    if (row === undefined || row.tree_kind !== treeKind || row.scope_id !== scopeId || row.lifecycle !== 'confirmed') throw missingTree();
    return this.view(ownerId, bookId, row, head.revision);
  }

  public history(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown): V7PlanningTreeHistoryItem[] {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = scopeIdOf(scopeIdValue);
    const head = this.repository.head(ownerId, bookId, treeKind, scopeId);
    return this.repository.history(ownerId, bookId, treeKind, scopeId).map((row) => ({
      revision: row.revision,
      status: row.lifecycle,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      current: row.tree_version_id === head?.candidate_version_id || row.tree_version_id === head?.confirmed_version_id
    }));
  }

  public generationTask(input: {
    treeKind: unknown;
    scopeId: unknown;
    sourceRefs: unknown;
    parentDirection?: unknown;
  }): PlanningTreeGenerationTask {
    return compilePlanningTreeGenerationTask({
      treeKind: treeKindOf(input.treeKind),
      scopeId: scopeIdOf(input.scopeId),
      sourceRefs: sourceRefsOf(input.sourceRefs),
      parentDirection: optionalText(input.parentDirection, 2_000)
    });
  }

  public createCandidate(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown, input: {
    expectedRevision?: unknown;
    tree?: unknown;
    sourceRefs?: unknown;
    idempotencyKey?: unknown;
  }): AuthorPlanningTreeView {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = scopeIdOf(scopeIdValue);
    const expectedRevision = revisionOf(input.expectedRevision);
    const document = documentOf(input.tree, treeKind, scopeId);
    const sourceRefs = sourceRefsOf(input.sourceRefs);
    const idempotencyKey = idempotencyKeyOf(input.idempotencyKey);
    const requestHash = hash({ action: 'create_candidate', expectedRevision, document, sourceRefs });
    const repeated = this.repeated(ownerId, bookId, idempotencyKey, requestHash);
    if (repeated) return this.get(ownerId, bookId, treeKind, scopeId);
    const saved = this.repository.saveCandidate({
      actionId: this.ids.next(), versionId: this.ids.next(), ownerId, bookId, treeKind, scopeId,
      expectedRevision, document, contentHash: hash(document), sourceRefs, createdBy: 'author_or_planning_agent',
      actionKind: 'create_candidate', idempotencyKey, requestHash, now: this.clock.now().toISOString()
    });
    if (saved === null) throw versionConflict();
    return this.get(ownerId, bookId, treeKind, scopeId);
  }

  public saveGeneratedCandidate(input: {
    ownerId: string;
    bookId: string;
    treeKind: PlanningTreeKind;
    scopeId: string;
    expectedRevision: number;
    document: PlanningTreeDocument;
    sourceRefs: PlanningTreeSourceRef[];
    idempotencyKey: string;
    createdBy: string;
  }): { versionId: string; view: AuthorPlanningTreeView } {
    const document = documentOf(input.document, input.treeKind, input.scopeId);
    const requestHash = hash({
      action: 'create_candidate', expectedRevision: input.expectedRevision,
      document, sourceRefs: input.sourceRefs, createdBy: input.createdBy
    });
    const prior = this.repository.action(input.ownerId, input.bookId, input.idempotencyKey);
    if (prior !== undefined) {
      if (prior.request_hash !== requestHash) {
        throw new DomainError(errorCodes.validation, '本次生成编号已经用于另一棵规划树。', {}, false, 409);
      }
      const result = JSON.parse(prior.result_json) as { versionId: string };
      return { versionId: result.versionId, view: this.get(input.ownerId, input.bookId, input.treeKind, input.scopeId) };
    }
    const saved = this.repository.saveCandidate({
      actionId: this.ids.next(), versionId: this.ids.next(), ownerId: input.ownerId, bookId: input.bookId,
      treeKind: input.treeKind, scopeId: input.scopeId, expectedRevision: input.expectedRevision,
      document, contentHash: hash(document), sourceRefs: input.sourceRefs, createdBy: input.createdBy,
      actionKind: 'create_candidate', idempotencyKey: input.idempotencyKey, requestHash,
      now: this.clock.now().toISOString()
    });
    if (saved === null) throw versionConflict('上层资料或当前规划已经变化，请重新生成。');
    return { versionId: saved.versionId, view: this.get(input.ownerId, input.bookId, input.treeKind, input.scopeId) };
  }

  public reviseCandidate(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown, input: {
    expectedRevision?: unknown;
    operations?: unknown;
    sourceRefs?: unknown;
    idempotencyKey?: unknown;
  }): AuthorPlanningTreeView {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = scopeIdOf(scopeIdValue);
    const expectedRevision = revisionOf(input.expectedRevision);
    const operations = operationsOf(input.operations);
    const sourceRefs = sourceRefsOf(input.sourceRefs);
    const idempotencyKey = idempotencyKeyOf(input.idempotencyKey);
    const requestHash = hash({ action: 'revise_candidate', expectedRevision, operations, sourceRefs });
    const repeated = this.repeated(ownerId, bookId, idempotencyKey, requestHash);
    if (repeated) return this.get(ownerId, bookId, treeKind, scopeId);
    const head = this.repository.head(ownerId, bookId, treeKind, scopeId);
    if (head === undefined || head.revision !== expectedRevision) throw versionConflict();
    const sourceVersionId = head.candidate_version_id ?? head.confirmed_version_id;
    if (sourceVersionId === null) throw missingTree();
    const sourceVersion = this.repository.version(ownerId, bookId, sourceVersionId);
    if (sourceVersion === undefined) throw missingTree();
    const document = applyOperations(documentFrom(sourceVersion), operations);
    const saved = this.repository.saveCandidate({
      actionId: this.ids.next(), versionId: this.ids.next(), ownerId, bookId, treeKind, scopeId,
      expectedRevision, document, contentHash: hash(document), sourceRefs, createdBy: 'author_or_planning_agent',
      actionKind: 'revise_candidate', idempotencyKey, requestHash, now: this.clock.now().toISOString()
    });
    if (saved === null) throw versionConflict();
    return this.get(ownerId, bookId, treeKind, scopeId);
  }

  public confirmCandidate(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown, input: {
    expectedRevision?: unknown;
    idempotencyKey?: unknown;
  }): AuthorPlanningTreeView {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = scopeIdOf(scopeIdValue);
    const expectedRevision = revisionOf(input.expectedRevision);
    const idempotencyKey = idempotencyKeyOf(input.idempotencyKey);
    const requestHash = hash({ action: 'confirm_candidate', expectedRevision, treeKind, scopeId });
    const repeated = this.repeated(ownerId, bookId, idempotencyKey, requestHash);
    if (repeated) return this.get(ownerId, bookId, treeKind, scopeId);
    const saved = this.repository.confirmCandidate({
      actionId: this.ids.next(), ownerId, bookId, treeKind, scopeId, expectedRevision,
      idempotencyKey, requestHash, now: this.clock.now().toISOString()
    });
    if (saved === null) throw versionConflict('当前没有可确认的新版规划，或页面已经过期。');
    return this.get(ownerId, bookId, treeKind, scopeId);
  }

  /**
   * 只供可信结算流程调用。作者端没有直写“实际结果”的接口，避免计划、推断或手工输入污染正史。
   */
  public recordActual(ownerId: string, bookId: string, treeKindValue: unknown, scopeIdValue: unknown, input: {
    actual?: unknown;
    idempotencyKey?: unknown;
  }): PlanningNodeActual {
    const treeKind = treeKindOf(treeKindValue);
    const scopeId = scopeIdOf(scopeIdValue);
    const actual = actualOf(input.actual);
    const idempotencyKey = idempotencyKeyOf(input.idempotencyKey);
    const requestHash = hash({ action: 'record_actual', treeKind, scopeId, actual });
    if (this.repeated(ownerId, bookId, idempotencyKey, requestHash)) {
      const existing = this.repository.actualBySource({
        ownerId, bookId, treeKind, scopeId, nodeKey: actual.nodeKey,
        sourceKind: actual.sourceKind, sourceVersionId: actual.sourceVersionId
      });
      if (existing !== undefined) return existing;
    }
    const sameSettlement = this.repository.actualBySource({
      ownerId, bookId, treeKind, scopeId, nodeKey: actual.nodeKey,
      sourceKind: actual.sourceKind, sourceVersionId: actual.sourceVersionId
    });
    if (sameSettlement !== undefined) {
      if (hash(sameSettlement) === hash(actual)) return sameSettlement;
      throw new DomainError(
        errorCodes.planningTreeVersionConflict,
        '这份正文结算已经记录过不同结果，请先核对结算版本。',
        {}, false, 409
      );
    }
    const head = this.repository.head(ownerId, bookId, treeKind, scopeId);
    if (head?.confirmed_version_id === null || head?.confirmed_version_id === undefined) {
      throw new DomainError(errorCodes.validation, '只有作者确认过的规划才能接收正文结算。', {}, false, 409);
    }
    const confirmed = this.repository.version(ownerId, bookId, head.confirmed_version_id);
    if (confirmed === undefined || !containsNode(documentFrom(confirmed).root, actual.nodeKey)) {
      throw new DomainError(errorCodes.validation, '结算对应的规划节点不存在。', {}, false, 404);
    }
    return this.repository.saveActual({
      actionId: this.ids.next(), actualId: this.ids.next(), ownerId, bookId, treeKind, scopeId,
      actual, idempotencyKey, requestHash
    });
  }

  private repeated(ownerId: string, bookId: string, idempotencyKey: string, requestHash: string): boolean {
    const action = this.repository.action(ownerId, bookId, idempotencyKey);
    if (action === undefined) return false;
    if (action.request_hash !== requestHash) {
      throw new DomainError(errorCodes.validation, '本次操作编号已经用于另一项修改，请重新操作。', {}, false, 409);
    }
    return true;
  }

  private view(ownerId: string, bookId: string, row: V7PlanningTreeVersionRow, headRevision: number): AuthorPlanningTreeView {
    return buildAuthorPlanningTreeView({
      document: documentFrom(row),
      revision: headRevision,
      status: row.lifecycle === 'confirmed' ? 'confirmed' : 'candidate',
      actuals: this.repository.latestActuals(ownerId, bookId, row.tree_kind, row.scope_id)
    });
  }
}

function documentFrom(row: V7PlanningTreeVersionRow): PlanningTreeDocument {
  return documentOf(JSON.parse(row.content_json), row.tree_kind, row.scope_id);
}

function documentOf(value: unknown, treeKind: PlanningTreeKind, scopeId: string): PlanningTreeDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid('规划树内容不完整。');
  const document = structuredClone(value) as PlanningTreeDocument;
  if (document.treeKind !== treeKind || document.scopeId !== scopeId) throw invalid('规划树层级或范围与当前页面不一致。');
  try {
    assertValidPlanningTree(document);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : '规划树内容不完整。');
  }
  return document;
}

function applyOperations(document: PlanningTreeDocument, operations: PlanningTreeOperation[]): PlanningTreeDocument {
  try {
    return applyPlanningTreeOperations(document, operations);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : '规划修改无效。');
  }
}

function treeKindOf(value: unknown): PlanningTreeKind {
  if (value === 'book' || value === 'volume' || value === 'chain') return value;
  throw invalid('规划树类型无效。');
}

function scopeIdOf(value: unknown): string {
  return requiredText(value, '规划范围', 1, 128, /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u);
}

function revisionOf(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw invalid('页面版本无效，请刷新后重试。');
  return Number(value);
}

function idempotencyKeyOf(value: unknown): string {
  return requiredText(value, '操作编号', 8, 128, /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/u);
}

function sourceRefsOf(value: unknown): PlanningTreeSourceRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) throw invalid('规划资料来源不完整。');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw invalid('规划资料来源无效。');
    const source = item as Partial<PlanningTreeSourceRef>;
    if (!['opening', 'setting', 'author_goal', 'confirmed_tree', 'settlement'].includes(String(source.sourceKind))) {
      throw invalid('规划资料来源类型无效。');
    }
    return {
      sourceKind: source.sourceKind as PlanningTreeSourceRef['sourceKind'],
      sourceId: requiredText(source.sourceId, '资料标识', 1, 160),
      version: requiredText(source.version, '资料版本', 1, 160)
    };
  });
}

function operationsOf(value: unknown): PlanningTreeOperation[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw invalid('请至少提交一项规划修改。');
  return structuredClone(value) as PlanningTreeOperation[];
}

function actualOf(value: unknown): PlanningNodeActual {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid('正文结算内容不完整。');
  const source = value as Partial<PlanningNodeActual>;
  if (!['partial', 'completed', 'deviated'].includes(String(source.state))) throw invalid('正文结算状态无效。');
  if (!['chapter_settlement', 'event_settlement', 'volume_settlement'].includes(String(source.sourceKind))) {
    throw invalid('正文结算来源无效。');
  }
  if (!Array.isArray(source.evidenceRefs) || source.evidenceRefs.length === 0 || source.evidenceRefs.length > 200) {
    throw invalid('正文结算必须带有可核查的正文证据。');
  }
  return {
    nodeKey: requiredText(source.nodeKey, '规划节点', 1, 128),
    state: source.state as PlanningNodeActual['state'],
    summary: requiredText(source.summary, '实际进展', 1, 2_000),
    emotionResult: requiredText(source.emotionResult, '实际情绪结果', 1, 1_000),
    experienceResult: requiredText(source.experienceResult, '实际阅读体验', 1, 1_000),
    outcome: requiredText(source.outcome, '实际结果', 1, 2_000),
    sourceKind: source.sourceKind as PlanningNodeActual['sourceKind'],
    sourceVersionId: requiredText(source.sourceVersionId, '结算版本', 1, 160),
    evidenceRefs: source.evidenceRefs.map((item) => requiredText(item, '正文证据', 1, 240)),
    recordedAt: requiredIsoDate(source.recordedAt)
  };
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, '上层方向', 1, max);
}

function requiredIsoDate(value: unknown): string {
  const text = requiredText(value, '记录时间', 1, 80);
  if (Number.isNaN(Date.parse(text))) throw invalid('记录时间无效。');
  return text;
}

function requiredText(value: unknown, label: string, min: number, max: number, pattern?: RegExp): string {
  if (typeof value !== 'string') throw invalid(`${label}无效。`);
  const text = value.trim();
  const length = Array.from(text).length;
  if (length < min || length > max || (pattern !== undefined && !pattern.test(text))) throw invalid(`${label}无效。`);
  return text;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function invalid(message: string): DomainError {
  return new DomainError(errorCodes.validation, message);
}

function missingTree(): DomainError {
  return new DomainError(errorCodes.validation, '这棵规划树还没有开始设计。', {}, false, 404);
}

function versionConflict(message = '页面内容已经更新，请刷新后再修改。'): DomainError {
  return new DomainError(errorCodes.planningTreeVersionConflict, message, {}, true, 409);
}
