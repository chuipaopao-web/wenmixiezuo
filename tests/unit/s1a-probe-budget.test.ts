import { describe, it, expect } from 'vitest';
import { createProbeBudgetGuard, decideProbeOutcome } from '../../scripts/quality/s1a-probe-budget.mjs';
// 30a6f053复核项1：探针计量与终态判定的纯逻辑验证（模拟成功/knownUsage失败/未知失败/预算临界/三失败终态），不调用真实模型。
const REQUEST = (id: string, promptBytes = 1000) => ({ promptBytes, maxOutputTokens: 8000, reasoningAllowance: 4000 });

describe('probe budget guard (30a6f053 metering)', () => {
  it('counts success and knownUsage failure tokens; unknown failures are listed separately and reserve-conservative, never counted as zero', () => {
    const guard = createProbeBudgetGuard({ maxCalls: 10, maxTokens: 100000 });
    guard.beforeDispatch('a', REQUEST('a'));
    guard.onSuccess('a', { inputTokens: 1000, outputTokens: 2000, cashCostCny: 0 });
    guard.beforeDispatch('b', REQUEST('b'));
    guard.onKnownFailure('b', { inputTokens: 500, outputTokens: 12000, cashCostCny: 0 });
    guard.beforeDispatch('c', REQUEST('c', 2000));
    guard.onUnknownFailure('c');
    const summary = guard.summary();
    expect(summary.successKnown).toEqual({ calls: 1, tokens: 3000 });
    expect(summary.failedKnown).toEqual({ calls: 1, tokens: 12500 });
    expect(summary.unknownCalls).toBe(1);
    // 未知按预留保守计入上限口径：2000+8000+4000+2048=16048
    expect(summary.unknownReservedTokens).toBe(16048);
    expect(summary.knownTotal).toBe(3000 + 12500 + 16048);
    expect(summary.totalCalls).toBe(3);
  });
  it('blocks a new call when known total plus in-flight reservations exceed the cap, and settles reservations on completion', () => {
    const guard = createProbeBudgetGuard({ maxCalls: 10, maxTokens: 40000 });
    // 预留=1000+8000+4000+2048=15048；两笔在途=30096≤40000，第三笔超限必须被拒。
    guard.beforeDispatch('inflight-1', REQUEST('inflight-1'));
    guard.beforeDispatch('inflight-2', REQUEST('inflight-2'));
    expect(() => guard.beforeDispatch('inflight-3', REQUEST('inflight-3'))).toThrow(/Probe budget reached/);
    // 结算一笔（实际2000）后预留释放，剩余空间允许新调用。
    guard.onSuccess('inflight-1', { inputTokens: 1000, outputTokens: 1000, cashCostCny: 0 });
    guard.beforeDispatch('inflight-3', REQUEST('inflight-3'));
    expect(guard.summary().reservedInFlight).toBe(2);
  });
  it('enforces the hard call ceiling before dispatch', () => {
    const guard = createProbeBudgetGuard({ maxCalls: 2, maxTokens: 1000000 });
    guard.beforeDispatch('r1', REQUEST('r1'));
    guard.onSuccess('r1', { inputTokens: 1, outputTokens: 1, cashCostCny: 0 });
    guard.beforeDispatch('r2', REQUEST('r2'));
    guard.onSuccess('r2', { inputTokens: 1, outputTokens: 1, cashCostCny: 0 });
    expect(() => guard.beforeDispatch('r3', REQUEST('r3'))).toThrow(/calls=2/);
  });
});

describe('probe outcome decision (30a6f053 terminal handling)', () => {
  it('all three terminal-failed schemes end immediately instead of waiting for a success', () => {
    const decision = decideProbeOutcome([
      { scheme: 'A', state: 'failed' },
      { scheme: 'B', state: 'failed' },
      { scheme: 'C', state: 'failed' }
    ]);
    expect(decision.status).toBe('all-failed');
  });
  it('terminal with an adoptable scheme returns that scheme for HTTP adoption', () => {
    const decision = decideProbeOutcome([
      { scheme: 'A', state: 'succeeded', result: { review: { pass: true }, revision: 1 } },
      { scheme: 'B', state: 'failed' },
      { scheme: 'C', state: 'succeeded', result: { review: { pass: false }, revision: 1 } }
    ]);
    expect(decision.status).toBe('adoptable');
    if (decision.status === 'adoptable') expect(decision.run.scheme).toBe('A');
  });
  it('still-running or empty round lists keep waiting', () => {
    expect(decideProbeOutcome([{ scheme: 'A', state: 'working' }]).status).toBe('continue');
    expect(decideProbeOutcome([]).status).toBe('continue');
    expect(decideProbeOutcome([{ scheme: 'A', state: 'succeeded', result: { review: { pass: true } } }, { scheme: 'B', state: 'queued' }]).status).toBe('continue');
  });
});
