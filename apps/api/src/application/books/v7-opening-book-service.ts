import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { OpeningAgentTaskState, OpeningPackage, OpeningReview } from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import { V7OpeningAgentRepository } from '../../infrastructure/db/repositories/v7-opening-agent-repository.js';
import { BookOnboardingService } from './book-onboarding-service.js';
import { PositioningService } from './positioning-service.js';
import { isCurrentV7OpeningTask } from './v7-opening-agent-service.js';
import {
  openingPackageHash,
  toV7OpeningBlueprint,
  validateV7ManualOpeningPackage,
  validateV7OpeningPackage
} from './v7-opening-package-contract.js';

export interface ConfirmV7OpeningBookInput {
  taskId?: unknown;
  candidateId?: unknown;
  openingIdea?: unknown;
  openingPackage: unknown;
  idempotencyKey: unknown;
}

export interface ConfirmV7OpeningBookResult {
  bookId: string;
  title: string;
  status: 'active';
  nextView: 'information';
}

export interface V7BookListItem {
  bookId: string;
  title: string;
  status: 'active' | 'archived';
  version: number;
  updatedAt: string;
}

export class V7OpeningBookService {
  private readonly openings: V7OpeningAgentRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {
    this.openings = new V7OpeningAgentRepository(database);
  }

  public async confirm(ownerId: string, input: ConfirmV7OpeningBookInput): Promise<ConfirmV7OpeningBookResult> {
    const idempotencyKey = normalizeActionKey(input.idempotencyKey);
    const taskId = optionalIdentifier(input.taskId, '开书任务');
    const openingPackage = validateSubmittedOpeningPackage(input.openingPackage, taskId === null);
    const source = taskId === null
      ? { sourceKey: `manual-${idempotencyKey}`, idea: normalizeOptionalIdea(input.openingIdea) }
      : await this.authorizedAgentSource(ownerId, taskId, input.candidateId, openingPackage);
    const stableHash = createHash('sha256').update(`${ownerId}\n${source.sourceKey}`).digest('hex').slice(0, 32);
    const draftId = `v7-opening-draft-${stableHash}`;
    const bookId = `v7-book-${stableHash}`;
    const blueprint = toV7OpeningBlueprint(openingPackage, source.idea);
    const positioning = new PositioningService(this.database, this.ids, this.clock);
    const draft = positioning.createDraft({ ownerId }, {
      title: openingPackage.title,
      text: openingPackage.positioning.coreAppeal,
      openingBlueprint: blueprint
    }, { draftId, proposedBookId: bookId });

    if (draft.status === 'confirmed') {
      if (draft.confirmedBookId !== bookId) {
        throw new DomainError(errorCodes.validation, '开书确认记录与正式书籍不一致，请联系管理员。', {}, false, 409);
      }
      const book = new BookRepository(this.database).require({ ownerId, bookId });
      return { bookId: book.bookId, title: book.title, status: 'active', nextView: 'information' };
    }

    const result = new BookOnboardingService(this.database, this.ids, this.clock)
      .confirmDraftV7({ ownerId }, draft.draftId, draft.version);
    return { bookId: result.bookId, title: result.title, status: 'active', nextView: 'information' };
  }

  public list(ownerId: string): V7BookListItem[] {
    return this.openings.listConfirmedV7Books(ownerId);
  }

  public requireVisible(ownerId: string, bookId: string): void {
    if (!this.openings.isConfirmedV7BookVisible(ownerId, bookId)) {
      throw new DomainError(errorCodes.bookNotFound, 'V7书籍不存在', {}, false, 404);
    }
  }

  private async authorizedAgentSource(
    ownerId: string,
    taskId: string,
    candidateValue: unknown,
    submittedPackage: OpeningPackage
  ): Promise<{ sourceKey: string; idea: string }> {
    const row = this.openings.byTaskId(ownerId, taskId);
    if (row === undefined) throw new DomainError(errorCodes.validation, '开书任务不存在', {}, false, 404);
    if (!isCurrentV7OpeningTask(row)) {
      throw new DomainError(
        errorCodes.validation,
        '这项历史开书任务只能查看，不能用于创建当前版本书籍。请按当前流程重新提交开书想法。',
        {},
        false,
        409
      );
    }
    if (row.status !== 'awaiting_author_confirmation') {
      throw new DomainError(errorCodes.validation, '当前资料还没有通过主编审查，暂时不能正式建书。', {}, false, 409);
    }
    const state = row.state_json === null ? null : JSON.parse(row.state_json) as OpeningAgentTaskState;
    if (state === null || state.activePackageCandidateId === null || state.activeReviewCandidateId === null) {
      throw new DomainError(errorCodes.validation, '开书审查检查点不完整，请刷新后重试。', {}, true, 409);
    }
    const candidateId = requiredIdentifier(candidateValue, '开书资料版本');
    if (candidateId !== state.activePackageCandidateId) {
      throw new DomainError(errorCodes.validation, '开书资料已经更新，请刷新后确认最新版本。', {}, true, 409);
    }
    const candidate = await this.openings.readCandidate<OpeningPackage>(ownerId, taskId, candidateId);
    const review = await this.openings.readCandidate<OpeningReview>(ownerId, taskId, state.activeReviewCandidateId);
    if (candidate.kind !== 'opening_package' || review.kind !== 'opening_review' || review.content.verdict !== 'pass') {
      throw new DomainError(errorCodes.validation, '当前资料还没有通过主编审查。', {}, false, 409);
    }
    if (openingPackageHash(candidate.content) !== openingPackageHash(submittedPackage)) {
      throw new DomainError(errorCodes.validation, '页面内容已经修改，请先提交主编复审。', {}, false, 409);
    }
    return { sourceKey: `agent-${taskId}`, idea: row.idea_text };
  }
}

function normalizeActionKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(key)) {
    throw new DomainError(errorCodes.validation, '确认编号无效，请重新操作。');
  }
  return key;
}

function validateSubmittedOpeningPackage(value: unknown, manual: boolean): OpeningPackage {
  try {
    return manual ? validateV7ManualOpeningPackage(value) : validateV7OpeningPackage(value);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      errorCodes.validation,
      error instanceof Error ? error.message : '开书资料格式无效。'
    );
  }
}

function normalizeOptionalIdea(value: unknown): string {
  const idea = typeof value === 'string' ? value.trim() : '';
  const length = Array.from(idea).length;
  if (length > 2_000) throw new DomainError(errorCodes.validation, '开书思路最多2000字。');
  return idea;
}

function optionalIdentifier(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredIdentifier(value, label);
}

function requiredIdentifier(value: unknown, label: string): string {
  const identifier = typeof value === 'string' ? value.trim() : '';
  if (identifier.length < 8 || identifier.length > 300) {
    throw new DomainError(errorCodes.validation, `${label}无效，请刷新后重试。`);
  }
  return identifier;
}
