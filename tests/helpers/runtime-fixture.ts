import { BookLifecycleService } from '../../apps/api/src/application/books/book-lifecycle-service.js';
import { AgentTeamService, type AgentRecord } from '../../apps/api/src/application/agents/agent-team-service.js';
import type { BookScope } from '../../apps/api/src/domain/scope.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { TestContext } from './test-context.js';

export function initializeRuntimeBook(
  context: TestContext,
  scope: BookScope,
  ids: IdGenerator,
  clock: Clock,
  title = '运行测试书'
): AgentRecord[] {
  const lifecycle = new BookLifecycleService(context.database, context.dataDir, ids, clock);
  lifecycle.ensureOwner(scope);
  lifecycle.createDraft(scope, title);
  return new AgentTeamService(context.database, ids, clock).createTeam(scope);
}

