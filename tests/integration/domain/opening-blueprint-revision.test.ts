import { afterEach, describe, expect, it } from 'vitest';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { BookProfileViewService } from '../../../apps/api/src/application/books/book-profile-view-service.js';
import { OpeningBlueprintService } from '../../../apps/api/src/application/books/opening-blueprint-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../../apps/api/src/contracts/opening-blueprint.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { OpeningBlueprintRepository } from '../../../apps/api/src/infrastructure/db/repositories/opening-blueprint-repository.js';
import { UnitOfWork } from '../../../apps/api/src/infrastructure/db/unit-of-work.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('开书资料不可变修订', () => {
  it('原子创建新版本、保留旧版本并让读取端只看到当前资料', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const original = completeBlueprint();
    const positioning = new PositioningService(context.database, ids, clock);
    const draft = positioning.createDraft({ ownerId: 'owner-one' }, {
      title: '旧标题', text: original.storyDirection, openingBlueprint: original
    });
    const created = new BookOnboardingService(context.database, ids, clock, undefined, context.config.releaseId)
      .confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version);
    const service = new OpeningBlueprintService(
      new OpeningBlueprintRepository(context.database),
      new BookRepository(context.database),
      new UnitOfWork(context.database),
      ids,
      clock
    );
    const revised = {
      ...original,
      protagonists: [{ ...original.protagonists[0]!, name: '沈澜' }],
      storyDirection: '沈澜从一封未来来信追查旧港记忆失窃案，并在救回姐姐与保住城市真实历史之间寻找第三条路。'
    };

    const result = service.revise({ ownerId: 'owner-one', bookId: created.bookId }, {
      expectedVersion: 1,
      title: '新标题',
      openingBlueprint: revised
    });

    expect(result).toMatchObject({ version: 2, previousVersion: 1, title: '新标题' });
    expect(new BookProfileViewService(context.database).get({ ownerId: 'owner-one', bookId: created.bookId }))
      .toMatchObject({ title: '新标题', version: 2, storyDirection: revised.storyDirection, openingBlueprint: { protagonists: [{ name: '沈澜' }] } });
    expect(context.database.prepare(`
      SELECT version, status FROM book_opening_blueprints
      WHERE owner_id = ? AND book_id = ? ORDER BY version
    `).all('owner-one', created.bookId)).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'active' }
    ]);
    expect(new BookRepository(context.database).require({ ownerId: 'owner-one', bookId: created.bookId }))
      .toMatchObject({ title: '新标题', version: 2 });
  });

  it('拒绝过期版本和创作方式切换，失败后不留下半个版本', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const original = completeBlueprint();
    const positioning = new PositioningService(context.database, ids, clock);
    const draft = positioning.createDraft({ ownerId: 'owner-one' }, {
      title: '并发测试', text: original.storyDirection, openingBlueprint: original
    });
    const created = new BookOnboardingService(context.database, ids, clock, undefined, context.config.releaseId)
      .confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version);
    const service = new OpeningBlueprintService(
      new OpeningBlueprintRepository(context.database),
      new BookRepository(context.database),
      new UnitOfWork(context.database),
      ids,
      clock
    );
    const scope = { ownerId: 'owner-one', bookId: created.bookId };
    service.revise(scope, { expectedVersion: 1, title: '第一次修改', openingBlueprint: {
      ...original, storyDirection: '沈砚先调查失踪账册，再追踪旧城税契背后的权力交易，最后必须决定公开真相会不会伤害无辜者。'
    } });

    expect(() => service.revise(scope, {
      expectedVersion: 1, title: '过期修改', openingBlueprint: original
    })).toThrow('已经被修改');
    expect(() => service.revise(scope, {
      expectedVersion: 2, title: '切换方式', openingBlueprint: { ...original, creationMode: 'continuation' }
    })).toThrow('不能切换');
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM book_opening_blueprints WHERE owner_id = ? AND book_id = ?
    `).get('owner-one', created.bookId)).toEqual({ count: 2 });
    expect(new BookProfileViewService(context.database).get(scope)).toMatchObject({ title: '第一次修改', version: 2 });
  });

  it('严格按书和作者隔离修改范围', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const original = completeBlueprint();
    const positioning = new PositioningService(context.database, ids, clock);
    const draft = positioning.createDraft({ ownerId: 'owner-one' }, {
      title: '隔离测试', text: original.storyDirection, openingBlueprint: original
    });
    const created = new BookOnboardingService(context.database, ids, clock, undefined, context.config.releaseId)
      .confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version);
    const service = new OpeningBlueprintService(
      new OpeningBlueprintRepository(context.database),
      new BookRepository(context.database),
      new UnitOfWork(context.database),
      ids,
      clock
    );

    expect(() => service.revise({ ownerId: 'owner-two', bookId: created.bookId }, {
      expectedVersion: 1, title: '越权修改', openingBlueprint: original
    })).toThrow('书籍不存在');
    expect(new BookProfileViewService(context.database).get({ ownerId: 'owner-one', bookId: created.bookId }))
      .toMatchObject({ title: '隔离测试', version: 1 });
  });
});

function completeBlueprint(): OpeningBlueprintInput {
  return {
    creationMode: 'new',
    taxonomyVersion: OPENING_TAXONOMY.version,
    channel: 'male',
    categoryKey: 'male-fantasy-brain',
    targetAudience: '',
    protagonists: [{
      role: 'male_lead',
      name: '沈砚',
      age: '二十岁',
      background: '旧港税契抄录员，擅长从账目里发现被掩盖的交易。',
      personalities: ['冷静', '有底线']
    }],
    storyDirection: '沈砚因一册会自行改写的税契卷入旧港失踪案，要查清姐姐留下的暗号，同时避开垄断航路的商会追捕。',
    worldBackground: '',
    openingBackground: '',
    stageOne: { start: '', development: '', end: '' },
    fullBookOutline: '',
    mainTags: ['脑洞', '成长'],
    auxiliaryTags: [],
    storyTraits: [],
    styleIntent: { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
    customTags: [],
    initialMap: '',
    mustFollow: ['无额外限制']
  };
}
