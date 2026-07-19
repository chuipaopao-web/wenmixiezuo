import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { AgentContinuityRepository } from '../../infrastructure/db/repositories/agent-continuity-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export class AgentContinuityService {
  public constructor(private readonly repository: AgentContinuityRepository, private readonly unitOfWork: UnitOfWork, private readonly ids: IdGenerator, private readonly clock: Clock) {}
  public append(scope: BookScope, input: { agentId: string; taskId?: string; entryType: 'step' | 'evidence' | 'objection' | 'conclusion' | 'handoff' | 'failure'; content: Record<string, unknown>; sourceIds: string[]; canonRevision: number }): string {
    rejectThoughtChain(input.content);
    const id = this.ids.next();
    this.repository.appendJournal(scope, { id, ...input, now: this.clock.now().toISOString() }); return id;
  }
  public updateFocus(scope: BookScope, input: { agentId: string; current: unknown; unresolved: unknown; lastContribution: unknown; canonRevision: number }): number {
    rejectThoughtChain(input);
    return this.unitOfWork.run(() => { const version = this.repository.nextFocusVersion(scope, input.agentId);
      this.repository.activateFocus(scope, { id: this.ids.next(), ...input, version, now: this.clock.now().toISOString() }); return version; });
  }
}
function rejectThoughtChain(value: unknown): void {
  const serialized = JSON.stringify(value).toLowerCase();
  if (/chainofthought|chain_of_thought|rawthought|raw_reasoning|思维链/u.test(serialized)) throw new Error('只能保存步骤、依据和结论，不能保存内部思维链');
}
