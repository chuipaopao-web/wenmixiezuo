import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../../domain/errors.js';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

interface TableNameRow {
  readonly name: string;
}

interface TableColumnRow {
  readonly name: string;
}

interface RowidRow {
  readonly rowid: number;
}

export interface BookPurgeRecord {
  readonly bookTitle: string;
  readonly operationId: string;
  readonly tombstoneId: string;
  readonly confirmationHash: string;
  readonly deletedAt: string;
}

export interface CleanCutoverDeleteAuthorization {
  readonly operationId: string;
  readonly authorizationHash: string;
  readonly createdAt: string;
}

export interface ActiveWorkEntry {
  readonly table: string;
  readonly count: number;
  readonly reason: 'active_state' | 'live_lease';
}

/**
 * 单书永久删除计划：预览与执行共用同一份行集合定义。
 * 预览返回 planHash；执行时在写事务内重算计划并比对，
 * 预览后任何相关行变化都会使哈希不同而拒绝执行（409）。
 */
export interface BookPurgePlan {
  readonly bookVersion: number;
  /** owner_id+book_id 动态扫描表 → rowid 列表（仅非空表） */
  readonly scoped: Readonly<Record<string, readonly number[]>>;
  /** tm2 核心表（owner/book 列名）→ rowid 列表（仅非空表） */
  readonly tm2: Readonly<Record<string, readonly number[]>>;
  /** payload/state_json 中引用本书的 opening_drafts.owner_id */
  readonly openingDraftOwners: readonly string[];
  /** state_json 引用本书的 v7_opening_agent_tasks.task_id */
  readonly openingTaskIds: readonly string[];
  /** 上述开书任务的模型调用 request_id（账务投影中 book_id 为 NULL，需一并归档） */
  readonly openingCallIds: readonly string[];
  readonly quarantineRowids: readonly number[];
  readonly positioningRowids: readonly number[];
  readonly portableOperationIds: readonly string[];
  readonly modelCallRequestIds: readonly string[];
  readonly filePaths: readonly string[];
  readonly fileBytes: number;
  /** 账务投影中本书的行数（删除前全部归档，投影保持不变） */
  readonly usageRecords: number;
  readonly totalRows: number;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * 永不随书籍删除的表：墓碑与删除审计、账务归档、干净切换授权、历史备份清单。
 * backup_files 是历史备份证据（老板明确要求保留历史备份），不按书清理。
 */
const PURGE_KEEP_TABLES = new Set([
  'books',
  'deletion_tombstones',
  'account_usage_purge_archive',
  'clean_cutover_operations',
  'clean_cutover_delete_guard',
  'backup_files',
  'schema_migrations'
]);

/**
 * tm2 核心表使用 owner/book 列名而非 owner_id/book_id，动态扫描覆盖不到，
 * 必须显式处理；顺序先子后父（tm2_attempts→tm2_steps、reviews/adoptions→candidates、
 * consumptions→outbox），tm2_books 最后。
 */
const TM2_BOOK_TABLES = [
  'tm2_attempts',
  'tm2_review_reads',
  'tm2_step_archive',
  'tm2_steps',
  'tm2_reviews',
  'tm2_adoptions',
  'tm2_consumptions',
  'tm2_operations',
  'tm2_outbox',
  'tm2_candidates',
  'tm2_context_cards',
  'tm2_numbers',
  'tm2_storyline_material_drafts',
  'tm2_storyline_materials',
  'tm2_books'
] as const;

/** 活动状态：任务/调用/运行仍在进行或结果未知（未知可能迟到返回，一律视为在途）。 */
const ACTIVE_WORK_STATES = ['working', 'running', 'queued', 'pending', 'in_progress', 'started', 'unknown'] as const;
/** 与 R165 门禁一致的表名模式：任务/模型调用/运行/作业/设计调用/封面设计。 */
const ACTIVE_TABLE_PATTERN = /task|model_call|_run|_job|design_call|cover_design/;

function jsonReferencesBookId(value: unknown, bookId: string): boolean {
  if (typeof value === 'string') return value === bookId;
  if (Array.isArray(value)) return value.some((entry) => jsonReferencesBookId(entry, bookId));
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) => jsonReferencesBookId(entry, bookId));
  }
  return false;
}

