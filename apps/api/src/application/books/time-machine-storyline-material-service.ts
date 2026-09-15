import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {Scope} from '@wenmi/time-machine-core';
import {SqlPlanRepository,digest} from '@wenmi/time-machine-core';
import {DomainError,errorCodes} from '../../domain/errors.js';
import {parseStorylineSelectionContent,validateStorylineSelection,type StorylineMaterialLine,type StorylineSelectionInput} from './storyline-selection.js';
import type {StorylineSelectionSnapshot} from './time-machine-sources.js';
import {StorylineSelectionRepository} from '../../infrastructure/db/repositories/storyline-selection-repository.js';
import {StorylineMaterialRepository,type StorylineMaterialRow} from '../../infrastructure/db/repositories/storyline-material-repository.js';

/** S1-A阶段二（TIMEMACHINE_STORY_DESIGN第25节）：故事线资料正式版本的展示、作者编辑与失效。
 * 边界：保存只建立新版本与失效事实，不触发推荐任务、不启动重生成、不额外收费；
 * 失效标记只由作者编辑保存产生，正常确认选择流程行为不变。
 * 72c3a62f复核后修正：
 *  - 材料自含勾选线正文（标题/描述作者可编辑、lineId稳定、role取推荐），展示/编辑不依赖state最新12轮仍含原推荐；
 *  - 版本权威：材料存在后startDesignRound只允许按expectedMaterialRevision读取当前正式正文，旧选择不得静默插为最新材料；
 *  - 影响预览带版本签名（待保存内容hash/材料revision/源版本/采用与下游修订/依赖集合），保存事务内重算匹配才写。 */

export interface StorylineMaterialContent {
  recommendationRunId: string;
  recommendationHash: string;
  preparationVersion: string;
  selectedLineIds: string[];
  selectedLines: StorylineMaterialLine[];
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
  /** 版本签名：待保存内容hash+材料revision+源版本+采用/下游修订+依赖集合；保存事务内重算匹配才写。 */
  signature: string;
  affectedBaseline: boolean;
  affectedRuns: {id: string; scheme: string | null; roundKey: string | null; state: string; alreadyMarked: boolean}[];
  affectedInFlight: number;
  /** 全书方案卷概要是真实受影响对象（已采用时给真实数量）；独立卷/链/章规划本阶段尚未创建：如实标记（72c3a62f复核第4项）。 */
  downstream: {volumeOutlines: number; volumes: 'not-created'; chains: 'not-created'; chapters: 'not-created'};
}

function bad(message: string, status = 400): DomainError {
  return new DomainError(errorCodes.validation, message, {}, true, status);
}

function toContent(snapshot: StorylineSelectionSnapshot, backfill: StorylineMaterialLine[] | null): StorylineMaterialContent {
  return {recommendationRunId: snapshot.recommendationRunId, recommendationHash: snapshot.recommendationHash, preparationVersion: snapshot.preparationVersion, selectedLineIds: snapshot.selectedLineIds, selectedLines: snapshot.selectedLines ?? backfill ?? [], addedLines: snapshot.addedLines, shape: snapshot.shape, ensemble: snapshot.ensemble, authorNote: snapshot.authorNote};
}

export class TimeMachineStorylineMaterialService {
  private readonly materials: StorylineMaterialRepository;
  private readonly selections: StorylineSelectionRepository;
  constructor(private readonly db: DatabaseSync) {
    this.materials = new StorylineMaterialRepository(db);
    this.selections = new StorylineSelectionRepository(db);
  }

