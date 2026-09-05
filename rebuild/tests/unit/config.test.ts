import { describe, expect, it } from "vitest";
import { ENVIRONMENT_MARKER, loadPostgresRuntimeConfig } from "@wenmi-rebuild/backend";

const baseEnv = {
  WENMI_REBUILD_ENV: "rebuild-local",
  WENMI_REBUILD_DATABASE_URL: "postgres://wenmi_rebuild_app:secret@127.0.0.1:54329/wenmi_rebuild_dev",
  WENMI_REBUILD_EXPECTED_DB: "wenmi_rebuild_dev",
  WENMI_REBUILD_EXPECTED_HOST: "127.0.0.1",
  WENMI_REBUILD_EXPECTED_PORT: "54329",
  WENMI_REBUILD_APP_ROLE: "wenmi_rebuild_app",
  WENMI_REBUILD_MIGRATOR_ROLE: "wenmi_rebuild_migrator"
};

describe("rebuild database configuration", () => {
  it("loads only the explicit rebuild loopback target", () => {
    const config = loadPostgresRuntimeConfig(baseEnv, "app");
    expect(config.marker).toBe(ENVIRONMENT_MARKER);
    expect(config.expectedDatabase).toBe("wenmi_rebuild_dev");
    expect(config.expectedCurrentUser).toBe("wenmi_rebuild_app");
  });

  it("rejects non-rebuild database names", () => {
    expect(() =>
      loadPostgresRuntimeConfig({
        ...baseEnv,
        WENMI_REBUILD_DATABASE_URL: "postgres://wenmi_rebuild_app:secret@127.0.0.1:54329/postgres",
        WENMI_REBUILD_EXPECTED_DB: "postgres"
      })
    ).toThrow(/配置/);
  });

  it("rejects non-loopback hosts", () => {
    expect(() =>
      loadPostgresRuntimeConfig({
        ...baseEnv,
        WENMI_REBUILD_DATABASE_URL: "postgres://wenmi_rebuild_app:secret@10.0.0.2:54329/wenmi_rebuild_dev",
        WENMI_REBUILD_EXPECTED_HOST: "10.0.0.2"
      })
    ).toThrow(/配置/);
  });

  it("rejects localhost DNS and connection-string overrides", () => {
    expect(() =>
      loadPostgresRuntimeConfig({
        ...baseEnv,
        WENMI_REBUILD_DATABASE_URL: "postgres://wenmi_rebuild_app:secret@localhost:54329/wenmi_rebuild_dev",
        WENMI_REBUILD_EXPECTED_HOST: "localhost"
      })
    ).toThrow(/配置/);

    expect(() =>
      loadPostgresRuntimeConfig({
        ...baseEnv,
        WENMI_REBUILD_DATABASE_URL:
          "postgres://wenmi_rebuild_app:secret@127.0.0.1:54329/wenmi_rebuild_dev?host=10.0.0.2"
      })
    ).toThrow(/查询参数/);
  });

  it("requires the migrator role for migration commands", () => {
    expect(() => loadPostgresRuntimeConfig(baseEnv, "migrator")).toThrow(/职责/);
  });
});
