import { afterEach, describe, expect, it } from 'vitest';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import { BookRepository } from '../../../apps/api/src/infrastructure/db/repositories/book-repository.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../../apps/api/src/contracts/opening-blueprint.js';
import { ProtagonistStateRepository } from '../../../apps/api/src/infrastructure/db/repositories/protagonist-state-repository.js';
import { BookProfileViewService } from '../../../apps/api/src/application/books/book-profile-view-service.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('定位草稿与原子建书', () => {
  it('原子保存完整开书资料、主角候选状态和唯一三席策划理念任务', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      styleIntent: {
        languageTones: ['克制'], emotionalTones: ['温暖'],
        pacingAndPayoff: ['悬念递进'], atmospheres: ['现实'], custom: []
      },
      taxonomyVersion: OPENING_TAXONOMY.version,
      channel: 'female', categoryKey: 'female-modern-brain',
      targetAudience: '喜欢都市悬疑、女性成长和群像关系的读者',
      protagonists: [
        { role: 'female_lead', name: '林雾', age: '二十五岁', background: '城市规划师，返乡处理旧宅。', personalities: ['冷静', '敏锐'] },
        { role: 'male_lead', name: '顾潮', age: '二十六岁', background: '轮渡工程师，掌握旧港水文档案。', personalities: ['克制', '有底线'] }
      ],
      storyDirection: '林雾因一封未来日期的拆迁通知返回旧港，发现城市规划图会改写居民记忆；她要查清姐姐失踪与旧城改造的真相，并在真实代价和完美幻象之间作出选择。',
      worldBackground: '当代沿海城市，旧城区改造牵动多个家族。',
      openingBackground: '林雾收到一封盖着未来日期的拆迁通知。',
      stageOne: { start: '她回到旧宅核查通知。', development: '她发现每次改图都会改变一段现实。', end: '她保住旧街，却让失踪多年的姐姐重新出现。' },
      fullBookOutline: '林雾寻找城市记忆被改写的原因，最终决定保留真实代价而非完美幻象。',
      mainTags: ['现言', '脑洞', '悬疑', '成长'], auxiliaryTags: ['职场成长'], storyTraits: ['智斗', '打脸', '反套路'], customTags: ['城市记忆'],
      initialMap: '临海市旧港区：雾桥街、规划院与废弃轮渡站。', mustFollow: ['不靠误会强推剧情']
    };
    const draft = new PositioningService(context.database, ids, clock).createDraft(
      { ownerId: 'owner-one' }, { title: '雾桥改造簿', text: openingBlueprint.fullBookOutline, openingBlueprint }
    );
    const result = new BookOnboardingService(context.database, ids, clock, undefined, context.config.releaseId)
      .confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version);

    const stored = context.database.prepare(`SELECT taxonomy_version, channel, category_key, blueprint_json, status
      FROM book_opening_blueprints WHERE owner_id = ? AND book_id = ?`).get('owner-one', result.bookId) as Record<string, unknown>;
    expect(stored).toMatchObject({ taxonomy_version: OPENING_TAXONOMY.version, channel: 'female', category_key: 'female-modern-brain', status: 'active' });
    expect(JSON.parse(String(stored.blueprint_json))).toMatchObject({ storyDirection: openingBlueprint.storyDirection, initialMap: openingBlueprint.initialMap, protagonists: [{ name: '林雾' }, { name: '顾潮' }] });
    const storyBible = context.database.prepare(`SELECT content_json FROM artifact_versions WHERE artifact_id = ?`)
      .get(result.storyBibleArtifactId) as { content_json: string };
    expect(JSON.parse(storyBible.content_json)).toMatchObject({
      openingReference: {
        storyDirection: openingBlueprint.storyDirection,
        storyDirectionAuthority: 'owner_confirmed_soft_direction_not_canon',
        authority: 'owner_confirmed_reference_not_canon'
      }
    });
    expect(context.database.prepare('SELECT display_name FROM protagonist_profiles WHERE owner_id = ? AND book_id = ?').all('owner-one', result.bookId))
      .toEqual([{ display_name: '林雾' }, { display_name: '顾潮' }]);
    expect(context.database.prepare(`SELECT label, authority_layer, source_kind FROM protagonist_state_entries
      WHERE owner_id = ? AND book_id = ? ORDER BY logical_key`).all('owner-one', result.bookId)).toEqual([
        { label: '年龄', authority_layer: 'candidate', source_kind: 'owner' },
        { label: '年龄', authority_layer: 'candidate', source_kind: 'owner' },
        { label: '人物背景', authority_layer: 'candidate', source_kind: 'owner' },
        { label: '人物背景', authority_layer: 'candidate', source_kind: 'owner' },
        { label: '性格', authority_layer: 'candidate', source_kind: 'owner' },
        { label: '性格', authority_layer: 'candidate', source_kind: 'owner' },
        { label: '角色身份', authority_layer: 'candidate', source_kind: 'owner' },
        { label: '角色身份', authority_layer: 'candidate', source_kind: 'owner' }
      ]);
    expect(result.kickoffTaskId).toBeNull();
    // 建书后不自动召集 AI：不建讨论任务、不建讨论、不激活设定项
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'`)
      .get('owner-one', result.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM discussions
      WHERE owner_id = ? AND book_id = ?`)
      .get('owner-one', result.bookId)).toEqual({ count: 0 });
    const settingItems = context.database.prepare(`
      SELECT item_key, label, item_status FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ? ORDER BY sort_order, item_key
    `).all('owner-one', result.bookId) as Array<{ item_key: string; label: string; item_status: string }>;
    expect(settingItems[0]).toEqual({ item_key: 'world-stage', label: '世界舞台', item_status: '待讨论' });
    expect(settingItems.filter((item) => item.item_status === '讨论中')).toHaveLength(0);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM positioning_tag_bindings WHERE owner_id = ? AND book_id = ?`)
      .get('owner-one', result.bookId)).toEqual({ count: 11 });
    expect(new BookProfileViewService(context.database).get({ ownerId: 'owner-one', bookId: result.bookId }).storyDirection)
      .toBe(openingBlueprint.storyDirection);
  });

  it('已有正文续写建书后不启动空白设定讨论而等待正文导入', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const openingBlueprint: OpeningBlueprintInput = {
      ...completeOpeningBlueprint(),
      creationMode: 'continuation'
    };
    const draft = new PositioningService(context.database, ids, clock).createDraft(
      { ownerId: 'owner-one' },
      { title: '已有正文续写测试', text: openingBlueprint.storyDirection, openingBlueprint }
    );
    const result = new BookOnboardingService(context.database, ids, clock, undefined, context.config.releaseId)
      .confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version);

    expect(result.kickoffTaskId).toBeNull();
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM messages
      WHERE owner_id = ? AND book_id = ? AND message_type = 'onboarding_trigger'`)
      .get('owner-one', result.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.purpose') = 'setting_proposal_panel'`)
      .get('owner-one', result.bookId)).toEqual({ count: 0 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM setting_outline_workspace
      WHERE owner_id = ? AND book_id = ?`)
      .get('owner-one', result.bookId)).toEqual({ count: 0 });
    const stored = context.database.prepare(`SELECT blueprint_json FROM book_opening_blueprints
      WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .get('owner-one', result.bookId) as { blueprint_json: string };
    expect(JSON.parse(stored.blueprint_json)).toMatchObject({ creationMode: 'continuation' });
  });

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

  it('旧书没有独立故事方向时只读回退到历史全书简介', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const service = new PositioningService(context.database, ids, clock);
    const blueprint = completeOpeningBlueprint();
    const draft = service.createDraft({ ownerId: 'owner-one' }, {
      title: '旧书兼容测试', text: blueprint.fullBookOutline, openingBlueprint: blueprint
    });
    const result = new BookOnboardingService(context.database, ids, clock).confirmDraft(
      { ownerId: 'owner-one' }, draft.draftId, draft.version
    );
    const row = context.database.prepare(`SELECT blueprint_json FROM book_opening_blueprints
      WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .get('owner-one', result.bookId) as { blueprint_json: string };
    const legacy = JSON.parse(row.blueprint_json) as Record<string, unknown>;
    delete legacy.storyDirection;
    context.database.prepare(`UPDATE book_opening_blueprints SET blueprint_json = ?
      WHERE owner_id = ? AND book_id = ? AND status = 'active'`)
      .run(JSON.stringify(legacy), 'owner-one', result.bookId);

    expect(new BookProfileViewService(context.database).get({ ownerId: 'owner-one', bookId: result.bookId }).storyDirection)
      .toBe(blueprint.fullBookOutline);
  });

  it('确认指定草稿版本后原子创建书、7类岗位25名成员、预算、故事圣经和主编租约', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const positioning = new PositioningService(context.database, ids, clock);
    const draft = positioning.createDraft({ ownerId: 'owner-one' }, { title: '甲书', text: '历史中的悬疑谜案', category: '历史', tags: ['谜案'] });
    const updated = positioning.updateDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version, { title: '甲书修订名' });
    expect(() => new BookOnboardingService(context!.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, draft.draftId, draft.version))
      .toThrow('版本已经变化');
    const result = new BookOnboardingService(context.database, ids, clock).confirmDraft({ ownerId: 'owner-one' }, draft.draftId, updated.version);
    expect(result.agentCount).toBe(25);
    expect(new BookRepository(context.database).require({ ownerId: 'owner-one', bookId: result.bookId })).toMatchObject({ title: '甲书修订名', status: 'active', positioningVersion: 1, editorEpoch: 1 });
    expect(context.database.prepare('SELECT COUNT(*) AS count FROM agent_instances WHERE owner_id = ? AND book_id = ?').get('owner-one', result.bookId)).toEqual({ count: 25 });
    expect(context.database.prepare('SELECT cash_limit_micros FROM budgets WHERE budget_id = ?').get(result.budgetId)).toEqual({ cash_limit_micros: 0 });
    expect(context.database.prepare('SELECT status FROM artifacts WHERE artifact_id = ?').get(result.storyBibleArtifactId)).toEqual({ status: 'draft' });
    expect(context.database.prepare('SELECT editor_epoch FROM editor_leases WHERE owner_id = ? AND book_id = ?').get('owner-one', result.bookId)).toEqual({ editor_epoch: 1 });
  });

  it('完整开书资料和主角状态按书隔离', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const positioning = new PositioningService(context.database, ids, clock);
    const first = completeOpeningBlueprint();
    const second: OpeningBlueprintInput = {
      ...completeOpeningBlueprint(),
      protagonists: [{ ...completeOpeningBlueprint().protagonists[0]!, name: '顾川' }],
      fullBookOutline: '顾川从海港小吏成长为守护航路的领航者。',
      initialMap: '澜州港与外海群岛。'
    };
    const firstDraft = positioning.createDraft({ ownerId: 'owner-one' }, { title: '雁州账簿', text: first.fullBookOutline, openingBlueprint: first });
    const secondDraft = positioning.createDraft({ ownerId: 'owner-one' }, { title: '澜州航路', text: second.fullBookOutline, openingBlueprint: second });
    const onboarding = new BookOnboardingService(context.database, ids, clock);
    const firstBook = onboarding.confirmDraft({ ownerId: 'owner-one' }, firstDraft.draftId, firstDraft.version);
    const secondBook = onboarding.confirmDraft({ ownerId: 'owner-one' }, secondDraft.draftId, secondDraft.version);
    const protagonists = new ProtagonistStateRepository(context.database);
    expect(protagonists.listProfiles({ ownerId: 'owner-one', bookId: firstBook.bookId }, false).map((row) => row.display_name)).toEqual(['沈砚']);
    expect(protagonists.listProfiles({ ownerId: 'owner-one', bookId: secondBook.bookId }, false).map((row) => row.display_name)).toEqual(['顾川']);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM book_opening_blueprints WHERE owner_id = ? AND book_id = ?`)
      .get('owner-one', firstBook.bookId)).toEqual({ count: 1 });
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM book_opening_blueprints WHERE owner_id = ? AND book_id = ?`)
      .get('owner-one', secondBook.bookId)).toEqual({ count: 1 });
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

    const completeDraft = positioning.createDraft(
      { ownerId: 'owner-one' },
      { title: '完整失败书', text: completeOpeningBlueprint().fullBookOutline, openingBlueprint: completeOpeningBlueprint() }
    );
    expect(() => new BookOnboardingService(context!.database, ids, clock, undefined, context!.config.releaseId)
      .confirmDraft({ ownerId: 'owner-one' }, completeDraft.draftId, completeDraft.version, 'after_kickoff'))
      .toThrow('simulated-onboarding-failure');
    expect(new BookRepository(context.database).find({ ownerId: 'owner-one', bookId: completeDraft.proposedBookId })).toBeNull();
    for (const table of ['book_opening_blueprints', 'protagonist_profiles', 'tasks', 'messages']) {
      expect(context.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ? AND book_id = ?`)
        .get('owner-one', completeDraft.proposedBookId)).toEqual({ count: 0 });
    }
    expect(positioning.require({ ownerId: 'owner-one' }, completeDraft.draftId).status).toBe('editing');
  });

  it('同名书确认失败时不留下半本书且草稿保持可编辑', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const positioning = new PositioningService(context.database, ids, clock);
    const onboarding = new BookOnboardingService(context.database, ids, clock);
    const firstDraft = positioning.createDraft(
      { ownerId: 'owner-one' }, { title: '同名建书', text: '第一本都市成长故事' }
    );
    onboarding.confirmDraft({ ownerId: 'owner-one' }, firstDraft.draftId, firstDraft.version);
    const duplicateDraft = positioning.createDraft(
      { ownerId: 'owner-one' }, { title: ' 同名建书 ', text: '第二本都市成长故事' }
    );

    expect(() => onboarding.confirmDraft(
      { ownerId: 'owner-one' }, duplicateDraft.draftId, duplicateDraft.version
    )).toThrow('同名书籍');
    expect(new BookRepository(context.database).find({
      ownerId: 'owner-one', bookId: duplicateDraft.proposedBookId
    })).toBeNull();
    expect(positioning.require({ ownerId: 'owner-one' }, duplicateDraft.draftId).status).toBe('editing');
    expect(context.database.prepare(`
      SELECT COUNT(*) AS count FROM agent_instances WHERE owner_id = ? AND book_id = ?
    `).get('owner-one', duplicateDraft.proposedBookId)).toEqual({ count: 0 });
  });

  it('统一拒绝超过15字的创建和草稿改名', () => {
    context = createTestContext();
    const service = new PositioningService(context.database, new SequenceIds(), new FixedClock());
    expect(() => service.createDraft(
      { ownerId: 'owner-one' },
      { title: '一二三四五六七八九十一二三四五六', text: '修仙成长故事' }
    )).toThrow('书名最多15字');
    const draft = service.createDraft(
      { ownerId: 'owner-one' },
      { title: '一二三四五六七八九十一二三四五', text: '修仙成长故事' }
    );
    expect(() => service.updateDraft(
      { ownerId: 'owner-one' }, draft.draftId, draft.version,
      { title: '一二三四五六七八九十一二三四五六' }
    )).toThrow('书名最多15字');
  });
});

