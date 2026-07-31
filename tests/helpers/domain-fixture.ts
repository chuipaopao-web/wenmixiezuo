import { BookOnboardingService, type OnboardingResult } from '../../apps/api/src/application/books/book-onboarding-service.js';
import { PositioningService } from '../../apps/api/src/application/books/positioning-service.js';
import type { Clock, IdGenerator } from '../../apps/api/src/domain/ids.js';
import type { TestContext } from './test-context.js';
import { DiscussionService } from '../../apps/api/src/application/discussions/discussion-service.js';
import { PlanningArtifactService } from '../../apps/api/src/application/artifacts/planning-artifact-service.js';
import type { BookScope } from '../../apps/api/src/domain/scope.js';
import type { ChapterRequestCount } from '../../apps/api/src/application/creation/writing-readiness-service.js';
import { ChapterApprovalService } from '../../apps/api/src/application/creation/chapter-approval-service.js';
import { ProductionWorkflowRepository } from '../../apps/api/src/infrastructure/db/repositories/production-workflow-repository.js';
import { ChapterCatalogService } from '../../apps/api/src/application/chapters/chapter-catalog-service.js';
import { CanonService } from '../../apps/api/src/application/knowledge/canon-service.js';
import { TaskService } from '../../apps/api/src/application/tasks/task-service.js';
import { ArtifactService } from '../../apps/api/src/application/artifacts/artifact-service.js';

export function initializeDomainBook(
  context: TestContext,
  ownerId: string,
  ids: IdGenerator,
  clock: Clock,
  input: { title?: string; text?: string; category?: string; tags?: string[]; style?: string } = {}
): OnboardingResult {
  const positioning = new PositioningService(context.database, ids, clock);
  const draft = positioning.createDraft(
    { ownerId },
    {
      title: input.title ?? '领域测试书',
      text: input.text ?? '一个游戏副本中的成长故事',
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.style === undefined ? {} : { style: input.style })
    }
  );
  return new BookOnboardingService(context.database, ids, clock).confirmDraft({ ownerId }, draft.draftId, draft.version);
}

