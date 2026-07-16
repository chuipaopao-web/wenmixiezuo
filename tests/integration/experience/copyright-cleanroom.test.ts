import { afterEach, describe, expect, it } from 'vitest';
import { CopyrightService } from '../../../apps/api/src/application/copyright/copyright-service.js';
import { DomainError, errorCodes } from '../../../apps/api/src/domain/errors.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('版权隔离与干净室门禁', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('原文隔离、结构抽象和主笔上下文禁入均生效', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '干净室测试书', text: '重新设计人物因果和世界规则' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const copyright = new CopyrightService(context.database, ids, clock);
    const sourceId = copyright.registerSource(scope, {
      title: '受保护参考文本', rightsPath: 'cleanroom',
      content: '林澈在北塔找到顾衡留下的三枚铜钥匙，并按第三个日期进入密室。守门人用檐铃暗号确认身份。'
    });
    expect(() => copyright.createStructureCard(scope, sourceId, {
      tensionPattern: '林澈追踪顾衡留下的物证', transformation: '从被动调查转为主动设局'
    }, ['林澈', '顾衡', '北塔'])).toThrowError(expect.objectContaining<Partial<DomainError>>({ code: errorCodes.copyrightBlocked }));
    const cardId = copyright.createStructureCard(scope, sourceId, {
      tensionPattern: '角色根据不完整物证逐层验证幕后安排',
      pacing: ['异常出现', '交叉验证', '主动设置反证', '新风险显现'],
      abstractRoles: ['调查者', '缺席的引导者', '受命监视者'],
      transformation: '从被观察转为主动制造信息差',
      themeQuestions: ['人在不完整信息中如何建立可信判断']
    }, ['林澈', '顾衡', '北塔']);
    const packageId = copyright.buildCleanroomPackage(scope, cardId);
    const pack = context.database.prepare(`SELECT context_json FROM cleanroom_packages WHERE cleanroom_package_id = ?`).get(packageId) as { context_json: string };
    expect(pack.context_json).not.toContain('林澈');
    expect(pack.context_json).not.toContain('顾衡');
    expect(pack.context_json).not.toContain('北塔');
    expect(pack.context_json).not.toContain('三枚铜钥匙');
    expect(() => copyright.assertWriterContextSafe([{ sourceType: 'copyright_raw', content: '隔离原文' }]))
      .toThrowError(expect.objectContaining<Partial<DomainError>>({ code: errorCodes.copyrightBlocked }));
    expect(() => copyright.assertWriterContextSafe([{ sourceType: 'cleanroom_package', content: pack.context_json }])).not.toThrow();
  });

  it('换名近写仍按文本和事件链分维度阻断，普通继续不能放行', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '近写检测书', text: '版权风险检测' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const copyright = new CopyrightService(context.database, ids, clock);
    const original = '林澈在雨夜进入北塔，先观察门槛泥痕，再用铜镜确认二楼人影，随后以错误时辰诱使记账人修正账册，最后从伞骨取回拓印证据。';
    const sourceId = copyright.registerSource(scope, { title: '原作段落', content: original, rightsPath: 'quick_reference' });
    const renamed = '沈砚在雨夜进入北塔，先观察门槛泥痕，再用铜镜确认二楼人影，随后以错误时辰诱使记账人修正账册，最后从伞骨取回拓印证据。';
    const check = copyright.checkTarget(scope, sourceId, 'manuscript', 'candidate-1', renamed);
    expect(check.riskLevel).toBe('blocked');
    expect(check.decision).toBe('redesign');
    expect(check.dimensions.text).toBeGreaterThan(0.5);
    expect(check.dimensions.eventChain).toBeGreaterThan(0.5);
  });

  it('只有带licenseId的授权改编路径可以记录授权放行', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '授权测试书', text: '授权改编验证' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const copyright = new CopyrightService(context.database, ids, clock);
    expect(() => copyright.registerSource(scope, { title: '缺授权', content: '这是足够长但没有授权凭证的改编来源文本内容。', rightsPath: 'authorized_adaptation' }))
      .toThrowError(expect.objectContaining<Partial<DomainError>>({ code: errorCodes.copyrightBlocked }));
    const sourceId = copyright.registerSource(scope, {
      title: '已授权', content: '这是具有明确书面授权凭证的改编来源文本内容。', rightsPath: 'authorized_adaptation', authorization: { licenseId: 'license-fixture-001', scope: 'test-only' }
    });
    expect(copyright.checkTarget(scope, sourceId, 'plan', 'authorized-plan', '这是具有明确书面授权凭证的改编来源文本内容。').decision).toBe('authorized');
  });
});
