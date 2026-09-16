/**
 * MODEL-NODE-EVAL排名与准入（合同"准入与排名"节）：
 * - 按nodeKey+长度档+配置版本排名，不按全站平均。
 * - 准入门槛（同配置保留验证）：n>=10、一次技术交付率>=90%、关键约束零漏失、质量通过率>=90%；
 *   审查节点另需零关键漏报、误报率<=10%。不达标不进入排名，不凑三名。
 * - 排名键：一次有效成功率（technical_ok且quality_pass）的Wilson下界；接近者依次比较p95耗时、
 *   修订负担（重试/样本）、token用量。保留全部原始指标，不合成掩盖问题的单一分。
 * - 取不同底层模型前三（同底层modelId去重）；不足三名显示实际数量。
 * - n<20的p95标注小样本估计；未测/进行中/小样本/合格/暂停状态分开。
 */

export interface EvalCaseMetricsInput {
  readonly modelProfileKey: string;
  readonly modelId: string;
  readonly outcome: string;
  readonly technicalOk: boolean;
  readonly contractOk: boolean | null;
  readonly qualityPass: boolean | null;
  readonly durationMs: number | null;
  readonly totalTokens: number | null;
  readonly retryCount: number;
  /** 审查节点：植入错误是否被检出（漏报=false）；非审查节点恒null。 */
  readonly seededErrorCaught?: boolean | null;
  /** 审查节点：干净样本是否被误报；非审查节点恒null。 */
  readonly cleanSampleFalseAlarm?: boolean | null;
  /** 关键约束是否漏失（如骨架丢失作者确认故事线）；null=不适用/未发生。 */
  readonly criticalConstraintMissed?: boolean | null;
}

export interface ModelNodeStats {
  readonly modelProfileKey: string;
  readonly modelId: string;
  readonly n: number;
  readonly technicalDeliveryRate: number;
  readonly qualityPassRate: number | null; // quality未评完为null
  readonly firstTrySuccessRate: number; // 一次有效成功率=technical&&quality
  readonly wilsonLowerBound: number;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly p95SmallSample: boolean; // n<20
  readonly truncationCount: number;
  readonly timeoutCount: number;
  readonly unknownCount: number;
  readonly avgTokens: number | null;
  readonly totalTokens: number;
  readonly avgRetries: number;
  readonly seededErrorRecall: number | null;
  readonly cleanFalseAlarmRate: number | null;
  readonly criticalMissCount: number;
}

export type AdmissionState = 'qualified' | 'insufficient_samples' | 'below_threshold' | 'quality_unjudged';

export interface AdmissionResult {
  readonly state: AdmissionState;
  readonly reasons: readonly string[];
}

/** Wilson score下界（95%）。 */
export function wilsonLowerBound(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (centre - margin) / denom;
}

function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) throw new Error('empty');
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

export function aggregateModelStats(modelProfileKey: string, modelId: string, cases: readonly EvalCaseMetricsInput[]): ModelNodeStats {
  const n = cases.length;
  const technical = cases.filter(c => c.technicalOk).length;
  const judged = cases.filter(c => c.qualityPass !== null);
  const quality = judged.filter(c => c.qualityPass === true).length;
  const firstTry = cases.filter(c => c.technicalOk && c.qualityPass === true).length;
  const durations = cases.map(c => c.durationMs).filter((v): v is number => v !== null).toSorted((a, b) => a - b);
  const tokens = cases.map(c => c.totalTokens).filter((v): v is number => v !== null);
  const seeded = cases.filter(c => c.seededErrorCaught !== null && c.seededErrorCaught !== undefined);
  const clean = cases.filter(c => c.cleanSampleFalseAlarm !== null && c.cleanSampleFalseAlarm !== undefined);
  return {
    modelProfileKey, modelId, n,
    technicalDeliveryRate: n ? technical / n : 0,
    qualityPassRate: judged.length ? quality / judged.length : null,
    firstTrySuccessRate: n ? firstTry / n : 0,
    wilsonLowerBound: wilsonLowerBound(firstTry, n),
    medianMs: durations.length ? percentile(durations, 0.5) : null,
    p95Ms: durations.length ? percentile(durations, 0.95) : null,
    p95SmallSample: n < 20,
    truncationCount: cases.filter(c => c.outcome === 'truncated').length,
    timeoutCount: cases.filter(c => c.outcome === 'timeout').length,
    unknownCount: cases.filter(c => c.outcome === 'unknown').length,
    avgTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) / tokens.length : null,
    totalTokens: tokens.reduce((a, b) => a + b, 0),
    avgRetries: n ? cases.reduce((a, c) => a + c.retryCount, 0) / n : 0,
    seededErrorRecall: seeded.length ? seeded.filter(c => c.seededErrorCaught === true).length / seeded.length : null,
    cleanFalseAlarmRate: clean.length ? clean.filter(c => c.cleanSampleFalseAlarm === true).length / clean.length : null,
    criticalMissCount: cases.filter(c => c.criticalConstraintMissed === true).length
  };
}

