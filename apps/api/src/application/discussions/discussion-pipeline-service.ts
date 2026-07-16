import type { DatabaseSync } from 'node:sqlite';
import { BudgetService } from '../budget/budget-service.js';
import { ModelCallService } from '../calls/model-call-service.js';
import { ContextPackService } from '../memory/context-pack-service.js';
import { TaskService } from '../tasks/task-service.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { RoleKey } from '../../domain/roles.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { loadModelRuntimeConfig } from '../../infrastructure/models/model-runtime-config.js';
import { DiscussionService } from './discussion-service.js';

interface DiscussionTaskRow {
  status: string;
  lease_owner: string | null;
  task_brief_json: string;
  cancel_requested: number;
  assigned_agent_id: string | null;
}

interface ParticipantRow {
  agent_id: string;
  display_name: string;
  role_key: RoleKey;
  category: 'core' | 'specialist';
  model_snapshot_id: string;
  provider: string;
  model_id: string;
}

export class DiscussionPipelineService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory = new ModelAdapterFactory(loadModelRuntimeConfig({}))
  ) {}

  public async executeClaimed(scope: BookScope, taskId: string, workerId: string): Promise<{ discussionId: string; decisionId: string; opinionCount: number }> {
    assertBookScope(scope);
    const task = this.database.prepare(`
      SELECT status, lease_owner, task_brief_json, cancel_requested, assigned_agent_id FROM tasks
      WHERE task_id = ? AND owner_id = ? AND book_id = ? AND task_type = 'discussion'
    `).get(taskId, scope.ownerId, scope.bookId) as DiscussionTaskRow | undefined;
    if (task === undefined || task.status !== 'working' || task.lease_owner !== workerId) throw new Error('讨论任务未由指定Worker持有');
    const brief = JSON.parse(task.task_brief_json) as { discussionId: string; scopeText: string; conversationId: string };
    const discussions = new DiscussionService(this.database, this.ids, this.clock);
    const discussion = discussions.require(scope, brief.discussionId);
    if (discussion.status !== 'collecting') throw new Error('讨论任务状态与讨论阶段不一致');
    const book = this.database.prepare(`SELECT canon_revision, positioning_version FROM books WHERE owner_id = ? AND book_id = ?`)
      .get(scope.ownerId, scope.bookId) as { canon_revision: number; positioning_version: number };
    const participants = this.database.prepare(`
      SELECT a.agent_id, a.display_name, r.role_key, r.category, a.model_snapshot_id, m.provider, m.model_id
      FROM discussion_participants p
      JOIN agent_instances a ON a.agent_id = p.agent_id AND a.owner_id = p.owner_id AND a.book_id = p.book_id
      JOIN role_templates r ON r.role_template_id = a.role_template_id AND r.version = a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE p.discussion_id = ? AND p.owner_id = ? AND p.book_id = ?
      ORDER BY CASE WHEN a.agent_id = ? THEN 0 ELSE 1 END, p.agent_id
    `).all(brief.discussionId, scope.ownerId, scope.bookId, task.assigned_agent_id) as unknown as ParticipantRow[];
    const budget = this.database.prepare(`SELECT budget_id FROM budgets WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY created_at LIMIT 1`)
      .get(scope.ownerId, scope.bookId) as { budget_id: string } | undefined;
    if (budget === undefined) throw new Error('讨论书籍没有活动预算');
    const budgets = new BudgetService(this.database, this.ids, this.clock);
    const calls = new ModelCallService(this.database, this.clock, budgets);
    const contextPacks = new ContextPackService(this.database, this.ids, this.clock);
    const opinions: Array<{ role: string; output: string }> = [];
    try {
      for (const participant of participants) {
        const currentTask = this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ?`).get(taskId) as { cancel_requested: number };
        if (currentTask.cancel_requested === 1) throw new DOMException('讨论任务已取消', 'AbortError');
        const pack = contextPacks.build(scope, {
          taskId, agentId: participant.agent_id, canonRevision: book.canon_revision,
          positioningVersion: book.positioning_version, tokenBudget: 8_000,
          hardSources: [{ sourceType: 'boss_discussion_scope', sourceId: brief.discussionId, content: brief.scopeText, reason: '老板明确讨论范围，不可截断', priority: 100 }],
          optionalSources: []
        });
        const prompt = `你是${participant.display_name}。请只从岗位职责出发分析这个小说创作问题：${brief.scopeText}。给出推荐、理由、风险和一项可执行建议。`;
        const requestId = this.ids.next();
        const adapter = this.modelAdapters.resolve(participant.provider, participant.model_id, 'discussion', participant.role_key);
        const reservationId = budgets.reserve(
          scope,
          budget.budget_id,
          requestId,
          adapter.provider === 'openai-codex-subscription' ? 30_000 : 8_000,
          0
        );
        const result = await calls.execute(scope, {
          requestId, taskId, phaseKey: `opinion:${participant.role_key}`, agentId: participant.agent_id,
          modelSnapshotId: participant.model_snapshot_id, provider: participant.provider, modelId: participant.model_id,
          input: prompt,
          parameters: JSON.stringify({
            maxOutputTokens: 1_000,
            planOnly: !participant.provider.startsWith('local-deterministic'),
            cashFallbackAllowed: false
          }),
          reservationId, contextPackId: pack.contextPackId
        }, adapter, {
          requestId, taskId, ownerId: scope.ownerId, bookId: scope.bookId,
          agentId: participant.agent_id, prompt, maxOutputTokens: 1_000
        });
        discussions.addOpinion(scope, brief.discussionId, {
          agentId: participant.agent_id, modelSnapshotId: participant.model_snapshot_id, phase: 'independent',
          content: {
            role: participant.role_key,
            recommendation: result.output,
            basis: `来自${participant.display_name}（${result.provider}/${result.modelId}）的可追溯模型调用`
          },
          tokens: result.inputTokens + result.outputTokens
        });
        opinions.push({ role: participant.display_name, output: result.output });
      }
      discussions.setStage(scope, brief.discussionId, 'collecting', 'synthesizing');
      const decisionId = discussions.synthesize(scope, brief.discussionId, {
        recommendation: { summary: `围绕“${brief.scopeText}”采用可逆的小步方案，并在写作后以正史和读者体验复核。`, evidence: opinions },
        alternatives: opinions.map((opinion) => ({ role: opinion.role, proposal: opinion.output })),
        disagreements: opinions.length > 1 ? [{ status: '保留岗位视角差异', roles: opinions.map((opinion) => opinion.role) }] : [],
        impacts: [{ scope: 'current_book', cashCostCny: 0, requiresBossConfirmation: true }]
      });
      this.addEditorMessage(scope, brief.conversationId, participants[0]!, brief.discussionId, brief.scopeText, decisionId, opinions);
      for (const participant of participants.filter((item) => item.category === 'specialist')) {
        this.database.prepare(`UPDATE agent_instances SET activation_state = 'standby', updated_at = ? WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
          .run(this.clock.now().toISOString(), scope.ownerId, scope.bookId, participant.agent_id);
      }
      new TaskService(this.database, this.releaseId, this.clock).complete(scope, taskId, workerId);
      return { discussionId: brief.discussionId, decisionId, opinionCount: opinions.length };
    } catch (error) {
      const now = this.clock.now().toISOString();
      const cancelled = (this.database.prepare(`SELECT cancel_requested FROM tasks WHERE task_id = ?`).get(taskId) as { cancel_requested: number }).cancel_requested === 1;
      for (const participant of participants.filter((item) => item.category === 'specialist')) {
        this.database.prepare(`UPDATE agent_instances SET activation_state = 'standby', updated_at = ? WHERE owner_id = ? AND book_id = ? AND agent_id = ?`)
          .run(now, scope.ownerId, scope.bookId, participant.agent_id);
      }
      this.database.prepare(`
        UPDATE tasks SET status = ?, error_code = ?, lease_owner = NULL, lease_expires_at = NULL,
          heartbeat_at = NULL, updated_at = ? WHERE task_id = ? AND owner_id = ? AND book_id = ? AND lease_owner = ?
      `).run(cancelled ? 'cancelled' : 'failed', cancelled ? 'TASK_CANCELLED' : 'DISCUSSION_FAILED', now, taskId, scope.ownerId, scope.bookId, workerId);
      throw error;
    }
  }

  private addEditorMessage(
    scope: BookScope,
    conversationId: string,
    editor: ParticipantRow,
    discussionId: string,
    scopeText: string,
    decisionId: string,
    opinions: Array<{ role: string; output: string }>
  ): void {
    const summary = [
      `讨论“${scopeText}”已完成，收到 ${opinions.length} 个真实岗位意见。`,
      '推荐：先采用可逆的小步方案，写作后再用正史一致性和读者体验复核。',
      `岗位来源：${opinions.map((opinion) => opinion.role).join('、')}。`,
      `如接受，请输入：确认方案 ${decisionId}`
    ].join('\n');
    this.database.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, owner_id, book_id, sender_type, sender_agent_id,
        role_key, model_provider, model_id, message_type, content, references_json, created_at
      ) VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?, 'discussion_summary', ?, ?, ?)
    `).run(
      this.ids.next(), conversationId, scope.ownerId, scope.bookId, editor.agent_id,
      editor.role_key, editor.provider, editor.model_id, summary,
      JSON.stringify([{ discussionId, decisionId }]), this.clock.now().toISOString()
    );
  }
}