  /** 旧版本材料行（无selectedLines）从原推荐回填正文；推荐已不可解析时返回null，页面如实提示而不伪造内容。 */
  private backfillLines(scope: Scope, snapshot: StorylineSelectionSnapshot): StorylineMaterialLine[] | null {
    const row = this.selections.findRecommendationRun(snapshot.recommendationRunId);
    if (!row || row.owner_id !== scope.ownerId || row.book_id !== scope.bookId || row.result_json === null) return null;
    try {
      const parsed = JSON.parse(row.result_json) as {lines?: unknown};
      if (!Array.isArray(parsed.lines)) return null;
      const known = new Map<string, StorylineMaterialLine>();
      for (const entry of parsed.lines) {
        const line = entry as Record<string, unknown>;
        if (typeof line.id === 'string' && typeof line.title === 'string' && typeof line.description === 'string' && ['main', 'through', 'stage'].includes(String(line.role))) known.set(line.id, {id: line.id, role: line.role as StorylineMaterialLine['role'], title: line.title, description: line.description});
      }
      const resolved: StorylineMaterialLine[] = [];
      for (const id of snapshot.selectedLineIds) {
        const line = known.get(id);
        if (!line) return null;
        resolved.push(line);
      }
      return resolved;
    } catch { return null; }
  }

  /** 材料当前行（设计入口版本权威用；不解析内容）。 */
  currentRow(scope: Scope): StorylineMaterialRow | undefined {
    return this.materials.current(scope.ownerId, scope.bookId);
  }

  /** GET state投影：当前版本内容/来源/版本列表/草稿；未确认过故事线的书为null，不编造内容。 */
  current(scope: Scope): StorylineMaterialProjection | null {
    const row = this.materials.current(scope.ownerId, scope.bookId);
    if (!row) return null;
    let snapshot: StorylineSelectionSnapshot;
    try { snapshot = JSON.parse(row.content_json) as StorylineSelectionSnapshot; } catch { return null; }
    const backfill = snapshot.selectedLines === undefined ? this.backfillLines(scope, snapshot) : null;
    const draftRow = this.materials.getDraft(scope.ownerId, scope.bookId);
    let draft: StorylineMaterialProjection['draft'] = null;
    if (draftRow) {
      try { draft = {content: JSON.parse(draftRow.content_json), baseRevision: draftRow.base_revision, updatedAt: draftRow.updated_at}; } catch { draft = null; }
    }
    return {
      revision: row.revision,
      content: toContent(snapshot, backfill),
      createdBy: row.created_by,
      createdAt: row.created_at,
      versions: this.materials.listVersions(scope.ownerId, scope.bookId).map(v => ({revision: v.revision, contentHash: v.content_hash, createdBy: v.created_by, createdAt: v.created_at})),
      draft
    };
  }

