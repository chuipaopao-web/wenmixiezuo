import { createPostgresPool, createSyntheticTaskService, loadPostgresRuntimeConfig, PostgresSyntheticTaskRepository, runMigrations, type PgPool } from "@wenmi-rebuild/backend";

export interface SyntheticTaskTestContext {
  readonly appPool: PgPool;
  readonly migratorPool: PgPool;
  readonly service: ReturnType<typeof createSyntheticTaskService>;
  readonly appEnv: NodeJS.ProcessEnv;
}

export async function createSyntheticTaskTestContext(): Promise<SyntheticTaskTestContext> {
  const migratorConfig = loadPostgresRuntimeConfig(process.env, "migrator");
  if (!migratorConfig.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
    throw new Error("synthetic task tests require a random wenmi_rebuild_test_<suffix> database");
  }
  await runMigrations({ config: migratorConfig });

  const appUrl = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
  if (!appUrl) {
    throw new Error("WENMI_REBUILD_TEST_APP_DATABASE_URL is required for app-role task tests");
  }
  const appEnv = {
    ...process.env,
    WENMI_REBUILD_DATABASE_URL: appUrl
  };
  const appConfig = loadPostgresRuntimeConfig(appEnv, "app");
  const appPool = createPostgresPool(appConfig);
  const migratorPool = createPostgresPool(migratorConfig);
  const service = createSyntheticTaskService(new PostgresSyntheticTaskRepository(appPool));
  return { appPool, migratorPool, service, appEnv };
}

export async function truncateSyntheticTasks(pool: PgPool): Promise<void> {
  await pool.query("TRUNCATE synthetic_task_events, synthetic_external_calls, synthetic_tasks");
}

export function testScope(suffix: string) {
  return {
    ownerId: `owner-${suffix}`,
    bookId: `book-${suffix}`
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
