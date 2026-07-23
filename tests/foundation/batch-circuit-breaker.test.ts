import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BREAKER_LIMITS,
  DEFAULT_PACKAGE_UNKNOWN_BATCH_CAP,
  batchStartupGate,
  evaluateBreaker,
  shouldAutoRecover
} from '../../scripts/evaluation/lib/batch-circuit-breaker.mjs';

// P0-1 / R07: 真实批量验证总熔断的确定性离线测试。
// 本文件不调用任何真实模型、不生成小说内容、不连接数据库，只验证纯函数决策。
// 对应 docs/GLM52_RUNTIME_REPAIR_HANDOFF_20260721.md §6.1 与 §8.1。
describe('batch circuit breaker (P0-1 / R07)', () => {
  describe('evaluateBreaker', () => {
    it('allows the next task when usage is one step below every threshold', () => {
      // 阈值仅差一次调用时仍允许发起最后一次（usage = limit - 1）。
      const decision = evaluateBreaker({
        chapterCalls: DEFAULT_BREAKER_LIMITS.perChapterCalls - 1,
        chapterTokens: DEFAULT_BREAKER_LIMITS.perChapterTokens - 1,
        batchCalls: DEFAULT_BREAKER_LIMITS.batchCalls - 1,
        batchTokens: DEFAULT_BREAKER_LIMITS.batchTokens - 1,
        consecutiveStructFixes: DEFAULT_BREAKER_LIMITS.consecutiveStructFixes - 1,
        consecutiveRewrites: DEFAULT_BREAKER_LIMITS.consecutiveRewrites - 1
      });
      expect(decision.stop).toBe(false);
      expect(decision.reason).toBeNull();
    });

    it('stops before the next call when per-chapter call threshold is reached', () => {
      const decision = evaluateBreaker({ chapterCalls: DEFAULT_BREAKER_LIMITS.perChapterCalls });
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe('per_chapter_calls_exceeded');
      expect(decision.evidence).toMatchObject({
        key: 'perChapterCalls',
        value: DEFAULT_BREAKER_LIMITS.perChapterCalls,
        limit: DEFAULT_BREAKER_LIMITS.perChapterCalls
      });
    });

    it('stops on per-chapter token threshold, the 13-chapter explosion trigger', () => {
      const decision = evaluateBreaker({ chapterTokens: DEFAULT_BREAKER_LIMITS.perChapterTokens });
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe('per_chapter_tokens_exceeded');
    });

    it('stops on batch call threshold before launching another chapter', () => {
      const decision = evaluateBreaker({ batchCalls: DEFAULT_BREAKER_LIMITS.batchCalls });
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe('batch_calls_exceeded');
    });

    it('stops on batch token threshold (678万 Token 仍继续跑的反例)', () => {
      const decision = evaluateBreaker({ batchTokens: DEFAULT_BREAKER_LIMITS.batchTokens });
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe('batch_tokens_exceeded');
    });

    it('stops when consecutive structural fixes keep amplifying across tasks', () => {
      const decision = evaluateBreaker({ consecutiveStructFixes: DEFAULT_BREAKER_LIMITS.consecutiveStructFixes });
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe('consecutive_struct_fixes_exceeded');
    });

    it('stops when consecutive rewrites hit the single-task two-round ceiling across tasks', () => {
      const decision = evaluateBreaker({ consecutiveRewrites: DEFAULT_BREAKER_LIMITS.consecutiveRewrites });
      expect(decision.stop).toBe(true);
      expect(decision.reason).toBe('consecutive_rewrites_exceeded');
    });

    it('reports the first breached threshold with auditable evidence', () => {
      const decision = evaluateBreaker({
        chapterCalls: DEFAULT_BREAKER_LIMITS.perChapterCalls,
        batchTokens: DEFAULT_BREAKER_LIMITS.batchTokens
      });
      expect(decision.stop).toBe(true);
      // 检查顺序固定：单章调用先于全批 Token 命中。
      expect(decision.reason).toBe('per_chapter_calls_exceeded');
      expect(decision.evidence).toHaveProperty('usage');
    });

    it('treats missing usage fields as zero instead of silently passing', () => {
      const decision = evaluateBreaker({});
      expect(decision.stop).toBe(false);
      expect((decision.evidence as { usage: { batchCalls: number } }).usage.batchCalls).toBe(0);
    });
  });

  describe('batchStartupGate', () => {
    it('blocks a long batch when package balance is unknown', () => {
      const gate = batchStartupGate({ packageBalanceUnknown: true, plannedChapters: 50 });
      expect(gate.allow).toBe(false);
      expect(gate.reason).toBe('package_unknown_batch_too_large');
      expect(gate.evidence.cap).toBe(DEFAULT_PACKAGE_UNKNOWN_BATCH_CAP);
    });

    it('allows the small confirmed batch (1-3 chapters) when package balance is unknown', () => {
      const gate = batchStartupGate({ packageBalanceUnknown: true, plannedChapters: 3 });
      expect(gate.allow).toBe(true);
      expect(gate.reason).toBeNull();
    });

    it('does not restrict batch size when package balance is known', () => {
      const gate = batchStartupGate({ packageBalanceUnknown: false, plannedChapters: 50 });
      expect(gate.allow).toBe(true);
    });

    it('respects a custom cap for staged verification', () => {
      const gate = batchStartupGate({ packageBalanceUnknown: true, plannedChapters: 2, cap: 1 });
      expect(gate.allow).toBe(false);
      expect(gate.evidence.cap).toBe(1);
    });
  });

  describe('shouldAutoRecover', () => {
    it('never auto-recovers QUALITY_BLOCKED under the default manual_only policy', () => {
      // 默认 manual_only：脚本不得冒充老板，QUALITY_BLOCKED 立即结束批次。
      const decision = shouldAutoRecover({
        blockedRecovery: 'manual_only',
        errorCode: 'QUALITY_BLOCKED',
        rewriteCount: 2,
        recoveryCount: 0,
        maxRecoveries: 3
      });
      expect(decision.recover).toBe(false);
      expect(decision.reason).toBe('manual_only_default');
    });

    it('does not treat non-quality failures as blocked recovery triggers', () => {
      const decision = shouldAutoRecover({
        blockedRecovery: 'auto',
        errorCode: 'TASK_CANCELLED',
        rewriteCount: 2,
        recoveryCount: 0,
        maxRecoveries: 3
      });
      expect(decision.recover).toBe(false);
      expect(decision.reason).toBe('not_quality_blocked');
    });

    it('only allows auto recovery after the single-task two-round rewrite ceiling', () => {
      const beforeCeiling = shouldAutoRecover({
        blockedRecovery: 'auto',
        errorCode: 'QUALITY_BLOCKED',
        rewriteCount: 1,
        recoveryCount: 0,
        maxRecoveries: 3
      });
      expect(beforeCeiling.recover).toBe(false);
      expect(beforeCeiling.reason).toBe('rewrite_rounds_not_exhausted');

      const atCeiling = shouldAutoRecover({
        blockedRecovery: 'auto',
        errorCode: 'QUALITY_BLOCKED',
        rewriteCount: 2,
        recoveryCount: 0,
        maxRecoveries: 3
      });
      expect(atCeiling.recover).toBe(true);
      expect(atCeiling.reason).toBe('auto_recovery_allowed');
    });

    it('refuses auto recovery once the max owner-blocked recoveries is reached', () => {
      const decision = shouldAutoRecover({
        blockedRecovery: 'auto',
        errorCode: 'QUALITY_BLOCKED',
        rewriteCount: 2,
        recoveryCount: 3,
        maxRecoveries: 3
      });
      expect(decision.recover).toBe(false);
      expect(decision.reason).toBe('max_recoveries_reached');
    });
  });
});
