import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { ParentBudgetGuard, ParentBudgetExhausted } from '../../../scripts/evaluation/parent-budget-guard.js';

// 625cc3f7集中复核②反例：发送前统一父预留+按日志/发送状态/租约对账（禁止全批清零）。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));
function setup(limits: { requests: number; tokens: number; wallClockMs: number; leaseTtlMs?: number }, ownerTag?: string) {
  const c = createTestContext(); contexts.push(c);
  const guard = new ParentBudgetGuard(c.database, 'fc-resume-test', limits, ownerTag);
  return { c, guard };
}
const okAdapter = (calls: { n: number }) => ({
  async generate(request: { prompt: string; requestId?: string }) {
    calls.n++;
    return { output: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } };
  }
});

describe('发送边界统一父预算（上限拒绝）', () => {
  it('上限前拒绝下一次网络发送（适配器零调用）', async () => {
    const { guard } = setup({ requests: 1, tokens: 10_000_000, wallClockMs: 60_000 });
    const calls = { n: 0 };
    const wrapped = guard.wrap(okAdapter(calls));
    await wrapped.generate({ prompt: '第一次', requestId: 'r1' });
    expect(calls.n).toBe(1);
    await expect(wrapped.generate({ prompt: '第二次', requestId: 'r2' })).rejects.toThrowError(ParentBudgetExhausted);
    expect(calls.n).toBe(1);
  });

  it('并发最后一额度：两个并行预留恰好一个成功，失败者不触网', async () => {
    const { guard } = setup({ requests: 1, tokens: 10_000_000, wallClockMs: 60_000 });
    const calls = { n: 0 };
    const slow = {
      async generate(request: { prompt: string; requestId?: string }) {
        calls.n++;
        await new Promise(r => setTimeout(r, 30));
        return { output: '{}', usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 } };
      }
    };
    const wrapped = guard.wrap(slow);
    const [a, b] = await Promise.allSettled([
      wrapped.generate({ prompt: '并发A', requestId: 'ca' }),
      wrapped.generate({ prompt: '并发B', requestId: 'cb' })
    ]);
    expect([a, b].filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([a, b].filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(calls.n).toBe(1);
  });

  it('未知结果占额转unknown列：不免费、消耗事实保留', async () => {
    const { guard } = setup({ requests: 3, tokens: 10_000_000, wallClockMs: 60_000 });
    const wrapped = guard.wrap({ async generate() { throw new Error('供应商500'); } });
    await expect(wrapped.generate({ prompt: 'x', requestId: 'u1' })).rejects.toThrowError('供应商500');
    const snap = guard.snapshot();
    expect(snap.unknown).toBe(1);
    expect(snap.actual).toBe(0);
  });

  it('tokens口径同样在发送前拒绝（封套字节估算）', async () => {
    const { guard } = setup({ requests: 100, tokens: 5000, wallClockMs: 60_000 });
    const calls = { n: 0 };
    const wrapped = guard.wrap(okAdapter(calls));
    // 估算=bytes(2000)+4000+2048=8048>5000：第一次预留即超
    await expect(wrapped.generate({ prompt: 'x'.repeat(2000), requestId: 't1' })).rejects.toThrowError(ParentBudgetExhausted);
    expect(calls.n).toBe(0);
  });

  it('墙钟到限发送前拒绝（不触网）', async () => {
    const { guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 1 });
    await new Promise(r => setTimeout(r, 5));
    const calls = { n: 0 };
    await expect(guard.wrap(okAdapter(calls)).generate({ prompt: 'x', requestId: 'w1' })).rejects.toThrowError(/墙钟到限/);
    expect(calls.n).toBe(0);
  });

  it('实耗按计费分量input+output结算：reasoning单列不重复相加', async () => {
    const { c, guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 60_000 });
    const rich = {
      async generate() {
        return { output: '{}', usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 100 } };
      }
    };
    await guard.wrap(rich).generate({ prompt: 'x', requestId: 'rs1' });
    const budget = c.database.prepare('SELECT actual_tokens FROM tm2_eval_budget WHERE batch_id=?').get('fc-resume-test') as { actual_tokens: number };
    expect(budget.actual_tokens).toBe(30); // 10+20，不把reasoning100重复相加
  });
});

