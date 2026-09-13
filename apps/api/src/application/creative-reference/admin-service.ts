/**
 * R209-B2返修：管理端应用服务。全部管理写入（状态变更+意见+审计+发布请求记录）
 * 在同一BEGIN IMMEDIATE事务内完成：任一步失败整体回滚，不出现“报错但状态已变”。
 * 路由只做认证/解析/映射，不在HTTP层编排SQL或多段补偿。
 */
import type { SqliteCreativeReferenceRepository } from '../../infrastructure/db/repositories/creative-reference-repository.js';
import type { CreativeReferenceAdminRepository } from '../../infrastructure/db/repositories/creative-reference-admin-repository.js';
import { ConflictError, NotFoundError } from './errors.js';
import type { CardAvailability, CardPayload, CardRecord, LegacyRef, ReleaseSnapshot, RelationType, RevisionRecord } from './types.js';

export type AdminRelationInput = { fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: RelationType };

export interface AdminActor {
  actorId: string;
}

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
    private readonly repository: SqliteCreativeReferenceRepository,
    private readonly adminRepository: CreativeReferenceAdminRepository
  ) {}

  /** 创建：幂等重放不重复记审计；卡与审计同事务。 */
  public async createCardWithAudit(
    input: { payload: CardPayload; legacy: LegacyRef | null; idempotencyKey: string },
    actor: AdminActor,
    now: string
  ): Promise<CreateCardOutcome> {
    return this.repository.runInImmediateTransaction(async () => {
      const prior = await this.repository.findByIdempotencyKey(input.payload.assetKind, input.idempotencyKey);
      const card = await this.repository.createCard({ ...input, assetKind: input.payload.assetKind, authorActor: actor.actorId }, now);
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
  public async updateCardWithAudit(
    input: { internalId: string; expectedRevision: number; payload: CardPayload },
    actor: AdminActor,
    now: string
  ): Promise<RevisionRecord> {
    return this.repository.runInImmediateTransaction(async () => {
      const revision = await this.repository.updateCard({ ...input, actor: actor.actorId }, now);
      this.adminRepository.recordAudit({
        action: 'revise', targetId: input.internalId, targetRevision: revision.revision,
        actorId: actor.actorId, resultRef: revision.displayCode
      }, now);
      return revision;
    });
  }

  /** 审核：状态转换与带意见的审计同事务；审计失败整体回滚（revision保持draft）。 */
  public async reviewWithOpinion(
    internalId: string,
    expectedRevision: number,
    opinion: string | null,
    actor: AdminActor,
    now: string
  ): Promise<{ revision: RevisionRecord; reviewOpinion: string | null }> {
    return this.repository.runInImmediateTransaction(async () => {
      const revision = await this.repository.reviewRevision({ internalId, expectedRevision, reviewActor: actor.actorId }, now);
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
  public async setAvailabilityWithAudit(
    input: { internalId: string; action: 'retire' | 'restore'; seenAvailability: CardAvailability; seenRevision: number; reason: string | null },
    actor: AdminActor,
    now: string
  ): Promise<CardRecord> {
    return this.repository.runInImmediateTransaction(async () => {
      const card = await this.repository.findCardByInternalId(input.internalId);
      if (card === null) throw new NotFoundError('条目不存在。');
      if (card.availability !== input.seenAvailability) {
        throw new ConflictError(`状态已被并发修改：所见${input.seenAvailability}，当前${card.availability}。请刷新后重试。`);
      }
      if (card.currentRevision !== input.seenRevision) {
        throw new ConflictError(`版本已被并发修改：所见第${input.seenRevision}版，当前第${card.currentRevision ?? '无'}版。请刷新后重试。`);
      }
      if (input.action === 'retire') {
        if (card.availability === 'retired') throw new ConflictError('条目已退役。');
        const updated = await this.repository.setAvailability(input.internalId, 'retired', now);
        this.adminRepository.recordAudit({
          action: 'retire', targetId: input.internalId, targetRevision: updated.currentRevision,
          actorId: actor.actorId, opinion: input.reason
        }, now);
        return updated;
      }
      if (card.availability !== 'retired') throw new ConflictError('条目未退役，无需恢复。');
      this.adminRepository.setAvailabilityForRestore(input.internalId, now);
      const restored = await this.repository.findCardByInternalId(input.internalId);
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
   * 同键重试在干净状态上可安全成功。重放与结果未知在事务外只读判定。
   */
  public async publishWithRequestAndAudit(
    input: {
      entries: ReadonlyArray<{ internalId: string; revision: number }>;
      relations: ReadonlyArray<AdminRelationInput>;
      expectedActiveReleaseId: string | null;
      idempotencyKey: string;
    },
    actor: AdminActor,
    now: string
  ): Promise<PublishRequestOutcome> {
    const requestDigest = this.adminRepository.digest({
      entries: input.entries, relations: input.relations, expectedActive: input.expectedActiveReleaseId
    });
    const existing = this.adminRepository.findReleaseRequest(input.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestDigest !== requestDigest) throw new ConflictError('发布请求键已用于不同内容。');
      if (existing.releaseId !== null) {
        const release = await this.repository.getRelease(existing.releaseId);
        if (release !== null) return { release, replayed: true };
      }
      // 同键同内容但无结果（上次事务已整体回滚则不会走到这里；防御结果未知场景）。
      throw new ConflictError('上次发布结果未知；请核对releases列表或更换请求键。');
    }
    try {
      return await this.repository.runInImmediateTransaction(async () => {
        this.adminRepository.insertReleaseRequestPlaceholder(input.idempotencyKey, requestDigest, now);
        const release = await this.repository.publishRelease({
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
      // 并发同键：占位唯一约束触发，事务已回滚，重查落回重放/冲突判定。
      if (isUniqueViolation(error)) {
        const raced = this.adminRepository.findReleaseRequest(input.idempotencyKey);
        if (raced !== undefined && raced.requestDigest === requestDigest && raced.releaseId !== null) {
          const release = await this.repository.getRelease(raced.releaseId);
          if (release !== null) return { release, replayed: true };
        }
        throw new ConflictError('发布请求正在处理或结果未知；请稍后核对releases列表。');
      }
      throw error;
    }
  }
}
