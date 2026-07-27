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

interface StructuredChapterPlan {
  title: string;
  goal: string;
  beats: string[];
  hook: string;
}

interface StructuredArcPlan {
  arcTitle: string;
  arcGoal: string;
  endingState: string;
  estimatedChapterRange: {
    minimum: number;
    recommended: number;
    maximum: number;
  } | null;
  chapters: StructuredChapterPlan[];
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
    if (brief.purpose !== 'locked_planning') return null;
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
    const structuredPlan = parsePlanningDepositOutput(summary);
    if (structuredPlan !== null && structuredPlan.chapters.length > Math.min(3, chapterCount)) {
      throw new Error(`滚动章纲只能细化未来1至${Math.min(3, chapterCount)}章`);
    }
    const narrativeSummary = stripPlanningDeposit(summary);
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
      confirmedRecommendation: narrativeSummary,
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
        confirmed: { summary: narrativeSummary, scope: decision.scope_text, ...source },
        candidates: []
      },
      planningHistory: [...asArray(currentBible.planningHistory), { summary: narrativeSummary, scope: decision.scope_text, ...source }]
    });
    const firstChapterNumber = this.nextChapterNumber(scope);
    const beats = extractBeats(narrativeSummary, decision.scope_text, alternatives);
    const detailedChapterCount = Math.min(3, chapterCount);
    const fallbackStages = ['建立本弧核心冲突并迫使主角作出第一次选择', '让选择产生可见代价并升级阻力', '形成阶段转折并打开下一步问题'];
    const chapterPlans = structuredPlan?.chapters ?? Array.from({ length: detailedChapterCount }, (_, index) => ({
      title: `第${firstChapterNumber + index}章`,
      goal: `${fallbackStages[index] ?? '推进已确认故事弧'}：${narrativeSummary}`,
      beats,
      hook: extractHook(narrativeSummary, decision.scope_text)
    }));
    const masterOutline = this.upsert(scope, 'master_outline', '总纲', {
      premise,
      acts: chapterPlans.map((plan, index) => ({
        chapterNumber: firstChapterNumber + index,
        title: plan.title,
        objective: plan.goal
      })),
      endingDirection: stringValue(positioning.ending?.value) ?? '尚未锁定；后续由老板确认',
      ...source
    });
    const volumeNumber = this.currentVolumeNumber(scope);
    const volumeOutline = this.upsert(scope, 'volume_outline', `第${volumeNumber}卷卷纲`, {
      volumeNumber,
      goal: structuredPlan?.arcGoal ?? narrativeSummary,
      arcs: [{
        title: structuredPlan?.arcTitle ?? '当前故事弧',
        chapterStart: firstChapterNumber,
        chapterEnd: firstChapterNumber + chapterCount - 1,
        objective: structuredPlan?.arcGoal ?? narrativeSummary,
        status: 'active'
      }],
      endingState: structuredPlan?.endingState ?? extractHook(narrativeSummary, decision.scope_text),
      ...source
    });
    const chapterOutlineVersionIds = Array.from({ length: chapterPlans.length }, (_, index) => {
      const chapterNumber = firstChapterNumber + index;
      const plan = chapterPlans[index]!;
      const outline = this.upsert(scope, 'chapter_outline', `第${chapterNumber}章章纲`, {
        chapterNumber,
        title: plan.title,
        goal: plan.goal,
        beats: plan.beats,
        hook: plan.hook,
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
    const decision = this.database.prepare(`
      SELECT recommendation_json FROM discussion_decisions
      WHERE owner_id = ? AND book_id = ? AND discussion_id = ? AND boss_confirmed = 1
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId, discussionId) as { recommendation_json: string } | undefined;
    if (decision !== undefined) {
      const recommendation = JSON.parse(decision.recommendation_json) as Record<string, unknown>;
      const structured = parsePlanningDepositOutput(readableSummary(recommendation));
      if (structured?.estimatedChapterRange !== null && structured?.estimatedChapterRange !== undefined) {
        return structured.estimatedChapterRange.recommended;
      }
    }
    return Math.max(1, Math.min(30, Math.round(rows.reduce((sum, row) => sum + row.recommended_chapters, 0) / rows.length)));
  }
}

export function parsePlanningDepositOutput(summary: string): StructuredArcPlan | null {
  const text = effectivePlanningText(summary);
  const marker = /规划落库(?:\*\*)?/u.exec(text);
  if (marker === null) return null;
  const candidate = extractCompleteJsonObject(text.slice(marker.index + marker[0].length));
  if (candidate === null) throw new Error('规划落库JSON无法解析，不能用重复模板代替真实章纲');
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    throw new Error('规划落库JSON无法解析，不能用重复模板代替真实章纲');
  }
  if (!isRecord(value) || !Array.isArray(value.chapters) || value.chapters.length < 1 || value.chapters.length > 3) {
    throw new Error('滚动规划必须包含未来1至3个章节方案');
  }
  const chapters = value.chapters.map((item, index): StructuredChapterPlan => {
    if (!isRecord(item)) throw new Error(`规划落库第${index + 1}章不是有效对象`);
    const title = stringValue(item.title);
    const goal = stringValue(item.goal);
    const hook = stringValue(item.hook);
    const beats = stringArray(item.beats).map((beat) => beat.trim()).filter(Boolean);
    if (title === null || goal === null || hook === null || beats.length === 0) {
      throw new Error(`规划落库第${index + 1}章缺少标题、目标、推进节点或钩子`);
    }
    return { title, goal, beats, hook };
  });
  if (new Set(chapters.map((chapter) => chapter.goal)).size !== chapters.length) {
    throw new Error('规划落库存在重复章节目标，不能生成模板化章纲');
  }
  const estimatedChapterRange = parseChapterRange(value.estimatedChapterRange);
  return {
    arcTitle: stringValue(value.arcTitle) ?? '当前故事弧',
    arcGoal: stringValue(value.arcGoal) ?? chapters.map((chapter) => chapter.goal).join('；'),
    endingState: stringValue(value.endingState) ?? chapters.at(-1)!.hook,
    estimatedChapterRange,
    chapters
  };
}

function parseChapterRange(value: unknown): StructuredArcPlan['estimatedChapterRange'] {
  if (!isRecord(value)) return null;
  const minimum = integerValue(value.minimum);
  const recommended = integerValue(value.recommended);
  const maximum = integerValue(value.maximum);
  if (minimum === null || recommended === null || maximum === null
    || minimum < 1 || maximum > 30 || minimum > recommended || recommended > maximum) {
    throw new Error('规划落库的章节跨度必须是1至30章内递增的最少、建议和最多章数');
  }
  return { minimum, recommended, maximum };
}

function stripPlanningDeposit(summary: string): string {
  const text = effectivePlanningText(summary);
  const marker = /规划落库(?:\*\*)?/u.exec(text);
  if (marker === null) return text.trim();
  const suffix = text.slice(marker.index + marker[0].length);
  const candidate = extractCompleteJsonObject(suffix);
  if (candidate === null) return text.trim();
  const candidateStart = suffix.indexOf(candidate);
  return `${text.slice(0, marker.index)}${suffix.slice(candidateStart + candidate.length)}`
    .replace(/```(?:json)?|```/giu, '').trim();
}

function extractCompleteJsonObject(value: string): string | null {
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) return value.slice(start, index + 1);
      }
    }
  }
  return null;
}

function effectivePlanningText(summary: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(summary);
  } catch {
    return summary;
  }
  if (!isRecord(parsed)) return summary;
  const payload = isRecord(parsed.fields) ? parsed.fields : parsed;
  const sections: string[] = [];
  for (const key of ['answer', 'details', 'nextStep'] as const) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) sections.push(value.trim());
  }
  for (const key of ['keyPoints', 'risks', 'questions'] as const) {
    const value = payload[key];
    if (Array.isArray(value)) sections.push(...value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
  }
  if (Array.isArray(payload.alternatives)) {
    for (const item of payload.alternatives) {
      if (!isRecord(item)) continue;
      for (const key of ['title', 'content', 'tradeoff'] as const) {
        const value = item[key];
        if (typeof value === 'string' && value.trim().length > 0) sections.push(value.trim());
      }
    }
  }
  return sections.length > 0 ? sections.join('\n') : summary;
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

function integerValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
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
