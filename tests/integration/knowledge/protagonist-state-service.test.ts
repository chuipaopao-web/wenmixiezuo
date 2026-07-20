import { describe, expect, it } from 'vitest';
import { ProtagonistStateService } from '../../../apps/api/src/application/knowledge/protagonist-state-service.js';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds } from '../../helpers/test-context.js';

describe('主角状态账本', () => {
  it('保留追加历史、区分待确认与正史并以归档代替物理删除', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '领主书', text: '主角拥有城池和士兵' });
      const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
      const service = new ProtagonistStateService(context.database, ids, clock);
      const profile = service.saveProfile(scope, { displayName: '林澈', isPrimary: true });
      const pending = service.append(scope, {
        profileId: profile.profileId, category: '兵力', logicalKey: '弓兵', label: '弓兵', valueType: 'resource', value: 120, unit: '人'
      });
      const confirmed = service.append(scope, {
        profileId: profile.profileId, category: '兵力', logicalKey: '弓兵', label: '弓兵', valueType: 'resource', value: 100, unit: '人', confirmed: true,
        effectiveChapterNumber: 3, note: '战损后二十人'
      });
      expect(confirmed.previousEntryId).toBe(pending.entryId);
      expect(service.dashboard(scope).profiles[0]).toMatchObject({ current: [expect.objectContaining({ value: 100, revision: 2 })], pending: [], historyCount: 2 });
      service.archiveEntry(scope, confirmed.entryId);
      expect(service.dashboard(scope).profiles[0]).toMatchObject({ current: [], pending: [], historyCount: 3 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM protagonist_state_entries WHERE owner_id = ? AND book_id = ?')
        .get(scope.ownerId, scope.bookId)).toEqual({ count: 3 });
    } finally {
      context.close();
    }
  });

  it('同一接口不能读取或修改另一本书的主角资料', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '甲书', text: '甲书主角' });
      const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '乙书', text: '乙书主角' });
      const service = new ProtagonistStateService(context.database, ids, clock);
      const profile = service.saveProfile({ ownerId: context.config.ownerId, bookId: first.bookId }, { displayName: '甲主角', isPrimary: true });
      expect(() => service.append({ ownerId: context.config.ownerId, bookId: second.bookId }, {
        profileId: profile.profileId, category: '资源', logicalKey: '金币', label: '金币', valueType: 'resource', value: 1
      })).toThrow('主角档案不存在或越权');
      expect(service.dashboard({ ownerId: context.config.ownerId, bookId: second.bookId }).profiles).toEqual([]);
    } finally {
      context.close();
    }
  });

  it('按同书角色姓名自动关联正史事实，可靠更新数值且忽略无效派生关系', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { title: '自动兵力账本', content: '林澈清点军队，确认现有步兵一百二十人。' });
      const service = new ProtagonistStateService(context.database, ids, clock);
      const profile = service.saveProfile(fixture.scope, { displayName: '林澈', isPrimary: true });
      expect(profile.entityId).toBeNull();
      const canon = new CanonService(context.database, ids, clock);
      const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
      canon.proposeFact(fixture.scope, {
        subjectEntityId: entityId, relationKey: 'protagonist_state.army.infantry',
        value: { value: 120, label: '步兵', unit: '人' }, evidence: [{ quote: '确认现有步兵一百二十人' }], grade: 'B',
        sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
      });
      canon.proposeFact(fixture.scope, {
        subjectEntityId: entityId, relationKey: 'protagonist_delta.army.invalid',
        value: { delta: '无法确认' }, evidence: [{ quote: '只是模糊提到战损' }], grade: 'B',
        sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
      });
      canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, {});

      expect(service.projectCanonFacts(fixture.scope, fixture.chapterId)).toBe(1);
      expect(service.dashboard(fixture.scope).profiles[0]).toMatchObject({
        entityId, current: [expect.objectContaining({ category: 'army', logicalKey: 'infantry', value: 120, unit: '人', authorityLayer: 'canon' })]
      });
    } finally {
      context.close();
    }
  });
});
