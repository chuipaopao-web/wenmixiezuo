import type { EvidenceCluster, RetrievalCandidate } from '../../contracts/retrieval-plan.js';
import type { IdGenerator } from '../../domain/ids.js';

export class EvidenceClusterer {
  public constructor(private readonly ids: IdGenerator) {}
  public cluster(candidates: RetrievalCandidate[]): EvidenceCluster[] {
    const groups = new Map<string, RetrievalCandidate[]>();
    for (const candidate of candidates) {
      const key = candidate.provenanceKey;
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    return [...groups.entries()].map(([clusterKey, members]) => {
      const primary = [...members].sort(comparePrimary)[0]!;
      const channelRanks: EvidenceCluster['channelRanks'] = {};
      for (const member of members) channelRanks[member.channel] = Math.min(channelRanks[member.channel] ?? Number.MAX_SAFE_INTEGER, member.channelRank);
      return {
        clusterId: this.ids.next(), clusterKey, lane: primary.lane, primary, candidates: members,
        channelRanks, rrfScore: 0, conflictGroup: primary.conflictGroup, adopted: false, adoptionReason: 'not_fused'
      };
    });
  }
}

function comparePrimary(left: RetrievalCandidate, right: RetrievalCandidate): number {
  const lane = { H: 0, E: 1, I: 2 } as const;
  const authority = { A: 0, B: 1, C: 2, D: 3 } as const;
  const leftGrade = left.authorityGrade === null ? 4 : authority[left.authorityGrade];
  const rightGrade = right.authorityGrade === null ? 4 : authority[right.authorityGrade];
  return lane[left.lane] - lane[right.lane] || leftGrade - rightGrade
    || left.channelRank - right.channelRank || left.candidateId.localeCompare(right.candidateId);
}
