import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { BackupService } from '../../apps/api/src/infrastructure/recovery/backup-service.js';
import { resolveInside, safeSegment, sha256File } from '../../apps/api/src/infrastructure/files/file-utils.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const FIRST_CONFIRMATION = 'YES';
const SECOND_CONFIRMATION_PREFIX = 'CONFIRM:';
const SAFE_AUTHOR_DATA_ROOTS = new Set([
  'books', 'portable', 'imports', 'exports', 'indexes', 'quarantine', 'staging'
]);
const STANDALONE_AUTHOR_TABLES = [
  'opening_drafts',
  'positioning_drafts',
  'prebook_opening_design_calls',
  'v7_opening_agent_candidates',
  'v7_opening_agent_model_calls',
  'v7_opening_agent_tasks',
  'quarantine_items'
] as const;
const PRESERVED_TABLES = [
  'owners',
  'user_accounts',
  'auth_sessions',
  'auth_audit_events',
  'user_memberships',
  'membership_transactions'
] as const;
const PRESERVED_CONFIGURATION_TABLES = [
  'schema_meta', 'schema_migrations', 'release_runs', 'worker_health',
  'role_templates', 'classification_tags', 'technique_cards',
  'embedding_model_snapshots', 'model_capability_snapshots', 'prompt_template_snapshots',
  'internal_structure_method_versions', 'internal_structure_method_scopes',
  'agent_skill_versions_v6', 'creative_template_versions_v6',
  'embedding_vector_cache',
  'platform_model_scheme', 'platform_prompt_overrides', 'narrative_method_overrides',
  'v7_opening_agent_role_settings', 'v7_opening_agent_member_settings',
  'v7_opening_agent_member_setting_events', 'v7_setting_member_settings',
  'v7_agent_governance_meta', 'v7_agent_governance_member_settings',
  'v7_agent_governance_task_policies', 'v7_agent_governance_events',
  'v7_prompt_governance_meta', 'v7_prompt_asset_versions', 'v7_prompt_governance_events'
] as const;
const PRESERVED_AUDIT_TABLES = [
  'backup_files', 'backups', 'deletion_tombstones', 'clean_cutover_operations', 'clean_cutover_delete_guard',
  'admin_issue_records'
] as const;
const VOLATILE_PRESERVED_TABLES = new Set([
  'backups', 'backup_files', 'clean_cutover_operations', 'clean_cutover_delete_guard',
  'worker_health', 'deletion_tombstones'
]);
const WORKER_HEARTBEAT_FRESH_MS = 30_000;
const RECENT_WORK_FRESH_MS = 2 * 60 * 60 * 1_000;
const WORK_TIMESTAMP_COLUMNS = [
  'heartbeat_at', 'updated_at', 'started_at', 'entered_at', 'recorded_at', 'created_at', 'available_at'
] as const;

interface ActiveWorkRule {
  table: string;
  column?: string;
  values?: readonly string[];
  predicate?: string;
  freshnessMs?: number;
  freshnessColumns?: readonly string[];
}

