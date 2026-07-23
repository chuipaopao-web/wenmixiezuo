// Type declarations for batch-circuit-breaker.mjs, consumed by tsc via Bundler
// resolution so tests import the pure JS module without losing type safety.

export const DEFAULT_BREAKER_LIMITS: Readonly<BreakerLimits>;
export const DEFAULT_PACKAGE_UNKNOWN_BATCH_CAP: number;

export interface BreakerLimits {
  perChapterCalls: number;
  perChapterTokens: number;
  batchCalls: number;
  batchTokens: number;
  consecutiveStructFixes: number;
  consecutiveRewrites: number;
}

export interface BreakerUsage {
  chapterCalls: number;
  chapterTokens: number;
  batchCalls: number;
  batchTokens: number;
  consecutiveStructFixes: number;
  consecutiveRewrites: number;
}

export interface BreakerDecision {
  stop: boolean;
  reason: string | null;
  evidence: Record<string, unknown>;
}

export interface AutoRecoverContext {
  blockedRecovery: 'manual_only' | 'auto';
  errorCode: string | null;
  rewriteCount: number;
  recoveryCount: number;
  maxRecoveries: number;
}

export function evaluateBreaker(usage: Partial<BreakerUsage>, limits?: BreakerLimits): BreakerDecision;
export function batchStartupGate(ctx: {
  packageBalanceUnknown: boolean;
  plannedChapters: number;
  cap?: number;
}): { allow: boolean; reason: string | null; evidence: { plannedChapters: number; cap: number } };
export function shouldAutoRecover(ctx: AutoRecoverContext): { recover: boolean; reason: string };
