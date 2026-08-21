import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { creativeMemberContracts, deterministicTeamProfile, type CreativeRoleKey, type TeamModelProfile } from '../../contracts/agent-team-v2.js';
import type { AgentGovernanceRepository, TeamAgentRow } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { validateTeamModelProfiles } from './model-binding-v2-service.js';

export class TeamTemplateService {
  public constructor(
    private readonly repository: AgentGovernanceRepository, private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator, private readonly clock: Clock
  ) {}

  public createTeam(scope: BookScope, options: { deterministic?: boolean; profiles?: Partial<Record<CreativeRoleKey, TeamModelProfile>> | undefined; failureAfter?: number } = {}): TeamAgentRow[] {
    const now = this.clock.now().toISOString();
    const profiles = Object.fromEntries(creativeMemberContracts.map((contract) => [contract.roleKey,
      options.deterministic === true
        ? { ...deterministicTeamProfile, modelId: `wenmi-fixture-v2-${contract.roleKey}` }
        : options.profiles?.[contract.roleKey] ?? contract.defaultModel
    ])) as Record<CreativeRoleKey, TeamModelProfile>;
    validateTeamModelProfiles(profiles, options.deterministic === true ? 'deterministic' : undefined);
    return this.unitOfWork.run(() => {
      const contractsJson = JSON.stringify(creativeMemberContracts);
      const revisionId = this.ids.next();
      this.repository.insertBindingRevision(scope, { id: revisionId, version: this.repository.nextBindingVersion(scope), effectiveFrom: now, reason: '创建十五人创作团队', now });
      creativeMemberContracts.forEach((contract, index) => {
        this.repository.seedRole({ roleTemplateId: contract.roleTemplateId, roleKey: contract.roleKey, shortTitle: contract.shortTitle,
          category: contract.category, responsibilities: contract.responsibilities, capabilities: ['text'], activation: contract.defaultActivation, now });
        const profile = profiles[contract.roleKey];
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

  /** 为编制扩充前的旧书补齐缺失成员（例如 11 人书补齐编剧C、事实审查、体验·挑剔读者）。 */
  public addMissingMembers(scope: BookScope, options: { deterministic?: boolean; profiles?: Partial<Record<CreativeRoleKey, TeamModelProfile>> | undefined } = {}): { added: CreativeRoleKey[]; team: TeamAgentRow[] } {
    const existing = this.repository.listTeam(scope);
    const existingKeys = new Set(existing.map((member) => member.roleKey));
    const missing = creativeMemberContracts.filter((contract) => !existingKeys.has(contract.roleKey));
    if (missing.length === 0) return { added: [], team: existing };
    const deterministic = options.deterministic === true
      || existing.every((member) => member.plan === 'deterministic');
    const now = this.clock.now().toISOString();
    const signatureOf = (provider: string, modelId: string): string => `${provider}/${modelId}`;
    const addedProfiles = new Map<CreativeRoleKey, TeamModelProfile>();
    for (const contract of missing) {
      const profile = deterministic
        ? { ...deterministicTeamProfile, modelId: `wenmi-fixture-v2-${contract.roleKey}` }
        : options.profiles?.[contract.roleKey] ?? contract.defaultModel;
      addedProfiles.set(contract.roleKey, profile);
    }
    if (!deterministic) {
      // 异模型独立性只约束编剧组（四名编剧两两异模型且禁豆包）；
      // 主编、设定、审查等其他岗位允许共享模型（如主编与编剧C同为 K2.7、
      // 编剧B与事实审查同为 GLM），全队唯一性不是设计要求。
      const screenwriterKeys = new Set(['lead_screenwriter', 'second_screenwriter', 'third_screenwriter', 'senior_screenwriter']);
      const screenwriterSignatures = new Set(
        existing
          .filter((member) => screenwriterKeys.has(member.roleKey))
          .map((member) => signatureOf(member.provider, member.modelId))
      );
      for (const contract of missing) {
        const profile = addedProfiles.get(contract.roleKey)!;
        if (/doubao/iu.test(profile.modelId) && contract.roleKey.endsWith('screenwriter')) {
          throw new Error('豆包不能进入剧情讨论席');
        }
        if (screenwriterKeys.has(contract.roleKey)) {
          const signature = signatureOf(profile.provider, profile.modelId);
          if (screenwriterSignatures.has(signature)) {
            throw new Error(`补齐编剧${contract.memberName}与其他编剧模型重复，无法保证多编剧异模型独立性`);
          }
          screenwriterSignatures.add(signature);
        }
      }
    }
    const team = this.unitOfWork.run(() => {
      const revisionId = this.ids.next();
      this.repository.insertBindingRevision(scope, { id: revisionId, version: this.repository.nextBindingVersion(scope), effectiveFrom: now, reason: '补齐十五人创作团队', now });
      for (const contract of missing) {
        this.repository.seedRole({ roleTemplateId: contract.roleTemplateId, roleKey: contract.roleKey, shortTitle: contract.shortTitle,
          category: contract.category, responsibilities: contract.responsibilities, capabilities: ['text'], activation: contract.defaultActivation, now });
        const profile = addedProfiles.get(contract.roleKey)!;
        const snapshotId = this.ids.next();
        const agentId = this.ids.next();
        this.repository.insertModelSnapshot(scope, { id: snapshotId, ...profile, capabilities: ['text'], now });
        this.repository.insertAgent(scope, { id: agentId, roleTemplateId: contract.roleTemplateId, name: contract.memberName,
          modelSnapshotId: snapshotId, activationState: contract.defaultActivation === 'resident' ? 'idle' : 'standby', now });
        this.repository.insertBinding(scope, { id: this.ids.next(), revisionId, roleKey: contract.roleKey, agentId, snapshotId,
          provider: profile.provider, modelId: profile.modelId, plan: profile.plan, purposes: contract.outputKinds, now });
      }
      return this.repository.listTeam(scope);
    });
    return { added: missing.map((contract) => contract.roleKey), team };
  }

  /**
   * 修复存量书籍：设定成员与编剧B绑定了同一模型时，提案三席无法保证各自独立出方案。
   * 把设定岗位的未来绑定改为指定配置（当前为 Kimi K2.7 Code）；只影响之后的新任务，
   * 运行中的任务继续使用已冻结模型快照。返回是否做了修复。
   */
  public repairSettingSeatModel(scope: BookScope, profile: TeamModelProfile): boolean {
    const team = this.repository.listTeam(scope);
    const setting = team.find((member) => member.roleKey === 'setting');
    const second = team.find((member) => member.roleKey === 'second_screenwriter');
    if (setting === undefined || second === undefined) return false;
    if (`${setting.provider}/${setting.modelId}` !== `${second.provider}/${second.modelId}`) return false;
    const now = this.clock.now().toISOString();
    this.unitOfWork.run(() => {
      const revisionId = this.ids.next();
      this.repository.insertBindingRevision(scope, {
        id: revisionId, version: this.repository.nextBindingVersion(scope), effectiveFrom: now,
        reason: '设定成员改用独立模型，恢复团队各自出方案', now
      });
      const snapshotId = this.ids.next();
      this.repository.insertModelSnapshot(scope, { id: snapshotId, ...profile, capabilities: ['text'], now });
      this.repository.insertBinding(scope, {
        id: this.ids.next(), revisionId, roleKey: 'setting', agentId: setting.agentId, snapshotId,
        provider: profile.provider, modelId: profile.modelId, plan: profile.plan, purposes: [], now
      });
      this.repository.updateAgentModelSnapshot(scope, setting.agentId, snapshotId, now);
    });
    return true;
  }
}
