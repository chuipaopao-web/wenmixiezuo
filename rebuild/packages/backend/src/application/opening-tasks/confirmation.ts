import { randomUUID } from 'node:crypto';
import { agentOpeningBookConfirmSchema, openingBookCreateResultSchema, type AgentOpeningBookConfirm } from '@wenmi-rebuild/contracts';
import { DomainError } from '../../domain/errors.js';
import { normalizeSyntheticJson } from '../../domain/synthetic-tasks/index.js';
import type { PgPool } from '../../infrastructure/postgres/client.js';
import { PostgresBookshelfRepository } from '../../infrastructure/postgres/repositories/bookshelf-repository.js';
import type { AccountCoreService } from '../accounts/index.js';
import { profileFromBlueprint } from '../bookshelf/service.js';
import type { OpeningTask } from './service.js';
import type { OpeningAgentTaskState, OpeningPackage, OpeningReview } from '../../legacy-opening/opening-agent/opening-agent-contracts.js';
import { sha256, stableStringify } from '../../legacy-opening/prompt-governance/index.js';
import { openingPackageUnchanged, publicV7OpeningPackage, toV7OpeningBlueprint, validateV7OpeningConfirmationPackage } from './opening-package-contract.js';

type Candidate = { candidate_id: string; kind: string; content: OpeningPackage | OpeningReview; member_key: string; model_request_id: string; source_candidate_ids: string[] };
type Confirmed = { book_id: string; task_id: string; input_hash: string };

/** Preserves V7 confirmation semantics; all resulting book records share one PG transaction. */
export class OpeningConfirmationService {
  private readonly books: PostgresBookshelfRepository;
  constructor(pool: PgPool, private readonly accounts: AccountCoreService) { this.books = new PostgresBookshelfRepository(pool); }

