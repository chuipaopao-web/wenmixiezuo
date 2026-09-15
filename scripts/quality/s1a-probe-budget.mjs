// S1-A探针预算与终态判定（30a6f053复核项1）：纯逻辑模块，供探针脚本与单元测试共用。
// 计量口径：成功与抛错knownUsage都累计为已知用量；未知用量单列不计0；发起前按在途请求预留
// （提示词UTF-8字节+输出额度+思考余量+传输余量），已知失败结算为实际用量，未知失败按预留计（保守）。
// 预算门槛基于供应商上报用量与保守预留的能力边界，不承诺对失实usage绝对控制。

export function createProbeBudgetGuard({ maxCalls = 100, maxTokens = 600000 } = {}) {
  const usage = { successKnown: { calls: 0, tokens: 0 }, failedKnown: { calls: 0, tokens: 0 }, unknownCalls: 0, unknownReservedTokens: 0 };
  const reserved = new Map(); // requestId -> reservedTokens
  const totalKnown = () => usage.successKnown.tokens + usage.failedKnown.tokens + usage.unknownReservedTokens;
  const totalReserved = () => [...reserved.values()].reduce((sum, n) => sum + n, 0);
  const totalCalls = () => usage.successKnown.calls + usage.failedKnown.calls + usage.unknownCalls + reserved.size;
  const validUsage = u => u !== undefined && u !== null
    && Number.isSafeInteger(u.inputTokens) && u.inputTokens >= 0
    && Number.isSafeInteger(u.outputTokens) && u.outputTokens >= 0
    && Number.isFinite(u.cashCostCny ?? 0) && (u.cashCostCny ?? 0) >= 0;
  return {
    usage,
    /** 发起前预留：已知累计+在途预留+本次预留超上限即拒绝新调用（抛错，不发送）。 */
    beforeDispatch(requestId, { promptBytes, maxOutputTokens, reasoningAllowance }) {
      if (reserved.has(requestId)) throw Error(`预留已存在：${requestId}`);
      if (totalCalls() >= maxCalls) throw Error(`Probe budget reached: calls=${totalCalls()} >= ${maxCalls}`);
      const reserve = promptBytes + maxOutputTokens + reasoningAllowance + 2048;
      if (totalKnown() + totalReserved() + reserve > maxTokens) {
        throw Error(`Probe budget reached: known=${totalKnown()} reserved=${totalReserved()} nextReserve=${reserve} > ${maxTokens}`);
      }
      reserved.set(requestId, reserve);
      return reserve;
    },
    /** 成功返回：结算实际用量，归还预留差额。 */
    onSuccess(requestId, result) {
      reserved.delete(requestId);
      const tokens = result.inputTokens + result.outputTokens;
      usage.successKnown.calls += 1;
      usage.successKnown.tokens += tokens;
      return tokens;
    },
    /** 已知失败（带knownUsage）：结算实际用量。 */
    onKnownFailure(requestId, knownUsage) {
      if (!validUsage(knownUsage)) throw Error('knownUsage无效');
      reserved.delete(requestId);
      usage.failedKnown.calls += 1;
      usage.failedKnown.tokens += knownUsage.inputTokens + knownUsage.outputTokens;
      return knownUsage.inputTokens + knownUsage.outputTokens;
    },
    /** 未知结果失败：结果未知可能已消耗，按预留保守计入上限口径，但单列不混入已知失败计量。 */
    onUnknownFailure(requestId) {
      const held = reserved.get(requestId) ?? 0;
      reserved.delete(requestId);
      usage.unknownCalls += 1;
      usage.unknownReservedTokens += held;
      return held;
    },
    summary() {
      return { ...usage, reservedInFlight: reserved.size, reservedTokens: totalReserved(), knownTotal: totalKnown(), totalCalls: totalCalls() };
    },
  };
}

/** 探针终态判定：三方案全终态且全部失败→立即结束（不空等45分钟）；全终态且有可采用→采用；
 * 其余继续等待。runs为state视图的design运行列表。 */
export function decideProbeOutcome(designRuns) {
  const list = Array.isArray(designRuns) ? designRuns : [];
  const terminal = list.length > 0 && list.every(r => ['succeeded', 'failed'].includes(String(r?.state)));
  if (!terminal) return { status: 'continue' };
  const adoptable = list.find(r => String(r?.state) === 'succeeded' && r?.result?.review?.pass === true);
  if (adoptable) return { status: 'adoptable', run: adoptable };
  return { status: 'all-failed', runs: list };
}