  /** startDesignRound既有事务内调用（仅初次确认建v1）：当前无材料则写入v1；
   * 材料已存在时内容相同放过、不同=版本权威违例（72c3a62f复核第2项：旧选择不得静默插为最新材料）。Caller owns the transaction。 */
  ensureFromSelection(scope: Scope, selectionSnapshot: StorylineSelectionSnapshot, operationKey: string): void {
    const current = this.materials.current(scope.ownerId, scope.bookId);
    if (current) {
      if (current.content_hash === selectionSnapshot.requestHash) return;
      throw new DomainError(errorCodes.validation, '故事线资料已存在且内容不同：请先保存修改并确认影响，再开始设计', {currentRevision: current.revision}, true, 409);
    }
    this.materials.insert(scope.ownerId, scope.bookId, {
      id: randomUUID(),
      revision: 1,
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

  private buildPreview(scope: Scope, targetHash: string, currentRevision: number, facts: {preparationVersion: string; manifestSignature: string}): StorylineMaterialPreview {
    const staleRuns = this.materials.listStaleRuns(scope.ownerId, scope.bookId, targetHash);
    const adopted = this.materials.adoptedCandidate(scope.ownerId, scope.bookId);
    const affectedBaseline = adopted !== undefined && staleRuns.some(run => run.id === adopted.candidate);
    // 全书方案卷概要=真实受影响对象（已采用时给真实数量）；独立卷/链/章规划本阶段未实现，如实标记
    let volumeOutlines = 0;
    let planRevision = 0;
    if (adopted !== undefined) {
      try {
        const plans = new SqlPlanRepository(this.db);
        planRevision = plans.state(scope).revision;
        volumeOutlines = plans.activePlan(scope)?.candidate.plan.volumes.length ?? 0;
      } catch { volumeOutlines = 0; planRevision = 0; }
    }
    const adoptionNeedsRedesign = adopted !== undefined && this.materials.runNeedsRedesign(scope.ownerId, scope.bookId, adopted.candidate);
    const downstream: StorylineMaterialPreview['downstream'] = {volumeOutlines, volumes: 'not-created', chains: 'not-created', chapters: 'not-created'};
    const affectedRuns = staleRuns.map(run => ({id: run.id, scheme: run.scheme, roundKey: run.round_key, state: run.state, alreadyMarked: Number(run.needs_redesign) === 1}));
    const signature = digest(JSON.stringify({
      targetHash,
      currentRevision,
      source: [facts.preparationVersion, facts.manifestSignature],
      adoption: adopted === undefined ? null : {candidate: adopted.candidate, candidateRevision: adopted.candidateRevision, adoptionRevision: adopted.adoptionRevision, planRevision, needsRedesign: adoptionNeedsRedesign},
      affectedRuns: affectedRuns.map(run => [run.id, run.state, run.alreadyMarked]),
      downstream
    }));
    return {
      currentRevision,
      unchanged: false,
      signature,
      affectedBaseline,
      affectedRuns,
      affectedInFlight: staleRuns.filter(run => run.state === 'queued' || run.state === 'working').length,
      downstream
    };
  }

  /** 影响预览：返回依赖旧资料的全书基线、各设计轮（含在途数量与状态）、卷概要真实数量及卷/链/章（尚未创建）的清单+版本签名。 */
  preview(scope: Scope, rawContent: unknown, expectedRevision: unknown, preparationVersion: string | null, manifestSignature: string): StorylineMaterialPreview & {revisionMatch: boolean} {
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw bad('修订参数不正确');
    const snapshot = this.validateContent(scope, rawContent, preparationVersion, manifestSignature);
    const facts = {preparationVersion: preparationVersion!, manifestSignature};
    const current = this.materials.current(scope.ownerId, scope.bookId);
    const currentRevision = current?.revision ?? 0;
    if (current && current.content_hash === snapshot.requestHash) {
      return {...this.buildPreview(scope, snapshot.requestHash, currentRevision, facts), unchanged: true, affectedBaseline: false, affectedRuns: [], affectedInFlight: 0, revisionMatch: currentRevision === expectedRevision};
    }
    return {...this.buildPreview(scope, snapshot.requestHash, currentRevision, facts), revisionMatch: currentRevision === expectedRevision};
  }

  /** 作者编辑保存：CAS+预览签名重算+幂等+同事务失效标记。只建立新版本与失效事实。 */
  save(scope: Scope, rawContent: unknown, expectedRevision: unknown, idempotencyKey: unknown, previewSignature: unknown, preparationVersion: string | null, manifestSignature: string): {projection: StorylineMaterialProjection; markedRuns: number; unchanged: boolean; replayed: boolean} {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 160) throw bad('操作编号无效');
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw bad('修订参数不正确');
    if (typeof previewSignature !== 'string' || !previewSignature.trim() || previewSignature.length > 200) throw bad('请先查看影响预览，再确认保存');
    const facts = {preparationVersion: preparationVersion!, manifestSignature};
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
        throw new DomainError(errorCodes.validation,'故事线资料版本已变化，请重新核对影响后再保存',{preview:{...this.buildPreview(scope,snapshot.requestHash,currentRevision,facts),revisionMatch:false}},true,409);
      }
      // 预览签名事务内重算：预览后材料/来源/下游任一变化都拒绝并返回新预览（72c3a62f复核第3项），不依靠前端遮罩
      const fresh = this.buildPreview(scope, snapshot.requestHash, currentRevision, facts);
      if (fresh.signature !== previewSignature) {
        throw new DomainError(errorCodes.validation,'影响预览已变化，请重新核对后再保存',{preview:{...fresh,revisionMatch:true}},true,409);
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
