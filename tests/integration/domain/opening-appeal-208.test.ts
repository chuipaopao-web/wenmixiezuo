import { afterEach, describe, expect, it } from 'vitest';
import { BookOnboardingService } from '../../../apps/api/src/application/books/book-onboarding-service.js';
import { BookProfileViewService } from '../../../apps/api/src/application/books/book-profile-view-service.js';
import { PositioningService } from '../../../apps/api/src/application/books/positioning-service.js';
import {
  toV7OpeningBlueprint,
  validateV7OpeningConfirmationPackage,
  validateV7OpeningPackage,
  validateV7ManualOpeningPackage,
  validateV7OpeningRevisionDraft,
  openingPackageUnchanged
} from '../../../apps/api/src/application/books/v7-opening-package-contract.js';
import { OPENING_TAXONOMY, validateOpeningBlueprint, type OpeningBlueprintInput } from '../../../apps/api/src/contracts/opening-blueprint.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

describe('R208 开书核心卖点与阅读味道数据链路', () => {
  it('A1：模拟AI返回两字段→确认建书→读资料，两字段原样存在正式blueprint', () => {
    const candidate = aiCandidate({ coreAppeal: '税契会自己改写的悬疑脑洞', readingTone: '紧张解谜、智斗爽' });
    const validated = validateV7OpeningPackage(candidate);
    expect(validated.positioning.coreAppeal).toBe('税契会自己改写的悬疑脑洞');
    expect(validated.positioning.readingTone).toBe('紧张解谜、智斗爽');
    const blueprint = toV7OpeningBlueprint(validated, '最初想法原文');
    expect(blueprint.coreAppeal).toBe('税契会自己改写的悬疑脑洞');
    expect(blueprint.readingTone).toBe('紧张解谜、智斗爽');
    const roundtrip = validateOpeningBlueprint(blueprint);
    expect(roundtrip.coreAppeal).toBe('税契会自己改写的悬疑脑洞');
    expect(roundtrip.readingTone).toBe('紧张解谜、智斗爽');
  });

  it('A2：确认包一致性比较不因readingTone缺键与显式值差异误判修改（A5兼容）', () => {
    const stored = aiCandidate({ coreAppeal: '一句话能说清的独特卖点', readingTone: undefined });
    const storedParsed = validateV7OpeningPackage(stored);
    // 作者在页面看到并回传同样的候选（键被前端规范化为缺省）→ 原样确认。
    expect(openingPackageUnchanged(storedParsed, storedParsed)).toBe(true);
    // 历史候选没有readingTone；提交值也没有 → 不算修改。
    const submittedWithoutTone = structuredClone(storedParsed);
    expect(openingPackageUnchanged(storedParsed, submittedWithoutTone)).toBe(true);
  });

  it('A3：作者编辑两字段后经manual校验，新值准确通过且空串保留留空语义', () => {
    const manual = validateV7ManualOpeningPackage(manualInput({
      coreAppeal: '新卖点：机甲修仙的硬核反差',
      readingTone: '热血成长'
    }));
    expect(manual.positioning.coreAppeal).toBe('新卖点：机甲修仙的硬核反差');
    expect(manual.positioning.readingTone).toBe('热血成长');
    // 作者明确清空：readingTone存在且为空串 → 转blueprint后保留空串键，不回退历史风格。
    const cleared = validateV7ManualOpeningPackage(manualInput({ coreAppeal: '一句话能说清的独特卖点', readingTone: '' }));
    expect(cleared.positioning.readingTone).toBe('');
    const clearedBlueprint = toV7OpeningBlueprint(cleared, '');
    expect(clearedBlueprint.readingTone).toBe('');
  });

  it('A5：旧候选缺readingTone原样确认；旧书缺两字段仅改其他项不报错', () => {
    const legacy = aiCandidate({ coreAppeal: '旧书保留下来的核心卖点', readingTone: undefined });
    const { openingPackage, comparisonPackage } = validateV7OpeningConfirmationPackage(legacy);
    expect(openingPackage.positioning.readingTone).toBeUndefined();
    expect(openingPackageUnchanged(openingPackage, comparisonPackage)).toBe(true);
    const blueprint = toV7OpeningBlueprint(openingPackage, '');
    const roundtrip = validateOpeningBlueprint(blueprint);
    expect(roundtrip.coreAppeal).toBe('旧书保留下来的核心卖点');
    expect(roundtrip.readingTone).toBeUndefined();
  });

  it('超长给出中文错误，不静默截断', () => {
    const tooLong = '长'.repeat(301);
    expect(() => validateV7ManualOpeningPackage(manualInput({ coreAppeal: '一句话能说清的独特卖点', readingTone: tooLong })))
      .toThrow(/阅读味道/);
    expect(() => validateOpeningBlueprint({ ...legacyBlueprint(), coreAppeal: '长'.repeat(801) }))
      .toThrow(/核心卖点/);
  });

  it('R208返修2：审查schema与决定白名单含阅读味道；返修稿只改味道不改未授权字段', async () => {
    const runtime = await import('@wenmi/v7-backend');
    expect(runtime.OPENING_DECISION_FIELDS).toContain('positioning.readingTone');
    const review = runtime.parseOpeningReview(JSON.stringify({
      verdict: 'author_decision', summary: '作者需要定味道', issues: [], requiredChanges: [], authorDecisions: [],
      decisions: [{ field: 'positioning.readingTone', question: '阅读味道偏哪种？', currentValue: '紧张解谜', recommendation: '轻松反差', reason: '作者想法偏轻松', impact: '影响基调与节奏', required: true }]
    }));
    expect(review.decisions?.[0]?.field).toBe('positioning.readingTone');
    const references = runtime.buildOpeningReferencePack('末世开面馆的厨师，用热汤面收留幸存者');
    const prompt = runtime.buildOpeningAgentPrompt({
      taskId: 'r208-review-schema', nodeKey: 'opening_package_review', authorIdea: '末世开面馆的厨师，用热汤面收留幸存者', ideaVersion: 1,
      roleKey: 'chief_editor', taskKind: 'opening_review', workstationKey: 'opening',
      operationMode: 'fresh', operation: 'v7_opening_package_review_v1', basedOnTaskId: null,
      referencePack: references, openingPackage: validateV7OpeningPackage(aiCandidate({ coreAppeal: '一句话能说清的独特卖点', readingTone: '紧张解谜、智斗爽' })), review: null, taxonomy: null,
      publishingPlatform: 'fanqie', validationRepair: null, memberInstruction: ''
    } as Parameters<typeof runtime.buildOpeningAgentPrompt>[0]);
    expect(prompt).toContain('positioning.readingTone');
    // 返修保护：allowedFields只授权味道时，稿内未改的书名保持原值，指令白名单原样下发。
    const base = validateV7OpeningPackage(aiCandidate({ coreAppeal: '一句话能说清的独特卖点', readingTone: '紧张解谜' }));
    const submitted = structuredClone(base);
    submitted.positioning.readingTone = '轻松反差';
    const draft = validateV7OpeningRevisionDraft(submitted, base, ['按作者要求改成轻松反差'], ['positioning.readingTone']);
    expect(draft.positioning.readingTone).toBe('轻松反差');
    expect(draft.title).toBe(base.title);
    expect(draft.revisionDirective?.allowedFields).toEqual(['positioning.readingTone']);
  });

  it('A8/A6前置：信息页读取服务暴露两字段并保留缺键语义', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const positioning = new PositioningService(context.database, ids, clock);
    const onboarding = new BookOnboardingService(context.database, ids, clock);
    const blueprint = toV7OpeningBlueprint(validateV7OpeningPackage(aiCandidate({ coreAppeal: '卖点X的完整表述', readingTone: '轻松反差' })), '想法');
    const draft = positioning.createDraft({ ownerId: 'owner-r208' }, { title: 'R208测试书', text: '想法', openingBlueprint: blueprint });
    const created = onboarding.confirmDraftV7({ ownerId: 'owner-r208' }, draft.draftId, draft.version);
    const view = new BookProfileViewService(context.database).get({ ownerId: 'owner-r208', bookId: created.bookId });
    expect(view.coreAppeal).toBe('卖点X的完整表述');
    expect(view.readingTone).toBe('轻松反差');
    // 旧书：blueprint无两字段 → coreAppeal空串、readingTone缺键。
    const legacyOnly = legacyBlueprint();
    const legacyDraft = positioning.createDraft({ ownerId: 'owner-r208' }, { title: '旧书没有新字段', text: '', openingBlueprint: legacyOnly });
    const legacyBook = onboarding.confirmDraftV7({ ownerId: 'owner-r208' }, legacyDraft.draftId, legacyDraft.version);
    const legacyView = new BookProfileViewService(context.database).get({ ownerId: 'owner-r208', bookId: legacyBook.bookId });
    expect(legacyView.coreAppeal).toBe('');
    expect(legacyView.readingTone).toBeUndefined();
  });
});

