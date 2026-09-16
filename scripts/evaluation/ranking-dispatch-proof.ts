/**
 * 排名应用与"不稳定模型被排除、候补接替"真实证明（隔离环境）：
 * 在正式评测库的隔离副本（.local/eval/proof.sqlite）上，用真实验证数据走生产函数全链路：
 * computeRanking（真实case统计）→ applyRanking（写node_policy）→ setNodePolicy（暂停不达标模型）
 * → resolveNodeMember/nodeFallbackOrder（生产派工纯函数）验证doubao在card-finalize被排除、候补按名次接替。
 * 证据落 .local/eval/ranking-dispatch-proof.json；不动正式库、不碰生产快照。
 */
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { V7NodeEvaluationService } from '../../apps/api/src/application/agents/v7-node-evaluation-service.js';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';
import { resolveNodeMember, nodeFallbackOrder, type NodeDispatchInput } from '../../apps/api/src/application/evaluation/node-policy-dispatch.js';
import type { V7EffectiveMember } from '@wenmi/v7-backend';

const db = new DatabaseSync('.local/eval/proof.sqlite');
const svc = new V7NodeEvaluationService(db);
const repo = new NodeEvaluationRepository(db);
const NODE = 'card-finalize';
const OPERATOR = 'k3-proof';

// 1. 真实数据计算排名：doubao技术交付70%<90%必须below_threshold
const { id: rankingId, qualifiedTop } = svc.computeRanking(NODE, OPERATOR);
const ranking = repo.readRanking(rankingId)!;
const entries = JSON.parse(ranking.entries_json) as { rank: number; modelProfileKey: string; admission: string; reasons: string[]; technicalDeliveryRate: number; qualityPassRate: number | null; n: number }[];
const doubao = entries.find(e => e.modelProfileKey === 'doubao-seed-2.1-turbo')!;
if (doubao.admission !== 'below_threshold') throw new Error(`证明前置失败：doubao应为below_threshold，实际${doubao.admission}`);
if (qualifiedTop !== 3) throw new Error(`证明前置失败：合格前三应为3，实际${qualifiedTop}`);
const rankedModelIds = entries.filter(e => e.rank > 0).map(e => e.modelProfileKey);
if (rankedModelIds.includes('doubao-seed-2.1-turbo')) throw new Error('证明前置失败：doubao不应进入合格前三');

// 2. 应用排名（写node_policy active）+ 暂停不达标模型（评测证据驱动）
svc.applyRanking(OPERATOR, rankingId);
svc.setNodePolicy(OPERATOR, NODE, 'doubao-seed-2.1-turbo', 'suspended',
  `验证技术交付率${(doubao.technicalDeliveryRate * 100).toFixed(0)}%<90%门槛（n=${doubao.n}，3次合同失败：短卡引用不存在/JSON不可解析=模型幻觉），暂停该节点派工待复测`);

// 3. 生产派工纯函数验证（候选顺序=验证第一波候选顺序，成员对象为最小V7EffectiveMember形态）
const memberOf = (modelId: string): V7EffectiveMember => ({ memberKey: `writer-${modelId}`, model: { modelId } }) as unknown as V7EffectiveMember;
const candidates = ['deepseek-v4-flash', 'deepseek-v4-pro', 'doubao-seed-2.1-turbo', 'kimi-k3'].map(memberOf);
const policies = repo.nodePolicies(NODE);
const input: NodeDispatchInput = { candidates, policies, rankedModelIds };

const resolved = resolveNodeMember(input);
if (resolved.member?.model.modelId === 'doubao-seed-2.1-turbo') throw new Error('证明失败：被暂停模型仍被派工');
const fallback = nodeFallbackOrder(input).map(m => m.model.modelId);
if (fallback.includes('doubao-seed-2.1-turbo')) throw new Error('证明失败：被暂停模型仍在候补序列');

// 4. 接替证明：第1名也暂停时，候补第2名立即接替（不回落到doubao）
svc.setNodePolicy(OPERATOR, NODE, 'deepseek-v4-flash', 'suspended', '证明用：模拟在岗第1名触发自动暂停');
const afterTopSuspended = resolveNodeMember({ candidates, policies: repo.nodePolicies(NODE), rankedModelIds });
const fallbackAfter = nodeFallbackOrder({ candidates, policies: repo.nodePolicies(NODE), rankedModelIds }).map(m => m.model.modelId);
if (afterTopSuspended.member?.model.modelId !== 'kimi-k3') throw new Error(`证明失败：第1名暂停后应由候补第2名kimi-k3接替，实际${afterTopSuspended.member?.model.modelId}`);

const evidence = {
  generatedAt: new Date().toISOString(),
  scope: '隔离副本proof.sqlite，正式库未改；排名应用/暂停只影响新任务快照语义，不触碰生产',
  node: NODE,
  ranking: { id: rankingId, revision: ranking.ranking_revision, qualifiedTop, entries: entries.map(e => ({ rank: e.rank, model: e.modelProfileKey, admission: e.admission, technicalDeliveryRate: e.technicalDeliveryRate, qualityPassRate: e.qualityPassRate, n: e.n, reasons: e.reasons })) },
  policies: repo.nodePolicies(NODE).map(p => ({ model: p.model_profile_key, state: p.state, reason: p.reason, policyVersion: p.policy_version })),
  dispatchProof: {
    beforeTopSuspended: { member: resolved.member?.model.modelId ?? null, reason: resolved.reason, policyApplied: resolved.policyApplied, fallbackOrder: fallback },
    afterTopSuspended: { member: afterTopSuspended.member?.model.modelId ?? null, reason: afterTopSuspended.reason, fallbackOrder: fallbackAfter },
    doubaoExcluded: !fallback.includes('doubao-seed-2.1-turbo') && !fallbackAfter.includes('doubao-seed-2.1-turbo')
  }
};
writeFileSync('.local/eval/ranking-dispatch-proof.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence.dispatchProof, null, 1));
console.log(`排名v${ranking.ranking_revision}：合格前三=${rankedModelIds.join('>')}；doubao ${doubao.admission}（技术交付${(doubao.technicalDeliveryRate * 100).toFixed(0)}%）已暂停该节点派工`);
db.close();
