export const WRITER_CONTEXT_POLICY = Object.freeze({
  draft: Object.freeze({
    characterBudget: 4_200,
    tokenBudget: 4_200,
    policyVersion: 'writer-draft-context-v3-chapter-outline-v2-4200chars',
    workOrderMaximum: 1_500,
    stageSettlementMaximum: 600,
    previousStateMaximum: 400,
    previousTailMaximum: 500,
    commitmentsMaximum: 400,
    hardRetrievalMaximum: 100,
    optionalRetrievalMaximum: 400
  }),
  ownerRewrite: Object.freeze({
    characterBudget: 9_000,
    tokenBudget: 9_000,
    policyVersion: 'writer-rewrite-context-v2-9000chars'
  }),
  targetedRewrite: Object.freeze({
    characterBudget: 9_000,
    tokenBudget: 9_000,
    policyVersion: 'writer-targeted-rewrite-context-v2-9000chars'
  })
});

export type WriterContextPolicy = typeof WRITER_CONTEXT_POLICY;
