import { afterEach, describe, expect, it } from 'vitest';
import { DiscussionService } from '../../../apps/api/src/application/discussions/discussion-service.js';
import { PlanningArtifactService } from '../../../apps/api/src/application/artifacts/planning-artifact-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { createTestContext, FixedClock, SequenceIds, type TestContext } from '../../helpers/test-context.js';

describe('structured rolling chapter plans', () => {
  let context: TestContext | undefined;
  afterEach(() => context?.close());

  it('promotes distinct chapter goals, beats and hooks instead of repeating the discussion summary', () => {
    context = createTestContext('wenmi-planning-structure-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, context.config.ownerId, ids, clock, { title: '灰塔零号领主', text: '领地经营与灾潮谜案' });
    const scope = { ownerId: context.config.ownerId, bookId: book.bookId };
    const agents = context.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, r.role_key FROM agent_instances a
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      WHERE a.owner_id = ? AND a.book_id = ? AND r.role_key IN ('chief_editor', 'lead_screenwriter')
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ agent_id: string; model_snapshot_id: string; role_key: string }>;
    const agent = agents.find((item) => item.role_key === 'chief_editor')!;
    const writer = agents.find((item) => item.role_key === 'lead_screenwriter')!;
    const discussions = new DiscussionService(context.database, ids, clock);
    const discussion = discussions.create(scope, {
      type: 'quick', scopeText: '规划灰塔前三章', createdByAgentId: agent.agent_id,
      participants: [{ agentId: agent.agent_id, reason: '主编汇总' }, { agentId: writer.agent_id, reason: '编剧规划' }]
    });
    const planning = {
      arcTitle: '灰塔开机', arcGoal: '主角取得灰塔控制权并拒绝以居民献祭', endingState: '灰塔获得第一块合法领地',
      chapters: [
        { title: '灰塔醒来', goal: '林砚在坠塔现场确认自己能读取零号账簿', beats: ['坠塔', '账簿亮起'], hook: '账簿显示第一名欠债者已经死亡' },
        { title: '第一次审计', goal: '林砚用废料账目换取难民的三天信任', beats: ['清点废料', '公开账目'], hook: '城门外出现王都税官' },
        { title: '拒绝献祭', goal: '林砚公开否决灰塔以居民生命换能源的旧规则', beats: ['能源告急', '寻找替代源'], hook: '替代能源来自即将爆发的灾潮' }
      ]
    };
    const output = JSON.stringify({
      version: 1, format: 'json_object', fields: {
        answer: '采用经营数据服务人物选择的方案。', keyPoints: [], alternatives: [], risks: [], questions: [],
        nextStep: '确认后逐章创作', details: `规划落库 ${JSON.stringify(planning)}`
      }
    });
    discussions.addOpinion(scope, discussion.discussionId, {
      agentId: agent.agent_id, modelSnapshotId: agent.model_snapshot_id, phase: 'independent',
      content: { recommendation: output }, tokens: 200
    });
    discussions.setStage(scope, discussion.discussionId, 'collecting', 'synthesizing');
    const decisionId = discussions.synthesize(scope, discussion.discussionId, {
      recommendation: { summary: output }, alternatives: [], disagreements: [],
      impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
    });
    discussions.confirm(scope, discussion.discussionId, decisionId);

    new PlanningArtifactService(context.database, ids, clock)
      .promoteConfirmedDecision(scope, discussion.discussionId, decisionId, 3);
    const outlines = context.database.prepare(`
      SELECT v.content_json FROM artifacts a JOIN artifact_versions v ON v.artifact_version_id = a.active_version_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.artifact_type = 'chapter_outline'
      ORDER BY CAST(json_extract(v.content_json, '$.chapterNumber') AS INTEGER)
    `).all(scope.ownerId, scope.bookId) as unknown as Array<{ content_json: string }>;
    const contents = outlines.map((row) => JSON.parse(row.content_json) as Record<string, unknown>);
    expect(contents.map((item) => item.goal)).toEqual(planning.chapters.map((item) => item.goal));
    expect(contents.map((item) => item.hook)).toEqual(planning.chapters.map((item) => item.hook));
    expect(new Set(contents.map((item) => item.goal)).size).toBe(3);
  });
});
