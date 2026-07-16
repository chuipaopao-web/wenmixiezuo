import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { ToolAdapter, ToolRequest, ToolResult } from '../../infrastructure/tools/tool-adapter.js';

export interface BeginToolCall {
  toolCallId: string;
  taskId: string;
  phaseKey: string;
  agentId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  idempotencyKey: string;
}

const activeToolCallControllers = new Map<string, AbortController>();

export function cancelActiveToolCall(toolCallId: string): boolean {
  const controller = activeToolCallControllers.get(toolCallId);
  if (controller === undefined) return false;
  controller.abort(new DOMException('工具调用已取消', 'AbortError'));
  return true;
}

export class ToolCallService {
  public constructor(private readonly database: DatabaseSync, private readonly clock: Clock) {}

  public begin(scope: BookScope, call: BeginToolCall): string {
    assertBookScope(scope);
    const existing = this.database.prepare(`
      SELECT tool_call_id FROM tool_calls WHERE owner_id = ? AND book_id = ? AND idempotency_key = ?
    `).get(scope.ownerId, scope.bookId, call.idempotencyKey) as { tool_call_id: string } | undefined;
    if (existing !== undefined) return existing.tool_call_id;
    const valid = this.database.prepare(`
      SELECT 1 FROM tasks t JOIN agent_instances a
        ON a.agent_id = ? AND a.owner_id = t.owner_id AND a.book_id = t.book_id AND a.enabled = 1
      WHERE t.task_id = ? AND t.owner_id = ? AND t.book_id = ?
    `).get(call.agentId, call.taskId, scope.ownerId, scope.bookId);
    if (valid === undefined) throw new Error('工具调用引用越权或不完整');
    const parametersHash = createHash('sha256').update(stableJson(call.parameters)).digest('hex');
    this.database.prepare(`
      INSERT INTO tool_calls (
        tool_call_id, owner_id, book_id, task_id, phase_key, agent_id,
        tool_name, parameters_hash, idempotency_key, state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      call.toolCallId, scope.ownerId, scope.bookId, call.taskId, call.phaseKey,
      call.agentId, call.toolName, parametersHash, call.idempotencyKey, this.clock.now().toISOString()
    );
    return call.toolCallId;
  }

  public async execute(scope: BookScope, call: BeginToolCall, adapter: ToolAdapter): Promise<ToolResult> {
    if (adapter.toolName !== call.toolName) throw new Error('工具名称与适配器不匹配');
    const toolCallId = this.begin(scope, call);
    if (toolCallId !== call.toolCallId) throw new Error('相同幂等键的工具调用已经存在，拒绝重复执行');
    const controller = new AbortController();
    activeToolCallControllers.set(toolCallId, controller);
    this.database.prepare(`UPDATE tool_calls SET state = 'working', started_at = ? WHERE tool_call_id = ? AND state = 'pending'`)
      .run(this.clock.now().toISOString(), toolCallId);
    const request: ToolRequest = { toolCallId, parameters: call.parameters };
    try {
      const result = await adapter.execute(request, controller.signal);
      const reference = `inline-sha256:${createHash('sha256').update(result.output).digest('hex')}`;
      this.database.prepare(`
        UPDATE tool_calls SET state = 'succeeded', result_reference = ?, completed_at = ?
        WHERE tool_call_id = ? AND state = 'working'
      `).run(reference, this.clock.now().toISOString(), toolCallId);
      return result;
    } catch (error) {
      const interrupted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      this.database.prepare(`
        UPDATE tool_calls SET state = ?, error_class = ?, completed_at = ?
        WHERE tool_call_id = ? AND state IN ('pending', 'working')
      `).run(interrupted ? 'interrupted' : 'failed', interrupted ? 'cancelled' : 'technical_failure', this.clock.now().toISOString(), toolCallId);
      throw error;
    } finally {
      activeToolCallControllers.delete(toolCallId);
    }
  }

  public cancel(toolCallId: string): boolean {
    return cancelActiveToolCall(toolCallId);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
