import { afterEach, describe, expect, it } from 'vitest';
import { LocalAssistantService } from '../../../apps/api/src/application/local-assistant/local-assistant-service.js';
import { LocalAssistantRepository } from '../../../apps/api/src/infrastructure/db/repositories/local-assistant-repository.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('local assistant protected operation routing', () => {
  let context: TestContext | undefined;

  afterEach(() => {
    context?.close();
    context = undefined;
  });

  it('does not mistake fictional purchase restrictions for a real payment request', () => {
    context = createTestContext();
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock);
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const service = new LocalAssistantService(
      new LocalAssistantRepository(context.database),
      ids,
      clock
    );

    expect(service.route(scope, {
      conversationId: 'conversation',
      messageId: 'fiction-rule',
      original: '讨论卷纲：不得让主角用现实资金购买游戏物资，也不要写付费商城。'
    }).routeClass).not.toBe('protected_operation');
    expect(service.route(scope, {
      conversationId: 'conversation',
      messageId: 'real-payment',
      original: '请帮我购买并开通这个付费模型套餐。'
    }).routeClass).toBe('protected_operation');
  });
});
