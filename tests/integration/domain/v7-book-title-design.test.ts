import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V7_OPENING_MEMBERS, openingRosterFromGlobal } from '@wenmi/v7-backend';
import { V7AgentGovernanceService } from '../../../apps/api/src/application/agents/v7-agent-governance-service.js';
import { V7BookTitleDesignService } from '../../../apps/api/src/application/books/v7-book-title-design-service.js';
import { V7AgentGovernanceRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-agent-governance-repository.js';
import { V7BookTitleDesignRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-book-title-design-repository.js';
import { ModelAdapterError, type ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('V7随时设计书名', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });

  it('只依据当前开书资料生成候选，不要求先建立第一卷，并按书隔离保存调用', async () => {
    context = createTestContext('wenmi-v7-title-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '旧书名' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const generate = vi.fn<ModelAdapter['generate']>(async (request) => ({
      provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro',
      output: JSON.stringify({ options: [
        ['边军起势', '突出底层开局'], ['乱世小卒', '突出身份反差'], ['汉末执棋人', '突出谋略成长'],
        ['从流民到将军', '直说成长方向'], ['烽火照归途', '突出乱世氛围']
      ].map(([text, note]) => ({ text, note })) }),
      inputTokens: 120, outputTokens: 90, cashCostCny: 0, state: 'succeeded'
    }));
    const resolver: V7OpeningModelAdapterResolver = { resolve: () => ({ provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro', generate }) };
    const service = new V7BookTitleDesignService(
      context.database,
      new V7BookTitleDesignRepository(context.database),
      resolver,
      ids,
      clock,
      () => V7_OPENING_MEMBERS,
      { codingPlan: true, agentPlan: true }
    );

    const input = { idempotencyKey: 'title-design-fixed-1', platformStyle: 'qidian', titleFlavor: 'identity-gap', authorDirection: '突出小卒和未来名将的反差。' };
    const first = await service.design(context.config.ownerId, book.bookId, input);
    const repeated = await service.design(context.config.ownerId, book.bookId, input);

    expect(first.options).toHaveLength(5);
    expect(first.options[0]?.text).toBe('边军起势');
    expect(repeated).toEqual(first);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0].prompt).toContain('identity-gap');
    expect(context.database.prepare('SELECT owner_id, book_id, state FROM v7_book_title_design_calls').get())
      .toEqual({ owner_id: context.config.ownerId, book_id: book.bookId, state: 'succeeded' });
    expect(context.database.prepare(`SELECT source_kind,state,input_tokens,output_tokens FROM account_usage_supplemental_calls
      WHERE source_kind='v7_title' AND source_id=?`).get(first.designId)).toEqual({
      source_kind: 'v7_title', state: 'succeeded', input_tokens: 120, output_tokens: 90
    });
    expect(service.studio(context.config.ownerId, book.bookId).designs[0]).toMatchObject({
      designId: first.designId, status: 'succeeded', options: first.options
    });
    expect(service.tasks(context.config.ownerId, 20)[0]).toMatchObject({
      designId: first.designId, taskKind: 'title_design', bookId: book.bookId,
      bookTitle: '旧书名', status: 'succeeded'
    });
  });

  it('后台切换成员模型后，实际调用与提示清单冻结同一个治理档案键', async () => {
    context = createTestContext('wenmi-v7-title-model-profile-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '模型切换测试' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const governance = new V7AgentGovernanceService(
      new V7AgentGovernanceRepository(context.database), ids, clock,
      { codingPlan: true, agentPlan: true, image: true }
    );
    governance.updateMember('admin', 'chief-deepseek-v4-pro', {
      expectedRevision: governance.snapshot().revision,
      modelProfileKey: 'glm-5.3'
    });
    const resolve = vi.fn<V7OpeningModelAdapterResolver['resolve']>((provider, modelId) => ({
      provider,
      modelId,
      generate: async () => ({
        provider,
        modelId,
        output: JSON.stringify({ options: [
          ['汉末执棋人', '突出谋略'], ['小卒定山河', '突出反差'], ['边军起势', '突出成长'],
          ['乱世问鼎', '突出野心'], ['烽火照归途', '突出氛围']
        ].map(([text, note]) => ({ text, note })) }),
        inputTokens: 100,
        outputTokens: 80,
        cashCostCny: 0,
        state: 'succeeded'
      })
    }));
    const service = new V7BookTitleDesignService(
      context.database,
      new V7BookTitleDesignRepository(context.database),
      { resolve },
      ids,
      clock,
      () => openingRosterFromGlobal(governance.snapshot().members),
      { codingPlan: true, agentPlan: true }
    );

    await service.design(context.config.ownerId, book.bookId, {
      idempotencyKey: 'title-model-profile-0001'
    });

    expect(resolve).toHaveBeenCalledWith('volcengine-ark-coding-plan', 'glm-5.3', 'structured_planning');
    expect(context.database.prepare(`SELECT member_key,model_profile_key FROM v7_prompt_manifests
      WHERE owner_id=? AND book_id=? AND task_kind='title_design'`).get(context.config.ownerId, book.bookId))
      .toEqual({ member_key: 'chief-deepseek-v4-pro', model_profile_key: 'glm-5.3' });
  });

  it('供应商结果未知时保留算力预留，不把可能已消耗的调用记成失败', async () => {
    context = createTestContext('wenmi-v7-title-unknown-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '未知结果测试' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const generate = vi.fn<ModelAdapter['generate']>(async () => {
      throw new ModelAdapterError('连接在提交后中断', 'technical_failure', true, undefined, true);
    });
    const service = new V7BookTitleDesignService(
      context.database,
      new V7BookTitleDesignRepository(context.database),
      { resolve: () => ({ provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro', generate }) },
      ids,
      clock,
      () => V7_OPENING_MEMBERS,
      { codingPlan: true, agentPlan: true }
    );

    await expect(service.design(context.config.ownerId, book.bookId, {
      idempotencyKey: 'title-unknown-result-0001'
    })).rejects.toThrow('这次没有完成书名设计');

    expect(context.database.prepare(`SELECT state,reserved_tokens FROM account_usage_supplemental_calls
      WHERE source_kind='v7_title'`).get()).toMatchObject({ state: 'unknown' });
    expect(context.database.prepare(`SELECT usage_state,reserved_tokens FROM account_usage_projection
      WHERE source_kind='v7_title'`).get()).toMatchObject({ usage_state: 'reserved' });
    expect(context.database.prepare('SELECT state FROM v7_book_title_design_calls').get()).toEqual({ state: 'failed' });
  });
});

function seedProfile(context: TestContext, ownerId: string, bookId: string, ids: SequenceIds, clock: FixedClock): void {
  const blueprint = {
    creationMode: 'new', openingIdea: '现代青年穿越到三国乱世，从流民开始改变命运。', taxonomyVersion: 'test-v1',
    channel: 'male', categoryKey: 'male-history-brain', targetAudience: '喜欢历史成长的读者',
    protagonists: [{ role: 'male_lead', name: '张牧', age: '23', background: '现代历史系学生', familyBackground: '普通家庭', careerBackground: '学生', goldenFinger: '', personalities: ['谨慎', '果断'] }],
    storyDirection: '从流民成长为能够保护一方的将领。', openingStart: '被边军临时征发。', storyEnding: '成为一方名将。',
    worldBackground: '东汉末年，地方秩序松动。', openingBackground: '边军屯所正遭夜袭。',
    stageOne: { start: '', development: '', end: '' }, fullBookOutline: '', mainTags: ['成长', '权谋'], auxiliaryTags: ['穿越'], storyTraits: [],
    styleIntent: { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
    customTags: [], initialMap: '', mustFollow: ['不要系统']
  };
  const content = JSON.stringify(blueprint);
  context.database.prepare(`
    INSERT INTO book_opening_blueprints (
      opening_blueprint_id, owner_id, book_id, version, taxonomy_version, channel,
      category_key, category_name, blueprint_json, content_hash, status, created_at
    ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'male-history-brain', '历史脑洞', ?, ?, 'active', ?)
  `).run(ids.next(), ownerId, bookId, content, createHash('sha256').update(content).digest('hex'), clock.now().toISOString());
}
