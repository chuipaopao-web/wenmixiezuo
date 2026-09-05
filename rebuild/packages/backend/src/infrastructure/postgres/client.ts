import pg from "pg";
import type { PostgresRuntimeConfig } from "../config.js";

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

export function createPostgresPool(config: PostgresRuntimeConfig): PgPool {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 6,
    ssl: false,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 5_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    application_name: "wenmi-rebuild-foundation"
  });
  pool.on("error", () => undefined);
  return pool;
}

export async function withTransaction<T>(
  pool: PgPool,
  work: (client: PgClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      client.release(rollbackError instanceof Error ? rollbackError : new Error("rollback failed"));
      released = true;
      throw error;
    }
    throw error;
  } finally {
    if (!released) {
      client.release();
    }
  }
}
