import { hashStableContractContent } from '@wenmi/contracts';

// Active V7 node templates. Stored template identifiers are immutable task
// history and therefore are not rewritten during the V7-only source cleanup.

export interface CreativeTemplateSnapshot {
  templateVersionId: string;
  templateKey: string;
  targetObject: string;
  version: number;
  schema: Record<string, unknown>;
  promptContract: Record<string, unknown>;
  contentHash: string;
}

const NODE_SCHEMAS: Record<string, Record<string, unknown>> = {
  opening_blueprint: { properties: { storylines: { type: 'array' }, ending: { type: 'string' }, openingIdea: { type: 'string' } } },
  setting_candidate: { required: ['answer', 'evidenceRefs'], properties: { answer: { type: 'string', minLength: 1 }, evidenceRefs: { type: 'array' } } },
  storyline_design: { required: ['title', 'coreQuestion'], properties: { title: { type: 'string', minLength: 1 }, coreQuestion: { type: 'string', minLength: 1 } } },
  volume_route: { required: ['opening', 'climax'], properties: { opening: { type: 'string', minLength: 1 }, climax: { type: 'string', minLength: 1 } } },
  event_role_match: { properties: { characterId: { type: 'string' }, eventResponsibility: { type: 'string' }, motivation: { type: 'string' } } },
  volume_expression: { properties: { purpose: { type: 'string' }, expressionPlan: { type: 'array' } } },
  volume_expression_coordination: { properties: { agreements: { type: 'array' }, disagreements: { type: 'array' }, mergedPlan: { type: 'array' } } },
  volume_expression_sample: { properties: { sample: { type: 'string' }, scope: { type: 'string' } } },
  event_chain: { required: ['events'], properties: { events: { type: 'array', minItems: 1 } } },
  event_design: { required: ['conflict', 'protagonistChoice', 'expectedChange'], properties: { conflict: { type: 'string' }, protagonistChoice: { type: 'string' }, expectedChange: { type: 'string' } } },
  chapter_sequence: { required: ['chapters'], properties: { chapters: { type: 'array', minItems: 1 } } },
  storyline_next_direction: {
    required: ['title', 'summary', 'continuationReason', 'protagonistInvolvement', 'coreQuestion', 'inferences', 'unknowns', 'misreadRisk', 'recommendedHorizonVolumes'],
    properties: { recommendedHorizonVolumes: { type: 'integer', minimum: 1, maximum: 2 },
      inferences: { type: 'array' }, unknowns: { type: 'array' } }
  },
  storyline_emerging_line: {
    required: ['title', 'summary', 'continuationReason', 'coreQuestion', 'evidenceRefs', 'unknowns', 'misreadRisk'],
    properties: { evidenceRefs: { type: 'array', minItems: 1 } }
  },
  volume_causal_direction: {
    required: ['previousActual', 'newState', 'unresolvedPressure', 'protagonistChoice', 'volumeGoal', 'affectedStorylines']
  },
  settlement_storyline_projection: {
    required: ['actualProgress', 'evidenceRefs', 'openQuestions'], properties: { evidenceRefs: { type: 'array', minItems: 1 } }
  },
  chapter_outline: { required: ['title', 'chapterFunction', 'openingState', 'conflict', 'requiredEndingState'] },
  manuscript: { required: ['content'], properties: { content: { type: 'string', minLength: 1 } } },
  chapter_draft: { required: ['content'], properties: { content: { type: 'string', minLength: 1 } } },
  chapter_settlement: { required: ['actualProgress', 'evidenceRefs'], properties: { evidenceRefs: { type: 'array', minItems: 1 }, plannedButNotOccurred: { type: 'array' } } },
  event_settlement: { required: ['actualProgress', 'evidenceRefs'], properties: { evidenceRefs: { type: 'array', minItems: 1 }, plannedButNotOccurred: { type: 'array' } } },
  volume_settlement: { required: ['actualProgress', 'evidenceRefs', 'openQuestions'], properties: { evidenceRefs: { type: 'array', minItems: 1 }, openQuestions: { type: 'array' }, plannedButNotOccurred: { type: 'array' } } },
  fact_review: { required: ['findings', 'evidenceRefs'] },
  literary_review: { required: ['strengths', 'findings', 'textLocations'] },
  experience_review: { required: ['readingExperience', 'dropRisks', 'expectationGaps'] },
  chapter_review_fact: { required: ['findings', 'evidenceRefs'] },
  chapter_review_literary: { required: ['strengths', 'findings', 'textLocations'] },
  chapter_review_experience: { required: ['readingExperience', 'dropRisks', 'expectationGaps'] }
};

export function creativeTemplate(nodeKind: string, templateVersion: string): CreativeTemplateSnapshot {
  const normalizedNode = nodeKind.trim();
  const normalizedVersion = templateVersion.trim();
  if (!normalizedNode || !normalizedVersion) throw new Error('创作模板节点与版本不能为空');
  const parsedVersion = Number(normalizedVersion.match(/(?:^|-)v(\d+)$/iu)?.[1] ?? 1);
  const schema = { type: 'object', additionalProperties: true, ...(NODE_SCHEMAS[normalizedNode] ?? {}) };
  const promptContract = {
    nodeKind: normalizedNode,
    rules: [
      '只输出当前节点 schema 所需字段。',
      '正文/结算事实、作者规划、开放问题与 AI 候选必须分区。',
      '故事线和最终结局允许为空；不得默认要求完整全书或最终大结局。',
      '解析失败时返回安全错误，不得把原始文本直接写入权威对象。'
    ]
  };
  const contentHash = hashStableContractContent({ schema, promptContract }).slice('sha256:'.length);
  return { templateVersionId: `template:${normalizedNode}:${normalizedVersion}`, templateKey: normalizedVersion.replace(/-v\d+$/iu, ''),
    targetObject: normalizedNode, version: Number.isInteger(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1,
    schema, promptContract, contentHash };
}