export function prepareBookForWriting(
  context: TestContext,
  scope: BookScope,
  ids: IdGenerator,
  clock: Clock,
  count: ChapterRequestCount = 1
): { discussionId: string; decisionId: string } {
  const agents = context.database.prepare(`
    SELECT a.agent_id, a.model_snapshot_id, r.role_key FROM agent_instances a
    JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
    WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter')
    ORDER BY CASE r.role_key WHEN 'chief_editor' THEN 0 ELSE 1 END
  `).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; model_snapshot_id: string; role_key: string }>;
  const editor = agents.find((agent) => agent.role_key === 'chief_editor')!;
  const plot = agents.find((agent) => agent.role_key === 'lead_screenwriter')!;
  const discussions = new DiscussionService(context.database, ids, clock);
  const discussion = discussions.create(scope, {
    type: 'quick',
    scopeText: `测试已确认创作方案，共${count}章`,
    createdByAgentId: editor.agent_id,
    participants: [
      { agentId: editor.agent_id, reason: '测试主编汇总' },
      { agentId: plot.agent_id, reason: '测试编剧方案' }
    ]
  });
  discussions.addOpinion(scope, discussion.discussionId, {
    agentId: plot.agent_id,
    modelSnapshotId: plot.model_snapshot_id,
    phase: 'independent',
    content: { recommendation: '第一章建立人物目标与冲突，章末留下来自核心矛盾的具体钩子。' },
    tokens: 20
  });
  discussions.addOpinion(scope, discussion.discussionId, {
    agentId: editor.agent_id,
    modelSnapshotId: editor.model_snapshot_id,
    phase: 'independent',
    content: { recommendation: '确认以书籍定位为前提，逐章推进核心冲突，不补造定位之外的关键设定。' },
    tokens: 20
  });
  discussions.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
  const decisionId = discussions.synthesize(scope, discussion.discussionId, {
    recommendation: { summary: '以书籍定位中的核心创意为起点，第一章建立人物目标与核心冲突，每章用可验证的行动推进并留下具体钩子。' },
    alternatives: [{ role: '编剧', proposal: '第一章建立人物目标与冲突，章末留下来自核心矛盾的具体钩子。' }],
    disagreements: [],
    impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
  });
  discussions.confirm(scope, discussion.discussionId, decisionId);
  const prepared = new PlanningArtifactService(context.database, ids, clock)
    .promoteConfirmedDecision(scope, discussion.discussionId, decisionId, count);
  const artifacts = new ArtifactService(context.database, ids, clock);
  const legacyMaster = artifacts.requireVersion(scope, prepared.masterOutlineVersionId);
  const currentMaster = artifacts.addVersion(
    scope,
    legacyMaster.artifactId,
    testStageMasterOutlineV2()
  );
  artifacts.select(scope, currentMaster.artifactId, currentMaster.artifactVersionId);
  const currentChapterOutlineVersionIds = prepared.chapterOutlineVersionIds.map((versionId, index) => {
    const previous = artifacts.requireVersion(scope, versionId);
    const chapterNumber = index + 1;
    const next = artifacts.addVersion(
      scope,
      previous.artifactId,
      testChapterOutlineV2(
        chapterNumber,
        currentMaster.artifactVersionId,
        discussion.discussionId,
        decisionId
      )
    );
    artifacts.select(scope, next.artifactId, next.artifactVersionId);
    return next.artifactVersionId;
  });
  const styleVersionId = ids.next();
  const now = clock.now().toISOString();
  const nextStyleVersion = (context.database.prepare(`
    SELECT COALESCE(MAX(version), 0) + 1 AS next
    FROM book_style_versions
    WHERE owner_id = ? AND book_id = ?
  `).get(scope.ownerId, scope.bookId) as { next: number }).next;
  context.database.prepare(`
    UPDATE book_style_versions SET status = 'superseded'
    WHERE owner_id = ? AND book_id = ? AND status = 'selected'
  `).run(scope.ownerId, scope.bookId);
  context.database.prepare(`
    INSERT INTO book_style_versions (
      style_version_id, owner_id, book_id, version, content_json, source_kind, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'owner', 'selected', ?)
  `).run(styleVersionId, scope.ownerId, scope.bookId, nextStyleVersion, JSON.stringify({
    languageTones: ['自然'], emotionalTones: ['有张力'], pacingAndPayoff: ['推进明确'],
    atmospheres: ['沉浸'], custom: [], adaptiveRules: [], avoidPatterns: []
  }), now);
  context.database.prepare(`
    UPDATE book_planning_states
    SET version = version + 1, stage = 'chapter_outline_ready',
      active_style_version_id = ?, setting_baseline_version_id = ?,
      master_outline_version_id = ?, volume_outline_version_id = NULL, updated_at = ?
    WHERE owner_id = ? AND book_id = ?
  `).run(
    styleVersionId, prepared.storyBibleVersionId, currentMaster.artifactVersionId,
    now, scope.ownerId, scope.bookId
  );
  if (count > currentChapterOutlineVersionIds.length) {
    for (let chapterNumber = currentChapterOutlineVersionIds.length + 1; chapterNumber <= count; chapterNumber += 1) {
      const version = artifacts.create(scope, 'chapter_outline', `第${chapterNumber}章章纲`, {
        ...testChapterOutlineV2(
          chapterNumber,
          currentMaster.artifactVersionId,
          discussion.discussionId,
          decisionId
        )
      }, 'candidate');
      artifacts.select(scope, version.artifactId, version.artifactVersionId);
    }
  }
  return { discussionId: discussion.discussionId, decisionId };
}

function testStageMasterOutlineV2(): Record<string, unknown> {
  return {
    outlineSchema: 'stage_master_v2',
    premise: '主角必须在既有秩序失效后用可验证行动重新取得选择权',
    coreConflict: '个人生存目标与持续升级的外部规则压力发生冲突',
    protagonistArc: '主角从只顾自保成长为愿意承担选择后果的人',
    majorStages: [
      {
        stageNumber: 1,
        title: '取得立足点',
        chapterRange: { start: 1, end: 50 },
        mainline: {
          encounter: '主角失去原有退路并面对第一轮现实限制',
          resolution: '通过可验证行动建立临时立足点',
          result: '取得继续推进核心目标的资格'
        },
        structure: {
          setup: '旧秩序失效并暴露直接危机',
          development: '人物关系、资源和对手压力同步升级',
          turn: '首次胜利暴露更深层的规则问题',
          conclusion: '主角守住立足点并主动承担下一步责任'
        },
        stageSummary: '主角完成从被动求生到主动选择的第一次转变',
        pendingThreads: ['更深层规则的操纵者尚未查明'],
        followUpDirection: '追查规则来源并扩大可以信任的协作范围'
      },
      {
        stageNumber: 2,
        title: '争夺规则权',
        chapterRange: { start: 51, end: 100 },
        mainline: {
          encounter: '既得利益者利用规则围堵主角',
          resolution: '主角联合受损者公开证据并建立替代方案',
          result: '打破局部垄断但暴露真正对手'
        },
        structure: {
          setup: '第一阶段成果触动既得利益',
          development: '联盟建立并因代价出现分歧',
          turn: '关键盟友的选择迫使主角改变策略',
          conclusion: '主角赢得阶段规则权并进入更大冲突'
        },
        stageSummary: '主角从个人行动者成长为能够组织协作的人',
        pendingThreads: ['幕后对手的最终目标仍未确认'],
        followUpDirection: '把局部成果推向更大范围并验证联盟稳定性'
      }
    ],
    endingDirection: '主角最终建立允许普通人参与并承担责任的新秩序',
    storyPromises: ['每次阶段胜利都必须伴随可见代价'],
    openQuestions: []
  };
}

