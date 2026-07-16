import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { PositioningField, PositioningTag } from '../../domain/positioning.js';
import type { OwnerScope } from '../../domain/scope.js';
import { AgentTeamService } from '../agents/agent-team-service.js';
import { buildAdaptationRules, hashJson } from './adaptation-rules.js';
import { PositioningService } from './positioning-service.js';
import { BookRepository } from '../../infrastructure/db/repositories/book-repository.js';
import type { RoleKey } from '../../domain/roles.js';
import type { RoleModelProfile } from '../../infrastructure/models/model-runtime-config.js';

export interface OnboardingResult {
  bookId: string;
  title: string;
  positioningVersion: number;
  adaptationSnapshotId: string;
  budgetId: string;
  storyBibleArtifactId: string;
  activeEditorAgentId: string;
  agentCount: number;
}

export class BookOnboardingService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly roleProfiles?: Record<RoleKey, RoleModelProfile>
  ) {}

  public confirmDraft(scope: OwnerScope, draftId: string, expectedVersion: number, failAt?: 'after_book' | 'after_team' | 'after_artifact'): OnboardingResult {
    const positioning = new PositioningService(this.database, this.ids, this.clock);
    const draft = positioning.require(scope, draftId);
    if (draft.status !== 'editing') throw new Error('定位草稿已经确认或结束');
    if (draft.version !== expectedVersion) throw new Error('定位草稿版本已经变化');
    const bookScope = { ownerId: scope.ownerId, bookId: draft.proposedBookId };
    const tombstone = this.database.prepare('SELECT 1 FROM deletion_tombstones WHERE owner_id = ? AND deleted_book_id = ?')
      .get(scope.ownerId, draft.proposedBookId);
    if (tombstone !== undefined) throw new Error('删除墓碑禁止旧书籍ID复活');
    const team = new AgentTeamService(this.database, this.ids, this.clock, this.roleProfiles);
    team.seedRoleTemplates();
    const now = this.clock.now().toISOString();
    const positioningVersionId = this.ids.next();
    const configVersionId = this.ids.next();
    const adaptationSnapshotId = this.ids.next();
    const budgetId = this.ids.next();
    const storyBibleArtifactId = this.ids.next();
    const storyBibleVersionId = this.ids.next();
    const conversationId = this.ids.next();
    const rules = buildAdaptationRules(draft.fields, draft.tags);

    this.database.exec('BEGIN IMMEDIATE');
    try {
      new BookRepository(this.database).create(bookScope, draft.title, now, 'active');
      if (failAt === 'after_book') throw new Error('simulated-onboarding-failure');
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
      team.insertTeamWithinTransaction(bookScope);
      if (failAt === 'after_team') throw new Error('simulated-onboarding-failure');
      this.database.prepare(`
        INSERT INTO budgets (
          budget_id, owner_id, book_id, mode, token_limit, cash_limit_micros,
          reserved_tokens, reserved_cash_micros, spent_tokens, spent_cash_micros,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, 'standard', 240000, 0, 0, 0, 0, 0, 'active', ?, ?)
      `).run(budgetId, scope.ownerId, draft.proposedBookId, now, now);
      const storyBible = storyBibleSkeleton(draft.title, draft.fields, draft.tags);
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
        SELECT agent_id FROM agent_instances
        WHERE owner_id = ? AND book_id = ? AND role_template_id = 'role-chief-editor'
      `).get(scope.ownerId, draft.proposedBookId) as { agent_id: string };
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
        activeEditorAgentId: editor.agent_id,
        agentCount: 9
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
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

function storyBibleSkeleton(title: string, fields: PositioningField[], tags: PositioningTag[]): Record<string, unknown> {
  return {
    schema: 'story-bible-v1',
    title,
    positioning: Object.fromEntries(fields.map((field) => [field.key, { value: field.value, sourceStatus: field.sourceStatus }])),
    tags,
    theme: { confirmed: [], candidates: [] },
    worldRules: [],
    characters: [],
    mainPlot: { confirmed: null, candidates: [] },
    openQuestions: fields.filter((field) => field.sourceStatus === 'unspecified' || field.sourceStatus === 'conflict').map((field) => field.key)
  };
}
