import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { PositioningField, PositioningTag } from '../../domain/positioning.js';
import type { OwnerScope } from '../../domain/scope.js';
import { TeamTemplateService } from '../agents/team-template-service.js';
import { toCreativeProfiles } from '../agents/model-binding-service.js';
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
import { OPENING_TAXONOMY, type OpeningBlueprintInput, type ProtagonistRole } from '../../contracts/opening-blueprint.js';
import { ProtagonistStateRepository } from '../../infrastructure/db/repositories/protagonist-state-repository.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import { SettingGuidanceService } from '../knowledge/setting-guidance-service.js';
import { bookTokenLimitForOwner } from '../../infrastructure/security/membership-service.js';

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

/** 作者在开书向导里选的角色身份，给 AI 成员和状态档案展示用的大白话标签。 */
const PROTAGONIST_ROLE_LABELS: Record<ProtagonistRole, string> = {
  male_lead: '男主',
  female_lead: '女主',
  co_lead: '共同主角',
  ensemble: '群像主角',
  non_human: '非人主角',
  male_support: '男配',
  female_support: '女配',
  male_villain: '男反',
  female_villain: '女反'
};

export class BookOnboardingService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roleProfiles?: Record<RoleKey, RoleModelProfile>,
    private readonly releaseId?: string,
    private readonly platformSchemes?: { currentProfiles(fallback: Record<CreativeRoleKey, TeamModelProfile>): Record<CreativeRoleKey, TeamModelProfile> }
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
    const openingBlueprintId = draft.openingBlueprint === null ? null : this.ids.next();
    const isContinuation = draft.openingBlueprint?.creationMode === 'continuation';
    const openingStyleVersionId = draft.openingBlueprint === null ? null : this.ids.next();
    const rules = buildAdaptationRules(draft.fields, draft.tags);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      new BookRepository(this.database).create(bookScope, draft.title, now, 'active');
      if (failAt === 'after_book') throw new Error('simulated-onboarding-failure');
      if (draft.openingBlueprint !== null && openingBlueprintId !== null) {
        this.insertOpeningBlueprint(bookScope, openingBlueprintId, draft.openingBlueprint, now);
        this.insertOpeningProtagonists(bookScope, openingBlueprintId, draft.openingBlueprint, now);
        this.insertOpeningStyle(bookScope, openingStyleVersionId!, openingBlueprintId, draft.openingBlueprint, now);
      }
      this.database.prepare(`
        INSERT INTO book_planning_states (
          owner_id, book_id, version, stage, active_style_version_id, updated_at
        ) VALUES (?, ?, 1, ?, ?, ?)
      `).run(
        scope.ownerId, draft.proposedBookId,
        openingStyleVersionId === null ? 'style_in_progress' : 'setting_in_progress',
        openingStyleVersionId, now
      );
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
        profiles: this.roleProfiles === undefined ? undefined : this.resolveCreativeProfiles()
      });
      const promptCompiler = new PromptCompiler(new PromptTemplateRepository(this.database), this.ids, this.clock);
      for (const roleKey of creativeRoleKeys) {
        promptCompiler.compile(roleKey, { objective: '岗位默认运行合同', mode: 'discussion', contextManifest: [], outputSchema: { type: 'object' } });
      }
      if (failAt === 'after_team') throw new Error('simulated-onboarding-failure');
      // 单书预算上限是防失控保险丝，不是日常消耗刻度：跟随所有者会员等级
      //（算力值配额换算真实 token），会员升级时由 MembershipService.grant 同步刷新，
      // 避免"会员还有额度、书籍预算却提前卡死"的双重限制（2026-08-20 老板指令）。
      const bookTokenLimit = bookTokenLimitForOwner(this.database, scope.ownerId);
      this.database.prepare(`
        INSERT INTO budgets (
          budget_id, owner_id, book_id, mode, token_limit, cash_limit_micros,
          reserved_tokens, reserved_cash_micros, spent_tokens, spent_cash_micros,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, 'standard', ?, 0, 0, 0, 0, 0, 'active', ?, ?)
      `).run(budgetId, scope.ownerId, draft.proposedBookId, bookTokenLimit, now, now);
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
      // DEC-CURRENT-062：建书不再自动召集 AI 成员、不创建任何任务、不激活首个设定项。
      // 作者进入设定页勾选好条目、点“开始设计”后才建任务；团队全程待命。
      if (draft.openingBlueprint !== null && !isContinuation) {
        new SettingGuidanceService(this.database, this.ids, this.clock)
          .ensureInitialized(bookScope, draft.openingBlueprint, false);
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
        kickoffTaskId: null,
        agentCount: createdTeam.length
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
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
        { key: 'opening.role', label: '角色身份', category: '基本资料', value: PROTAGONIST_ROLE_LABELS[protagonist.role] ?? protagonist.role, type: 'text' },
        { key: 'opening.age', label: '年龄', category: '基本资料', value: protagonist.age, type: 'text' },
        { key: 'opening.familyBackground', label: '家庭背景', category: '基本资料', value: protagonist.familyBackground ?? '', type: 'text' },
        { key: 'opening.careerBackground', label: '职业背景', category: '基本资料', value: protagonist.careerBackground ?? '', type: 'text' },
        { key: 'opening.goldenFinger', label: '金手指', category: '基本资料', value: protagonist.goldenFinger ?? '', type: 'text' },
        { key: 'opening.background', label: '人物背景', category: '基本资料', value: protagonist.background ?? '', type: 'text' },
        { key: 'opening.personalities', label: '性格', category: '基本资料', value: protagonist.personalities, type: 'list' }
      ].filter((entry) => Array.isArray(entry.value) ? entry.value.length > 0 : entry.value.trim().length > 0);
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

  private insertOpeningStyle(
    scope: { ownerId: string; bookId: string },
    styleVersionId: string,
    openingBlueprintId: string,
    blueprint: OpeningBlueprintInput,
    now: string
  ): void {
    const intent = blueprint.styleIntent ?? {
      languageTones: [], emotionalTones: [], pacingAndPayoff: [], atmospheres: [], custom: []
    };
    const content = {
      ...intent,
      strength: 'medium',
      adaptiveRules: [
        '每章根据场景功能、人物状态和章纲选择当前语言、主情绪、节奏与氛围',
        '调色板只提供可用范围，不要求同时出现，也不限制未选择的合理表达'
      ],
      avoidPatterns: [
        '所有角色使用同一种口吻',
        '用网络段子硬插幽默',
        '用无代价碾压代替因果铺垫'
      ],
      narrativePerson: '',
      viewpointDistance: '',
      textDensity: 'adaptive'
    };
    this.database.prepare(`
      INSERT INTO book_style_versions (
        style_version_id, owner_id, book_id, version, content_json,
        source_kind, source_id, status, created_at
      ) VALUES (?, ?, ?, 1, ?, 'opening', ?, 'selected', ?)
    `).run(styleVersionId, scope.ownerId, scope.bookId, JSON.stringify(content), openingBlueprintId, now);
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

  /** 平台模型方案优先于环境默认槽位；未保存过后台方案时回退到槽位映射。 */
  private resolveCreativeProfiles(): Partial<Record<CreativeRoleKey, TeamModelProfile>> {
    const fallback = toCreativeProfiles(this.roleProfiles!) as Record<CreativeRoleKey, TeamModelProfile>;
    return this.platformSchemes?.currentProfiles(fallback) ?? fallback;
  }
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
      name: item.name, role: item.role, age: item.age, background: item.background ?? '',
      familyBackground: item.familyBackground ?? '', careerBackground: item.careerBackground ?? '',
      goldenFinger: item.goldenFinger ?? '',
      personalities: item.personalities, sourceStatus: 'owner_reference'
    })) ?? [],
    openingReference: openingBlueprint === null ? null : {
      storyDirection: openingBlueprint.storyDirection,
      storyDirectionAuthority: 'owner_confirmed_soft_direction_not_canon',
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