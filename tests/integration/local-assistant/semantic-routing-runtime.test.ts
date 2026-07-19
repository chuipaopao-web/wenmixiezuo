import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ConversationService } from '../../../apps/api/src/application/chat/conversation-service.js';
import { ConversationReplyPipelineService } from '../../../apps/api/src/application/chat/conversation-reply-pipeline-service.js';
import type { LocalUtilityCandidate, LocalUtilityModel, LocalUtilityRequest } from '../../../apps/api/src/application/local-assistant/local-utility-model.js';
import { TaskService } from '../../../apps/api/src/application/tasks/task-service.js';
import { initializeDomainBook } from '../../helpers/domain-fixture.js';
import { FixedClock, SequenceIds, createTestContext, type TestContext } from '../../helpers/test-context.js';

let context: TestContext | undefined;
afterEach(() => { context?.close(); context = undefined; });

class PlotSemanticCandidate implements LocalUtilityModel {
  public readonly available = true;
  public readonly modelSnapshotId = 'semantic-fixture-v1';
  public readonly degradationReason = null;
  public calls = 0;
  public async infer(request: LocalUtilityRequest): Promise<LocalUtilityCandidate> {
    this.calls += 1;
    return {
      schemaVersion: 1, task: request.task, confidence: 0.91,
      values: { intent: 'plot_discussion', similarity: 0.86, margin: 0.18 },
      sourceTextHash: createHash('sha256').update(request.text).digest('hex'), modelSnapshotId: this.modelSnapshotId
    };
  }
}

describe('小文秘书真实消息入口的本地语义候选', () => {
  it('口语化剧情请求由语义候选升级双编剧，原话和模型证据完整保存', async () => {
    context = createTestContext('wenmi-local-semantic-route-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock, { title: '语义路由书', text: '一部待讨论的长篇小说' });
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const model = new PlotSemanticCandidate();
    const service = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock, model);
    const original = '咱们一起盘一盘，张三接下来该不该攻城？';
    const result = await service.sendBossMessageWithLocalAssistant(scope, original);
    expect(result.action).toMatchObject({ kind: 'discussion_scheduled', purpose: 'creative_planning',
      intake: { routeClass: 'plot_discussion', selectedAction: 'start_editor_hosted_dual_screenwriter_session' } });
    expect(model.calls).toBe(1);
    const stored = context.database.prepare(`
      SELECT original_message_hash, source_pointers_json, selected_roles_json FROM message_routing_decisions
      WHERE owner_id = ? AND book_id = ? AND message_id = ?
    `).get(scope.ownerId, scope.bookId, result.messageId) as {
      original_message_hash: string; source_pointers_json: string; selected_roles_json: string;
    };
    expect(stored.original_message_hash).toBe(createHash('sha256').update(original).digest('hex'));
    expect(stored.source_pointers_json).toContain('semantic-fixture-v1');
    expect(JSON.parse(stored.selected_roles_json)).toEqual(['chief_editor', 'lead_screenwriter', 'second_screenwriter']);
  });

  it('保护操作由确定性门禁抢先阻断，不把决定交给语义模型', async () => {
    context = createTestContext('wenmi-local-semantic-protected-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock, { title: '保护路由书', text: '一部待保护的长篇小说' });
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const model = new PlotSemanticCandidate();
    const service = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock, model);
    const result = await service.sendBossMessageWithLocalAssistant(scope, '永久删除这本书');
    expect(result.action).toMatchObject({ kind: 'protected_operation_blocked', intake: { routeClass: 'protected_operation' } });
    expect(model.calls).toBe(0);
  });

  it('老板点名成员时直接分配该成员并由该岗位真实回复', async () => {
    context = createTestContext('wenmi-local-semantic-named-');
    const ids = new SequenceIds();
    const clock = new FixedClock();
    const book = initializeDomainBook(context, 'owner-one', ids, clock, { title: '点名路由书', text: '一部待讨论的长篇小说' });
    const scope = { ownerId: 'owner-one', bookId: book.bookId };
    const model = new PlotSemanticCandidate();
    const conversations = new ConversationService(context.database, context.dataDir, context.config.releaseId, ids, clock, model);

    const result = await conversations.sendBossMessageWithLocalAssistant(scope, '婉儿，你单独说说这个冲突是否成立');
    expect(result.action).toMatchObject({
      kind: 'named_member_reply_scheduled',
      memberName: '婉儿',
      roleKey: 'lead_screenwriter',
      intake: { routeClass: 'named_member' }
    });
    expect(model.calls).toBe(0);
    const taskId = String(result.action.taskId);
    const tasks = new TaskService(context.database, context.config.releaseId, clock);
    const task = tasks.require(scope, taskId);
    expect(task.assignedAgentId).toBe(result.action.agentId);
    expect(task.brief).toMatchObject({ directNamedMember: true, requestedMemberName: '婉儿' });
    expect(tasks.claimNext('worker-named')?.taskId).toBe(taskId);

    await new ConversationReplyPipelineService(context.database, context.config.releaseId, ids, clock)
      .executeClaimed(scope, taskId, 'worker-named');
    const reply = (conversations.listMessages(scope) as Array<{ sender_type: string; role_key: string | null }>)
      .find((message) => message.sender_type === 'agent');
    expect(reply?.role_key).toBe('lead_screenwriter');
  });
});
