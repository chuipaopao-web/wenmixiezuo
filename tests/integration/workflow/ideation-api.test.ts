import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../../../apps/api/src/http/server.js';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('独立灵感讨论接口', () => {
  let context: TestContext | undefined;
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    context?.close();
  });

  it('显示25名本书成员，只让作者选中的单条建议进入正式作者意见', async () => {
    context = createTestContext('wenmi-ideation-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '灵感讨论书', text: '修仙少年在外门试炼中发现师门旧案'
    });
    const otherBook = initializeDomainBook(context, context.config.ownerId, ids, clock, {
      title: '隔离书', text: '海岛寻宝故事'
    });
    app = await createServer(context.config, context.database, { trustedTest: true });

    const membersResponse = await app.inject({
      method: 'GET', url: `/api/v1/books/${book.bookId}/ideation/members`
    });
    expect(membersResponse.statusCode).toBe(200);
    const members = membersResponse.json().data as Array<{ agentId: string; host: boolean }>;
    expect(members).toHaveLength(25);
    expect(members.filter((member) => member.host)).toHaveLength(1);
    const guest = members.find((member) => !member.host)!;

    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/ideation/rounds`,
      payload: {
        message: '主角第一次出手怎样既爽又不暴露全部底牌？',
        participantAgentIds: [guest.agentId],
        idempotencyKey: 'ideation-round-1'
      }
    });
    expect(started.statusCode).toBe(200);
    const round = started.json().data as { roundId: string; taskId: string; status: string; authorMessage: string };
    expect(round).toMatchObject({ status: 'queued', authorMessage: '主角第一次出手怎样既爽又不暴露全部底牌？' });

    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/ideation/rounds`,
      payload: {
        message: '这次文字不同也不能重复创建',
        participantAgentIds: [guest.agentId],
        idempotencyKey: 'ideation-round-1'
      }
    });
    expect(repeated.json().data.roundId).toBe(round.roundId);

    const blockedConfirmation = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/discussions/${round.roundId}/confirm`,
      payload: { decisionId: 'not-applicable' }
    });
    expect(blockedConfirmation.statusCode).toBe(409);
    expect(blockedConfirmation.body).toContain('不能整轮确认');

    const memberModel = context.database.prepare(`
      SELECT model_snapshot_id FROM agent_instances
      WHERE owner_id = ? AND book_id = ? AND agent_id = ?
    `).get(context.config.ownerId, book.bookId, guest.agentId) as { model_snapshot_id: string };
    const discussionService = new DiscussionService(context.database, new SequenceIds(), clock);
    const opinionId = discussionService.addOpinion(
      { ownerId: context.config.ownerId, bookId: book.bookId },
      round.roundId,
      {
        agentId: guest.agentId,
        modelSnapshotId: memberModel.model_snapshot_id,
        phase: 'independent',
        content: { recommendation: '让主角借阵纹反弹对手绝招，只亮出判断力，保留真正修为。' },
        tokens: 24
      }
    );
    const promoted = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/ideation/rounds/${round.roundId}/promote`,
      payload: {
        opinionId,
        surface: 'event',
        subjectType: 'story_event',
        subjectId: null,
        intentStrength: 'inspiration',
        idempotencyKey: 'promote-ideation-1'
      }
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().data).toMatchObject({
      surface: 'event',
      intentStrength: 'inspiration',
      originalText: '让主角借阵纹反弹对手绝招，只亮出判断力，保留真正修为。'
    });

    const otherRounds = await app.inject({
      method: 'GET', url: `/api/v1/books/${otherBook.bookId}/ideation/rounds`
    });
    expect(otherRounds.json().data).toEqual([]);
  });

  it('拒绝使用另一书的成员启动讨论', async () => {
    context = createTestContext('wenmi-ideation-isolation-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '甲书' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '乙书' });
    app = await createServer(context.config, context.database, { trustedTest: true });
    const foreignMembers = (await app.inject({
      method: 'GET', url: `/api/v1/books/${second.bookId}/ideation/members`
    })).json().data as Array<{ agentId: string; host: boolean }>;
    const foreignGuest = foreignMembers.find((member) => !member.host)!;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/books/${first.bookId}/ideation/rounds`,
      payload: {
        message: '不能让另一书的成员参与',
        participantAgentIds: [foreignGuest.agentId],
        idempotencyKey: 'foreign-member'
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('不属于当前书籍');
  });
});
