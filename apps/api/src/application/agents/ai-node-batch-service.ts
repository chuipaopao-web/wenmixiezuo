import { createHash } from 'node:crypto';
import type {
  AiNodeBatchView, AiNodeCostEstimate, CostTier, EditorialMemberStatus,
  EditorialMemberView, EditorialRoleKey, EditorialRolePoolView
} from '@wenmi/contracts';
import { editorialRoleKeys } from '@wenmi/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteDataRepository } from '../../infrastructure/db/repositories/sqlite-data-repository.js';
import { DomainError, errorCodes } from '../../domain/errors.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';
import { ContextPackService, type ContextSource } from '../memory/context-pack-service.js';
import { TaskService } from '../tasks/task-service.js';
import { creativeTemplate, type CreativeTemplateSnapshot } from './editorial-node-templates.js';
import { allRoleSkills, coreAgentSkill, nodeProtocolSkill, roleAgentSkill, type AgentSkillSnapshot } from './editorial-agent-skills.js';

type Stored = Record<string, unknown>;
type SqlValue = string | number | bigint | Uint8Array | null;
type AuthorSummary = { preserved: string[]; adjusted: string[]; omitted: Array<{ item: string; reason: string }> };

export interface CreateAiNodeBatchInput {
  nodeKind: string;
  objectId: string;
  roleKey: EditorialRoleKey;
  taskDescription: string;
  templateVersion: string;
  sourceVersionIds: string[];
  hardSources: ContextSource[];
  optionalSources: ContextSource[];
  preferredMemberIds?: string[];
  tokenBudget?: number;
  outputTokenBudget?: number;
  reasoningLevel?: 'light' | 'standard' | 'deep';
  roundCount?: number;
  exampleCount?: number;
  characterBudget?: number;
  confirmHighCost?: boolean;
  idempotencyKey: string;
}

const ROLE_LABELS: Record<EditorialRoleKey, string> = {
  chief_editor: '主编', deputy_editor: '副编', screenwriter: '编剧', writer: '主笔',
  fact_reviewer: '事实席', literary_reviewer: '文学席', experience_reviewer: '体验席'
};
const DEFAULT_COUNTS: Record<EditorialRoleKey, number> = {
  chief_editor: 3, deputy_editor: 3, screenwriter: 5, writer: 5,
  fact_reviewer: 3, literary_reviewer: 3, experience_reviewer: 3
};

