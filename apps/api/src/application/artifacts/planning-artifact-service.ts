import type { DatabaseSync } from 'node:sqlite';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import {
  parseChapterOutlineV2,
  parseStageMasterOutlineV2,
  type ArtifactType,
  type ChapterOutlineV2,
  type StageMasterOutlineV2
} from '../../domain/artifact-schemas.js';
import { bindChapterOutlineToAuthoritativeStage } from '../../domain/chapter-outline-stage-boundary.js';
import { ArtifactService, type ArtifactVersionRecord } from './artifact-service.js';
import { ExpressionProfileService } from '../books/expression-profile-service.js';
import { ExpressionProfileRepository } from '../../infrastructure/db/repositories/expression-profile-repository.js';
import { UnitOfWork } from '../../infrastructure/db/unit-of-work.js';
import { PlanningStageArtifactService } from './planning-stage-artifact-service.js';
import { PlanningWorkflowRepository } from '../../infrastructure/db/repositories/planning-workflow-repository.js';

interface DecisionRow {
  scope_text: string;
  recommendation_json: string;
  alternatives_json: string;
  boss_confirmed: number;
}

interface StructuredChapterPlan {
  chapterNumber?: number;
  title: string;
  goal?: string;
  beats?: string[];
  hook?: string;
  chapterFunction?: string;
  openingState?: string;
  requiredEndingState?: string;
  cast?: ChapterOutlineV2['cast'];
  conflict?: ChapterOutlineV2['conflict'];
  plotBeats?: ChapterOutlineV2['plotBeats'];
  experience?: ChapterOutlineV2['experience'];
  descriptionFocus?: ChapterOutlineV2['descriptionFocus'];
  informationControl?: ChapterOutlineV2['informationControl'];
  threadActions?: ChapterOutlineV2['threadActions'];
  ending?: ChapterOutlineV2['ending'];
  mustImplement?: string[];
  mustNotViolate?: string[];
  allowedCandidates?: string[];
  creativeFreedom?: string[];
  stageBoundary?: ChapterOutlineV2['stageBoundary'];
  sourceStage?: ChapterOutlineV2['sourceStage'];
}

interface StructuredArcPlan {
  outlineSchema?: 'chapter_outline_v2';
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

type StructuredMasterOutline = StageMasterOutlineV2;

export interface PreparedPlanningArtifacts {
  creativePlanVersionId: string;
  storyBibleVersionId: string;
  masterOutlineVersionId: string;
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
    const brief = JSON.parse(sourceTask.task_brief_json) as {
      purpose?: string;
      requestedChapterCount?: number | null;
    };
    if (brief.purpose !== 'locked_planning') return null;
    const requestedChapterCount = brief.requestedChapterCount;
    const chapterCount = typeof requestedChapterCount === 'number' && Number.isInteger(requestedChapterCount)
      ? requestedChapterCount
      : this.recommendedChapterCount(scope, discussionId);
    return new UnitOfWork(this.database).run(
      () => this.promoteChapterOutlinesOnly(scope, discussionId, decisionId, Math.min(3, chapterCount))
    );
  }

  public promoteCurrentPlanningStage(
    scope: BookScope,
    discussionId: string,
    decisionId: string
  ): { artifactType: 'master_outline'; artifactVersionId: string; stage: string } | null {
    return new UnitOfWork(this.database).run(
      () => this.promoteCurrentPlanningStageInTransaction(scope, discussionId, decisionId)
    );
  }

