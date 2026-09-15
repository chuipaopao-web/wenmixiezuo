import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Scope} from '@wenmi/time-machine-core';
import {DomainError,errorCodes} from '../../domain/errors.js';
import {parseStorylineSelectionContent,validateStorylineSelection,type StorylineSelectionInput} from './storyline-selection.js';
import type {StorylineSelectionSnapshot} from './time-machine-sources.js';
import {StorylineSelectionRepository} from '../../infrastructure/db/repositories/storyline-selection-repository.js';
import {StorylineMaterialRepository,type StorylineMaterialRow} from '../../infrastructure/db/repositories/storyline-material-repository.js';

/** S1-A阶段二（TIMEMACHINE_STORY_DESIGN第25节）：故事线资料正式版本的展示、作者编辑与失效。
 * 边界：保存只建立新版本与失效事实，不触发推荐任务、不启动重生成、不额外收费；
 * 失效标记只由作者编辑保存产生，正常确认选择流程行为不变。 */

export interface StorylineMaterialContent {
  recommendationRunId: string;
  recommendationHash: string;
  preparationVersion: string;
  selectedLineIds: string[];
  addedLines: {title: string; description: string}[];
  shape: 'auto' | 'single' | 'multiple';
  ensemble: boolean;
  authorNote: string;
}

export interface StorylineMaterialProjection {
  revision: number;
  content: StorylineMaterialContent;
  createdBy: 'selection-confirm' | 'author-edit';
  createdAt: string;
  versions: {revision: number; contentHash: string; createdBy: string; createdAt: string}[];
  draft: {content: unknown; baseRevision: number; updatedAt: string} | null;
}

export interface StorylineMaterialPreview {
  currentRevision: number;
  unchanged: boolean;
  affectedBaseline: boolean;
  affectedRuns: {id: string; scheme: string | null; roundKey: string | null; state: string; alreadyMarked: boolean}[];
  affectedInFlight: number;
  /** 卷/链/章规划在本阶段尚未创建：如实标记，不编造数量（第25.2节）。 */
  downstream: {volumes: 'not-created'; chains: 'not-created'; chapters: 'not-created'};
}

function bad(message: string, status = 400): DomainError {
  return new DomainError(errorCodes.validation, message, {}, true, status);
}

function toContent(snapshot: StorylineSelectionSnapshot): StorylineMaterialContent {
  return {recommendationRunId: snapshot.recommendationRunId, recommendationHash: snapshot.recommendationHash, preparationVersion: snapshot.preparationVersion, selectedLineIds: snapshot.selectedLineIds, addedLines: snapshot.addedLines, shape: snapshot.shape, ensemble: snapshot.ensemble, authorNote: snapshot.authorNote};
}

export class TimeMachineStorylineMaterialService {
  private readonly materials: StorylineMaterialRepository;
  private readonly selections: StorylineSelectionRepository;
  constructor(private readonly db: DatabaseSync) {
    this.materials = new StorylineMaterialRepository(db);
    this.selections = new StorylineSelectionRepository(db);
  }

  /** GET state投影：当前版本内容/来源/版本列表/草稿；未确认过故事线的书为null，不编造内容。 */
  current(scope: Scope): StorylineMaterialProjection | null {
    const row = this.materials.current(scope.ownerId, scope.bookId);
    if (!row) return null;
    let snapshot: StorylineSelectionSnapshot;
    try { snapshot = JSON.parse(row.content_json) as StorylineSelectionSnapshot; } catch { return null; }
    const draftRow = this.materials.getDraft(scope.ownerId, scope.bookId);
    let draft: StorylineMaterialProjection['draft'] = null;
    if (draftRow) {
      try { draft = {content: JSON.parse(draftRow.content_json), baseRevision: draftRow.base_revision, updatedAt: draftRow.updated_at}; } catch { draft = null; }
    }
    return {
      revision: row.revision,
      content: toContent(snapshot),
      createdBy: row.created_by,
      createdAt: row.created_at,
      versions: this.materials.listVersions(scope.ownerId, scope.bookId).map(v => ({revision: v.revision, contentHash: v.content_hash, createdBy: v.created_by, createdAt: v.created_at})),
      draft
    };
  }

  /** startDesignRound既有事务内调用：当前无材料或材料内容哈希与本次确认不同，则先写入新材料版本再建轮；
   * 内容相同不新建版本、不触发失效。Caller owns the transaction。 */
  ensureFromSelection(scope: Scope, selectionSnapshot: StorylineSelectionSnapshot, operationKey: string): void {
    const current = this.materials.current(scope.ownerId, scope.bookId);
    if (current && current.content_hash === selectionSnapshot.requestHash) return;
    this.materials.insert(scope.ownerId, scope.bookId, {
      id: randomUUID(),
      revision: (current?.revision ?? 0) + 1,
      contentJson: JSON.stringify(selectionSnapshot),
      contentHash: selectionSnapshot.requestHash,
      createdBy: 'selection-confirm',
      idempotencyKey: `selection-confirm:${operationKey}`,
      createdAt: new Date().toISOString()
    });
  }

  private validateContent(scope: Scope, rawContent: unknown, preparationVersion: string | null, manifestSignature: string): StorylineSelectionSnapshot {
    const input: StorylineSelectionInput = parseStorylineSelectionContent(rawContent);
    // 与确认选择同级校验：来源推荐必须仍有效（第25.2节）
    return validateStorylineSelection(this.selections, scope, input, preparationVersion, manifestSignature).selectionSnapshot;
  }

