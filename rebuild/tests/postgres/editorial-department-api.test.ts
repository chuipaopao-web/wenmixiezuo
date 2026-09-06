import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAccountCoreService,
  createPostgresPool,
  loadPostgresRuntimeConfig,
  runMigrations,
  type AccountCoreService,
  type PgPool
} from "@wenmi-rebuild/backend";
import { createApiServer } from "../../apps/api/src/create-server.js";

let appPool: PgPool;
let migratorPool: PgPool;
let service: AccountCoreService;
let originalEnv: NodeJS.ProcessEnv;

describe("editorial department HTTP routes", () => {
  beforeAll(async () => {
    originalEnv = { ...process.env };
    const migratorConfig = loadPostgresRuntimeConfig(process.env, "migrator");
    if (!migratorConfig.expectedDatabase.startsWith("wenmi_rebuild_test_")) {
      throw new Error("editorial department API tests require a random wenmi_rebuild_test_<suffix> database");
    }
    await runMigrations({ config: migratorConfig });
    migratorPool = createPostgresPool(migratorConfig);
    const appUrl = process.env.WENMI_REBUILD_TEST_APP_DATABASE_URL;
    if (!appUrl) throw new Error("WENMI_REBUILD_TEST_APP_DATABASE_URL is required");
    process.env.WENMI_REBUILD_DATABASE_URL = appUrl;
    const appConfig = loadPostgresRuntimeConfig(process.env, "app");
    appPool = createPostgresPool(appConfig);
    service = createAccountCoreService(appPool, { secureCookies: false });
  });

  beforeEach(async () => {
    await migratorPool.query(
      "TRUNCATE book_profile_versions, manual_book_chapter_directories, manual_book_opening_sources, bookshelf_book_audit_events, bookshelf_books, account_security_audit_events, account_rate_limits, account_one_time_tokens, account_sessions, account_users RESTART IDENTITY CASCADE"
    );
  });

  afterAll(async () => {
    process.env = originalEnv;
    await appPool?.end();
    await migratorPool?.end();
  });

  it("requires an authenticated session and returns the public roster without model secrets", async () => {
    const created = await service.createInternalUser({
      email: "team@example.com",
      displayName: "团队作者",
      password: "team password value"
    });
    await service.verifyEmailToken((await service.issueEmailVerificationToken(created.account.userId)).token);
    const server = await createApiServer({ accountPool: appPool });
    try {
      const anonymous = await server.inject({
        method: "GET",
        url: "/v1/v7/editorial-department",
        headers: { host: "127.0.0.1:43280" }
      });
      expect(anonymous.statusCode).toBe(401);
      expect(anonymous.headers["cache-control"]).toBe("no-store");

      const login = await server.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: jsonWriteHeaders(),
        payload: { email: "team@example.com", password: "team password value" }
      });
      const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];
      const response = await server.inject({
        method: "GET",
        url: "/v1/v7/editorial-department",
        headers: {
          host: "127.0.0.1:43280",
          cookie
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = JSON.parse(response.body) as { data: { summary: { memberCount: number; readyCount: number; leaveCount: number }; departments: Array<{ departmentKey: string; members: Array<{ presence: string; currentWork: string | null }> }> } };
      expect(body.data.summary).toMatchObject({ memberCount: 23, readyCount: 0, leaveCount: 23 });
      expect(body.data.departments.map((department) => department.departmentKey)).toEqual([
        "chief_editor",
        "deputy_editor",
        "planning_writer",
        "lead_writer",
        "independent_reviewer",
        "continuity_editor",
        "visual_renderer"
      ]);
      expect(body.data.departments.flatMap((department) => department.members).every((member) => member.presence === "leave" && member.currentWork === null)).toBe(true);
      expect(response.body).not.toMatch(/provider|modelId|volcengine|ark|coding\s*plan|agent\s*plan|promptInstruction|temperature|api[_-]?key/iu);
    } finally {
      await server.close();
    }
  });
});

function jsonWriteHeaders(): Record<string, string> {
  return {
    host: "127.0.0.1:43280",
    origin: "http://127.0.0.1:43280",
    "content-type": "application/json"
  };
}
