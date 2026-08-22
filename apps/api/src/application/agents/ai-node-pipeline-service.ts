import type { DatabaseSync } from 'node:sqlite';
import { SqliteDataRepository } from '../../infrastructure/db/repositories/sqlite-data-repository.js';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import type { BookScope } from '../../domain/scope.js';
import { ModelAdapterFactory } from '../../infrastructure/models/model-adapter-factory.js';
import { thinkingTokenAllowance } from '../../infrastructure/models/model-runtime-config.js';
import type { BudgetService } from '../budget/budget-service.js';
import type { ModelCallService } from '../calls/model-call-service.js';
import { estimateTokens } from '../memory/context-pack-service.js';
import { TaskService, type TaskLeaseFence } from '../tasks/task-service.js';
import { AiNodeBatchService } from './ai-node-batch-service.js';

type Stored = Record<string, unknown>;
type SqlValue = string | number | bigint | Uint8Array | null;
type Candidate = {
  candidateKind: string;
  content: Record<string, unknown>;
  authorSummary: { preserved: string[]; adjusted: string[]; omitted: Array<{ item: string; reason: string }> };
};

const OUTPUT_TOKEN_LIMIT = 4_000;

export class AiNodePipelineService {
  private readonly persistence: SqliteDataRepository;

  public constructor(
    private readonly database: DatabaseSync,
    private readonly releaseId: string,
    private readonly tasks: TaskService,
    private readonly budgets: BudgetService,
    private readonly calls: ModelCallService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly modelAdapters: ModelAdapterFactory
  ) { this.persistence = new SqliteDataRepository(database); }

  public async executeClaimed(scope: BookScope, taskId: string, workerId: string,
    fence?: TaskLeaseFence): Promise<{ batchId: string; completed: number; failed: number }> {
    const task = this.tasks.require(scope, taskId);
    this.assertClaim(task, workerId, fence);
    const batch = this.one(`SELECT * FROM ai_node_batches_v6 WHERE owner_id=? AND book_id=? AND task_id=?`,
      scope.ownerId, scope.bookId, taskId);
    if (batch === undefined) throw new Error('AI节点任务缺少批次记录');
    const batchId = str(batch.batch_id);
    const pack = this.one(`SELECT source_manifest_json,content_hash,policy_version FROM context_packs
      WHERE owner_id=? AND book_id=? AND context_pack_id=? AND status='active'`, scope.ownerId, scope.bookId,
      str(batch.context_pack_id));
    if (pack === undefined || str(pack.content_hash) !== str(batch.context_pack_hash)) {
      throw new Error('AI节点冻结资料包不存在或哈希不一致');
    }
    const skills = this.loadSkills(batch);
    const members = this.rows(`SELECT bm.batch_member_id,bm.agent_id,bm.model_snapshot_id,bm.context_pack_id,
      bm.context_pack_hash,m.provider,m.model_id,a.display_name,r.role_key
      FROM ai_node_batch_members_v6 bm
      JOIN agent_instances a ON a.agent_id=bm.agent_id AND a.owner_id=bm.owner_id AND a.book_id=bm.book_id
      JOIN role_templates r ON r.role_template_id=a.role_template_id AND r.version=a.role_template_version
      JOIN model_config_snapshots m ON m.model_snapshot_id=bm.model_snapshot_id
      WHERE bm.owner_id=? AND bm.book_id=? AND bm.batch_id=? AND bm.status='queued'
      ORDER BY bm.created_at,bm.batch_member_id`, scope.ownerId, scope.bookId, batchId);
    const batchService = new AiNodeBatchService(this.database, this.releaseId, this.ids, this.clock);
    let completed = 0; let failed = 0;
    for (const member of members) {
      this.assertClaim(this.tasks.require(scope, taskId), workerId, fence);
      const batchMemberId = str(member.batch_member_id);
      if (str(member.context_pack_id) !== str(batch.context_pack_id)
        || str(member.context_pack_hash) !== str(batch.context_pack_hash)) {
        batchService.recordMemberFailure(scope, batchId, batchMemberId, 'CONTEXT_PACK_MISMATCH', '成员资料包与批次不一致');
        failed += 1; continue;
      }
      this.persistence.statement(`UPDATE ai_node_batch_members_v6 SET status='working',started_at=?,updated_at=?
        WHERE owner_id=? AND book_id=? AND batch_id=? AND batch_member_id=? AND status='queued'`).run(
          this.now(), this.now(), scope.ownerId, scope.bookId, batchId, batchMemberId);
      try {
        const candidate = await this.generateCandidate(scope, task, batch, pack, skills, member, fence);
        batchService.recordMemberResult(scope, batchId, batchMemberId, candidate);
        completed += 1;
      } catch (error) {
        batchService.recordMemberFailure(scope, batchId, batchMemberId, failureClass(error), publicFailureMessage(error));
        failed += 1;
      }
      this.tasks.checkpoint(scope, taskId, workerId, 'ai_node_members', {
        batchId, completed, failed, total: members.length
      }, fence);
    }
    const latest = batchService.viewBatch(scope, batchId);
    if (latest.progress.completed > 0) this.tasks.complete(scope, taskId, workerId, fence);
    else this.tasks.fail(scope, taskId, workerId, 'AI_NODE_ALL_MEMBERS_FAILED', fence);
    return { batchId, completed: latest.progress.completed, failed: latest.progress.failed };
  }

