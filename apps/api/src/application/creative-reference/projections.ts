/** R209-B1 三档投影：引用/短目录/详情。短语与影响含义的条件必须保留。 */
import { enforceBudget } from './validation.js';
import type { Projection, RevisionRecord } from './types.js';

export type ProjectionTier = 'citation' | 'digest' | 'detail';

export const PROJECTION_BUDGETS: Record<ProjectionTier, number> = {
  citation: 80,
  digest: 160,
  detail: 900
} as const;

export function toCitation(revision: RevisionRecord): Projection {
  const text = `${revision.displayCode} ${revision.shortPhrase}（版本${revision.revision}）`;
  enforceBudget(text, PROJECTION_BUDGETS.citation, '引用投影');
  return { tier: 'citation', displayCode: revision.displayCode, revision: revision.revision, shortPhrase: revision.shortPhrase };
}

export function toDigest(revision: RevisionRecord): Projection {
  const base = {
    tier: 'digest' as const,
    displayCode: revision.displayCode,
    revision: revision.revision,
    shortPhrase: revision.shortPhrase,
    summary: revision.summary
  };
  const layers = revision.payload.assetKind === 'method' ? revision.payload.method.applicableLayers : revision.payload.reference.stages;
  const usageTree = revision.payload.assetKind === 'method' ? revision.payload.method.usageTree : undefined;
  const text = `${base.displayCode}${base.shortPhrase}${base.summary}${usageTree ?? ''}${(layers ?? []).join('')}`;
  enforceBudget(text, PROJECTION_BUDGETS.digest, '短目录投影');
  return usageTree === undefined ? { ...base, applicableLayers: layers } : { ...base, usageTree, applicableLayers: layers };
}

export function toDetail(revision: RevisionRecord): Projection {
  const text = JSON.stringify(revision.payload);
  enforceBudget(text, PROJECTION_BUDGETS.detail, '详情投影');
  return { tier: 'detail', displayCode: revision.displayCode, revision: revision.revision, shortPhrase: revision.shortPhrase, summary: revision.summary, payload: revision.payload };
}

export function project(revision: RevisionRecord, tier: ProjectionTier): Projection {
  if (tier === 'citation') return toCitation(revision);
  if (tier === 'digest') return toDigest(revision);
  return toDetail(revision);
}
