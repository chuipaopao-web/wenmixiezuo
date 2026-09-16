import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NodeEvaluationRepository } from '../../infrastructure/db/repositories/node-evaluation-repository.js';

/**
 * MODEL-NODE-EVAL评测执行器（合同"预算及执行纪律"节）：
 * - 预算硬停：发送前原子预留（预留+实耗+未知分列持久化，重启不归零），超限即budget-stopped，不隐形追加。
 * - 断点续传：case按(run_id,sample_hash,attempt_seq)幂等，终态case跳过不重复发送；进程重启后从未完成run继续。
 * - 并发：全局初始2、同模型1；记录排队/执行时间，限流不误算生成慢。
 * - 429退避：指数退避重试（计入retry_count），上限2次；未知结果不自动重发计费。
 * - 适配器注入：真实走TimeMachineModelGateway/ModelAdapterFactory，离线测试走假适配器。
 */

export interface EvalSample {
  readonly sampleHash: string;
  readonly genre: string;
  readonly lengthBand: 'short' | 'medium' | 'long';
  readonly timeSlot: string;
  readonly kind: 'positive' | 'negative';
  readonly prompt: string;
}

export interface EvalAdapterRequest {
  readonly provider: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly thinkingHeadroomTokens?: number;
}

export interface EvalAdapterResponse {
  readonly output: string;
  /** null=供应商未上报用量（计入unknown口径，不按0处理）。 */
  readonly usage: { readonly inputTokens: number | null; readonly outputTokens: number | null; readonly reasoningTokens: number | null } | null;
  readonly providerModelVersion?: string;
  readonly httpStatus?: number;
}

export class EvalCallError extends Error {
  constructor(readonly kind: 'truncated' | 'timeout' | 'http_error' | 'auth_error' | 'rate_limited' | 'unknown', message: string, readonly httpStatus?: number) { super(message); }
}

export interface EvalAdapter {
  generate(request: EvalAdapterRequest): Promise<EvalAdapterResponse>;
}

/** 合同校验器可返回的语义分析（质量/评审信号）；抛EvalContractError表示合同未过。 */
export interface EvalCaseAnalysis {
  readonly qualityPass?: boolean | null;
  readonly qualityNote?: string;
}

/** 评测合同错误：critical=true表示关键约束漏失（准入零漏失项），error_code以critical:前缀入库。 */
export class EvalContractError extends Error {
  constructor(message: string, readonly critical = false) { super(message); }
}

export interface EvalRunPlan {
  readonly runId: string;
  readonly batchId: string;
  readonly nodeKey: string;
  readonly lengthBand: string;
  readonly modelProfileKey: string;
  readonly provider: string;
  readonly modelId: string;
  readonly configVersion: string;
  readonly promptVersion: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  readonly thinkingHeadroomTokens?: number;
  readonly samples: readonly EvalSample[];
  /** 输出合同校验；抛EvalContractError=contract_error（critical=true记关键约束漏失）。返回语义分析存quality_*列。 */
  readonly validate: (output: string, sample: EvalSample) => EvalCaseAnalysis | void;
}

export interface ExecutorOptions {
  readonly globalConcurrency: number;   // 默认2
  readonly perModelConcurrency: number; // 默认1
  readonly rateLimitBackoffMs: readonly number[]; // 默认[5000,20000]
  readonly timeoutMs: number;           // 单case超时，默认600000
  readonly estimateTokens: (text: string) => number; // 保守估计，用于预留
  /** 输出工件保存目录（受控本地artifact，合同"记录与存储"节）：设置后成功/合同错误的可见输出落盘供盲评引用；
   * 只存可见输出，密钥与思维链不入盘；写盘失败不抹掉已计费结果，artifact_path如实为null。 */
  readonly artifactDir?: string;
}

const DEFAULT_OPTIONS: ExecutorOptions = {
  globalConcurrency: 2,
  perModelConcurrency: 1,
  rateLimitBackoffMs: [5000, 20000],
  timeoutMs: 600_000,
  estimateTokens: (text: string) => Math.ceil(text.length / 2) // 中文为主的保守口径：约2字符/token上界估计
};