  private async generateCandidate(scope: BookScope, task: ReturnType<TaskService['require']>, batch: Stored,
    pack: Stored, skills: Record<string, unknown>, member: Stored, fence?: TaskLeaseFence): Promise<Candidate> {
    if (task.budgetId === null) throw new Error('AI节点任务缺少冻结预算');
    const adapter = this.modelAdapters.resolve(str(member.provider), str(member.model_id), 'discussion', str(member.role_key) as never);
    const manifest = parseArray(str(pack.source_manifest_json));
    const taskBrief = task.brief;
    const basePrompt = JSON.stringify({
      operation: 'wenmi_ai_editorial_node_v6',
      language: 'zh-CN',
      node: {
        kind: str(batch.node_kind),
        objectId: str(batch.object_id),
        task: text(taskBrief.taskDescription)
      },
      member: { role: str(batch.role_key), name: str(member.display_name) },
      frozenContract: {
        contextPackId: str(batch.context_pack_id),
        contextPackHash: str(batch.context_pack_hash),
        policyVersion: str(pack.policy_version),
        templateVersion: str(batch.template_version),
        skills
      },
      instructions: [
        '只使用下方冻结资料包完成当前节点，不查询或臆造其他书籍信息。',
        '正式事实、作者要求、计划和实际必须分开；当前节点之外的层级只指出缺口，不越级扩写。',
        '直接给出可供作者选择的专业候选，不输出思维链、推理过程、隐藏分析或模型信息。',
        '只输出一个JSON对象，结构为：{"candidateKind":"节点类型","content":{},"authorSummary":{"preserved":[],"adjusted":[],"omitted":[{"item":"","reason":""}]}}。',
        'content必须是有内容的对象；authorSummary只说明保留、专业调整、未采用及简短原因。'
      ],
      contextPack: manifest
    });
    let validationIssue: string | null = null; let lastError: unknown;
    for (let technicalTry = 1; technicalTry <= 2; technicalTry += 1) {
      const prompt = validationIssue === null ? basePrompt
        : `${basePrompt}\n\n上一份输出未通过合同校验：${validationIssue}。请重新输出完整JSON，不要解释。`;
      const requestId = this.ids.next();
      const reserveTokens = Math.max(10_000,
        Math.ceil(estimateTokens(prompt) * 1.35) + OUTPUT_TOKEN_LIMIT + thinkingTokenAllowance(str(member.model_id)));
      const reservationId = this.budgets.reserve(scope, task.budgetId, requestId, reserveTokens, 0);
      try {
        const result = await this.calls.execute(scope, {
          requestId, taskId: task.taskId,
          phaseKey: `ai-node:${str(batch.node_kind)}:${str(member.batch_member_id)}:try-${technicalTry}`,
          agentId: str(member.agent_id), modelSnapshotId: str(member.model_snapshot_id),
          provider: str(member.provider), modelId: str(member.model_id), input: prompt,
          parameters: JSON.stringify({ maxOutputTokens: OUTPUT_TOKEN_LIMIT, cashFallbackAllowed: false }),
          reservationId, contextPackId: str(batch.context_pack_id),
          leaseToken: fence?.leaseToken ?? null, attemptNo: fence?.attemptNo ?? 0
        }, adapter, {
          requestId, taskId: task.taskId, ownerId: scope.ownerId, bookId: scope.bookId,
          agentId: str(member.agent_id), prompt, maxOutputTokens: OUTPUT_TOKEN_LIMIT
        });
        try { return parseCandidate(result.output, str(batch.node_kind)); }
        catch (error) { validationIssue = error instanceof Error ? error.message : '输出JSON无效'; lastError = error; }
      } catch (error) {
        lastError = error;
        if (this.hasUnresolvedCall(scope, requestId)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('成员没有返回可提交的节点方案');
  }

  private loadSkills(batch: Stored): Record<string, unknown> {
    const ids = [str(batch.core_skill_version_id), str(batch.role_skill_version_id), str(batch.node_protocol_version_id)];
    const rows = this.rows(`SELECT skill_version_id,layer,content_json,content_hash FROM agent_skill_versions_v6
      WHERE skill_version_id IN (?,?,?)`, ...ids);
    if (rows.length !== 3) throw new Error('AI节点冻结Skill版本不完整');
    return Object.fromEntries(rows.map((row) => [str(row.layer), {
      versionId: str(row.skill_version_id), hash: str(row.content_hash), content: parseObject(str(row.content_json))
    }]));
  }

  private hasUnresolvedCall(scope: BookScope, requestId: string): boolean {
    return this.one(`SELECT 1 AS ok FROM model_calls WHERE owner_id=? AND book_id=? AND request_id=? AND state='interrupted'`,
      scope.ownerId, scope.bookId, requestId) !== undefined;
  }

  private assertClaim(task: ReturnType<TaskService['require']>, workerId: string, fence?: TaskLeaseFence): void {
    if (!task.taskType.startsWith('ai_node:') || task.status !== 'working' || task.leaseOwner !== workerId
      || (fence !== undefined && (task.leaseToken !== fence.leaseToken || task.currentAttemptNo !== fence.attemptNo))) {
      throw new Error('AI节点任务未由指定Worker持有');
    }
  }

  private one(sql: string, ...params: SqlValue[]): Stored | undefined { return this.persistence.statement(sql).get(...params) as Stored | undefined; }
  private rows(sql: string, ...params: SqlValue[]): Stored[] { return this.persistence.statement(sql).all(...params) as unknown as Stored[]; }
  private now(): string { return this.clock.now().toISOString(); }
}

export function parseCandidate(output: string, nodeKind: string): Candidate {
  const candidates: unknown[] = [];
  try { candidates.push(JSON.parse(output) as unknown); } catch { /* inspect complete embedded objects */ }
  for (const block of extractJsonObjects(output)) {
    try { candidates.push(JSON.parse(block) as unknown); } catch { /* continue */ }
  }
  for (const candidate of candidates) {
    if (!record(candidate)) continue;
    const content = candidate.content;
    const summary = candidate.authorSummary;
    if (!record(content) || Object.keys(content).length === 0 || containsHiddenReasoning(content) || !record(summary)) continue;
    const preserved = stringArray(summary.preserved); const adjusted = stringArray(summary.adjusted);
    const rawOmitted = Array.isArray(summary.omitted) ? summary.omitted : null;
    if (preserved === null || adjusted === null || rawOmitted === null) continue;
    const omitted = rawOmitted.flatMap((item) => record(item) && nonEmpty(item.item) && nonEmpty(item.reason)
      ? [{ item: String(item.item).trim(), reason: String(item.reason).trim() }] : []);
    if (omitted.length !== rawOmitted.length) continue;
    return { candidateKind: nonEmpty(candidate.candidateKind) ? String(candidate.candidateKind).trim() : nodeKind,
      content, authorSummary: { preserved, adjusted, omitted } };
  }
  throw new Error('输出缺少合法的候选内容与作者处理说明');
}

function containsHiddenReasoning(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsHiddenReasoning(item, depth + 1));
  return Object.entries(value).some(([key, item]) => /chain.?of.?thought|思维链|推理过程|hidden.?reason/i.test(key)
    || containsHiddenReasoning(item, depth + 1));
}

function extractJsonObjects(textValue: string): string[] {
  const values: string[] = []; let depth = 0; let start = -1; let quoted = false; let escaped = false;
  for (let index = 0; index < textValue.length; index += 1) {
    const char = textValue[index]!;
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') { if (depth === 0) start = index; depth += 1; }
    else if (char === '}' && depth > 0) { depth -= 1; if (depth === 0 && start >= 0) values.push(textValue.slice(start, index + 1)); }
  }
  return values;
}

function failureClass(error: unknown): string {
  const name = error instanceof Error ? error.name : 'AI_NODE_MEMBER_FAILED';
  return /^[A-Z][A-Z0-9_]{1,80}$/u.test(name) ? name : 'AI_NODE_MEMBER_FAILED';
}
function publicFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '成员本轮没有返回可用方案';
  return message.replace(/(?:api[_ -]?key|authorization|bearer)\s*[:=]\s*\S+/giu, '[已隐藏]').slice(0, 500);
}
function parseArray(value: string): unknown[] { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed : []; }
function parseObject(value: string): Record<string, unknown> { const parsed = JSON.parse(value) as unknown; return record(parsed) ? parsed : {}; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nonEmpty(value: unknown): boolean { return typeof value === 'string' && value.trim().length > 0; }
function stringArray(value: unknown): string[] | null { return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value.map((item) => item.trim()).filter(Boolean) : null; }
function str(value: unknown): string { return typeof value === 'string' ? value : String(value ?? ''); }
function text(value: unknown): string { return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '完成当前创作节点'; }
