import type { DatabaseSync } from 'node:sqlite';

export interface V7TaskAuditRow {
  sourceId: string;
  taskId: string;
  ownerId: string;
  bookId: string | null;
  taskType: string;
  workflowNode: string;
  status: string;
  errorCode: string | null;
  errorSummary: string | null;
  failureStage: string | null;
  retrySafety: string | null;
  memberKey: string | null;
  occurredAt: string;
}

export interface V7TaskAuditFilter {
  ownerId?: string;
  bookId?: string;
  start?: string;
  end?: string;
  failuresOnly?: boolean;
  limit?: number;
}

export interface V7AdminIssueAuditFilter {
  query?: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'ignored';
  sourceType?: 'failed_task' | 'feedback';
  offset: number;
  limit: number;
}

export interface V7AdminIssueAuditRow {
  sourceType: 'failed_task' | 'feedback';
  sourceId: string;
  taskId: string | null;
  bookId: string | null;
  bookTitle: string;
  userId: string | null;
  displayName: string;
  email: string;
  category: string;
  detail: string;
  errorCode: string | null;
  failureStage: string | null;
  retrySafety: string | null;
  pagePath: string;
  occurredAt: string;
  status: 'open' | 'in_progress' | 'resolved' | 'ignored';
  severity: 'low' | 'medium' | 'high' | 'critical';
  note: string;
}

/**
 * V7 后台任务投影。只汇总当前 V7 独立任务表，不读取历史 tasks、旧团队或旧批次表。
 * 每种来源加前缀形成稳定 sourceId，避免不同表的本地任务编号相撞。
 */
export class V7TaskAuditRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public list(filter: V7TaskAuditFilter = {}): V7TaskAuditRow[] {
    const { where, values } = auditWhere(filter);
    const limit = Math.min(10_000, Math.max(1, filter.limit ?? 1_000));
    return this.database.prepare(`SELECT * FROM (${V7_TASK_AUDIT_SQL}) audit
      ${where} ORDER BY occurredAt DESC,sourceId DESC LIMIT ?`)
      .all(...values, limit) as unknown as V7TaskAuditRow[];
  }

  public count(filter: Omit<V7TaskAuditFilter, 'limit'> = {}): number {
    const { where, values } = auditWhere(filter);
    return Number((this.database.prepare(`SELECT COUNT(*) AS value FROM (${V7_TASK_AUDIT_SQL}) audit ${where}`)
      .get(...values) as { value: number }).value);
  }

  public latestForBook(ownerId: string, bookId: string): V7TaskAuditRow | null {
    return this.list({ ownerId, bookId, limit: 1 })[0] ?? null;
  }

  public bySourceId(sourceId: string): V7TaskAuditRow | null {
    const row = this.database.prepare(`SELECT * FROM (${V7_TASK_AUDIT_SQL}) audit
      WHERE sourceId=? LIMIT 1`).get(sourceId) as unknown as V7TaskAuditRow | undefined;
    return row ?? null;
  }

  /**
   * 作者端仍可能只持有各任务表的本地 taskId；后台问题记录则使用带来源前缀的 sourceId。
   * 仅在引用唯一时接受本地 taskId，避免不同 V7 任务表编号碰撞后串到错误任务。
   */
  public uniqueForOwnerReference(ownerId: string, reference: string): V7TaskAuditRow | null {
    const rows = this.database.prepare(`SELECT * FROM (${V7_TASK_AUDIT_SQL}) audit
      WHERE ownerId=? AND (sourceId=? OR taskId=?) LIMIT 2`)
      .all(ownerId, reference, reference) as unknown as V7TaskAuditRow[];
    return rows.length === 1 ? rows[0] ?? null : null;
  }

  public issuePage(filter: V7AdminIssueAuditFilter): { items: V7AdminIssueAuditRow[]; total: number } {
    const conditions: string[] = [];
    const values: string[] = [];
    const add = (condition: string, value: string): void => { conditions.push(condition); values.push(value); };
    if (filter.status !== undefined) add('status=?', filter.status);
    if (filter.sourceType !== undefined) add('sourceType=?', filter.sourceType);
    const query = filter.query?.trim() ?? '';
    if (query.length > 0) {
      add(`INSTR(LOWER(
        COALESCE(displayName,'')||' '||COALESCE(email,'')||' '||COALESCE(bookTitle,'')||' '||
        COALESCE(category,'')||' '||COALESCE(detail,'')
      ),LOWER(?))>0`, query);
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
    const offset = Math.max(0, filter.offset);
    const limit = Math.min(100, Math.max(1, filter.limit));
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS value
      FROM (${V7_ADMIN_ISSUE_AUDIT_SQL}) issue ${where}`).get(...values) as { value: number }).value);
    const items = this.database.prepare(`SELECT * FROM (${V7_ADMIN_ISSUE_AUDIT_SQL}) issue ${where}
      ORDER BY occurredAt DESC,sourceType,sourceId LIMIT ? OFFSET ?`)
      .all(...values, limit, offset) as unknown as V7AdminIssueAuditRow[];
    return { items, total };
  }

  public countOpenFailures(): number {
    return Number((this.database.prepare(`SELECT COUNT(*) AS value FROM (${V7_TASK_AUDIT_SQL}) audit
      LEFT JOIN admin_issue_records issue
        ON issue.source_type='failed_task' AND issue.source_id=audit.sourceId
      WHERE audit.status IN ('failed','partially_failed')
        AND (
          COALESCE(issue.status,'open') IN ('open','in_progress')
          OR (issue.status IN ('resolved','ignored') AND audit.occurredAt>issue.updated_at)
        )`).get() as { value: number }).value);
  }

}

function auditWhere(filter: Omit<V7TaskAuditFilter, 'limit'>): { where: string; values: string[] } {
  const conditions: string[] = [];
  const values: string[] = [];
  const add = (condition: string, value: string): void => { conditions.push(condition); values.push(value); };
  if (filter.ownerId !== undefined) add('ownerId=?', filter.ownerId);
  if (filter.bookId !== undefined) add('bookId=?', filter.bookId);
  if (filter.start !== undefined) add('occurredAt>=?', filter.start);
  if (filter.end !== undefined) add('occurredAt<?', filter.end);
  if (filter.failuresOnly === true) conditions.push("status IN ('failed','partially_failed')");
  return { where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`, values };
}

