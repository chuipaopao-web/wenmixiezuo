import type { DatabaseSync } from 'node:sqlite';

export class TechniqueCardRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public insertIfMissing(input: {
    cardId: string; key: string; displayName: string; goalsJson: string; methodsJson: string;
    risksJson: string; counterexamplesJson: string; mechanizationWarning: string;
    applicabilityJson: string; now: string;
  }): boolean {
    const result = this.database.prepare(`
      INSERT INTO technique_cards (
        technique_card_id, technique_key, version, display_name, narrative_goals_json,
        optional_methods_json, risks_json, counterexamples_json, mechanization_warning,
        copyright_isolation_status, applicability_json, status, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'cleared', ?, 'active', ?)
      ON CONFLICT(technique_key, version) DO NOTHING
    `).run(
      input.cardId, input.key, input.displayName, input.goalsJson, input.methodsJson,
      input.risksJson, input.counterexamplesJson, input.mechanizationWarning,
      input.applicabilityJson, input.now
    );
    return result.changes === 1;
  }

  public listActive(): Array<Record<string, unknown>> {
    return this.database.prepare(`
      SELECT technique_card_id, technique_key, version, display_name, narrative_goals_json,
             optional_methods_json, risks_json, counterexamples_json, mechanization_warning,
             applicability_json FROM technique_cards WHERE status = 'active' ORDER BY technique_key
    `).all() as unknown as Array<Record<string, unknown>>;
  }
}