export type RunFinishStatus = 'succeeded' | 'budget-stopped' | 'stopped' | 'failed';

export class NodeEvaluationExecutor {
  private readonly repo: NodeEvaluationRepository;
  private readonly options: ExecutorOptions;
  private globalSlots = 0;
  private readonly modelBusy = new Set<string>();
  private readonly queue: Array<() => void> = [];
  private stopped = false;

  constructor(private readonly db: DatabaseSync, options?: Partial<ExecutorOptions>) {
    this.repo = new NodeEvaluationRepository(db);
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** 停止调度（已完成case保留；不取消在途真实调用）。 */
  stop(): void { this.stopped = true; }

  private async acquire(modelProfileKey: string): Promise<void> {
    while (this.globalSlots >= this.options.globalConcurrency || this.modelBusy.has(modelProfileKey)) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.globalSlots += 1;
    this.modelBusy.add(modelProfileKey);
  }

  private release(modelProfileKey: string): void {
    this.globalSlots -= 1;
    this.modelBusy.delete(modelProfileKey);
    const next = this.queue.shift();
    next?.();
  }

  /**
   * 执行一个run计划（可重入）：终态case跳过；预算耗尽置budget-stopped并停止本run新发送。
   * 返回最终状态；不抛预期内错误（单case失败记录后继续其余case）。
   */
  async execute(plan: EvalRunPlan, adapter: EvalAdapter): Promise<RunFinishStatus> {
    const run = this.repo.readRun(plan.runId);
    if (!run) throw new Error(`评测run不存在：${plan.runId}`);
    if (run.status === 'succeeded' || run.status === 'budget-stopped') return run.status;
    this.repo.setRunStatus(plan.runId, 'working');
    const done = this.repo.completedCaseKeys(plan.runId);
    let budgetStopped = false;

    for (const sample of plan.samples) {
      if (this.stopped) { this.repo.setRunStatus(plan.runId, 'stopped', '手动停止'); return 'stopped'; }
      const attemptSeq = 1;
      if (done.has(`${sample.sampleHash}#${attemptSeq}`)) continue; // 断点续传：不重复发送
      const inputHash = createHash('sha256').update(sample.prompt).digest('hex');
      const reservedTokens = this.options.estimateTokens(sample.prompt) + plan.maxOutputTokens + (plan.thinkingHeadroomTokens ?? 0);

      // 预算硬停：原子预留失败即停止本run（已预留部分由在途case结算释放）。
      if (!this.repo.tryReserve(plan.batchId, plan.runId, 1, reservedTokens)) { budgetStopped = true; break; }

      const queuedAt = new Date().toISOString();
      await this.acquire(plan.modelProfileKey);
      const startedAt = new Date().toISOString();
      const queueMs = Date.parse(startedAt) - Date.parse(queuedAt);
      let outcome: string = 'unknown';
      let technicalOk = 0;
      let contractOk: number | null = null;
      let qualityPass: number | null = null;
      let qualityNote: string | null = null;
      let httpStatus: number | null = null;
      let errorCode: string | null = null;
      let usage: EvalAdapterResponse['usage'] = null;
      let providerModelVersion: string | null = null;
      let retryCount = 0;
      let output: string | null = null;

      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await this.withTimeout(adapter.generate({
              provider: plan.provider, modelId: plan.modelId, prompt: sample.prompt,
              maxOutputTokens: plan.maxOutputTokens, temperature: plan.temperature,
              ...(plan.thinkingHeadroomTokens !== undefined ? { thinkingHeadroomTokens: plan.thinkingHeadroomTokens } : {})
            }), this.options.timeoutMs);
            output = response.output;
            usage = response.usage;
            providerModelVersion = response.providerModelVersion ?? null;
            httpStatus = response.httpStatus ?? 200;
            retryCount = attempt;
            break;
          } catch (error) {
            if (error instanceof EvalCallError && error.kind === 'rate_limited' && attempt < this.options.rateLimitBackoffMs.length) {
              await new Promise(resolve => setTimeout(resolve, this.options.rateLimitBackoffMs[attempt]!));
              continue; // 429退避重试，不计新case
            }
            throw error;
          }
        }
        try {
          const analysis = plan.validate(output!, sample);
          outcome = 'ok';
          technicalOk = 1;
          contractOk = 1;
          qualityPass = analysis?.qualityPass === undefined || analysis?.qualityPass === null ? null : analysis.qualityPass ? 1 : 0;
          qualityNote = analysis?.qualityNote?.slice(0, 300) ?? null;
        } catch (contractError) {
          outcome = 'contract_error';
          technicalOk = 1; // 技术交付成功（有可见输出），合同未过
          contractOk = 0;
          const critical = contractError instanceof EvalContractError && contractError.critical;
          errorCode = `${critical ? 'critical:' : ''}${contractError instanceof Error ? contractError.message.slice(0, 200) : 'contract'}`;
        }
      } catch (error) {
        if (error instanceof EvalCallError) {
          outcome = error.kind === 'rate_limited' ? 'rate_limited' : error.kind;
          httpStatus = error.httpStatus ?? null;
          errorCode = error.message.slice(0, 200);
          if (error.kind === 'rate_limited') retryCount = this.options.rateLimitBackoffMs.length;
        } else {
          outcome = 'unknown';
          errorCode = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : 'unknown';
        }
        // 未知结果只记录，不自动重发计费（合同：未知结果先核对）。
      }
      const finishedAt = new Date().toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
      this.release(plan.modelProfileKey);