export class AiNodeBatchService {
  private readonly persistence: SqliteDataRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly releaseId: string,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) { this.persistence = new SqliteDataRepository(database); }

  public listPools(scope: BookScope): EditorialRolePoolView[] {
    this.ensurePools(scope);
    return editorialRoleKeys.map((roleKey) => {
      const pool = this.one(`SELECT desired_count,enabled,revision FROM agent_role_pools_v6
        WHERE owner_id=? AND book_id=? AND role_key=?`, scope.ownerId, scope.bookId, roleKey)!;
      return {
        roleKey, roleLabel: ROLE_LABELS[roleKey], desiredCount: num(pool.desired_count), enabled: num(pool.enabled) === 1,
        revision: num(pool.revision), members: this.members(scope, roleKey)
      };
    });
  }

  public configurePool(scope: BookScope, roleKey: EditorialRoleKey, input: {
    desiredCount: number; enabled: boolean; expectedRevision: number;
  }): EditorialRolePoolView {
    this.ensurePools(scope);
    if (!Number.isInteger(input.desiredCount) || input.desiredCount < 1 || input.desiredCount > 20) {
      throw validation('岗位目标人数必须在 1—20 之间');
    }
    const changed = this.persistence.statement(`UPDATE agent_role_pools_v6 SET desired_count=?,enabled=?,revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND role_key=? AND revision=?`).run(input.desiredCount, input.enabled ? 1 : 0, this.now(),
        scope.ownerId, scope.bookId, roleKey, input.expectedRevision).changes;
    if (changed !== 1) throw conflict('岗位池配置已变化，请刷新后重试');
    return this.listPools(scope).find((pool) => pool.roleKey === roleKey)!;
  }

  public setMemberEnabled(scope: BookScope, agentId: string, enabled: boolean, expectedRevision: number): EditorialMemberView {
    this.ensurePools(scope);
    const changed = this.persistence.statement(`UPDATE agent_member_settings_v6 SET enabled=?,revision=revision+1,updated_at=?
      WHERE owner_id=? AND book_id=? AND agent_id=? AND revision=?`).run(enabled ? 1 : 0, this.now(), scope.ownerId,
        scope.bookId, agentId, expectedRevision).changes;
    if (changed !== 1) throw conflict('成员配置已变化，请刷新后重试');
    const member = this.members(scope).find((item) => item.memberId === agentId);
    if (member === undefined) throw notFound('成员不存在或不属于当前书籍');
    return member;
  }

  public saveAuthorInput(scope: BookScope, nodeKind: string, objectId: string, contentText: string): { id: string; version: number; contentHash: string } {
    this.requireBook(scope); requireText(nodeKind, '节点类型'); requireText(objectId, '节点对象');
    const content = contentText.trim();
    const current = this.one(`SELECT version FROM ai_node_author_inputs_v6 WHERE owner_id=? AND book_id=? AND node_kind=?
      AND object_id=? AND status='active'`, scope.ownerId, scope.bookId, nodeKind, objectId);
    const version = (current === undefined ? 0 : num(current.version)) + 1;
    const id = this.ids.next(); const now = this.now(); const contentHash = sha256(content);
    this.tx(() => {
      this.persistence.statement(`UPDATE ai_node_author_inputs_v6 SET status='superseded' WHERE owner_id=? AND book_id=?
        AND node_kind=? AND object_id=? AND status='active'`).run(scope.ownerId, scope.bookId, nodeKind, objectId);
      this.persistence.statement(`INSERT INTO ai_node_author_inputs_v6 (author_input_id,owner_id,book_id,node_kind,object_id,
        version,content_text,content_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,'active',?)`).run(id,
          scope.ownerId, scope.bookId, nodeKind, objectId, version, content, contentHash, now);
    });
    return { id, version, contentHash };
  }

  public estimate(scope: BookScope, input: Pick<CreateAiNodeBatchInput,
    'roleKey' | 'hardSources' | 'optionalSources' | 'preferredMemberIds' | 'tokenBudget' | 'outputTokenBudget' | 'reasoningLevel' | 'roundCount' | 'exampleCount'>): AiNodeCostEstimate {
    this.ensurePools(scope);
    const members = this.selectMembers(scope, input.roleKey, input.preferredMemberIds ?? []);
    return estimateCost(members, input);
  }

  public createBatch(scope: BookScope, input: CreateAiNodeBatchInput): AiNodeBatchView {
    this.ensurePools(scope); requireText(input.nodeKind, '节点类型'); requireText(input.objectId, '节点对象');
    requireText(input.taskDescription, '当前任务'); requireText(input.templateVersion, '模板版本');
    const existing = this.one(`SELECT batch_id FROM ai_node_batches_v6 WHERE owner_id=? AND book_id=? AND task_id IN (
      SELECT task_id FROM tasks WHERE owner_id=? AND book_id=? AND idempotency_key=?)`, scope.ownerId, scope.bookId,
      scope.ownerId, scope.bookId, input.idempotencyKey);
    if (existing !== undefined) return this.viewBatch(scope, str(existing.batch_id));
    const members = this.selectMembers(scope, input.roleKey, input.preferredMemberIds ?? []);
    if (members.length === 0) throw conflict('当前岗位没有可用成员');
    const cost = estimateCost(members, input);
    if (cost.requiresConfirmation && input.confirmHighCost !== true) {
      throw new DomainError(errorCodes.confirmationRequired, '本次为高消耗多成员任务，请确认后启动', { cost }, false, 409);
    }
    const authorInput = this.one(`SELECT author_input_id,version,content_text FROM ai_node_author_inputs_v6
      WHERE owner_id=? AND book_id=? AND node_kind=? AND object_id=? AND status='active'`, scope.ownerId, scope.bookId,
      input.nodeKind, input.objectId);
    const coreSkill = coreAgentSkill(); const roleSkill = roleAgentSkill(input.roleKey);
    const nodeSkill = nodeProtocolSkill(input.nodeKind, input.roleKey);
    const codeTemplate = creativeTemplate(input.nodeKind, input.templateVersion);
    const template = this.selectReleasedTemplate(scope, input, codeTemplate);
    this.ensureSkills([coreSkill, ...allRoleSkills(), nodeSkill]); this.ensureTemplate(template);
    const taskId = this.ids.next(); const batchId = this.ids.next(); const now = this.now();
    const batchVersion = num(this.one(`SELECT COALESCE(MAX(batch_version),0)+1 AS value FROM ai_node_batches_v6
      WHERE owner_id=? AND book_id=? AND node_kind=? AND object_id=?`, scope.ownerId, scope.bookId, input.nodeKind,
      input.objectId)?.value);
    const book = this.one(`SELECT canon_revision,positioning_version FROM books WHERE owner_id=? AND book_id=?`,
      scope.ownerId, scope.bookId)!;
    const budget = this.one(`SELECT budget_id FROM budgets WHERE owner_id=? AND book_id=? AND status='active'
      ORDER BY created_at LIMIT 1`, scope.ownerId, scope.bookId);
    if (budget === undefined) throw conflict('当前书籍没有可用预算，无法启动团队任务');
    return this.tx(() => {
      const tasks = new TaskService(this.database, this.releaseId, this.clock);
      tasks.create(scope, {
        taskId, taskType: `ai_node:${input.nodeKind}`, assignedAgentId: members[0]!.agentId,
        idempotencyKey: input.idempotencyKey, budgetId: str(budget.budget_id), initialPhase: 'ai_node_members',
        brief: { batchId, nodeKind: input.nodeKind, objectId: input.objectId, roleKey: input.roleKey,
          taskDescription: input.taskDescription, sourceVersionIds: input.sourceVersionIds }
      });
      const authorSources: ContextSource[] = authorInput === undefined || str(authorInput.content_text).length === 0 ? [] : [{
        sourceType: 'author_node_input', sourceId: str(authorInput.author_input_id), version: num(authorInput.version),
        content: str(authorInput.content_text), reason: '作者对当前节点的局部要求，必须优先尊重。', priority: 100,
        constraintStrength: 'current_task', truthStatus: 'confirmed', scopeType: 'task', scopeId: batchId,
        componentKind: 'ChapterTaskPack'
      }];
      const context = new ContextPackService(this.database, this.ids, this.clock).build(scope, {
        taskId, agentId: members[0]!.agentId, canonRevision: num(book.canon_revision), positioningVersion: num(book.positioning_version),
        tokenBudget: input.tokenBudget ?? 12_000,
        ...(input.characterBudget === undefined ? {} : { characterBudget: input.characterBudget }),
        policyVersion: `ai-node-v6:${input.nodeKind}:${input.templateVersion}`,
        hardSources: [...input.hardSources, ...authorSources], optionalSources: input.optionalSources
      });
      this.persistence.statement(`INSERT INTO ai_node_batches_v6 (batch_id,owner_id,book_id,node_kind,object_id,batch_version,
        role_key,task_id,context_pack_id,context_pack_hash,author_input_id,author_input_version,core_skill_version_id,
        role_skill_version_id,node_protocol_version_id,template_version,template_version_id,template_hash,
        source_version_ids_json,estimated_cost_tier,estimated_cost_units,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,?)`).run(
          batchId, scope.ownerId, scope.bookId, input.nodeKind, input.objectId, batchVersion, input.roleKey, taskId,
          context.contextPackId, context.contentHash, authorInput === undefined ? null : str(authorInput.author_input_id),
          authorInput === undefined ? 0 : num(authorInput.version), coreSkill.skillVersionId, roleSkill.skillVersionId,
          nodeSkill.skillVersionId, input.templateVersion, template.templateVersionId, template.contentHash,
          JSON.stringify(input.sourceVersionIds), cost.tier, cost.units, now, now
        );
      for (const member of members) this.insertBatchMember(scope, batchId, member, context.contextPackId, context.contentHash, now);
      tasks.queue(scope, taskId);
      return this.viewBatch(scope, batchId);
    });
  }

  public addMember(scope: BookScope, batchId: string, agentId: string, confirmHighCost = false): AiNodeBatchView {
    const batch = this.requireBatch(scope, batchId); const member = this.requireSelectableMember(scope, agentId, str(batch.role_key));
    const current = this.rows(`SELECT s.base_cost_tier FROM ai_node_batch_members_v6 bm JOIN agent_member_settings_v6 s
      ON s.owner_id=bm.owner_id AND s.book_id=bm.book_id AND s.agent_id=bm.agent_id WHERE bm.batch_id=?`, batchId);
    const extraCost = costUnits(member.costTier); const total = current.reduce((sum, row) => sum + costUnits(str(row.base_cost_tier) as CostTier), 0) + extraCost;
    if ((member.costTier === 'high' || total >= 8) && !confirmHighCost) {
      throw new DomainError(errorCodes.confirmationRequired, '追加成员会提高本次消耗，请确认后继续', { incrementalUnits: extraCost }, false, 409);
    }
    this.assertIndependentModel(batchId, member.signatureHash);
    this.insertBatchMember(scope, batchId, member, str(batch.context_pack_id), str(batch.context_pack_hash), this.now());
    this.touchBatch(scope, batchId); this.ensureExecutionQueued(scope, batchId, member.agentId, 'add-member');
    return this.viewBatch(scope, batchId);
  }

  public retryMember(scope: BookScope, batchId: string, batchMemberId: string): AiNodeBatchView {
    this.requireBatch(scope, batchId);
    const target = this.one(`SELECT agent_id FROM ai_node_batch_members_v6 WHERE owner_id=? AND book_id=? AND batch_id=?
      AND batch_member_id=?`, scope.ownerId, scope.bookId, batchId, batchMemberId);
    if (target === undefined) throw conflict('成员不属于当前批次');
    const changed = this.persistence.statement(`UPDATE ai_node_batch_members_v6 SET status='queued',attempt_count=attempt_count+1,
      failure_class=NULL,failure_message=NULL,started_at=NULL,completed_at=NULL,updated_at=? WHERE owner_id=? AND book_id=?
      AND batch_id=? AND batch_member_id=? AND status IN ('failed','unavailable')`).run(this.now(), scope.ownerId, scope.bookId,
        batchId, batchMemberId).changes;
    if (changed !== 1) throw conflict('只有失败或不可用成员可以单独重试');
    this.touchBatch(scope, batchId); this.ensureExecutionQueued(scope, batchId, str(target.agent_id), 'retry-member');
    return this.viewBatch(scope, batchId);
  }

  public replaceMember(scope: BookScope, batchId: string, failedBatchMemberId: string, replacementAgentId: string,
    confirmHighCost = false): AiNodeBatchView {
    const batch = this.requireBatch(scope, batchId);
    const failed = this.one(`SELECT status FROM ai_node_batch_members_v6 WHERE owner_id=? AND book_id=? AND batch_id=?
      AND batch_member_id=?`, scope.ownerId, scope.bookId, batchId, failedBatchMemberId);
    if (failed === undefined || !['failed','unavailable'].includes(str(failed.status))) throw conflict('只有失败成员可以更换');
    const member = this.requireSelectableMember(scope, replacementAgentId, str(batch.role_key));
    if (member.costTier === 'high' && !confirmHighCost) throw new DomainError(errorCodes.confirmationRequired,
      '替换成员为高消耗等级，请确认后继续', { incrementalUnits: costUnits(member.costTier) }, false, 409);
    this.assertIndependentModel(batchId, member.signatureHash);
    this.tx(() => {
      this.persistence.statement(`UPDATE ai_node_batch_members_v6 SET status='replaced',updated_at=? WHERE owner_id=? AND book_id=?
        AND batch_id=? AND batch_member_id=?`).run(this.now(), scope.ownerId, scope.bookId, batchId, failedBatchMemberId);
      this.insertBatchMember(scope, batchId, member, str(batch.context_pack_id), str(batch.context_pack_hash), this.now());
      this.touchBatch(scope, batchId);
    });
    this.ensureExecutionQueued(scope, batchId, member.agentId, 'replace-member');
    return this.viewBatch(scope, batchId);
  }

  public recordMemberFailure(scope: BookScope, batchId: string, batchMemberId: string,
    failureClass: string, failureMessage: string): AiNodeBatchView {
    this.requireBatch(scope, batchId);
    const changed = this.persistence.statement(`UPDATE ai_node_batch_members_v6 SET status='failed',failure_class=?,failure_message=?,
      completed_at=?,updated_at=? WHERE owner_id=? AND book_id=? AND batch_id=? AND batch_member_id=?
      AND status IN ('queued','working')`).run(failureClass, failureMessage.slice(0, 800), this.now(), this.now(),
        scope.ownerId, scope.bookId, batchId, batchMemberId).changes;
    if (changed !== 1) throw conflict('成员状态已经变化');
    this.refreshBatchStatus(scope, batchId); return this.viewBatch(scope, batchId);
  }

  public recordMemberResult(scope: BookScope, batchId: string, batchMemberId: string, input: {
    candidateKind: string; content: Record<string, unknown>; authorSummary: AuthorSummary;
  }): AiNodeBatchView {
    this.requireBatch(scope, batchId); rejectHiddenReasoning(input.content); validateAuthorSummary(input.authorSummary);
    const member = this.one(`SELECT status FROM ai_node_batch_members_v6 WHERE owner_id=? AND book_id=? AND batch_id=?
      AND batch_member_id=?`, scope.ownerId, scope.bookId, batchId, batchMemberId);
    if (member === undefined || !['queued','working'].includes(str(member.status))) throw conflict('成员结果已经提交或状态不可提交');
    const now = this.now(); const resultJson = stableJson(input.content); const resultHash = sha256(resultJson);
    this.tx(() => {
      this.persistence.statement(`INSERT INTO ai_node_results_v6 (result_id,owner_id,book_id,batch_id,batch_member_id,candidate_kind,
        result_json,result_hash,author_summary_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,'candidate',?)`).run(this.ids.next(),
          scope.ownerId, scope.bookId, batchId, batchMemberId, input.candidateKind, resultJson, resultHash,
          stableJson(input.authorSummary), now);
      this.persistence.statement(`UPDATE ai_node_batch_members_v6 SET status='completed',completed_at=?,updated_at=? WHERE owner_id=?
        AND book_id=? AND batch_id=? AND batch_member_id=?`).run(now, now, scope.ownerId, scope.bookId, batchId, batchMemberId);
      this.refreshBatchStatus(scope, batchId);
    });
    return this.viewBatch(scope, batchId);
  }

  public viewBatch(scope: BookScope, batchId: string): AiNodeBatchView {
    const batch = this.requireBatch(scope, batchId);
    const members = this.rows(`SELECT bm.*,a.display_name,s.role_key,s.supplier_company,s.base_cost_tier,s.avatar_key,s.enabled,
      r.result_id,r.candidate_kind,r.result_json,r.author_summary_json FROM ai_node_batch_members_v6 bm
      JOIN agent_instances a ON a.agent_id=bm.agent_id JOIN agent_member_settings_v6 s
        ON s.owner_id=bm.owner_id AND s.book_id=bm.book_id AND s.agent_id=bm.agent_id
      LEFT JOIN ai_node_results_v6 r ON r.batch_member_id=bm.batch_member_id AND r.status='candidate'
      WHERE bm.owner_id=? AND bm.book_id=? AND bm.batch_id=? ORDER BY bm.created_at,bm.batch_member_id`, scope.ownerId,
      scope.bookId, batchId).map((row) => ({
        batchMemberId: str(row.batch_member_id), member: this.memberView(scope, row),
        status: str(row.status) as AiNodeBatchView['members'][number]['status'], attemptCount: num(row.attempt_count),
        failureMessage: nullable(row.failure_message), result: row.result_id === null ? null : {
          resultId: str(row.result_id), candidateKind: str(row.candidate_kind), content: parseObject(str(row.result_json)),
          authorSummary: parseObject(str(row.author_summary_json)) as unknown as AuthorSummary
        }
      }));
    const completed = members.filter((item) => item.status === 'completed').length;
    const failed = members.filter((item) => ['failed','unavailable'].includes(item.status)).length;
    const total = members.filter((item) => item.status !== 'replaced').length;
    const units = num(batch.estimated_cost_units);
    return {
      batchId, nodeKind: str(batch.node_kind), objectId: str(batch.object_id), batchVersion: num(batch.batch_version),
      roleKey: str(batch.role_key) as EditorialRoleKey, status: str(batch.status) as AiNodeBatchView['status'],
      contextPackId: str(batch.context_pack_id), contextPackHash: str(batch.context_pack_hash),
      authorInputVersion: num(batch.author_input_version), authorInputIncluded: batch.author_input_id !== null,
      skillVersions: { core: str(batch.core_skill_version_id), role: str(batch.role_skill_version_id),
        nodeProtocol: str(batch.node_protocol_version_id), template: str(batch.template_version),
        templateVersionId: nullable(batch.template_version_id), templateHash: nullable(batch.template_hash) },
      sourceVersionIds: parseArray(str(batch.source_version_ids_json)),
      cost: { tier: str(batch.estimated_cost_tier) as CostTier, units, memberCount: total,
        incrementalUnits: total <= 1 ? 0 : Math.max(0, units - Math.ceil(units / total)), multiplier: total,
        requiresConfirmation: str(batch.estimated_cost_tier) === 'high' || total > 2 },
      progress: { completed, failed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) },
      members, createdAt: str(batch.created_at), updatedAt: str(batch.updated_at)
    };
  }

  private ensurePools(scope: BookScope): void {
    this.requireBook(scope); const now = this.now();
    for (const roleKey of editorialRoleKeys) this.persistence.statement(`INSERT OR IGNORE INTO agent_role_pools_v6
      (owner_id,book_id,role_key,desired_count,enabled,revision,updated_at) VALUES (?,?,?,?,1,1,?)`).run(scope.ownerId,
        scope.bookId, roleKey, DEFAULT_COUNTS[roleKey], now);
    const agents = this.rows(`SELECT a.agent_id,a.display_name,a.enabled,a.activation_state,t.role_key,m.provider,m.model_id
      FROM agent_instances a JOIN role_templates t ON t.role_template_id=a.role_template_id AND t.version=a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id=a.model_snapshot_id WHERE a.owner_id=? AND a.book_id=?
      ORDER BY a.created_at,a.agent_id`, scope.ownerId, scope.bookId);
    let order = 0;
    for (const agent of agents) {
      const roleKey = normalizeRole(str(agent.role_key)); if (roleKey === null) continue; order += 1;
      this.persistence.statement(`INSERT OR IGNORE INTO agent_member_settings_v6 (owner_id,book_id,agent_id,role_key,enabled,
        supplier_company,base_cost_tier,avatar_key,display_order,revision,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(
          scope.ownerId, scope.bookId, str(agent.agent_id), roleKey, num(agent.enabled) === 1 ? 1 : 0,
          supplier(str(agent.provider)), baseCost(str(agent.model_id)), str(agent.role_key), order, now);
    }
  }

  private members(scope: BookScope, roleKey?: EditorialRoleKey): EditorialMemberView[] {
    const params: SqlValue[] = [scope.ownerId, scope.bookId];
    const where = roleKey === undefined ? '' : ' AND s.role_key=?'; if (roleKey !== undefined) params.push(roleKey);
    return this.rows(`SELECT a.agent_id,a.display_name,a.enabled AS agent_enabled,a.activation_state,s.role_key,s.enabled,
      s.supplier_company,s.base_cost_tier,s.avatar_key FROM agent_member_settings_v6 s JOIN agent_instances a
      ON a.agent_id=s.agent_id WHERE s.owner_id=? AND s.book_id=?${where} ORDER BY s.display_order,a.agent_id`, ...params)
      .map((row) => this.memberView(scope, row));
  }

  private memberView(scope: BookScope, row: Stored): EditorialMemberView {
    const enabled = num(row.enabled) === 1 && (row.agent_enabled === undefined || num(row.agent_enabled) === 1);
    return { memberId: str(row.agent_id), displayName: str(row.display_name), roleKey: str(row.role_key) as EditorialRoleKey,
      roleLabel: ROLE_LABELS[str(row.role_key) as EditorialRoleKey], supplierCompany: str(row.supplier_company),
      baseCostTier: str(row.base_cost_tier) as CostTier, status: this.memberStatus(scope, str(row.agent_id), enabled,
        row.activation_state === undefined ? 'idle' : str(row.activation_state)), avatarKey: str(row.avatar_key), enabled };
  }

  private memberStatus(scope: BookScope, agentId: string, enabled: boolean, activation: string): EditorialMemberStatus {
    if (!enabled || ['disabled','paused'].includes(activation)) return 'unavailable';
    const latest = this.one(`SELECT bm.status FROM ai_node_batch_members_v6 bm WHERE bm.owner_id=? AND bm.book_id=? AND bm.agent_id=?
      ORDER BY bm.updated_at DESC,bm.batch_member_id DESC LIMIT 1`, scope.ownerId, scope.bookId, agentId);
    if (latest === undefined) return 'available';
    const status = str(latest.status);
    if (['queued','working'].includes(status)) return 'working';
    if (status === 'completed') return 'completed';
    if (['failed','unavailable'].includes(status)) return 'failed';
    return 'available';
  }

  private selectMembers(scope: BookScope, roleKey: EditorialRoleKey, preferred: string[]): SelectableMember[] {
    const candidates = this.selectableMembers(scope, roleKey);
    if (preferred.length > 0) return preferred.map((id) => {
      const member = candidates.find((item) => item.agentId === id && item.available);
      if (member === undefined) throw conflict('选择的成员不可用或不属于当前岗位');
      return member;
    });
    const available = candidates.filter((item) => item.available);
    return available.length === 0 ? [] : [available.sort((left, right) => left.healthPenalty - right.healthPenalty
      || left.load - right.load || costUnits(left.costTier) - costUnits(right.costTier)
      || left.agentId.localeCompare(right.agentId))[0]!];
  }

  private selectableMembers(scope: BookScope, roleKey: EditorialRoleKey): SelectableMember[] {
    return this.rows(`SELECT a.agent_id,a.model_snapshot_id,a.activation_state,a.enabled,s.enabled AS setting_enabled,
      s.base_cost_tier,m.provider,m.model_id,(SELECT COUNT(*) FROM tasks t WHERE t.owner_id=a.owner_id AND t.book_id=a.book_id
      AND t.assigned_agent_id=a.agent_id AND t.status IN ('queued','working')) AS load,
      (SELECT COUNT(*) FROM model_calls mc WHERE mc.provider=m.provider AND mc.model_id=m.model_id
       AND mc.state IN ('failed','interrupted') AND mc.created_at>=datetime('now','-1 day')) AS health_penalty
      FROM agent_instances a
      JOIN agent_member_settings_v6 s ON s.owner_id=a.owner_id AND s.book_id=a.book_id AND s.agent_id=a.agent_id
      JOIN model_config_snapshots m ON m.model_snapshot_id=a.model_snapshot_id WHERE a.owner_id=? AND a.book_id=?
      AND s.role_key=? ORDER BY s.display_order,a.agent_id`, scope.ownerId, scope.bookId, roleKey).map((row) => ({
        agentId: str(row.agent_id), modelSnapshotId: str(row.model_snapshot_id), signatureHash: sha256(`${str(row.provider)}/${str(row.model_id)}`),
        costTier: str(row.base_cost_tier) as CostTier, load: num(row.load), healthPenalty: num(row.health_penalty),
        available: num(row.enabled) === 1 && num(row.setting_enabled) === 1 && !['disabled','paused'].includes(str(row.activation_state))
      }));
  }

  private requireSelectableMember(scope: BookScope, agentId: string, roleKey: string): SelectableMember {
    const member = this.selectableMembers(scope, roleKey as EditorialRoleKey).find((item) => item.agentId === agentId && item.available);
    if (member === undefined) throw conflict('替换成员不可用或不属于当前岗位');
    return member;
  }

  private insertBatchMember(scope: BookScope, batchId: string, member: SelectableMember, contextPackId: string,
    contextPackHash: string, now: string): void {
    this.assertIndependentModel(batchId, member.signatureHash);
    this.persistence.statement(`INSERT INTO ai_node_batch_members_v6 (batch_member_id,owner_id,book_id,batch_id,agent_id,
      model_snapshot_id,model_signature_hash,context_pack_id,context_pack_hash,status,attempt_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'queued',0,?,?)`).run(this.ids.next(), scope.ownerId, scope.bookId, batchId, member.agentId,
        member.modelSnapshotId, member.signatureHash, contextPackId, contextPackHash, now, now);
  }

  private assertIndependentModel(batchId: string, signatureHash: string): void {
    if (this.one(`SELECT 1 AS ok FROM ai_node_batch_members_v6 WHERE batch_id=? AND model_signature_hash=?`, batchId,
      signatureHash) !== undefined) throw conflict('同一模型不能作为独立成员重复参与同一批次');
  }

  private ensureSkills(skills: AgentSkillSnapshot[]): void {
    for (const skill of skills) {
      this.persistence.statement(`INSERT OR IGNORE INTO agent_skill_versions_v6 (skill_version_id,layer,role_key,node_kind,version,
        content_json,content_hash,status,created_at) VALUES (?,?,?,?,?,?,?,'active',?)`).run(skill.skillVersionId, skill.layer,
          skill.roleKey, skill.nodeKind, skill.version, stableJson(skill.content), skill.contentHash, this.now());
      const stored = this.one(`SELECT content_hash FROM agent_skill_versions_v6 WHERE skill_version_id=?`, skill.skillVersionId);
      if (str(stored?.content_hash) !== skill.contentHash) throw new Error(`Skill ${skill.skillVersionId} 已变化，必须提升版本`);
    }
  }

  private selectReleasedTemplate(scope: BookScope, input: CreateAiNodeBatchInput,
    fallback: CreativeTemplateSnapshot): CreativeTemplateSnapshot {
    const active = this.one(`SELECT template_version_id,template_key,target_object,version,schema_json,
      prompt_contract_json,content_hash,rollout_percent FROM creative_template_versions_v6
      WHERE template_key=? AND status='active' ORDER BY version DESC LIMIT 1`, fallback.templateKey);
    if (active === undefined || str(active.target_object) !== input.nodeKind) return fallback;
    const rollout = Math.min(100, Math.max(0, num(active.rollout_percent)));
    const cohort = Number.parseInt(sha256(`${scope.ownerId}:${scope.bookId}:${input.idempotencyKey}`).slice(0, 8), 16) % 100;
    if (rollout <= cohort) return fallback;
    return { templateVersionId: str(active.template_version_id), templateKey: str(active.template_key),
      targetObject: str(active.target_object), version: num(active.version), schema: parseObject(str(active.schema_json)),
      promptContract: parseObject(str(active.prompt_contract_json)), contentHash: str(active.content_hash) };
  }
  private ensureTemplate(template: CreativeTemplateSnapshot): void {
    const active = this.one(`SELECT template_version_id FROM creative_template_versions_v6 WHERE template_key=? AND status='active'`,
      template.templateKey);
    const initialStatus = active === undefined || str(active.template_version_id) === template.templateVersionId ? 'active' : 'superseded';
    this.persistence.statement(`INSERT OR IGNORE INTO creative_template_versions_v6 (template_version_id,template_key,
      target_object,version,schema_json,prompt_contract_json,content_hash,status,rollout_percent,created_at)
      VALUES (?,?,?,?,?,?,?,?,100,?)`).run(template.templateVersionId, template.templateKey, template.targetObject,
        template.version, stableJson(template.schema), stableJson(template.promptContract), template.contentHash, initialStatus, this.now());
    const stored = this.one(`SELECT content_hash FROM creative_template_versions_v6 WHERE template_version_id=?`, template.templateVersionId);
    if (str(stored?.content_hash) !== template.contentHash) throw new Error(`创作模板 ${template.templateVersionId} 已变化，必须提升版本`);
  }
  private refreshBatchStatus(scope: BookScope, batchId: string): void {
    const counts = this.one(`SELECT SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('failed','unavailable') THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('queued','working') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status<>'replaced' THEN 1 ELSE 0 END) AS total FROM ai_node_batch_members_v6 WHERE batch_id=?`, batchId)!;
    const completed = num(counts.completed); const failed = num(counts.failed); const pending = num(counts.pending);
    const status = pending > 0 ? (completed > 0 || failed > 0 ? 'partial_success' : 'working')
      : completed > 0 ? (failed > 0 ? 'partial_success' : 'completed') : 'failed';
    this.persistence.statement(`UPDATE ai_node_batches_v6 SET status=?,updated_at=? WHERE owner_id=? AND book_id=? AND batch_id=?`)
      .run(status, this.now(), scope.ownerId, scope.bookId, batchId);
  }

  private ensureExecutionQueued(scope: BookScope, batchId: string, assignedAgentId: string, action: string): void {
    const batch = this.requireBatch(scope, batchId);
    const currentTask = this.one(`SELECT status,task_brief_json FROM tasks WHERE owner_id=? AND book_id=? AND task_id=?`,
      scope.ownerId, scope.bookId, str(batch.task_id));
    if (currentTask !== undefined && ['pending','queued','working'].includes(str(currentTask.status))) return;
    const budget = this.one(`SELECT budget_id FROM budgets WHERE owner_id=? AND book_id=? AND status='active'
      ORDER BY created_at LIMIT 1`, scope.ownerId, scope.bookId);
    if (budget === undefined) throw conflict('当前书籍没有可用预算，无法恢复团队任务');
    const priorBrief = currentTask === undefined ? {} : parseObject(str(currentTask.task_brief_json));
    const taskId = this.ids.next(); const tasks = new TaskService(this.database, this.releaseId, this.clock);
    tasks.create(scope, {
      taskId, taskType: `ai_node:${str(batch.node_kind)}`, assignedAgentId,
      idempotencyKey: `ai-node:${batchId}:${action}:${taskId}`, budgetId: str(budget.budget_id),
      initialPhase: 'ai_node_members', brief: { ...priorBrief, batchId, recoveryAction: action }
    });
    this.persistence.statement(`UPDATE ai_node_batches_v6 SET task_id=?,status='working',updated_at=?
      WHERE owner_id=? AND book_id=? AND batch_id=?`).run(taskId, this.now(), scope.ownerId, scope.bookId, batchId);
    tasks.queue(scope, taskId);
  }

  private touchBatch(scope: BookScope, batchId: string): void {
    this.persistence.statement(`UPDATE ai_node_batches_v6 SET status='working',updated_at=? WHERE owner_id=? AND book_id=? AND batch_id=?`)
      .run(this.now(), scope.ownerId, scope.bookId, batchId);
  }

  private requireBatch(scope: BookScope, batchId: string): Stored {
    this.requireBook(scope); const row = this.one(`SELECT * FROM ai_node_batches_v6 WHERE owner_id=? AND book_id=? AND batch_id=?`,
      scope.ownerId, scope.bookId, batchId);
    if (row === undefined) throw notFound('AI 节点批次不存在或不属于当前书籍');
    return row;
  }

  private requireBook(scope: BookScope): void {
    assertBookScope(scope);
    if (this.one(`SELECT 1 AS ok FROM books WHERE owner_id=? AND book_id=?`, scope.ownerId, scope.bookId) === undefined) {
      throw notFound('书籍不存在或不属于当前账号');
    }
  }
  private one(sql: string, ...params: SqlValue[]): Stored | undefined { return this.persistence.statement(sql).get(...params) as Stored | undefined; }
  private rows(sql: string, ...params: SqlValue[]): Stored[] { return this.persistence.statement(sql).all(...params) as unknown as Stored[]; }
  private now(): string { return this.clock.now().toISOString(); }
  private tx<T>(work: () => T): T { return this.persistence.transaction(work); }
}

interface SelectableMember {
  agentId: string; modelSnapshotId: string; signatureHash: string; costTier: CostTier; load: number; healthPenalty: number; available: boolean;
}

function estimateCost(members: SelectableMember[], input: Pick<CreateAiNodeBatchInput,
  'hardSources' | 'optionalSources' | 'tokenBudget' | 'outputTokenBudget' | 'reasoningLevel' | 'roundCount' | 'exampleCount'>): AiNodeCostEstimate {
  const chars = [...input.hardSources, ...input.optionalSources].reduce((sum, source) => sum + source.content.length, 0);
  const inputUnits = Math.max(1, Math.ceil(Math.min(input.tokenBudget ?? 12_000, Math.max(2_000, chars / 2)) / 4_000));
  const outputUnits = Math.max(1, Math.ceil((input.outputTokenBudget ?? 4_000) / 4_000));
  const reasoningMultiplier = input.reasoningLevel === 'deep' ? 1.6 : input.reasoningLevel === 'light' ? 0.8 : 1;
  const roundMultiplier = Math.max(1, Math.min(4, input.roundCount ?? 1));
  const exampleUnits = Math.max(0, Math.min(4, input.exampleCount ?? 0));
  const perMember = Math.max(1, Math.ceil((inputUnits + outputUnits + exampleUnits) * reasoningMultiplier * roundMultiplier));
  const units = members.reduce((sum, member) => sum + perMember * costUnits(member.costTier), 0);
  const tier: CostTier = units >= 10 || members.some((member) => member.costTier === 'high') ? 'high' : units >= 4 ? 'medium' : 'low';
  return { tier, units, memberCount: members.length,
    incrementalUnits: members.length <= 1 ? 0 : units - perMember * costUnits(members[0]!.costTier),
    multiplier: members.length, requiresConfirmation: tier === 'high' || members.length > 2 };
}function normalizeRole(role: string): EditorialRoleKey | null {
  if (role.startsWith('custom_chief_editor_')) return 'chief_editor';
  if (role.startsWith('custom_deputy_editor_')) return 'deputy_editor';
  if (role.startsWith('custom_screenwriter_')) return 'screenwriter';
  if (role.startsWith('custom_writer_')) return 'writer';
  if (role.startsWith('custom_fact_reviewer_')) return 'fact_reviewer';
  if (role.startsWith('custom_literary_reviewer_')) return 'literary_reviewer';
  if (role.startsWith('custom_experience_reviewer_')) return 'experience_reviewer';
  if (['chief_editor','chief_editor_second','chief_editor_third'].includes(role)) return 'chief_editor';
  if (['deputy_editor','deputy_editor_second','deputy_editor_third'].includes(role)) return 'deputy_editor';
  if (['lead_screenwriter','second_screenwriter','third_screenwriter','senior_screenwriter','setting','plot_architect','continuity'].includes(role)) return 'screenwriter';
  if (['lead_writer','backup_writer','writer','writer_third','writer_fourth','writer_fifth'].includes(role)) return 'writer';
  if (['fact_reviewer','researcher','copyright'].includes(role)) return 'fact_reviewer';
  if (['literary_reviewer','literary_reviewer_second','literary_reviewer_third','reviewer','style_editor'].includes(role)) return 'literary_reviewer';
  if (['experience_reviewer','experience_challenger','experience_reviewer_third','reader_experience'].includes(role)) return 'experience_reviewer'; return null;
}
function supplier(provider: string): string {
  if (/volcengine|ark/iu.test(provider)) return '火山方舟'; if (/openai/iu.test(provider)) return 'OpenAI';
  if (/anthropic/iu.test(provider)) return 'Anthropic'; if (/google|gemini/iu.test(provider)) return 'Google';
  if (/local/iu.test(provider)) return '本地运行'; return '模型供应商';
}
function baseCost(modelId: string): CostTier {
  if (/k3|opus|pro-max|high/iu.test(modelId)) return 'high'; if (/flash|turbo|mini|lite/iu.test(modelId)) return 'low'; return 'medium';
}
function costUnits(tier: CostTier): number { return tier === 'low' ? 1 : tier === 'medium' ? 2 : 4; }
function rejectHiddenReasoning(content: Record<string, unknown>): void {
  const forbidden = Object.keys(content).find((key) => /thought|reasoning|chain.?of.?thought|思维链/iu.test(key));
  if (forbidden !== undefined) throw validation('结果不得保存或展示模型思维链');
}
function validateAuthorSummary(summary: AuthorSummary): void {
  if (!Array.isArray(summary.preserved) || !Array.isArray(summary.adjusted) || !Array.isArray(summary.omitted)) {
    throw validation('作者可见取舍说明格式无效');
  }
}
function requireText(value: string, label: string): void { if (value.trim().length === 0) throw validation(`${label}不能为空`); }
function validation(message: string): DomainError { return new DomainError(errorCodes.validation, message, {}, false, 400); }
function conflict(message: string): DomainError { return new DomainError(errorCodes.operationIncomplete, message, {}, true, 409); }
function notFound(message: string): DomainError { return new DomainError(errorCodes.bookScopeViolation, message, {}, false, 404); }
function str(value: unknown): string { return typeof value === 'string' ? value : String(value ?? ''); }
function nullable(value: unknown): string | null { return value === null || value === undefined ? null : str(value); }
function num(value: unknown): number { const parsed = Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function parseObject(value: string): Record<string, unknown> { const parsed = JSON.parse(value) as unknown;
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
function parseArray(value: string): string[] { const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function stableJson(value: unknown): string { return JSON.stringify(sort(value)); }
function sort(value: unknown): unknown { if (Array.isArray(value)) return value.map(sort);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a],[b]) => a.localeCompare(b)).map(([key,nested]) => [key,sort(nested)])); return value; }
