import type { DatabaseSync } from 'node:sqlite';

export class UnitOfWork {
  public constructor(private readonly database: DatabaseSync) {}

  public run<T>(work: () => T): T {
    if (this.database.isTransaction) return work();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
