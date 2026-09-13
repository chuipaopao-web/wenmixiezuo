/**
 * R209-B1 应用服务（返修版）。
 * 授权端口外部注入；成员读取必须传冻结release；新内容进draft；审核发布带actor证据。
 */
import { AmbiguityError, AuthorizationError, NotFoundError, ValidationError } from './errors.js';
import type { ProjectionTier } from './projections.js';
import { project } from './projections.js';
import type { CreativeReferenceRepository, UpdateCardInput } from './repository.js';
import type {
  ActorContext, AdminListFilter, AdminListPage, CardAvailability, CardPayload, CardRecord,
  ExactKey, ExactReadOptions, LegacyRef, LookupResult, Projection, ReleaseSnapshot, RevisionRecord
} from './types.js';
import { countChars, validateAvailability } from './validation.js';

export interface CreativeReferenceAuthorization {
  canManage(context: ActorContext): boolean;
  canReadAsMember(context: ActorContext): boolean;
}

export interface CreateCardCommand {
  payload: CardPayload;
  legacy: LegacyRef | null;
  idempotencyKey: string;
}

export class CreativeReferenceService {
  public constructor(
    private readonly repository: CreativeReferenceRepository,
    private readonly authorization: CreativeReferenceAuthorization
  ) {}

  private requireManager(context: ActorContext): void {
    if (context.role !== 'manager' || context.actorId.trim().length === 0) {
      throw new AuthorizationError('写操作需要明确的管理者上下文与actor标识。');
    }
    if (!this.authorization.canManage(context)) {
      throw new AuthorizationError('该actor无创作参考库管理权限。');
    }
  }

  public async createCard(command: CreateCardCommand, context: ActorContext, now: string): Promise<CardRecord> {
    this.requireManager(context);
    return this.repository.createCard(
      { assetKind: command.payload.assetKind, payload: command.payload, legacy: command.legacy, idempotencyKey: command.idempotencyKey, authorActor: context.actorId },
      now
    );
  }

  /** 新内容必进draft：已发布卡更新后新revision状态draft、卡回到draft，需重新审核。 */
  public async updateCard(input: UpdateCardInput, context: ActorContext, now: string): Promise<RevisionRecord> {
    this.requireManager(context);
    return this.repository.updateCard({ ...input, actor: context.actorId }, now);
  }

  /** 审核draft：reviewActor即审核证据；published不可再改。 */
  public async reviewRevision(internalId: string, expectedRevision: number, context: ActorContext, now: string): Promise<RevisionRecord> {
    this.requireManager(context);
    return this.repository.reviewRevision({ internalId, expectedRevision, reviewActor: context.actorId }, now);
  }

  public async setAvailability(internalId: string, availability: CardAvailability, context: ActorContext, now: string): Promise<CardRecord> {
    this.requireManager(context);
    validateAvailability(availability);
    return this.repository.setAvailability(internalId, availability, now);
  }

