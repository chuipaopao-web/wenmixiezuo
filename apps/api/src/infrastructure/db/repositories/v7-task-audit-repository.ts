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
    'opening_design' AS taskType,phase AS workflowNode,status,error_code AS errorCode,
    error_message AS errorSummary,COALESCE(selected_chief_member_key,selected_screenwriter_member_key) AS memberKey,
    updated_at AS occurredAt FROM v7_opening_agent_tasks
  UNION ALL
  SELECT 'setting:'||j.job_id,j.job_id,j.owner_id,j.book_id,'setting_item',j.state,j.state,NULL,
    b.error_message,j.assigned_member_key,j.updated_at FROM v7_setting_item_jobs j
    JOIN v7_setting_batches b ON b.owner_id=j.owner_id AND b.book_id=j.book_id AND b.batch_id=j.batch_id
  UNION ALL
  SELECT 'title:'||design_id,design_id,owner_id,book_id,'title_design','title',state,NULL,
    failure_message,member_key,updated_at FROM v7_book_title_design_calls
  UNION ALL
  SELECT 'cover:'||design_id,design_id,owner_id,book_id,'cover_design','cover',state,NULL,
    failure_message,COALESCE(visual_member_key,chief_member_key),updated_at FROM v7_book_cover_designs
  UNION ALL
  SELECT 'planning-recipe:'||run_id,run_id,owner_id,book_id,'planning_recipe',current_phase,status,NULL,
    error_message,NULL,updated_at FROM v7_planning_recipe_runs
  UNION ALL
  SELECT 'planning-tree:'||generation_run_id,generation_run_id,owner_id,book_id,'planning_tree',tree_kind,status,NULL,
    error_message,assigned_member_key,updated_at FROM v7_planning_generation_runs
  UNION ALL
  SELECT 'planning-maintenance:'||maintenance_run_id,maintenance_run_id,owner_id,book_id,'planning_maintenance',source_kind,status,NULL,
    error_message,assigned_member_key,updated_at FROM v7_planning_maintenance_runs
  UNION ALL
  SELECT 'character-context:'||context_pack_id,context_pack_id,owner_id,book_id,'character_context',task_kind,status,NULL,
    error_message,selection_member_key,updated_at FROM v7_character_context_packs
  UNION ALL
  SELECT 'character-maintenance:'||maintenance_run_id,maintenance_run_id,owner_id,book_id,'character_maintenance',source_kind,status,NULL,
    error_message,assigned_member_key,updated_at FROM v7_character_maintenance_runs
  UNION ALL
  SELECT 'creation:'||workflow_id,workflow_id,owner_id,book_id,'creation_workflow',stage,status,NULL,
    error_message,NULL,updated_at FROM v7_creation_workflows
  UNION ALL
  SELECT 'creation-context:'||context_pack_id,context_pack_id,owner_id,book_id,'creation_context',task_kind,status,NULL,
    error_message,assigned_member_key,updated_at FROM v7_creation_context_packs
  UNION ALL
  SELECT 'formalization:'||event_id,event_id,owner_id,book_id,'formalization',event_kind,status,NULL,
    error_message,NULL,updated_at FROM v7_formalization_outbox
  UNION ALL
  SELECT 'stage-settlement:'||job_id,job_id,owner_id,book_id,'stage_settlement',settlement_kind,status,NULL,
    error_message,NULL,updated_at FROM v7_creation_stage_jobs
  UNION ALL
  SELECT 'managed-creation:'||workflow_id,workflow_id,owner_id,book_id,'managed_creation',mode,status,NULL,
    error_message,writer_member_key,updated_at FROM v7_managed_creation_runs`;
