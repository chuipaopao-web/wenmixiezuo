import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * MODEL-NODE-EVAL评测仓储：所有评测写入经本层（合同：所有写入应用层经仓储）。
 * 预算账本预留/实耗/未知分开持久化，进程重启不归零；硬停判断以账本为准。
 * 密钥、思维链、真实作品内容不入库；样本只用合成资料hash标识。
 */

export interface EvalRunRow {
  id: string; batch_id: string; node_key: string; length_band: string; member_role: string;
  model_profile_key: string; provider: string; model_id: string; model_plan: string;
  config_version: string; prompt_version: string; phase: 'screen' | 'validation'; status: string;
  sample_set_id: string; planned_cases: number; done_cases: number;
  reserved_requests: number; actual_requests: number; unknown_requests: number;
  reserved_tokens: number; actual_tokens: number; unknown_tokens: number;
  stop_reason: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}

export interface EvalCaseRow {
  id: string; run_id: string; node_key: string; model_profile_key: string; sample_hash: string;
  attempt_seq: number; genre: string; length_band: string; time_slot: string; sample_kind: 'positive' | 'negative';
  input_hash: string; config_version: string; prompt_version: string;
  http_status: number | null; outcome: string; technical_ok: number; contract_ok: number | null;
  quality_pass: number | null; quality_note: string | null; judge_source: string | null; judge_model_id: string | null;
  input_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null;
  usage_known: number; reserved_tokens: number; retry_count: number;
  queued_at: string; started_at: string | null; finished_at: string | null;
  queue_ms: number | null; duration_ms: number | null; error_code: string | null;
  artifact_path: string | null; provider_model_version: string | null;
}

export interface EvalBudgetRow {
  batch_id: string;
  reserved_requests: number; actual_requests: number; unknown_requests: number;
  reserved_tokens: number; actual_tokens: number; unknown_tokens: number;
  limit_requests: number; limit_tokens: number; started_at: string; updated_at: string;
}

export interface EvalRankingRow {
  id: string; node_key: string; length_band: string; config_version: string; ranking_revision: number;
  status: 'draft' | 'applied' | 'rolled_back' | 'superseded'; entries_json: string; evidence_json: string;
  created_by: string; created_at: string; applied_at: string | null; rolled_back_at: string | null;
}

export interface EvalNodePolicyRow {
  node_key: string; model_profile_key: string; state: 'active' | 'suspended' | 'pending_retest';
  reason: string; ranking_revision: number | null; policy_version: number; updated_by: string; updated_at: string;
}

export class NodeEvaluationRepository {
  constructor(private readonly db: DatabaseSync) {}

