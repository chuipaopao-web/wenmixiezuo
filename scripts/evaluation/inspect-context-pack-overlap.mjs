import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const taskId = process.argv[2];
if (!taskId) throw new Error('请提供任务编号');

const db = new DatabaseSync('data/database/wenmi.sqlite', { readOnly: true });
const packs = db.prepare(`
  SELECT context_pack_id, agent_id, policy_version, total_tokens,
    source_manifest_json, excluded_sources_json, created_at
  FROM context_packs
  WHERE task_id = ?
  ORDER BY rowid
`).all(taskId).map((row) => {
  const sources = JSON.parse(row.source_manifest_json);
  return {
    contextPackId: row.context_pack_id,
    agentId: row.agent_id,
    policyVersion: row.policy_version,
    totalTokens: row.total_tokens,
    createdAt: row.created_at,
    sources: sources.map((source) => ({
      order: source.order,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      version: source.version,
      hard: source.hard,
      characters: source.content.length,
      contentHash: createHash('sha256').update(source.content).digest('hex').slice(0, 12)
    })),
    excluded: JSON.parse(row.excluded_sources_json)
  };
});

db.close();
process.stdout.write(JSON.stringify(packs, null, 2));
