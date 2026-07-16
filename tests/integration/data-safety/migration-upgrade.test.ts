import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../../apps/api/src/infrastructure/db/migrations.js';

describe('阶段2已有数据升级', () => {
  it('保留阶段1发布记录并新增安全表', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'wenmi-upgrade-'));
    const migrations = resolve(root, 'migrations');
    mkdirSync(migrations);
    const source = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    writeFileSync(resolve(migrations, '0001_foundation.sql'), readFileSync(resolve(source, '0001_foundation.sql')));
    const database = openDatabase(resolve(root, 'database.sqlite'));
    try {
      runMigrations(database, migrations);
      database.prepare("INSERT INTO release_runs (release_id, product_name, schema_version, api_version, created_at) VALUES ('release-old', '文秘写作', 1, 'v1', '2026-07-16T00:00:00Z')").run();
      writeFileSync(resolve(migrations, '0002_data_safety.sql'), readFileSync(resolve(source, '0002_data_safety.sql')));
      expect(runMigrations(database, migrations).applied).toEqual(['0002_data_safety.sql']);
      expect(database.prepare("SELECT product_name FROM release_runs WHERE release_id = 'release-old'").get())
        .toEqual({ product_name: '文秘写作' });
      expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'file_registry'").get())
        .toEqual({ name: 'file_registry' });
    } finally {
      database.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

