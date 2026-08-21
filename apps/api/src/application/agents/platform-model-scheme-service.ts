import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { DomainError } from '../../domain/errors.js';
import {
  creativeMemberContracts, creativeRoleKeys, roleModelProfiles,
  type CreativeRoleKey, type TeamModelProfile
} from '../../contracts/agent-team-v2.js';
import type { NovelRoleKey, RoleModelProfile } from '../../infrastructure/models/model-runtime-config.js';
import { AgentGovernanceRepository } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { ModelBindingV2Service, validateTeamModelProfiles } from './model-binding-v2-service.js';

const SCHEME_ROW_ID = 'current';

export interface AllowedModelProfile {
  provider: string;
  modelId: string;
  plan: string;
}

export interface PlatformSchemeDescription {
  source: 'custom' | 'default';
  updatedAt: string | null;
  updatedBy: string | null;
  profiles: Record<CreativeRoleKey, TeamModelProfile>;
  allowedModels: AllowedModelProfile[];
  members: Array<{ roleKey: CreativeRoleKey; memberName: string; shortTitle: string }>;
}

export interface SchemeConvergenceResult {
  booksVisited: number;
  revisedBooks: number;
  updatedAgents: number;
}

/**
 * 平台级模型方案：管理员在后台调整"哪个岗位用哪个模型"，保存后新书写入与
 * 存量书未来任务统一收敛到该方案；历史调用快照与在途任务冻结快照不受影响。
 */
