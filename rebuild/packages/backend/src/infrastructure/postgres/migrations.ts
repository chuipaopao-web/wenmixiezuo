import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DomainError } from "../../domain/errors.js";
import type { PostgresRuntimeConfig } from "../config.js";
import { createPostgresPool, withTransaction, type PgClient } from "./client.js";

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly checked: readonly string[];
}

interface MigrationFile {
  readonly filename: string;
  readonly checksum: string;
  readonly sql: string;
}

export async function runMigrations(options: {
  readonly config: PostgresRuntimeConfig;
  readonly migrationDirectory?: string;
}): Promise<MigrationResult> {
  const pool = createPostgresPool(options.config);
  try {
    return await withTransaction(pool, async (client) => {
      await verifyDatabaseTarget(client, options.config);
      await client.query("SELECT pg_advisory_xact_lock($1)", [20260906108]);
      await verifyProvisionedGuard(client, options.config);
      await ensureMigrationTable(client, options.config);

      const migrations = await readMigrations(options.migrationDirectory ?? defaultMigrationDirectory());
      await rejectUnknownAppliedMigrations(client, migrations);
      const applied: string[] = [];
      for (const migration of migrations) {
        const existing = await client.query<{ checksum: string }>(
          "SELECT checksum FROM rebuild_schema_migrations WHERE filename = $1",
          [migration.filename]
        );
        if (existing.rowCount === 1) {
          if (existing.rows[0]?.checksum !== migration.checksum) {
            throw new DomainError("MIGRATION_FAILED", "重构迁移校验和与历史记录不一致。");
          }
          continue;
        }

        await client.query(migration.sql);
        await client.query(
          "INSERT INTO rebuild_schema_migrations (filename, checksum) VALUES ($1, $2)",
          [migration.filename, migration.checksum]
        );
        applied.push(migration.filename);
      }

      return {
        applied,
        checked: migrations.map((migration) => migration.filename)
      };
    });
  } finally {
    await pool.end();
  }
}

export async function verifyRuntimeDatabase(config: PostgresRuntimeConfig): Promise<void> {
  const pool = createPostgresPool(config);
  try {
    await withTransaction(pool, async (client) => {
      await verifyDatabaseTarget(client, config);
      await verifyProvisionedGuard(client, config);
      const migrations = await readMigrations(defaultMigrationDirectory());
      await verifyKnownMigrationsApplied(client, migrations);
    });
  } finally {
    await pool.end();
  }
}

function defaultMigrationDirectory(): string {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDirectory, "../../../../..", "migrations");
}

async function verifyDatabaseTarget(client: PgClient, config: PostgresRuntimeConfig): Promise<void> {
  const result = await client.query<{
    database_name: string;
    current_user: string;
    server_port: number;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>("SELECT current_database() AS database_name, current_user, inet_server_port() AS server_port");
  const row = result.rows[0];
  if (!row) {
    throw new DomainError("DATABASE_GUARD_FAILED", "无法读取重构数据库连接身份。");
  }
  if (row.database_name !== config.expectedDatabase) {
    throw new DomainError("DATABASE_GUARD_FAILED", "实际数据库名称与重构配置不一致。");
  }
  if (row.current_user !== config.expectedCurrentUser) {
    throw new DomainError("DATABASE_GUARD_FAILED", "实际数据库角色与重构配置不一致。");
  }
  if (Number(row.server_port) !== config.expectedPort) {
    throw new DomainError("DATABASE_GUARD_FAILED", "实际数据库端口与重构配置不一致。");
  }

  const role = await client.query<{
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
     FROM pg_roles
     WHERE rolname = current_user`
  );
  const roleRow = role.rows[0];
  if (
    !roleRow ||
    roleRow.rolsuper ||
    roleRow.rolcreatedb ||
    roleRow.rolcreaterole ||
    roleRow.rolreplication ||
    roleRow.rolbypassrls
  ) {
    throw new DomainError("DATABASE_GUARD_FAILED", "重构数据库角色权限过高。");
  }
}

async function ensureMigrationTable(client: PgClient, config: PostgresRuntimeConfig): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS rebuild_schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`GRANT SELECT ON TABLE rebuild_schema_migrations TO ${quoteIdentifier(config.appRole)}`);
}

async function verifyProvisionedGuard(client: PgClient, config: PostgresRuntimeConfig): Promise<void> {
  const guard = await client.query<{
    environment_marker: string;
    database_name: string;
    app_role: string;
    migrator_role: string;
  }>(
    "SELECT environment_marker, database_name, app_role, migrator_role FROM rebuild_environment_guard WHERE id = true"
  );

  const row = guard.rows[0];
  if (guard.rowCount !== 1 ||
    !row ||
    row.environment_marker !== config.marker ||
    row.database_name !== config.expectedDatabase ||
    row.app_role !== config.appRole ||
    row.migrator_role !== config.migratorRole
  ) {
    throw new DomainError("DATABASE_GUARD_FAILED", "重构数据库环境标记缺失或与当前配置不一致。");
  }
}

async function rejectUnknownAppliedMigrations(client: PgClient, migrations: readonly MigrationFile[]): Promise<void> {
  const known = new Set(migrations.map((migration) => migration.filename));
  const applied = await client.query<{ filename: string }>("SELECT filename FROM rebuild_schema_migrations");
  const unknown = applied.rows.map((row) => row.filename).filter((filename) => !known.has(filename));
  if (unknown.length > 0) {
    throw new DomainError("MIGRATION_FAILED", "重构数据库存在当前代码缺失的迁移记录。");
  }
}

async function verifyKnownMigrationsApplied(client: PgClient, migrations: readonly MigrationFile[]): Promise<void> {
  const applied = await client.query<{ filename: string; checksum: string }>(
    "SELECT filename, checksum FROM rebuild_schema_migrations"
  );
  const appliedByName = new Map(applied.rows.map((row) => [row.filename, row.checksum]));
  for (const migration of migrations) {
    const checksum = appliedByName.get(migration.filename);
    if (!checksum || checksum !== migration.checksum) {
      throw new DomainError("DATABASE_GUARD_FAILED", "重构数据库迁移历史未就绪。");
    }
  }
  await rejectUnknownAppliedMigrations(client, migrations);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

async function readMigrations(directory: string): Promise<MigrationFile[]> {
  const filenames = (await readdir(directory))
    .filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/.test(filename))
    .sort();

  const migrations: MigrationFile[] = [];
  for (const filename of filenames) {
    const sql = await readFile(path.join(directory, filename), "utf8");
    migrations.push({
      filename,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex")
    });
  }
  return migrations;
}