function aiCandidate(overrides: { coreAppeal: string; readingTone: string | undefined }): Record<string, unknown> {
  return {
    title: '旧港税契谜案录',
    positioning: {
      publishingPlatform: 'fanqie',
      channel: 'male',
      category: OPENING_TAXONOMY.categories.find((item) => item.channel === 'male')?.name ?? '脑洞',
      genres: [OPENING_TAXONOMY.subjects[0]?.name ?? '脑洞'],
      tags: ['脑洞', '成长', '悬疑'],
      coreAppeal: overrides.coreAppeal,
      ...(overrides.readingTone === undefined ? {} : { readingTone: overrides.readingTone }),
      expectedTotalWords: 1_500_000
    },
    backgrounds: { eraAndWorld: '蒸汽旧港，税契即命脉。', openingSituation: '' },
    protagonists: [{
      name: '沈砚', age: '二十岁', identity: '男主',
      background: '税契抄录员', familyBackground: '姐姐失踪前独自持家', careerBackground: '旧港税契房抄录员', goldenFinger: '税契残页会指向被掩盖的交易',
      visualIdentity: { appearance: '面容清瘦、眼神锐利', build: '高瘦', signatureFeature: '袖口墨渍' },
      goal: '', dilemma: '', personality: ['冷静', '重情'], boundary: ''
    }],
    opening: { startingSituation: '', incitingIncident: '', immediateConflict: '', readerPromise: '' },
    longTermDirection: {
      centralConflict: '查清姐姐暗号背后的真相', progression: '从抄录员成长为旧港秩序的破局者', relationshipDirection: '与商会千金从利用到并肩', storyPotential: '每张税契都能开新案件'
    },
    possibleEnding: { direction: '解开真相并重建税契秩序', price: '失去姐姐留下的最后残页', openness: '结局方式可调整' },
    authorNotes: [],
    mustFollow: ['无额外限制']
  };
}

