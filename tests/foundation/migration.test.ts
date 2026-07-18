import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../apps/api/src/infrastructure/db/database.js';
import { runMigrations } from '../../apps/api/src/infrastructure/db/migrations.js';

const tempDirectories: string[] = [];
function createTempDirectory(): string {
  const directory = mkdtempSync(resolve(tmpdir(), 'wenmi-migration-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('向前迁移器', () => {
  it('在空库执行并可安全重复运行', () => {
    const directory = createTempDirectory();
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    const migrationsDir = resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations');
    try {
      const first = runMigrations(database, migrationsDir);
      const second = runMigrations(database, migrationsDir);
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      expect(first.applied).toEqual([
        '0001_foundation.sql', '0002_data_safety.sql', '0003_runtime.sql', '0004_novel_domain.sql',
        '0005_memory_canon.sql', '0006_creation_pipeline.sql', '0007_experience_copyright.sql',
        '0008_agent_personas.sql', '0009_role_titles.sql', '0010_expression_taxonomy.sql',
        '0011_knowledge_lifecycle_time.sql', '0012_chunk_projection_snapshots.sql'
      ]);
      expect(second.applied).toEqual([]);
      expect(tables.map((row) => row.name)).toContain('worker_health');
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      expect(database.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
    } finally {
      database.close();
    }
  });

  it('失败迁移完整回滚且不登记版本', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(resolve(migrationsDir, '0001_broken.sql'), 'CREATE TABLE should_rollback(id TEXT);\nTHIS IS INVALID;', 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      expect(() => runMigrations(database, migrationsDir)).toThrow('迁移 0001_broken.sql 失败');
      const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").get();
      const applied = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get();
      expect(table).toBeUndefined();
      expect(applied).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('把已有职责长称安全升级为女性姓名和短岗位', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(resolve(migrationsDir, '0001_legacy_agents.sql'), `
      CREATE TABLE role_templates (
        role_template_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        role_key TEXT NOT NULL,
        display_name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE agent_instances (
        role_template_id TEXT NOT NULL,
        role_template_version INTEGER NOT NULL,
        display_name TEXT NOT NULL
      ) STRICT;
      INSERT INTO role_templates VALUES
        ('role-chief-editor', 1, 'chief_editor', '总编与编排'),
        ('role-style-editor', 1, 'style_editor', '文风编辑与去AI味专家');
      INSERT INTO agent_instances VALUES
        ('role-chief-editor', 1, '总编与编排'),
        ('role-style-editor', 1, '文风编辑与去AI味专家');
    `, 'utf8');
    const personaMigration = readFileSync(resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations/0008_agent_personas.sql'), 'utf8');
    writeFileSync(resolve(migrationsDir, '0002_agent_personas.sql'), personaMigration, 'utf8');
    const titleMigration = readFileSync(resolve(process.cwd(), 'apps/api/src/infrastructure/db/migrations/0009_role_titles.sql'), 'utf8');
    writeFileSync(resolve(migrationsDir, '0003_role_titles.sql'), titleMigration, 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      expect(database.prepare('SELECT role_key, display_name FROM role_templates ORDER BY role_key').all()).toEqual([
        { role_key: 'chief_editor', display_name: '主编' },
        { role_key: 'style_editor', display_name: '文编' }
      ]);
      expect(database.prepare('SELECT role_template_id, display_name FROM agent_instances ORDER BY role_template_id').all()).toEqual([
        { role_template_id: 'role-chief-editor', display_name: '貂蝉' },
        { role_template_id: 'role-style-editor', display_name: '清照' }
      ]);
    } finally {
      database.close();
    }
  });

  it('拒绝已执行迁移被修改', () => {
    const directory = createTempDirectory();
    const migrationsDir = resolve(directory, 'migrations');
    mkdirSync(migrationsDir);
    const migrationPath = resolve(migrationsDir, '0001_initial.sql');
    writeFileSync(migrationPath, 'CREATE TABLE stable(id TEXT PRIMARY KEY) STRICT;', 'utf8');
    const database = openDatabase(resolve(directory, 'database.sqlite'));
    try {
      runMigrations(database, migrationsDir);
      writeFileSync(migrationPath, 'CREATE TABLE changed(id TEXT PRIMARY KEY) STRICT;', 'utf8');
      expect(() => runMigrations(database, migrationsDir)).toThrow('校验和发生变化');
    } finally {
      database.close();
    }
  });
});
