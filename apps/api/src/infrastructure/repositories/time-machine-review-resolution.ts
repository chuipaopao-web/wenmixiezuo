import type { DatabaseSync } from 'node:sqlite';
import { digest, type Scope } from '@wenmi/time-machine-core';
import { DomainError, errorCodes } from '../../domain/errors.js';

export interface SelfCheckDecision {
  issue: string;
  disposition: 'suggestion' | 'resolved';
  reason: string;
  evidence: string[];
}
function context(db: DatabaseSync, scope: Scope, id: string, revision: number) {
  const candidate = db.prepare('SELECT hash FROM tm2_candidates WHERE owner=? AND book=? AND id=? AND revision=?')
    .get(scope.ownerId, scope.bookId, id, revision) as {hash: string} | undefined;
  const run = db.prepare('SELECT result_json FROM tm2_design_runs WHERE owner_id=? AND book_id=? AND id=?')
    .get(scope.ownerId, scope.bookId, id) as {result_json: string | null} | undefined;
  if (!candidate || !run) throw new DomainError(errorCodes.validation, '候选不存在', {}, false, 409);
  const result = run.result_json ? JSON.parse(run.result_json) as {revision?: number; selfCheck?: {pass: boolean; issues: string[]}} : null;
  return {candidate, result};
}
/** Trusted internal adjudication only. No author-supplied resolution endpoint. Raw checks stay immutable. */
export function recordSelfCheckResolution(db: DatabaseSync, scope: Scope, id: string, revision: number, decisions: SelfCheckDecision[]): void {
  const {candidate, result} = context(db, scope, id, revision);
  if (result?.revision !== revision || !Array.isArray(result.selfCheck?.issues)) throw new Error('核定版本与自检不一致');
  const issues = [...new Set(result.selfCheck.issues)];
  if (decisions.length !== issues.length || new Set(decisions.map(d => d.issue)).size !== issues.length ||
      decisions.some(d => !issues.includes(d.issue) || !['suggestion', 'resolved'].includes(d.disposition) || !d.reason.trim() || !d.evidence.length || d.evidence.some(e => !e.trim()))) throw new Error('核定必须逐条覆盖并提供理由与证据');
  const body = {candidateId: id, revision, candidateHash: candidate.hash, issuesHash: digest(result.selfCheck.issues), decisions};
  db.prepare("INSERT INTO tm2_outbox(owner,book,id,kind,body) VALUES(?,?,?,'review.self-check-resolution',?) ON CONFLICT(id) DO NOTHING")
    .run(scope.ownerId, scope.bookId, `${id}:self-check-resolution:${revision}:${digest(body)}`, JSON.stringify(body));
}
export function assertSelfCheckResolved(db: DatabaseSync, scope: Scope, id: string, revision: number): void {
  const {candidate, result} = context(db, scope, id, revision);
  // Legacy/manual candidates without a self-check remain governed by the independent-review gate.
  if (!result?.selfCheck) return;
  if (result.revision !== revision) throw new DomainError(errorCodes.validation, '方案版本已变化，需要核对当前版本', {}, false, 409);
  if (result.selfCheck.pass && result.selfCheck.issues.length === 0) return;
  const issues = [...new Set(result.selfCheck.issues)];
  const rows = db.prepare("SELECT body FROM tm2_outbox WHERE owner=? AND book=? AND kind='review.self-check-resolution'").all(scope.ownerId, scope.bookId) as {body: string}[];
  for (const row of rows) {
    const r = JSON.parse(row.body) as {candidateId: string; revision: number; candidateHash: string; issuesHash: string; decisions: SelfCheckDecision[]};
    if (r.candidateId !== id || r.revision !== revision || r.candidateHash !== candidate.hash || r.issuesHash !== digest(result.selfCheck.issues)) continue;
    if (issues.length && r.decisions.length === issues.length && issues.every(i => r.decisions.some(d => d.issue === i && ['suggestion', 'resolved'].includes(d.disposition) && d.reason.trim() && d.evidence.length))) return;
  }
  throw new DomainError(errorCodes.validation, '方案仍有尚未核定的自检问题，请先完成核查', {}, false, 409);
}