  async confirm(sessionToken: string, input: AgentOpeningBookConfirm) {
    const parsed = agentOpeningBookConfirmSchema.safeParse(input);
    if (!parsed.success) throw new DomainError('BOOK_INPUT_INVALID', '确认资料没有通过检查。');
    const request = parsed.data;
    let validated: ReturnType<typeof validateV7OpeningConfirmationPackage>;
    try {
      normalizeSyntheticJson(request.openingPackage, '开书确认资料');
      validated = validateV7OpeningConfirmationPackage(request.openingPackage);
    } catch { throw new DomainError('BOOK_INPUT_INVALID', '开书资料格式不完整，请检查后重试。'); }
    const inputHash = sha256(stableStringify({ taskId: request.taskId, candidateId: request.candidateId,
      openingPackage: publicV7OpeningPackage(validated.comparisonPackage) }));
    return this.accounts.withAuthenticatedSessionTransaction(sessionToken, async (client, session) => {
      const ownerId = session.account.ownerId;
      const task = (await client.query<OpeningTask>('SELECT * FROM opening_tasks WHERE owner_id=$1 AND task_id=$2 FOR UPDATE', [ownerId, request.taskId])).rows[0];
      if (!task) throw new DomainError('BOOK_NOT_FOUND', '没有找到这项开书任务。');
      const duplicateKey = (await client.query<Confirmed>('SELECT book_id,task_id,input_hash FROM agent_book_opening_sources WHERE owner_id=$1 AND command_key=$2', [ownerId, request.idempotencyKey])).rows[0];
      if (duplicateKey && (duplicateKey.task_id !== task.task_id || duplicateKey.input_hash !== inputHash)) {
        throw new DomainError('BOOK_IDEMPOTENCY_CONFLICT', '这次确认编号已经用于另一份内容。');
      }
      const confirmed = (await client.query<Confirmed>('SELECT book_id,task_id,input_hash FROM agent_book_opening_sources WHERE owner_id=$1 AND task_id=$2', [ownerId, task.task_id])).rows[0];
      if (confirmed) {
        if (confirmed.input_hash !== inputHash) throw new DomainError('BOOK_VERSION_CONFLICT', '本次开书已经采用另一份内容，请打开已建立的书籍。');
        const book = await this.books.findByOwnerAndBookId(client, ownerId, confirmed.book_id);
        if (!book || book.status !== 'active') throw new DomainError('BOOK_VERSION_CONFLICT', '这本书已归档，请先在书架恢复。');
        return result(book.bookId, book.title);
      }
      const state = task.engine_state as unknown as OpeningAgentTaskState | null;
      if (task.status !== 'awaiting_author' || task.cancel_requested || task.active_call_id !== null ||
        state?.status !== 'awaiting_author_confirmation' || state.phase !== 'complete') {
        throw new DomainError('BOOK_VERSION_CONFLICT', '当前资料还没有通过主编审查，暂时不能正式建书。');
      }
      if (state.taskId !== task.task_id || state.ownerId !== ownerId || state.activePackageCandidateId !== request.candidateId || !state.activeReviewCandidateId) {
        throw new DomainError('BOOK_VERSION_CONFLICT', '开书资料已经更新，请刷新后确认最新版本。');
      }
      const read = async (id: string) => (await client.query<Candidate>('SELECT * FROM opening_workflow_candidates WHERE task_id=$1 AND candidate_id=$2', [task.task_id, id])).rows[0];
      const candidate = await read(request.candidateId), review = await read(state.activeReviewCandidateId);
      if (candidate?.kind !== 'opening_package' || review?.kind !== 'opening_review' || (review.content as OpeningReview).verdict !== 'pass' ||
        !review.source_candidate_ids.includes(candidate.candidate_id)) {
        throw new DomainError('BOOK_VERSION_CONFLICT', '当前资料缺少对应版本的通过审查。');
      }
      // The preserved engine enforces this during execution; confirmation also checks the saved evidence.
      const calls = (await client.query<{ step: string; provider: string; model_id: string; receipt: { outcome?: string } | null }>(
        'SELECT step,provider,model_id,receipt FROM opening_task_calls WHERE task_id=$1 AND step=ANY($2::text[])',
        [task.task_id, [sha256(candidate.model_request_id), sha256(review.model_request_id)]])).rows;
      const reviewCall = calls.find(c => c.step === sha256(review.model_request_id));
      const designCall = calls.find(c => c.step === sha256(candidate.model_request_id));
      if (reviewCall?.receipt?.outcome !== 'continue' || (candidate.member_key !== 'author' &&
        (designCall?.receipt?.outcome !== 'continue' || (designCall.provider === reviewCall.provider && designCall.model_id === reviewCall.model_id)))) {
        throw new DomainError('BOOK_VERSION_CONFLICT', '独立审查记录不完整，请重新读取任务结果。');
      }
      if (!openingPackageUnchanged(candidate.content as OpeningPackage, validated.comparisonPackage)) {
        throw new DomainError('BOOK_VERSION_CONFLICT', '页面内容已经修改，请先提交主编复审。');
      }
      const idea = (task.request as unknown as { idea?: unknown }).idea;
      if (typeof idea !== 'string' || state.ideaVersion !== 1 || state.ideaHash !== sha256(idea)) throw new DomainError('BOOK_VERSION_CONFLICT', '开书原始资料版本不一致。');
      const book = await this.books.insertBook(client, { bookId: randomUUID(), ownerId, title: validated.openingPackage.title,
        idempotencyKey: `agent-opening:${task.task_id}`, idempotencyInputHash: inputHash });
      await client.query(`INSERT INTO agent_book_opening_sources
        (source_id,owner_id,book_id,task_id,candidate_id,review_candidate_id,opening_idea,opening_package,input_hash,command_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [randomUUID(), ownerId, book.bookId, task.task_id, candidate.candidate_id, review.candidate_id,
        idea, JSON.stringify(validated.openingPackage), inputHash, request.idempotencyKey]);
      // This existing directory table stores only empty directory metadata, with no source-type claim.
      await this.books.insertManualChapterDirectory(client, { directoryId: randomUUID(), ownerId, bookId: book.bookId });
      const blueprint = { ...toV7OpeningBlueprint(validated.openingPackage, idea), openingIdea: idea };
      const profile = profileFromBlueprint(book.title, blueprint, 1, null, validated.openingPackage.positioning.category, 'agent_opening_package');
      await this.books.insertBookProfileVersion(client, { profileVersionId: randomUUID(), ownerId, bookId: book.bookId, version: 1, profile });
      await this.books.recordAudit(client, { auditId: randomUUID(), ownerId, bookId: book.bookId, actorUserId: session.account.userId,
        eventType: 'agent_book_confirmed', result: 'succeeded', detail: { taskId: task.task_id, candidateId: candidate.candidate_id, reviewCandidateId: review.candidate_id, sourceVersion: 1 } });
      return result(book.bookId, book.title);
    });
  }
}
function result(bookId: string, title: string) { return openingBookCreateResultSchema.parse({ bookId, title, status: 'active', nextView: 'information' }); }
