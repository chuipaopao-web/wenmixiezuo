import { DomainError } from '../domain/errors.js';

export type LayeredCreationWriteMode = 'enabled' | 'read_only';

export type LayeredCreationStopConditionCode =
  | 'CANDIDATE_DIFFERENCE_LOST'
  | 'AUTHOR_WORK_INCREASED'
  | 'SOFT_REFERENCE_HARDENED'
  | 'PLAN_FACT_CONFUSION'
  | 'AUTHOR_TECHNICAL_LEAK'
  | 'CONTEXT_INTEGRITY_FAILED'
  | 'MOBILE_ACTION_INACCESSIBLE'
  | 'OLD_FRONTEND_INCOMPATIBLE'
  | 'QUALITY_REGRESSION'
  | 'SCOPE_OR_IMMUTABLE_DATA_VIOLATION';

export interface LayeredCreationSafetyEvidence {
  candidateDifferenceLost?: boolean;
  authorWorkIncreased?: boolean;
  softReferenceHardened?: boolean;
  planFactConfusion?: boolean;
  authorTechnicalLeak?: boolean;
  contextIntegrityFailed?: boolean;
  mobileActionInaccessible?: boolean;
  oldFrontendIncompatible?: boolean;
  qualityRegression?: boolean;
  scopeOrImmutableDataViolation?: boolean;
}

const STOP_CONDITIONS: ReadonlyArray<readonly [keyof LayeredCreationSafetyEvidence, LayeredCreationStopConditionCode]> = [
  ['candidateDifferenceLost', 'CANDIDATE_DIFFERENCE_LOST'],
  ['authorWorkIncreased', 'AUTHOR_WORK_INCREASED'],
  ['softReferenceHardened', 'SOFT_REFERENCE_HARDENED'],
  ['planFactConfusion', 'PLAN_FACT_CONFUSION'],
  ['authorTechnicalLeak', 'AUTHOR_TECHNICAL_LEAK'],
  ['contextIntegrityFailed', 'CONTEXT_INTEGRITY_FAILED'],
  ['mobileActionInaccessible', 'MOBILE_ACTION_INACCESSIBLE'],
  ['oldFrontendIncompatible', 'OLD_FRONTEND_INCOMPATIBLE'],
  ['qualityRegression', 'QUALITY_REGRESSION'],
  ['scopeOrImmutableDataViolation', 'SCOPE_OR_IMMUTABLE_DATA_VIOLATION']
];

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const LAYERED_CREATION_PREFIXES = [
  'setting-gaps',
  'story-threads',
  'volume-plans',
  'story-events',
  'event-chapter-outlines',
  'style-baseline',
  'setting-baseline',
  'planning-artifacts',
  'setting-outline-workspace',
  'expression-profile'
] as const;

export function identifyLayeredCreationStopConditions(
  evidence: LayeredCreationSafetyEvidence
): LayeredCreationStopConditionCode[] {
  return STOP_CONDITIONS.filter(([key]) => evidence[key] === true).map(([, code]) => code);
}

export function resolveLayeredCreationWriteMode(
  configured: LayeredCreationWriteMode | undefined,
  environmentValue = process.env.WENMI_LAYERED_CREATION_WRITES
): LayeredCreationWriteMode {
  if (configured !== undefined) return configured;
  return environmentValue?.trim().toLowerCase() === 'read_only' ? 'read_only' : 'enabled';
}

export function isLayeredCreationMutation(method: string, url: string): boolean {
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  const path = url.split('?', 1)[0] ?? url;
  const match = /^\/api\/v1\/books\/[^/]+\/([^/]+)/u.exec(path);
  return match !== null && LAYERED_CREATION_PREFIXES.includes(match[1] as typeof LAYERED_CREATION_PREFIXES[number]);
}

export function assertLayeredCreationWritesAllowed(
  mode: LayeredCreationWriteMode,
  method: string,
  url: string
): void {
  if (mode === 'enabled' || !isLayeredCreationMutation(method, url)) return;
  throw new DomainError(
    'LAYERED_CREATION_READ_ONLY',
    '创作设计暂时进入只读保护。已有想法、方案、版本、正文和结算都已保留，请稍后再继续修改。',
    {},
    true,
    409
  );
}