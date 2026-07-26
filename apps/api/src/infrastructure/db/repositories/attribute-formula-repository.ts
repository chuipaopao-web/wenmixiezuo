import type { DatabaseSync } from 'node:sqlite';
import { assertBookScope, type BookScope } from '../../../domain/scope.js';

export interface AttributeFormulaRow {
  attribute_formula_id: string;
  formula_key: string;
  label: string;
  category: string;
  expression: string;
  variables_json: string;
  unit: string | null;
  version: number;
  status: 'active' | 'superseded' | 'archived';
}

export class AttributeFormulaRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public runInTransaction<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  public maxVersion(scope: BookScope, formulaKey: string): number {
    assertBookScope(scope);
    const row = this.database.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM attribute_formulas
      WHERE owner_id = ? AND book_id = ? AND formula_key = ?`).get(scope.ownerId, scope.bookId, formulaKey) as { version: number };
    return row.version;
  }

  public supersedeActive(scope: BookScope, formulaKey: string, now: string): void {
    assertBookScope(scope);
    this.database.prepare(`UPDATE attribute_formulas SET status = 'superseded', updated_at = ?
      WHERE owner_id = ? AND book_id = ? AND formula_key = ? AND status = 'active'`)
      .run(now, scope.ownerId, scope.bookId, formulaKey);
  }

  public insert(scope: BookScope, input: {
    formulaId: string; formulaKey: string; label: string; category: string; expression: string; variablesJson: string;
    unit: string | null; version: number; now: string;
  }): void {
    assertBookScope(scope);
    this.database.prepare(`INSERT INTO attribute_formulas (
      attribute_formula_id, owner_id, book_id, formula_key, label, category, expression, variables_json,
      unit, version, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(input.formulaId, scope.ownerId, scope.bookId, input.formulaKey, input.label, input.category, input.expression,
        input.variablesJson, input.unit, input.version, input.now, input.now);
  }

  public list(scope: BookScope, includeInactive: boolean): AttributeFormulaRow[] {
    assertBookScope(scope);
    const statement = includeInactive
      ? `SELECT * FROM attribute_formulas WHERE owner_id = ? AND book_id = ? ORDER BY formula_key, version DESC`
      : `SELECT * FROM attribute_formulas WHERE owner_id = ? AND book_id = ? AND status = 'active' ORDER BY formula_key, version DESC`;
    return this.database.prepare(statement).all(scope.ownerId, scope.bookId) as unknown as AttributeFormulaRow[];
  }

  public archive(scope: BookScope, formulaId: string, now: string): number {
    assertBookScope(scope);
    return Number(this.database.prepare(`UPDATE attribute_formulas SET status = 'archived', updated_at = ?
      WHERE attribute_formula_id = ? AND owner_id = ? AND book_id = ?`)
      .run(now, formulaId, scope.ownerId, scope.bookId).changes);
  }

  public find(scope: BookScope, formulaId: string): AttributeFormulaRow | undefined {
    assertBookScope(scope);
    return this.database.prepare(`SELECT * FROM attribute_formulas
      WHERE attribute_formula_id = ? AND owner_id = ? AND book_id = ?`)
      .get(formulaId, scope.ownerId, scope.bookId) as AttributeFormulaRow | undefined;
  }
}
