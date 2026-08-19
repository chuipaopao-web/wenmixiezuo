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
  membersAdded: number;
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
    let membersAdded = 0;
    const deterministic = Object.values(this.roleProfiles).every((profile) => profile.plan === 'deterministic');
    const profiles = toCreativeProfiles(this.roleProfiles);
    for (const scope of books) {
      this.unitOfWork.run(() => {
        const existingCount = this.repository.currentTeamCount(scope);
        if (existingCount !== 0 && existingCount > creativeRoleKeys.length) {
          throw new Error(`书籍${scope.bookId}的创作团队人数超出当前编制：${existingCount}/${creativeRoleKeys.length}`);
        }
        profilesCreated += this.ensureProfiles(scope);
        const legacyEnabled = this.repository.legacyEnabledCount(scope);
        const needsTopUp = existingCount > 0 && existingCount < creativeRoleKeys.length;
        if ((existingCount === 0 || legacyEnabled > 0 || needsTopUp) && this.repository.hasNonterminalTasks(scope)) {
          deferredBooks += 1;
          return;
        }
        if (existingCount === 0) {
          const team = this.teamTemplates.createTeam(scope, { deterministic, profiles });
          const editor = team.find((member) => member.roleKey === 'chief_editor');
          const writer = team.find((member) => member.roleKey === 'lead_writer');
          if (editor === undefined || writer === undefined || team.length !== creativeRoleKeys.length) {
            throw new Error(`书籍${scope.bookId}的十四人团队创建不完整`);
          }
          const now = this.clock.now();
          legacyAgentsRetired += this.repository.finalizeTeamUpgrade(scope, {
            chiefEditorAgentId: editor.agentId,
            leadWriterAgentId: writer.agentId,
            now: now.toISOString(),
            leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString()
          });
          teamsCreated += 1;
        } else {
          if (needsTopUp) {
            const toppedUp = this.teamTemplates.addMissingMembers(scope, { deterministic, profiles });
            membersAdded += toppedUp.added.length;
            if (toppedUp.team.length !== creativeRoleKeys.length) {
              throw new Error(`书籍${scope.bookId}补齐后团队仍不完整：${toppedUp.team.length}/${creativeRoleKeys.length}`);
            }
          }
          if (legacyEnabled > 0) {
            const now = this.clock.now();
            legacyAgentsRetired += this.repository.finalizeTeamUpgrade(scope, {
              chiefEditorAgentId: this.repository.currentRoleAgentId(scope, 'chief_editor'),
              leadWriterAgentId: this.repository.currentRoleAgentId(scope, 'lead_writer'),
              now: now.toISOString(),
              leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString()
            });
          }
          // 存量书的设定成员曾沿用 GLM 与编剧B撞模型，导致提案三席无法开工；
          // 逐书把设定岗位的未来绑定修为独立模型。确定性测试运行时全队共用
          // 本地假模型且有专门豁免，不做修复。
          if (!deterministic && profiles.setting !== undefined) {
            this.teamTemplates.repairSettingSeatModel(scope, profiles.setting);
          }
        }
      });
    }
    return { booksVisited: books.length, teamsCreated, profilesCreated, legacyAgentsRetired, deferredBooks, membersAdded };
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
    deputy_editor: profiles.style_editor,
    lead_screenwriter: profiles.plot_architect,
    second_screenwriter: profiles.continuity,
    third_screenwriter: profiles.chief_editor,
    setting: profiles.reviewer,
    lead_writer: profiles.writer,
    backup_writer: profiles.chief_editor,
    fact_reviewer: profiles.style_editor,
    literary_reviewer: profiles.researcher,
    experience_reviewer: profiles.reader_experience,
    experience_challenger: profiles.researcher,
    researcher: profiles.researcher,
    copyright: profiles.copyright
  };
}
