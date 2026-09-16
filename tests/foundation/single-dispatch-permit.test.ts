import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestContext, type TestContext } from '../helpers/test-context.js';
import { BookRepository } from '../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { TimeMachineModelGateway } from '../../apps/api/src/infrastructure/models/time-machine-model-gateway.js';
import { createSingleDispatchResolver } from '../../apps/api/src/infrastructure/models/single-dispatch-permit.js';
import type { ModelAdapter } from '../../apps/api/src/infrastructure/models/model-adapter.js';

// d7fc67f5复核项4：隔离探针硬性单调用闸门——只允许指定run/step/模型的登记attempt一次真实dispatch，
// 其余一切dispatch（后续卷卡、其他run、重启后、许可已消耗）在网络前阻止。全部fake fetch离线验证。
const contexts: TestContext[] = [];
const temps: string[] = [];
afterEach(() => {
  contexts.splice(0).forEach((c) => c.close());
  temps.splice(0).forEach((t) => rmSync(t, { recursive: true, force: true }));
});

function setup() {
  const c = createTestContext(); contexts.push(c);
  const scope = { ownerId: c.config.ownerId, bookId: 'gate-book' };
  c.database.prepare('INSERT INTO owners VALUES(?,?,1,?,?)').run(scope.ownerId, '闸门作者', '2026-09-16', '2026-09-16');
  new BookRepository(c.database).create(scope, '闸门书', '2026-09-16', 'active');
  // 目标run B的volume-card:0/volume-card:1与其他run C的volume-card:0登记attempt。
  const attempts: Record<string, string> = { 'runB:volume-card:0': 'att-b-vc0', 'runB:volume-card:1': 'att-b-vc1', 'runC:volume-card:0': 'att-c-vc0' };
  c.database.prepare("INSERT INTO tm2_books(owner,book,manifest) VALUES(?,?,'{}')").run(scope.ownerId, scope.bookId);
  for (const [step, id] of Object.entries(attempts)) {
    c.database.prepare("INSERT INTO tm2_steps(owner,book,id,input_hash,member,state,attempt) VALUES(?,?,?,'h','planner-glm-5-3','failed',?)").run(scope.ownerId, scope.bookId, step, id);
    c.database.prepare("INSERT INTO tm2_attempts(id,owner,book,step,state,started_at) VALUES(?,?,?,?,'running',1758000000000)").run(id, scope.ownerId, scope.bookId, step);
  }
  const dir = mkdtempSync(join(tmpdir(), 'wenmi-permit-')); temps.push(dir);
  return { c, scope, attempts, persistPath: join(dir, 'permit.json') };
}

function fakeAdapter(calls: { count: number }, modelId = 'glm-5.3'): ModelAdapter {
  return {
    provider: 'volcengine-ark-agent-plan', modelId,
    async generate() {
      calls.count++;
      return { provider: 'volcengine-ark-agent-plan', modelId, output: '{"ok":true}', inputTokens: 5, outputTokens: 5, cashCostCny: 0, state: 'succeeded' };
    }
  };
}

