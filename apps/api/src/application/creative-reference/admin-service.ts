/**
 * R209-B2管理端应用服务（二次返修）：
 * - 全部管理写入在同步事务工作单元内完成（状态+意见+审计+发布请求同事务，任一步失败整体回滚）；
 * - 依赖窄端口（本文件声明的Data/Audit端口），由SQLite适配器注入，应用层不反向依赖基础设施具体类；
 * - 每个写入口都做应用层授权校验（管理者角色+非空actor+授权端口），不依赖HTTP层单点检查，
 *   任意actor字符串本身不能写库。
 */
import { AuthorizationError, ConflictError, NotFoundError } from './errors.js';
import type {
  CreateCardInput, CreativeReferenceTransactionUnit, PublishReleaseInput, ReviewInput, UpdateCardInput
} from './repository.js';
import type { CardAvailability, CardPayload, CardRecord, LegacyRef, ReleaseSnapshot, RelationType, RevisionRecord } from './types.js';

/** 管理写入所需的数据端口：B1领域操作的窄子集+同步事务单元。 */
export interface CreativeReferenceAdminDataPort extends CreativeReferenceTransactionUnit {
  findByIdempotencyKey(kind: 'method' | 'reference', key: string): CardRecord | null;
  createCard(input: CreateCardInput, now: string): CardRecord;
  updateCard(input: UpdateCardInput, now: string): RevisionRecord;
  reviewRevision(input: ReviewInput, now: string): RevisionRecord;
  findCardByInternalId(internalId: string): CardRecord | null;
  setAvailability(internalId: string, availability: CardAvailability, now: string): CardRecord;
  getRelease(releaseId: string): ReleaseSnapshot | null;
  publishRelease(input: PublishReleaseInput, now: string): ReleaseSnapshot;
}

/** 管理审计/发布请求幂等端口：B2管理仓储实现的窄子集。 */
export interface CreativeReferenceAdminAuditPort {
  recordAudit(input: {
    action: 'create' | 'revise' | 'review' | 'retire' | 'restore' | 'publish';
    targetId: string | null;
    targetRevision: number | null;
    actorId: string;
    opinion?: string | null;
    resultRef?: string | null;
    idempotencyKey?: string | null;
    requestDigest?: string | null;
  }, now: string): void;
  setAvailabilityForRestore(internalId: string, now: string): void;
  findReleaseRequest(requestKey: string): { requestDigest: string; releaseId: string | null } | undefined;
  insertReleaseRequestPlaceholder(requestKey: string, requestDigest: string, now: string): void;
  completeReleaseRequest(requestKey: string, releaseId: string): void;
  digest(value: unknown): string;
}

/** 管理授权端口：HTTP层已做requireAdministrator，这里是第二层应用校验。 */
export interface CreativeReferenceAdminAuthorization {
  canManage(actor: AdminActor): boolean;
}

export interface AdminActor {
  role: 'manager';
  actorId: string;
}

export type AdminRelationInput = { fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: RelationType };

export interface PublishRequestOutcome {
  release: ReleaseSnapshot;
  replayed: boolean;
}

