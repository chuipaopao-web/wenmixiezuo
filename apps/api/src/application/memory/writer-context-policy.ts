export const WRITER_CONTEXT_POLICY = Object.freeze({
  draft: Object.freeze({
    characterBudget: 9_000,
    tokenBudget: 9_000,
    policyVersion: 'writer-draft-context-v6-full-current-outline-9000chars',
    workOrderMaximum: 4_200,
    openingProfileMaximum: 650,
    stageSettlementMaximum: 600,
    previousStateMaximum: 400,
    previousTailMaximum: 500,
    commitmentsMaximum: 400,
    hardRetrievalMaximum: 100,
    optionalRetrievalMaximum: 400
  }),
  ownerRewrite: Object.freeze({
    characterBudget: 12_000,
    tokenBudget: 12_000,
    policyVersion: 'writer-rewrite-context-v3-12000chars'
  }),
  targetedRewrite: Object.freeze({
    characterBudget: 12_000,
    tokenBudget: 12_000,
    policyVersion: 'writer-targeted-rewrite-context-v3-12000chars'
  })
});

export type WriterContextPolicy = typeof WRITER_CONTEXT_POLICY;
