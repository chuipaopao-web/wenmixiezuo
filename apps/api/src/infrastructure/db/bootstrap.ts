import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { API_VERSION, SCHEMA_VERSION } from '../../contracts/api.js';
import type { RuntimeConfig } from '../runtime-config.js';
import { runMigrations, type MigrationResult } from './migrations.js';

export function bootstrapDatabase(database: DatabaseSync, config: RuntimeConfig): MigrationResult {
  const result = runMigrations(database, resolve(config.projectRoot, 'apps/api/src/infrastructure/db/migrations'));
  database.prepare(`
    INSERT INTO release_runs (release_id, product_name, schema_version, api_version, created_at)
    VALUES (?, '文秘写作', ?, ?, ?)
    ON CONFLICT(release_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      api_version = excluded.api_version
  `).run(config.releaseId, SCHEMA_VERSION, API_VERSION, new Date().toISOString());
  database.prepare(`
    INSERT INTO schema_meta (key, value, updated_at) VALUES ('schema_version', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(String(SCHEMA_VERSION), new Date().toISOString());
  return result;
}