const V7_TASK_AUDIT_SQL = `
  SELECT 'opening:'||task_id AS sourceId,task_id AS taskId,owner_id AS ownerId,NULL AS bookId,
    'opening_design' AS taskType,phase AS workflowNode,
    CASE WHEN error_code='archived_by_author' THEN 'archived' ELSE status END AS status,error_code AS errorCode,
    error_message AS errorSummary,NULL AS failureStage,NULL AS retrySafety,
    COALESCE(selected_chief_member_key,selected_screenwriter_member_key) AS memberKey,
    updated_at AS occurredAt FROM v7_opening_agent_tasks
  UNION ALL
  SELECT 'setting:'||j.job_id,j.job_id,j.owner_id,j.book_id,
    CASE json_extract(b.custom_items_json,'$.taskKind')
      WHEN 'item_fusion' THEN 'setting_item_fusion'
      WHEN 'item_review' THEN 'setting_item_review'
      WHEN 'item_revision' THEN 'setting_item_review'
      ELSE 'setting_item'
    END,
    j.state,j.state,b.error_code,
    b.error_message,b.failure_stage,b.retry_safety,j.assigned_member_key,j.updated_at FROM v7_setting_item_jobs j
    JOIN v7_setting_batches b ON b.owner_id=j.owner_id AND b.book_id=j.book_id AND b.batch_id=j.batch_id
  UNION ALL
  SELECT 'setting-batch:'||b.batch_id,b.batch_id,b.owner_id,b.book_id,
    CASE json_extract(b.custom_items_json,'$.taskKind')
      WHEN 'catalog_recommendation' THEN 'setting_catalog_recommendation'
      WHEN 'batch_final_review' THEN 'setting_final_review'
      WHEN 'item_redesign' THEN 'setting_item_redesign'
      WHEN 'item_fusion' THEN 'setting_item_fusion'
      WHEN 'item_revision' THEN 'setting_item_revision'
    END,
    COALESCE(
      json_extract(b.custom_items_json,'$.phase'),
      json_extract(b.custom_items_json,'$.itemKey'),
      json_extract(b.custom_items_json,'$.taskKind')
    ),
    b.status,b.error_code,b.error_message,b.failure_stage,b.retry_safety,
    COALESCE(
      json_extract(b.custom_items_json,'$.assignedMemberKey'),
      (SELECT call.member_key FROM v7_setting_model_calls call
        WHERE call.owner_id=b.owner_id AND call.book_id=b.book_id AND call.batch_id=b.batch_id
        ORDER BY call.updated_at DESC,call.request_id DESC LIMIT 1),
      json_extract(b.custom_items_json,'$.memberKeys[0]')
    ),
    b.updated_at
  FROM v7_setting_batches b
  WHERE json_extract(b.custom_items_json,'$.taskKind') IN (
    'catalog_recommendation','batch_final_review','item_redesign','item_fusion','item_revision'
  )
    AND NOT EXISTS (
      SELECT 1 FROM v7_setting_item_jobs job
      WHERE job.owner_id=b.owner_id AND job.book_id=b.book_id AND job.batch_id=b.batch_id
    )
  UNION ALL
  SELECT 'title:'||design_id,design_id,owner_id,book_id,'title_design','title',state,NULL,
    failure_message,NULL,NULL,member_key,updated_at FROM v7_book_title_design_calls
  UNION ALL
  SELECT 'cover:'||design_id,design_id,owner_id,book_id,'cover_design','cover',state,NULL,
    failure_message,NULL,NULL,COALESCE(visual_member_key,chief_member_key),updated_at FROM v7_book_cover_designs
  UNION ALL
  SELECT 'planning-recipe:'||run_id,run_id,owner_id,book_id,'planning_recipe',current_phase,status,NULL,
    error_message,NULL,NULL,NULL,updated_at FROM v7_planning_recipe_runs
  UNION ALL
  SELECT 'planning-tree:'||generation_run_id,generation_run_id,owner_id,book_id,'planning_tree',tree_kind,status,NULL,
    error_message,NULL,NULL,assigned_member_key,updated_at FROM v7_planning_generation_runs
  UNION ALL
  SELECT 'planning-maintenance:'||maintenance_run_id,maintenance_run_id,owner_id,book_id,'planning_maintenance',source_kind,status,NULL,
    error_message,NULL,NULL,assigned_member_key,updated_at FROM v7_planning_maintenance_runs
  UNION ALL
  SELECT 'character-context:'||context_pack_id,context_pack_id,owner_id,book_id,'character_context',task_kind,status,NULL,
    error_message,NULL,NULL,selection_member_key,updated_at FROM v7_character_context_packs
  UNION ALL
  SELECT 'character-maintenance:'||maintenance_run_id,maintenance_run_id,owner_id,book_id,'character_maintenance',source_kind,status,NULL,
    error_message,NULL,NULL,assigned_member_key,updated_at FROM v7_character_maintenance_runs
  UNION ALL
  SELECT 'creation:'||workflow_id,workflow_id,owner_id,book_id,'creation_workflow',stage,status,NULL,
    error_message,NULL,NULL,NULL,updated_at FROM v7_creation_workflows
  UNION ALL
  SELECT 'creation-context:'||context_pack_id,context_pack_id,owner_id,book_id,'creation_context',task_kind,status,NULL,
    error_message,NULL,NULL,assigned_member_key,updated_at FROM v7_creation_context_packs
  UNION ALL
  SELECT 'formalization:'||event_id,event_id,owner_id,book_id,'formalization',event_kind,status,NULL,
    error_message,NULL,NULL,NULL,updated_at FROM v7_formalization_outbox
  UNION ALL
  SELECT 'stage-settlement:'||job_id,job_id,owner_id,book_id,'stage_settlement',settlement_kind,status,NULL,
    error_message,NULL,NULL,NULL,updated_at FROM v7_creation_stage_jobs
  UNION ALL
  SELECT 'managed-creation:'||workflow_id,workflow_id,owner_id,book_id,'managed_creation',mode,status,NULL,
    error_message,NULL,NULL,writer_member_key,updated_at FROM v7_managed_creation_runs`;