function testChapterOutlineV2(
  chapterNumber: number,
  masterOutlineVersionId: string,
  discussionId: string,
  decisionId: string
): Record<string, unknown> {
  return {
    outlineSchema: 'chapter_outline_v2',
    chapterNumber,
    title: `第${chapterNumber}章的选择`,
    sourceStage: {
      stageNumber: 1,
      title: '取得立足点',
      chapterRange: { start: 1, end: 50 }
    },
    chapterFunction: `让主角在第${chapterNumber}章通过行动推进核心冲突并承担结果`,
    openingState: '上一阶段形成的限制仍然有效，主角尚未取得无代价的解决办法',
    requiredEndingState: '主角的选择已经形成可验证结果，并打开下一章的问题',
    cast: [{
      name: '主角',
      objective: '推进当前目标并守住已经确认的底线',
      knowledgeBoundary: '只知道已经验证的当前事实，不知道幕后真相',
      chapterRole: '主动选择并承担结果',
      stateChange: '对当前局势获得一项新的判断'
    }],
    conflict: {
      surface: '现实限制阻止主角直接达成目标',
      underlying: '短期收益与长期责任发生冲突',
      failureCost: '失去继续推进当前阶段目标的机会',
      successCost: '即使成功也必须承担新的责任'
    },
    plotBeats: [
      { order: 1, trigger: '限制条件公开', action: '主角核对事实并确认选择范围', result: '排除没有代价的虚假选项' },
      { order: 2, trigger: '外部压力升级', action: '主角作出可验证行动', resistance: '行动立即引发反制', result: '选择的代价开始兑现' },
      { order: 3, trigger: '新事实出现', action: '主角调整局部策略但不撤回选择', turn: '有限成果伴随新的责任', result: '局面进入下一章可承接状态' }
    ],
    experience: {
      primaryTone: '紧张中保留决断感',
      emotionalCurve: ['受压', '决断', '有限释放'],
      payoffPoints: ['主角用行动夺回局部主动权'],
      pressurePoints: ['成功也带来现实损失']
    },
    descriptionFocus: {
      primary: ['人物选择和行动后果'],
      secondary: ['环境压力的具体表现'],
      compress: ['重复说明已有规则']
    },
    informationControl: {
      reveals: ['当前限制的一个可验证事实'],
      concealed: ['幕后真相'],
      gaps: ['主角不知道对手完整目的']
    },
    threadActions: [],
    ending: {
      result: '当前行动形成明确结果',
      stateChanges: ['主角处境发生变化'],
      hook: '结果中出现指向更大冲突的异常',
      nextChapterInterface: '下一章核验异常并处理选择的后果'
    },
    mustImplement: ['因果必须由人物行动推动'],
    mustNotViolate: ['不得把未知信息写成主角已经知道'],
    allowedCandidates: ['具体场景地点可按现有设定选择'],
    creativeFreedom: ['对白、动作、意象、局部调度和场景节奏由主笔创造'],
    sourceMasterOutlineVersionId: masterOutlineVersionId,
    sourceDiscussionId: discussionId,
    sourceDecisionId: decisionId
  };
}

export function approvePendingManuscript(
  context: TestContext,
  scope: BookScope,
  ids: IdGenerator,
  clock: Clock,
  accept = true
): { status: 'settled' | 'rejected'; canonRevision?: number } {
  const confirmation = context.database.prepare(`SELECT confirmation_id, expected_canon_revision FROM confirmations
    WHERE owner_id = ? AND book_id = ? AND target_type = 'manuscript' AND status = 'pending'
    ORDER BY created_at, confirmation_id LIMIT 1`).get(scope.ownerId, scope.bookId) as { confirmation_id: string; expected_canon_revision: number } | undefined;
  if (confirmation === undefined) throw new Error('测试未找到待确认正文');
  return new ChapterApprovalService(
    new ProductionWorkflowRepository(context.database), context.dataDir, context.config.releaseId, ids, clock,
    new ChapterCatalogService(context.database, ids, clock), new CanonService(context.database, ids, clock),
    new TaskService(context.database, context.config.releaseId, clock)
  ).resolve(scope, confirmation.confirmation_id, confirmation.expected_canon_revision, accept);
}
