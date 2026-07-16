import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('有限多Agent讨论', () => {
  it('只记录真实意见，未回复成员不阻塞汇总和老板确认', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock);
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const agents = context.database.prepare('SELECT agent_id, model_snapshot_id FROM agent_instances WHERE owner_id = ? AND book_id = ? ORDER BY agent_id')
      .all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; model_snapshot_id: string }>;
    const service = new DiscussionService(context.database, ids, clock);
    const discussion = service.create(scope, {
      type: 'quick', scopeText: '主角第一卷目标', createdByAgentId: agents[0]!.agent_id,
      participants: [{ agentId: agents[0]!.agent_id, reason: '主持' }, { agentId: agents[1]!.agent_id, reason: '剧情建议' }]
    });
    service.addOpinion(scope, discussion.discussionId, {
      agentId: agents[0]!.agent_id,
      modelSnapshotId: agents[0]!.model_snapshot_id,
      phase: 'independent',
      content: { recommendation: '先建立短期目标' },
      tokens: 100
    });
    service.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = service.synthesize(scope, discussion.discussionId, {
      recommendation: { choice: '短期目标' }, alternatives: [], disagreements: [], impacts: ['章纲']
    });
    expect(service.confirm(scope, discussion.discussionId, decisionId).status).toBe('confirmed');
    const participants = service.require(scope, discussion.discussionId).participants;
    expect(participants.filter((participant) => participant.responded)).toHaveLength(1);
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM discussion_opinions WHERE discussion_id = ?').get(discussion.discussionId)).toEqual({ count: 1 });
  });

  it('拒绝跨书参与者、伪造模型来源和超预算意见', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, 'owner-one', ids, clock, { title: '甲书' });
    const second = initializeDomainBook(context, 'owner-one', ids, clock, { title: '乙书' });
    const firstScope = { ownerId: 'owner-one', bookId: first.bookId };
    const firstAgents = context.database.prepare('SELECT agent_id, model_snapshot_id FROM agent_instances WHERE book_id = ? ORDER BY agent_id').all(first.bookId) as unknown as Array<{ agent_id: string; model_snapshot_id: string }>;
    const secondAgent = context.database.prepare('SELECT agent_id FROM agent_instances WHERE book_id = ? LIMIT 1').get(second.bookId) as { agent_id: string };
    const service = new DiscussionService(context.database, ids, clock);
    expect(() => service.create(firstScope, {
      type: 'quick', scopeText: '越权讨论', createdByAgentId: firstAgents[0]!.agent_id,
      participants: [{ agentId: firstAgents[0]!.agent_id, reason: '主持' }, { agentId: secondAgent.agent_id, reason: '错误跨书' }]
    })).toThrow('跨书');
    const discussion = service.create(firstScope, {
      type: 'quick', scopeText: '预算讨论', createdByAgentId: firstAgents[0]!.agent_id,
      participants: [{ agentId: firstAgents[0]!.agent_id, reason: '主持' }, { agentId: firstAgents[1]!.agent_id, reason: '参与' }]
    });
    expect(() => service.addOpinion(firstScope, discussion.discussionId, {
      agentId: firstAgents[0]!.agent_id, modelSnapshotId: firstAgents[1]!.model_snapshot_id,
      phase: 'independent', content: {}, tokens: 1
    })).toThrow('模型快照不匹配');
    expect(() => service.addOpinion(firstScope, discussion.discussionId, {
      agentId: firstAgents[0]!.agent_id, modelSnapshotId: firstAgents[0]!.model_snapshot_id,
      phase: 'independent', content: {}, tokens: 50_000
    })).toThrow('预算已耗尽');
  });
});