export class PlatformModelSchemeService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly runtimeMode?: 'deterministic' | 'subscription-plan'
  ) {}

  public storedProfiles(): Record<CreativeRoleKey, TeamModelProfile> | null {
    const row = this.database.prepare(`
      SELECT profiles_json FROM platform_model_scheme WHERE scheme_id = ?
    `).get(SCHEME_ROW_ID) as { profiles_json: string } | undefined;
    if (row === undefined) return null;
    const parsed = JSON.parse(row.profiles_json) as Record<CreativeRoleKey, TeamModelProfile>;
    return creativeRoleKeys.every((role) => parsed[role] !== undefined) ? parsed : null;
  }

  public currentProfiles(fallback: Record<CreativeRoleKey, TeamModelProfile>): Record<CreativeRoleKey, TeamModelProfile> {
    const stored = this.storedProfiles();
    if (stored === null) return fallback;
    const followsCurrentCredentialRouting = creativeRoleKeys.every((role) => {
      const profile = stored[role];
      return role === 'senior_screenwriter'
        ? profile.provider === 'volcengine-ark-agent-plan' && profile.plan === 'agent' && /kimi-k3/iu.test(profile.modelId)
        : profile.provider === 'volcengine-ark-coding-plan' && profile.plan === 'coding';
    });
    return followsCurrentCredentialRouting ? stored : fallback;
  }

  public allowedModels(roleProfiles: Record<NovelRoleKey, RoleModelProfile>): AllowedModelProfile[] {
    const seen = new Map<string, AllowedModelProfile>();
    for (const profile of [...Object.values(roleModelProfiles), ...Object.values(roleProfiles)]) {
      if (!profile.provider.startsWith('volcengine-ark')) continue;
      seen.set(`${profile.provider}/${profile.modelId}`, { provider: profile.provider, modelId: profile.modelId, plan: profile.plan });
    }
    return [...seen.values()];
  }

  public describe(roleProfiles: Record<NovelRoleKey, RoleModelProfile>, fallback: Record<CreativeRoleKey, TeamModelProfile>): PlatformSchemeDescription {
    const row = this.database.prepare(`
      SELECT updated_by_user_id, updated_at FROM platform_model_scheme WHERE scheme_id = ?
    `).get(SCHEME_ROW_ID) as { updated_by_user_id: string | null; updated_at: string } | undefined;
    return {
      source: row === undefined ? 'default' : 'custom',
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by_user_id ?? null,
      profiles: this.currentProfiles(fallback),
      allowedModels: this.allowedModels(roleProfiles),
      members: creativeMemberContracts.map((member) => ({
        roleKey: member.roleKey, memberName: member.memberName, shortTitle: member.shortTitle
      }))
    };
  }

  public save(
    actorUserId: string,
    input: unknown,
    roleProfiles: Record<NovelRoleKey, RoleModelProfile>,
    reason?: string
  ): { updatedAt: string; convergence: SchemeConvergenceResult } {
    const profiles = this.normalizeProfiles(input, roleProfiles);
    try {
      validateTeamModelProfiles(profiles, this.runtimeMode);
    } catch (error) {
      throw new DomainError('MODEL_SCHEME_INVALID', error instanceof Error ? error.message : '模型方案不符合团队规则', {}, false, 400);
    }
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO platform_model_scheme (scheme_id, profiles_json, updated_by_user_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (scheme_id) DO UPDATE SET profiles_json = excluded.profiles_json,
        updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at
    `).run(SCHEME_ROW_ID, JSON.stringify(profiles), actorUserId, now);
    const convergence = this.convergeAllBooks(
      profiles,
      reason?.trim() || '管理后台调整全员模型方案；保留历史快照，只影响未来任务'
    );
    return { updatedAt: now, convergence };
  }

  /** 把存量 V2 书籍的未来任务收敛到指定方案；绑定一致的书跳过，历史修订全部保留。 */
  public convergeAllBooks(profiles: Record<CreativeRoleKey, TeamModelProfile>, reason: string): SchemeConvergenceResult {
    const v2Books = this.database.prepare(`
      SELECT DISTINCT a.owner_id, a.book_id
      FROM agent_instances a JOIN books b ON b.owner_id = a.owner_id AND b.book_id = a.book_id
      WHERE a.role_template_version = 2 AND a.enabled = 1 AND b.status <> 'purged'
      ORDER BY a.owner_id, a.book_id
    `).all() as unknown as Array<{ owner_id: string; book_id: string }>;
    let revisedBooks = 0;
    let updatedAgents = 0;
    for (const book of v2Books) {
      const scope = { ownerId: book.owner_id, bookId: book.book_id };
      const repository = new AgentGovernanceRepository(this.database);
      const current = repository.listTeam(scope);
      const requiresRevision = creativeRoleKeys.some((role) => {
        const agent = current.find((item) => item.roleKey === role);
        return agent === undefined || agent.provider !== profiles[role].provider || agent.modelId !== profiles[role].modelId;
      });
      if (!requiresRevision) continue;
      new ModelBindingV2Service(repository, new UnitOfWork(this.database), this.ids, this.clock, this.runtimeMode)
        .reviseFuture(scope, profiles, reason);
      revisedBooks += 1;
      updatedAgents += creativeRoleKeys.length;
    }
    return { booksVisited: v2Books.length, revisedBooks, updatedAgents };
  }

  private normalizeProfiles(input: unknown, roleProfiles: Record<NovelRoleKey, RoleModelProfile>): Record<CreativeRoleKey, TeamModelProfile> {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new DomainError('MODEL_SCHEME_INVALID', '模型方案格式不正确', {}, false, 400);
    }
    const allowed = new Map(this.allowedModels(roleProfiles).map((profile) => [`${profile.provider}/${profile.modelId}`, profile]));
    const body = input as Record<string, unknown>;
    const profiles = {} as Record<CreativeRoleKey, TeamModelProfile>;
    for (const role of creativeRoleKeys) {
      const value = body[role];
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new DomainError('MODEL_SCHEME_INVALID', '模型方案缺少岗位配置', {}, false, 400);
      }
      const candidate = value as Record<string, unknown>;
      const provider = typeof candidate.provider === 'string' ? candidate.provider : '';
      const modelId = typeof candidate.modelId === 'string' ? candidate.modelId : '';
      const pair = allowed.get(`${provider}/${modelId}`);
      if (pair === undefined) {
        throw new DomainError('MODEL_SCHEME_INVALID', '所选模型不在可选范围内', {}, false, 400);
      }
      profiles[role] = { provider: pair.provider, modelId: pair.modelId, plan: pair.plan as TeamModelProfile['plan'] };
    }
    return profiles;
  }
}