  private buildPreview(scope: Scope, targetHash: string, currentRevision: number): StorylineMaterialPreview {
    const staleRuns = this.materials.listStaleRuns(scope.ownerId, scope.bookId, targetHash);
    const adoptedCandidate = this.materials.adoptedCandidateId(scope.ownerId, scope.bookId);
    const affectedBaseline = adoptedCandidate !== undefined && staleRuns.some(run => run.id === adoptedCandidate);
    return {
      currentRevision,
      unchanged: false,
      affectedBaseline,
      affectedRuns: staleRuns.map(run => ({id: run.id, scheme: run.scheme, roundKey: run.round_key, state: run.state, alreadyMarked: Number(run.needs_redesign) === 1})),
      affectedInFlight: staleRuns.filter(run => run.state === 'queued' || run.state === 'working').length,
      downstream: {volumes: 'not-created', chains: 'not-created', chapters: 'not-created'}
    };
  }

  /** 影响预览：返回依赖旧资料的全书基线、各设计轮（含在途数量与状态）及卷/链/章（尚未创建）的真实清单。 */
  preview(scope: Scope, rawContent: unknown, expectedRevision: unknown, preparationVersion: string | null, manifestSignature: string): StorylineMaterialPreview & {revisionMatch: boolean} {
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw bad('修订参数不正确');
    const snapshot = this.validateContent(scope, rawContent, preparationVersion, manifestSignature);
    const current = this.materials.current(scope.ownerId, scope.bookId);
    const currentRevision = current?.revision ?? 0;
    if (current && current.content_hash === snapshot.requestHash) {
      return {...this.buildPreview(scope, snapshot.requestHash, currentRevision), unchanged: true, affectedBaseline: false, affectedRuns: [], affectedInFlight: 0, revisionMatch: currentRevision === expectedRevision};
    }
    return {...this.buildPreview(scope, snapshot.requestHash, currentRevision), revisionMatch: currentRevision === expectedRevision};
  }

  /** 作者编辑保存：CAS+幂等+同事务失效标记。只建立新版本与失效事实。 */
  save(scope: Scope, rawContent: unknown, expectedRevision: unknown, idempotencyKey: unknown, preparationVersion: string | null, manifestSignature: string): {projection: StorylineMaterialProjection; markedRuns: number; unchanged: boolean; replayed: boolean} {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 160) throw bad('操作编号无效');
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw bad('修订参数不正确');
    const snapshot = this.validateContent(scope, rawContent, preparationVersion, manifestSignature);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.materials.findByIdempotencyKey(scope.ownerId, scope.bookId, idempotencyKey);
      if (prior) {
        if (prior.content_hash !== snapshot.requestHash) throw bad('同一操作编号已对应其他修改，请刷新页面后重新保存', 409);
        const projection = this.current(scope)!;
        this.db.exec('COMMIT');
        return {projection, markedRuns: 0, unchanged: false, replayed: true};
      }
      const current = this.materials.current(scope.ownerId, scope.bookId);
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== (expectedRevision as number)) {
        // CAS失败：409并返回新预览，不按旧预览直接写（第25.2节）
        throw new DomainError(errorCodes.validation,'故事线资料版本已变化，请重新核对影响后再保存',{preview:{...this.buildPreview(scope,snapshot.requestHash,currentRevision),revisionMatch:false}},true,409);
      }
      if (current && current.content_hash === snapshot.requestHash) {
        const projection = this.current(scope)!;
        this.db.exec('COMMIT');
        return {projection, markedRuns: 0, unchanged: true, replayed: false};
      }
      const now = new Date().toISOString();
      const row: StorylineMaterialRow = {id: randomUUID(), revision: currentRevision + 1, content_json: JSON.stringify(snapshot), content_hash: snapshot.requestHash, created_by: 'author-edit', created_at: now};
      this.materials.insert(scope.ownerId, scope.bookId, {id: row.id, revision: row.revision, contentJson: row.content_json, contentHash: row.content_hash, createdBy: row.created_by, idempotencyKey, createdAt: now});
      // 同事务失效：所有选择哈希≠新内容哈希的设计轮标记为需重新设计（第25.2节）
      const markedRuns = this.materials.markStaleRuns(scope.ownerId, scope.bookId, snapshot.requestHash, now);
      // 保存生效后草稿已被新正式版本取代，避免旧草稿误导后续编辑
      this.materials.upsertDraft(scope.ownerId, scope.bookId, row.content_json, row.revision, now);
      const projection = this.current(scope)!;
      this.db.exec('COMMIT');
      return {projection, markedRuns, unchanged: false, replayed: false};
    } catch (e) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** 保存草稿：覆盖式，不失效任何后续（第25.2节）。 */
  saveDraft(scope: Scope, rawContent: unknown, baseRevision: unknown): {baseRevision: number; updatedAt: string} {
    if (!Number.isSafeInteger(baseRevision) || (baseRevision as number) < 0) throw bad('修订参数不正确');
    // 草稿只校验基本结构（与正式保存同一解析），不校验推荐来源——草稿可在推荐过期后暂存
    const input = parseStorylineSelectionContent(rawContent);
    const updatedAt = new Date().toISOString();
    this.materials.upsertDraft(scope.ownerId, scope.bookId, JSON.stringify(input), baseRevision as number, updatedAt);
    return {baseRevision: baseRevision as number, updatedAt};
  }
}
