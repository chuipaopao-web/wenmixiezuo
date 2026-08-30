import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V7_OPENING_MEMBERS } from '@wenmi/v7-backend';
import {
  V7BookCoverDesignService,
  coverOverlaySvg,
  resolveCoverPenName
} from '../../../apps/api/src/application/books/v7-book-cover-design-service.js';
import { V7BookCoverDesignRepository } from '../../../apps/api/src/infrastructure/db/repositories/v7-book-cover-design-repository.js';
import { ModelAdapterError, type ModelAdapter } from '../../../apps/api/src/infrastructure/models/model-adapter.js';
import type { V7OpeningModelAdapterResolver } from '../../../apps/api/src/infrastructure/models/v7-opening-agent-model-gateway.js';
import {
  V7CoverImageGatewayError,
  type V7CoverImageGateway
} from '../../../apps/api/src/infrastructure/models/volcengine-ark-image-gateway.js';
import { initializeV7Book } from '../../helpers/v7-book-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('V7封面编辑部', () => {
  let context: TestContext | undefined;
  afterEach(() => { context?.close(); context = undefined; });

  it('封面优先使用当前账号笔名，兼容旧作者名，缺失时不放品牌占位', () => {
    context = createTestContext('wenmi-v7-cover-pen-name-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    initializeV7Book(context, context.config.ownerId, ids, clock, { title: '乱世执灯人' });
    context.database.prepare('UPDATE owners SET display_name = ? WHERE owner_id = ?').run('旧作者名', context.config.ownerId);
    context.database.prepare(`INSERT INTO user_accounts (
      user_id, owner_id, email_normalized, display_name, password_salt, password_hash,
      role, status, created_at, updated_at, last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'user', 'active', ?, ?, NULL)`).run(
      'cover-pen-name-user', context.config.ownerId, 'cover-pen-name@example.test', '泡泡',
      'salt', 'hash', clock.now().toISOString(), clock.now().toISOString()
    );

    expect(resolveCoverPenName(context.database, context.config.ownerId)).toBe('泡泡');
    const svg = coverOverlaySvg('乱世执灯人', '泡泡<&"');
    expect(svg).toContain('泡泡&lt;&amp;&quot;');
    expect(svg).not.toContain('文秘写作');

    context.database.prepare('DELETE FROM user_accounts WHERE owner_id = ?').run(context.config.ownerId);
    expect(resolveCoverPenName(context.database, context.config.ownerId)).toBe('旧作者名');
    context.database.prepare('UPDATE owners SET display_name = ? WHERE owner_id = ?').run('   ', context.config.ownerId);
    expect(resolveCoverPenName(context.database, context.config.ownerId)).toBeNull();
    expect(coverOverlaySvg('乱世执灯人', null)).not.toContain('fill-opacity="0.78"');
  });

  it('主编先下结构化工单，视觉编剧保存书籍隔离的图片候选，作者采用后只切换当前封面', async () => {
    context = createTestContext('wenmi-v7-cover-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeV7Book(context, context.config.ownerId, ids, clock, { title: '乱世执灯人' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const workOrder = {
      composition: '竖版半身构图，主角在前，汉末边塞在后。',
      visualFocus: '主角清瘦挺拔，眉骨有一道浅疤。',
      atmosphere: '乱世压迫中保留向上的光。',
      palette: '冷青灰与少量暖金。',
      mustKeep: ['汉末边塞', '清瘦挺拔', '眉骨浅疤'],
      mustAvoid: ['现代服装', '仙侠法术'],
      imagePrompt: '竖版中国网文封面插画，汉末边塞，清瘦挺拔青年，眉骨浅疤，无文字。'
    };
    const generateText = vi.fn<ModelAdapter['generate']>(async () => ({
      provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro', output: JSON.stringify(workOrder),
      inputTokens: 100, outputTokens: 120, cashCostCny: 0, state: 'succeeded'
    }));
    const resolver: V7OpeningModelAdapterResolver = {
      resolve: () => ({ provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro', generate: generateText })
    };
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAIElEQVR4nGMwzY4iCTGMasgeDSXT0aQRNZofTGlXagAAU4t3EJfiVcMAAAAASUVORK5CYII=', 'base64');
    const generateImage = vi.fn(async () => ({
      provider: 'volcengine-ark-image' as const,
      modelId: 'doubao-seedream-test', mimeType: 'image/png' as const, buffer: image,
      contentHash: createHash('sha256').update(image).digest('hex')
    }));
    const images: V7CoverImageGateway = { configured: true, modelId: 'doubao-seedream-test', generate: generateImage };
    const repository = new V7BookCoverDesignRepository(context.database);
    const service = new V7BookCoverDesignService(
      context.database, repository, resolver, images, context.config.dataDir, ids, clock,
      () => V7_OPENING_MEMBERS, { codingPlan: true, agentPlan: true }
    );

    const input = {
      idempotencyKey: 'cover-design-fixed-1', platformStyle: 'fanqie', visualStyle: 'vivid',
      compositionStyle: 'character-scene', paletteStyle: 'high-contrast', atmosphereStyle: 'epic',
      elements: ['主角', '战场'], avoidElements: ['现代服装'], authorDirection: '突出乱世求生与身份反差。'
    };
    const created = await service.design(context.config.ownerId, book.bookId, input);
    const repeated = await service.design(context.config.ownerId, book.bookId, input);
    await expect(service.design(context.config.ownerId, book.bookId, { ...input, paletteStyle: 'dark' })).rejects.toThrow('本次封面编号已经用于旧版资料');
    const adopted = service.adopt(context.config.ownerId, book.bookId, created.designId);
    const stored = repository.require(context.config.ownerId, book.bookId, created.designId);

    expect(created.visualMembers).toMatchObject([{ displayName: '绘真', roleName: '封面画师' }]);
    expect(created.workOrder).toMatchObject({
      platformStyle: 'fanqie', visualStyle: 'vivid', compositionStyle: 'character-scene',
      paletteStyle: 'high-contrast', atmosphereStyle: 'epic', elements: ['主角', '战场'],
      avoidElements: ['现代服装'], authorDirection: '突出乱世求生与身份反差。'
    });
    expect(created.workOrder).not.toHaveProperty('imagePrompt');
    expect(repeated).toEqual(created);
    expect(adopted.adopted).toBe(true);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(stored.image_relative_path).not.toBeNull();
    expect(existsSync(`${context.config.dataDir}/${stored.image_relative_path}`)).toBe(true);
    const finalImage = service.readImage(context.config.ownerId, book.bookId, created.designId);
    expect(finalImage.mimeType).toBe('image/png');
    expect(finalImage.buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(finalImage.buffer).not.toEqual(image);
    expect(finalImage.buffer.length).toBeGreaterThan(image.length);
    await expect(sharp(finalImage.buffer).metadata()).resolves.toMatchObject({ width: 1_024, height: 1_536, format: 'png' });
    expect(() => service.readImage(context!.config.ownerId, 'another-book', created.designId)).toThrow('不属于当前书籍');
    expect(() => service.readImage('another-owner', book.bookId, created.designId)).toThrow('不属于当前书籍');
    expect(context.database.prepare(`SELECT operation_type, status FROM operations WHERE owner_id = ? AND book_id = ? AND operation_type = 'v7_cover_design'`).get(context.config.ownerId, book.bookId))
      .toEqual({ operation_type: 'v7_cover_design', status: 'succeeded' });
    expect(context.database.prepare(`SELECT source_kind,state,input_tokens,output_tokens,consumed_units
      FROM account_usage_supplemental_calls WHERE source_id LIKE ? ORDER BY source_kind`)
      .all(`${created.designId}%`)).toEqual([
      { source_kind: 'v7_cover_image', state: 'succeeded', input_tokens: 0, output_tokens: 0, consumed_units: 1 },
      { source_kind: 'v7_cover_text', state: 'succeeded', input_tokens: 100, output_tokens: 120, consumed_units: 0 }
    ]);
    expect(context.database.prepare(`SELECT task_kind, model_profile_key FROM v7_prompt_manifests
      WHERE owner_id=? AND book_id=? AND task_kind IN ('cover_brief','cover_render') ORDER BY task_kind`)
      .all(context.config.ownerId, book.bookId)).toEqual([
        { task_kind: 'cover_brief', model_profile_key: 'deepseek-v4-pro' },
        { task_kind: 'cover_render', model_profile_key: 'doubao-seedream' }
      ]);
    expect(service.tasks(context.config.ownerId, 20)[0]).toMatchObject({
      designId: created.designId, taskKind: 'cover_design', bookId: book.bookId,
      bookTitle: '乱世执灯人', status: 'succeeded', memberNames: ['貂蝉', '绘真']
    });
  });

  it('图片能力未值班时只显示视觉编剧请假，不建立假任务或占位封面', async () => {
    context = createTestContext('wenmi-v7-cover-leave-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeV7Book(context, context.config.ownerId, ids, clock, { title: '无图测试' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const images: V7CoverImageGateway = {
      configured: false, modelId: 'not-configured',
      generate: async () => { throw new Error('不应调用'); }
    };
    const resolver: V7OpeningModelAdapterResolver = { resolve: () => { throw new Error('不应调用'); } };
    const service = new V7BookCoverDesignService(
      context.database, new V7BookCoverDesignRepository(context.database), resolver, images,
      context.config.dataDir, ids, clock, () => V7_OPENING_MEMBERS, { codingPlan: true, agentPlan: true }
    );

    expect(service.studio(context.config.ownerId, book.bookId).visualMembers.some((member) => member.status === 'on_leave')).toBe(true);
    await expect(service.design(context.config.ownerId, book.bookId, { idempotencyKey: 'cover-design-fixed-2' })).rejects.toThrow('对不起，视觉编辑部这次未能开始制作');
    expect(context.database.prepare('SELECT count(*) AS count FROM v7_book_cover_designs').get()).toEqual({ count: 0 });
  });

  it('刷新封面工作台可以看到进行中和已交接任务，不会重复发单或泄露内部错误', () => {
    context = createTestContext('wenmi-v7-cover-recovery-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeV7Book(context, context.config.ownerId, ids, clock, { title: '任务恢复测试' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const images: V7CoverImageGateway = { configured: true, modelId: 'test', generate: async () => { throw new Error('不应调用'); } };
    const resolver: V7OpeningModelAdapterResolver = { resolve: () => { throw new Error('不应调用'); } };
    const repository = new V7BookCoverDesignRepository(context.database);
    const service = new V7BookCoverDesignService(
      context.database, repository, resolver, images, context.config.dataDir, ids, clock,
      () => V7_OPENING_MEMBERS, { codingPlan: true, agentPlan: true }
    );
    repository.create({
      designId: 'cover-working-0001', ownerId: context.config.ownerId, bookId: book.bookId,
      idempotencyKey: 'cover-recovery-action-1', requestHash: 'a'.repeat(64), sourceVersion: 1,
      chiefMemberKey: 'chief-editor-kimi-k3', visualMemberKey: 'visual-renderer-seedream', now: clock.now().toISOString()
    });
    let studio = service.studio(context.config.ownerId, book.bookId);
    expect(studio.designs[0]).toMatchObject({ designId: 'cover-working-0001', status: 'working', imageUrl: null, downloadUrl: null, workOrder: null });
    expect(studio.designs[0]!.statusText).toContain('正在加急制作');
    repository.fail(context.config.ownerId, book.bookId, 'cover-working-0001', 'provider stack and secret details', clock.now().toISOString());
    studio = service.studio(context.config.ownerId, book.bookId);
    expect(studio.designs[0]).toMatchObject({ status: 'failed', imageUrl: null, downloadUrl: null, workOrder: null });
    expect(studio.designs[0]!.statusText).toContain('工作已经交接');
    expect(JSON.stringify(studio)).not.toContain('provider stack');
    expect(service.tasks(context.config.ownerId, 20)[0]).toMatchObject({
      designId: 'cover-working-0001', taskKind: 'cover_design', status: 'failed', bookTitle: '任务恢复测试'
    });
    expect(JSON.stringify(service.tasks(context.config.ownerId, 20))).not.toContain('provider stack');
  });

  it('封面文字调用结果未知时逐席保留预留，不把可能已消耗的调用释放', async () => {
    context = createTestContext('wenmi-v7-cover-text-unknown-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeV7Book(context, context.config.ownerId, ids, clock, { title: '封面文字未知测试' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const generate = vi.fn<ModelAdapter['generate']>(async () => {
      throw new ModelAdapterError('工单提交后连接中断', 'technical_failure', true, undefined, true);
    });
    const service = new V7BookCoverDesignService(
      context.database,
      new V7BookCoverDesignRepository(context.database),
      { resolve: () => ({ provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro', generate }) },
      { configured: true, modelId: 'image-model', generate: async () => { throw new Error('不应出图'); } },
      context.config.dataDir,
      ids,
      clock,
      () => V7_OPENING_MEMBERS,
      { codingPlan: true, agentPlan: true }
    );

    await expect(service.design(context.config.ownerId, book.bookId, {
      idempotencyKey: 'cover-text-unknown-0001'
    })).rejects.toThrow('主编这次没有完成封面工单');

    const rows = context.database.prepare(`SELECT state,reserved_tokens FROM account_usage_supplemental_calls
      WHERE source_kind='v7_cover_text' ORDER BY source_id`).all() as Array<{ state: string; reserved_tokens: number }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.state === 'unknown' && row.reserved_tokens > 0)).toBe(true);
    expect(context.database.prepare(`SELECT COUNT(*) AS count FROM account_usage_projection
      WHERE source_kind='v7_cover_text' AND usage_state='reserved'`).get()).toEqual({ count: 3 });
  });

  it('封面图片调用结果未知时保留一张图片预留，避免作者无保护地重复出图', async () => {
    context = createTestContext('wenmi-v7-cover-image-unknown-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeV7Book(context, context.config.ownerId, ids, clock, { title: '封面图片未知测试' });
    seedProfile(context, context.config.ownerId, book.bookId, ids, clock);
    const workOrder = {
      composition: '竖版人物与场景构图', visualFocus: '乱世中的年轻主角', atmosphere: '紧张而有希望',
      palette: '冷青与暖金', mustKeep: ['汉末边塞'], mustAvoid: ['现代服装'],
      imagePrompt: '竖版中国历史网文封面，汉末边塞，年轻主角站在城墙前，冷青与暖金，高对比，无文字。'
    };
    const resolver: V7OpeningModelAdapterResolver = { resolve: () => ({
      provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro',
      generate: async () => ({
        provider: 'volcengine-coding-plan', modelId: 'deepseek-v4-pro', output: JSON.stringify(workOrder),
        inputTokens: 80, outputTokens: 90, cashCostCny: 0, state: 'succeeded'
      })
    }) };
    const images: V7CoverImageGateway = {
      configured: true,
      modelId: 'image-model',
      generate: async () => { throw new V7CoverImageGatewayError('图片请求提交后超时', true); }
    };
    const service = new V7BookCoverDesignService(
      context.database,
      new V7BookCoverDesignRepository(context.database),
      resolver,
      images,
      context.config.dataDir,
      ids,
      clock,
      () => V7_OPENING_MEMBERS,
      { codingPlan: true, agentPlan: true }
    );

    await expect(service.design(context.config.ownerId, book.bookId, {
      idempotencyKey: 'cover-image-unknown-0001'
    })).rejects.toThrow('这次没有完成制作');

    expect(context.database.prepare(`SELECT state,reserved_units FROM account_usage_supplemental_calls
      WHERE source_kind='v7_cover_image'`).get()).toEqual({ state: 'unknown', reserved_units: 1 });
    expect(context.database.prepare(`SELECT usage_state,reserved_units FROM account_usage_projection
      WHERE source_kind='v7_cover_image'`).get()).toEqual({ usage_state: 'reserved', reserved_units: 1 });
  });
});

function seedProfile(context: TestContext, ownerId: string, bookId: string, ids: SequenceIds, clock: FixedClock): void {
  const blueprint = {
    creationMode: 'new', openingIdea: '现代青年穿越汉末边塞，从小卒开始改变命运。', taxonomyVersion: 'test-v1',
    channel: 'male', categoryKey: 'male-history-brain', targetAudience: '喜欢历史成长的读者',
    protagonists: [{
      role: 'male_lead', name: '张牧', age: '23', background: '现代历史系学生', familyBackground: '普通家庭',
      careerBackground: '边军小卒', goldenFinger: '', personalities: ['谨慎', '果断'],
      visualIdentity: { appearance: '眉眼清俊，短发', build: '清瘦挺拔', signatureFeature: '眉骨一道浅疤' }
    }],
    storyDirection: '从小卒成长为能够保护一方的将领。', openingStart: '被边军临时征发。', storyEnding: '成为一方名将。',
    worldBackground: '东汉末年，地方秩序松动。', openingBackground: '边军屯所正遭夜袭。',
    stageOne: { start: '', development: '', end: '' }, fullBookOutline: '', mainTags: ['成长', '权谋'], auxiliaryTags: ['穿越'], storyTraits: [],
    styleIntent: { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
    customTags: [], initialMap: '', mustFollow: ['不要系统']
  };
  const content = JSON.stringify(blueprint);
  context.database.prepare(`INSERT INTO book_opening_blueprints (
    opening_blueprint_id, owner_id, book_id, version, taxonomy_version, channel,
    category_key, category_name, blueprint_json, content_hash, status, created_at
  ) VALUES (?, ?, ?, 1, 'test-v1', 'male', 'male-history-brain', '历史脑洞', ?, ?, 'active', ?)`)
    .run(ids.next(), ownerId, bookId, content, createHash('sha256').update(content).digest('hex'), clock.now().toISOString());
}
