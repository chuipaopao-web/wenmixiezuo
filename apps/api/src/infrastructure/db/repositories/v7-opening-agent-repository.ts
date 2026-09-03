import type { DatabaseSync } from 'node:sqlite';
import type {
  OpeningAgentTaskState,
  OpeningAgentToolGateway,
  OpeningCandidateCommit,
  OpeningCandidateContent,
  OpeningCandidateKind,
  OpeningIdeaSnapshot,
  OpeningPublishingPlatform,
  OpeningSavedCandidate,
  V7OpeningMemberDefinition
} from '@wenmi/v7-backend';

export interface V7OpeningTaskRow {
  task_id: string;
  owner_id: string;
  idempotency_key: string;
  request_hash: string;
  idea_text: string;
  idea_version: number;
  idea_hash: string;
  publishing_platform: OpeningPublishingPlatform;
  selected_chief_member_key: string | null;
  selected_screenwriter_member_key: string | null;
  member_roster_json: string | null;
  status: string;
  phase: string;
  state_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface V7ConfirmedBookRow {
  bookId: string;
  title: string;
  status: 'active' | 'archived';
  version: number;
  updatedAt: string;
}

interface CandidateRow {
  candidate_id: string;
  kind: OpeningCandidateKind;
  version: number;
  content_json: string;
  created_by_member_key: string;
  model_request_id: string;
  source_candidate_ids_json: string;
}

export class V7OpeningAgentRepository implements OpeningAgentToolGateway {
  public constructor(private readonly database: DatabaseSync) {}

  public createShell(input: {
    taskId: string;
    ownerId: string;
    idempotencyKey: string;
    requestHash: string;
    ideaText: string;
    ideaHash: string;
    publishingPlatform: OpeningPublishingPlatform;
    selectedChiefMemberKey: string | null;
    selectedScreenwriterMemberKey: string | null;
    memberRoster: readonly V7OpeningMemberDefinition[];
    now: string;
  }): { row: V7OpeningTaskRow; created: boolean } {
    const result = this.database.prepare(`
      INSERT INTO v7_opening_agent_tasks (
        task_id, owner_id, idempotency_key, request_hash, idea_text, idea_version, idea_hash, publishing_platform,
        selected_chief_member_key, selected_screenwriter_member_key, member_roster_json,
        status, phase, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'queued', 'package_design', NULL, ?, ?)
      ON CONFLICT(owner_id, idempotency_key) DO NOTHING
    `).run(
      input.taskId, input.ownerId, input.idempotencyKey, input.requestHash, input.ideaText, input.ideaHash,
      input.publishingPlatform,
      input.selectedChiefMemberKey, input.selectedScreenwriterMemberKey, JSON.stringify(input.memberRoster.map((member) => ({
        memberKey: member.memberKey,
        displayName: member.displayName,
        roleKey: member.roleKey,
        model: member.model,
        enabled: member.enabledByDefault,
        defaultForRole: member.defaultForRole,
        fallbackPriority: member.fallbackPriority,
        promptInstruction: member.promptInstruction
      }))),
      input.now, input.now
    );
    const row = this.byIdempotency(input.ownerId, input.idempotencyKey);
    if (row === undefined) throw new Error('V7开书任务壳写入后无法读取');
    return { row, created: result.changes === 1 };
  }

  public byIdempotency(ownerId: string, idempotencyKey: string): V7OpeningTaskRow | undefined {
    return this.database.prepare(`
      SELECT * FROM v7_opening_agent_tasks WHERE owner_id = ? AND idempotency_key = ?
    `).get(ownerId, idempotencyKey) as V7OpeningTaskRow | undefined;
  }

  public byTaskId(ownerId: string, taskId: string): V7OpeningTaskRow | undefined {
    return this.database.prepare(`
      SELECT * FROM v7_opening_agent_tasks WHERE owner_id = ? AND task_id = ?
    `).get(ownerId, taskId) as V7OpeningTaskRow | undefined;
  }