  /** 发布：清单内revision须reviewed；发布即打published；乐观锁保护active指针。 */
  public async publish(entries: ReadonlyArray<{ internalId: string; revision: number }>,
    relations: ReadonlyArray<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: 'supplement' | 'fusion' | 'synonym' | 'replacement' | 'related_method' }>,
    context: ActorContext, now: string): Promise<ReleaseSnapshot> {
    this.requireManager(context);
    const active = await this.repository.getActiveRelease();
    return this.repository.publishRelease({ entries, relations, publishedBy: context.actorId, expectedActiveReleaseId: active === null ? null : active.releaseId }, now);
  }

  /** 测试辅助：显式指定期望active（验证乐观锁）；生产入口走publish自动读取当前active。 */
  public async publishWithStaleActive(entries: ReadonlyArray<{ internalId: string; revision: number }>,
    relations: ReadonlyArray<{ fromId: string; fromRevision: number; toId: string; toRevision: number; relationType: 'supplement' | 'fusion' | 'synonym' | 'replacement' | 'related_method' }>,
    now: string, expectedActiveReleaseId: string | null): Promise<ReleaseSnapshot> {
    return this.repository.publishRelease({ entries, relations, publishedBy: 'stale-active-probe', expectedActiveReleaseId }, now);
  }

  public async adminReadExact(key: ExactKey, options: ExactReadOptions, context: ActorContext): Promise<LookupResult> {
    this.requireManager(context);
    return this.readExact(key, options);
  }

  /**
   * 成员读取：必须传冻结release；只读release清单内revision。
   * 冻结资格=清单内revision发布时的published身份；卡片后续retired不影响旧release读取。
   */
  public async memberReadExact(key: ExactKey, releaseId: string | undefined, context: ActorContext): Promise<LookupResult> {
    if (context.role !== 'member' || context.actorId.trim().length === 0 || !this.authorization.canReadAsMember(context)) {
      throw new AuthorizationError('成员读取需要有效的成员上下文。');
    }
    if (releaseId === undefined || releaseId.trim().length === 0) {
      throw new AuthorizationError('成员读取必须传冻结release，不允许默认读最新。');
    }
    const located = await this.locate(key);
    if (located.outcome !== 'found') return located;
    const inRelease = await this.repository.getRevisionInRelease(releaseId, located.card.internalId);
    if (inRelease === null) return { outcome: 'notFound', reason: `该条目不在冻结release ${releaseId} 中，不回退到最新。` };
    return { outcome: 'found', card: located.card, revision: inRelease };
  }

  public async memberProject(key: ExactKey, releaseId: string | undefined, tier: ProjectionTier, context: ActorContext): Promise<Projection> {
    const result = await this.memberReadExact(key, releaseId, context);
    if (result.outcome !== 'found') throw new NotFoundError(result.reason);
    return project(result.revision, tier);
  }

  public async listAdmin(filter: AdminListFilter, context: ActorContext): Promise<AdminListPage> {
    this.requireManager(context);
    return this.repository.listAdmin(filter);
  }

  private async readExact(key: ExactKey, options: ExactReadOptions): Promise<LookupResult> {
    const located = await this.locate(key);
    if (located.outcome !== 'found') return located;
    if (options.releaseId !== undefined) {
      const inRelease = await this.repository.getRevisionInRelease(options.releaseId, located.card.internalId);
      if (inRelease === null) return { outcome: 'notFound', reason: `该条目不在release ${options.releaseId} 中。` };
      return { outcome: 'found', card: located.card, revision: inRelease };
    }
    if (options.revision !== undefined) {
      const revision = await this.repository.getRevision(located.card.internalId, options.revision);
      if (revision === null) return { outcome: 'notFound', reason: `revision ${options.revision} 不存在。` };
      return { outcome: 'found', card: located.card, revision };
    }
    const current = located.card.currentRevision === null ? null : await this.repository.getRevision(located.card.internalId, located.card.currentRevision);
    if (current === null) return { outcome: 'notFound', reason: '条目尚无revision。' };
    return { outcome: 'found', card: located.card, revision: current };
  }

  private async locate(key: ExactKey): Promise<LookupResult> {
    if (key.by === 'internalId') {
      const card = await this.repository.findCardByInternalId(key.internalId);
      return card === null ? { outcome: 'notFound', reason: 'internalId不存在。' } : { outcome: 'found', card, revision: null as never };
    }
    if (key.by === 'displayCode') {
      const cards = await this.repository.findCardsByDisplayCode(key.displayCode);
      if (cards.length === 0) return { outcome: 'notFound', reason: `编号不存在：${key.displayCode}（不做近似替换）。` };
      if (cards.length > 1) throw new AmbiguityError(`编号异常命中多条：${key.displayCode}`, cards);
      return { outcome: 'found', card: cards[0]!, revision: null as never };
    }
    const cards = await this.repository.findCardsByLegacy(key.legacy);
    if (cards.length === 0) return { outcome: 'notFound', reason: `legacy引用不存在：${key.legacy.namespace}:${key.legacy.key}。` };
    if (cards.length > 1) {
      return { outcome: 'ambiguous', candidates: cards.map((card) => ({ internalId: card.internalId, displayCode: card.displayCode, legacy: card.legacy })), reason: 'legacy别名命中多条（跨卡），请改用displayCode或加版本。' };
    }
    return { outcome: 'found', card: cards[0]!, revision: null as never };
  }

  /** legacy映射导入：canonical目标可选；确认同实体的多别名挂同一卡一个编号。 */
  public async importLegacyMapping(entries: ReadonlyArray<{ canonicalInternalId?: string; legacy: LegacyRef; payload: CardPayload; sourceView: string }>, idempotencyPrefix: string, context: ActorContext, now: string): Promise<CardRecord[]> {
    this.requireManager(context);
    for (const entry of entries) {
      if (entry.canonicalInternalId !== undefined) {
        const target = await this.repository.findCardByInternalId(entry.canonicalInternalId);
        if (target === null) throw new ValidationError(`canonical目标不存在：${entry.canonicalInternalId}`);
      }
    }
    return this.repository.importLegacyMapping(entries, idempotencyPrefix, context.actorId, now);
  }
}

export { countChars };