function completeOpeningBlueprint(): OpeningBlueprintInput {
  return {
    styleIntent: {
      languageTones: ['幽默'], emotionalTones: ['热血'],
      pacingAndPayoff: ['爽点密集'], atmospheres: ['沉浸'], custom: []
    },
    taxonomyVersion: OPENING_TAXONOMY.version,
    channel: 'male', categoryKey: 'male-history-brain',
    targetAudience: '喜欢历史谋略、群像成长和边城经营的读者',
    protagonists: [{ role: 'male_lead', name: '沈砚', age: '十九岁', background: '边郡书记官。', personalities: ['冷静'] }],
    storyDirection: '沈砚从被涂改的军粮账簿入手，追查边军粮道与军镇争权；他要在不牺牲百姓的前提下找出幕后主使，并逐步获得重建边境秩序的资格。',
    worldBackground: '架空王朝以军镇与州府共同治理边境。', openingBackground: '沈砚发现一份被涂改的军粮账簿。',
    stageOne: { start: '追查假账。', development: '牵出军镇争权。', end: '保住粮道并锁定幕后主使。' },
    fullBookOutline: '沈砚从边郡小吏成长为重建边境秩序的执政者。', mainTags: ['历史', '权谋'], auxiliaryTags: ['架空历史'],
    storyTraits: ['智斗'], customTags: [], initialMap: '雁州城与北仓粮道。', mustFollow: ['不写后宫']
  };
}