  public listByOwner(ownerId: string, limit: number): V7OpeningTaskRow[] {
    return this.database.prepare(`
      SELECT * FROM v7_opening_agent_tasks
      WHERE owner_id = ? AND COALESCE(error_code, '') <> 'archived_by_author'
      ORDER BY updated_at DESC, created_at DESC, task_id DESC
      LIMIT ?
    `).all(ownerId, limit) as unknown as V7OpeningTaskRow[];
  }

  public listArchivableByOwner(ownerId: string): V7OpeningTaskRow[] {
    return this.database.prepare(`
      SELECT * FROM v7_opening_agent_tasks
      WHERE owner_id = ?
        AND status IN ('failed', 'interrupted')
        AND COALESCE(error_code, '') <> 'archived_by_author'
      ORDER BY updated_at DESC, created_at DESC, task_id DESC
    `).all(ownerId) as unknown as V7OpeningTaskRow[];
  }

  public archive(ownerId: string, taskId: string, now: string): V7OpeningTaskRow | undefined {
    const row = this.byTaskId(ownerId, taskId);
    if (row === undefined || row.error_code === 'archived_by_author') return row;
    const state = row.state_json === null
      ? null
      : {
          ...(JSON.parse(row.state_json) as OpeningAgentTaskState),
          status: 'failed' as const,
          errorCode: 'archived_by_author',
          errorMessage: null
        };
    const result = this.database.prepare(`
      UPDATE v7_opening_agent_tasks
      SET status = 'failed', state_json = ?, lease_token = NULL, lease_expires_at = NULL,
          error_code = 'archived_by_author', error_message = NULL, updated_at = ?
      WHERE owner_id = ? AND task_id = ?
        AND status NOT IN ('queued', 'working')
        AND COALESCE(error_code, '') <> 'archived_by_author'
    `).run(state === null ? null : JSON.stringify(state), now, ownerId, taskId);
    if (result.changes !== 1) return this.byTaskId(ownerId, taskId);
    return this.byTaskId(ownerId, taskId);
  }

  public confirmedBookForDraft(ownerId: string, draftId: string): string | null {
    const row = this.database.prepare(`
      SELECT confirmed_book_id
      FROM positioning_drafts
      WHERE owner_id = ? AND draft_id = ? AND status = 'confirmed'
      LIMIT 1
    `).get(ownerId, draftId) as { confirmed_book_id: string | null } | undefined;
    return row?.confirmed_book_id ?? null;
  }

  public listConfirmedV7Books(ownerId: string): V7ConfirmedBookRow[] {
    return this.database.prepare(`
      SELECT b.book_id AS bookId, b.title, b.status, b.version, b.updated_at AS updatedAt
      FROM books b
      WHERE b.owner_id = ? AND b.status IN ('active', 'archived')
        AND EXISTS (
          SELECT 1 FROM positioning_drafts d
          WHERE d.owner_id = b.owner_id
            AND d.confirmed_book_id = b.book_id
            AND d.status = 'confirmed'
            AND d.draft_id LIKE 'v7-opening-draft-%'
        )
      ORDER BY b.updated_at DESC, b.book_id
    `).all(ownerId) as unknown as V7ConfirmedBookRow[];
  }

  public isConfirmedV7BookVisible(ownerId: string, bookId: string): boolean {
    return this.database.prepare(`
      SELECT 1
      FROM books b
      WHERE b.owner_id = ? AND b.book_id = ? AND b.status = 'active'
        AND EXISTS (
          SELECT 1 FROM positioning_drafts d
          WHERE d.owner_id = b.owner_id
            AND d.confirmed_book_id = b.book_id
            AND d.status = 'confirmed'
            AND d.draft_id LIKE 'v7-opening-draft-%'
        )
    `).get(ownerId, bookId) !== undefined;
  }

  public listCandidates(ownerId: string, taskId: string): OpeningSavedCandidate[] {
    const rows = this.database.prepare(`
      SELECT candidate_id, kind, version, content_json, created_by_member_key,
             model_request_id, source_candidate_ids_json
      FROM v7_opening_agent_candidates
      WHERE owner_id = ? AND task_id = ? ORDER BY created_at, version
    `).all(ownerId, taskId) as unknown as CandidateRow[];
    return rows.map(toCandidate);
  }