describe('单节点真实调用许可闸门（仅隔离探针使用）', () => {
  const req = (scope: { ownerId: string; bookId: string }, id: string, modelId = 'glm-5.3') => ({
    scope, id, memberId: 'planner-glm-5-3', provider: 'volcengine-ark-agent-plan', modelId,
    prompt: '卷卡提示', maxOutputTokens: 8000, thinkingHeadroomTokens: 24_000, windowTokens: 64000, temperature: 0.6
  });

  it('目标attempt放行恰好一次：绑定run/step/模型，输入hash录入许可文件', async () => {
    const { c, scope, attempts, persistPath } = setup();
    const calls = { count: 0 };
    const resolver = createSingleDispatchResolver((_provider, model) => fakeAdapter(calls, model), {
      db: c.database, runId: 'runB', stepNode: 'volume-card:0', expectedModelId: 'glm-5.3', persistPath
    });
    const gateway = new TimeMachineModelGateway(c.database, resolver);
    const output = await gateway.generate(req(scope, attempts['runB:volume-card:0']!));
    expect(output).toBe('{"ok":true}');
    expect(calls.count).toBe(1);
    const permit = JSON.parse(readFileSync(persistPath, 'utf8')) as { consumed: boolean; attemptId: string; requestHash: string };
    expect(permit.consumed).toBe(true);
    expect(permit.attemptId).toBe(attempts['runB:volume-card:0']);
    const row = c.database.prepare('SELECT request_hash FROM tm2_model_calls WHERE id=?').get(attempts['runB:volume-card:0']!) as { request_hash: string };
    expect(permit.requestHash).toBe(row.request_hash);
  });

  it('目标成功后后续卷卡不再调用：网络前阻止，fake fetch计数不变', async () => {
    const { c, scope, attempts, persistPath } = setup();
    const calls = { count: 0 };
    const resolver = createSingleDispatchResolver((_provider, model) => fakeAdapter(calls, model), {
      db: c.database, runId: 'runB', stepNode: 'volume-card:0', expectedModelId: 'glm-5.3', persistPath
    });
    const gateway = new TimeMachineModelGateway(c.database, resolver);
    await gateway.generate(req(scope, attempts['runB:volume-card:0']!));
    const error = await gateway.generate(req(scope, attempts['runB:volume-card:1']!)).catch((e) => e as { kind?: string });
    // 网关不回显适配器消息（防供应商详情外泄）；门禁拒绝以invalid类型+零新增网络计数证明。
    expect(error.kind).toBe('invalid');
    expect(calls.count).toBe(1); // 卷1未触网
  });

  it('重启（新许可实例读同一持久化文件）不重复：一切dispatch仍被阻止', async () => {
    const { c, scope, attempts, persistPath } = setup();
    const calls = { count: 0 };
    const first = new TimeMachineModelGateway(c.database, createSingleDispatchResolver((_provider, model) => fakeAdapter(calls, model), {
      db: c.database, runId: 'runB', stepNode: 'volume-card:0', expectedModelId: 'glm-5.3', persistPath
    }));
    await first.generate(req(scope, attempts['runB:volume-card:0']!));
    // 模拟进程重启：全新resolver实例，同一persistPath。
    const second = new TimeMachineModelGateway(c.database, createSingleDispatchResolver((_provider, model) => fakeAdapter(calls, model), {
      db: c.database, runId: 'runB', stepNode: 'volume-card:0', expectedModelId: 'glm-5.3', persistPath
    }));
    const e1 = await second.generate(req(scope, attempts['runB:volume-card:1']!)).catch((e) => e as { kind?: string });
    expect(e1.kind).toBe('invalid'); // 许可已消耗（持久化文件consumed=true），重启后一切dispatch被阻止
    expect(calls.count).toBe(1);
  });

  it('非目标run/未登记attempt/模型不符均无法消耗许可', async () => {
    const { c, scope, attempts, persistPath } = setup();
    const calls = { count: 0 };
    const resolver = createSingleDispatchResolver((_provider, model) => fakeAdapter(calls, model), {
      db: c.database, runId: 'runB', stepNode: 'volume-card:0', expectedModelId: 'glm-5.3', persistPath
    });
    const gateway = new TimeMachineModelGateway(c.database, resolver);
    const e1 = await gateway.generate(req(scope, attempts['runC:volume-card:0']!)).catch((e) => e as { kind?: string });
    expect(e1.kind).toBe('invalid'); // 非目标run
    const e2 = await gateway.generate(req(scope, 'att-not-registered')).catch((e) => e as { kind?: string });
    expect(e2.kind).toBe('invalid'); // 未登记attempt
    const e3 = await gateway.generate(req(scope, attempts['runB:volume-card:0']!, 'deepseek-v4-pro')).catch((e) => e as { kind?: string });
    expect(e3.kind).toBe('invalid'); // 模型与快照冻结不符
    expect(calls.count).toBe(0); // 许可未消耗、零网络
    expect(existsSync(persistPath)).toBe(false); // 拒绝不消耗许可（放行路径已由上一用例证明）
  });
});
