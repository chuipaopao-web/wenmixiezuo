import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import type { RoleModelProfile } from '../../infrastructure/models/model-runtime-config.js';
import { AgentGovernanceRepository } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { creativeRoleKeys, type CreativeRoleKey, type TeamModelProfile } from '../../contracts/agent-team-v2.js';
import { ModelBindingV2Service } from './model-binding-v2-service.js';

interface AgentBindingRow {
  agent_id: string;
  owner_id: string;
  book_id: string;
  role_key: RoleKey;
  model_snapshot_id: string;
  provider: string;
  model_id: string;
  capabilities_json: string;
}

export interface ModelBindingResult {
  booksVisited: number;
  updatedAgents: number;
  supersededWriterSelections: number;
}

/**
 * Binds existing books to a new role/model policy without mutating historical
 * model snapshots. Existing calls and chapter runs therefore remain auditable.
 */
export class ModelBindingService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roleProfiles: Record<RoleKey, RoleModelProfile>
  ) {}

  public bindAllBooks(options: {
    preserveActiveRevision?: boolean;
    migrateDeputyEditorToAgentPlan?: boolean;
    migrateAllMembersToAgentPlan?: boolean;
  } = {}): ModelBindingResult {
    const v2Books = this.database.prepare(`
      SELECT DISTINCT a.owner_id, a.book_id
      FROM agent_instances a JOIN books b ON b.owner_id = a.owner_id AND b.book_id = a.book_id
      WHERE a.role_template_version = 2 AND a.enabled = 1 AND b.status <> 'purged'
      ORDER BY a.owner_id, a.book_id
    `).all() as unknown as Array<{ owner_id: string; book_id: string }>;
    const creativeProfiles = toCreativeProfiles(this.roleProfiles);
    const agentPlanPolicyActive = creativeRoleKeys.every((role) =>
      creativeProfiles[role].provider === 'volcengine-ark-agent-plan'
      && creativeProfiles[role].plan === 'agent'
    );
    let updatedV2Agents = 0;
    let supersededV2WriterSelections = 0;
    for (const book of v2Books) {
      const scope = { ownerId: book.owner_id, bookId: book.book_id };
      const repository = new AgentGovernanceRepository(this.database);
      const current = repository.listTeam(scope);
      const hasActiveRevision = this.database.prepare(`
        SELECT 1 FROM agent_model_binding_revisions
        WHERE owner_id = ? AND book_id = ? AND status = 'active'
        LIMIT 1
      `).get(scope.ownerId, scope.bookId) !== undefined;
      const currentDeputy = current.find((item) => item.roleKey === 'deputy_editor');
      const migrateDeputyEditorToAgentPlan = options.migrateDeputyEditorToAgentPlan === true
        && hasActiveRevision
        && currentDeputy !== undefined
        && (currentDeputy.provider !== creativeProfiles.deputy_editor.provider
          || currentDeputy.modelId !== creativeProfiles.deputy_editor.modelId);
      const migrateAllMembersToAgentPlan = options.migrateAllMembersToAgentPlan === true
        && hasActiveRevision
        && agentPlanPolicyActive;
      if (options.preserveActiveRevision === true && hasActiveRevision && !migrateDeputyEditorToAgentPlan && !migrateAllMembersToAgentPlan) continue;
      const targetProfiles = migrateAllMembersToAgentPlan
        ? creativeProfiles
        : migrateDeputyEditorToAgentPlan
        ? preserveCurrentProfilesWithDeputyMigration(current, creativeProfiles.deputy_editor)
        : creativeProfiles;
      const requiresRevision = creativeRoleKeys.some((role) => {
        const agent = current.find((item) => item.roleKey === role);
        const profile = targetProfiles[role];
        return agent === undefined || agent.provider !== profile.provider || agent.modelId !== profile.modelId;
      });
      if (requiresRevision) {
        const currentWriter = current.find((item) => item.roleKey === 'lead_writer');
        if (currentWriter === undefined || currentWriter.provider !== targetProfiles.lead_writer.provider || currentWriter.modelId !== targetProfiles.lead_writer.modelId) {
          supersededV2WriterSelections += repository.activeWriterSelectionCount(scope);
        }
        new ModelBindingV2Service(repository, new UnitOfWork(this.database), this.ids, this.clock)
          .reviseFuture(
            scope,
            targetProfiles,
            migrateAllMembersToAgentPlan
              ? 'DEC-099：十一名创作成员统一迁移至火山方舟 Agent Plan；保留历史调用快照，只影响未来任务'
              : migrateDeputyEditorToAgentPlan
              ? 'DEC-076：副编调整为火山方舟 Agent Plan GLM 5.2；只影响未来任务'
              : '运行时模型策略更新；只影响未来任务'
          );
        updatedV2Agents += creativeRoleKeys.length;
      }
    }
    const rows = this.database.prepare(`
      SELECT a.agent_id, a.owner_id, a.book_id, r.role_key,
             a.model_snapshot_id, m.provider, m.model_id, m.capabilities_json
      FROM agent_instances a
      JOIN books b ON b.owner_id = a.owner_id AND b.book_id = a.book_id
      JOIN role_templates r
        ON r.role_template_id = a.role_template_id
       AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE b.status <> 'purged' AND a.role_template_version = 1 AND a.enabled = 1
      ORDER BY a.owner_id, a.book_id, r.role_key
    `).all() as unknown as AgentBindingRow[];

    const books = new Set(rows.map((row) => `${row.owner_id}\n${row.book_id}`));
    let updatedAgents = 0;
    let supersededWriterSelections = 0;
    const now = this.clock.now().toISOString();

    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const profile = this.roleProfiles[legacyProfileRole(row.role_key as string)];
        if (row.provider === profile.provider && row.model_id === profile.modelId) continue;
        const snapshotId = this.ids.next();
        this.database.prepare(`
          INSERT INTO model_config_snapshots (
            model_snapshot_id, owner_id, book_id, provider, model_id,
            parameters_json, capabilities_json, validated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          snapshotId,
          row.owner_id,
          row.book_id,
          profile.provider,
          profile.modelId,
          JSON.stringify({
            plan: profile.plan,
            strictSubscriptionOnly: profile.plan !== 'deterministic',
            cashFallbackAllowed: false,
            cashCostCny: 0
          }),
          row.capabilities_json,
          now,
          now
        );
        this.database.prepare(`
          UPDATE agent_instances
          SET model_snapshot_id = ?, updated_at = ?
          WHERE agent_id = ? AND owner_id = ? AND book_id = ?
        `).run(snapshotId, now, row.agent_id, row.owner_id, row.book_id);
        updatedAgents += 1;

        if (row.role_key === 'writer' || row.role_key as string === 'lead_writer') {
          const result = this.database.prepare(`
            UPDATE writer_selections
            SET status = 'superseded'
            WHERE owner_id = ? AND book_id = ? AND status = 'selected'
              AND selected_model_snapshot_id <> ?
          `).run(row.owner_id, row.book_id, snapshotId);
          supersededWriterSelections += Number(result.changes);
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    return {
      booksVisited: new Set([...books, ...v2Books.map((row) => `${row.owner_id}\n${row.book_id}`)]).size,
      updatedAgents: updatedAgents + updatedV2Agents,
      supersededWriterSelections: supersededWriterSelections + supersededV2WriterSelections
    };
  }
}

function toCreativeProfiles(profiles: Record<RoleKey, RoleModelProfile>): Record<CreativeRoleKey, TeamModelProfile> {
  const profile = (role: CreativeRoleKey, value: RoleModelProfile): TeamModelProfile => value.plan === 'deterministic'
    ? { ...value, modelId: `wenmi-fixture-v2-${role}` }
    : value;
  return {
    chief_editor: profile('chief_editor', profiles.chief_editor),
    deputy_editor: profile('deputy_editor', profiles.reviewer),
    lead_screenwriter: profile('lead_screenwriter', profiles.plot_architect),
    second_screenwriter: profile('second_screenwriter', profiles.continuity),
    setting: profile('setting', profiles.style_editor),
    lead_writer: profile('lead_writer', profiles.writer),
    backup_writer: profile('backup_writer', profiles.chief_editor),
    literary_reviewer: profile('literary_reviewer', profiles.reviewer),
    experience_reviewer: profile('experience_reviewer', profiles.reader_experience),
    researcher: profile('researcher', profiles.researcher),
    copyright: profile('copyright', profiles.copyright)
  };
}

function preserveCurrentProfilesWithDeputyMigration(
  current: Array<{ roleKey: string; provider: string; modelId: string; plan?: string }>,
  deputyEditor: TeamModelProfile
): Record<CreativeRoleKey, TeamModelProfile> {
  const profiles = Object.fromEntries(current.map((agent) => [agent.roleKey, {
    provider: agent.provider,
    modelId: agent.modelId,
    plan: agent.plan ?? 'deterministic'
  }])) as Partial<Record<CreativeRoleKey, TeamModelProfile>>;
  if (creativeRoleKeys.some((role) => profiles[role] === undefined)) {
    throw new Error('副编模型迁移前发现十一人团队配置不完整');
  }
  profiles.deputy_editor = deputyEditor;
  return profiles as Record<CreativeRoleKey, TeamModelProfile>;
}

function legacyProfileRole(roleKey: string): RoleKey {
  const aliases: Record<string, RoleKey> = {
    chief_editor: 'chief_editor', deputy_editor: 'reviewer', lead_screenwriter: 'plot_architect',
    second_screenwriter: 'continuity', setting: 'style_editor', lead_writer: 'writer', backup_writer: 'chief_editor',
    literary_reviewer: 'reviewer', experience_reviewer: 'reader_experience', researcher: 'researcher', copyright: 'copyright',
    plot_architect: 'plot_architect', continuity: 'continuity', writer: 'writer', reviewer: 'reviewer',
    reader_experience: 'reader_experience', style_editor: 'style_editor'
  };
  const mapped = aliases[roleKey];
  if (mapped === undefined) throw new Error(`未配置的岗位模型绑定：${roleKey}`);
  return mapped;
}