export interface AdmissionThresholds {
  readonly minSamples: number;          // 默认10
  readonly minTechnicalDelivery: number; // 默认0.9
  readonly minQualityPass: number;       // 默认0.9
  readonly maxCleanFalseAlarm: number;   // 审查节点默认0.1
}

export const DEFAULT_ADMISSION: AdmissionThresholds = {
  minSamples: 10,
  minTechnicalDelivery: 0.9,
  minQualityPass: 0.9,
  maxCleanFalseAlarm: 0.1
};

export function admitModel(stats: ModelNodeStats, kind: 'generation' | 'review', thresholds: AdmissionThresholds = DEFAULT_ADMISSION): AdmissionResult {
  const reasons: string[] = [];
  if (stats.n < thresholds.minSamples) return { state: 'insufficient_samples', reasons: [`样本不足：n=${stats.n}<${thresholds.minSamples}（小样本初筛不称稳定结论）`] };
  if (stats.qualityPassRate === null) return { state: 'quality_unjudged', reasons: ['质量尚未评审完成'] };
  if (stats.technicalDeliveryRate < thresholds.minTechnicalDelivery) reasons.push(`一次技术交付率${(stats.technicalDeliveryRate * 100).toFixed(1)}%<${thresholds.minTechnicalDelivery * 100}%`);
  if (stats.criticalMissCount > 0) reasons.push(`关键约束漏失${stats.criticalMissCount}次（要求零漏失）`);
  if (stats.qualityPassRate < thresholds.minQualityPass) reasons.push(`质量通过率${(stats.qualityPassRate * 100).toFixed(1)}%<${thresholds.minQualityPass * 100}%`);
  if (kind === 'review') {
    if (stats.seededErrorRecall !== null && stats.seededErrorRecall < 1) reasons.push(`植入错误召回${((stats.seededErrorRecall ?? 0) * 100).toFixed(1)}%（审查要求零关键漏报）`);
    if (stats.cleanFalseAlarmRate !== null && stats.cleanFalseAlarmRate > thresholds.maxCleanFalseAlarm) reasons.push(`干净样本误报率${(stats.cleanFalseAlarmRate * 100).toFixed(1)}%>${thresholds.maxCleanFalseAlarm * 100}%`);
  }
  return reasons.length ? { state: 'below_threshold', reasons } : { state: 'qualified', reasons: [] };
}

export interface RankedEntry {
  readonly rank: number;
  readonly stats: ModelNodeStats;
  readonly admission: AdmissionResult;
}

/**
 * 排名：先过准入，再按Wilson下界降序；下界差距<0.01视为接近，依次比较p95耗时、平均重试、平均token。
 * 同底层modelId去重（两个名字绑定同模型算一个），保留排名最高者。
 * 返回全部参评者（含不合格，附原因）；qualifiedOnlyTop3为不同底层前三。
 */
export function rankNodeEntries(allStats: readonly ModelNodeStats[], kind: 'generation' | 'review', thresholds: AdmissionThresholds = DEFAULT_ADMISSION): { entries: RankedEntry[]; qualifiedTop: RankedEntry[] } {
  const withAdmission = allStats.map(stats => ({ stats, admission: admitModel(stats, kind, thresholds) }));
  const sortFn = (a: { stats: ModelNodeStats }, b: { stats: ModelNodeStats }): number => {
    const dw = b.stats.wilsonLowerBound - a.stats.wilsonLowerBound;
    if (Math.abs(dw) >= 0.01) return dw;
    const p95a = a.stats.p95Ms ?? Number.MAX_SAFE_INTEGER, p95b = b.stats.p95Ms ?? Number.MAX_SAFE_INTEGER;
    if (p95a !== p95b) return p95a - p95b;
    if (a.stats.avgRetries !== b.stats.avgRetries) return a.stats.avgRetries - b.stats.avgRetries;
    const ta = a.stats.avgTokens ?? Number.MAX_SAFE_INTEGER, tb = b.stats.avgTokens ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.stats.modelProfileKey.localeCompare(b.stats.modelProfileKey); // 稳定次序保证同输入可复算
  };
  const qualified = withAdmission.filter(e => e.admission.state === 'qualified').toSorted(sortFn);
  const unqualified = withAdmission.filter(e => e.admission.state !== 'qualified')
    .toSorted((a, b) => a.admission.state.localeCompare(b.admission.state) || b.stats.wilsonLowerBound - a.stats.wilsonLowerBound || a.stats.modelProfileKey.localeCompare(b.stats.modelProfileKey));
  // 同底层去重：只影响合格池的"前三"选取；不合格列表全量保留供审查。
  const seenModels = new Set<string>();
  const distinctQualified = qualified.filter(e => {
    if (seenModels.has(e.stats.modelId)) return false;
    seenModels.add(e.stats.modelId);
    return true;
  });
  const entries: RankedEntry[] = [
    ...distinctQualified.map((e, i) => ({ rank: i + 1, stats: e.stats, admission: e.admission })),
    ...unqualified.map(e => ({ rank: 0, stats: e.stats, admission: e.admission }))
  ];
  return { entries, qualifiedTop: entries.filter(e => e.rank > 0).slice(0, 3) };
}
