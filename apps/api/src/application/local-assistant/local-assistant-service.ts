import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import type { LocalAssistantRepository } from '../../infrastructure/db/repositories/local-assistant-repository.js';
import type { LocalUtilityModel } from './local-utility-model.js';

export interface RoutingDecision { routeClass: string; riskLevel: 'low' | 'medium' | 'high' | 'irreversible'; confidenceBand: 'high' | 'medium' | 'low'; selectedAction: string; selectedRoles: string[]; excludedActions: string[]; receiptText: string }
export class LocalAssistantService {
  public constructor(private readonly repository: LocalAssistantRepository, private readonly ids: IdGenerator, private readonly clock: Clock,
    private readonly model?: LocalUtilityModel) {}
  public route(scope: BookScope, input: { conversationId: string; messageId: string; original: string; entities?: string[] }): RoutingDecision {
    const original = input.original.trim(); if (original.length === 0) throw new Error('老板原话不能为空');
    return this.persist(scope, input, decide(original), []);
  }
  public async routeWithSemantic(scope: BookScope, input: { conversationId: string; messageId: string; original: string; entities?: string[] }): Promise<RoutingDecision> {
    const original = input.original.trim(); if (original.length === 0) throw new Error('老板原话不能为空');
    const deterministic = decide(original);
    if (deterministic.routeClass !== 'editor_handoff' || this.model === undefined || !this.model.available) {
      return this.persist(scope, input, deterministic, this.model?.available === false ? [{ type: 'local_semantic_degraded', reason: this.model.degradationReason }] : []);
    }
    try {
      const candidate = await this.model.infer({ task: 'intent_classification', text: original });
      const intent = typeof candidate.values.intent === 'string' ? candidate.values.intent : 'unknown';
      const margin = typeof candidate.values.margin === 'number' ? candidate.values.margin : 0;
      const semantic = intent === 'plot_discussion' && candidate.confidence >= 0.58 && margin >= 0.015
        ? { routeClass: 'plot_discussion', riskLevel: 'medium', confidenceBand: 'medium',
          selectedAction: 'start_editor_hosted_dual_screenwriter_session', selectedRoles: ['chief_editor', 'lead_screenwriter', 'second_screenwriter'],
          excludedActions: ['local_assistant_story_conclusion', 'doubao_plot_seat'], receiptText: '本地语义候选识别为剧情讨论；已保留原话并交给主编与双编剧。' } satisfies RoutingDecision
        : deterministic;
      return this.persist(scope, input, semantic, [{ type: 'local_semantic_candidate', modelSnapshotId: candidate.modelSnapshotId,
        task: candidate.task, confidence: candidate.confidence, values: candidate.values, sourceTextHash: candidate.sourceTextHash }]);
    } catch (error) {
      return this.persist(scope, input, deterministic, [{ type: 'local_semantic_failed', reason: error instanceof Error ? error.name : 'UnknownError' }]);
    }
  }
  private persist(scope: BookScope, input: { conversationId: string; messageId: string; original: string; entities?: string[] },
    decision: RoutingDecision, sourcePointers: unknown[]): RoutingDecision {
    const original = input.original.trim();
    const sessionId = this.repository.ensureSession(scope, { id: this.ids.next(), conversationId: input.conversationId, state: {}, now: this.clock.now().toISOString() });
    this.repository.insertRouting(scope, { id: this.ids.next(), sessionId, messageId: input.messageId,
      messageHash: createHash('sha256').update(original).digest('hex'), ...decision, entities: input.entities ?? [], sourcePointers, now: this.clock.now().toISOString() });
    return decision;
  }
}
function decide(text: string): RoutingDecision {
  if (/(永久删除|付费|购买|密钥|api\s*key)/iu.test(text)) return { routeClass: 'protected_operation', riskLevel: 'irreversible', confidenceBand: 'high',
    selectedAction: 'require_owner_confirmation', selectedRoles: [], excludedActions: ['automatic_execution'], receiptText: '这一步需要您亲自确认，我先停在这里，没有执行任何不可逆操作。' };
  const named = ['貂蝉', '西施', '婉儿', '红玉', '文姬', '秋香', '湘君', '妲己', '昭君', '道韫', '弄玉'].find((name) => text.includes(name));
  if (named !== undefined) return { routeClass: 'named_member', riskLevel: 'medium', confidenceBand: 'high', selectedAction: 'route_directly_to_named_member',
    selectedRoles: [named], excludedActions: ['local_assistant_answer_on_behalf'], receiptText: `好的，我会把您的原话直接交给${named}，由她本人回复。` };
  if (/(讨论|聊聊|推演).*(剧情|情节|人物命运)|(剧情|情节).*(讨论|推演)/u.test(text)) return { routeClass: 'plot_discussion', riskLevel: 'medium', confidenceBand: 'high',
    selectedAction: 'start_editor_hosted_dual_screenwriter_session', selectedRoles: ['chief_editor', 'lead_screenwriter', 'second_screenwriter'],
    excludedActions: ['local_assistant_story_conclusion', 'doubao_plot_seat'], receiptText: '收到，我已经保留您的原话，并请貂蝉主持两位编剧一起讨论。' };
  const utility = text.match(/^(暂停|继续|取消|查看任务|打开资料库)[！!。.？?\s]*$/u)?.[1];
  if (utility !== undefined) return { routeClass: 'deterministic_utility', riskLevel: 'low', confidenceBand: 'high',
    selectedAction: ({ 暂停: 'pause_tasks', 继续: 'resume_tasks', 取消: 'cancel_tasks', 查看任务: 'show_task_overview', 打开资料库: 'open_knowledge_workspace' } as Record<string, string>)[utility]!,
    selectedRoles: [], excludedActions: ['remote_model_call'], receiptText: '我会在本地处理，不需要调用创作模型。' };
  if (/^(?:小文秘书[，,：:\s]*)?(?:你好(?:啊|呀|嘛)?|您好|在吗|有人吗|没人在吗)[！!。.？?\s]*$/u.test(text)) {
    return { routeClass: 'local_assistant_conversation', riskLevel: 'low', confidenceBand: 'high', selectedAction: 'reply_as_local_assistant',
      selectedRoles: [], excludedActions: ['remote_model_call', 'creative_conclusion'], receiptText: '我在，您可以直接告诉我想做什么。' };
  }
  if (/^(?:小文秘书[，,：:\s]*)?(?:你是谁|你是做什么的|你能做什么|怎么用|能帮我做什么)[？?。.！!\s]*$/u.test(text)
    || /^小文秘书[？?。.！!\s]*$/u.test(text)) {
    return { routeClass: 'local_assistant_conversation', riskLevel: 'low', confidenceBand: 'high', selectedAction: 'explain_local_assistant_role',
      selectedRoles: [], excludedActions: ['remote_model_call', 'creative_conclusion'], receiptText: '我是小文秘书，负责本地受理、整理和安排。' };
  }
  return { routeClass: 'editor_handoff', riskLevel: 'medium', confidenceBand: 'medium', selectedAction: 'preserve_original_and_handoff_to_editor',
    selectedRoles: ['chief_editor'], excludedActions: ['automatic_canon_promotion'], receiptText: '收到，我会保留您的原话，并交给貂蝉判断下一步。' };
}
