import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import type { ArtifactType } from '../../domain/artifact-schemas.js';
import { ArtifactService, type ArtifactVersionRecord } from './artifact-service.js';
import { ExpressionProfileService } from '../books/expression-profile-service.js';
import { ExpressionProfileRepository } from '../../infrastructure/db/repositories/expression-profile-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';

interface DecisionRow {
  scope_text: string;
  recommendation_json: string;
  alternatives_json: string;
  boss_confirmed: number;
}

export interface PreparedPlanningArtifacts {
  creativePlanVersionId: string;
  storyBibleVersionId: string;
  masterOutlineVersionId: string;
  volumeOutlineVersionId: string;
  chapterOutlineVersionIds: string[];
}

export class PlanningArtifactService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public promoteIfPlanningTask(
    scope: BookScope,
    discussionId: string,
    decisionId: string
  ): PreparedPlanningArtifacts | null {
    const sourceTask = this.database.prepare(`
      SELECT task_brief_json FROM tasks
      WHERE owner_id = ? AND book_id = ? AND task_type = 'discussion'
        AND json_extract(task_brief_json, '$.discussionId') = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, discussionId) as { task_brief_json: string } | undefined;
    if (sourceTask === undefined) return null;
    const brief = JSON.parse(sourceTask.task_brief_json) as { purpose?: string };
    if (brief.purpose !== 'creative_planning') return null;
    return this.promoteConfirmedDecision(scope, discussionId, decisionId, this.recommendedChapterCount(scope, discussionId));
  }

  public promoteConfirmedDecision(
    scope: BookScope,
    discussionId: string,
    decisionId: string,
    chapterCount: number
  ): PreparedPlanningArtifacts {
    assertBookScope(scope);
    if (!Number.isInteger(chapterCount) || chapterCount < 1 || chapterCount > 30) throw new Error('剧情跨度必须是1至30章的整数；更长跨度应拆为故事弧并滚动规划');
    const decision = this.database.prepare(`
      SELECT x.scope_text, d.recommendation_json, d.alternatives_json, d.boss_confirmed
      FROM discussion_decisions d JOIN discussions x ON x.discussion_id = d.discussion_id
      WHERE d.decision_id = ? AND d.discussion_id = ? AND d.owner_id = ? AND d.book_id = ?
    `).get(decisionId, discussionId, scope.ownerId, scope.bookId) as DecisionRow | undefined;
    if (decision === undefined || decision.boss_confirmed !== 1) throw new Error('只有老板明确确认的讨论决定才能生成创作资料');
    const recommendation = JSON.parse(decision.recommendation_json) as Record<string, unknown>;
    const alternatives = JSON.parse(decision.alternatives_json) as unknown[];
    const summary = readableSummary(recommendation);
    const positioning = this.positioning(scope);
    const expressionProfiles = new ExpressionProfileService(
      new ExpressionProfileRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
    );
    const currentExpression = expressionProfiles.active(scope);
    if (currentExpression?.status !== 'confirmed' || currentExpression.narrativePerson === null || currentExpression.viewpointDistance === null) {
      expressionProfiles.revise(scope, {
        narrativePerson: currentExpression?.narrativePerson ?? 'third',
        viewpointDistance: currentExpression?.viewpointDistance ?? 'close',
        languageTone: stringArray(currentExpression?.languageTone),
        textDensity: currentExpression?.textDensity ?? 'adaptive',
        targetAudience: currentExpression?.targetAudience ?? stringValue(positioning.audience?.value),
        contentBoundaries: isRecord(currentExpression?.contentBoundaries) ? currentExpression.contentBoundaries : {},
        humorSeriousness: currentExpression?.humorSeriousness ?? 'adaptive',
        voiceEvidence: Array.isArray(currentExpression?.voiceEvidence) ? currentExpression.voiceEvidence : [],
        impactScope: { appliesFrom: 'first_formal_work_order', sourceDecisionId: decisionId, ownerConfirmed: true },
        confirm: true
      });
    }
    const premise = stringValue(positioning.premise?.value) ?? decision.scope_text;
    const audience = stringValue(positioning.audience?.value) ?? '后续对话继续细化';
    const tone = stringValue(positioning.style?.value) ?? '服从老板确认的方案与后续修订';
    const source = { sourceDiscussionId: discussionId, sourceDecisionId: decisionId };
    const creativePlan = this.upsert(scope, 'creative_plan', '创作方案', {
      premise,
      audience,
      tone,
      constraints: ['不得脱离老板确认的方案擅自补写关键设定', '新增重大设定必须再次讨论并确认'],
      confirmedRecommendation: summary,
      alternatives,
      ...source
    });
    const currentBible = this.currentStoryBible(scope);
    const storyBible = this.upsert(scope, 'story_bible', '故事圣经', {
      ...currentBible,
      title: stringValue(currentBible.title) ?? this.bookTitle(scope),
      positioning: currentBible.positioning ?? positioning,
      worldRules: Array.isArray(currentBible.worldRules) ? currentBible.worldRules : [],
      characters: Array.isArray(currentBible.characters) ? currentBible.characters : [],
      mainPlot: {
        confirmed: { summary, scope: decision.scope_text, ...source },
        candidates: []
      },
      planningHistory: [...asArray(currentBible.planningHistory), { summary, scope: decision.scope_text, ...source }]
    });
    const firstChapterNumber = this.nextChapterNumber(scope);
    const beats = extractBeats(summary, decision.scope_text, alternatives);
    const masterOutline = this.upsert(scope, 'master_outline', '总纲', {
      premise,
      acts: Array.from({ length: chapterCount }, (_, index) => ({
        chapterNumber: firstChapterNumber + index,
        objective: index === 0 ? summary : `承接前章，继续推进已确认方案：${summary}`
      })),
      endingDirection: stringValue(positioning.ending?.value) ?? '尚未锁定；后续由老板确认',
      ...source
    });
    const volumeNumber = this.currentVolumeNumber(scope);
    const volumeOutline = this.upsert(scope, 'volume_outline', `第${volumeNumber}卷卷纲`, {
      volumeNumber,
      goal: summary,
      arcs: [{
        title: '当前故事弧',
        chapterStart: firstChapterNumber,
        chapterEnd: firstChapterNumber + chapterCount - 1,
        objective: summary,
        status: 'active'
      }],
      endingState: extractHook(summary, decision.scope_text),
      ...source
    });
    const chapterOutlineVersionIds = Array.from({ length: chapterCount }, (_, index) => {
      const chapterNumber = firstChapterNumber + index;
      const outline = this.upsert(scope, 'chapter_outline', `第${chapterNumber}章章纲`, {
        chapterNumber,
        goal: index === 0 ? summary : `承接第${chapterNumber - 1}章，推进已确认方案：${summary}`,
        beats,
        hook: extractHook(summary, decision.scope_text),
        ...source
      });
      return outline.artifactVersionId;
    });
    return {
      creativePlanVersionId: creativePlan.artifactVersionId,
      storyBibleVersionId: storyBible.artifactVersionId,
      masterOutlineVersionId: masterOutline.artifactVersionId,
      volumeOutlineVersionId: volumeOutline.artifactVersionId,
      chapterOutlineVersionIds
    };
  }

  private upsert(scope: BookScope, type: ArtifactType, title: string, content: Record<string, unknown>): ArtifactVersionRecord {
    const artifacts = new ArtifactService(this.database, this.ids, this.clock);
    const existing = this.database.prepare(`
      SELECT artifact_id FROM artifacts WHERE owner_id = ? AND book_id = ? AND artifact_type = ? AND title = ?
    `).get(scope.ownerId, scope.bookId, type, title) as { artifact_id: string } | undefined;
    const version = existing === undefined
      ? artifacts.create(scope, type, title, content, 'candidate')
      : artifacts.addVersion(scope, existing.artifact_id, content);
    return artifacts.select(scope, version.artifactId, version.artifactVersionId);
  }

  private positioning(scope: BookScope): Record<string, { value?: unknown }> {
    const row = this.database.prepare(`
      SELECT fields_json FROM positioning_versions WHERE owner_id = ? AND book_id = ? ORDER BY version DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { fields_json: string };
    const fields = JSON.parse(row.fields_json) as Array<{ key: string; value: unknown }>;
    return Object.fromEntries(fields.map((field) => [field.key, { value: field.value }]));
  }

  private currentStoryBible(scope: BookScope): Record<string, unknown> {
    const row = this.database.prepare(`
      SELECT v.content_json FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'story_bible' ORDER BY a.created_at LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { content_json: string } | undefined;
    return row === undefined ? {} : JSON.parse(row.content_json) as Record<string, unknown>;
  }

  private bookTitle(scope: BookScope): string {
    return (this.database.prepare(`SELECT title FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { title: string }).title;
  }

  private nextChapterNumber(scope: BookScope): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(chapter_number), 0) AS last FROM chapters
      WHERE owner_id = ? AND book_id = ? AND settlement_status = 'settled'
    `).get(scope.ownerId, scope.bookId) as { last: number };
    return row.last + 1;
  }

  private currentVolumeNumber(scope: BookScope): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(volume_number), 1) AS volume_number FROM volumes
      WHERE owner_id = ? AND book_id = ? AND status = 'active'
    `).get(scope.ownerId, scope.bookId) as { volume_number: number };
    return row.volume_number;
  }

  private recommendedChapterCount(scope: BookScope, discussionId: string): number {
    const rows = this.database.prepare(`
      SELECT recommended_chapters FROM plot_span_estimates
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ?
        AND round = (SELECT MAX(round) FROM plot_span_estimates WHERE owner_id = ? AND book_id = ? AND discussion_id = ? AND status = 'submitted')
        AND status = 'submitted' AND independence_attested = 1
      ORDER BY plot_span_estimate_id
    `).all(scope.ownerId, scope.bookId, discussionId, scope.ownerId, scope.bookId, discussionId) as unknown as Array<{ recommended_chapters: number }>;
    if (rows.length < 2) throw new Error('创作方案缺少双异模型编剧的独立章节跨度估算');
    return Math.max(1, Math.min(30, Math.round(rows.reduce((sum, row) => sum + row.recommended_chapters, 0) / rows.length)));
  }
}

function readableSummary(recommendation: Record<string, unknown>): string {
  const preferred = recommendation.summary;
  if (typeof preferred === 'string' && preferred.trim().length > 0) return preferred.trim();
  return JSON.stringify(recommendation);
}

function extractBeats(summary: string, scopeText: string, alternatives: unknown[]): string[] {
  const sentences = summary.split(/\r?\n|[。；！？]/u).map((item) => item.replace(/^[-*\d.、\s]+/u, '').trim()).filter((item) => item.length >= 4);
  const alternativeText = alternatives.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const proposal = (item as Record<string, unknown>).proposal;
    return typeof proposal === 'string' ? [proposal.trim()] : [];
  });
  return [...sentences, ...alternativeText, scopeText].filter((item, index, all) => item.length > 0 && all.indexOf(item) === index).slice(0, 6);
}

function extractHook(summary: string, scopeText: string): string {
  const hookLine = summary.split(/\r?\n/u).map((item) => item.trim()).find((item) => /钩子|悬念|章末|结尾/u.test(item));
  return hookLine ?? `章末必须回扣已确认讨论“${scopeText}”，并留下可追踪的新问题`;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
