import type { DatabaseSync } from 'node:sqlite';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { roleDefinitions, type RoleKey } from '../../domain/roles.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { RoleModelProfile } from '../../infrastructure/models/model-runtime-config.js';
import type { CreativeRoleKey } from '../../contracts/agent-team-v2.js';

export interface AgentRecord {
  agentId: string;
  roleTemplateId: string;
  roleKey: RoleKey | CreativeRoleKey;
  roleName: string;
  category: 'core' | 'specialist';
  displayName: string;
  provider: string;
  modelId: string;
  capabilities: string[];
  activationState: 'idle' | 'standby' | 'paused' | 'disabled';
}

interface AgentRow {
  agent_id: string;
  role_template_id: string;
  role_key: RoleKey | CreativeRoleKey;
  role_name: string;
  category: AgentRecord['category'];
  display_name: string;
  provider: string;
  model_id: string;
  capabilities_json: string;
  activation_state: AgentRecord['activationState'];
}

export class AgentTeamService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roleProfiles?: Record<RoleKey, RoleModelProfile>
  ) {}

  public seedRoleTemplates(): void {
    const now = this.clock.now().toISOString();
    const insert = this.database.prepare(`
      INSERT INTO role_templates (
        role_template_id, version, role_key, display_name, category,
        responsibilities_json, required_capabilities_json, default_activation, created_at
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(role_template_id, version) DO NOTHING
    `);
    for (const role of roleDefinitions) {
      insert.run(
        role.roleTemplateId,
        role.roleKey,
        role.displayName,
        role.category,
        JSON.stringify(role.responsibilities),
        JSON.stringify(role.requiredCapabilities),
        role.defaultActivation,
        now
      );
    }
  }

  public createTeam(scope: BookScope, injectFailureAfter?: number): AgentRecord[] {
    assertBookScope(scope);
    this.seedRoleTemplates();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.insertTeamWithinTransaction(scope, injectFailureAfter);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return this.list(scope);
  }

  public insertTeamWithinTransaction(scope: BookScope, injectFailureAfter?: number): void {
    assertBookScope(scope);
    const now = this.clock.now().toISOString();
    roleDefinitions.forEach((role, index) => {
      const snapshotId = this.ids.next();
      const agentId = this.ids.next();
      const capabilities = role.requiredCapabilities.includes('research') ? ['text'] : ['text'];
      const profile = this.roleProfiles?.[role.roleKey] ?? {
        provider: 'local-deterministic',
        modelId: 'wenmi-fixture-v1',
        plan: 'deterministic' as const
      };
      this.database.prepare(`
        INSERT INTO model_config_snapshots (
          model_snapshot_id, owner_id, book_id, provider, model_id,
          parameters_json, capabilities_json, validated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        snapshotId,
        scope.ownerId,
        scope.bookId,
        profile.provider,
        profile.modelId,
        JSON.stringify({
          plan: profile.plan,
          strictSubscriptionOnly: profile.plan !== 'deterministic',
          cashFallbackAllowed: false,
          cashCostCny: 0
        }),
        JSON.stringify(capabilities),
        now,
        now
      );
      this.database.prepare(`
        INSERT INTO agent_instances (
          agent_id, owner_id, book_id, role_template_id, role_template_version,
          display_name, model_snapshot_id, permissions_json, enabled,
          activation_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        agentId,
        scope.ownerId,
        scope.bookId,
        role.roleTemplateId,
        role.memberName,
        snapshotId,
        JSON.stringify({ bookScoped: true, tools: [], network: false }),
        role.defaultActivation === 'resident' ? 'idle' : 'standby',
        now,
        now
      );
      if (injectFailureAfter === index + 1) throw new Error('simulated-team-creation-failure');
    });
  }

  public list(scope: BookScope): AgentRecord[] {
    assertBookScope(scope);
    const rows = this.database.prepare(`
      SELECT a.agent_id, a.role_template_id, r.role_key, r.display_name AS role_name,
             r.category, a.display_name, m.provider, m.model_id,
             m.capabilities_json, a.activation_state
      FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.enabled = 1
        AND (a.role_template_version = 2 OR NOT EXISTS (
          SELECT 1 FROM agent_instances current_team
          WHERE current_team.owner_id = a.owner_id AND current_team.book_id = a.book_id
            AND current_team.role_template_version = 2 AND current_team.enabled = 1
        ))
      ORDER BY CASE r.role_key
        WHEN 'chief_editor' THEN 1
        WHEN 'deputy_editor' THEN 2
        WHEN 'lead_screenwriter' THEN 3
        WHEN 'second_screenwriter' THEN 4
        WHEN 'plot_architect' THEN 4
        WHEN 'third_screenwriter' THEN 5
        WHEN 'setting' THEN 6
        WHEN 'continuity' THEN 6
        WHEN 'lead_writer' THEN 7
        WHEN 'writer' THEN 7
        WHEN 'backup_writer' THEN 8
        WHEN 'fact_reviewer' THEN 9
        WHEN 'literary_reviewer' THEN 10
        WHEN 'reviewer' THEN 10
        WHEN 'experience_reviewer' THEN 11
        WHEN 'reader_experience' THEN 11
        WHEN 'experience_challenger' THEN 12
        WHEN 'style_editor' THEN 13
        WHEN 'researcher' THEN 13
        WHEN 'copyright' THEN 14
        ELSE 15 END
    `).all(scope.ownerId, scope.bookId) as unknown as AgentRow[];
    return rows.map((row) => ({
      agentId: row.agent_id,
      roleTemplateId: row.role_template_id,
      roleKey: row.role_key,
      roleName: row.role_name,
      category: row.category,
      displayName: row.display_name,
      provider: row.provider,
      modelId: row.model_id,
      capabilities: JSON.parse(row.capabilities_json) as string[],
      activationState: row.activation_state
    }));
  }

  public activate(scope: BookScope, agentId: string, requiredCapability: string): AgentRecord {
    const agent = this.list(scope).find((candidate) => candidate.agentId === agentId);
    if (agent === undefined) throw new Error('Agent不存在或不属于当前书籍');
    if (!agent.capabilities.includes(requiredCapability)) {
      throw new DomainError(errorCodes.agentCapabilityUnavailable, '运行时能力不可用', { requiredCapability }, false, 409);
    }
    this.database.prepare(`
      UPDATE agent_instances SET activation_state = 'idle', updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND agent_id = ?
    `).run(this.clock.now().toISOString(), scope.ownerId, scope.bookId, agentId);
    return this.list(scope).find((candidate) => candidate.agentId === agentId)!;
  }

  public assertIndependentReview(executor: AgentRecord, reviewer: AgentRecord): void {
    if (executor.provider === reviewer.provider && executor.modelId === reviewer.modelId) {
      throw new DomainError(errorCodes.independentReviewRequired, '执行者与复核者必须使用真实不同模型，不能用同一模型伪装独立成员', {
        executorModel: `${executor.provider}/${executor.modelId}`,
        reviewerModel: `${reviewer.provider}/${reviewer.modelId}`
      }, false, 409);
    }
  }
}
