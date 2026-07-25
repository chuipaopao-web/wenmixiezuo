import { afterEach, describe, expect, it } from 'vitest';
import { CreativeSessionRepository } from '../../../apps/api/src/infrastructure/db/repositories/creative-session-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('持续创作会话Repository', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('Schema 26存在创作会话、不可变黑板、预演和上下文策略字段', () => {
    context = createTestContext();
    const tables = context.database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'creative_sessions', 'creative_session_events', 'creative_blackboard_revisions',
        'creative_session_rounds', 'narrative_forecasts', 'narrative_forecast_branches',
        'manuscript_quality_snapshots'
      ) ORDER BY name
    `).all() as unknown as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual([
      'creative_blackboard_revisions',
      'creative_session_events',
      'creative_session_rounds',
      'creative_sessions',
      'manuscript_quality_snapshots',
      'narrative_forecast_branches',
      'narrative_forecasts'
    ]);
    const contextColumns = context.database.prepare(`PRAGMA table_info(context_packs)`).all() as unknown as Array<{ name: string }>;
    expect(contextColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['policy_version', 'source_fingerprint']));
  });

  it('同书只允许一个活动会话，黑板按CAS追加且跨书不可见', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '会话书甲', text: '甲书剧情' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '会话书乙', text: '乙书剧情' });
    const firstScope = { ownerId: context.config.ownerId, bookId: first.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: second.bookId };
    const repository = new CreativeSessionRepository(context.database);
    const conversation = context.database.prepare(`
      SELECT conversation_id FROM conversations WHERE owner_id = ? AND book_id = ?
    `).get(firstScope.ownerId, firstScope.bookId) as { conversation_id: string };
    const secondConversation = context.database.prepare(`
      SELECT conversation_id FROM conversations WHERE owner_id = ? AND book_id = ?
    `).get(secondScope.ownerId, secondScope.bookId) as { conversation_id: string };

    expect(() => repository.create(firstScope, {
      sessionId: 'session-cross-book',
      conversationId: secondConversation.conversation_id,
      topic: '不能引用另一书的对话',
      openedByMessageId: null,
      canonRevision: 0,
      now: clock.now().toISOString()
    })).toThrow('创作会话所属对话不存在或越权');

    repository.create(firstScope, {
      sessionId: 'session-a',
      conversationId: conversation.conversation_id,
      topic: '讨论主角如何进入天安城',
      openedByMessageId: null,
      canonRevision: 0,
      now: clock.now().toISOString()
    });
    expect(() => repository.create(firstScope, {
      sessionId: 'session-duplicate',
      conversationId: conversation.conversation_id,
      topic: '重复会话',
      openedByMessageId: null,
      canonRevision: 0,
      now: clock.now().toISOString()
    })).toThrow();

    const firstRevision = repository.appendBlackboard(firstScope, {
      sessionId: 'session-a',
      expectedRevision: 0,
      payload: {
        ownerMessages: ['老板原话'],
        currentGoal: '确定入城方式',
        confirmedFacts: [],
        candidates: [],
        disagreements: [],
        risks: [],
        unknowns: [],
        evidence: [],
        maturity: 'exploring',
        nextStep: '双编剧独立推演'
      },
      sourceFingerprint: 'a'.repeat(64),
      createdBy: 'workflow',
      now: clock.now().toISOString()
    });
    expect(firstRevision.revision).toBe(1);
    expect(() => repository.appendBlackboard(firstScope, {
      sessionId: 'session-a',
      expectedRevision: 0,
      payload: firstRevision.payload,
      sourceFingerprint: 'b'.repeat(64),
      createdBy: 'workflow',
      now: clock.now().toISOString()
    })).toThrow('黑板修订已变化');
    expect(repository.active(secondScope)).toBeNull();
    expect(() => repository.require(secondScope, 'session-a')).toThrow('创作会话不存在或越权');
  });

  it('预演绑定正史与黑板指纹，输入变化后旧分支整体陈旧', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '预演书', text: '测试预演' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const repository = new CreativeSessionRepository(context.database);
    const conversation = context.database.prepare(`
      SELECT conversation_id FROM conversations WHERE owner_id = ? AND book_id = ?
    `).get(scope.ownerId, scope.bookId) as { conversation_id: string };
    repository.create(scope, {
      sessionId: 'session-forecast',
      conversationId: conversation.conversation_id,
      topic: '宣战还是缓攻',
      openedByMessageId: null,
      canonRevision: 0,
      now: clock.now().toISOString()
    });
    repository.appendBlackboard(scope, {
      sessionId: 'session-forecast',
      expectedRevision: 0,
      payload: {
        ownerMessages: [], currentGoal: '比较路线', confirmedFacts: [], candidates: [],
        disagreements: [], risks: [], unknowns: [], evidence: [], maturity: 'exploring', nextStep: '预演'
      },
      sourceFingerprint: 'c'.repeat(64),
      createdBy: 'workflow',
      now: clock.now().toISOString()
    });
    repository.createForecast(scope, {
      forecastId: 'forecast-1',
      sessionId: 'session-forecast',
      discussionId: null,
      canonRevision: 0,
      blackboardRevision: 1,
      sourceFingerprint: 'c'.repeat(64),
      branches: [
        { branchId: 'branch-1', ordinal: 1, title: '直接宣战', proposal: { route: 'war' }, sourceAgentId: null, sourceOpinionId: null },
        { branchId: 'branch-2', ordinal: 2, title: '先谈后打', proposal: { route: 'delay' }, sourceAgentId: null, sourceOpinionId: null }
      ],
      now: clock.now().toISOString()
    });
    expect(repository.listForecasts(scope, 'session-forecast')[0]).toMatchObject({ status: 'active', branchCount: 2 });

    expect(repository.markForecastsStale(scope, {
      sessionId: 'session-forecast',
      canonRevision: 1,
      blackboardRevision: 1,
      sourceFingerprint: 'd'.repeat(64),
      reason: 'canon_revision_changed',
      now: clock.now().toISOString()
    })).toBe(1);
    expect(repository.listForecasts(scope, 'session-forecast')[0]).toMatchObject({
      status: 'stale', staleReason: 'canon_revision_changed'
    });
  });
});
