import type { DatabaseSync } from 'node:sqlite';
import { NodeEvaluationRepository, type EvalRankingRow } from '../../infrastructure/db/repositories/node-evaluation-repository.js';
import { EVAL_NODE_REGISTRY, findEvalNode } from '../evaluation/node-registry.js';
import { aggregateModelStats, admitModel, rankNodeEntries, type EvalCaseMetricsInput, type ModelNodeStats } from '../evaluation/evaluation-ranking.js';
import { TEXT_MODELS } from '@wenmi/agent-catalog';

/**
 * MODEL-NODE-EVAL后台视图与排名应用服务（合同"后台UI"/"上岗与恢复"节）。
 * - 数据全部来自tm2_eval_*表，与证据逐条一致；未测/进行中/小样本/合格/暂停分开，不用空白或0冒充。
 * - 静态历史报告（agent-catalog的openingEvaluation/settingEvaluation）与本服务实时成绩分离，不混用。
 * - 应用/回滚排名只影响新任务快照：运行时装配读applied排名+node_policy；在途快照不改。
 */

export interface NodeModelSummary {
  readonly modelProfileKey: string;
  readonly modelId: string;
  readonly publicName: string;
  readonly state: 'untested' | 'in_progress' | 'small_sample' | 'qualified' | 'below_threshold' | 'suspended' | 'pending_retest';
  readonly stats: ModelNodeStats | null;
  readonly admissionReasons: readonly string[];
  readonly policy: { state: string; reason: string; policyVersion: number } | null;
}

export interface NodeEvaluationView {
  readonly nodeKey: string;
  readonly purpose: string;
  readonly memberRole: string;
  readonly batch: number;
  readonly budgetClass: number;
  readonly promptVersion: string;
  readonly runCount: number;
  readonly finishedRuns: number;
  readonly latestActivityAt: string | null;
  readonly models: NodeModelSummary[];
  readonly ranking: { id: string; revision: number; status: string; createdAt: string; entries: unknown } | null;
  readonly rankingStale: boolean; // 配置/提示版本已变，旧成绩需复测
}

const CURRENT_CONFIG_VERSION = 'cfg-validation-default';

export class V7NodeEvaluationService {
  private readonly repo: NodeEvaluationRepository;
  constructor(private readonly db: DatabaseSync) {
    this.repo = new NodeEvaluationRepository(db);
  }

  /** 名册全部文字模型（未测不静默漏项）。 */
  private roster(): { profileKey: string; publicName: string }[] {
    return TEXT_MODELS.filter(m => m.kind === 'text' && m.profileKey !== 'glm-5.2').map(m => ({ profileKey: m.profileKey, publicName: m.publicName }));
  }

  private caseMetrics(nodeKey: string): Map<string, EvalCaseMetricsInput[]> {
    const rows = this.db.prepare(`SELECT c.* FROM tm2_eval_case c JOIN tm2_eval_run r ON r.id=c.run_id WHERE c.node_key=? AND c.outcome!='unknown'`).all(nodeKey) as unknown as import('../../infrastructure/db/repositories/node-evaluation-repository.js').EvalCaseRow[];
    const byModel = new Map<string, EvalCaseMetricsInput[]>();
    for (const row of rows) {
      const isReview = nodeKey.startsWith('review');
      const input: EvalCaseMetricsInput = {
        modelProfileKey: row.model_profile_key,
        modelId: row.model_profile_key, // 名册模型=modelId（Agent Plan按profileKey直调）
        outcome: row.outcome,
        technicalOk: row.technical_ok === 1,
        contractOk: row.contract_ok === null ? null : row.contract_ok === 1,
        qualityPass: row.quality_pass === null ? null : row.quality_pass === 1,
        durationMs: row.duration_ms,
        totalTokens: row.usage_known === 1 && row.input_tokens !== null && row.output_tokens !== null
          ? row.input_tokens + row.output_tokens + (row.reasoning_tokens ?? 0) : null,
        retryCount: row.retry_count,
        seededErrorCaught: isReview && row.sample_kind === 'negative' ? row.quality_pass === 1 : null,
        cleanSampleFalseAlarm: isReview && row.sample_kind === 'positive' ? row.quality_pass === 0 : null,
        criticalConstraintMissed: row.error_code?.startsWith('critical:') ?? false
      };
      const list = byModel.get(row.model_profile_key) ?? [];
      list.push(input);
      byModel.set(row.model_profile_key, list);
    }
    return byModel;
  }