function manualInput(overrides: { coreAppeal: string; readingTone: string }): Record<string, unknown> {
  return {
    ...aiCandidate({ coreAppeal: overrides.coreAppeal, readingTone: overrides.readingTone.length > 0 ? overrides.readingTone : '' }),
    positioning: {
      ...(aiCandidate({ coreAppeal: overrides.coreAppeal, readingTone: undefined }).positioning as Record<string, unknown>),
      coreAppeal: overrides.coreAppeal,
      ...(overrides.readingTone === '' ? { readingTone: '' } : { readingTone: overrides.readingTone })
    }
  };
}

function legacyBlueprint(): OpeningBlueprintInput {
  return {
    taxonomyVersion: OPENING_TAXONOMY.version,
    channel: 'male',
    categoryKey: 'male-fantasy-brain',
    targetAudience: '',
    protagonists: [{ role: 'male_lead', name: '沈砚', age: '二十岁', background: '抄录员', personalities: ['冷静'] }],
    storyDirection: '方向',
    worldBackground: '',
    openingBackground: '',
    stageOne: { start: '', development: '', end: '' },
    fullBookOutline: '',
    mainTags: ['脑洞'],
    auxiliaryTags: [],
    storyTraits: [],
    styleIntent: { languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: [] },
    customTags: [],
    initialMap: '',
    mustFollow: ['无额外限制']
  };
}
