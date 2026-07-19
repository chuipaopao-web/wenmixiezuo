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
  new PlanningArtifactService(context.database, ids, clock).promoteConfirmedDecision(scope, discussion.discussionId, decisionId, count);
  return { discussionId: discussion.discussionId, decisionId };
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