      // 输出工件：成功/合同错误的可见输出落盘（盲评引用依据）；截断/超时等无可见输出不落盘。
      // 写盘失败不抹掉已计费结果，artifact_path如实为null。
      let artifactPath: string | null = null;
      if (output !== null && this.options.artifactDir) {
        try {
          const name = `${plan.runId.replace(/[^A-Za-z0-9_-]/gu, '_')}__${sample.sampleHash}__${attemptSeq}.json`;
          mkdirSync(this.options.artifactDir, { recursive: true });
          writeFileSync(join(this.options.artifactDir, name), JSON.stringify({
            nodeKey: plan.nodeKey, modelProfileKey: plan.modelProfileKey, sampleHash: sample.sampleHash,
            genre: sample.genre, lengthBand: sample.lengthBand, timeSlot: sample.timeSlot, kind: sample.kind,
            configVersion: plan.configVersion, promptVersion: plan.promptVersion, output
          }), 'utf8');
          artifactPath = name;
        } catch { artifactPath = null; }
      }

      const usageKnown = usage !== null && usage.inputTokens !== null && usage.outputTokens !== null;
      const actualTokens = usageKnown ? usage!.inputTokens! + usage!.outputTokens! + (usage!.reasoningTokens ?? 0) : null;
      this.repo.insertCase({
        run_id: plan.runId, node_key: plan.nodeKey, model_profile_key: plan.modelProfileKey,
        sample_hash: sample.sampleHash, attempt_seq: attemptSeq, genre: sample.genre, length_band: sample.lengthBand,
        time_slot: sample.timeSlot, sample_kind: sample.kind, input_hash: inputHash, config_version: plan.configVersion,
        prompt_version: plan.promptVersion, http_status: httpStatus, outcome, technical_ok: technicalOk, contract_ok: contractOk,
        quality_pass: qualityPass, quality_note: qualityNote, judge_source: null, judge_model_id: null,
        input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null, reasoning_tokens: usage?.reasoningTokens ?? null,
        usage_known: usageKnown ? 1 : 0, reserved_tokens: reservedTokens, retry_count: retryCount,
        queued_at: queuedAt, started_at: startedAt, finished_at: finishedAt, queue_ms: queueMs, duration_ms: durationMs,
        error_code: errorCode, artifact_path: artifactPath, provider_model_version: providerModelVersion
      });
      this.repo.settle(plan.batchId, plan.runId, { requests: 1, reservedTokens, actualTokens });
    }

    if (budgetStopped) { this.repo.setRunStatus(plan.runId, 'budget-stopped', '批次预算硬停：预留/实耗/未知口径达上限'); return 'budget-stopped'; }
    this.repo.setRunStatus(plan.runId, 'succeeded');
    return 'succeeded';
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new EvalCallError('timeout', `单case超过${ms}ms未返回`)), ms);
      promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }
}
