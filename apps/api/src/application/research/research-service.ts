import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export class ResearchService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public addProvidedSource(scope: BookScope, input: {
    title: string;
    content: string;
    url?: string | null;
    publisher?: string | null;
    publishedAt?: string | null;
    region?: string | null;
    language: string;
    credibility: number;
  }): string {
    assertBookScope(scope);
    const sourceId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO research_sources (
        research_source_id, owner_id, book_id, title, url, publisher,
        published_at, retrieved_at, region, language, content_text, content_hash,
        credibility, source_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provided', ?)
    `).run(
      sourceId, scope.ownerId, scope.bookId, input.title, input.url ?? null,
      input.publisher ?? null, input.publishedAt ?? null, now, input.region ?? null,
      input.language, input.content, createHash('sha256').update(input.content).digest('hex'), input.credibility, now
    );
    return sourceId;
  }

  public addCandidateClaim(scope: BookScope, sourceId: string, claim: string, evidence: string): string {
    const source = this.database.prepare(`SELECT 1 FROM research_sources WHERE research_source_id = ? AND owner_id = ? AND book_id = ?`)
      .get(sourceId, scope.ownerId, scope.bookId);
    if (source === undefined) throw new Error('研究来源不存在或越权');
    const claimId = this.ids.next();
    this.database.prepare(`
      INSERT INTO research_claims (
        research_claim_id, owner_id, book_id, research_source_id,
        claim_text, evidence_text, candidate_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?)
    `).run(claimId, scope.ownerId, scope.bookId, sourceId, claim, evidence, this.clock.now().toISOString());
    return claimId;
  }

  public offlineStatus(query: string): { status: 'offline_unavailable'; query: string; message: string; claimsApplied: false } {
    return { status: 'offline_unavailable', query, message: '当前未执行联网研究，不能声称这是近期市场或热点结论。', claimsApplied: false };
  }

  public listSources(scope: BookScope): unknown[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT research_source_id, title, url, publisher, published_at, retrieved_at,
             region, language, content_hash, credibility, source_status, created_at
      FROM research_sources WHERE owner_id = ? AND book_id = ?
      ORDER BY retrieved_at DESC, research_source_id
    `).all(scope.ownerId, scope.bookId);
  }

  public listClaims(scope: BookScope): unknown[] {
    assertBookScope(scope);
    return this.database.prepare(`
      SELECT c.research_claim_id, c.research_source_id, s.title AS source_title,
             c.claim_text, c.evidence_text, c.candidate_status, c.created_at
      FROM research_claims c JOIN research_sources s ON s.research_source_id = c.research_source_id
      WHERE c.owner_id = ? AND c.book_id = ?
      ORDER BY c.created_at DESC, c.research_claim_id
    `).all(scope.ownerId, scope.bookId);
  }
}
