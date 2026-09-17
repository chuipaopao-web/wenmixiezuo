/**
 * S1-FAST-CLOSE接续纠正：探针发送边界统一父预算（离线部分1）。
 * 在探针实际模型发送边界（适配器resolve处）对每次真实网络dispatch做原子父预留：
 * - 复用既有持久化预算器（tm2_eval_budget经NodeEvaluationRepository）：预留/实耗/未知分列，进程重启不归零；
 * - 设定、时光机、适配器重试、冒烟全部子进程共用同一父账本（batchId单行）；
 * - 上限（请求/tokens/墙钟）在网络发送前拒绝下一次，不是轮询后统计；
 * - 调用标识=requestId（与tm2_model_calls/v7_setting_model_calls稳定ID一致，对账不靠行数相加）；
 * - 未知结果占额转unknown列（不免费重试）；悬空预留重启归零、实耗/未知绝不清零。
 * 不动生产网关，不给探针开后门：这只是探针装配层的包裹，生产路径不引用。
 */
import type { DatabaseSync } from 'node:sqlite';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';

export interface ParentBudgetLimits { readonly requests: number; readonly tokens: number; readonly wallClockMs: number }

export class ParentBudgetExhausted extends Error {
  constructor(readonly reason: string) { super(`父预算发送前拒绝：${reason}`); }
}

interface GuardedUsage { inputTokens: number | null; outputTokens: number | null; reasoningTokens?: number | null }
interface GuardedRequest { prompt: string; maxOutputTokens?: number; requestId?: string }
/** 适配器返回的用量：优先usage嵌套（评测适配器），否则顶层字段（生产网关ModelAdapter结果）。 */
interface GuardedResponse {
  usage?: GuardedUsage | null;
  inputTokens?: number | null; outputTokens?: number | null; reasoningTokens?: number | null;
}
interface GuardedAdapter<A extends GuardedRequest, R extends GuardedResponse> { generate(request: A): Promise<R> }

function usageOf(response: GuardedResponse): { known: boolean; total: number | null } {
  const nested = response.usage;
  if (nested != null) {
    const known = nested.inputTokens !== null && nested.outputTokens !== null;
    return { known, total: known ? nested.inputTokens! + nested.outputTokens! + (nested.reasoningTokens ?? 0) : null };
  }
  const known = typeof response.inputTokens === 'number' && typeof response.outputTokens === 'number';
  return { known, total: known ? response.inputTokens! + response.outputTokens! + (response.reasoningTokens ?? 0) : null };
}

export class ParentBudgetGuard {
  private readonly repo: NodeEvaluationRepository;
  private readonly pending = new Map<string, number>(); // requestId → reservedTokens（对账用，进程内）
  constructor(
    private readonly db: DatabaseSync,
    private readonly batchId: string,
    private readonly limits: ParentBudgetLimits
  ) {
    this.repo = new NodeEvaluationRepository(db);
    this.repo.ensureBudget(batchId, limits.requests, limits.tokens);
  }

  /** 进程启动对账：新进程没有在途调用，悬空预留归零（实耗/未知绝不清零）。 */
  reconcileOnBoot(): void { this.repo.reconcileReservedOnBoot(this.batchId); }

  /** 保守token估计（与评测执行器同口径：约2字符/token上界）。 */
  private estimate(request: GuardedRequest): number {
    return Math.ceil(request.prompt.length / 2) + (request.maxOutputTokens ?? 4000) + 4096;
  }

  private checkWallClock(): void {
    const budget = this.repo.readBudget(this.batchId)!;
    if (Date.now() - Date.parse(budget.started_at) >= this.limits.wallClockMs) {
      throw new ParentBudgetExhausted(`墙钟到限（${this.limits.wallClockMs / 60000}分钟）`);
    }
  }

  /** 包裹一个已解析适配器：每次真实dispatch前原子预留，结束按实际/未知结算。 */
  wrap<A extends GuardedRequest, R extends GuardedResponse, T extends GuardedAdapter<A, R>>(adapter: T): T {
    const guard = this;
    return {
      ...adapter,
      async generate(request: A): Promise<R> {
        guard.checkWallClock();
        const reserveKey = request.requestId ?? `anon:${Date.now()}:${Math.random()}`;
        const reserved = guard.estimate(request);
        // 发送前原子预留：请求/tokens任一超上限即拒绝（不触网）
        if (!guard.repo.tryReserve(guard.batchId, reserveKey, 1, reserved)) {
          throw new ParentBudgetExhausted(`请求或token达上限（${guard.limits.requests}请求/${guard.limits.tokens}tokens）`);
        }
        guard.pending.set(reserveKey, reserved);
        try {
          const response = await adapter.generate(request);
          const usage = usageOf(response);
          guard.repo.settle(guard.batchId, reserveKey, {
            requests: 1, reservedTokens: reserved,
            actualTokens: usage.known ? usage.total : null
          });
          return response;
        } catch (error) {
          // 未知结果占额转unknown列：不免费重试、不蒸发消耗事实
          guard.repo.settle(guard.batchId, reserveKey, { requests: 1, reservedTokens: reserved, actualTokens: null });
          throw error;
        } finally {
          guard.pending.delete(reserveKey);
        }
      }
    } as T;
  }

  /** 当前账本快照（报告用：分账+与总上限的对照）。 */
  snapshot(): { actual: number; unknown: number; reserved: number; limitRequests: number; limitTokens: number; startedAt: string } {
    const b = this.repo.readBudget(this.batchId)!;
    return { actual: b.actual_requests, unknown: b.unknown_requests, reserved: b.reserved_requests, limitRequests: b.limit_requests, limitTokens: b.limit_tokens, startedAt: b.started_at };
  }
}
