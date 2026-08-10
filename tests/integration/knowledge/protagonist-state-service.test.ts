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
      expect(service.dashboard(scope).profiles[0]).toMatchObject({ current: [expect.objectContaining({ value: 100, revision: 2 })], pending: [], history: expect.arrayContaining([expect.objectContaining({ value: 120 }), expect.objectContaining({ value: 100 })]), historyCount: 2 });
      const lost = service.append(scope, {
        profileId: profile.profileId, category: '兵力', logicalKey: '弓兵', label: '弓兵', valueType: 'resource', value: 0, unit: '人', confirmed: true,
        stateStatus: 'lost', effectiveChapterNumber: 5, note: '队伍已经失散'
      });
      expect(service.dashboard(scope).profiles[0]).toMatchObject({ current: [], pending: [], history: expect.arrayContaining([expect.objectContaining({ entryId: lost.entryId, stateStatus: 'lost', effectiveChapterNumber: 5 })]), historyCount: 3 });
      service.archiveEntry(scope, lost.entryId);
      expect(service.dashboard(scope).profiles[0]).toMatchObject({ current: [], pending: [], historyCount: 4 });
      expect(context.database.prepare('SELECT COUNT(*) AS count FROM protagonist_state_entries WHERE owner_id = ? AND book_id = ?')
        .get(scope.ownerId, scope.bookId)).toEqual({ count: 4 });
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

  it('无需预建固定模板即可从正史自动建档，无法归类时询问并以追加修订完成分类', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { title: '契约书', content: '沈岚与白鹿结成灵魂契约。' });
      const service = new ProtagonistStateService(context.database, ids, clock);
      const canon = new CanonService(context.database, ids, clock);
      const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '沈岚' });
      const fact = canon.proposeFact(fixture.scope, {
        subjectEntityId: entityId, relationKey: 'protagonist_state.unclassified.soul_companion',
        value: { value: '白鹿', label: '灵魂契约伙伴' }, evidence: [{ quote: '沈岚与白鹿结成灵魂契约' }], grade: 'B',
        sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
      });
      canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, {});

      expect(service.projectCanonFacts(fixture.scope, fixture.chapterId)).toBe(1);
      const automatic = service.dashboard(fixture.scope).profiles[0]!;
      expect(automatic).toMatchObject({ displayName: '沈岚', entityId, isPrimary: true });
      expect(automatic.current[0]).toMatchObject({
        category: 'unclassified', logicalKey: 'soul_companion', value: '白鹿', sourceFactId: fact.factId, authorityLayer: 'canon'
      });
      expect(context.database.prepare(`SELECT target_type, target_id, gap_type, severity, status
        FROM knowledge_gap_findings WHERE owner_id = ? AND book_id = ?`).get(fixture.scope.ownerId, fixture.scope.bookId)).toMatchObject({
        target_type: 'protagonist_state_classification', target_id: `${automatic.profileId}:soul_companion`,
        gap_type: 'classification', severity: 'important', status: 'open'
      });

      const classified = service.classify(fixture.scope, automatic.current[0]!.entryId, '契约伙伴');
      expect(classified).toMatchObject({
        category: '契约伙伴', logicalKey: 'soul_companion', value: '白鹿', sourceFactId: fact.factId,
        sourceManuscriptVersionId: fixture.manuscriptVersionId, revision: 2, previousEntryId: automatic.current[0]!.entryId
      });
      expect(service.dashboard(fixture.scope).profiles[0]).toMatchObject({
        current: [expect.objectContaining({ category: '契约伙伴', value: '白鹿' })], historyCount: 2
      });
      expect(context.database.prepare(`SELECT status, resolved_at FROM knowledge_gap_findings
        WHERE owner_id = ? AND book_id = ?`).get(fixture.scope.ownerId, fixture.scope.bookId)).toMatchObject({ status: 'resolved' });
      expect(service.projectCanonFacts(fixture.scope, fixture.chapterId)).toBe(0);
    } finally {
      context.close();
    }
  });

  it('作者归档的主角档案不会被后续自动投影静默恢复', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const fixture = createKnowledgeFixture(context, ids, clock, { title: '归档边界', content: '林澈清点仍在城中的卫兵。' });
      const service = new ProtagonistStateService(context.database, ids, clock);
      const canon = new CanonService(context.database, ids, clock);
      const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
      const profile = service.saveProfile(fixture.scope, { displayName: '林澈', entityId, isPrimary: true });
      service.archiveProfile(fixture.scope, profile.profileId);
      canon.proposeFact(fixture.scope, {
        subjectEntityId: entityId, relationKey: 'protagonist_state.兵力.卫兵',
        value: { value: 30, label: '卫兵', unit: '人' }, evidence: [{ quote: '林澈清点仍在城中的卫兵' }], grade: 'B',
        sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId
      });
      canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, {});

      expect(service.projectCanonFacts(fixture.scope, fixture.chapterId)).toBe(0);
      expect(service.dashboard(fixture.scope).profiles).toEqual([]);
      expect(service.listProfiles(fixture.scope, true)).toEqual([expect.objectContaining({ profileId: profile.profileId, status: 'archived' })]);
    } finally {
      context.close();
    }
  });
});
