import { z } from "zod";
import { DomainError } from "../domain/errors.js";

export const ENVIRONMENT_MARKER = "wenmi-rebuild-local-v1";

const loopbackHosts = new Set(["127.0.0.1", "::1", "[::1]"]);
const allowedDatabaseName = /^wenmi_rebuild_(dev|test[A-Za-z0-9_]*)$/;

const runtimeEnvSchema = z.object({
  WENMI_REBUILD_ENV: z.literal("rebuild-local"),
  WENMI_REBUILD_DATABASE_URL: z.string().min(1),
  WENMI_REBUILD_EXPECTED_DB: z.string().regex(allowedDatabaseName),
  WENMI_REBUILD_EXPECTED_HOST: z.string().refine((host) => loopbackHosts.has(host), {
    message: "expected host must be a loopback address"
  }),
  WENMI_REBUILD_EXPECTED_PORT: z.coerce.number().int().positive().refine((port) => port === 54329, {
    message: "rebuild PostgreSQL must use port 54329"
  }),
  WENMI_REBUILD_APP_ROLE: z.string().min(1),
  WENMI_REBUILD_MIGRATOR_ROLE: z.string().min(1)
});

export type RuntimeRole = "app" | "migrator";

export interface PostgresRuntimeConfig {
  readonly environment: "rebuild-local";
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly expectedDatabase: string;
  readonly expectedHost: string;
  readonly expectedPort: number;
  readonly expectedCurrentUser: string;
  readonly appRole: string;
  readonly migratorRole: string;
  readonly marker: typeof ENVIRONMENT_MARKER;
}

export function loadPostgresRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  role: RuntimeRole = "app"
): PostgresRuntimeConfig {
  const parsed = runtimeEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new DomainError("CONFIGURATION_INVALID", "重构环境数据库配置不完整或不安全。");
  }

  let url: URL;
  try {
    url = new URL(parsed.data.WENMI_REBUILD_DATABASE_URL);
  } catch {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库连接地址格式不正确。");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库必须使用 PostgreSQL 连接。");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库连接地址不能携带查询参数或片段。");
  }

  let urlDatabase: string;
  let username: string;
  let password: string;
  try {
    urlDatabase = decodeURIComponent(url.pathname.replace(/^\//, ""));
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库连接地址包含无效转义。");
  }
  const urlPort = Number(url.port);
  const expectedRole = role === "migrator" ? parsed.data.WENMI_REBUILD_MIGRATOR_ROLE : parsed.data.WENMI_REBUILD_APP_ROLE;

  if (parsed.data.WENMI_REBUILD_APP_ROLE === parsed.data.WENMI_REBUILD_MIGRATOR_ROLE) {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库应用角色和迁移角色必须分离。");
  }
  if (urlDatabase !== parsed.data.WENMI_REBUILD_EXPECTED_DB || !allowedDatabaseName.test(urlDatabase)) {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库名称与显式期望不一致。");
  }
  if (url.hostname !== parsed.data.WENMI_REBUILD_EXPECTED_HOST || !loopbackHosts.has(url.hostname)) {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库只能连接本机回环地址。");
  }
  if (urlPort !== parsed.data.WENMI_REBUILD_EXPECTED_PORT || urlPort !== 54329) {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库端口必须显式限定为 54329。");
  }
  if (username !== expectedRole || password.length === 0) {
    throw new DomainError("CONFIGURATION_INVALID", "重构数据库连接角色与当前进程职责不一致。");
  }

  return {
    environment: parsed.data.WENMI_REBUILD_ENV,
    host: url.hostname,
    port: urlPort,
    database: urlDatabase,
    user: username,
    password,
    expectedDatabase: parsed.data.WENMI_REBUILD_EXPECTED_DB,
    expectedHost: parsed.data.WENMI_REBUILD_EXPECTED_HOST,
    expectedPort: parsed.data.WENMI_REBUILD_EXPECTED_PORT,
    expectedCurrentUser: expectedRole,
    appRole: parsed.data.WENMI_REBUILD_APP_ROLE,
    migratorRole: parsed.data.WENMI_REBUILD_MIGRATOR_ROLE,
    marker: ENVIRONMENT_MARKER
  };
}