const ACTIVE_WORK_RULES: readonly ActiveWorkRule[] = [
  {
    table: 'worker_health',
    predicate: '1=1',
    freshnessMs: WORKER_HEARTBEAT_FRESH_MS,
    freshnessColumns: ['heartbeat_at']
  },
  { table: 'operations', column: 'status', values: ['pending', 'working'] },
  { table: 'recovery_log', column: 'status', values: ['started'] },
  { table: 'portable_operations', column: 'status', values: ['preparing'] },
  { table: 'budget_reservations', column: 'status', values: ['reserved'] },
  { table: 'tasks', column: 'status', values: ['pending', 'queued', 'working'] },
  { table: 'task_phases', column: 'status', values: ['pending', 'working'] },
  { table: 'model_calls', column: 'state', values: ['pending', 'working'] },
  { table: 'tool_calls', column: 'state', values: ['pending', 'working'] },
  { table: 'chapter_batches', column: 'status', values: ['pending', 'working'] },
  { table: 'chapter_pipeline_runs', column: 'status', values: ['pending', 'working'] },
  { table: 'task_attempts', column: 'status', values: ['working'] },
  { table: 'writer_leases', predicate: '1=1', freshnessColumns: ['updated_at'] },
  { table: 'writing_orders', column: 'status', values: ['active'] },
  { table: 'review_panels', column: 'status', values: ['frozen', 'working'] },
  { table: 'revision_orders', column: 'status', values: ['active'] },
  { table: 'creative_sessions', column: 'status', values: ['exploring', 'awaiting_direction', 'planning', 'awaiting_plan'] },
  { table: 'creative_session_rounds', column: 'status', values: ['queued', 'working'] },
  { table: 'knowledge_promotions', column: 'status', values: ['pending'] },
  { table: 'continuation_imports', column: 'status', values: ['importing'] },
  { table: 'continuation_chapter_analyses', column: 'status', values: ['pending', 'analyzing'] },
  { table: 'continuation_baselines', column: 'status', values: ['pending', 'analyzing'] },
  { table: 'retrieval_query_plans', column: 'status', values: ['planned', 'running'] },
  { table: 'context_compression_snapshots', column: 'status', values: ['building'] },
  { table: 'chunk_snapshots', column: 'status', values: ['building'] },
  { table: 'projection_outbox', column: 'status', values: ['pending', 'claimed'] },
  { table: 'projection_jobs', column: 'status', values: ['queued', 'building', 'validating'] },
  { table: 'projection_watermarks', column: 'status', values: ['pending', 'building'] },
  { table: 'vector_index_manifests', column: 'status', values: ['building'] },
  { table: 'canon_index_requests', column: 'status', values: ['pending', 'claimed'] },
  { table: 'ai_node_batches_v6', column: 'status', values: ['queued', 'working'] },
  { table: 'ai_node_batch_members_v6', column: 'status', values: ['queued', 'working'] },
  { table: 'prebook_opening_design_calls', column: 'state', values: ['working'] },
  { table: 'v7_opening_agent_tasks', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_opening_agent_model_calls', column: 'state', values: ['working'] },
  { table: 'v7_setting_batches', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_setting_item_jobs', column: 'state', values: ['queued', 'working', 'chief_review'] },
  { table: 'v7_setting_model_calls', column: 'state', values: ['working'] },
  { table: 'v7_book_title_design_calls', column: 'state', values: ['working'] },
  { table: 'v7_book_cover_designs', column: 'state', values: ['working'] },
  { table: 'v7_planning_recipe_runs', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_planning_generation_runs', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_planning_maintenance_runs', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_planning_model_calls', column: 'state', values: ['working'] },
  { table: 'v7_character_context_packs', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_character_maintenance_runs', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_character_model_calls', column: 'state', values: ['working'] },
  { table: 'v7_creation_workflows', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_creation_context_packs', column: 'status', values: ['queued', 'working'] },
  { table: 'v7_formalization_outbox', column: 'status', values: ['pending', 'working'] },
  { table: 'v7_creation_model_calls', column: 'state', values: ['working'] },
  { table: 'v7_creation_stage_jobs', column: 'status', values: ['pending', 'working'] },
  { table: 'v7_managed_creation_runs', column: 'status', values: ['active'] },
  { table: 'account_usage_supplemental_calls', column: 'state', values: ['working'] }
] as const;

interface TableNameRow { name: string; type?: string }
interface ColumnRow { name: string; pk?: number }
interface ForeignKeyRow { table: string }
interface CountRow { total: number }
interface VerifiedBackupRow { backup_path: string; database_hash: string; status: string }
interface UsageSummaryRow {
  consumedTokens: number;
  reservedTokens: number;
  consumedUnits: number;
  reservedUnits: number;
  calls: number;
}

export interface CleanCutoverFileEntry {
  id: string;
  relativePath: string;
  kind: 'file' | 'directory' | 'any';
  source: string;
  expectedHash: string | null;
}

export interface CleanCutoverPreview {
  previewId: string;
  generatedAt: string;
  databaseBytes: number | null;
  schemaFingerprint: string;
  books: number;
  chapters: number;
  manuscriptVersions: number;
  v7ManuscriptVersions: number;
  openingDrafts: number;
  positioningDrafts: number;
  openingTasks: number;
  openingCandidates: number;
  usage: {
    consumedTokens: number;
    reservedTokens: number;
    consumedUnits: number;
    reservedUnits: number;
    calls: number;
  };
  registeredFiles: number;
  fileManifest: { entries: CleanCutoverFileEntry[]; hash: string; unsafePaths: string[] };
  activeWork: Array<{ table: string; count: number; hash: string }>;
  staleWork: Array<{ table: string; count: number; hash: string }>;
  deleteTables: Array<{ table: string; rows: number; hash: string }>;
  preserve: Array<{ table: string; rows: number; hash: string }>;
}

export interface CleanCutoverResult {
  operationId: string;
  previewId: string;
  deletedBooks: number;
  deletedRows: number;
  deletedFiles: number;
  alreadyMissingFiles: number;
  preserved: CleanCutoverPreview['preserve'];
  foreignKeyViolations: number;
}

export function previewCleanCutover(
  database: DatabaseSync,
  options: { databasePath?: string; dataDir?: string; now?: Date } = {}
): CleanCutoverPreview {
  const effectiveNow = options.now ?? new Date();
  const classification = classifySchema(database);
  if (classification.unclassified.length > 0) {
    throw new Error(`存在未分类数据表，拒绝清理：${classification.unclassified.join(', ')}`);
  }
  const deleteTables = classification.deleteTables.map((table) => ({
    table,
    rows: tableCount(database, table),
    hash: tableHash(database, table)
  }));
  const usage = usageSummary(database);
  const preserve = classification.preserveTables
    .filter((table) => !VOLATILE_PRESERVED_TABLES.has(table))
    .map((table) => ({ table, rows: tableCount(database, table), hash: tableHash(database, table) }));
  const { activeWork, staleWork } = workStateCounts(database, effectiveNow);
  const schemaFingerprint = schemaHash(database);
  const fileManifest = buildFileManifest(database, options.dataDir);
  const fingerprint = {
    schemaFingerprint,
    deleteTables,
    preserve,
    usage,
    activeWork,
    staleWork,
    fileManifestHash: fileManifest.hash
  };
  return {
    previewId: createHash('sha256').update(stableJson(fingerprint)).digest('hex'),
    generatedAt: effectiveNow.toISOString(),
    databaseBytes: options.databasePath === undefined ? null : safeFileSize(options.databasePath),
    schemaFingerprint,
    books: safeCount(database, 'books'),
    chapters: safeCount(database, 'chapters'),
    manuscriptVersions: safeCount(database, 'manuscript_versions'),
    v7ManuscriptVersions: safeCount(database, 'v7_manuscript_versions'),
    openingDrafts: safeCount(database, 'opening_drafts'),
    positioningDrafts: safeCount(database, 'positioning_drafts'),
    openingTasks: safeCount(database, 'v7_opening_agent_tasks'),
    openingCandidates: safeCount(database, 'v7_opening_agent_candidates'),
    usage: {
      consumedTokens: Number(usage.consumedTokens ?? 0),
      reservedTokens: Number(usage.reservedTokens ?? 0),
      consumedUnits: Number(usage.consumedUnits ?? 0),
      reservedUnits: Number(usage.reservedUnits ?? 0),
      calls: Number(usage.calls ?? 0)
    },
    registeredFiles: safeCount(database, 'file_registry'),
    fileManifest,
    activeWork,
    staleWork,
    deleteTables,
    preserve
  };
}

export function applyCleanCutoverReset(database: DatabaseSync, input: {
  dataDir: string;
  expectedPreviewId: string;
  confirmation: string;
  secondConfirmation: string;
  backupId: string;
  now?: Date;
  removePath?: (path: string, recursive: boolean) => void;
}): CleanCutoverResult {
  if (input.confirmation !== FIRST_CONFIRMATION) throw new Error('首次永久删除确认必须精确输入 YES');
  if (input.secondConfirmation !== `${SECOND_CONFIRMATION_PREFIX}${input.expectedPreviewId}`) {
    throw new Error('第二次确认与影响预览不匹配');
  }
  const unfinished = database.prepare(`SELECT operation_id AS operationId, status
    FROM clean_cutover_operations WHERE status IN ('database_cleared','file_cleanup_failed')
    ORDER BY created_at LIMIT 1`).get() as { operationId: string; status: string } | undefined;
  if (unfinished !== undefined) {
    throw new Error(`存在未完成的文件清理，请先续跑 ${unfinished.operationId}`);
  }
  const effectiveNow = input.now ?? new Date();
  const backup = requireVerifiedBackup(
    database,
    input.backupId,
    input.dataDir,
    input.expectedPreviewId,
    effectiveNow
  );
  const nowIso = effectiveNow.toISOString();
  let preview: CleanCutoverPreview;
  let deletedRows = 0;
  let deletedBooks = 0;
  let operationId = '';
  database.exec('BEGIN IMMEDIATE');
  try {
    preview = previewCleanCutover(database, {
      dataDir: input.dataDir,
      now: effectiveNow
    });
    if (preview.previewId !== input.expectedPreviewId) throw new Error('数据已变化，请重新生成影响预览');
    if (preview.activeWork.length > 0) throw new Error('仍有任务正在执行，不能清理');
    if (preview.fileManifest.unsafePaths.length > 0) {
      throw new Error(`存在不安全的作者文件路径，拒绝清理：${preview.fileManifest.unsafePaths.join(', ')}`);
    }
    operationId = `v7-clean-cutover-${preview.previewId}`;
    deletedRows = preview.deleteTables.reduce((sum, table) => sum + table.rows, 0);
    database.prepare(`INSERT INTO clean_cutover_operations (
      operation_id, preview_id, backup_id, backup_database_hash,
      first_confirmation_hash, second_confirmation_hash,
      file_manifest_json, file_manifest_hash, status, deleted_books, deleted_rows, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`).run(
      operationId,
      preview.previewId,
      input.backupId,
      backup.database_hash,
      createHash('sha256').update(input.confirmation).digest('hex'),
      createHash('sha256').update(input.secondConfirmation).digest('hex'),
      JSON.stringify(preview.fileManifest.entries),
      preview.fileManifest.hash,
      preview.books,
      deletedRows,
      nowIso
    );
    if (workStateCounts(database, effectiveNow).activeWork.length > 0) {
      throw new Error('写锁内复核发现仍有任务正在执行，不能清理');
    }
    database.exec('PRAGMA defer_foreign_keys = ON');
    if (tableExists(database, 'deletion_tombstones') && tableExists(database, 'books')) {
      const resurrected = Number((database.prepare(`SELECT COUNT(*) AS total FROM books
        INNER JOIN deletion_tombstones tombstone
          ON tombstone.owner_id=books.owner_id AND tombstone.deleted_book_id=books.book_id`).get() as unknown as CountRow).total);
      if (resurrected > 0) throw new Error('发现已存在删除墓碑的书籍，拒绝重复清理');
      const confirmationHash = createHash('sha256').update(stableJson({
        previewId: preview.previewId,
        backupId: input.backupId,
        confirmation: input.confirmation,
        secondConfirmation: input.secondConfirmation
      })).digest('hex');
      database.prepare(`INSERT OR IGNORE INTO deletion_tombstones (
        tombstone_id, owner_id, deleted_book_id, deleted_book_title,
        deletion_operation_id, confirmation_text_hash, deleted_at
      ) SELECT 'cutover-' || lower(hex(randomblob(16))), owner_id, book_id, title,
        ?, ?, ? FROM books`).run(operationId, confirmationHash, nowIso);
    }
    database.prepare(`INSERT INTO clean_cutover_delete_guard (
      guard_id, operation_id, authorization_hash, created_at
    ) VALUES (1, ?, ?, ?)`).run(
      operationId,
      createHash('sha256').update(stableJson({
        operationId,
        previewId: preview.previewId,
        backupId: input.backupId,
        confirmation: input.confirmation,
        secondConfirmation: input.secondConfirmation
      })).digest('hex'),
      nowIso
    );
    for (const entry of preview.deleteTables) {
      const result = database.prepare(`DELETE FROM ${quoteIdentifier(entry.table)}`).run();
      if (entry.table === 'books') deletedBooks = Number(result.changes);
    }
    database.prepare('DELETE FROM clean_cutover_delete_guard WHERE guard_id=1 AND operation_id=?').run(operationId);
    const violations = database.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) throw new Error(`清理后发现 ${violations.length} 项外键异常`);
    deletedRows = preview.deleteTables.reduce(
      (sum, entry) => sum + entry.rows - tableCount(database, entry.table),
      0
    );
    assertDatabaseCleared(database, preview, operationId);
    database.prepare(`UPDATE clean_cutover_operations
      SET status='database_cleared', deleted_books=?, deleted_rows=?, database_cleared_at=?
      WHERE operation_id=?`).run(deletedBooks, deletedRows, nowIso, operationId);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  const cleanup = resumeCleanCutoverFiles(database, {
    dataDir: input.dataDir,
    operationId,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.removePath === undefined ? {} : { removePath: input.removePath })
  });
  return {
    operationId,
    previewId: input.expectedPreviewId,
    deletedBooks,
    deletedRows,
    deletedFiles: cleanup.removedExisting,
    alreadyMissingFiles: cleanup.alreadyMissing,
    preserved: currentPreserveSnapshot(database),
    foreignKeyViolations: database.prepare('PRAGMA foreign_key_check').all().length
  };
}

export function resumeCleanCutoverFiles(database: DatabaseSync, input: {
  dataDir: string;
  operationId: string;
  now?: Date;
  removePath?: (path: string, recursive: boolean) => void;
}): { removedExisting: number; alreadyMissing: number } {
  const row = database.prepare(`SELECT file_manifest_json, file_manifest_hash, file_cleanup_json, status
    FROM clean_cutover_operations WHERE operation_id=?`).get(input.operationId) as {
      file_manifest_json: string; file_manifest_hash: string; file_cleanup_json: string; status: string;
    } | undefined;
  if (row === undefined) throw new Error('清理操作不存在');
  if (!['database_cleared', 'file_cleanup_failed', 'completed'].includes(row.status)) {
    throw new Error('数据库尚未完成清理，不能处理文件');
  }
  const entries = JSON.parse(row.file_manifest_json) as CleanCutoverFileEntry[];
  if (hashJson(entries) !== row.file_manifest_hash) throw new Error('文件清理清单哈希不匹配');
  const state = JSON.parse(row.file_cleanup_json) as Record<string, 'removed' | 'already_missing'>;
  const remover = input.removePath ?? ((path: string, recursive: boolean) => rmSync(path, { force: true, recursive }));
  const ordered = [...entries].sort((left, right) => {
    if (left.kind === right.kind) return right.relativePath.length - left.relativePath.length;
    return left.kind === 'directory' ? 1 : -1;
  });
  try {
    for (const entry of ordered) {
      if (state[entry.id] !== undefined) continue;
      const path = resolveAuthorDataPath(input.dataDir, entry.relativePath);
      const existed = existsSync(path);
      if (existed) {
        if (entry.expectedHash !== null && hashFileSystemPath(path, entry.kind) !== entry.expectedHash) {
          throw new Error(`作者文件在清理前发生变化：${entry.relativePath}`);
        }
        const recursive = entry.kind === 'directory' || lstatSync(path).isDirectory();
        remover(path, recursive);
        if (existsSync(path)) throw new Error(`作者文件未能移除：${entry.relativePath}`);
      }
      state[entry.id] = existed ? 'removed' : 'already_missing';
      persistFileCleanup(database, input.operationId, state, 'database_cleared', null);
    }
    const counts = cleanupCounts(state);
    database.prepare(`UPDATE clean_cutover_operations SET status='completed', file_cleanup_json=?,
      removed_existing_paths=?, already_missing_paths=?, error_message=NULL, completed_at=? WHERE operation_id=?`).run(
      JSON.stringify(state), counts.removedExisting, counts.alreadyMissing,
      (input.now ?? new Date()).toISOString(), input.operationId
    );
    return counts;
  } catch (error) {
    persistFileCleanup(database, input.operationId, state, 'file_cleanup_failed',
      error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function classifySchema(database: DatabaseSync): {
  deleteTables: string[];
  preserveTables: string[];
  unclassified: string[];
} {
  const allTables = listRelations(database);
  const byName = new Set(allTables.map((row) => row.name));
  const preserve = new Set<string>([
    ...PRESERVED_TABLES,
    ...PRESERVED_CONFIGURATION_TABLES,
    ...PRESERVED_AUDIT_TABLES
  ].filter((table) => byName.has(table)));
  const selected = new Set<string>();
  for (const { name } of allTables) {
    if (preserve.has(name)) continue;
    const columns = tableColumns(database, name);
    const names = new Set(columns.map((column) => column.name));
    if (names.has('owner_id') && names.has('book_id')) selected.add(name);
  }
  if (byName.has('books')) selected.add('books');
  for (const table of STANDALONE_AUTHOR_TABLES) if (byName.has(table)) selected.add(table);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { name, type } of allTables) {
      if (selected.has(name) || preserve.has(name) || type === 'virtual') continue;
      const parents = database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all() as unknown as ForeignKeyRow[];
      if (parents.some((foreignKey) => selected.has(foreignKey.table))) {
        selected.add(name);
        changed = true;
      }
    }
  }
  const unclassified = allTables.map((entry) => entry.name)
    .filter((table) => !preserve.has(table) && !selected.has(table));
  return {
    deleteTables: [...selected].sort((left, right) => left === 'books' ? 1 : right === 'books' ? -1 : left.localeCompare(right)),
    preserveTables: [...preserve].sort(),
    unclassified
  };
}

function workStateCounts(database: DatabaseSync, now: Date): {
  activeWork: Array<{ table: string; count: number; hash: string }>;
  staleWork: Array<{ table: string; count: number; hash: string }>;
} {
  const activeWork: Array<{ table: string; count: number; hash: string }> = [];
  const staleWork: Array<{ table: string; count: number; hash: string }> = [];
  for (const rule of ACTIVE_WORK_RULES) {
    if (!tableExists(database, rule.table)) continue;
    const columns = new Set(tableColumns(database, rule.table).map((column) => column.name));
    let candidatePredicate: string;
    let candidateParameters: readonly string[] = [];
    if (rule.predicate !== undefined) {
      candidatePredicate = rule.predicate;
    } else {
      if (rule.column === undefined || rule.values === undefined || !columns.has(rule.column)) continue;
      candidatePredicate = `${quoteIdentifier(rule.column)} IN (${rule.values.map(() => '?').join(',')})`;
      candidateParameters = rule.values;
    }
    const freshnessColumns = (rule.freshnessColumns ?? WORK_TIMESTAMP_COLUMNS)
      .filter((column) => columns.has(column));
    const timestampExpression = latestTimestampExpression(freshnessColumns);
    const freshnessCutoff = new Date(now.getTime() - (rule.freshnessMs ?? RECENT_WORK_FRESH_MS)).toISOString();
    const freshnessPredicate = timestampExpression === null
      ? '1=1'
      : `(${timestampExpression} = '' OR julianday(${timestampExpression}) IS NULL OR julianday(${timestampExpression}) >= julianday(?))`;
    const freshnessParameters = timestampExpression === null ? [] : [freshnessCutoff];
    const leasePredicate = columns.has('lease_expires_at')
      ? `${quoteIdentifier('lease_expires_at')} IS NOT NULL AND julianday(${quoteIdentifier('lease_expires_at')}) > julianday(?)`
      : null;
    const activeEvidencePredicate = leasePredicate === null
      ? freshnessPredicate
      : `((${leasePredicate}) OR (${freshnessPredicate}))`;
    const activeEvidenceParameters = leasePredicate === null
      ? freshnessParameters
      : [now.toISOString(), ...freshnessParameters];
    const activePredicate = `(${candidatePredicate}) AND (${activeEvidencePredicate})`;
    const activeParameters = [...candidateParameters, ...activeEvidenceParameters];
    const stalePredicate = `(${candidatePredicate}) AND NOT (${activeEvidencePredicate})`;
    const staleParameters = [...candidateParameters, ...activeEvidenceParameters];
    appendWorkSnapshot(activeWork, database, rule.table, activePredicate, activeParameters);
    appendWorkSnapshot(staleWork, database, rule.table, stalePredicate, staleParameters);
  }
  return {
    activeWork: activeWork.sort((left, right) => left.table.localeCompare(right.table)),
    staleWork: staleWork.sort((left, right) => left.table.localeCompare(right.table))
  };
}

function latestTimestampExpression(columns: readonly string[]): string | null {
  if (columns.length === 0) return null;
  if (columns.length === 1) return `COALESCE(${quoteIdentifier(columns[0]!)}, '')`;
  return `max(${columns.map((column) => `COALESCE(${quoteIdentifier(column)}, '')`).join(', ')})`;
}

function appendWorkSnapshot(
  target: Array<{ table: string; count: number; hash: string }>,
  database: DatabaseSync,
  table: string,
  predicate: string,
  parameters: readonly string[]
): void {
  const count = Number((database.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)} WHERE ${predicate}`)
    .get(...parameters) as unknown as CountRow).total);
  if (count > 0) target.push({ table, count, hash: tableHash(database, table, predicate, parameters) });
}

function buildFileManifest(database: DatabaseSync, dataDir?: string): CleanCutoverPreview['fileManifest'] {
  const raw: Array<Omit<CleanCutoverFileEntry, 'id'>> = [];
  if (tableExists(database, 'file_registry')) {
    const rows = database.prepare(`SELECT relative_path AS path, content_hash AS hash FROM file_registry ORDER BY relative_path`)
      .all() as Array<{ path: string; hash: string }>;
    for (const row of rows) raw.push({ relativePath: row.path, kind: 'file', source: 'file_registry', expectedHash: row.hash });
  }
  if (tableExists(database, 'v7_book_cover_designs')) {
    const rows = database.prepare(`SELECT image_relative_path AS path, image_content_hash AS hash
      FROM v7_book_cover_designs WHERE image_relative_path IS NOT NULL ORDER BY image_relative_path`)
      .all() as Array<{ path: string; hash: string | null }>;
    for (const row of rows) raw.push({ relativePath: row.path, kind: 'file', source: 'v7_book_cover_designs', expectedHash: row.hash });
  }
  collectKnownPaths(database, raw, 'quarantine_items', 'source_path', 'any');
  collectKnownPaths(database, raw, 'continuation_imports', 'source_relative_path', 'file');
  collectKnownPaths(database, raw, 'chat_attachments', 'source_relative_path', 'file');
  collectKnownPaths(database, raw, 'chat_attachments', 'extracted_relative_path', 'file');
  collectKnownPaths(database, raw, 'author_attachments', 'source_relative_path', 'file');
  collectKnownPaths(database, raw, 'author_attachments', 'extracted_relative_path', 'file');
  collectKnownPaths(database, raw, 'vector_index_manifests', 'index_path', 'any');
  if (tableExists(database, 'portable_operations')) {
    const rows = database.prepare(`SELECT operation_type AS type, package_name AS name
      FROM portable_operations WHERE package_name IS NOT NULL ORDER BY portable_operation_id`)
      .all() as Array<{ type: string; name: string }>;
    for (const row of rows) raw.push({
      relativePath: `${row.type === 'export' ? 'exports' : 'imports'}/${row.name}`,
      kind: 'file',
      source: 'portable_operations',
      expectedHash: null
    });
  }
  if (tableExists(database, 'books')) {
    const rows = database.prepare('SELECT book_id AS bookId FROM books ORDER BY book_id').all() as Array<{ bookId: string }>;
    for (const row of rows) {
      let bookId = row.bookId;
      try { bookId = safeSegment(bookId, 'bookId'); } catch { /* unsafe path is reported below */ }
      raw.push({ relativePath: `books/${bookId}`, kind: 'directory', source: 'books', expectedHash: null });
    }
  }
  const unique = new Map<string, Omit<CleanCutoverFileEntry, 'id'>>();
  for (const item of raw) {
    const relativePath = normalizeRelative(item.relativePath);
    const previous = unique.get(relativePath);
    if (previous === undefined || previous.kind !== 'directory') unique.set(relativePath, { ...item, relativePath });
  }
  const directoryRoots = [...unique.values()]
    .filter((item) => item.kind === 'directory')
    .map((item) => item.relativePath);
  const compact = [...unique.values()].filter((item) => item.kind === 'directory' || !directoryRoots.some(
    (directory) => item.relativePath.startsWith(`${directory}/`)
  ));
  const unsafePaths: string[] = [];
  const entries = compact.sort((left, right) => left.relativePath.localeCompare(right.relativePath)).map((item) => {
    let expectedHash = item.expectedHash;
    try {
      if (!isSafeAuthorDataPath(item.relativePath)) throw new Error('路径不在作者数据目录');
      if (dataDir !== undefined) {
        const path = resolveAuthorDataPath(dataDir, item.relativePath);
        if (existsSync(path)) {
          const actualHash = hashFileSystemPath(path, item.kind);
          if (expectedHash !== null && item.kind === 'file' && expectedHash !== actualHash) {
            throw new Error('登记哈希与实际文件不一致');
          }
          expectedHash = actualHash;
        } else {
          expectedHash = null;
        }
      }
    } catch (error) {
      unsafePaths.push(`${item.relativePath}（${error instanceof Error ? error.message : String(error)}）`);
    }
    const normalized = { ...item, expectedHash };
    return { ...normalized, id: hashJson(normalized) };
  });
  return { entries, hash: hashJson(entries), unsafePaths };
}

function collectKnownPaths(
  database: DatabaseSync,
  target: Array<Omit<CleanCutoverFileEntry, 'id'>>,
  table: string,
  column: string,
  kind: CleanCutoverFileEntry['kind']
): void {
  if (!tableExists(database, table)) return;
  const columns = new Set(tableColumns(database, table).map((item) => item.name));
  if (!columns.has(column)) return;
  const rows = database.prepare(`SELECT ${quoteIdentifier(column)} AS path FROM ${quoteIdentifier(table)}
    WHERE ${quoteIdentifier(column)} IS NOT NULL ORDER BY ${quoteIdentifier(column)}`).all() as Array<{ path: string }>;
  for (const row of rows) target.push({ relativePath: row.path, kind, source: table, expectedHash: null });
}

function tableHash(
  database: DatabaseSync,
  table: string,
  predicate?: string,
  parameters: readonly (string | number | null)[] = []
): string {
  const columns = tableColumns(database, table);
  const primaryKey = columns.filter((column) => Number(column.pk ?? 0) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk));
  const orderBy = primaryKey.length > 0
    ? primaryKey.map((column) => quoteIdentifier(column.name)).join(', ')
    : 'rowid';
  const where = predicate === undefined ? '' : ` WHERE ${predicate}`;
  const statement = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}${where} ORDER BY ${orderBy}`);
  const hash = createHash('sha256');
  for (const row of statement.iterate(...parameters)) hash.update(`${stableJson(row)}\n`);
  return hash.digest('hex');
}

function tableCount(database: DatabaseSync, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`).get() as unknown as CountRow).total);
}

function safeCount(database: DatabaseSync, table: string): number {
  return tableExists(database, table) ? tableCount(database, table) : 0;
}

function listRelations(database: DatabaseSync): TableNameRow[] {
  return database.prepare(`SELECT name, type FROM pragma_table_list
    WHERE schema='main' AND type IN ('table','virtual') AND name NOT LIKE 'sqlite_%'
    ORDER BY name`).all() as unknown as TableNameRow[];
}

function tableColumns(database: DatabaseSync, table: string): ColumnRow[] {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as unknown as ColumnRow[];
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return database.prepare(`SELECT 1 AS found FROM sqlite_schema WHERE type = 'table' AND name = ?`).get(table) !== undefined;
}

function relationExists(database: DatabaseSync, name: string): boolean {
  return database.prepare(`SELECT 1 AS found FROM sqlite_schema WHERE type IN ('table','view') AND name = ?`).get(name) !== undefined;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function schemaHash(database: DatabaseSync): string {
  const rows = database.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type, name`).all();
  return hashJson(rows);
}

function usageSummary(database: DatabaseSync): UsageSummaryRow {
  if (!relationExists(database, 'account_usage_projection')) {
    throw new Error('统一用量投影视图缺失，无法证明历史算力已纳入清理范围');
  }
  return database.prepare(`SELECT
      COALESCE(SUM(consumed_tokens), 0) AS consumedTokens,
      COALESCE(SUM(reserved_tokens), 0) AS reservedTokens,
      COALESCE(SUM(consumed_units), 0) AS consumedUnits,
      COALESCE(SUM(reserved_units), 0) AS reservedUnits,
      COUNT(*) AS calls
    FROM account_usage_projection`).get() as unknown as UsageSummaryRow;
}

function currentPreserveSnapshot(database: DatabaseSync): CleanCutoverPreview['preserve'] {
  const classification = classifySchema(database);
  if (classification.unclassified.length > 0) {
    throw new Error(`存在未分类数据表：${classification.unclassified.join(', ')}`);
  }
  return classification.preserveTables
    .filter((table) => !VOLATILE_PRESERVED_TABLES.has(table))
    .map((table) => ({ table, rows: tableCount(database, table), hash: tableHash(database, table) }));
}

function assertDatabaseCleared(
  database: DatabaseSync,
  preview: CleanCutoverPreview,
  operationId: string
): void {
  const remaining = preview.deleteTables
    .map((entry) => ({ table: entry.table, rows: tableCount(database, entry.table) }))
    .filter((entry) => entry.rows > 0);
  if (remaining.length > 0) {
    throw new Error(`清理后仍残留业务数据：${remaining.map((entry) => `${entry.table}=${entry.rows}`).join(', ')}`);
  }
  const usage = usageSummary(database);
  if (Object.values(usage).some((value) => Number(value) !== 0)) {
    throw new Error(`清理后历史算力未归零：${stableJson(usage)}`);
  }
  const preserved = currentPreserveSnapshot(database);
  if (stableJson(preserved) !== stableJson(preview.preserve)) {
    throw new Error('账号、会员或系统配置在清理事务中发生变化');
  }
  if (tableExists(database, 'deletion_tombstones')) {
    const tombstones = Number((database.prepare(`SELECT COUNT(*) AS total FROM deletion_tombstones
      WHERE deletion_operation_id=?`).get(operationId) as unknown as CountRow).total);
    if (tombstones !== preview.books) {
      throw new Error(`删除墓碑数量不匹配：预期 ${preview.books}，实际 ${tombstones}`);
    }
  }
}

function requireVerifiedBackup(
  database: DatabaseSync,
  backupId: string,
  dataDir: string,
  expectedPreviewId: string,
  now: Date
): VerifiedBackupRow {
  const row = database.prepare(`SELECT backup_path, database_hash, status FROM backups WHERE backup_id=?`)
    .get(backupId) as VerifiedBackupRow | undefined;
  if (row === undefined || row.status !== 'verified' || row.database_hash === null || row.database_hash.length !== 64) {
    throw new Error('清理前必须提供已完成恢复验证的备份');
  }
  const backupRoot = resolveBackupRoot(dataDir, row.backup_path);
  const backupDatabasePath = resolveInside(backupRoot, 'database.sqlite');
  if (!existsSync(backupDatabasePath) || sha256File(backupDatabasePath) !== row.database_hash) {
    throw new Error('已验证备份数据库不存在或哈希不匹配');
  }
  const backupDatabase = new DatabaseSync(backupDatabasePath, { readOnly: true });
  let backupFileManifestHash = '';
  try {
    const backupPreview = previewCleanCutover(backupDatabase, { dataDir, now });
    if (backupPreview.previewId !== expectedPreviewId) {
      throw new Error('已验证备份与本次影响预览不一致');
    }
    backupFileManifestHash = backupPreview.fileManifest.hash;
  } finally {
    backupDatabase.close();
  }
  verifyCutoverFileBackup(
    backupRoot,
    dataDir,
    expectedPreviewId,
    backupFileManifestHash
  );
  return row;
}

export function prepareCleanCutoverFileBackup(
  database: DatabaseSync,
  input: { dataDir: string; backupId: string; preview: CleanCutoverPreview }
): { manifestHash: string; copiedPaths: number } {
  const row = database.prepare(`SELECT backup_path, database_hash, status FROM backups WHERE backup_id=?`)
    .get(input.backupId) as VerifiedBackupRow | undefined;
  if (row === undefined || row.status !== 'verified') throw new Error('只有已验证备份可以追加作者文件清单');
  if (input.preview.fileManifest.unsafePaths.length > 0) throw new Error('影响预览包含不安全文件路径');
  const backupRoot = resolveBackupRoot(input.dataDir, row.backup_path);
  const manifestPath = resolveInside(backupRoot, 'clean-cutover-files.json');
  if (existsSync(manifestPath)) {
    const existing = JSON.parse(readFileSync(manifestPath, 'utf8')) as CutoverFileBackupManifest;
    verifyCutoverFileBackup(
      backupRoot,
      input.dataDir,
      input.preview.previewId,
      input.preview.fileManifest.hash
    );
    return { manifestHash: existing.manifestHash, copiedPaths: existing.items.filter((item) => item.present).length };
  }
  const objectRoot = resolveInside(backupRoot, 'clean-cutover-files');
  mkdirSync(objectRoot, { recursive: false });
  const items: CutoverFileBackupItem[] = [];
  for (const entry of input.preview.fileManifest.entries) {
    const source = resolveAuthorDataPath(input.dataDir, entry.relativePath);
    if (!existsSync(source)) {
      items.push({ id: entry.id, relativePath: entry.relativePath, present: false, contentHash: null });
      continue;
    }
    const actualHash = hashFileSystemPath(source, entry.kind);
    if (entry.expectedHash !== actualHash) throw new Error(`作者文件在预览后发生变化：${entry.relativePath}`);
    const destination = resolveInside(objectRoot, entry.id);
    cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
    if (hashFileSystemPath(destination, entry.kind) !== actualHash) throw new Error(`作者文件备份校验失败：${entry.relativePath}`);
    items.push({ id: entry.id, relativePath: entry.relativePath, present: true, contentHash: actualHash });
  }
  const body = {
    previewId: input.preview.previewId,
    fileManifestHash: input.preview.fileManifest.hash,
    items
  };
  const manifest: CutoverFileBackupManifest = { ...body, manifestHash: hashJson(body) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  verifyCutoverFileBackup(
    backupRoot,
    input.dataDir,
    input.preview.previewId,
    input.preview.fileManifest.hash
  );
  return { manifestHash: manifest.manifestHash, copiedPaths: items.filter((item) => item.present).length };
}

interface CutoverFileBackupItem {
  id: string;
  relativePath: string;
  present: boolean;
  contentHash: string | null;
}

interface CutoverFileBackupManifest {
  previewId: string;
  fileManifestHash: string;
  items: CutoverFileBackupItem[];
  manifestHash: string;
}

function verifyCutoverFileBackup(
  backupRoot: string,
  dataDir: string,
  expectedPreviewId: string,
  expectedFileManifestHash: string
): void {
  const manifestPath = resolveInside(backupRoot, 'clean-cutover-files.json');
  if (!existsSync(manifestPath)) throw new Error('备份缺少本次清理的作者文件清单');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CutoverFileBackupManifest;
  const body = {
    previewId: manifest.previewId,
    fileManifestHash: manifest.fileManifestHash,
    items: manifest.items
  };
  if (manifest.previewId !== expectedPreviewId
    || manifest.fileManifestHash !== expectedFileManifestHash
    || manifest.manifestHash !== hashJson(body)) {
    throw new Error('作者文件备份清单与本次影响预览不一致');
  }
  const objectRoot = resolveInside(backupRoot, 'clean-cutover-files');
  for (const item of manifest.items) {
    if (!isSafeAuthorDataPath(item.relativePath)) throw new Error(`作者文件备份清单路径不安全：${item.relativePath}`);
    const backupPath = resolveInside(objectRoot, item.id);
    if (!item.present) {
      if (existsSync(backupPath)) throw new Error(`作者文件备份清单状态不一致：${item.relativePath}`);
      continue;
    }
    if (!existsSync(backupPath) || item.contentHash === null || hashFileSystemPath(backupPath, 'any') !== item.contentHash) {
      throw new Error(`作者文件备份损坏：${item.relativePath}`);
    }
    const currentPath = resolveAuthorDataPath(dataDir, item.relativePath);
    if (!existsSync(currentPath) || hashFileSystemPath(currentPath, 'any') !== item.contentHash) {
      throw new Error(`作者文件在备份后发生变化：${item.relativePath}`);
    }
  }
}

function persistFileCleanup(
  database: DatabaseSync,
  operationId: string,
  state: Record<string, 'removed' | 'already_missing'>,
  status: 'database_cleared' | 'file_cleanup_failed',
  error: string | null
): void {
  const counts = cleanupCounts(state);
  database.prepare(`UPDATE clean_cutover_operations SET status=?, file_cleanup_json=?,
    removed_existing_paths=?, already_missing_paths=?, error_message=? WHERE operation_id=?`).run(
    status, JSON.stringify(state), counts.removedExisting, counts.alreadyMissing, error, operationId
  );
}

function cleanupCounts(state: Record<string, 'removed' | 'already_missing'>): {
  removedExisting: number;
  alreadyMissing: number;
} {
  return {
    removedExisting: Object.values(state).filter((value) => value === 'removed').length,
    alreadyMissing: Object.values(state).filter((value) => value === 'already_missing').length
  };
}

function normalizeRelative(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isSafeAuthorDataPath(path: string): boolean {
  const normalized = normalizeRelative(path);
  if (normalized.length === 0 || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.length < 2 || !SAFE_AUTHOR_DATA_ROOTS.has(segments[0] ?? '')) return false;
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    && !/[\u0000-\u001f:*?"<>|]/.test(segment));
}

function resolveAuthorDataPath(dataDir: string, relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (!isSafeAuthorDataPath(normalized)) throw new Error(`不安全的作者文件路径：${relativePath}`);
  const target = resolveInside(dataDir, normalized);
  assertNoSymlinkTraversal(dataDir, target);
  return target;
}

function resolveBackupRoot(dataDir: string, relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  const segments = normalized.split('/');
  if (segments.length < 2 || segments[0] !== 'backups'
    || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..'
      || /[\u0000-\u001f:*?"<>|]/.test(segment))) {
    throw new Error(`备份路径不安全：${relativePath}`);
  }
  const target = resolveInside(dataDir, normalized);
  assertNoSymlinkTraversal(dataDir, target);
  return target;
}

function assertNoSymlinkTraversal(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const relative = resolvedTarget.slice(resolvedRoot.length).replace(/^[/\\]+/, '');
  let current = resolvedRoot;
  for (const segment of relative.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`路径包含符号链接：${segment}`);
    }
  }
}

function hashFileSystemPath(path: string, expectedKind: CleanCutoverFileEntry['kind']): string {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error('不允许符号链接');
  if (stat.isFile()) {
    if (expectedKind === 'directory') throw new Error('预期目录但实际为文件');
    return sha256File(path);
  }
  if (!stat.isDirectory()) throw new Error('只允许普通文件或目录');
  if (expectedKind === 'file') throw new Error('预期文件但实际为目录');
  const hash = createHash('sha256');
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new Error(`目录包含符号链接：${entry.name}`);
    const child = resolve(path, entry.name);
    hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${entry.name}:${hashFileSystemPath(child, entry.isDirectory() ? 'directory' : 'file')}\n`);
  }
  return hash.digest('hex');
}

function safeFileSize(path: string): number | null {
  try { return statSync(path).size; } catch { return null; }
}

async function main(): Promise<void> {
  const config = loadRuntimeConfig(process.env);
  const database = openDatabase(config.databasePath);
  try {
    const resumeOperationId = argumentValue('--resume');
    if (resumeOperationId !== '') {
      const cleanup = resumeCleanCutoverFiles(database, {
        dataDir: config.dataDir,
        operationId: resumeOperationId
      });
      process.stdout.write(`${JSON.stringify({ operationId: resumeOperationId, ...cleanup }, null, 2)}\n`);
      return;
    }
    const preview = previewCleanCutover(database, {
      databasePath: config.databasePath,
      dataDir: config.dataDir
    });
    if (!process.argv.includes('--execute')) {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
      return;
    }
    const confirmation = argumentValue('--confirm');
    const secondConfirmation = argumentValue('--second-confirm');
    if (confirmation !== FIRST_CONFIRMATION || secondConfirmation !== `${SECOND_CONFIRMATION_PREFIX}${preview.previewId}`) {
      throw new Error(`执行需要 --confirm YES 和 --second-confirm ${SECOND_CONFIRMATION_PREFIX}${preview.previewId}`);
    }
    if (preview.activeWork.length > 0) throw new Error('仍有任务正在执行，不能清理');
    const backups = new BackupService(database, config);
    const backup = backups.create();
    const verification = backups.verify(backup.backupId);
    if (!verification.verified) throw new Error('清理前备份验证失败');
    backups.discardVerification(verification.restorePath);
    const fileBackup = prepareCleanCutoverFileBackup(database, {
      dataDir: config.dataDir,
      backupId: backup.backupId,
      preview
    });
    const result = applyCleanCutoverReset(database, {
      dataDir: config.dataDir,
      expectedPreviewId: preview.previewId,
      confirmation,
      secondConfirmation,
      backupId: backup.backupId
    });
    const evidenceDir = resolve(config.dataDir, 'verification');
    mkdirSync(evidenceDir, { recursive: true });
    const evidence = {
      ...result,
      backupId: backup.backupId,
      backupDatabaseHash: verification.databaseHash,
      fileBackupManifestHash: fileBackup.manifestHash,
      fileBackupPaths: fileBackup.copiedPaths
    };
    writeFileSync(resolve(evidenceDir, `v7-clean-cutover-${preview.previewId}.json`), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    database.close();
  }
}

function argumentValue(name: string): string {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : process.argv[index + 1] ?? '';
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
