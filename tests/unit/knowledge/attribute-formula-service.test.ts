import { describe, expect, it } from 'vitest';
import { AttributeFormulaService, evaluateArithmetic } from '../../../apps/api/src/application/knowledge/attribute-formula-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds } from '../../helpers/test-context.js';

describe('属性公式', () => {
  it('只计算声明变量和受限算术', () => {
    expect(evaluateArithmetic('(基础攻击 + 武器攻击) * (1 + 加成 / 100)', {
      基础攻击: 100, 武器攻击: 40, 加成: 25
    })).toBe(175);
    expect(() => evaluateArithmetic('未知 + 1', {})).toThrow('未知或无效变量');
    expect(() => evaluateArithmetic('1 / 0', {})).toThrow('除以零');
    expect(() => evaluateArithmetic('globalThis.process.exit()', {})).toThrow('数字格式无效');
  });

  it('版本化公式并在服务端重新计算', () => {
    const context = createTestContext();
    try {
      const ids = new SequenceIds();
      const clock = new FixedClock();
      const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '属性书', text: '验证属性公式' });
      const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
      const service = new AttributeFormulaService(context.database, ids, clock);
      const first = service.create(scope, {
        formulaKey: '攻击力', label: '攻击力', expression: '基础 + 装备',
        variables: [{ key: '基础', label: '基础攻击' }, { key: '装备', label: '装备攻击', defaultValue: 0 }]
      });
      expect(service.evaluate(scope, first.formulaId, { 基础: 90, 装备: 10 }).result).toBe(100);
      const second = service.create(scope, {
        formulaKey: '攻击力', label: '攻击力', expression: '(基础 + 装备) * 倍率',
        variables: [{ key: '基础', label: '基础攻击' }, { key: '装备', label: '装备攻击' }, { key: '倍率', label: '倍率', defaultValue: 1 }]
      });
      expect(second.version).toBe(2);
      expect(service.list(scope, true).map((item) => item.status)).toEqual(['active', 'superseded']);
      expect(() => service.evaluate(scope, first.formulaId, { 基础: 1, 装备: 2 })).toThrow('只能计算当前活动公式');
    } finally {
      context.close();
    }
  });
});
