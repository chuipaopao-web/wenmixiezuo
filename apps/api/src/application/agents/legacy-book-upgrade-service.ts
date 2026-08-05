import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import type { RoleModelProfile } from '../../infrastructure/models/model-runtime-config.js';
import { creativeRoleKeys, type CreativeRoleKey, type TeamModelProfile } from '../../contracts/agent-team-v2.js';
import type { LegacyBookUpgradeRepository } from '../../infrastructure/db/repositories/legacy-book-upgrade-repository.js';
import type { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { PromptCompiler } from './prompt-compiler.js';
import { TeamTemplateService } from './team-template-service.js';

export interface LegacyBookUpgradeResult {
  booksVisited: number;
  teamsCreated: number;
  profilesCreated: number;
  legacyAgentsRetired: number;
  deferredBooks: number;
}

export class LegacyBookUpgradeService {
  public constructor(
    private readonly repository: LegacyBookUpgradeRepository,
    private readonly teamTemplates: TeamTemplateService,
    private readonly promptCompiler: PromptCompiler,
    private readonly unitOfWork: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roleProfiles: Record<RoleKey, RoleModelProfile>
  ) {}

  public upgradeAll(): LegacyBookUpgradeResult {
    for (const roleKey of creativeRoleKeys) {
      this.promptCompiler.compile(roleKey, {
        objective: '岗位默认运行合同', mode: 'discussion', contextManifest: [], outputSchema: { type: 'object' }
      });
    }
    const books = this.repository.listBooks();
    let teamsCreated = 0;
    let profilesCreated = 0;
    let legacyAgentsRetired = 0;
    let deferredBooks = 0;
    const deterministic = Object.values(this.roleProfiles).every((profile) => profile.plan === 'deterministic');
    const profiles = toCreativeProfiles(this.roleProfiles);
    for (const scope of books) {
      this.unitOfWork.run(() => {
        const existingCount = this.repository.currentTeamCount(scope);
        if (existingCount !== 0 && existingCount !== creativeRoleKeys.length) {
          throw new Error(`书籍${scope.bookId}的十一人团队不完整：${existingCount}/${creativeRoleKeys.length}`);
        }
        profilesCreated += this.ensureProfiles(scope);
        const legacyEnabled = this.repository.legacyEnabledCount(scope);
        if ((existingCount === 0 || legacyEnabled > 0) && this.repository.hasNonterminalTasks(scope)) {
          deferredBooks += 1;
          return;
        }
        if (existingCount === 0) {
          const team = this.teamTemplates.createTeam(scope, { deterministic, profiles });
          const editor = team.find((member) => member.roleKey === 'chief_editor');
          const writer = team.find((member) => member.roleKey === 'lead_writer');
          if (editor === undefined || writer === undefined || team.length !== creativeRoleKeys.length) {
            throw new Error(`书籍${scope.bookId}的十一人团队创建不完整`);
          }
          const now = this.clock.now();
          legacyAgentsRetired += this.repository.finalizeTeamUpgrade(scope, {
            chiefEditorAgentId: editor.agentId,
            leadWriterAgentId: writer.agentId,
            now: now.toISOString(),
            leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString()
          });
          teamsCreated += 1;
        } else if (legacyEnabled > 0) {
          const now = this.clock.now();
          legacyAgentsRetired += this.repository.finalizeTeamUpgrade(scope, {
            chiefEditorAgentId: this.repository.currentRoleAgentId(scope, 'chief_editor'),
            leadWriterAgentId: this.repository.currentRoleAgentId(scope, 'lead_writer'),
            now: now.toISOString(),
            leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString()
          });
        }
      });
    }
    return { booksVisited: books.length, teamsCreated, profilesCreated, legacyAgentsRetired, deferredBooks };
  }

  private ensureProfiles(scope: { ownerId: string; bookId: string }): number {
    const positioning = this.repository.legacyPositioning(scope);
    const value = (key: string): unknown => positioning.fields.find((field) => field.key === key)?.value ?? null;
    const text = (key: string): string | null => {
      const candidate = value(key);
      return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
    };
    const audience = text('audience') ?? text('target_audience');
    const expressionBaseline = text('expression_baseline') ?? text('style');
    const expectedRaw = value('expected_scale_chars');
    const expectedCandidate = typeof expectedRaw === 'string' && /^\d+$/u.test(expectedRaw) ? Number(expectedRaw) : expectedRaw;
    const expectedScaleChars = typeof expectedCandidate === 'number' && Number.isInteger(expectedCandidate)
      && expectedCandidate >= 1_000 && expectedCandidate <= 10_000_000 ? expectedCandidate : null;
    const now = this.clock.now().toISOString();
    let created = 0;
    if (!this.repository.hasOnboardingProfile(scope)) {
      this.repository.insertOnboardingProfile(scope, {
        id: this.ids.next(), genre: text('genre'), classification: text('classification'), targetAudience: audience,
        expectedScaleChars, expressionBaseline,
        fieldSourcesJson: JSON.stringify(Object.fromEntries(positioning.fields.map((field) => [field.key, field.sourceStatus ?? 'legacy_partial']))),
        now
      });
      created += 1;
    }
    if (!this.repository.hasExpressionProfile(scope)) {
      this.repository.insertExpressionProfile(scope, {
        id: this.ids.next(), targetAudience: audience,
        languageToneJson: JSON.stringify(expressionBaseline === null ? [] : [expressionBaseline]),
        voiceEvidenceJson: JSON.stringify(expressionBaseline === null ? [] : [{
          source: 'legacy-positioning-v1', text: expressionBaseline, sourceCreatedAt: positioning.createdAt
        }]),
        now
      });
      created += 1;
    }
    return created;
  }
}

function toCreativeProfiles(profiles: Record<RoleKey, RoleModelProfile>): Partial<Record<CreativeRoleKey, TeamModelProfile>> {
  return {
    chief_editor: profiles.chief_editor,
    deputy_editor: profiles.continuity,
    lead_screenwriter: profiles.plot_architect,
    second_screenwriter: profiles.continuity,
    setting: profiles.style_editor,
    lead_writer: profiles.writer,
    backup_writer: profiles.chief_editor,
    literary_reviewer: profiles.reviewer,
    experience_reviewer: profiles.reader_experience,
    researcher: profiles.researcher,
    copyright: profiles.copyright
  };
}