  adminView(): NodeEvaluationView[] {
    const views: NodeEvaluationView[] = [];
    for (const node of EVAL_NODE_REGISTRY) {
      const runs = this.db.prepare('SELECT status,finished_at,started_at FROM tm2_eval_run WHERE node_key=?').all(node.nodeKey) as { status: string; finished_at: string | null; started_at: string | null }[];
      const byModel = this.caseMetrics(node.nodeKey);
      const policies = new Map(this.repo.nodePolicies(node.nodeKey).map(p => [p.model_profile_key, p]));
      const applied = this.repo.appliedRanking(node.nodeKey, 'all');
      const kind = node.nodeKey.startsWith('review') ? 'review' as const : 'generation' as const;
      const models: NodeModelSummary[] = this.roster().map(({ profileKey, publicName }) => {
        const policy = policies.get(profileKey);
        const cases = byModel.get(profileKey) ?? [];
        if (!cases.length) {
          const inProgress = runs.some(r => r.status === 'working' || r.status === 'queued')
            && (this.db.prepare('SELECT 1 FROM tm2_eval_run WHERE node_key=? AND model_profile_key=? AND status IN (\'working\',\'queued\') LIMIT 1').get(node.nodeKey, profileKey) !== undefined);
          return {
            modelProfileKey: profileKey, modelId: profileKey, publicName,
            state: policy?.state === 'suspended' ? 'suspended' : inProgress ? 'in_progress' : 'untested',
            stats: null, admissionReasons: [],
            policy: policy ? { state: policy.state, reason: policy.reason, policyVersion: policy.policy_version } : null
          };
        }
        const stats = aggregateModelStats(profileKey, profileKey, cases);
        const admission = admitModel(stats, kind);
        const state: NodeModelSummary['state'] = policy?.state === 'suspended' ? 'suspended'
          : policy?.state === 'pending_retest' ? 'pending_retest'
          : admission.state === 'qualified' ? 'qualified'
          : admission.state === 'insufficient_samples' || admission.state === 'quality_unjudged' ? 'small_sample'
          : 'below_threshold';
        return {
          modelProfileKey: profileKey, modelId: profileKey, publicName, state, stats,
          admissionReasons: admission.reasons,
          policy: policy ? { state: policy.state, reason: policy.reason, policyVersion: policy.policy_version } : null
        };
      });
      const latest = runs.map(r => r.finished_at ?? r.started_at).filter((v): v is string => v !== null).toSorted().at(-1) ?? null;
      views.push({
        nodeKey: node.nodeKey, purpose: node.purpose, memberRole: node.memberRole, batch: node.batch,
        budgetClass: node.budgetClass, promptVersion: node.promptVersion,
        runCount: runs.length, finishedRuns: runs.filter(r => r.status === 'succeeded' || r.status === 'budget-stopped').length,
        latestActivityAt: latest, models,
        ranking: applied ? { id: applied.id, revision: applied.ranking_revision, status: applied.status, createdAt: applied.created_at, entries: JSON.parse(applied.entries_json) } : null,
        rankingStale: applied ? !applied.config_version.includes(CURRENT_CONFIG_VERSION) && applied.config_version !== CURRENT_CONFIG_VERSION : false
      });
    }
    return views;
  }

  /** 由已存case计算排名草稿（同输入可复算；配置版本为当前评测配置）。 */
  computeRanking(nodeKey: string, createdBy: string): { id: string; qualifiedTop: number } {
    const node = findEvalNode(nodeKey);
    if (!node) throw new Error(`未登记节点：${nodeKey}`);
    const kind = nodeKey.startsWith('review') ? 'review' as const : 'generation' as const;
    const cases = this.repo.casesForRanking(nodeKey, 'all', 'cfg-validation-default', 'validation');
    const byModel = new Map<string, EvalCaseMetricsInput[]>();
    for (const row of cases) {
      const list = byModel.get(row.model_profile_key) ?? [];
      list.push({
        modelProfileKey: row.model_profile_key, modelId: row.model_profile_key, outcome: row.outcome,
        technicalOk: row.technical_ok === 1, contractOk: row.contract_ok === null ? null : row.contract_ok === 1,
        qualityPass: row.quality_pass === null ? null : row.quality_pass === 1,
        durationMs: row.duration_ms,
        totalTokens: row.usage_known === 1 && row.input_tokens !== null && row.output_tokens !== null ? row.input_tokens + row.output_tokens + (row.reasoning_tokens ?? 0) : null,
        retryCount: row.retry_count,
        seededErrorCaught: kind === 'review' && row.sample_kind === 'negative' ? row.quality_pass === 1 : null,
        cleanSampleFalseAlarm: kind === 'review' && row.sample_kind === 'positive' ? row.quality_pass === 0 : null,
        criticalConstraintMissed: row.error_code?.startsWith('critical:') ?? false
      });
      byModel.set(row.model_profile_key, list);
    }
    const allStats = [...byModel.entries()].map(([key, list]) => aggregateModelStats(key, key, list));
    if (!allStats.length) throw new Error('该节点暂无保留验证样本结果，不能生成排名（小样本初筛不称稳定结论）');
    const { entries, qualifiedTop } = rankNodeEntries(allStats, kind);
    const id = this.repo.insertRanking({
      node_key: nodeKey, length_band: 'all', config_version: CURRENT_CONFIG_VERSION,
      entries_json: JSON.stringify(entries.map(e => ({
        rank: e.rank, modelProfileKey: e.stats.modelProfileKey, modelId: e.stats.modelId,
        admission: e.admission.state, reasons: e.admission.reasons,
        n: e.stats.n, technicalDeliveryRate: e.stats.technicalDeliveryRate, qualityPassRate: e.stats.qualityPassRate,
        wilsonLowerBound: e.stats.wilsonLowerBound, medianMs: e.stats.medianMs, p95Ms: e.stats.p95Ms, p95SmallSample: e.stats.p95SmallSample,
        truncationCount: e.stats.truncationCount, timeoutCount: e.stats.timeoutCount, unknownCount: e.stats.unknownCount,
        avgTokens: e.stats.avgTokens, totalTokens: e.stats.totalTokens, avgRetries: e.stats.avgRetries,
        seededErrorRecall: e.stats.seededErrorRecall, cleanFalseAlarmRate: e.stats.cleanFalseAlarmRate, criticalMissCount: e.stats.criticalMissCount
      }))),
      evidence_json: JSON.stringify({ caseCount: cases.length, configVersion: CURRENT_CONFIG_VERSION, computedAt: new Date().toISOString() }),
      created_by: createdBy
    });
    return { id, qualifiedTop: qualifiedTop.length };
  }

