import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { PositioningField, PositioningTag } from '../../domain/positioning.js';
import type { OwnerScope } from '../../domain/scope.js';
import { TeamTemplateService } from '../agents/team-template-service.js';
import { buildAdaptationRules, hashJson } from './adaptation-rules.js';
import { PositioningService } from './positioning-service.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import type { RoleKey } from '../../domain/roles.js';
import type { RoleModelProfile } from '../../infrastructure/models/model-runtime-config.js';
import { AgentGovernanceRepository } from '../../infrastructure/db/repositories/agent-governance-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import type { CreativeRoleKey, TeamModelProfile } from '../../contracts/agent-team-v2.js';
import { creativeRoleKeys } from '../../contracts/agent-team-v2.js';
import { PromptCompiler } from '../agents/prompt-compiler.js';
import { PromptTemplateRepository } from '../../infrastructure/db/repositories/prompt-template-repository.js';
import { OPENING_TAXONOMY, type OpeningBlueprintInput } from '../../contracts/opening-blueprint.js';
import { ProtagonistStateRepository } from '../../infrastructure/db/repositories/protagonist-state-repository.js';
import { TaskService } from '../tasks/task-service.js';
import { DomainError, errorCodes } from '../../domain/errors.js';

export interface OnboardingResult {
  bookId: string;
  title: string;
  positioningVersion: number;
  adaptationSnapshotId: string;
  budgetId: string;
  storyBibleArtifactId: string;
  onboardingProfileId: string;
  expressionProfileId: string;
  activeEditorAgentId: string;
  openingBlueprintId: string | null;
  kickoffTaskId: string | null;
  agentCount: number;
}

