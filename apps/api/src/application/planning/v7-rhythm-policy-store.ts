import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_RHYTHM_POLICY, RHYTHM_LAYERS, renderRhythmFragment, validateRhythmPolicy,
  type RhythmPolicy, type RhythmPolicySnapshot, type PlanningLayerKey } from '@wenmi/v7-backend';
import { DomainError, errorCodes } from '../../domain/errors.js';

interface Row { version: number; policy_json: string; created_at: string; actor_id: string }
export class V7RhythmPolicyStore {
  constructor(private readonly database: DatabaseSync) {}
  initialize(now: string): void {
    this.database.prepare('INSERT OR IGNORE INTO v7_rhythm_policy_versions(version,policy_json,actor_id,created_at) VALUES(1,?,?,?)')
      .run(JSON.stringify(validateRhythmPolicy(DEFAULT_RHYTHM_POLICY)), 'system', now);
    if (!this.database.prepare("SELECT 1 FROM v7_rhythm_policy_versions WHERE json_extract(policy_json,'$.format')='audited-v4' LIMIT 1").get()) {
      this.database.prepare('INSERT INTO v7_rhythm_policy_versions(version,policy_json,actor_id,created_at) SELECT MAX(version)+1,?,?,? FROM v7_rhythm_policy_versions')
        .run(JSON.stringify(validateRhythmPolicy(DEFAULT_RHYTHM_POLICY)), 'system-r190',now);
    }
  }
  current(): RhythmPolicySnapshot {
    const row = this.database.prepare('SELECT * FROM v7_rhythm_policy_versions ORDER BY version DESC LIMIT 1').get() as unknown as Row | undefined;
    return row ? { version: row.version, policy: validateRhythmPolicy(JSON.parse(row.policy_json)) }
      : { version: 1, policy: structuredClone(DEFAULT_RHYTHM_POLICY) };
  }
  view(): object {
    return { ...this.current(), enabled: process.env.WENMI_V7_ASSET_MENU === '1',
      agentEvents: this.database.prepare('SELECT session_id AS sessionId,step,member_key AS memberKey,layer,policy_version AS policyVersion,event_json AS eventJson,created_at AS createdAt FROM v7_method_agent_events ORDER BY created_at DESC LIMIT 100').all().map(row=>({...row,event:JSON.parse(String(row.eventJson)),eventJson:undefined})),
      history: this.database.prepare('SELECT version,created_at AS createdAt FROM v7_rhythm_policy_versions ORDER BY version DESC LIMIT 20').all(),
      usage: this.database.prepare('SELECT version,COUNT(*) AS tasks FROM v7_rhythm_task_policies GROUP BY version ORDER BY version DESC').all() };
  }
  preview(raw: unknown): object {
    const policy = this.validate(raw);
    return { layers: Object.entries(RHYTHM_LAYERS).map(([key, value]) => {
      const text = renderRhythmFragment(policy, key as PlanningLayerKey, this.current().version + 1);
      return { key, label: value.label, text, characters: text.length, selected: policy.layers[key as PlanningLayerKey] };
    }) };
  }
  publish(actorId: string, expectedVersion: unknown, raw: unknown, now: string): object {
    const policy = this.validate(raw);
    if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw invalid('配置版本无效。');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.current();
      if(current.policy.format==='audited-v4'&&policy.format!=='audited-v4')throw new DomainError(errorCodes.validation,'方法库已升级，请刷新后编辑当前版本。',{},false,409);
      if (current.version !== expectedVersion) throw new DomainError(errorCodes.validation, '配置已被其他管理员更新，请重新读取后再修改。', {}, false, 409);
      if (current.policy.format === 'complete-v3' && policy.format !== 'complete-v3') throw new DomainError(errorCodes.validation, '方法库已升级为完整目录，请刷新后台后再修改。', {}, false, 409);
      this.database.prepare('INSERT INTO v7_rhythm_policy_versions(version,policy_json,actor_id,created_at) VALUES(?,?,?,?)')
        .run(current.version + 1, JSON.stringify(policy), actorId, now);
      this.database.exec('COMMIT');
      return this.view();
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  /** Freeze on first compilation; old tasks retain the original menu. */
  snapshot(taskKey: string, taskCreatedAt: string): RhythmPolicySnapshot | null {
    const first = this.database.prepare('SELECT created_at FROM v7_rhythm_policy_versions WHERE version=1').get() as { created_at: string } | undefined;
    if (!first || taskCreatedAt < first.created_at) return null;
    this.database.prepare(`INSERT OR IGNORE INTO v7_rhythm_task_policies(task_key,version,created_at)
      SELECT ?,MAX(version),? FROM v7_rhythm_policy_versions`).run(taskKey, new Date().toISOString());
    const row = this.database.prepare(`SELECT p.* FROM v7_rhythm_task_policies t JOIN v7_rhythm_policy_versions p ON p.version=t.version WHERE t.task_key=?`)
      .get(taskKey) as unknown as Row;
    return { version: row.version, policy: validateRhythmPolicy(JSON.parse(row.policy_json)) };
  }
  private validate(raw: unknown): RhythmPolicy {
    try {
      const text = JSON.stringify(raw);
      if (!text || text.length > 250000 || /Bearer\s+[\w.-]+|\bsk-[\w-]{8,}|api[_-]?key["']?\s*[:=]/iu.test(text)) throw new Error('配置过长或包含不应保存的凭据。');
      return validateRhythmPolicy(raw);
    } catch (error) { throw invalid(error instanceof Error ? error.message : '配置格式无效。'); }
  }
}
function invalid(message: string): DomainError { return new DomainError(errorCodes.validation, message, {}, false, 400); }
