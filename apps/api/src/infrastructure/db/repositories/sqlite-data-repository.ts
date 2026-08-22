import type { DatabaseSync, StatementSync } from 'node:sqlite';

/**
 * SQLite execution boundary for application services that still own orchestration.
 * Statement preparation and transaction lifecycle stay in infrastructure so new
 * application code never manipulates the database driver directly.
 */
export class SqliteDataRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public statement(sql: string): StatementSync {
    return this.database.prepare(sql);
  }

  public transaction<T>(work: () => T): T {
    const ownsTransaction = !this.database.isTransaction;
    if (ownsTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      if (ownsTransaction) this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (ownsTransaction && this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
