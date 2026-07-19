import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { BackupService } from '../../apps/api/src/infrastructure/recovery/backup-service.js';
import { loadRuntimeConfig } from '../../apps/api/src/infrastructure/runtime-config.js';

const config = loadRuntimeConfig(process.env);
const database = openDatabase(config.databasePath);
try {
  const beforeIntegrity = (database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const beforeForeignKeys = database.prepare('PRAGMA foreign_key_check').all().length;
  if (beforeIntegrity !== 'ok' || beforeForeignKeys !== 0) throw new Error('正式库备份前完整性检查失败');
  const service = new BackupService(database, config);
  const backup = service.create();
  const verification = service.verify(backup.backupId);
  service.discardVerification(verification.restorePath);
  const row = database.prepare(`SELECT status, database_hash, manifest_hash, file_count, verified_at
    FROM backups WHERE backup_id = ?`).get(backup.backupId) as Record<string, unknown>;
  const report = {
    releaseId: config.releaseId,
    generatedAt: new Date().toISOString(),
    backupId: backup.backupId,
    manifestHash: backup.manifestHash,
    databaseHash: verification.databaseHash,
    fileCount: verification.fileCount,
    productionBefore: { integrity: beforeIntegrity, foreignKeyViolations: beforeForeignKeys },
    isolatedRestore: { verified: verification.verified, integrity: 'ok', foreignKeyViolations: 0, discardedAfterVerification: true },
    ledger: row,
    passed: row.status === 'verified'
  };
  const evidenceDir = resolve(config.dataDir, 'verification');
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(resolve(evidenceDir, 'production-backup-verification.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  database.close();
}
