import type { DatabaseSync } from 'node:sqlite';

export class PromptTemplateRepository {
  public constructor(private readonly database: DatabaseSync) {}
  public active(roleKey: string): { id: string; version: number; hash: string } | null {
    const row = this.database.prepare(`SELECT prompt_template_snapshot_id, version, content_hash FROM prompt_template_snapshots
      WHERE role_key = ? AND status = 'active' ORDER BY version DESC LIMIT 1`).get(roleKey) as { prompt_template_snapshot_id: string; version: number; content_hash: string } | undefined;
    return row === undefined ? null : { id: row.prompt_template_snapshot_id, version: row.version, hash: row.content_hash };
  }
  public insert(input: { id: string; roleKey: string; version: number; contract: unknown; hardRules: unknown; outputSchema: unknown; retrievalProfile: unknown; hash: string; now: string }): void {
    this.database.prepare(`UPDATE prompt_template_snapshots SET status = 'superseded' WHERE role_key = ? AND status = 'active'`).run(input.roleKey);
    this.database.prepare(`INSERT INTO prompt_template_snapshots (
      prompt_template_snapshot_id, role_key, version, public_contract_json, hard_rules_json, output_schema_json,
      retrieval_profile_json, content_hash, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(input.id, input.roleKey, input.version, JSON.stringify(input.contract),
      JSON.stringify(input.hardRules), JSON.stringify(input.outputSchema), JSON.stringify(input.retrievalProfile), input.hash, input.now);
  }
}