export interface CreateCardOutcome {
  card: CardRecord;
  replayed: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export class CreativeReferenceAdminService {
  public constructor(
    private readonly repository: CreativeReferenceAdminDataPort,
    private readonly adminRepository: CreativeReferenceAdminAuditPort,
    private readonly authorization: CreativeReferenceAdminAuthorization
  ) {}

  /** 应用层授权：每个写入口调用；角色、非空actor、授权端口三者齐备才放行。 */
  private requireAdminActor(actor: AdminActor): void {
    if (actor === null || typeof actor !== 'object' || actor.role !== 'manager') {
      throw new AuthorizationError('管理写操作需要管理者角色上下文。');
    }
    if (typeof actor.actorId !== 'string' || actor.actorId.trim().length === 0) {
      throw new AuthorizationError('管理写操作需要非空actor标识。');
    }
    if (!this.authorization.canManage(actor)) {
      throw new AuthorizationError('该actor无创作参考库管理权限。');
    }
  }

  /** 创建：幂等重放不重复记审计；卡与审计同事务。 */
  public createCardWithAudit(
    input: { payload: CardPayload; legacy: LegacyRef | null; idempotencyKey: string },
    actor: AdminActor,
    now: string
  ): CreateCardOutcome {
    this.requireAdminActor(actor);
    return this.repository.runInTransaction(() => {
      const prior = this.repository.findByIdempotencyKey(input.payload.assetKind, input.idempotencyKey);
      const card = this.repository.createCard({ ...input, assetKind: input.payload.assetKind, authorActor: actor.actorId }, now);
      if (prior === null) {
        this.adminRepository.recordAudit({
          action: 'create', targetId: card.internalId, targetRevision: card.currentRevision,
          actorId: actor.actorId, resultRef: card.displayCode, idempotencyKey: input.idempotencyKey
        }, now);
      }
      return { card, replayed: prior !== null };
    });
  }

  /** 修改：新草稿revision与审计同事务。 */
  public updateCardWithAudit(
    input: { internalId: string; expectedRevision: number; payload: CardPayload },
    actor: AdminActor,
    now: string
  ): RevisionRecord {
    this.requireAdminActor(actor);
    return this.repository.runInTransaction(() => {
      const revision = this.repository.updateCard({ ...input, actor: actor.actorId }, now);
      this.adminRepository.recordAudit({
        action: 'revise', targetId: input.internalId, targetRevision: revision.revision,
        actorId: actor.actorId, resultRef: revision.displayCode
      }, now);
      return revision;
    });
  }

  /** 审核：状态转换与带意见的审计同事务；审计失败整体回滚（revision保持draft）。 */
  public reviewWithOpinion(
    internalId: string,
    expectedRevision: number,
    opinion: string | null,
    actor: AdminActor,
    now: string
  ): { revision: RevisionRecord; reviewOpinion: string | null } {
    this.requireAdminActor(actor);
    return this.repository.runInTransaction(() => {
      const revision = this.repository.reviewRevision({ internalId, expectedRevision, reviewActor: actor.actorId }, now);
      this.adminRepository.recordAudit({
        action: 'review', targetId: internalId, targetRevision: revision.revision,
        actorId: actor.actorId, opinion
      }, now);
      return { revision, reviewOpinion: opinion };
    });
  }

  /**
   * 退役/恢复：所见状态与版本必传，事务内原子校验（防并发覆盖）后执行并记审计。
   * 恢复由管理仓储条件UPDATE落定（B1域规则从retired不可setAvailability），回draft需重新审核。
   */
  public setAvailabilityWithAudit(
    input: { internalId: string; action: 'retire' | 'restore'; seenAvailability: CardAvailability; seenRevision: number; reason: string | null },
    actor: AdminActor,
    now: string
  ): CardRecord {
    this.requireAdminActor(actor);
    return this.repository.runInTransaction(() => {
      const card = this.repository.findCardByInternalId(input.internalId);
      if (card === null) throw new NotFoundError('条目不存在。');
      if (card.availability !== input.seenAvailability) {
        throw new ConflictError(`状态已被并发修改：所见${input.seenAvailability}，当前${card.availability}。请刷新后重试。`);
      }
      if (card.currentRevision !== input.seenRevision) {
        throw new ConflictError(`版本已被并发修改：所见第${input.seenRevision}版，当前第${card.currentRevision ?? '无'}版。请刷新后重试。`);
      }
      if (input.action === 'retire') {
        if (card.availability === 'retired') throw new ConflictError('条目已退役。');
        const updated = this.repository.setAvailability(input.internalId, 'retired', now);
        this.adminRepository.recordAudit({
          action: 'retire', targetId: input.internalId, targetRevision: updated.currentRevision,
          actorId: actor.actorId, opinion: input.reason
        }, now);
        return updated;
      }
      if (card.availability !== 'retired') throw new ConflictError('条目未退役，无需恢复。');
      this.adminRepository.setAvailabilityForRestore(input.internalId, now);
      const restored = this.repository.findCardByInternalId(input.internalId);
      this.adminRepository.recordAudit({
        action: 'restore', targetId: input.internalId, targetRevision: restored?.currentRevision ?? null,
        actorId: actor.actorId, opinion: input.reason
      }, now);
      if (restored === null) throw new NotFoundError('条目不存在。');
      return restored;
    });
  }

  /**
   * 发布：占位记录、B1发布、回填请求结果、审计全部同事务。
   * 任一步失败（含回填UPDATE失败）整体回滚——active指针、请求记录、审计与发布结果一致；
   * 同键重试在干净状态上可安全成功。重放与结果未知在单元外只读判定。
   */
  public publishWithRequestAndAudit(
    input: {
      entries: ReadonlyArray<{ internalId: string; revision: number }>;
      relations: ReadonlyArray<AdminRelationInput>;
      expectedActiveReleaseId: string | null;
      idempotencyKey: string;
    },
    actor: AdminActor,
    now: string
  ): PublishRequestOutcome {
    this.requireAdminActor(actor);
    const requestDigest = this.adminRepository.digest({
      entries: input.entries, relations: input.relations, expectedActive: input.expectedActiveReleaseId
    });
    const existing = this.adminRepository.findReleaseRequest(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestDigest !== requestDigest) throw new ConflictError('发布请求键已用于不同内容。');
      if (existing.releaseId !== null) {
        const release = this.repository.getRelease(existing.releaseId);
        if (release !== null) return { release, replayed: true };
      }
      throw new ConflictError('上次发布结果未知；请核对releases列表或更换请求键。');
    }
    try {
      return this.repository.runInTransaction(() => {
        this.adminRepository.insertReleaseRequestPlaceholder(input.idempotencyKey, requestDigest, now);
        const release = this.repository.publishRelease({
          entries: [...input.entries], relations: [...input.relations],
          publishedBy: actor.actorId, expectedActiveReleaseId: input.expectedActiveReleaseId
        }, now);
        this.adminRepository.completeReleaseRequest(input.idempotencyKey, release.releaseId);
        this.adminRepository.recordAudit({
          action: 'publish', targetId: release.releaseId, targetRevision: null,
          actorId: actor.actorId, resultRef: release.manifestHash,
          idempotencyKey: input.idempotencyKey, requestDigest
        }, now);
        return { release, replayed: false };
      });
    } catch (error) {
      // 并发同键（跨连接写锁串行化后的竞态）：占位唯一约束触发，事务已整体回滚，重查落回重放/冲突判定。
      if (isUniqueViolation(error)) {
        const raced = this.adminRepository.findReleaseRequest(input.idempotencyKey);
        if (raced !== undefined && raced.requestDigest === requestDigest && raced.releaseId !== null) {
          const release = this.repository.getRelease(raced.releaseId);
          if (release !== null) return { release, replayed: true };
        }
        throw new ConflictError('发布请求正在处理或结果未知；请稍后核对releases列表。');
      }
      throw error;
    }
  }
}
