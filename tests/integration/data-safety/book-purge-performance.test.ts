import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;

afterEach(() => {
  context?.close();
  context = undefined;
});

describe('book purge query plan', () => {
  it('uses the child foreign-key index while deleting retrieval candidates', () => {
    context = createTestContext();

    const plan = context.database.prepare(`
      EXPLAIN QUERY PLAN
      DELETE FROM retrieval_candidates
      WHERE owner_id = ? AND book_id = ?
    `).all('owner-one', 'book-one') as unknown as Array<{ detail: string }>;

    expect(plan.some((step) =>
      step.detail.includes(
        'SEARCH retrieval_evidence_clusters USING COVERING INDEX retrieval_evidence_clusters_candidate_idx'
      )
    )).toBe(true);
    expect(plan.some((step) => step.detail === 'SCAN retrieval_evidence_clusters')).toBe(false);
  });
});