  // ---- run ----
  createRun(input: Omit<EvalRunRow, 'id' | 'done_cases' | 'reserved_requests' | 'actual_requests' | 'unknown_requests' | 'reserved_tokens' | 'actual_tokens' | 'unknown_tokens' | 'stop_reason' | 'created_at' | 'started_at' | 'finished_at'> & { id?: string }): string {
    const id = input.id ?? randomUUID();
    this.db.prepare(`INSERT INTO tm2_eval_run(id,batch_id,node_key,length_band,member_role,model_profile_key,provider,model_id,model_plan,config_version,prompt_version,phase,status,sample_set_id,planned_cases,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.batch_id, input.node_key, input.length_band, input.member_role, input.model_profile_key,
      input.provider, input.model_id, input.model_plan, input.config_version, input.prompt_version,
      input.phase, input.status, input.sample_set_id, input.planned_cases, new Date().toISOString());
    return id;
  }

  readRun(id: string): EvalRunRow | undefined {
    return this.db.prepare('SELECT * FROM tm2_eval_run WHERE id=?').get(id) as unknown as EvalRunRow | undefined;
  }

  setRunStatus(id: string, status: string, stopReason?: string): void {
    const now = new Date().toISOString();
    if (status === 'working') this.db.prepare("UPDATE tm2_eval_run SET status=?,started_at=COALESCE(started_at,?) WHERE id=?").run(status, now, id);
    else if (status === 'succeeded' || status === 'failed' || status === 'stopped' || status === 'budget-stopped' || status === 'early-eliminated')
      this.db.prepare('UPDATE tm2_eval_run SET status=?,stop_reason=?,finished_at=? WHERE id=?').run(status, stopReason ?? null, now, id);
    else this.db.prepare('UPDATE tm2_eval_run SET status=? WHERE id=?').run(status, id);
  }

  /** 断点续传：列出批次内未完成（queued/working）的run；working状态重启后按case幂等继续。 */
  resumableRuns(batchId: string): EvalRunRow[] {
    return this.db.prepare("SELECT * FROM tm2_eval_run WHERE batch_id=? AND status IN ('queued','working') ORDER BY created_at").all(batchId) as unknown as EvalRunRow[];
  }

  // ---- case（幂等：UNIQUE(run_id,sample_hash,attempt_seq)）----
  /** 已完成的case（含终态outcome）在断点续传时跳过，不重复发送真实请求。 */
  completedCaseKeys(runId: string): Set<string> {
    const rows = this.db.prepare("SELECT sample_hash,attempt_seq FROM tm2_eval_case WHERE run_id=? AND outcome NOT IN ('unknown')").all(runId) as unknown as { sample_hash: string; attempt_seq: number }[];
    return new Set(rows.map(r => `${r.sample_hash}#${r.attempt_seq}`));
  }

  nextAttemptSeq(runId: string, sampleHash: string): number {
    const row = this.db.prepare('SELECT MAX(attempt_seq) AS m FROM tm2_eval_case WHERE run_id=? AND sample_hash=?').get(runId, sampleHash) as { m: number | null };
    return (row.m ?? 0) + 1;
  }

  insertCase(row: Omit<EvalCaseRow, 'id'> & { id?: string }): string {
    const id = row.id ?? randomUUID();
    this.db.prepare(`INSERT INTO tm2_eval_case(id,run_id,node_key,model_profile_key,sample_hash,attempt_seq,genre,length_band,time_slot,sample_kind,input_hash,config_version,prompt_version,http_status,outcome,technical_ok,contract_ok,quality_pass,quality_note,judge_source,judge_model_id,input_tokens,output_tokens,reasoning_tokens,usage_known,reserved_tokens,retry_count,queued_at,started_at,finished_at,queue_ms,duration_ms,error_code,artifact_path,provider_model_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, row.run_id, row.node_key, row.model_profile_key, row.sample_hash, row.attempt_seq, row.genre, row.length_band,
      row.time_slot, row.sample_kind, row.input_hash, row.config_version, row.prompt_version, row.http_status, row.outcome,
      row.technical_ok, row.contract_ok, row.quality_pass, row.quality_note, row.judge_source, row.judge_model_id,
      row.input_tokens, row.output_tokens, row.reasoning_tokens, row.usage_known, row.reserved_tokens, row.retry_count,
      row.queued_at, row.started_at, row.finished_at, row.queue_ms, row.duration_ms, row.error_code, row.artifact_path, row.provider_model_version);
    return id;
  }

  casesForRun(runId: string): EvalCaseRow[] {
    return this.db.prepare('SELECT * FROM tm2_eval_case WHERE run_id=? ORDER BY queued_at,attempt_seq').all(runId) as unknown as EvalCaseRow[];
  }

  /** 排名取数：同节点+长度档+配置版本+阶段的全部终态case。 */
  casesForRanking(nodeKey: string, lengthBand: string, configVersion: string, phase: 'screen' | 'validation'): EvalCaseRow[] {
    return this.db.prepare(`SELECT c.* FROM tm2_eval_case c JOIN tm2_eval_run r ON r.id=c.run_id
      WHERE c.node_key=? AND r.length_band=? AND c.config_version=? AND r.phase=? AND c.outcome!='unknown'`)
      .all(nodeKey, lengthBand, configVersion, phase) as unknown as EvalCaseRow[];
  }

  /** 盲评取数：validation阶段、生成节点（审查节点质量信号已有机检）、结构通过、输出工件在案、尚未评审的case。 */
  casesNeedingJudgment(): EvalCaseRow[] {
    return this.db.prepare(`SELECT c.* FROM tm2_eval_case c JOIN tm2_eval_run r ON r.id=c.run_id
      WHERE r.phase='validation' AND c.outcome='ok' AND c.node_key NOT LIKE 'review%' AND c.judge_source IS NULL AND c.artifact_path IS NOT NULL
      ORDER BY c.node_key,c.model_profile_key,c.queued_at`).all() as unknown as EvalCaseRow[];
  }

  /** 写回盲评结论（quality_pass=null=评审分歧单独统计；judge_source含配置版本，judge_model_id记录评审模型，可含复核）。 */
  setCaseJudgment(id: string, input: { quality_pass: number | null; quality_note: string | null; judge_source: string; judge_model_id: string }): void {
    this.db.prepare('UPDATE tm2_eval_case SET quality_pass=?,quality_note=?,judge_source=?,judge_model_id=? WHERE id=?')
      .run(input.quality_pass, input.quality_note, input.judge_source, input.judge_model_id, id);
  }

  /** 批次进度（合同执行补充：完成数/计划数、最近结果时间、实测平均耗时供ETA）。 */
  batchProgress(batchId: string): { doneCases: number; plannedCases: number; latestFinishedAt: string | null; avgDurationMs: number | null } {
    // planned按run汇总（不经case连接，避免有case的run被重复计数）
    const planned = (this.db.prepare('SELECT COALESCE(SUM(planned_cases),0) AS p FROM tm2_eval_run WHERE batch_id=?').get(batchId) as { p: number }).p;
    const row = this.db.prepare(`SELECT COUNT(c.id) AS done, MAX(c.finished_at) AS latest, AVG(c.duration_ms) AS avgms
      FROM tm2_eval_case c JOIN tm2_eval_run r ON r.id=c.run_id WHERE r.batch_id=?`).get(batchId) as { done: number; latest: string | null; avgms: number | null };
    return { doneCases: row.done, plannedCases: planned, latestFinishedAt: row.latest, avgDurationMs: row.avgms };
  }

  // ---- 预算账本（预留+实耗+未知分列；重启不归零）----
  ensureBudget(batchId: string, limitRequests: number, limitTokens: number): EvalBudgetRow {
    const now = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO tm2_eval_budget(batch_id,limit_requests,limit_tokens,started_at,updated_at) VALUES(?,?,?,?,?)')
      .run(batchId, limitRequests, limitTokens, now, now);
    return this.readBudget(batchId)!;
  }

  readBudget(batchId: string): EvalBudgetRow | undefined {
    return this.db.prepare('SELECT * FROM tm2_eval_budget WHERE batch_id=?').get(batchId) as unknown as EvalBudgetRow | undefined;
  }

  /**
   * 合并核算：全部批次账本的分账明细与合计。
   * 初筛/验证/盲评/重试/端到端可分账记录，但总量必须一并展示（合同：不以新建独立账本绕过总上限）。
   */
  budgetTotals(): {
    batches: EvalBudgetRow[];
    totals: { actual_requests: number; unknown_requests: number; reserved_requests: number; actual_tokens: number; unknown_tokens: number; reserved_tokens: number };
  } {
    const batches = this.db.prepare('SELECT * FROM tm2_eval_budget ORDER BY started_at').all() as unknown as EvalBudgetRow[];
    const totals = { actual_requests: 0, unknown_requests: 0, reserved_requests: 0, actual_tokens: 0, unknown_tokens: 0, reserved_tokens: 0 };
    for (const b of batches) {
      totals.actual_requests += b.actual_requests; totals.unknown_requests += b.unknown_requests; totals.reserved_requests += b.reserved_requests;
      totals.actual_tokens += b.actual_tokens; totals.unknown_tokens += b.unknown_tokens; totals.reserved_tokens += b.reserved_tokens;
    }
    return { batches, totals };
  }

  /** 进程重启对账：新进程没有在途调用，旧进程的悬空预留归零（实耗/未知列绝不清零）。 */
  reconcileReservedOnBoot(batchId: string): void {
    this.db.prepare('UPDATE tm2_eval_budget SET reserved_requests=0,reserved_tokens=0,updated_at=? WHERE batch_id=?').run(new Date().toISOString(), batchId);
    this.db.prepare("UPDATE tm2_eval_run SET reserved_requests=0,reserved_tokens=0 WHERE batch_id=? AND status IN ('queued','working')").run(batchId);
  }

  /**
   * 迟到返回的幂等重分类（Codex预算反例P2）：对账已把预留转unknown后原请求成功返回——
   * 同一请求总数仍计1，unknown列减、actual列加，绝不再动reserved（避免负预留/重复结算）。
   * CAS条件核验：仅当unknown列足够时才更新并返回true，否则返回false（调用方保守保留unknown）。
   */
  reclassifyUnknownToActual(batchId: string, tokens: number): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`UPDATE tm2_eval_budget
      SET unknown_requests=unknown_requests-1,actual_requests=actual_requests+1,
          unknown_tokens=unknown_tokens-?,actual_tokens=actual_tokens+?,updated_at=?
      WHERE batch_id=? AND unknown_requests>=1 AND unknown_tokens>=?`)
      .run(tokens, tokens, now, batchId, tokens);
    return result.changes === 1;
  }

  /** 预留（发送前）。返回false=预算硬停：预留后任一口径超限即拒绝本次发送。 */
  tryReserve(batchId: string, runId: string, requests: number, tokens: number): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const budget = this.readBudget(batchId)!;
      if (budget.actual_requests + budget.unknown_requests + budget.reserved_requests + requests > budget.limit_requests
        || budget.actual_tokens + budget.unknown_tokens + budget.reserved_tokens + tokens > budget.limit_tokens) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const now = new Date().toISOString();
      this.db.prepare('UPDATE tm2_eval_budget SET reserved_requests=reserved_requests+?,reserved_tokens=reserved_tokens+?,updated_at=? WHERE batch_id=?').run(requests, tokens, now, batchId);
      this.db.prepare('UPDATE tm2_eval_run SET reserved_requests=reserved_requests+?,reserved_tokens=reserved_tokens+? WHERE id=?').run(requests, tokens, runId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  /** 结算（调用结束）：预留转实耗或未知。usage已知按实际上报；未知按预留额计入unknown列。 */
  settle(batchId: string, runId: string, input: { requests: number; reservedTokens: number; actualTokens: number | null }): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      if (input.actualTokens === null) {
        this.db.prepare('UPDATE tm2_eval_budget SET reserved_requests=reserved_requests-?,unknown_requests=unknown_requests+?,reserved_tokens=reserved_tokens-?,unknown_tokens=unknown_tokens+?,updated_at=? WHERE batch_id=?')
          .run(input.requests, input.requests, input.reservedTokens, input.reservedTokens, now, batchId);
        this.db.prepare('UPDATE tm2_eval_run SET reserved_requests=reserved_requests-?,unknown_requests=unknown_requests+?,reserved_tokens=reserved_tokens-?,unknown_tokens=unknown_tokens+?,done_cases=done_cases+1 WHERE id=?')
          .run(input.requests, input.requests, input.reservedTokens, input.reservedTokens, runId);
      } else {
        this.db.prepare('UPDATE tm2_eval_budget SET reserved_requests=reserved_requests-?,actual_requests=actual_requests+?,reserved_tokens=reserved_tokens-?,actual_tokens=actual_tokens+?,updated_at=? WHERE batch_id=?')
          .run(input.requests, input.requests, input.reservedTokens, input.actualTokens, now, batchId);
        this.db.prepare('UPDATE tm2_eval_run SET reserved_requests=reserved_requests-?,actual_requests=actual_requests+?,reserved_tokens=reserved_tokens-?,actual_tokens=actual_tokens+?,done_cases=done_cases+1 WHERE id=?')
          .run(input.requests, input.requests, input.reservedTokens, input.actualTokens, runId);
      }
      this.db.exec('COMMIT');
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  // ---- 排名版本 ----
  nextRankingRevision(nodeKey: string, lengthBand: string, configVersion: string): number {
    const row = this.db.prepare('SELECT MAX(ranking_revision) AS m FROM tm2_eval_ranking WHERE node_key=? AND length_band=? AND config_version=?').get(nodeKey, lengthBand, configVersion) as { m: number | null };
    return (row.m ?? 0) + 1;
  }

  insertRanking(input: { node_key: string; length_band: string; config_version: string; entries_json: string; evidence_json: string; created_by: string }): string {
    const id = randomUUID();
    const revision = this.nextRankingRevision(input.node_key, input.length_band, input.config_version);
    this.db.prepare(`INSERT INTO tm2_eval_ranking(id,node_key,length_band,config_version,ranking_revision,status,entries_json,evidence_json,created_by,created_at)
      VALUES(?,?,?,?,?,'draft',?,?,?,?)`).run(id, input.node_key, input.length_band, input.config_version, revision, input.entries_json, input.evidence_json, input.created_by, new Date().toISOString());
    return id;
  }

  readRanking(id: string): EvalRankingRow | undefined {
    return this.db.prepare('SELECT * FROM tm2_eval_ranking WHERE id=?').get(id) as unknown as EvalRankingRow | undefined;
  }

  appliedRanking(nodeKey: string, lengthBand: string): EvalRankingRow | undefined {
    return this.db.prepare("SELECT * FROM tm2_eval_ranking WHERE node_key=? AND length_band=? AND status='applied' ORDER BY ranking_revision DESC LIMIT 1").get(nodeKey, lengthBand) as unknown as EvalRankingRow | undefined;
  }

  /** 应用排名：同节点+长度档旧applied置superseded；只影响新任务快照（运行时装配读取applied）。 */
  applyRanking(id: string): void {
    const target = this.readRanking(id);
    if (!target || target.status !== 'draft') throw new Error('排名不存在或不是待应用状态');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE tm2_eval_ranking SET status='superseded' WHERE node_key=? AND length_band=? AND status='applied'").run(target.node_key, target.length_band);
      this.db.prepare("UPDATE tm2_eval_ranking SET status='applied',applied_at=? WHERE id=?").run(new Date().toISOString(), id);
      this.db.exec('COMMIT');
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  /** 回滚：applied回rolled_back，最近一个superseded恢复applied。 */
  rollbackRanking(id: string): void {
    const target = this.readRanking(id);
    if (!target || target.status !== 'applied') throw new Error('排名不存在或未在应用状态');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      this.db.prepare("UPDATE tm2_eval_ranking SET status='rolled_back',rolled_back_at=? WHERE id=?").run(now, id);
      const previous = this.db.prepare("SELECT id FROM tm2_eval_ranking WHERE node_key=? AND length_band=? AND status='superseded' ORDER BY ranking_revision DESC LIMIT 1").get(target.node_key, target.length_band) as { id: string } | undefined;
      if (previous) this.db.prepare("UPDATE tm2_eval_ranking SET status='applied',applied_at=? WHERE id=?").run(now, previous.id);
      this.db.exec('COMMIT');
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error; }
  }

  // ---- 节点派工策略 ----
  upsertNodePolicy(nodeKey: string, modelProfileKey: string, state: 'active' | 'suspended' | 'pending_retest', reason: string, rankingRevision: number | null, updatedBy: string): void {
    const existing = this.db.prepare('SELECT policy_version FROM tm2_eval_node_policy WHERE node_key=? AND model_profile_key=?').get(nodeKey, modelProfileKey) as { policy_version: number } | undefined;
    const version = (existing?.policy_version ?? 0) + 1;
    this.db.prepare(`INSERT INTO tm2_eval_node_policy(node_key,model_profile_key,state,reason,ranking_revision,policy_version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(node_key,model_profile_key) DO UPDATE SET state=excluded.state,reason=excluded.reason,ranking_revision=excluded.ranking_revision,policy_version=excluded.policy_version,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(nodeKey, modelProfileKey, state, reason, rankingRevision, version, updatedBy, new Date().toISOString());
  }

  nodePolicies(nodeKey: string): EvalNodePolicyRow[] {
    return this.db.prepare('SELECT * FROM tm2_eval_node_policy WHERE node_key=?').all(nodeKey) as unknown as EvalNodePolicyRow[];
  }

  /** 运行时装配读取：某节点被暂停的模型（新任务快照排除；在途快照不改）。 */
  suspendedModels(nodeKey: string): string[] {
    return (this.db.prepare("SELECT model_profile_key FROM tm2_eval_node_policy WHERE node_key=? AND state='suspended'").all(nodeKey) as unknown as { model_profile_key: string }[]).map(r => r.model_profile_key);
  }
}
