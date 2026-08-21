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
    migrateDeputyEditorToCurrentPlan?: boolean;
    migrateAllMembersToCurrentPlan?: boolean;
    creativeProfilesOverride?: Record<CreativeRoleKey, TeamModelProfile>;
  } = {}): ModelBindingResult {
    const v2Books = this.database.prepare(`
      SELECT DISTINCT a.owner_id, a.book_id
      FROM agent_instances a JOIN books b ON b.owner_id = a.owner_id AND b.book_id = a.book_id
      WHERE a.role_template_version = 2 AND a.enabled = 1 AND b.status <> 'purged'
      ORDER BY a.owner_id, a.book_id
    `).all() as unknown as Array<{ owner_id: string; book_id: string }>;
    const creativeProfiles = options.creativeProfilesOverride ?? toCreativeProfiles(this.roleProfiles);
    // “订阅策略激活”涵盖火山方舟 Agent Plan 与 Coding Plan（opencodego 已下线）：
    // 只要全岗位统一走订阅来源，就把存量 V2 书籍一并迁移到该来源，避免保留旧绑定；
    // 停用 MiniMax M3 后，存量书的三席旧绑定也经此路径自动重绑。
    const subscriptionPolicyActive = creativeRoleKeys.every((role) =>
      (creativeProfiles[role].provider === 'volcengine-ark-agent-plan' && creativeProfiles[role].plan === 'agent')
      || (creativeProfiles[role].provider === 'volcengine-ark-coding-plan' && creativeProfiles[role].plan === 'coding')
      || (creativeProfiles[role].provider === 'opencodego' && creativeProfiles[role].plan === 'opencodego')
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
      const migrateDeputyEditorToCurrentPlan = options.migrateDeputyEditorToCurrentPlan === true
        && hasActiveRevision
        && currentDeputy !== undefined
        && (currentDeputy.provider !== creativeProfiles.deputy_editor.provider
          || currentDeputy.modelId !== creativeProfiles.deputy_editor.modelId);
      const migrateAllMembersToCurrentPlan = options.migrateAllMembersToCurrentPlan === true
        && hasActiveRevision
        && subscriptionPolicyActive;
      if (options.preserveActiveRevision === true && hasActiveRevision && !migrateDeputyEditorToCurrentPlan && !migrateAllMembersToCurrentPlan) continue;
      const targetProfiles = migrateAllMembersToCurrentPlan
        ? creativeProfiles
        : migrateDeputyEditorToCurrentPlan
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
            migrateAllMembersToCurrentPlan
              ? subscriptionMigrationReason(creativeProfiles)
              : migrateDeputyEditorToCurrentPlan
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

function subscriptionMigrationReason(profiles: Record<CreativeRoleKey, TeamModelProfile>): string {
  if (profiles.chief_editor.provider === 'opencodego') {
    return 'DEC-100：十五名创作成员统一迁移至 opencodego；保留历史调用快照，只影响未来任务';
  }
  return 'DEC-20260822：常规创作岗位切换火山方舟 Coding Plan，高级编剧单独使用 Agent Plan Kimi K3；保留历史调用快照，只影响未来任务';
}

export function toCreativeProfiles(profiles: Record<RoleKey, RoleModelProfile>): Record<CreativeRoleKey, TeamModelProfile> {
  const profile = (role: CreativeRoleKey, value: RoleModelProfile): TeamModelProfile => value.plan === 'deterministic'
    ? { ...value, modelId: `wenmi-fixture-v2-${role}` }
    : value;
  return {
    chief_editor: profile('chief_editor', profiles.chief_editor),
    deputy_editor: profile('deputy_editor', profiles.style_editor),
    lead_screenwriter: profile('lead_screenwriter', profiles.plot_architect),
    second_screenwriter: profile('second_screenwriter', profiles.continuity),
    third_screenwriter: profile('third_screenwriter', profiles.reviewer),
    setting: profile('setting', profiles.researcher),
    senior_screenwriter: profiles.plot_architect.plan === 'deterministic'
      ? profile('senior_screenwriter', profiles.plot_architect)
      : profile('senior_screenwriter', {
        provider: 'volcengine-ark-agent-plan', modelId: 'kimi-k3', plan: 'agent'
      }),
    lead_writer: profile('lead_writer', profiles.writer),
    backup_writer: profile('backup_writer', profiles.reviewer),
    fact_reviewer: profile('fact_reviewer', profiles.style_editor),
    literary_reviewer: profile('literary_reviewer', profiles.researcher),
    experience_reviewer: profile('experience_reviewer', profiles.reader_experience),
    experience_challenger: profile('experience_challenger', profiles.researcher),
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
    throw new Error('副编模型迁移前发现十五人团队配置不完整');
  }
  profiles.deputy_editor = deputyEditor;
  return profiles as Record<CreativeRoleKey, TeamModelProfile>;
}

function legacyProfileRole(roleKey: string): RoleKey {
  const aliases: Record<string, RoleKey> = {
    chief_editor: 'chief_editor', deputy_editor: 'reviewer', lead_screenwriter: 'plot_architect',
    second_screenwriter: 'continuity', third_screenwriter: 'chief_editor', setting: 'style_editor', lead_writer: 'writer', backup_writer: 'chief_editor',
    fact_reviewer: 'style_editor', literary_reviewer: 'reviewer', experience_reviewer: 'reader_experience', experience_challenger: 'researcher',
    researcher: 'researcher', copyright: 'copyright',
    plot_architect: 'plot_architect', continuity: 'continuity', writer: 'writer', reviewer: 'reviewer',
    reader_experience: 'reader_experience', style_editor: 'style_editor'
  };
  const mapped = aliases[roleKey];
  if (mapped === undefined) throw new Error(`未配置的岗位模型绑定：${roleKey}`);
  return mapped;
}