export class BookOnboardingService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roleProfiles?: Record<RoleKey, RoleModelProfile>,
    private readonly releaseId?: string
  ) {}

  public confirmDraft(
    scope: OwnerScope,
    draftId: string,
    expectedVersion: number,
    failAt?: 'after_book' | 'after_team' | 'after_artifact' | 'after_kickoff'
  ): OnboardingResult {
    const positioning = new PositioningService(this.database, this.ids, this.clock);
    const draft = positioning.require(scope, draftId);
    if (draft.status !== 'editing') {
      throw new DomainError(
        errorCodes.bookStatusConflict,
        '定位草稿已经确认或结束',
        { currentStatus: draft.status },
        false,
        409
      );
    }
    if (draft.version !== expectedVersion) {
      throw new DomainError(
        errorCodes.bookVersionConflict,
        '定位草稿版本已经变化',
        { expectedVersion, actualVersion: draft.version },
        true,
        409
      );
    }
    const bookScope = { ownerId: scope.ownerId, bookId: draft.proposedBookId };
    const tombstone = this.database.prepare('SELECT 1 FROM deletion_tombstones WHERE owner_id = ? AND deleted_book_id = ?')
      .get(scope.ownerId, draft.proposedBookId);
    if (tombstone !== undefined) throw new Error('删除墓碑禁止旧书籍ID复活');
    const team = new TeamTemplateService(
      new AgentGovernanceRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
    );
    const now = this.clock.now().toISOString();
    const positioningVersionId = this.ids.next();
    const onboardingProfileId = this.ids.next();
    const expressionProfileId = this.ids.next();
    const configVersionId = this.ids.next();
    const adaptationSnapshotId = this.ids.next();
    const budgetId = this.ids.next();
    const storyBibleArtifactId = this.ids.next();
    const storyBibleVersionId = this.ids.next();
    const conversationId = this.ids.next();
    const openingBlueprintId = draft.openingBlueprint === null ? null : this.ids.next();
    const onboardingTriggerMessageId = this.ids.next();
    const kickoffTaskId = this.ids.next();
    const rules = buildAdaptationRules(draft.fields, draft.tags);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      new BookRepository(this.database).create(bookScope, draft.title, now, 'active');
      if (failAt === 'after_book') throw new Error('simulated-onboarding-failure');
      if (draft.openingBlueprint !== null && openingBlueprintId !== null) {
        this.insertOpeningBlueprint(bookScope, openingBlueprintId, draft.openingBlueprint, now);
        this.insertOpeningProtagonists(bookScope, openingBlueprintId, draft.openingBlueprint, now);
      }
      const genre = fieldValue(draft.fields, 'genre');
      const classification = fieldValue(draft.fields, 'classification');
      const targetAudience = fieldValue(draft.fields, 'audience');
      const expectedScale = fieldValue(draft.fields, 'expected_scale_chars');
      const expressionBaseline = fieldValue(draft.fields, 'expression_baseline');
      this.database.prepare(`
        INSERT INTO book_onboarding_profiles (
          onboarding_profile_id, owner_id, book_id, version, genre, classification,
          target_audience, expected_scale_chars, initial_expression_baseline,
          field_sources_json, status, created_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'provisional', ?)
      `).run(
        onboardingProfileId, scope.ownerId, draft.proposedBookId,
        asNullableString(genre), asNullableString(classification), asNullableString(targetAudience),
        typeof expectedScale === 'string' && /^\d+$/u.test(expectedScale) ? Number(expectedScale) : null,
        asNullableString(expressionBaseline),
        JSON.stringify(Object.fromEntries(draft.fields.map((field) => [field.key, field.sourceStatus]))),
        now
      );
      this.database.prepare(`
        INSERT INTO book_expression_profiles (
          expression_profile_id, owner_id, book_id, version, narrative_person,
          viewpoint_distance, language_tone_json, text_density, target_audience,
          content_boundaries_json, humor_seriousness, voice_evidence_json,
          impact_scope_json, status, created_at
        ) VALUES (?, ?, ?, 1, NULL, NULL, ?, 'adaptive', ?, '{}', 'adaptive', ?, ?, 'provisional', ?)
      `).run(
        expressionProfileId, scope.ownerId, draft.proposedBookId,
        JSON.stringify(expressionBaseline === null ? [] : [expressionBaseline]),
        asNullableString(targetAudience),
        JSON.stringify(expressionBaseline === null ? [] : [{ source: 'onboarding', text: expressionBaseline }]),
        JSON.stringify({ appliesFrom: 'first_formal_work_order', narrativeViewpointRequiresConfirmation: true }),
        now
      );
      this.database.prepare(`
        INSERT INTO positioning_versions (
          positioning_version_id, owner_id, book_id, version, fields_json, tags_json,
          source_draft_id, content_hash, created_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        positioningVersionId, scope.ownerId, draft.proposedBookId,
        JSON.stringify(draft.fields), JSON.stringify(draft.tags), draftId,
        hashJson({ fields: draft.fields, tags: draft.tags }), now
      );
      this.database.prepare(`
        INSERT INTO book_configs (
          config_version_id, owner_id, book_id, version, positioning_version,
          budget_mode, preferences_json, active, created_at
        ) VALUES (?, ?, ?, 1, 1, 'standard', '{}', 1, ?)
      `).run(configVersionId, scope.ownerId, draft.proposedBookId, now);
      this.insertTags(bookScope, 1, draft.tags, now);
      this.database.prepare(`
        INSERT INTO adaptation_snapshots (
          adaptation_snapshot_id, owner_id, book_id, version, positioning_version,
          rules_json, content_hash, active, created_at
        ) VALUES (?, ?, ?, 1, 1, ?, ?, 1, ?)
      `).run(adaptationSnapshotId, scope.ownerId, draft.proposedBookId, JSON.stringify(rules), hashJson(rules), now);
      const createdTeam = team.createTeam(bookScope, {
        deterministic: this.roleProfiles === undefined || Object.values(this.roleProfiles).every((profile) => profile.plan === 'deterministic'),
        profiles: this.roleProfiles === undefined ? undefined : toCreativeProfiles(this.roleProfiles)
      });
      const promptCompiler = new PromptCompiler(new PromptTemplateRepository(this.database), this.ids, this.clock);
      for (const roleKey of creativeRoleKeys) {
        promptCompiler.compile(roleKey, { objective: '岗位默认运行合同', mode: 'discussion', contextManifest: [], outputSchema: { type: 'object' } });
      }
      if (failAt === 'after_team') throw new Error('simulated-onboarding-failure');
      this.database.prepare(`
        INSERT INTO budgets (
          budget_id, owner_id, book_id, mode, token_limit, cash_limit_micros,
          reserved_tokens, reserved_cash_micros, spent_tokens, spent_cash_micros,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, 'standard', 240000, 0, 0, 0, 0, 0, 'active', ?, ?)
      `).run(budgetId, scope.ownerId, draft.proposedBookId, now, now);
      const storyBible = storyBibleSkeleton(draft.title, draft.fields, draft.tags, draft.openingBlueprint);
      this.database.prepare(`
        INSERT INTO artifacts (
          artifact_id, owner_id, book_id, artifact_type, title, active_version_id,
          status, version, created_at, updated_at
        ) VALUES (?, ?, ?, 'story_bible', '故事圣经', ?, 'draft', 1, ?, ?)
      `).run(storyBibleArtifactId, scope.ownerId, draft.proposedBookId, storyBibleVersionId, now, now);
      this.database.prepare(`
        INSERT INTO artifact_versions (
          artifact_version_id, artifact_id, owner_id, book_id, version,
          positioning_version, adaptation_snapshot_id, schema_version,
          content_json, content_hash, status, created_at
        ) VALUES (?, ?, ?, ?, 1, 1, ?, 1, ?, ?, 'selected', ?)
      `).run(
        storyBibleVersionId, storyBibleArtifactId, scope.ownerId, draft.proposedBookId,
        adaptationSnapshotId, JSON.stringify(storyBible), hashJson(storyBible), now
      );
      if (failAt === 'after_artifact') throw new Error('simulated-onboarding-failure');
      this.database.prepare(`
        INSERT INTO conversations (conversation_id, owner_id, book_id, title, created_at, updated_at)
        VALUES (?, ?, ?, '主创作对话', ?, ?)
      `).run(conversationId, scope.ownerId, draft.proposedBookId, now, now);
      const editor = this.database.prepare(`
        SELECT agent_id, model_snapshot_id FROM agent_instances
        WHERE owner_id = ? AND book_id = ? AND role_template_id = 'role-v2-chief-editor'
      `).get(scope.ownerId, draft.proposedBookId) as { agent_id: string; model_snapshot_id: string };
      this.database.prepare(`
        INSERT INTO editor_leases (
          owner_id, book_id, active_editor_agent_id, editor_epoch,
          lease_expires_at, takeover_state, updated_at
        ) VALUES (?, ?, ?, 1, ?, 'stable', ?)
      `).run(scope.ownerId, draft.proposedBookId, editor.agent_id, new Date(this.clock.now().getTime() + 60_000).toISOString(), now);
      this.database.prepare(`
        UPDATE books SET positioning_version = 1, active_editor_agent_id = ?, editor_epoch = 1,
          updated_at = ? WHERE owner_id = ? AND book_id = ?
      `).run(editor.agent_id, now, scope.ownerId, draft.proposedBookId);
      if (this.releaseId !== undefined) {
        const kickoffContent = buildKickoffInstruction(draft.title, draft.openingBlueprint);
        this.database.prepare(`
          INSERT INTO messages (
            message_id, conversation_id, owner_id, book_id, sender_type,
            message_type, content, references_json, created_at
          ) VALUES (?, ?, ?, ?, 'system', 'onboarding_trigger', ?, '[]', ?)
        `).run(onboardingTriggerMessageId, conversationId, scope.ownerId, draft.proposedBookId, kickoffContent, now);
        const taskService = new TaskService(this.database, this.requireReleaseId(), this.clock);
        taskService.create(bookScope, {
          taskId: kickoffTaskId,
          taskType: 'conversation_reply',
          assignedAgentId: editor.agent_id,
          idempotencyKey: `onboarding-kickoff:${draft.proposedBookId}`,
          budgetId,
          requiredEditorEpoch: 1,
          initialPhase: 'reply',
          brief: {
            conversationId,
            messageId: onboardingTriggerMessageId,
            content: kickoffContent,
            modelSnapshotId: editor.model_snapshot_id,
            proactiveOnboarding: true,
            openingBlueprintId
          }
        });
        taskService.queue(bookScope, kickoffTaskId);
      }
      if (failAt === 'after_kickoff') throw new Error('simulated-onboarding-failure');
      this.database.prepare(`
        UPDATE positioning_drafts SET status = 'confirmed', confirmed_book_id = ?, updated_at = ?
        WHERE draft_id = ? AND owner_id = ? AND version = ? AND status = 'editing'
      `).run(draft.proposedBookId, now, draftId, scope.ownerId, expectedVersion);
      this.database.exec('COMMIT');
      return {
        bookId: draft.proposedBookId,
        title: draft.title,
        positioningVersion: 1,
        adaptationSnapshotId,
        budgetId,
        storyBibleArtifactId,
        onboardingProfileId,
        expressionProfileId,
        activeEditorAgentId: editor.agent_id,
        openingBlueprintId,
        kickoffTaskId: this.releaseId === undefined ? null : kickoffTaskId,
        agentCount: createdTeam.length
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private requireReleaseId(): string {
    if (this.releaseId !== undefined) return this.releaseId;
    const row = this.database.prepare('SELECT release_id FROM release_runs ORDER BY created_at DESC LIMIT 1')
      .get() as { release_id: string } | undefined;
    if (row === undefined) throw new Error('开书任务无法找到活动release');
    return row.release_id;
  }

  private insertOpeningBlueprint(
    scope: { ownerId: string; bookId: string },
    openingBlueprintId: string,
    blueprint: OpeningBlueprintInput,
    now: string
  ): void {
    const category = OPENING_TAXONOMY.categories.find((item) => item.key === blueprint.categoryKey);
    if (category === undefined || category.channel !== blueprint.channel) throw new Error('开书分类目录与频道不匹配');
    this.database.prepare(`
      INSERT INTO book_opening_blueprints (
        opening_blueprint_id, owner_id, book_id, version, taxonomy_version,
        channel, category_key, category_name, blueprint_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(
      openingBlueprintId, scope.ownerId, scope.bookId, blueprint.taxonomyVersion,
      blueprint.channel, blueprint.categoryKey, category.name, JSON.stringify(blueprint), hashJson(blueprint), now
    );
  }

  private insertOpeningProtagonists(
    scope: { ownerId: string; bookId: string },
    openingBlueprintId: string,
    blueprint: OpeningBlueprintInput,
    now: string
  ): void {
    const repository = new ProtagonistStateRepository(this.database);
    for (const [index, protagonist] of (blueprint.protagonists ?? []).entries()) {
      const profileId = this.ids.next();
      repository.insertProfile(scope, {
        profileId, entityId: null, displayName: protagonist.name, isPrimary: index === 0, now
      });
      const entries = [
        { key: 'opening.age', label: '年龄', category: '基本资料', value: protagonist.age, type: 'text' },
        { key: 'opening.background', label: '人物背景', category: '基本资料', value: protagonist.background, type: 'text' },
        { key: 'opening.personalities', label: '性格', category: '基本资料', value: protagonist.personalities, type: 'list' }
      ];
      for (const entry of entries) {
        repository.insertState(scope, {
          entryId: this.ids.next(), profileId, category: entry.category, logicalKey: entry.key,
          label: entry.label, valueType: entry.type, valueJson: JSON.stringify(entry.value), unit: null,
          stateStatus: 'active', authorityLayer: 'candidate', effectiveChapterNumber: null, storyTime: null,
          sourceKind: 'owner', sourceId: openingBlueprintId, sourceFactId: null,
          sourceManuscriptVersionId: null, canonRevision: 0, revision: 1,
          previousEntryId: null, note: '老板确认的开书参考资料；尚未作为正文正史结算', now
        });
      }
    }
  }

  private insertTags(scope: { ownerId: string; bookId: string }, positioningVersion: number, tags: PositioningTag[], now: string): void {
    for (const tag of tags) {
      const tagKey = `tag-${createHash('sha256').update(`${tag.category}:${tag.name}`).digest('hex').slice(0, 16)}`;
      this.database.prepare(`
        INSERT INTO classification_tags (tag_id, tag_key, display_name, category, dynamic, created_at)
        VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(tag_key) DO NOTHING
      `).run(tagKey, tagKey, tag.name, tag.category, now);
      this.database.prepare(`
        INSERT INTO positioning_tag_bindings (owner_id, book_id, positioning_version, tag_id, source_status)
        VALUES (?, ?, ?, ?, ?)
      `).run(scope.ownerId, scope.bookId, positioningVersion, tagKey, tag.sourceStatus);
    }
  }
}

function toCreativeProfiles(profiles: Record<RoleKey, RoleModelProfile>): Partial<Record<CreativeRoleKey, TeamModelProfile>> {
  return {
    chief_editor: profiles.chief_editor,
    deputy_editor: profiles.reviewer,
    lead_screenwriter: profiles.plot_architect,
    second_screenwriter: profiles.continuity,
    setting: profiles.continuity,
    lead_writer: profiles.writer,
    backup_writer: profiles.continuity,
    literary_reviewer: profiles.reviewer,
    experience_reviewer: profiles.reader_experience,
    researcher: profiles.researcher,
    copyright: profiles.copyright
  };
}

function fieldValue(fields: PositioningField[], key: string): unknown {
  return fields.find((field) => field.key === key)?.value ?? null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function storyBibleSkeleton(
  title: string,
  fields: PositioningField[],
  tags: PositioningTag[],
  openingBlueprint: OpeningBlueprintInput | null
): Record<string, unknown> {
  return {
    schema: 'story-bible-v2',
    title,
    positioning: Object.fromEntries(fields.map((field) => [field.key, { value: field.value, sourceStatus: field.sourceStatus }])),
    tags,
    theme: { confirmed: [], candidates: [] },
    worldRules: [],
    characters: openingBlueprint?.protagonists?.map((item) => ({
      name: item.name, role: item.role, age: item.age, background: item.background,
      personalities: item.personalities, sourceStatus: 'owner_reference'
    })) ?? [],
    openingReference: openingBlueprint === null ? null : {
      worldBackground: openingBlueprint.worldBackground,
      openingBackground: openingBlueprint.openingBackground,
      stageOne: openingBlueprint.stageOne,
      fullBookOutline: openingBlueprint.fullBookOutline,
      initialMap: openingBlueprint.initialMap,
      mustFollow: openingBlueprint.mustFollow,
      authority: 'owner_confirmed_reference_not_canon'
    },
    mainPlot: {
      confirmed: null,
      candidates: openingBlueprint?.fullBookOutline?.trim() ? [openingBlueprint.fullBookOutline] : []
    },
    openQuestions: fields.filter((field) => field.sourceStatus === 'unspecified' || field.sourceStatus === 'conflict').map((field) => field.key)
  };
}

function buildKickoffInstruction(title: string, blueprint: OpeningBlueprintInput | null): string {
  if (blueprint === null) {
    return `《${title}》刚刚创建。请以活动主编身份主动开场：先说明当前只有基础定位，再提出1至3个最有价值的问题，帮助老板补齐主角、第一阶段剧情和关键边界。不得直接写正文。`;
  }
  return `《${title}》已完成作品基本信息。请以活动主编身份主动进入“设定大纲”阶段：先简短说明已经确认的频道、分类、题材与主要标签，再提出1至3个最有价值的设定问题，优先帮助老板建立足以支撑第一阶段创作的世界规则、人物基础或核心机制。允许回答“不知道”“稍后补充”或“刻意留白”。不要讨论第一阶段剧情，不要生成总纲、章纲或正文，不要启动编剧和主笔。`;
}