  /** 应用排名：写入node_policy（在岗模型绑定rankingRevision+policyVersion）；只影响新任务快照。 */
  applyRanking(adminId: string, rankingId: string): void {
    const ranking = this.repo.readRanking(rankingId);
    if (!ranking) throw new Error('排名不存在');
    const entries = JSON.parse(ranking.entries_json) as { rank: number; modelProfileKey: string }[];
    this.repo.applyRanking(rankingId);
    for (const entry of entries.filter(e => e.rank > 0)) {
      this.repo.upsertNodePolicy(ranking.node_key, entry.modelProfileKey, 'active', `排名v${ranking.ranking_revision}第${entry.rank}名`, ranking.ranking_revision, adminId);
    }
  }

  rollbackRanking(adminId: string, rankingId: string): void {
    const ranking = this.repo.readRanking(rankingId);
    if (!ranking) throw new Error('排名不存在');
    this.repo.rollbackRanking(rankingId);
    const restored = this.repo.appliedRanking(ranking.node_key, ranking.length_band);
    // 回滚后同步策略：本版排名写入的active标记回到上一版
    for (const policy of this.repo.nodePolicies(ranking.node_key)) {
      if (policy.ranking_revision === ranking.ranking_revision && policy.state === 'active') {
        this.repo.upsertNodePolicy(ranking.node_key, policy.model_profile_key, restored ? 'active' : 'pending_retest',
          restored ? `回滚至排名v${restored.ranking_revision}` : '回滚后无在岗排名，待复测', restored?.ranking_revision ?? null, adminId);
      }
    }
  }

  setNodePolicy(adminId: string, nodeKey: string, modelProfileKey: string, state: 'active' | 'suspended' | 'pending_retest', reason: string): void {
    if (!findEvalNode(nodeKey)) throw new Error(`未登记节点：${nodeKey}`);
    if (!reason.trim()) throw new Error('必须填写原因');
    const applied = this.repo.appliedRanking(nodeKey, 'all');
    this.repo.upsertNodePolicy(nodeKey, modelProfileKey, state, reason, applied?.ranking_revision ?? null, adminId);
  }

  /** 失败自动暂停规则（合同：连续3次技术失败或5次内2次截断→暂停派工提示复测；可配置初始规则）。 */
  evaluateSuspensionRules(adminId: string): { nodeKey: string; modelProfileKey: string; reason: string }[] {
    const suspended: { nodeKey: string; modelProfileKey: string; reason: string }[] = [];
    for (const node of EVAL_NODE_REGISTRY) {
      const rows = this.db.prepare(`SELECT model_profile_key,outcome,queued_at FROM tm2_eval_case WHERE node_key=? ORDER BY queued_at DESC`).all(node.nodeKey) as { model_profile_key: string; outcome: string; queued_at: string }[];
      const byModel = new Map<string, string[]>();
      for (const row of rows) {
        const list = byModel.get(row.model_profile_key) ?? [];
        if (list.length < 5) list.push(row.outcome);
        byModel.set(row.model_profile_key, list);
      }
      for (const [model, outcomes] of byModel) {
        const techFails = outcomes.slice(0, 3).filter(o => ['http_error', 'timeout', 'auth_error', 'rate_limited'].includes(o)).length;
        const truncations = outcomes.filter(o => o === 'truncated').length;
        if (techFails === 3) {
          this.repo.upsertNodePolicy(node.nodeKey, model, 'suspended', '连续3次技术失败，暂停派工待复测', null, adminId);
          suspended.push({ nodeKey: node.nodeKey, modelProfileKey: model, reason: '连续3次技术失败' });
        } else if (outcomes.length >= 5 && truncations >= 2) {
          this.repo.upsertNodePolicy(node.nodeKey, model, 'suspended', '5次内2次截断，暂停派工待复测', null, adminId);
          suspended.push({ nodeKey: node.nodeKey, modelProfileKey: model, reason: '5次内2次截断' });
        }
      }
    }
    return suspended;
  }

  rankingsFor(nodeKey: string): EvalRankingRow[] {
    return this.db.prepare('SELECT * FROM tm2_eval_ranking WHERE node_key=? ORDER BY ranking_revision DESC').all(nodeKey) as unknown as EvalRankingRow[];
  }
}
