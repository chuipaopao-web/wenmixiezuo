import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Clock, IdGenerator } from '../../domain/ids.js';
import { assertBookScope, type BookScope } from '../../domain/scope.js';

export interface WriterSelection {
  writerSelectionId: string;
  mode: 'standard_blind' | 'quick' | 'owner_specified';
  writerAgentId: string;
  writerModelSnapshotId: string;
  reviewerAgentId: string;
  reviewerModelSnapshotId: string;
  candidates: Array<{
    blindLabel: string;
    provider: string;
    modelId: string;
    score: number;
    sampleHash: string;
    sampleText: string;
    equalContextHash: string;
    revisionOpportunity: number;
  }>;
}

interface AgentModelRow {
  agent_id: string;
  model_snapshot_id: string;
  provider: string;
  model_id: string;
}

export class WriterSelectionService {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly ids: IdGenerator,
    private readonly clock: Clock
  ) {}

  public select(
    scope: BookScope,
    mode: WriterSelection['mode'] = 'standard_blind',
    ownerChoice: 'writer_a' | 'writer_b' = 'writer_a'
  ): WriterSelection {
    assertBookScope(scope);
    const existing = this.database.prepare(`
      SELECT writer_selection_id FROM writer_selections
      WHERE owner_id = ? AND book_id = ? AND status = 'selected'
      ORDER BY created_at DESC LIMIT 1
    `).get(scope.ownerId, scope.bookId) as { writer_selection_id: string } | undefined;
    if (existing !== undefined) return this.require(scope, existing.writer_selection_id);
    const writer = this.requireRole(scope, 'role-writer');
    const reviewer = this.requireRole(scope, 'role-reviewer');
    const writerProfile = ownerChoice === 'writer_b'
      ? { provider: 'local-deterministic-candidate-b', modelId: 'wenmi-novel-candidate-b-v1' }
      : { provider: 'local-deterministic-writer', modelId: 'wenmi-novel-writer-v1' };
    const writerSnapshotId = this.configureAgent(scope, writer.agent_id, writerProfile.provider, writerProfile.modelId);
    const reviewerSnapshotId = this.configureAgent(scope, reviewer.agent_id, 'local-deterministic-reviewer', 'wenmi-novel-reviewer-v1');
    const blindBrief = JSON.stringify({ premise: '雨夜进入北塔调查导师失踪', targetCharacters: 700, revisionOpportunity: 1 });
    const equalContextHash = createHash('sha256').update(blindBrief).digest('hex');
    const makeCandidate = (blindLabel: string, provider: string, modelId: string, score: number) => {
      const sampleText = buildBlindSample(blindLabel, provider, modelId);
      return {
        blindLabel, provider, modelId, score, sampleText,
        sampleHash: createHash('sha256').update(sampleText).digest('hex'),
        equalContextHash,
        revisionOpportunity: 1
      };
    };
    const candidates = mode === 'quick'
      ? [makeCandidate('A', writerProfile.provider, writerProfile.modelId, 90)]
      : [
          makeCandidate('A', 'local-deterministic-writer', 'wenmi-novel-writer-v1', 91),
          makeCandidate('B', 'local-deterministic-candidate-b', 'wenmi-novel-candidate-b-v1', 88)
        ];
    const selected = ownerChoice === 'writer_b' ? candidates.find((candidate) => candidate.modelId.includes('candidate-b')) ?? candidates[0]! : candidates[0]!;
    const selectionId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.prepare(`
      INSERT INTO writer_selections (
        writer_selection_id, owner_id, book_id, mode, selected_agent_id,
        selected_model_snapshot_id, candidates_json, decision_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'selected', ?)
    `).run(
      selectionId, scope.ownerId, scope.bookId, mode, writer.agent_id, writerSnapshotId,
      JSON.stringify(candidates), JSON.stringify({ selectedBlindLabel: selected.blindLabel, scoring: 'deterministic-fixture-v1', ownerChoice: mode === 'owner_specified' ? ownerChoice : null }), now
    );
    return this.require(scope, selectionId, reviewer.agent_id, reviewerSnapshotId);
  }

  public require(scope: BookScope, selectionId: string, reviewerAgentId?: string, reviewerModelSnapshotId?: string): WriterSelection {
    const row = this.database.prepare(`
      SELECT writer_selection_id, mode, selected_agent_id, selected_model_snapshot_id, candidates_json
      FROM writer_selections WHERE writer_selection_id = ? AND owner_id = ? AND book_id = ?
    `).get(selectionId, scope.ownerId, scope.bookId) as {
      writer_selection_id: string;
      mode: WriterSelection['mode'];
      selected_agent_id: string;
      selected_model_snapshot_id: string;
      candidates_json: string;
    } | undefined;
    if (row === undefined) throw new Error('主笔选择不存在或越权');
    const reviewer = reviewerAgentId === undefined ? this.requireRole(scope, 'role-reviewer') : undefined;
    return {
      writerSelectionId: row.writer_selection_id,
      mode: row.mode,
      writerAgentId: row.selected_agent_id,
      writerModelSnapshotId: row.selected_model_snapshot_id,
      reviewerAgentId: reviewerAgentId ?? reviewer!.agent_id,
      reviewerModelSnapshotId: reviewerModelSnapshotId ?? reviewer!.model_snapshot_id,
      candidates: JSON.parse(row.candidates_json) as WriterSelection['candidates']
    };
  }

  public assertDistinctModels(scope: BookScope, selection: WriterSelection): void {
    const writer = this.database.prepare(`SELECT provider, model_id FROM model_config_snapshots WHERE model_snapshot_id = ? AND owner_id = ? AND book_id = ?`)
      .get(selection.writerModelSnapshotId, scope.ownerId, scope.bookId) as { provider: string; model_id: string };
    const reviewer = this.database.prepare(`SELECT provider, model_id FROM model_config_snapshots WHERE model_snapshot_id = ? AND owner_id = ? AND book_id = ?`)
      .get(selection.reviewerModelSnapshotId, scope.ownerId, scope.bookId) as { provider: string; model_id: string };
    if (writer.provider === reviewer.provider && writer.model_id === reviewer.model_id) throw new Error('主笔和审校模型配置相同，不能进行独立复核');
  }

  private configureAgent(scope: BookScope, agentId: string, provider: string, modelId: string): string {
    const current = this.database.prepare(`
      SELECT a.model_snapshot_id, m.provider, m.model_id FROM agent_instances a
      JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.agent_id = ? AND a.owner_id = ? AND a.book_id = ?
    `).get(agentId, scope.ownerId, scope.bookId) as unknown as Pick<AgentModelRow, 'model_snapshot_id' | 'provider' | 'model_id'>;
    if (current.provider === provider && current.model_id === modelId) return current.model_snapshot_id;
    const snapshotId = this.ids.next();
    const now = this.clock.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        INSERT INTO model_config_snapshots (
          model_snapshot_id, owner_id, book_id, provider, model_id,
          parameters_json, capabilities_json, validated_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, '["text"]', ?, ?)
      `).run(snapshotId, scope.ownerId, scope.bookId, provider, modelId, JSON.stringify({ deterministicFixture: true, cashCostCny: 0 }), now, now);
      this.database.prepare(`UPDATE agent_instances SET model_snapshot_id = ?, updated_at = ? WHERE agent_id = ? AND owner_id = ? AND book_id = ?`)
        .run(snapshotId, now, agentId, scope.ownerId, scope.bookId);
      this.database.exec('COMMIT');
      return snapshotId;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private requireRole(scope: BookScope, roleTemplateId: string): AgentModelRow {
    const row = this.database.prepare(`
      SELECT a.agent_id, a.model_snapshot_id, m.provider, m.model_id
      FROM agent_instances a JOIN model_config_snapshots m ON m.model_snapshot_id = a.model_snapshot_id
      WHERE a.owner_id = ? AND a.book_id = ? AND a.role_template_id = ?
    `).get(scope.ownerId, scope.bookId, roleTemplateId) as AgentModelRow | undefined;
    if (row === undefined) throw new Error(`岗位不存在：${roleTemplateId}`);
    return row;
  }
}

function buildBlindSample(blindLabel: string, provider: string, modelId: string): string {
  const seed = createHash('sha256').update(`${provider}/${modelId}`).digest('hex').slice(0, 8);
  const opening = blindLabel === 'A'
    ? '雨线斜过北塔，林澈先看见门槛内侧的干泥，才听见楼上传来的脚步。'
    : '北塔沉在雨里。林澈停在门前，从积水倒影中辨出二楼尚未熄灭的灯。';
  const beats = [
    '他没有立刻推门，而是核对钥匙齿间的新刻痕。',
    '守门人的目光先落在钥匙上，随后才确认他的脸。',
    '这处次序让他意识到，被等待的是物件而不是来客。',
    '楼内账册缺了一页，残留的墨迹指向尚未到来的第三个日期。',
    '他留下一个错误时辰，准备借修正痕迹找到真正的记账人。'
  ];
  let sample = `${opening}${beats.join('')}`;
  while (sample.length < 700) sample += beats[(sample.length + seed.length) % beats.length];
  return sample.slice(0, 700);
}
