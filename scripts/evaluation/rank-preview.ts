import { DatabaseSync } from 'node:sqlite';
import { V7NodeEvaluationService } from '../../apps/api/src/application/agents/v7-node-evaluation-service.js';
import { NodeEvaluationRepository } from '../../apps/api/src/infrastructure/db/repositories/node-evaluation-repository.js';

/** 排名预览（隔离副本 .local/eval/proof.sqlite 上运行；只写草稿排名行，不动正式库）。 */
const db = new DatabaseSync('.local/eval/proof.sqlite');
const svc = new V7NodeEvaluationService(db);
const repo = new NodeEvaluationRepository(db);
for (const nodeKey of ['card-extract', 'card-finalize', 'card-merge', 'skeleton', 'volume-card', 'volumes-batch', 'review-source', 'review-anchors']) {
  try {
    const { id, qualifiedTop } = svc.computeRanking(nodeKey, 'k3-preview');
    const rankRow = repo.readRanking(id)!;
    const entries = JSON.parse(rankRow.entries_json) as { rank: number; modelProfileKey: string; admission: string; reasons: string[]; n: number; technicalDeliveryRate: number; qualityPassRate: number | null; wilsonLowerBound: number }[];
    console.log(`\n== ${nodeKey} 合格前三数=${qualifiedTop} ==`);
    for (const e of entries) {
      console.log(`  rank${e.rank} ${e.modelProfileKey} ${e.admission} n=${e.n} 技术交付=${(e.technicalDeliveryRate * 100).toFixed(0)}% 质量=${e.qualityPassRate === null ? '未评' : (e.qualityPassRate * 100).toFixed(0) + '%'} wilson=${e.wilsonLowerBound.toFixed(3)} ${e.reasons.join('|').slice(0, 100)}`);
    }
  } catch (error) { console.log(`\n== ${nodeKey}: ${error instanceof Error ? error.message : error}`); }
}
db.close();
