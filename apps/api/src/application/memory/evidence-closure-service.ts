import type { EvidenceClosure, EvidenceCluster, RetrievalPlan } from '../../contracts/retrieval-plan.js';

export class EvidenceClosureService {
  public check(plan: RetrievalPlan, cluster: EvidenceCluster): EvidenceClosure {
    const sourceResolved = cluster.primary.sourceId.length > 0 && Object.keys(cluster.primary.sourceLocator).length > 0;
    const hashVerified = cluster.primary.sourceHash !== null && /^[a-f0-9]{64}$/u.test(cluster.primary.sourceHash);
    const canonVerified = cluster.primary.lifecycleLayer === 'canon';
    const timeVerified = plan.worldTime === null || cluster.primary.metadata.temporalMatch === true;
    const viewpointVerified = plan.viewpointEntityId === null || cluster.primary.metadata.viewpointMatch === true;
    const negationChecked = typeof cluster.primary.negated === 'boolean';
    const epistemicChecked = !['ambiguous', 'conflicted'].includes(cluster.primary.epistemicStatus);
    const reasons: string[] = [];
    if (!sourceResolved) reasons.push('source_unresolved');
    if (!hashVerified) reasons.push('hash_unverified');
    if (!canonVerified) reasons.push('not_canon');
    if (!timeVerified) reasons.push('world_time_mismatch');
    if (!viewpointVerified) reasons.push('viewpoint_mismatch');
    if (!epistemicChecked) reasons.push('epistemic_conflict');
    const conflicted = cluster.adoptionReason.includes('conflict');
    const closed = sourceResolved && hashVerified && canonVerified && timeVerified && viewpointVerified && negationChecked && epistemicChecked && !conflicted;
    return {
      clusterId: cluster.clusterId, result: conflicted ? 'conflicted' : closed ? 'closed' : cluster.lane === 'I' ? 'degraded' : 'unknown',
      sourceResolved, hashVerified, canonVerified, timeVerified, viewpointVerified, negationChecked, epistemicChecked, reasons
    };
  }
}