  private promoteCurrentPlanningStageInTransaction(
    scope: BookScope,
    discussionId: string,
    decisionId: string
  ): { artifactType: 'master_outline'; artifactVersionId: string; stage: string } | null {
    assertBookScope(scope);
    const workflow = new PlanningWorkflowRepository(this.database);
    if (workflow.openingBlueprint(scope) === undefined) return null;
    const state = workflow.planningState(scope);
    if (state === undefined) return null;
    const decision = this.database.prepare(`
      SELECT x.scope_text, d.recommendation_json, d.alternatives_json, d.boss_confirmed
      FROM discussion_decisions d
      JOIN discussions x ON x.discussion_id = d.discussion_id
      WHERE d.decision_id = ? AND d.discussion_id = ?
        AND d.owner_id = ? AND d.book_id = ?
    `).get(decisionId, discussionId, scope.ownerId, scope.bookId) as DecisionRow | undefined;
    if (decision === undefined || decision.boss_confirmed !== 1) {
      throw new Error('只有老板明确确认的讨论结论才能进入规划');
    }
    const rawSummary = readableSummary(
      JSON.parse(decision.recommendation_json) as Record<string, unknown>
    );
    const source = { sourceDiscussionId: discussionId, sourceDecisionId: decisionId };
    const structuredMaster = parseMasterOutlineDepositOutput(rawSummary);

    if (structuredMaster !== null) {
      if (state.setting_baseline_version_id === null) {
        throw new Error('确认剧情总纲前必须先确认设定大纲');
      }
      const version = this.upsert(scope, 'master_outline', '剧情总纲', {
        outlineSchema: structuredMaster.outlineSchema,
        premise: structuredMaster.premise,
        coreConflict: structuredMaster.coreConflict,
        protagonistArc: structuredMaster.protagonistArc,
        majorStages: structuredMaster.majorStages,
        endingDirection: structuredMaster.endingDirection,
        storyPromises: structuredMaster.storyPromises,
        openQuestions: structuredMaster.openQuestions,
        sourceSettingBaselineVersionId: state.setting_baseline_version_id,
        ...source
      });
      // 选定同一剧情总纲的新版本时，ArtifactService 会把规划状态回退到
      // master_outline_ready，并清空退役卷纲的兼容指针。这里不能再按旧
      // version 调用 confirm，否则已经进入章纲阶段的书无法替换总纲。
      if (state.master_outline_version_id !== null) {
        const replaced = workflow.planningState(scope);
        if (replaced?.master_outline_version_id !== version.artifactVersionId) {
          throw new Error('新版剧情总纲已经生成，但未能切换为当前版本');
        }
        return {
          artifactType: 'master_outline',
          artifactVersionId: version.artifactVersionId,
          stage: replaced.stage
        };
      }
      if (!['setting_ready', 'master_outline_in_progress'].includes(state.stage)) {
        throw new Error('首次确认剧情总纲时规划阶段不匹配');
      }
      const advanced = new PlanningStageArtifactService(this.database, this.clock)
        .confirm(scope, state.version, version.artifactVersionId, 'master_outline');
      return { artifactType: 'master_outline', artifactVersionId: version.artifactVersionId, stage: advanced.stage };
    }

    if (['setting_ready', 'master_outline_in_progress'].includes(state.stage)) {
      throw new Error('剧情总纲缺少有效的全书级结构，不能把普通讨论总结重复写入剧情总纲');
    }

    return null;
  }

