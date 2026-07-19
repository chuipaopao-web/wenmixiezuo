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
    const rows = this.database.prepare(`
      SELECT a.agent_id, r.display_name AS role_name, m.provider, m.model_id,
             a.activation_state, t.task_id, t.status AS task_status, t.current_phase,
             t.heartbeat_at,
             EXISTS(SELECT 1 FROM model_calls mc WHERE mc.task_id = t.task_id AND mc.state = 'working') AS model_working,
             EXISTS(SELECT 1 FROM tool_calls tc WHERE tc.task_id = t.task_id AND tc.state = 'working') AS tool_working
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      LEFT JOIN tasks t ON t.assigned_agent_id = a.agent_id AND t.status IN ('working', 'paused', 'blocked', 'waiting_confirmation')
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
      ORDER BY r.category, r.role_template_id
    `).all(scope.ownerId, scope.bookId) as unknown as PresenceRow[];
    return rows.map((row) => ({
      agentId: row.agent_id,
      roleName: row.role_name,
      provider: row.provider,
      modelId: row.model_id,
      status: deriveStatus(row, this.clock.now()),
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
  if (row.heartbeat_at === null || now.getTime() - Date.parse(row.heartbeat_at) > 15_000) return '离线';
  if (row.tool_working === 1) return '调用工具';
  if (row.model_working === 1 && row.current_phase?.includes('write')) return '写作';
  if (row.model_working === 1 && row.current_phase?.includes('review')) return '审校';
  if (row.model_working === 1) return '思考方案';
  if (row.current_phase?.includes('read') === true || row.current_phase?.includes('context') === true) return '读取资料';
  return '思考方案';
}
