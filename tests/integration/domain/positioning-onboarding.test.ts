import { afterEach, describe, expect, it } from 'vitest';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('定位草稿与原子建书', () => {
  it('区分老板明确、系统推断、未指定和冲突字段', () => {
    context = createTestContext();
    const service = new PositioningService(context.database, new SequenceIds(), new FixedClock());
    const draft = service.createDraft(
      { ownerId: 'owner-one' },
      { title: '北宋副本', text: '主角进入游戏副本，从朱仙镇开始', category: '历史', tags: ['成长'], style: '克制' }
    );
    expect(draft.fields.find((field) => field.key === 'premise')?.sourceStatus).toBe('explicit');
    expect(draft.fields.find((field) => field.key === 'genre')?.sourceStatus).toBe('conflict');
    expect(draft.fields.find((field) => field.key === 'audience')?.sourceStatus).toBe('unspecified');
    expect(draft.tags.some((tag) => tag.name === '游戏' && tag.sourceStatus === 'conflict')).toBe(true);
  });

  it('确认指定草稿版本后原子创建书、9岗位、预算、故事圣经和主编租约', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const positioning = new PositioningService(context.database, ids, clock);
    const draft = positioning.createDraft({ ownerId: 'owner-one' }, { title: '甲书', text: '历史中的悬疑谜案', category: '历史', tags: ['谜案'] });
    const updated = positioning.updateDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version, { title: '甲书修订名' });
    expect(() => new BookOnboardingService(context!.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version))
      .toThrow('版本已经变化');
    const result = new BookOnboardingService(context.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, draft.draftId, updated.version);
    expect(result.agentCount).toBe(9);
    expect(new BookRepository(context.database).require({ ownerId: 'owner-one', bookId: result.bookId })).toMatchObject({ title: '甲书修订名', status: 'active', positioningVersion: 1, editorEpoch: 1 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM agent_instances WHERE owner_id = ? AND book_id = ?').get('owner-one', result.bookId)).toEqual({ count: 9 });
    expect(context.database.prepare('SELECT cash_limit_micros FROM budgets WHERE budget_id = ?').get(result.budgetId)).toEqual({ cash_limit_micros: 0 });
    expect(context.database.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get(result.storyBibleArtifactId)).toEqual({ status: 'draft' });
    expect(context.database.prepare('SELECT editor_epoch FROM editor_leases WHERE owner_id = ? AND book_id = ?').get('owner-one', result.bookId)).toEqual({ editor_epoch: 1 });
  });

  it('任一步失败时不留下半本书或Agent', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const positioning = new PositioningService(context.database, ids, clock);
    const draft = positioning.createDraft({ ownerId: 'owner-one' }, { title: '失败书', text: '一个都市故事' });
    expect(() => new BookOnboardingService(context!.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version, 'after_team'))
      .toThrow('simulated-onboarding-failure');
    expect(new BookRepository(context.database).find({ ownerId: 'owner-one', bookId: draft.proposedBookId })).toBeNull();
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM agent_instances WHERE book_id = ?').get(draft.proposedBookId)).toEqual({ count: 0 });
    expect(positioning.require({ ownerId: 'owner-one' }, draft.draftId).status).toBe('editing');
  });
});

