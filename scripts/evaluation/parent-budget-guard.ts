/**
 * 625cc3f7集中复核②：探针发送边界统一父预算（修复重启漏计与估算口径）。
 * 在探针实际模型发送边界（适配器resolve处）对每次真实网络dispatch做原子父预留：
 * - 持久化预留日志tm2_eval_reserve_journal：reserve（已占额未达发送点）→ dispatching（紧邻发送前标记）→ settled；
 * - 对账按日志+发送状态+进程租约：活跃实例保留；已发未结算/无法确认已发→转unknown占额不释放；
 *   有确证未到发送点→释放；结算幂等（settled标记），多次对账不倍增；禁止全批清零；
 * - token按协议封套字节估算（Buffer.byteLength(prompt)+maxOutput+2048），不用prompt.length/2冒充保守上界；
 * - 结算实耗=input+output计费分量；reasoning单列记录、不重复相加（供应商可能已含在output内）；
 * - 设定、时光机、适配器重试、冒烟全部子进程共用同一父账本；上限（请求/tokens/墙钟）发送前拒绝下一次；
 * - 不动生产网关，不给探针开后门：这只是探针装配层的包裹，生产路径不引用。
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';

export interface ParentBudgetLimits { readonly requests: number; readonly tokens: number; readonly wallClockMs: number; readonly leaseTtlMs?: number }

export class ParentBudgetExhausted extends Error {
  constructor(readonly reason: string) { super(`父预算发送前拒绝：${reason}`); }
}

interface GuardedRequest { prompt: string; maxOutputTokens?: number; requestId?: string; thinkingHeadroomTokens?: number }
interface GuardedResponse {
  usage?: { inputTokens: number | null; outputTokens: number | null; reasoningTokens?: number | null } | null;
  inputTokens?: number | null; outputTokens?: number | null; reasoningTokens?: number | null;
}
interface GuardedAdapter<A extends GuardedRequest, R extends GuardedResponse> { generate(request: A): Promise<R> }

function billedUsage(response: GuardedResponse): { known: boolean; total: number | null } {
  const nested = response.usage;
  const input = nested != null ? nested.inputTokens : response.inputTokens;
  const output = nested != null ? nested.outputTokens : response.outputTokens;
  const known = typeof input === 'number' && typeof output === 'number';
  // reasoning单列不重复相加：供应商是否含在output内无法确认，实耗只按计费分量input+output计
  return { known, total: known ? input! + output! : null };
}

export class ParentBudgetGuard {
  private readonly repo: NodeEvaluationRepository;
  readonly ownerTag: string;
  private readonly leaseTtlMs: number;
  constructor(
    private readonly db: DatabaseSync,
    private readonly batchId: string,
    private readonly limits: ParentBudgetLimits,
    ownerTag?: string
  ) {
    this.repo = new NodeEvaluationRepository(db);
    this.repo.ensureBudget(batchId, limits.requests, limits.tokens);
    this.ownerTag = ownerTag ?? `guard-${process.pid}-${randomUUID().slice(0, 8)}`;
    this.leaseTtlMs = limits.leaseTtlMs ?? 30_000;
    this.heartbeat();
  }

  /** 进程心跳：对账只处理租约过期实例（活进程条目不动）。 */
  heartbeat(): void {
    this.db.prepare('INSERT INTO tm2_eval_guard_lease(owner_tag,heartbeat_at) VALUES(?,?) ON CONFLICT(owner_tag) DO UPDATE SET heartbeat_at=excluded.heartbeat_at')
      .run(this.ownerTag, new Date().toISOString());
  }

  /**
   * 对账（替代全批清零）：逐条未结算日志按发送状态与租约处理。
   * - reserve（未达发送点，有确证未发送）→ 释放预留；
   * - dispatching/unknown（已发未结算或无法确认）→ 预留转unknown占额，不释放；
   * - 活实例条目不动；结算幂等（settled=1后跳过），多次对账不倍增。
   */
  reconcile(): { released: number; toUnknown: number; keptAlive: number } {
    const now = new Date().toISOString();
    const expiredOwners = new Set(
      (this.db.prepare('SELECT owner_tag, heartbeat_at FROM tm2_eval_guard_lease').all() as { owner_tag: string; heartbeat_at: string }[])
        .filter(l => Date.parse(now) - Date.parse(l.heartbeat_at) > this.leaseTtlMs)
        .map(l => l.owner_tag)
    );
    const pending = this.db.prepare('SELECT * FROM tm2_eval_reserve_journal WHERE batch_id=? AND settled=0').all(this.batchId) as {
      reserve_key: string; owner_tag: string; requests: number; tokens: number; dispatch_mark: string;
    }[];
    let released = 0, toUnknown = 0, keptAlive = 0;
    for (const entry of pending) {
      if (!expiredOwners.has(entry.owner_tag)) { keptAlive++; continue; } // 活进程不动
      if (entry.dispatch_mark === 'reserved') {
        // 确证未到发送点：释放预留（budget预留列减回）
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.prepare('UPDATE tm2_eval_budget SET reserved_requests=reserved_requests-?,reserved_tokens=reserved_tokens-?,updated_at=? WHERE batch_id=?')
            .run(entry.requests, entry.tokens, now, this.batchId);
          this.db.prepare("UPDATE tm2_eval_reserve_journal SET settled=1,outcome='released',updated_at=? WHERE reserve_key=? AND batch_id=? AND settled=0")
            .run(now, entry.reserve_key, this.batchId);
          this.db.exec('COMMIT');
          released++;
        } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
      } else {
        // 已发未结算/无法确认：转unknown占额（不释放、不免费）
        this.db.exec('BEGIN IMMEDIATE');
        try {
          this.db.prepare('UPDATE tm2_eval_budget SET reserved_requests=reserved_requests-?,unknown_requests=unknown_requests+?,reserved_tokens=reserved_tokens-?,unknown_tokens=unknown_tokens+?,updated_at=? WHERE batch_id=?')
            .run(entry.requests, entry.requests, entry.tokens, entry.tokens, now, this.batchId);
          this.db.prepare("UPDATE tm2_eval_reserve_journal SET settled=1,outcome='unknown-reconciled',updated_at=? WHERE reserve_key=? AND batch_id=? AND settled=0")
            .run(now, entry.reserve_key, this.batchId);
          this.db.exec('COMMIT');
          toUnknown++;
        } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
      }
    }
    return { released, toUnknown, keptAlive };
  }

  private checkWallClock(): void {
    const budget = this.repo.readBudget(this.batchId)!;
    const base = Date.parse(budget.started_at) + this.limits.wallClockMs;
    // 一次性墙钟补充（tm2_eval_budget_ext）：持久化extensionStartedAt，重启不重新计时，不能循环延长
    const ext = this.db.prepare('SELECT extension_started_at, extension_ms FROM tm2_eval_budget_ext WHERE batch_id=?').get(this.batchId) as { extension_started_at: string; extension_ms: number } | undefined;
    const deadline = ext !== undefined ? Math.max(base, Date.parse(ext.extension_started_at) + ext.extension_ms) : base;
    if (Date.now() >= deadline) {
      throw new ParentBudgetExhausted(`墙钟到限（${this.limits.wallClockMs / 60000}分钟${ext !== undefined ? '+一次性补充' + ext.extension_ms / 60000 + '分钟' : ''}）`);
    }
  }

  /** 一次性墙钟补充：仅当尚无extension记录时写入（重复调用拒绝，不循环延长）。 */
  grantWallClockExtensionOnce(extensionMs: number, reason: string): void {
    const existing = this.db.prepare('SELECT batch_id FROM tm2_eval_budget_ext WHERE batch_id=?').get(this.batchId) as { batch_id: string } | undefined;
    if (existing !== undefined) throw new Error('墙钟补充只能授予一次，已存在记录，不能循环延长');
    this.db.prepare('INSERT INTO tm2_eval_budget_ext(batch_id,extension_started_at,extension_ms,reason) VALUES(?,?,?,?)')
      .run(this.batchId, new Date().toISOString(), extensionMs, reason);
  }

  /** token估算：协议封套字节口径（bytes+maxOutput+2048），含显式headroom；不用chars/2冒充上界。 */
  private estimate(request: GuardedRequest): number {
    return Buffer.byteLength(request.prompt, 'utf8') + (request.maxOutputTokens ?? 4000) + (request.thinkingHeadroomTokens ?? 0) + 2048;
  }

  /** 包裹一个已解析适配器：每次真实dispatch前原子预留+日志，结束按实际/未知结算（幂等，迟到返回不重复结算）。 */
  wrap<A extends GuardedRequest, R extends GuardedResponse, T extends GuardedAdapter<A, R>>(adapter: T): T {
    const guard = this;
    return {
      ...adapter,
      async generate(request: A): Promise<R> {
        guard.checkWallClock();
        const reserveKey = request.requestId ?? `anon:${Date.now()}:${Math.random()}`;
        const reserved = guard.estimate(request);
        if (!guard.repo.tryReserve(guard.batchId, reserveKey, 1, reserved)) {
          throw new ParentBudgetExhausted(`请求或token达上限（${guard.limits.requests}请求/${guard.limits.tokens}tokens）`);
        }
        const now = new Date().toISOString();
        guard.db.prepare('INSERT INTO tm2_eval_reserve_journal(reserve_key,batch_id,owner_tag,requests,tokens,dispatch_mark,settled,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)')
          .run(reserveKey, guard.batchId, guard.ownerTag, 1, reserved, 'reserved', now, now);
        // 活跃调用期间续租（分钟级调用不能让租约过期被对账回收）；结束时清理定时器
        const heartbeatTimer = setInterval(() => guard.heartbeat(), Math.max(1000, Math.floor(guard.leaseTtlMs / 3)));
        heartbeatTimer.unref();
        const alreadySettled = (): { settled: number; outcome: string | null } | undefined =>
          guard.db.prepare('SELECT settled,outcome FROM tm2_eval_reserve_journal WHERE reserve_key=? AND batch_id=?').get(reserveKey, guard.batchId) as { settled: number; outcome: string | null } | undefined;
        try {
          // 紧邻发送点标记：此后崩溃按"已发未结算"对账（转unknown占额，不释放）
          guard.db.prepare("UPDATE tm2_eval_reserve_journal SET dispatch_mark='dispatching',updated_at=? WHERE reserve_key=? AND batch_id=?")
            .run(new Date().toISOString(), reserveKey, guard.batchId);
          const response = await adapter.generate(request);
          const usage = billedUsage(response);
          const journaled = alreadySettled();
          if (journaled !== undefined && journaled.settled === 1) {
            // 对账已转unknown后迟到返回：幂等重分类unknown→actual（总数仍为1），绝不再减reserved
            if (usage.known) {
              const reclassified = guard.repo.reclassifyUnknownToActual(guard.batchId, usage.total!);
              guard.db.prepare("UPDATE tm2_eval_reserve_journal SET outcome=?,updated_at=? WHERE reserve_key=? AND batch_id=?")
                .run(reclassified ? 'actual-late' : 'unknown', new Date().toISOString(), reserveKey, guard.batchId);
            }
            return response;
          }
          guard.repo.settle(guard.batchId, reserveKey, { requests: 1, reservedTokens: reserved, actualTokens: usage.known ? usage.total : null });
          guard.db.prepare("UPDATE tm2_eval_reserve_journal SET settled=1,outcome=?,updated_at=? WHERE reserve_key=? AND batch_id=?")
            .run(usage.known ? 'actual' : 'unknown', new Date().toISOString(), reserveKey, guard.batchId);
          return response;
        } catch (error) {
          const journaled = alreadySettled();
          if (journaled === undefined || journaled.settled !== 1) {
            // 未知结果占额转unknown列：不免费重试、不蒸发消耗事实（已结算不得再次结算）
            guard.repo.settle(guard.batchId, reserveKey, { requests: 1, reservedTokens: reserved, actualTokens: null });
            guard.db.prepare("UPDATE tm2_eval_reserve_journal SET settled=1,outcome='unknown',updated_at=? WHERE reserve_key=? AND batch_id=?")
              .run(new Date().toISOString(), reserveKey, guard.batchId);
          }
          throw error;
        } finally {
          clearInterval(heartbeatTimer);
        }
      }
    } as T;
  }

  snapshot(): { actual: number; unknown: number; reserved: number; limitRequests: number; limitTokens: number; startedAt: string } {
    const b = this.repo.readBudget(this.batchId)!;
    return { actual: b.actual_requests, unknown: b.unknown_requests, reserved: b.reserved_requests, limitRequests: b.limit_requests, limitTokens: b.limit_tokens, startedAt: b.started_at };
  }
}
