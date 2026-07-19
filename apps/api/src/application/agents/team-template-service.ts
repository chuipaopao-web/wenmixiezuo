import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { creativeMemberContracts, deterministicTeamProfile, type CreativeRoleKey, type TeamModelProfile } from '../../contracts/agent-team-v2.js';
import type { AgentGovernanceRepository, TeamAgentRow } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export class TeamTemplateService {
  public constructor(
    private readonly repository: AgentGovernanceRepository, private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator, private readonly clock: Clock
  ) {}

  public createTeam(scope: BookScope, options: { deterministic?: boolean; profiles?: Partial<Record<CreativeRoleKey, TeamModelProfile>> | undefined; failureAfter?: number } = {}): TeamAgentRow[] {
    const now = this.clock.now().toISOString();
    return this.unitOfWork.run(() => {
      const contractsJson = JSON.stringify(creativeMemberContracts);
      const revisionId = this.ids.next();
      this.repository.insertBindingRevision(scope, { id: revisionId, version: this.repository.nextBindingVersion(scope), effectiveFrom: now, reason: '创建十一人创作团队', now });
      creativeMemberContracts.forEach((contract, index) => {
        this.repository.seedRole({ roleTemplateId: contract.roleTemplateId, roleKey: contract.roleKey, shortTitle: contract.shortTitle,
          category: contract.category, responsibilities: contract.responsibilities, capabilities: ['text'], activation: contract.defaultActivation, now });
        const profile = options.deterministic === true
          ? { ...deterministicTeamProfile, modelId: `wenmi-fixture-v2-${contract.roleKey}` }
          : options.profiles?.[contract.roleKey] ?? contract.defaultModel;
        const snapshotId = this.ids.next();
        const agentId = this.ids.next();
        this.repository.insertModelSnapshot(scope, { id: snapshotId, ...profile, capabilities: ['text'], now });
        this.repository.insertAgent(scope, { id: agentId, roleTemplateId: contract.roleTemplateId, name: contract.memberName,
          modelSnapshotId: snapshotId, activationState: contract.defaultActivation === 'resident' ? 'idle' : 'standby', now });
        this.repository.insertBinding(scope, { id: this.ids.next(), revisionId, roleKey: contract.roleKey, agentId, snapshotId,
          provider: profile.provider, modelId: profile.modelId, plan: profile.plan, purposes: contract.outputKinds, now });
        if (options.failureAfter === index + 1) throw new Error('simulated-team-v2-creation-failure');
      });
      this.repository.insertTeamSnapshot(scope, { id: this.ids.next(), contractsJson,
        hash: createHash('sha256').update(contractsJson).digest('hex'), now });
      return this.repository.listTeam(scope);
    });
  }
}
