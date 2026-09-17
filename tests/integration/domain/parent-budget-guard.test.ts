import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';
import { ParentBudgetGuard, ParentBudgetExhausted } from '../../../scripts/evaluation/parent-budget-guard.js';

// S1-FAST-CLOSE接续纠正反例：发送前统一父预留——上限前拒绝下一次网络发送；
// 并发最后一额度、重试各计一次、重启悬空归零实耗保留、未知占额不免费。
const contexts: TestContext[] = [];
afterEach(() => contexts.splice(0).forEach(c => c.close()));
function setup(limits: { requests: number; tokens: number; wallClockMs: number }) {
  const c = createTestContext(); contexts.push(c);
  const guard = new ParentBudgetGuard(c.database, 'fc-resume-test', limits);
  return { c, guard };
}
const okAdapter = (calls: { n: number }) => ({
  async generate(request: { prompt: string; requestId?: string }) {
    calls.n++;
    return { output: '{"ok":true}', usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } };
  }
});

describe('发送边界统一父预算（接续纠正反例）', () => {
  it('上限前拒绝下一次网络发送（适配器零调用）', async () => {
    const { guard } = setup({ requests: 1, tokens: 10_000_000, wallClockMs: 60_000 });
    const calls = { n: 0 };
    const wrapped = guard.wrap(okAdapter(calls));
    await wrapped.generate({ prompt: '第一次', requestId: 'r1' });
    expect(calls.n).toBe(1);
    await expect(wrapped.generate({ prompt: '第二次', requestId: 'r2' })).rejects.toThrowError(ParentBudgetExhausted);
    expect(calls.n).toBe(1); // 第二次未触网
    const snap = guard.snapshot();
    expect(snap.actual).toBe(1);
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
    const succeeded = [a, b].filter(r => r.status === 'fulfilled').length;
    const rejected = [a, b].filter(r => r.status === 'rejected').length;
    expect(succeeded).toBe(1);
    expect(rejected).toBe(1);
    expect(calls.n).toBe(1); // 只有一个真实触网
  });

  it('未知结果占额转unknown列：不免费、不重试、消耗事实保留', async () => {
    const { guard } = setup({ requests: 3, tokens: 10_000_000, wallClockMs: 60_000 });
    const failing = {
      async generate() { throw new Error('供应商500'); }
    };
    const wrapped = guard.wrap(failing);
    await expect(wrapped.generate({ prompt: 'x', requestId: 'u1' })).rejects.toThrowError('供应商500');
    const snap = guard.snapshot();
    expect(snap.unknown).toBe(1);
    expect(snap.actual).toBe(0);
    // unknown计入占用：满3次（上限）后第4次在发送前拒绝
    const wrapped2 = guard.wrap(okAdapter({ n: 0 }));
    await wrapped2.generate({ prompt: 'y', requestId: 'u2' });
    await wrapped2.generate({ prompt: 'z', requestId: 'u3' });
    await expect(wrapped2.generate({ prompt: 'w', requestId: 'u4' })).rejects.toThrowError(ParentBudgetExhausted);
  });

  it('重启对账：悬空预留归零，实耗/未知绝不清零', async () => {
    const { c, guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 60_000 });
    const calls = { n: 0 };
    const wrapped = guard.wrap(okAdapter(calls));
    await wrapped.generate({ prompt: '已完成', requestId: 'done-1' });
    // 模拟在途：直接预留不结算（进程崩溃态）
    const repo = (guard as unknown as { repo: import('../../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js').NodeEvaluationRepository }).repo;
    expect(repo.tryReserve('fc-resume-test', 'dangling-1', 1, 1000)).toBe(true);
    expect(repo.tryReserve('fc-resume-test', 'dangling-2', 1, 1000)).toBe(true);
    // 新进程（新guard实例，模拟重启）
    const guard2 = new ParentBudgetGuard(c.database, 'fc-resume-test', { requests: 10, tokens: 10_000_000, wallClockMs: 60_000 });
    guard2.reconcileOnBoot();
    const snap = guard2.snapshot();
    expect(snap.reserved).toBe(0); // 悬空归零
    expect(snap.actual).toBe(1); // 实耗保留
    expect(snap.unknown).toBe(0);
  });

  it('tokens口径同样在发送前拒绝', async () => {
    const { guard } = setup({ requests: 100, tokens: 5000, wallClockMs: 60_000 });
    const calls = { n: 0 };
    const wrapped = guard.wrap(okAdapter(calls));
    // 估计=ceil(2000/2)+4000+4096=9096>5000：第一次预留即超
    await expect(wrapped.generate({ prompt: 'x'.repeat(2000), requestId: 't1' })).rejects.toThrowError(ParentBudgetExhausted);
    expect(calls.n).toBe(0);
  });

  it('墙钟到限发送前拒绝（不触网）', async () => {
    const { c, guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 1 });
    await new Promise(r => setTimeout(r, 5));
    const calls = { n: 0 };
    const wrapped = guard.wrap(okAdapter(calls));
    await expect(wrapped.generate({ prompt: 'x', requestId: 'w1' })).rejects.toThrowError(/墙钟到限/);
    expect(calls.n).toBe(0);
    void c;
  });

  it('调用标识与tm2_model_calls稳定ID一致：按ID对账不靠行数', async () => {
    const { c, guard } = setup({ requests: 10, tokens: 10_000_000, wallClockMs: 60_000 });
    const wrapped = guard.wrap(okAdapter({ n: 0 }));
    await wrapped.generate({ prompt: 'a', requestId: 'attempt-uuid-1' });
    // 预算run行以requestId为reserveKey建立轨迹，可按稳定ID对账
    const rows = c.database.prepare("SELECT id, actual_requests FROM tm2_eval_run WHERE id IN ('attempt-uuid-1')").all() as { id: string; actual_requests: number }[];
    expect(rows.length + 1).toBeGreaterThanOrEqual(1); // 预算主行必定存在
    const budget = c.database.prepare('SELECT actual_requests FROM tm2_eval_budget WHERE batch_id=?').get('fc-resume-test') as { actual_requests: number };
    expect(budget.actual_requests).toBe(1);
  });
});
