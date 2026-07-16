import { afterEach, describe, expect, it } from 'vitest';
import { CanonService } from '../../../apps/api/src/application/knowledge/canon-service.js';
import { DomainError, errorCodes } from '../../../apps/api/src/domain/errors.js';
import { createKnowledgeFixture } from '../../helpers/knowledge-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('A/B/C/D事实门禁', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('按证据、复核和老板确认执行四级门禁', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const canon = new CanonService(context.database, ids, clock);
    const entityId = canon.createEntity(fixture.scope, { entityType: 'character', canonicalName: '林澈' });
    const common = { subjectEntityId: entityId, sourceChapterId: fixture.chapterId, sourceManuscriptVersionId: fixture.manuscriptVersionId };

    expect(canon.proposeFact(fixture.scope, { ...common, relationKey: 'mood_guess', value: '不安', evidence: [], grade: 'A' }).status).toBe('candidate');
    expect(() => canon.proposeFact(fixture.scope, { ...common, relationKey: 'location', value: '北塔', evidence: [], grade: 'B' }))
      .toThrow('必须包含可追溯证据');
    expect(canon.proposeFact(fixture.scope, { ...common, relationKey: 'location', value: '北塔', evidence: [{ quote: '走进北塔' }], grade: 'B' }).status).toBe('approved');
    const c = canon.proposeFact(fixture.scope, { ...common, relationKey: 'knowledge', value: '密门位置', evidence: [{ quote: '他看见了密门' }], grade: 'C' });
    expect(c.status).toBe('awaiting_editor');
    canon.reviewFact(fixture.scope, c.factId, true, { reviewer: 'chief_editor' });
    const d = canon.proposeFact(fixture.scope, { ...common, relationKey: 'alive', value: false, evidence: [{ quote: '心跳停止' }], grade: 'D' });
    expect(d.status).toBe('awaiting_boss');
    expect(d.confirmationId).not.toBeNull();

    expect(() => canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '北塔' }))
      .toThrowError(expect.objectContaining<Partial<DomainError>>({ code: errorCodes.confirmationRequired }));
    canon.resolveConfirmation(fixture.scope, d.confirmationId!, 0, true);
    const result = canon.settleChapter(fixture.scope, fixture.chapterId, fixture.manuscriptVersionId, { location: '北塔', alive: false });
    expect(result.canonRevision).toBe(1);
    expect(context.database.prepare(`SELECT settlement_status FROM chapters WHERE chapter_id = ?`).get(fixture.chapterId)).toEqual({ settlement_status: 'settled' });
    expect(context.database.prepare(`SELECT status FROM manuscript_versions WHERE manuscript_version_id = ?`).get(fixture.manuscriptVersionId)).toEqual({ status: 'canon' });
  });

  it('拒绝使用过期正史版本接受D级确认', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const fixture = createKnowledgeFixture(context, ids, clock);
    const canon = new CanonService(context.database, ids, clock);
    const entityId = canon.createEntity(fixture.scope, { entityType: 'item', canonicalName: '铜钥匙' });
    const d = canon.proposeFact(fixture.scope, {
      subjectEntityId: entityId, relationKey: 'destroyed', value: true,
      evidence: [{ quote: '钥匙熔毁' }], grade: 'D', sourceChapterId: fixture.chapterId,
      sourceManuscriptVersionId: fixture.manuscriptVersionId
    });
    expect(() => canon.resolveConfirmation(fixture.scope, d.confirmationId!, 1, true))
      .toThrowError(expect.objectContaining<Partial<DomainError>>({ code: errorCodes.canonRevisionConflict }));
  });
});