  private promoteChapterOutlinesOnly(
    scope: BookScope,
    discussionId: string,
    decisionId: string,
    chapterCount: number
  ): PreparedPlanningArtifacts {
    assertBookScope(scope);
    const state = this.database.prepare(`
      SELECT version, active_style_version_id, setting_baseline_version_id,
        master_outline_version_id
      FROM book_planning_states
      WHERE owner_id = ? AND book_id = ? AND stage IN ('master_outline_ready', 'chapter_outline_ready', 'writing_enabled')
    `).get(scope.ownerId, scope.bookId) as {
      version: number;
      active_style_version_id: string | null;
      setting_baseline_version_id: string | null;
      master_outline_version_id: string | null;
    } | undefined;
    if (state === undefined || state.active_style_version_id === null || state.setting_baseline_version_id === null
      || state.master_outline_version_id === null) {
      throw new Error('滚动章纲只能在表达策略记录、设定和剧情总纲依次就绪后生成');
    }
    const decision = this.database.prepare(`
      SELECT x.scope_text, d.recommendation_json, d.alternatives_json, d.boss_confirmed
      FROM discussion_decisions d JOIN discussions x ON x.discussion_id = d.discussion_id
      WHERE d.decision_id = ? AND d.discussion_id = ? AND d.owner_id = ? AND d.book_id = ?
    `).get(decisionId, discussionId, scope.ownerId, scope.bookId) as DecisionRow | undefined;
    if (decision === undefined || decision.boss_confirmed !== 1) throw new Error('只有老板明确确认的讨论决定才能生成章纲');
    const recommendation = JSON.parse(decision.recommendation_json) as Record<string, unknown>;
    const summary = readableSummary(recommendation);
    const structured = parsePlanningDepositOutput(summary);
    if (structured === null || structured.outlineSchema !== 'chapter_outline_v2') {
      throw new Error('滚动章纲缺少chapter_outline_v2结构，不能用通用模板替代真实章纲');
    }
    if (structured.chapters.length !== chapterCount) {
      throw new Error(`滚动章纲必须只细化未来${chapterCount}章`);
    }
    const firstChapterNumber = this.nextChapterNumber(scope);
    const chapterPlans = structured.chapters;
    assertSequentialChapterPlans(chapterPlans, firstChapterNumber);
    const masterOutline = parseStageMasterOutlineV2(
      this.artifactVersionContent(scope, state.master_outline_version_id)
    );
    const source = {
      sourceDiscussionId: discussionId,
      sourceDecisionId: decisionId,
      sourceMasterOutlineVersionId: state.master_outline_version_id,
      sourceStyleVersionId: state.active_style_version_id,
      sourceSettingBaselineVersionId: state.setting_baseline_version_id
    };
    const chapterOutlineVersionIds = chapterPlans.map((plan, index) => {
      const chapterNumber = firstChapterNumber + index;
      const stage = masterOutline.majorStages.find((item) => (
        chapterNumber >= item.chapterRange.start && chapterNumber <= item.chapterRange.end
      ));
      if (stage === undefined) {
        throw new Error(`剧情总纲没有覆盖第${chapterNumber}章，不能生成失去上游来源的章纲`);
      }
      const parsedCandidate = parseChapterOutlineV2({
        ...plan,
        outlineSchema: 'chapter_outline_v2',
        chapterNumber,
        sourceStage: {
          stageNumber: stage.stageNumber,
          title: stage.title,
          chapterRange: stage.chapterRange
        }
      });
      const parsed = bindChapterOutlineToAuthoritativeStage(parsedCandidate, stage);
      return this.upsert(
        scope,
        'chapter_outline',
        `第${chapterNumber}章章纲`,
        { ...parsed, ...source }
      ).artifactVersionId;
    });
    this.ensureConfirmedExpression(scope, decisionId);
    new PlanningStageArtifactService(this.database, this.clock).confirm(
      scope,
      state.version,
      chapterOutlineVersionIds[0]!,
      'chapter_outline'
    );
    return {
      creativePlanVersionId: state.active_style_version_id,
      storyBibleVersionId: state.setting_baseline_version_id,
      masterOutlineVersionId: state.master_outline_version_id,
      chapterOutlineVersionIds
    };
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
    const detailedChapterCount = chapterCount;
    if (structuredPlan !== null && structuredPlan.chapters.length !== detailedChapterCount) {
      throw new Error(`滚动章纲必须从当前下一章开始连续细化${detailedChapterCount}章，不能跳章、少章或错位`);
    }
    const narrativeSummary = stripPlanningDeposit(summary);
    const positioning = this.positioning(scope);
    this.ensureConfirmedExpression(scope, decisionId);
    const premise = stringValue(positioning.premise?.value) ?? decision.scope_text;
    const audience = stringValue(positioning.audience?.value) ?? '后续规划继续细化';
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
    const fallbackStages = ['建立本弧核心冲突并迫使主角作出第一次选择', '让选择产生可见代价并升级阻力', '形成阶段转折并打开下一步问题'];
    const chapterPlans = structuredPlan?.chapters ?? Array.from({ length: detailedChapterCount }, (_, index) => ({
      title: `第${firstChapterNumber + index}章`,
      goal: `${fallbackStages[index] ?? '推进已确认故事弧'}：${narrativeSummary}`,
      beats,
      hook: extractHook(narrativeSummary, decision.scope_text)
    }));
    assertSequentialChapterPlans(chapterPlans, firstChapterNumber);
    const currentMasterOutline = this.currentArtifactContent(scope, 'master_outline', '总纲');
    const currentActs = asArray(currentMasterOutline.acts).filter(isRecord);
    const newActs = chapterPlans.map((plan, index) => ({
      chapterNumber: firstChapterNumber + index,
      title: plan.title,
      objective: plan.goal
    }));
    const mergedActs = mergeNumberedItems(currentActs, newActs, 'chapterNumber');
    const masterOutline = this.upsert(scope, 'master_outline', '总纲', {
      premise,
      acts: mergedActs,
      endingDirection: stringValue(positioning.ending?.value) ?? '尚未锁定；后续由老板确认',
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
        sourceMasterOutlineVersionId: masterOutline.artifactVersionId,
        storyArc: {
          title: structuredPlan?.arcTitle ?? '当前故事弧',
          goal: structuredPlan?.arcGoal ?? narrativeSummary,
          endingState: structuredPlan?.endingState ?? extractHook(narrativeSummary, decision.scope_text)
        },
        ...source
      });
      return outline.artifactVersionId;
    });
    return {
      creativePlanVersionId: creativePlan.artifactVersionId,
      storyBibleVersionId: storyBible.artifactVersionId,
      masterOutlineVersionId: masterOutline.artifactVersionId,
      chapterOutlineVersionIds
    };
  }

  private ensureConfirmedExpression(scope: BookScope, decisionId: string): void {
    const positioning = this.positioning(scope);
    const expressionProfiles = new ExpressionProfileService(
      new ExpressionProfileRepository(this.database), new UnitOfWork(this.database), this.ids, this.clock
    );
    const currentExpression = expressionProfiles.active(scope);
    if (currentExpression?.status === 'confirmed'
      && currentExpression.narrativePerson !== null
      && currentExpression.viewpointDistance !== null) {
      return;
    }
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

  private currentArtifactContent(scope: BookScope, type: ArtifactType, title: string): Record<string, unknown> {
    const row = this.database.prepare(`
      SELECT v.content_json FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = ? AND a.title = ?
        AND a.status = 'active' AND v.status = 'selected'
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, type, title) as { content_json: string } | undefined;
    return row === undefined ? {} : JSON.parse(row.content_json) as Record<string, unknown>;
  }

  private artifactVersionContent(scope: BookScope, artifactVersionId: string): Record<string, unknown> {
    const row = this.database.prepare(`
      SELECT content_json FROM artifact_versions
      WHERE owner_id = ? AND book_id = ? AND artifact_version_id = ?
      LIMIT 1
    `).get(scope.ownerId, scope.bookId, artifactVersionId) as { content_json: string } | undefined;
    if (row === undefined) throw new Error('规划状态引用的成果版本不存在');
    return JSON.parse(row.content_json) as Record<string, unknown>;
  }

  private bookTitle(scope: BookScope): string {
    return (this.database.prepare(`SELECT title FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { title: string }).title;
  }

  private nextChapterNumber(scope: BookScope): number {
    return nextChapterPlanningNumber(this.database, scope);
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

export function nextChapterPlanningNumber(database: DatabaseSync, scope: BookScope): number {
  assertBookScope(scope);
  const row = database.prepare(`
    SELECT MAX(last_chapter) AS last_chapter
    FROM (
      SELECT COALESCE(MAX(chapter_number), 0) AS last_chapter
      FROM chapters
      WHERE owner_id = ? AND book_id = ?
      UNION ALL
      SELECT COALESCE(MAX(CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER)), 0) AS last_chapter
      FROM artifacts a
      JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ?
        AND a.artifact_type = 'chapter_outline'
        AND a.status = 'active' AND v.status = 'selected'
    )
  `).get(scope.ownerId, scope.bookId, scope.ownerId, scope.bookId) as { last_chapter: number | null };
  return (row.last_chapter ?? 0) + 1;
}

function assertSequentialChapterPlans(chapters: StructuredChapterPlan[], firstChapterNumber: number): void {
  chapters.forEach((chapter, index) => {
    const expected = firstChapterNumber + index;
    if (chapter.chapterNumber !== undefined && chapter.chapterNumber !== expected) {
      throw new Error(`滚动章纲章位错位：当前必须从第${firstChapterNumber}章连续规划，但收到第${chapter.chapterNumber}章`);
    }
  });
}

function chapterNumberFromTitle(title: string): number | null {
  const matched = title.match(/第\s*(\d{1,4})\s*章/u);
  return matched === null ? null : Number.parseInt(matched[1]!, 10);
}

export function parsePlanningDepositOutput(summary: string): StructuredArcPlan | null {
  const workflowPayload = parseWorkflowArtifact(summary, 'chapter_outline');
  const text = effectivePlanningText(summary);
  const marker = /规划落库(?:\*\*)?/u.exec(text);
  const markedCandidate = marker === null
    ? null
    : extractCompleteJsonObject(text.slice(marker.index + marker[0].length));
  if (workflowPayload === null && marker !== null && markedCandidate === null) {
    throw new Error('规划落库JSON无法解析，不能用重复模板代替真实章纲');
  }
  let value: unknown = workflowPayload;
  if (value === null) {
    const candidate = markedCandidate ?? extractCompleteJsonObjects(text)
      .map((item) => item.value)
      .reverse()
      .find(isPlanningDepositJson) ?? null;
    if (candidate === null) return null;
    try {
      value = JSON.parse(candidate);
    } catch {
      throw new Error('规划落库JSON无法解析，不能用重复模板代替真实章纲');
    }
  }
  if (!isRecord(value) || !Array.isArray(value.chapters) || value.chapters.length < 1 || value.chapters.length > 30) {
    throw new Error('滚动规划必须包含未来1至3个章节方案');
  }
  const isV2 = value.outlineSchema === 'chapter_outline_v2';
  const chapters = value.chapters.map((item, index): StructuredChapterPlan => {
    if (!isRecord(item)) throw new Error(`规划落库第${index + 1}章不是有效对象`);
    const title = stringValue(item.title);
    const chapterNumber = integerValue(item.chapterNumber) ?? (title === null ? null : chapterNumberFromTitle(title));
    if (isV2) {
      if (chapterNumber === null) throw new Error(`规划落库第${index + 1}章缺少绝对章号`);
      const parsed = parseChapterOutlineV2({
        ...item,
        outlineSchema: 'chapter_outline_v2',
        chapterNumber,
        sourceStage: item.sourceStage ?? {
          stageNumber: 1,
          title: '待服务端绑定的剧情总纲阶段',
          chapterRange: { start: chapterNumber, end: chapterNumber }
        }
      });
      const { outlineSchema: _outlineSchema, ...plan } = parsed;
      return plan;
    }
    const goal = stringValue(item.goal);
    const hook = stringValue(item.hook);
    const beats = stringArray(item.beats).map((beat) => beat.trim()).filter(Boolean);
    if (title === null || goal === null || hook === null || beats.length === 0) {
      throw new Error(`规划落库第${index + 1}章缺少标题、目标、推进节点或钩子`);
    }
    return { ...(chapterNumber === null ? {} : { chapterNumber }), title, goal, beats, hook };
  });
  const uniqueFunctions = chapters.map((chapter) => chapter.chapterFunction ?? chapter.goal);
  if (new Set(uniqueFunctions).size !== chapters.length) {
    throw new Error('规划落库存在重复章节功能，不能生成模板化章纲');
  }
  const estimatedChapterRange = parseChapterRange(value.estimatedChapterRange);
  return {
    ...(isV2 ? { outlineSchema: 'chapter_outline_v2' as const } : {}),
    arcTitle: stringValue(value.arcTitle) ?? '当前故事弧',
    arcGoal: stringValue(value.arcGoal) ?? chapters.map((chapter) => chapter.chapterFunction ?? chapter.goal).join('；'),
    endingState: stringValue(value.endingState)
      ?? chapters.at(-1)!.ending?.nextChapterInterface
      ?? chapters.at(-1)!.hook
      ?? '继续下一章',
    estimatedChapterRange,
    chapters
  };
}

export function parseMasterOutlineDepositOutput(summary: string): StructuredMasterOutline | null {
  const value = parseMarkedDeposit(summary, '剧情总纲落库');
  if (value === null) return null;
  return parseStageMasterOutlineV2(value);
}

function parseMarkedDeposit(summary: string, markerText: '剧情总纲落库'): Record<string, unknown> | null {
  const workflowPayload = parseWorkflowArtifact(summary, 'master_outline');
  if (workflowPayload !== null) return workflowPayload;
  const text = effectivePlanningText(summary);
  const marker = new RegExp(`${markerText}(?:\\*\\*)?`, 'u').exec(text);
  if (marker === null) return null;
  const candidate = extractCompleteJsonObject(text.slice(marker.index + marker[0].length));
  if (candidate === null) throw new Error(`${markerText}JSON无法解析`);
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    throw new Error(`${markerText}JSON无法解析`);
  }
  if (!isRecord(value)) throw new Error(`${markerText}必须是有效对象`);
  return value;
}

function parseWorkflowArtifact(summary: string, expectedType: string): Record<string, unknown> | null {
  for (const candidate of extractCompleteJsonObjects(summary)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.value) as unknown;
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const fields = isRecord(parsed.fields) ? parsed.fields : parsed;
    const artifact = isRecord(fields.workflowArtifact)
      ? fields.workflowArtifact
      : fields.type === expectedType && isRecord(fields.payload)
        ? fields
        : null;
    if (!isRecord(artifact) || artifact.type !== expectedType || !isRecord(artifact.payload)) continue;
    return artifact.payload;
  }
  return null;
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
  if (marker !== null) {
    const suffix = text.slice(marker.index + marker[0].length);
    const candidate = extractCompleteJsonObject(suffix);
    if (candidate === null) return text.trim();
    const candidateStart = suffix.indexOf(candidate);
    return effectivePlanningText(`${text.slice(0, marker.index)}${suffix.slice(candidateStart + candidate.length)}`
      .replace(/```(?:json)?|```/giu, '').trim());
  }
  const deposit = extractCompleteJsonObjects(text).reverse().find((item) => isPlanningDepositJson(item.value));
  if (deposit === undefined) return text.trim();
  return effectivePlanningText(`${text.slice(0, deposit.start)}${text.slice(deposit.end)}`
    .replace(/```(?:json)?|```/giu, '').trim());
}

function extractCompleteJsonObject(value: string): string | null {
  return extractCompleteJsonObjects(value)[0]?.value ?? null;
}

function extractCompleteJsonObjects(value: string): Array<{ value: string; start: number; end: number }> {
  const objects: Array<{ value: string; start: number; end: number }> = [];
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
        if (depth === 0) {
          objects.push({ value: value.slice(start, index + 1), start, end: index + 1 });
          start = index;
          break;
        }
      }
    }
  }
  return objects;
}

function isPlanningDepositJson(candidate: string): boolean {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) && Array.isArray(parsed.chapters)
      && (typeof parsed.arcTitle === 'string' || typeof parsed.arcGoal === 'string');
  } catch {
    return false;
  }
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

export function mergeNumberedItems(
  current: Record<string, unknown>[],
  incoming: Record<string, unknown>[],
  numberKey: string
): Record<string, unknown>[] {
  const merged = new Map<number, Record<string, unknown>>();
  for (const item of [...current, ...incoming]) {
    const number = integerValue(item[numberKey]);
    if (number !== null) merged.set(number, item);
  }
  return [...merged.entries()].sort(([left], [right]) => left - right).map(([, item]) => item);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
