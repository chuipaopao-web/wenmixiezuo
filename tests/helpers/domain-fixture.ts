import { BookOnboardingService, type OnboardingResult } from '../../apps/api/src/application/books/book-onboarding-service.js';
import { PositioningService } from '../../apps/api/src/application/books/positioning-service.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { TestContext } from './test-context.js';

export function initializeDomainBook(
  context: TestContext,
  ownerId: string,
  ids: IdGenerator,
  clock: Clock,
  input: { title?: string; text?: string; category?: string; tags?: string[]; style?: string } = {}
): OnboardingResult {
  const positioning = new PositioningService(context.database, ids, clock);
  const draft = positioning.createDraft(
    { ownerId },
    {
      title: input.title ?? '领域测试书',
      text: input.text ?? '一个游戏副本中的成长故事',
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.style === undefined ? {} : { style: input.style })
    }
  );
  return new BookOnboardingService(context.database, ids, clock).confirmDraft({ ownerId }, draft.draftId, draft.version);
}

