import { describe, expect, it } from 'vitest';
import {
  assertLayeredCreationWritesAllowed,
  identifyLayeredCreationStopConditions,
  isLayeredCreationMutation,
  resolveLayeredCreationWriteMode
} from '../../apps/api/src/http/layered-creation-safety.js';

describe('layered creation stop conditions and write rollback', () => {
  it('identifies every approved stop condition without inventing a stop for clean evidence', () => {
    expect(identifyLayeredCreationStopConditions({})).toEqual([]);
    expect(identifyLayeredCreationStopConditions({
      candidateDifferenceLost: true,
      authorWorkIncreased: true,
      softReferenceHardened: true,
      planFactConfusion: true,
      authorTechnicalLeak: true,
      contextIntegrityFailed: true,
      mobileActionInaccessible: true,
      oldFrontendIncompatible: true,
      qualityRegression: true,
      scopeOrImmutableDataViolation: true
    })).toEqual([
      'CANDIDATE_DIFFERENCE_LOST',
      'AUTHOR_WORK_INCREASED',
      'SOFT_REFERENCE_HARDENED',
      'PLAN_FACT_CONFUSION',
      'AUTHOR_TECHNICAL_LEAK',
      'CONTEXT_INTEGRITY_FAILED',
      'MOBILE_ACTION_INACCESSIBLE',
      'OLD_FRONTEND_INCOMPATIBLE',
      'QUALITY_REGRESSION',
      'SCOPE_OR_IMMUTABLE_DATA_VIOLATION'
    ]);
  });

  it('freezes only layered design mutations while reads and author input capture remain available', () => {
    expect(isLayeredCreationMutation('GET', '/api/v1/books/book-1/volume-plans')).toBe(false);
    expect(isLayeredCreationMutation('POST', '/api/v1/books/book-1/author-planning-inputs')).toBe(false);
    expect(isLayeredCreationMutation('POST', '/api/v1/books/book-1/volume-plans')).toBe(true);
    expect(isLayeredCreationMutation('PATCH', '/api/v1/books/book-1/setting-outline-workspace/story-kernel')).toBe(true);
    expect(isLayeredCreationMutation('POST', '/api/v1/books/book-1/story-events/event-1/chapter-outlines/freeze')).toBe(true);
    expect(() => assertLayeredCreationWritesAllowed(
      'read_only', 'POST', '/api/v1/books/book-1/volume-plans'
    )).toThrow('已有想法、方案、版本、正文和结算都已保留');
    expect(() => assertLayeredCreationWritesAllowed(
      'read_only', 'POST', '/api/v1/books/book-1/author-planning-inputs'
    )).not.toThrow();
  });

  it('uses an explicit option first and otherwise accepts the deployment environment switch', () => {
    expect(resolveLayeredCreationWriteMode('enabled', 'read_only')).toBe('enabled');
    expect(resolveLayeredCreationWriteMode(undefined, 'read_only')).toBe('read_only');
    expect(resolveLayeredCreationWriteMode(undefined, 'unexpected-value')).toBe('enabled');
  });
});