  public candidateByRequestId(
    ownerId: string,
    taskId: string,
    modelRequestId: string
  ): OpeningSavedCandidate | undefined {
    const row = this.database.prepare(`
      SELECT candidate_id, kind, version, content_json, created_by_member_key,
             model_request_id, source_candidate_ids_json
      FROM v7_opening_agent_candidates
      WHERE owner_id = ? AND task_id = ? AND model_request_id = ?
    `).get(ownerId, taskId, modelRequestId) as CandidateRow | undefined;
    return row === undefined ? undefined : toCandidate(row);
  }

  public claim(ownerId: string, taskId: string, leaseToken: string, leaseExpiresAt: string, now: string): boolean {
    const result = this.database.prepare(`
      UPDATE v7_opening_agent_tasks
      SET lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE owner_id = ? AND task_id = ?
        AND status IN ('queued', 'working', 'interrupted')
        AND (lease_token IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
    `).run(leaseToken, leaseExpiresAt, now, ownerId, taskId, now);
    return result.changes === 1;
  }

  public renewLease(
    ownerId: string,
    taskId: string,
    leaseToken: string,
    leaseExpiresAt: string,
    now: string
  ): boolean {
    const result = this.database.prepare(`
      UPDATE v7_opening_agent_tasks
      SET lease_expires_at = ?, updated_at = ?
      WHERE owner_id = ? AND task_id = ? AND lease_token = ?
        AND status IN ('queued', 'working', 'interrupted')
    `).run(leaseExpiresAt, now, ownerId, taskId, leaseToken);
    return result.changes === 1;
  }

  public release(ownerId: string, taskId: string, leaseToken: string, now: string): void {
    this.database.prepare(`
      UPDATE v7_opening_agent_tasks SET lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE owner_id = ? AND task_id = ? AND lease_token = ?
    `).run(now, ownerId, taskId, leaseToken);
  }

  public markUnexpectedFailure(ownerId: string, taskId: string, message: string, now: string): void {
    // interrupted 也纳入：恢复执行（claim 接受 interrupted）途中若遇到非预期
    // 错误，任务必须落到明确的 failed，而不是永远停在“连接中断”。
    this.database.prepare(`
      UPDATE v7_opening_agent_tasks
      SET status = 'failed', error_code = 'internal_failure', error_message = ?, updated_at = ?
      WHERE owner_id = ? AND task_id = ? AND status IN ('queued', 'working', 'interrupted')
    `).run(message.slice(0, 1_000), now, ownerId, taskId);
  }

  public async readOpeningIdea(ownerId: string, taskId: string): Promise<OpeningIdeaSnapshot> {
    const row = this.requireRow(ownerId, taskId);
    return {
      text: row.idea_text,
      version: row.idea_version,
      hash: row.idea_hash,
      publishingPlatform: row.publishing_platform
    };
  }

  public async loadTask(ownerId: string, taskId: string): Promise<OpeningAgentTaskState | null> {
    const row = this.requireRow(ownerId, taskId);
    return row.state_json === null ? null : JSON.parse(row.state_json) as OpeningAgentTaskState;
  }

  public async createTask(state: OpeningAgentTaskState): Promise<OpeningAgentTaskState> {
    const result = this.database.prepare(`
      UPDATE v7_opening_agent_tasks
      SET status = ?, phase = ?, state_json = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE owner_id = ? AND task_id = ? AND state_json IS NULL
    `).run(
      state.status, state.phase, JSON.stringify(state), state.errorCode, state.errorMessage, new Date().toISOString(),
      state.ownerId, state.taskId
    );
    if (result.changes === 0) {
      const existing = await this.loadTask(state.ownerId, state.taskId);
      if (existing !== null) return existing;
      throw new Error('V7开书任务初始化失败');
    }
    return structuredClone(state);
  }

  public async saveTask(state: OpeningAgentTaskState): Promise<void> {
    const result = this.database.prepare(`
      UPDATE v7_opening_agent_tasks
      SET status = ?, phase = ?, state_json = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE owner_id = ? AND task_id = ?
    `).run(
      state.status, state.phase, JSON.stringify(state), state.errorCode, state.errorMessage, new Date().toISOString(),
      state.ownerId, state.taskId
    );
    if (result.changes !== 1) throw new Error('V7开书任务不存在或不属于当前账号');
  }

