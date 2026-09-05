import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPostgresPool,
  loadPostgresRuntimeConfig,
  runMigrations,
  withTransaction,
  type PgPool
} from "@wenmi-rebuild/backend";

let pool: PgPool | undefined;

describe("real PostgreSQL rebuild foundation", () => {
  beforeAll(async () => {
    const config = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!config.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
      throw new Error("test:pg must run against a random wenmi_rebuild_test_<suffix> database");
    }
    await runMigrations({ config });
    pool = createPostgresPool(config);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("applies migrations repeatedly without changing recorded history", async () => {
    const config = loadPostgresRuntimeConfig(process.env, "migrator");
    const secondRun = await runMigrations({ config });
    expect(secondRun.checked).toContain("0001_foundation.sql");
    expect(secondRun.applied).toEqual([]);

    const result = await pool?.query("SELECT filename FROM rebuild_schema_migrations ORDER BY filename");
    expect(result?.rows.map((row: { filename: string }) => row.filename)).toContain("0001_foundation.sql");
  });

  it("rolls back failed work on the same client transaction", async () => {
    if (!pool) {
      throw new Error("pool not initialized");
    }
    const id = randomUUID();
    await expect(
      withTransaction(pool, async (client) => {
        await client.query("INSERT INTO foundation_probe (id, note) VALUES ($1, $2)", [id, "rollback-check"]);
        throw new Error("force rollback");
      })
    ).rejects.toThrow(/force rollback/);

    const result = await pool.query("SELECT id FROM foundation_probe WHERE id = $1", [id]);
    expect(result.rowCount).toBe(0);
  });
});
