import { afterEach, describe, expect, it } from 'vitest';
import { SettingOutlineWorkspaceService } from '../../../apps/api/src/application/knowledge/setting-outline-workspace-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('设定大纲工作状态', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('持久化模板状态与作者自定义项，并按书隔离', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const first = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第一本书', text: '游戏异界' });
    const second = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '第二本书', text: '历史脑洞' });
    const service = new SettingOutlineWorkspaceService(context.database, clock);
    const firstScope = { ownerId: context.config.ownerId, bookId: first.bookId };
    const secondScope = { ownerId: context.config.ownerId, bookId: second.bookId };

    service.save(firstScope, {
      itemKey: 'world-entry',
      groupTitle: '游戏与领主扩展',
      label: '游戏世界接入方式',
      prompt: '确定接入方式、边界与代价。',
      sourceLabel: '游戏题材扩展',
      status: '讨论中',
      sortOrder: 12
    });
    service.save(firstScope, {
      itemKey: 'custom-dream-tax',
      groupTitle: '本书扩展',
      label: '梦境税',
      prompt: '定义征收主体、代价和冲突。',
      sourceLabel: '作者自定义',
      status: '待讨论',
      custom: true,
      sortOrder: 99
    });

    expect(service.list(firstScope)).toMatchObject([
      { itemKey: 'world-entry', status: '讨论中', custom: false },
      { itemKey: 'custom-dream-tax', status: '待讨论', custom: true }
    ]);
    expect(service.list(secondScope)).toEqual([]);
  });

  it('拒绝非法状态且不留下半条记录', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '校验书', text: '玄幻' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const service = new SettingOutlineWorkspaceService(context.database, clock);

    expect(() => service.save(scope, {
      itemKey: 'world',
      groupTitle: '世界与环境',
      label: '世界规则',
      prompt: '确定世界规则。',
      sourceLabel: '通用模板',
      status: '已自动写入正史'
    })).toThrow('设定项状态无效');
    expect(service.list(scope)).toEqual([]);
  });
});
