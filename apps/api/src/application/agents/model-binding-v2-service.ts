import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { creativeRoleKeys, deterministicTeamProfile, type CreativeRoleKey, type TeamModelProfile } from '../../contracts/agent-team-v2.js';
import type { AgentGovernanceRepository, TeamAgentRow } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

export class ModelBindingV2Service {
  public constructor(
    private readonly repository: AgentGovernanceRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly runtimeMode?: 'deterministic' | 'subscription-plan'
  ) {}

  public validate(profiles: Record<CreativeRoleKey, TeamModelProfile>): void {
    validateTeamModelProfiles(profiles, this.runtimeMode);
  }

  public reviseFuture(scope: BookScope, profiles: Record<CreativeRoleKey, TeamModelProfile>, reason: string): number {
    this.validate(profiles);
    const agents = this.repository.listTeam(scope);
    const now = this.clock.now().toISOString();
    const version = this.repository.nextBindingVersion(scope);
    this.unitOfWork.run(() => {
      const revisionId = this.ids.next();
      this.repository.insertBindingRevision(scope, { id: revisionId, version, effectiveFrom: now, reason, now });
      for (const agent of agents) {
        const role = agent.roleKey as CreativeRoleKey;
        const profile = profiles[role] ?? deterministicTeamProfile;
        const snapshotId = this.ids.next();
        this.repository.insertModelSnapshot(scope, { id: snapshotId, ...profile, capabilities: ['text'], now });
        this.repository.insertBinding(scope, { id: this.ids.next(), revisionId, roleKey: role, agentId: agent.agentId, snapshotId,
          provider: profile.provider, modelId: profile.modelId, plan: profile.plan, purposes: [], now });
        this.repository.updateAgentModelSnapshot(scope, agent.agentId, snapshotId, now);
        if (role === 'lead_writer') this.repository.supersedeWriterSelections(scope, snapshotId);
      }
    });
    return version;
  }

  public restoreFuture(scope: BookScope, revisionId: string, reason: string): number {
    const historical = this.repository.revisionBindings(scope, revisionId);
    if (historical.length === 0) throw new Error('待恢复的模型绑定修订不存在或不属于当前书籍');
    const profiles = Object.fromEntries(historical.map((binding) => [binding.roleKey, {
      provider: binding.provider,
      modelId: binding.modelId,
      plan: binding.plan ?? 'deterministic'
    }])) as Record<CreativeRoleKey, TeamModelProfile>;
    return this.reviseFuture(scope, profiles, reason);
  }
}

export function validateTeamModelProfiles(
  profiles: Record<CreativeRoleKey, TeamModelProfile>,
  runtimeMode?: 'deterministic' | 'subscription-plan'
): void {
    const plans = creativeRoleKeys.map((role) => profiles[role]?.plan);
    if (plans.some((plan) => plan === undefined)) throw new Error('模型绑定缺少创作岗位配置');
    if (runtimeMode === 'subscription-plan' && plans.some((plan) => plan === 'deterministic')) {
      throw new Error('真实套餐模式不能激活确定性假模型绑定');
    }
    if (runtimeMode === 'deterministic' && plans.some((plan) => plan !== 'deterministic')) {
      throw new Error('确定性模式不能激活需要真实套餐凭证的模型绑定');
    }
    const signature = (role: CreativeRoleKey): string => `${profiles[role].provider}/${profiles[role].modelId}`;
    if (signature('lead_screenwriter') === signature('second_screenwriter')) throw new Error('两名编剧必须使用不同模型');
    for (const role of ['lead_screenwriter', 'second_screenwriter'] as const) {
      if (/doubao/iu.test(profiles[role].modelId)) throw new Error('豆包不能进入剧情讨论席');
    }
    for (const role of ['lead_writer', 'backup_writer'] as const) {
      if (profiles[role].plan !== 'deterministic' && !/(deepseek-v4-pro|kimi-k2\.7-code)/iu.test(profiles[role].modelId)) {
        throw new Error('写手仅允许火山方舟 Agent Plan 的 DeepSeek V4 Pro 或 Kimi K2.7 Code');
      }
      const factRole: CreativeRoleKey = /glm/iu.test(profiles[role].modelId) ? 'lead_screenwriter' : 'setting';
      const reviewSignatures = [signature(role), signature(factRole), signature('literary_reviewer'), signature('experience_reviewer')];
      if (new Set(reviewSignatures).size !== reviewSignatures.length) {
        throw new Error(`${role === 'lead_writer' ? '主笔' : '副笔'}与事实、文学、体验三席必须使用四个不同模型来源`);
      }
    }
}

export class ReviewModelCompatibilityService {
  public select(activeWriter: TeamAgentRow, team: TeamAgentRow[]): { fact: TeamAgentRow; literary: TeamAgentRow; experience: TeamAgentRow } {
    const signature = (agent: TeamAgentRow): string => `${agent.provider}/${agent.modelId}`;
    const byRole = (role: string): TeamAgentRow => {
      const found = team.find((agent) => agent.roleKey === role);
      if (found === undefined) throw new Error(`缺少点评岗位：${role}`);
      return found;
    };
    const fact = /glm/iu.test(activeWriter.modelId) ? byRole('lead_screenwriter') : byRole('setting');
    const literary = byRole('literary_reviewer');
    const experience = byRole('experience_reviewer');
    const all = [activeWriter, fact, literary, experience].map(signature);
    if (new Set(all).size !== all.length) throw new Error('三名点评者必须彼此异模型并与活动写手异模型');
    return { fact, literary, experience };
  }
}
