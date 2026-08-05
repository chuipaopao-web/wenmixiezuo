import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export type PresenceStatus = '待命' | '读取资料' | '思考方案' | '调用工具' | '写作' | '审校' | '等待确认' | '暂停' | '受阻' | '离线';

export interface AgentPresence {
  agentId: string;
  roleName: string;
  provider: string;
  modelId: string;
  status: PresenceStatus;
  availability: 'available' | 'unavailable';
  taskId: string | null;
  heartbeatAt: string | null;
}

interface PresenceRow {
  agent_id: string;
  role_name: string;
  provider: string;
  model_id: string;
  activation_state: 'idle' | 'standby' | 'paused' | 'disabled';
  task_id: string | null;
  task_status: string | null;
  current_phase: string | null;
  heartbeat_at: string | null;
  model_working: number;
  tool_working: number;
}

export class PresenceService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly clock: Clock
  ) {}

  public list(scope: BookScope): AgentPresence[] {
    assertBookScope(scope);
    // P0-2 / R02: Presence 当前活动只认每个 Agent 至多一条“最新、同书、非终态”任务。
    // blocked/failed/cancelled/succeeded 不表示成员正在工作；interrupted 只进任务中心，
    // 不把成员伪装成持续工作。这里只取 working/waiting_confirmation/paused，并用窗口
    // 函数保证每个 Agent 至多一条，历史 blocked 不再污染 Presence、不再产生重复行。
    const rows = this.database.prepare(`
      WITH current_tasks AS (
        SELECT t.assigned_agent_id, t.task_id, t.status, t.current_phase, t.heartbeat_at,
               ROW_NUMBER() OVER (
                 PARTITION BY t.assigned_agent_id
                 ORDER BY CASE t.status
                            WHEN 'working' THEN 0
                            WHEN 'waiting_confirmation' THEN 1
                            WHEN 'paused' THEN 2
                            ELSE 3 END,
                          t.updated_at DESC
               ) AS rn
        FROM tasks t
        WHERE t.owner_id = ? AND t.book_id = ?
          AND t.status IN ('working', 'paused', 'waiting_confirmation')
      )
      SELECT a.agent_id, r.display_name AS role_name, m.provider, m.model_id,
             a.activation_state, ct.task_id, ct.status AS task_status, ct.current_phase,
             ct.heartbeat_at,
             EXISTS(SELECT 1 FROM model_calls mc WHERE mc.task_id = ct.task_id AND mc.state = 'working') AS model_working,
             EXISTS(SELECT 1 FROM tool_calls tc WHERE tc.task_id = ct.task_id AND tc.state = 'working') AS tool_working
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      LEFT JOIN current_tasks ct ON ct.assigned_agent_id = a.agent_id AND ct.rn = 1
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
      ORDER BY r.category, r.role_template_id
    `).all(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId) as unknown as PresenceRow[];
    return rows.map((row) => ({
      agentId: row.agent_id,
      roleName: row.role_name,
      provider: row.provider,
      modelId: row.model_id,
      status: deriveStatus(row, this.clock.now()),
      availability: row.activation_state === 'disabled' ? 'unavailable' : 'available',
      taskId: row.task_id,
      heartbeatAt: row.heartbeat_at
    }));
  }
}

function deriveStatus(row: PresenceRow, now: Date): PresenceStatus {
  if (row.activation_state === 'disabled') return '离线';
  if (row.activation_state === 'paused' || row.task_status === 'paused') return '暂停';
  if (row.task_status === 'blocked') return '受阻';
  if (row.task_status === 'waiting_confirmation') return '等待确认';
  if (row.task_status !== 'working' || row.task_id === null) return '待命';
  // 心跳属于当前任务，不属于成员身份。任务心跳过期表示任务需要恢复，
  // 不能把一个仍已启用、仍可接新任务的成员误判为离线。
  if (row.heartbeat_at === null || now.getTime() - Date.parse(row.heartbeat_at) > 15_000) return '受阻';
  if (row.tool_working === 1) return '调用工具';
  if (row.model_working === 1 && row.current_phase?.includes('write')) return '写作';
  if (row.model_working === 1 && row.current_phase?.includes('review')) return '审校';
  if (row.model_working === 1) return '思考方案';
  if (row.current_phase?.includes('read') === true || row.current_phase?.includes('context') === true) return '读取资料';
  return '思考方案';
}