export class BookPurgeRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public hasTombstone(scope: BookScope): boolean {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT 1 FROM deletion_tombstones WHERE owner_id = ? AND deleted_book_id = ?
    `).get(scope.ownerId, scope.bookId) !== undefined;
  }

  public listRegisteredPaths(scope: BookScope): string[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT relative_path FROM file_registry WHERE owner_id = ? AND book_id = ?
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ relative_path: string }>;
    return rows.map((row) => row.relative_path);
  }

  /** 在途工作门禁：返回本书仍活动的任务/调用/运行；空数组表示可以安全删除。 */
  public activeWork(scope: BookScope, nowIso: string, nowMs: number): ActiveWorkEntry[] {
    assertBookScope(scope);
    const entries: ActiveWorkEntry[] = [];
    const marks = ACTIVE_WORK_STATES.map(() => '?').join(',');
    for (const table of this.#allTableNames()) {
      if (PURGE_KEEP_TABLES.has(table) || !ACTIVE_TABLE_PATTERN.test(table)) continue;
      if (table === 'task_phases') continue; // 历史阶段行可能滞留 working，父任务与租约单独检查
      const columns = this.#columnsOf(table);
      const stateColumn = columns.has('state') ? 'state' : columns.has('status') ? 'status' : null;
      if (stateColumn === null) continue;
      if (columns.has('owner_id') && columns.has('book_id')) {
        const count = this.#count(
          `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE owner_id = ? AND book_id = ? AND ${quoteIdentifier(stateColumn)} IN (${marks})`,
          [scope.ownerId, scope.bookId, ...ACTIVE_WORK_STATES]
        );
        if (count > 0) entries.push({ table, count, reason: 'active_state' });
      }
    }
    // tm2 步骤使用 owner/book 列名、lease_until 为纪元毫秒：运行中或未知且租约未过期视为在途。
    const tm2Steps = this.#count(
      `SELECT COUNT(*) AS count FROM tm2_steps WHERE owner = ? AND book = ? AND state IN ('running','unknown') AND lease_until > ?`,
      [scope.ownerId, scope.bookId, nowMs]
    );
    if (tm2Steps > 0) entries.push({ table: 'tm2_steps', count: tm2Steps, reason: 'live_lease' });
    // 旧任务系统活租约。
    const leases = this.#count(
      `SELECT COUNT(*) AS count FROM tasks WHERE owner_id = ? AND book_id = ? AND lease_expires_at > ?`,
      [scope.ownerId, scope.bookId, nowIso]
    );
    if (leases > 0) entries.push({ table: 'tasks', count: leases, reason: 'live_lease' });
    // 开书任务（owner 范围、state_json 引用本书）仍在进行或持有活租约。
    const openingTasks = this.database.prepare(`
      SELECT task_id, status, lease_expires_at, state_json FROM v7_opening_agent_tasks WHERE owner_id = ?
    `).all(scope.ownerId) as unknown as Array<{ task_id: string; status: string; lease_expires_at: string | null; state_json: string | null }>;
    const activeOpening = openingTasks.filter((task) => {
      if (task.state_json === null || !jsonReferencesBookId(parseJson(task.state_json), scope.bookId)) return false;
      return ACTIVE_WORK_STATES.includes(task.status as (typeof ACTIVE_WORK_STATES)[number])
        || (task.lease_expires_at !== null && task.lease_expires_at > nowIso);
    });
    if (activeOpening.length > 0) {
      entries.push({ table: 'v7_opening_agent_tasks', count: activeOpening.length, reason: 'active_state' });
    }
    return entries;
  }

  /** 计算本书的完整删除计划（预览与执行共用；在事务内重算用于绑定）。 */
  public planPurge(scope: BookScope, bookVersion: number): BookPurgePlan {
    assertBookScope(scope);
    const scoped: Record<string, number[]> = {};
    for (const table of this.#scopedTableNames()) {
      const rowids = this.#rowids(
        `SELECT rowid FROM ${quoteIdentifier(table)} WHERE owner_id = ? AND book_id = ? ORDER BY rowid`,
        [scope.ownerId, scope.bookId]
      );
      if (rowids.length > 0) scoped[table] = rowids;
    }
    const tm2: Record<string, number[]> = {};
    for (const table of TM2_BOOK_TABLES) {
      const rowids = this.#rowids(
        `SELECT rowid FROM ${quoteIdentifier(table)} WHERE owner = ? AND book = ? ORDER BY rowid`,
        [scope.ownerId, scope.bookId]
      );
      if (rowids.length > 0) tm2[table] = rowids;
    }
    const openingDraftOwners: string[] = [];
    const draft = this.database.prepare('SELECT payload FROM opening_drafts WHERE owner_id = ?')
      .get(scope.ownerId) as { payload: string | null } | undefined;
    if (draft?.payload != null && jsonReferencesBookId(parseJson(draft.payload), scope.bookId)) {
      openingDraftOwners.push(scope.ownerId);
    }
    const openingTaskIds = (this.database.prepare(`
      SELECT task_id, state_json FROM v7_opening_agent_tasks WHERE owner_id = ?
    `).all(scope.ownerId) as unknown as Array<{ task_id: string; state_json: string | null }>)
      .filter((row) => row.state_json !== null && jsonReferencesBookId(parseJson(row.state_json), scope.bookId))
      .map((row) => row.task_id)
      .sort();
    const openingCallIds = openingTaskIds.length === 0 ? [] : (this.database.prepare(`
      SELECT request_id FROM v7_opening_agent_model_calls
      WHERE owner_id = ? AND task_id IN (${openingTaskIds.map(() => '?').join(',')}) ORDER BY request_id
    `).all(scope.ownerId, ...openingTaskIds) as unknown as Array<{ request_id: string }>)
      .map((row) => row.request_id);
    const quarantineRowids = this.#rowids(
      'SELECT rowid FROM quarantine_items WHERE owner_id = ? AND intended_book_id = ? ORDER BY rowid',
      [scope.ownerId, scope.bookId]
    );
    const positioningRowids = this.#rowids(
      'SELECT rowid FROM positioning_drafts WHERE owner_id = ? AND (proposed_book_id = ? OR confirmed_book_id = ?) ORDER BY rowid',
      [scope.ownerId, scope.bookId, scope.bookId]
    );
    const portableOperationIds = (this.database.prepare(`
      SELECT portable_operation_id FROM portable_operations
      WHERE owner_id = ? AND (book_id = ? OR source_book_id = ? OR target_book_id = ?)
      ORDER BY portable_operation_id
    `).all(scope.ownerId, scope.bookId, scope.bookId, scope.bookId) as unknown as Array<{ portable_operation_id: string }>)
      .map((row) => row.portable_operation_id);
    const modelCallRequestIds = (this.database.prepare(`
      SELECT request_id FROM model_calls WHERE owner_id = ? AND book_id = ? ORDER BY request_id
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ request_id: string }>)
      .map((row) => row.request_id);
    const fileRows = this.database.prepare(`
      SELECT relative_path, size_bytes FROM file_registry WHERE owner_id = ? AND book_id = ? ORDER BY relative_path
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ relative_path: string; size_bytes: number }>;
    const usageRecords = this.#count(
      'SELECT COUNT(*) AS count FROM account_usage_live_projection WHERE owner_id = ? AND book_id = ?',
      [scope.ownerId, scope.bookId]
    );
    const totalRows = Object.values(scoped).reduce((sum, rows) => sum + rows.length, 0)
      + Object.values(tm2).reduce((sum, rows) => sum + rows.length, 0)
      + openingDraftOwners.length + openingTaskIds.length + openingCallIds.length
      + quarantineRowids.length + positioningRowids.length + modelCallRequestIds.length;
    return {
      bookVersion,
      scoped,
      tm2,
      openingDraftOwners,
      openingTaskIds,
      openingCallIds,
      quarantineRowids,
      positioningRowids,
      portableOperationIds,
      modelCallRequestIds,
      filePaths: fileRows.map((row) => row.relative_path),
      fileBytes: fileRows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0),
      usageRecords,
      totalRows
    };
  }

  /** 计划的稳定指纹：行集合、文件清单与书籍版本任一变化都会改变哈希。 */
  public purgePlanHash(plan: BookPurgePlan): string {
    return createHash('sha256').update(canonicalize(plan), 'utf8').digest('hex');
  }

  /**
   * 事务内执行永久删除：墓碑 → 账务归档（投影不变）→ 全部相关行 → books 行。
   * 传入 expectedPlanHash 时在写事务内重算计划并比对，不一致即 409 拒绝，
   * 保证"预览后变化拒绝"。抛错时整体回滚，不会误删文件（文件在提交后删除）。
   */
  public permanentlyDelete(
    scope: BookScope,
    record: BookPurgeRecord,
    cleanCutover?: CleanCutoverDeleteAuthorization,
    expectedPlanHash?: string,
    bookVersion?: number
  ): void {
    assertBookScope(scope);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('PRAGMA defer_foreign_keys = ON');
      // 事务内只计算一次计划：先用于预览哈希绑定，再驱动归档与删除。
      const plan = this.planPurge(scope, bookVersion ?? 0);
      if (expectedPlanHash !== undefined && this.purgePlanHash(plan) !== expectedPlanHash) {
        throw new DomainError(
          errorCodes.permanentDeletePreviewStale,
          '删除预览已过期：书籍数据在预览后发生变化，请重新查看影响后再确认',
          { bookId: scope.bookId },
          false,
          409
        );
      }
      if (cleanCutover !== undefined) {
        this.database.prepare(`
          INSERT INTO clean_cutover_delete_guard (
            guard_id, operation_id, authorization_hash, created_at
          ) VALUES (1, ?, ?, ?)
        `).run(cleanCutover.operationId, cleanCutover.authorizationHash, cleanCutover.createdAt);
      }
      this.database.prepare(`
        INSERT INTO deletion_tombstones (
          tombstone_id, owner_id, deleted_book_id, deleted_book_title,
          deletion_operation_id, confirmation_text_hash, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.tombstoneId,
        scope.ownerId,
        scope.bookId,
        record.bookTitle,
        record.operationId,
        record.confirmationHash,
        record.deletedAt
      );
      this.#archiveAccountUsage(scope, record, plan);
      this.#deleteOpeningRows(scope, plan);
      this.#deletePortableRows(scope);
      this.#deleteTm2Rows(scope);
      this.database.prepare(`
        DELETE FROM quarantine_items WHERE owner_id = ? AND intended_book_id = ?
      `).run(scope.ownerId, scope.bookId);
      this.database.prepare(`
        DELETE FROM positioning_drafts
        WHERE owner_id = ? AND (proposed_book_id = ? OR confirmed_book_id = ?)
      `).run(scope.ownerId, scope.bookId, scope.bookId);
      this.database.prepare(`
        DELETE FROM model_call_prompt_snapshots
        WHERE request_id IN (
          SELECT request_id FROM model_calls WHERE owner_id = ? AND book_id = ?
        )
      `).run(scope.ownerId, scope.bookId);
      this.#deleteScopedRows(scope);
      this.database.prepare('DELETE FROM books WHERE owner_id = ? AND book_id = ?')
        .run(scope.ownerId, scope.bookId);
      if (cleanCutover !== undefined) {
        this.database.prepare(`
          DELETE FROM clean_cutover_delete_guard
          WHERE guard_id = 1 AND operation_id = ?
        `).run(cleanCutover.operationId);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  /** 删除前把本书（及关联开书任务调用）的账务投影行整体归档，保证账号用量投影逐行不变。 */
  #archiveAccountUsage(scope: BookScope, record: BookPurgeRecord, plan: BookPurgePlan): void {
    const archiveColumns = `
      source_kind, source_id, owner_id, book_id, provider, model_id,
      source_state, usage_state, input_tokens, output_tokens, consumed_tokens,
      reserved_tokens, cash_micros, consumed_units, reserved_units, recorded_at,
      completed_at, purge_operation_id, archived_at
    `;
    this.database.prepare(`
      INSERT INTO account_usage_purge_archive (${archiveColumns})
      SELECT source_kind, source_id, owner_id, book_id, provider, model_id,
        source_state, usage_state, input_tokens, output_tokens, consumed_tokens,
        reserved_tokens, cash_micros, consumed_units, reserved_units, recorded_at,
        completed_at, ?, ?
      FROM account_usage_live_projection
      WHERE owner_id = ? AND book_id = ?
    `).run(record.operationId, record.deletedAt, scope.ownerId, scope.bookId);
    // 关联开书任务的调用在账务投影中 book_id 为 NULL，按调用编号补归档。
    for (const callId of plan.openingCallIds) {
      this.database.prepare(`
        INSERT INTO account_usage_purge_archive (${archiveColumns})
        SELECT source_kind, source_id, owner_id, book_id, provider, model_id,
          source_state, usage_state, input_tokens, output_tokens, consumed_tokens,
          reserved_tokens, cash_micros, consumed_units, reserved_units, recorded_at,
          completed_at, ?, ?
        FROM account_usage_live_projection
        WHERE source_kind = 'v7_opening' AND source_id = ?
      `).run(record.operationId, record.deletedAt, callId);
    }
  }

  #deleteOpeningRows(scope: BookScope, plan: BookPurgePlan): void {
    for (const callId of plan.openingCallIds) {
      this.database.prepare('DELETE FROM v7_opening_agent_model_calls WHERE owner_id = ? AND request_id = ?')
        .run(scope.ownerId, callId);
    }
    for (const taskId of plan.openingTaskIds) {
      this.database.prepare('DELETE FROM v7_opening_agent_tasks WHERE owner_id = ? AND task_id = ?')
        .run(scope.ownerId, taskId);
    }
    if (plan.openingDraftOwners.length > 0) {
      this.database.prepare('DELETE FROM opening_drafts WHERE owner_id = ?').run(scope.ownerId);
    }
  }

  #deleteTm2Rows(scope: BookScope): void {
    for (const table of TM2_BOOK_TABLES) {
      this.database.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE owner = ? AND book = ?`)
        .run(scope.ownerId, scope.bookId);
    }
  }

  #deletePortableRows(scope: BookScope): void {
    const operationScope = `
      owner_id = ? AND (
        book_id = ? OR source_book_id = ? OR target_book_id = ?
      )
    `;
    const operationParameters = [scope.ownerId, scope.bookId, scope.bookId, scope.bookId];

    this.database.prepare(`
      DELETE FROM portable_files
      WHERE portable_manifest_id IN (
        SELECT manifest.portable_manifest_id
        FROM portable_manifests AS manifest
        LEFT JOIN portable_operations AS operation
          ON operation.portable_operation_id = manifest.portable_operation_id
        WHERE manifest.owner_id = ? AND (
          manifest.book_id = ? OR (
            operation.owner_id = ? AND (
              operation.book_id = ? OR operation.source_book_id = ? OR operation.target_book_id = ?
            )
          )
        )
      )
    `).run(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId, scope.bookId, scope.bookId);

    this.database.prepare(`
      DELETE FROM import_quarantine_checks
      WHERE portable_operation_id IN (
        SELECT portable_operation_id FROM portable_operations WHERE ${operationScope}
      )
    `).run(...operationParameters);

    this.database.prepare(`
      DELETE FROM restore_impact_reports
      WHERE target_book_id = ? OR portable_operation_id IN (
        SELECT portable_operation_id FROM portable_operations WHERE ${operationScope}
      )
    `).run(scope.bookId, ...operationParameters);

    this.database.prepare(`
      DELETE FROM portable_manifests
      WHERE owner_id = ? AND (
        book_id = ? OR portable_operation_id IN (
          SELECT portable_operation_id FROM portable_operations WHERE ${operationScope}
        )
      )
    `).run(scope.ownerId, scope.bookId, ...operationParameters);

    this.database.prepare(`DELETE FROM portable_operations WHERE ${operationScope}`).run(...operationParameters);
  }

  #deleteScopedRows(scope: BookScope): void {
    for (const table of this.#scopedTableNames()) {
      this.database.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE owner_id = ? AND book_id = ?`)
        .run(scope.ownerId, scope.bookId);
    }
  }

  /** owner_id+book_id 动态扫描（排除保留表）；新迁移新增的同名结构表自动纳入。 */
  #scopedTableNames(): string[] {
    return this.#allTableNames().filter((table) => {
      if (table === 'books' || PURGE_KEEP_TABLES.has(table)) return false;
      const columns = this.#columnsOf(table);
      return columns.has('owner_id') && columns.has('book_id');
    });
  }

  #allTableNames(): string[] {
    const rows = this.database.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as unknown as TableNameRow[];
    return rows.map((row) => row.name);
  }

  #columnsOf(table: string): Set<string> {
    const identifier = quoteIdentifier(table);
    const columns = this.database.prepare(`PRAGMA table_info(${identifier})`).all() as unknown as TableColumnRow[];
    return new Set(columns.map((column) => column.name));
  }

  #rowids(sql: string, parameters: string[]): number[] {
    const rows = this.database.prepare(sql).all(...parameters) as unknown as RowidRow[];
    return rows.map((row) => row.rowid);
  }

  #count(sql: string, parameters: Array<string | number>): number {
    const row = this.database.prepare(sql).get(...parameters) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
