// P0-1 / R07: 真实批量验证总熔断。
//
// 本模块是纯函数，不读写文件、不连接数据库、不发起网络请求，因此可以在不调用任何
// 真实模型、不生成小说内容的前提下做确定性离线测试。真实评测脚本
// (run-real-50-chapter-validation.mjs) 在「发起下一个章节任务」之前调用这里的
// evaluateBreaker / batchStartupGate / shouldAutoRecover，达到任一阈值或遇到
// QUALITY_BLOCKED 时先写证据再退出，绝不自动模拟老板重写受阻章节。
//
// 语义约束（见 docs/GLM52_RUNTIME_REPAIR_HANDOFF_20260721.md §6.1 与预先验尸第7条）：
//   - 熔断只控制“是否启动下一任务”，不截断已启动的完整稿和三个席位；
//   - 默认 blockedRecovery=manual_only，QUALITY_BLOCKED 立即结束批次；
//   - 套餐余额未知时，正式批次默认最多 1-3 章并等待确认；
//   - 内部 5000 万 Token 上限只是内部账本，不得据此继续 50 章。

export const DEFAULT_BREAKER_LIMITS = Object.freeze({
  // 单章累计调用与 Token：第 1 章异常时累计 189 次调用、约 108 万输入 Token，
  // 这里给出明显低于异常爆炸、但高于第 11 章正常路径(5 次)的保守上限。
  perChapterCalls: 60,
  perChapterTokens: 600_000,
  // 全批累计：本次故障书 574 次调用、约 678 万已用 Token 仍继续跑，给出明确熔断。
  batchCalls: 600,
  batchTokens: 6_000_000,
  // 连续结构修复 / 连续重写：单任务两轮重写上限之外，跨任务的异常放大器。
  consecutiveStructFixes: 4,
  consecutiveRewrites: 2
});

// 套餐余额未知时，正式批次默认最多 3 章并等待老板确认（§6.1 / §6.5）。
export const DEFAULT_PACKAGE_UNKNOWN_BATCH_CAP = 3;

const BREAKER_CHECKS = [
  { key: 'perChapterCalls', field: 'chapterCalls', reason: 'per_chapter_calls_exceeded' },
  { key: 'perChapterTokens', field: 'chapterTokens', reason: 'per_chapter_tokens_exceeded' },
  { key: 'batchCalls', field: 'batchCalls', reason: 'batch_calls_exceeded' },
  { key: 'batchTokens', field: 'batchTokens', reason: 'batch_tokens_exceeded' },
  { key: 'consecutiveStructFixes', field: 'consecutiveStructFixes', reason: 'consecutive_struct_fixes_exceeded' },
  { key: 'consecutiveRewrites', field: 'consecutiveRewrites', reason: 'consecutive_rewrites_exceeded' }
];

/**
 * 在「发起下一个章节任务」之前评估是否熔断。
 *
 * 达到任一阈值（usage[key] >= limits[key]）即返回 stop=true，并携带可审计证据。
 * “阈值仅差一次调用”指 usage 距 limit 还差 1（usage = limit - 1），此时仍允许
 * 发起最后一次；usage = limit 时停止。语义对应“达到阈值先写证据再退出”。
 *
 * @param {Partial<BreakerUsage>} usage
 * @param {BreakerLimits} [limits]
 * @returns {BreakerDecision}
 */
export function evaluateBreaker(usage, limits = DEFAULT_BREAKER_LIMITS) {
  const u = usage ?? {};
  for (const check of BREAKER_CHECKS) {
    const limit = limits[check.key];
    const value = Number(u[check.field] ?? 0);
    if (typeof limit === 'number' && Number.isFinite(limit) && value >= limit) {
      return {
        stop: true,
        reason: check.reason,
        evidence: {
          key: check.key,
          field: check.field,
          value,
          limit,
          usage: snapshotUsage(u)
        }
      };
    }
  }
  return { stop: false, reason: null, evidence: { usage: snapshotUsage(u) } };
}

/**
 * 批次启动门禁：套餐余额未知时不允许一次性启动长批次。
 *
 * @param {{ packageBalanceUnknown: boolean, plannedChapters: number, cap?: number }} ctx
 * @returns {{ allow: boolean, reason: string | null, evidence: { plannedChapters: number, cap: number } }}
 */
export function batchStartupGate(ctx) {
  const cap = Number(ctx?.cap ?? DEFAULT_PACKAGE_UNKNOWN_BATCH_CAP);
  const planned = Number(ctx?.plannedChapters ?? 0);
  if (ctx?.packageBalanceUnknown && planned > cap) {
    return { allow: false, reason: 'package_unknown_batch_too_large', evidence: { plannedChapters: planned, cap } };
  }
  return { allow: true, reason: null, evidence: { plannedChapters: planned, cap } };
}

/**
 * 决定是否对 QUALITY_BLOCKED 的章节自动发起“老板授权重写恢复”。
 *
 * 默认 manual_only：QUALITY_BLOCKED 立即结束批次，脚本不冒充老板。
 * 只有显式 blockedRecovery='auto'、单任务两轮重写已耗尽、且未超过最大恢复次数时才允许。
 *
 * @param {AutoRecoverContext} ctx
 * @returns {{ recover: boolean, reason: string }}
 */
export function shouldAutoRecover(ctx) {
  const errorCode = ctx?.errorCode ?? null;
  if (errorCode !== 'QUALITY_BLOCKED') {
    return { recover: false, reason: 'not_quality_blocked' };
  }
  if ((ctx?.blockedRecovery ?? 'manual_only') !== 'auto') {
    return { recover: false, reason: 'manual_only_default' };
  }
  if (Number(ctx?.rewriteCount ?? 0) < 2) {
    return { recover: false, reason: 'rewrite_rounds_not_exhausted' };
  }
  if (Number(ctx?.recoveryCount ?? 0) >= Number(ctx?.maxRecoveries ?? 0)) {
    return { recover: false, reason: 'max_recoveries_reached' };
  }
  return { recover: true, reason: 'auto_recovery_allowed' };
}

function snapshotUsage(u) {
  return {
    chapterCalls: Number(u.chapterCalls ?? 0),
    chapterTokens: Number(u.chapterTokens ?? 0),
    batchCalls: Number(u.batchCalls ?? 0),
    batchTokens: Number(u.batchTokens ?? 0),
    consecutiveStructFixes: Number(u.consecutiveStructFixes ?? 0),
    consecutiveRewrites: Number(u.consecutiveRewrites ?? 0)
  };
}

/**
 * @typedef {Object} BreakerLimits
 * @property {number} perChapterCalls
 * @property {number} perChapterTokens
 * @property {number} batchCalls
 * @property {number} batchTokens
 * @property {number} consecutiveStructFixes
 * @property {number} consecutiveRewrites
 */

/**
 * @typedef {Object} BreakerUsage
 * @property {number} chapterCalls
 * @property {number} chapterTokens
 * @property {number} batchCalls
 * @property {number} batchTokens
 * @property {number} consecutiveStructFixes
 * @property {number} consecutiveRewrites
 */

/**
 * @typedef {Object} BreakerDecision
 * @property {boolean} stop
 * @property {string | null} reason
 * @property {Record<string, unknown>} evidence
 */

/**
 * @typedef {Object} AutoRecoverContext
 * @property {'manual_only' | 'auto'} blockedRecovery
 * @property {string | null} errorCode
 * @property {number} rewriteCount
 * @property {number} recoveryCount
 * @property {number} maxRecoveries
 */
