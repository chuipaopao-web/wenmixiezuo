import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolCallService } from '../../../apps/api/src/application/calls/tool-call-service.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { createServer as createApiServer } from '../../../apps/api/src/http/server.js';
import { RestrictedHttpToolAdapter, RestrictedSubprocessToolAdapter } from '../../../apps/api/src/infrastructure/tools/tool-adapter.js';
import { initializeRuntimeBook } from '../../helpers/runtime-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  context?.close();
  context = undefined;
});

function setup() {
  context = createTestContext();
  const ids = new SequenceIds();
  const clock = new FixedClock();
  const scope = { ownerId: context.config.ownerId, bookId: 'book-tools' };
  const agent = initializeRuntimeBook(context, scope, ids, clock)[0]!;
  new TaskService(context.database, context.config.releaseId, clock).create(scope, {
    taskId: 'task-tools', taskType: 'tool_probe', assignedAgentId: agent.agentId,
    idempotencyKey: 'tool-probe', initialPhase: 'execute', brief: {}
  });
  return { scope, agent, calls: new ToolCallService(context.database, clock) };
}

describe('工具调用账本与底层真实取消', () => {
  it('HTTP取消会传到真实请求且保留interrupted状态', async () => {
    const fixture = setup();
    let requestAborted = false;
    server = createServer((request, response) => {
      request.once('aborted', () => { requestAborted = true; });
      setTimeout(() => { if (!response.destroyed) response.end('late'); }, 5_000).unref();
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('测试HTTP地址无效');
    const origin = `http://127.0.0.1:${address.port}`;
    const call = {
      toolCallId: 'tool-http', taskId: 'task-tools', phaseKey: 'http', agentId: fixture.agent.agentId,
      toolName: 'restricted_http', parameters: { url: `${origin}/slow` }, idempotencyKey: 'http-slow'
    };
    const pending = fixture.calls.execute(fixture.scope, call, new RestrictedHttpToolAdapter(new Set([origin])));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fixture.calls.cancel(call.toolCallId)).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requestAborted).toBe(true);
    expect(context!.database.prepare(`SELECT state, error_class FROM tool_calls WHERE tool_call_id = ?`).get(call.toolCallId))
      .toEqual({ state: 'interrupted', error_class: 'cancelled' });
  });

  it('子进程取消会终止真实进程，不留下活动句柄或成功结果', async () => {
    const fixture = setup();
    const adapter = new RestrictedSubprocessToolAdapter(process.execPath, process.cwd());
    const call = {
      toolCallId: 'tool-process', taskId: 'task-tools', phaseKey: 'process', agentId: fixture.agent.agentId,
      toolName: 'restricted_subprocess', parameters: { args: ['-e', 'setInterval(() => {}, 1000)'] }, idempotencyKey: 'process-slow'
    };
    const pending = fixture.calls.execute(fixture.scope, call, adapter);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(adapter.activeProcessCount).toBe(1);
    expect(fixture.calls.cancel(call.toolCallId)).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(adapter.activeProcessCount).toBe(0);
    expect(context!.database.prepare(`SELECT state, result_reference FROM tool_calls WHERE tool_call_id = ?`).get(call.toolCallId))
      .toEqual({ state: 'interrupted', result_reference: null });
  });

  it('任务取消REST入口会向下中止同任务的活动工具调用', async () => {
    const fixture = setup();
    const adapter = new RestrictedSubprocessToolAdapter(process.execPath, process.cwd());
    const call = {
      toolCallId: 'tool-route-process', taskId: 'task-tools', phaseKey: 'route-process', agentId: fixture.agent.agentId,
      toolName: 'restricted_subprocess', parameters: { args: ['-e', 'setInterval(() => {}, 1000)'] }, idempotencyKey: 'route-process-slow'
    };
    const pending = fixture.calls.execute(fixture.scope, call, adapter);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const app = await createApiServer(context!.config, context!.database, { trustedTest: true });
    try {
      const response = await app.inject({ method: 'POST', url: `/api/v1/books/${fixture.scope.bookId}/tasks/task-tools/cancel` });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ status: 'cancelled', cancelledModelCalls: 0, cancelledToolCalls: 1 });
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(adapter.activeProcessCount).toBe(0);
      expect(context!.database.prepare(`SELECT state FROM tool_calls WHERE tool_call_id = ?`).get(call.toolCallId)).toEqual({ state: 'interrupted' });
    } finally {
      await app.close();
    }
  });
});
