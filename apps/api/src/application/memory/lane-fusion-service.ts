import type { EvidenceCluster, RetrievalChannel } from '../../contracts/retrieval-plan.js';

const WEIGHTS: Record<RetrievalChannel, number> = { structured: 1.4, fts: 1, vector: 0.8, relation: 1.1 };

export class LaneFusionService {
  public fuse(clusters: EvidenceCluster[], mode: 'open_discussion' | 'formal_production'): EvidenceCluster[] {
    const conflicts = conflictingGroups(clusters);
    return clusters.map((cluster) => {
      if (cluster.lane === 'H') {
        const conflict = cluster.conflictGroup !== null && conflicts.has(cluster.conflictGroup);
        return { ...cluster, rrfScore: 0, adopted: !conflict, adoptionReason: conflict ? 'hard_conflict_requires_resolution' : 'hard_authority_lane' };
      }
      const rrfScore = Object.entries(cluster.channelRanks).reduce((score, [channel, rank]) => score + WEIGHTS[channel as RetrievalChannel] / (60 + rank!), 0);
      const conflict = cluster.conflictGroup !== null && conflicts.has(cluster.conflictGroup);
      return { ...cluster, rrfScore, adopted: !conflict || mode === 'open_discussion', adoptionReason: conflict ? 'conflict_exposed_as_branch' : 'ranked_evidence' };
    }).sort((left, right) => laneOrder(left.lane) - laneOrder(right.lane) || right.rrfScore - left.rrfScore || left.clusterId.localeCompare(right.clusterId));
  }
}

function conflictingGroups(clusters: EvidenceCluster[]): Set<string> {
  const values = new Map<string, Set<string>>();
  for (const cluster of clusters) if (cluster.conflictGroup !== null) {
    const set = values.get(cluster.conflictGroup) ?? new Set<string>();
    set.add(`${cluster.primary.negated}:${cluster.primary.content}`);
    values.set(cluster.conflictGroup, set);
  }
  return new Set([...values].filter(([, set]) => set.size > 1).map(([key]) => key));
}
function laneOrder(lane: EvidenceCluster['lane']): number { return lane === 'H' ? 0 : lane === 'E' ? 1 : 2; }