  public async readCandidate<T extends OpeningCandidateContent>(
    ownerId: string,
    taskId: string,
    candidateId: string
  ): Promise<OpeningSavedCandidate<T>> {
    const row = this.database.prepare(`
      SELECT candidate_id, kind, version, content_json, created_by_member_key,
             model_request_id, source_candidate_ids_json
      FROM v7_opening_agent_candidates
      WHERE owner_id = ? AND task_id = ? AND candidate_id = ?
    `).get(ownerId, taskId, candidateId) as CandidateRow | undefined;
    if (row === undefined) throw new Error('V7开书候选不存在或不属于当前账号');
    return toCandidate(row) as OpeningSavedCandidate<T>;
  }

  public async commitCandidate<T extends OpeningCandidateContent>(
    ownerId: string,
    taskId: string,
    commit: OpeningCandidateCommit<T>
  ): Promise<OpeningSavedCandidate<T>> {
    const existing = this.database.prepare(`
      SELECT candidate_id, kind, version, content_json, created_by_member_key,
             model_request_id, source_candidate_ids_json
      FROM v7_opening_agent_candidates
      WHERE owner_id = ? AND task_id = ? AND model_request_id = ?
    `).get(ownerId, taskId, commit.modelRequestId) as CandidateRow | undefined;
    if (existing !== undefined) return toCandidate(existing) as OpeningSavedCandidate<T>;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.requireRow(ownerId, taskId);
      const sourceCount = commit.sourceCandidateIds.length === 0 ? 0 : Number((this.database.prepare(`
        SELECT COUNT(*) AS count FROM v7_opening_agent_candidates
        WHERE owner_id = ? AND task_id = ?
          AND candidate_id IN (${commit.sourceCandidateIds.map(() => '?').join(',')})
      `).get(ownerId, taskId, ...commit.sourceCandidateIds) as { count: number }).count);
      if (sourceCount !== commit.sourceCandidateIds.length) throw new Error('候选来源包含跨账号、跨任务或不存在的版本');
      const version = Number((this.database.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM v7_opening_agent_candidates WHERE owner_id = ? AND task_id = ? AND kind = ?
      `).get(ownerId, taskId, commit.kind) as { version: number }).version);
      const now = new Date().toISOString();
      this.database.prepare(`
        INSERT INTO v7_opening_agent_candidates (
          candidate_id, owner_id, task_id, kind, version, content_json,
          created_by_member_key, model_request_id, source_candidate_ids_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        commit.candidateId, ownerId, taskId, commit.kind, version, JSON.stringify(commit.content),
        commit.createdByMemberKey, commit.modelRequestId, JSON.stringify(commit.sourceCandidateIds), now
      );
      const state = commit.nextState;
      const updated = this.database.prepare(`
        UPDATE v7_opening_agent_tasks
        SET status = ?, phase = ?, state_json = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE owner_id = ? AND task_id = ?
      `).run(
        state.status, state.phase, JSON.stringify(state), state.errorCode, state.errorMessage, now, ownerId, taskId
      );
      if (updated.changes !== 1) throw new Error('候选提交时任务检查点不存在');
      this.database.exec('COMMIT');
      return {
        candidateId: commit.candidateId,
        kind: commit.kind,
        version,
        content: structuredClone(commit.content),
        createdByMemberKey: commit.createdByMemberKey,
        modelRequestId: commit.modelRequestId,
        sourceCandidateIds: [...commit.sourceCandidateIds]
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private requireRow(ownerId: string, taskId: string): V7OpeningTaskRow {
    const row = this.byTaskId(ownerId, taskId);
    if (row === undefined) throw new Error('V7开书任务不存在或不属于当前账号');
    return row;
  }
}

function toCandidate(row: CandidateRow): OpeningSavedCandidate {
  return {
    candidateId: row.candidate_id,
    kind: row.kind,
    version: row.version,
    content: JSON.parse(row.content_json) as OpeningCandidateContent,
    createdByMemberKey: row.created_by_member_key,
    modelRequestId: row.model_request_id,
    sourceCandidateIds: JSON.parse(row.source_candidate_ids_json) as string[]
  };
}
