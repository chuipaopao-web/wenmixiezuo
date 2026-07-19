import type { RoleContextInput, RoleContextPack } from '../../contracts/context-pack-v2.js';
import type { EvidenceCluster } from '../../contracts/retrieval-plan.js';
import { estimateTokens } from './context-pack-service.js';

const WRITERS = new Set(['lead_writer', 'backup_writer', 'lead_screenwriter', 'second_screenwriter']);
const REVIEWERS = new Set(['fact_reviewer', 'literary_reviewer', 'experience_reviewer']);

export class RoleContextCompiler {
  public compile(input: RoleContextInput): RoleContextPack {
    const closureByCluster = new Map(input.closures.map((closure) => [closure.clusterId, closure]));
    const hard = input.clusters.filter((cluster) => cluster.lane === 'H' && cluster.adopted);
    const unclosedHard = hard.filter((cluster) => closureByCluster.get(cluster.clusterId)?.result !== 'closed');
    if (input.mode === 'formal_production' && unclosedHard.length > 0) throw new Error('正式生产存在未闭环硬证据');
    const hardTokens = totalTokens(hard) + estimateTokens(input.taskInstruction) + estimateTokens(input.expressionBaseline ?? '');
    if (hardTokens > input.inputTokenBudget) throw new Error('硬来源超过上下文预算，必须缩小场景或拆分任务');
    const evidenceLimit = REVIEWERS.has(input.roleKey) ? 12 : WRITERS.has(input.roleKey) ? 8 : 16;
    const inspirationLimit = input.mode === 'formal_production' && ['lead_writer', 'backup_writer'].includes(input.roleKey) ? 4 : WRITERS.has(input.roleKey) ? 6 : 8;
    const evidenceCandidates = input.clusters.filter((cluster) => cluster.lane === 'E' && cluster.adopted).slice(0, evidenceLimit);
    const inspirationCandidates = input.clusters.filter((cluster) => cluster.lane === 'I' && cluster.adopted).slice(0, inspirationLimit);
    let selectedTokens = hardTokens;
    const evidence: EvidenceCluster[] = [];
    const inspiration: EvidenceCluster[] = [];
    const excluded: RoleContextPack['excluded'] = [];
    for (const cluster of [...evidenceCandidates, ...inspirationCandidates]) {
      const tokens = estimateTokens(cluster.primary.content);
      if (selectedTokens + tokens <= input.inputTokenBudget) {
        (cluster.lane === 'E' ? evidence : inspiration).push(cluster);
        selectedTokens += tokens;
      } else excluded.push({ clusterId: cluster.clusterId, reason: 'token_budget_lower_priority' });
    }
    for (const cluster of input.clusters) if (![...hard, ...evidence, ...inspiration].some((selected) => selected.clusterId === cluster.clusterId)
      && !excluded.some((item) => item.clusterId === cluster.clusterId)) excluded.push({ clusterId: cluster.clusterId, reason: cluster.adopted ? 'role_profile_limit' : cluster.adoptionReason });
    return {
      hard, evidence, inspiration, excluded, selectedTokens,
      creativeFreedom: WRITERS.has(input.roleKey)
        ? '硬事实、任务目标和安全边界之外的对白、动作、意象、节奏与局部调度由写手自由创作；灵感卡允许不用或变形，禁止仿写原句。'
        : '在岗位职责范围内独立判断；软资料不具有事实阻断权。',
      warnings: input.expressionBaseline === null || input.expressionBaseline === undefined ? ['表达基线尚未确认'] : []
    };
  }
}

function totalTokens(clusters: EvidenceCluster[]): number { return clusters.reduce((sum, cluster) => sum + estimateTokens(cluster.primary.content), 0); }