const V7_ADMIN_ISSUE_AUDIT_SQL = `
  SELECT source.*,
    CASE
      WHEN source.sourceType='failed_task' AND issue.status IN ('resolved','ignored')
        AND source.occurredAt>issue.updated_at THEN 'open'
      ELSE COALESCE(issue.status,'open')
    END AS status,
    COALESCE(issue.severity,CASE source.sourceType WHEN 'failed_task' THEN 'high' ELSE 'medium' END) AS severity,
    COALESCE(issue.admin_note,'') AS note
  FROM (
    SELECT 'failed_task' AS sourceType,audit.sourceId,audit.taskId,audit.bookId,
      COALESCE(book.title,'') AS bookTitle,account.user_id AS userId,
      COALESCE(account.display_name,'未关联账号') AS displayName,COALESCE(account.email_normalized,'') AS email,
      audit.taskType AS category,COALESCE(audit.errorSummary,audit.errorCode,'任务失败') AS detail,
      audit.errorCode,audit.failureStage,audit.retrySafety,'' AS pagePath,audit.occurredAt
    FROM (${V7_TASK_AUDIT_SQL}) audit
    LEFT JOIN books book ON book.owner_id=audit.ownerId AND book.book_id=audit.bookId
    LEFT JOIN user_accounts account ON account.owner_id=audit.ownerId
    WHERE audit.status IN ('failed','partially_failed')
    UNION ALL
    SELECT 'feedback',feedback.feedback_id,feedback.task_id,feedback.book_id,
      COALESCE(book.title,''),account.user_id,account.display_name,account.email_normalized,
      feedback.category,feedback.message,NULL,NULL,NULL,feedback.page_path,feedback.created_at
    FROM user_feedback feedback
    JOIN user_accounts account ON account.user_id=feedback.user_id
    LEFT JOIN books book ON book.owner_id=feedback.owner_id AND book.book_id=feedback.book_id
  ) source
  LEFT JOIN admin_issue_records issue
    ON issue.source_type=source.sourceType AND issue.source_id=source.sourceId`;