describe('对账：按日志+发送状态+租约（禁止全批清零）', () => {
  function forceLeaseExpired(c: TestContext, ownerTag: string): void {
    c.database.prepare('UPDATE tm2_eval_guard_lease SET heartbeat_at=? WHERE owner_tag=?')
      .run(new Date(Date.now() - 3600_000).toISOString(), ownerTag);
  }

  it('已发未返回（dispatching后崩溃）：对账转unknown占额，不释放', async () => {
    const { c, guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 60_000, leaseTtlMs: 1 }, 'dead-instance');
    // 模拟dispatching后崩溃：直接置日志为dispatching（reserve已扣）
    const repo = (guard as unknown as { repo: import('../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js').NodeEvaluationRepository }).repo;
    expect(repo.tryReserve('fc-resume-test', 'crash-1', 1, 5000)).toBe(true);
    c.database.prepare("INSERT INTO tm2_eval_reserve_journal(reserve_key,batch_id,owner_tag,requests,tokens,dispatch_mark,settled,created_at,updated_at) VALUES('crash-1','fc-resume-test','dead-instance',1,5000,'dispatching',0,?,?)")
      .run(new Date().toISOString(), new Date().toISOString());
    forceLeaseExpired(c, 'dead-instance');
    const result = guard.reconcile();
    expect(result.toUnknown).toBe(1);
    expect(result.released).toBe(0);
    const snap = guard.snapshot();
    expect(snap.unknown).toBe(1); // 占额转unknown，不释放
    expect(snap.reserved).toBe(0);
    // 多次对账不倍增
    const again = guard.reconcile();
    expect(again.toUnknown).toBe(0);
    expect(guard.snapshot().unknown).toBe(1);
  });

  it('未到发送点崩溃（reserved）：有确证未发送，释放预留', async () => {
    const { c, guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 60_000, leaseTtlMs: 1 }, 'dead-instance');
    const repo = (guard as unknown as { repo: import('../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js').NodeEvaluationRepository }).repo;
    expect(repo.tryReserve('fc-resume-test', 'ns-1', 1, 3000)).toBe(true);
    c.database.prepare("INSERT INTO tm2_eval_reserve_journal(reserve_key,batch_id,owner_tag,requests,tokens,dispatch_mark,settled,created_at,updated_at) VALUES('ns-1','fc-resume-test','dead-instance',1,3000,'reserved',0,?,?)")
      .run(new Date().toISOString(), new Date().toISOString());
    forceLeaseExpired(c, 'dead-instance');
    const result = guard.reconcile();
    expect(result.released).toBe(1);
    expect(result.toUnknown).toBe(0);
    const snap = guard.snapshot();
    expect(snap.reserved).toBe(0);
    expect(snap.unknown).toBe(0); // 未发送不占unknown
  });

  it('另一活进程条目不能被回收', async () => {
    const { c, guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 60_000, leaseTtlMs: 60_000 }, 'alive-instance');
    const repo = (guard as unknown as { repo: import('../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js').NodeEvaluationRepository }).repo;
    expect(repo.tryReserve('fc-resume-test', 'alive-1', 1, 3000)).toBe(true);
    c.database.prepare("INSERT INTO tm2_eval_reserve_journal(reserve_key,batch_id,owner_tag,requests,tokens,dispatch_mark,settled,created_at,updated_at) VALUES('alive-1','fc-resume-test','alive-instance',1,3000,'dispatching',0,?,?)")
      .run(new Date().toISOString(), new Date().toISOString());
    guard.heartbeat(); // 活进程心跳最新
    const result = guard.reconcile();
    expect(result.keptAlive).toBe(1);
    expect(result.toUnknown).toBe(0);
    expect(result.released).toBe(0);
    expect(guard.snapshot().reserved).toBe(1); // 活进程预留原样保留
  });
});
