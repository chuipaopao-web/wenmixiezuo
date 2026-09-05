import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DomainError,
  REBUILD_SESSION_COOKIE,
  readCookie
} from "@wenmi-rebuild/backend";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOCAL_BROWSER_ORIGINS = new Set(["http://127.0.0.1:43280", "http://127.0.0.1:43281"]);
const LOCAL_API_HOSTS = new Set([
  "127.0.0.1:43280",
  "127.0.0.1:43281",
  "127.0.0.1:43282",
  "localhost:43280",
  "localhost:43281",
  "localhost:43282"
]);

export function registerLocalProtectedHooks(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    const host = request.headers.host;
    if (host === undefined || !LOCAL_API_HOSTS.has(host)) {
      throw new DomainError("REQUEST_HOST_REJECTED", "请求主机不受信任。");
    }
    if (duplicateCookie(request.headers.cookie, REBUILD_SESSION_COOKIE)) {
      throw new DomainError("REQUEST_COOKIE_REJECTED", "登录状态不明确，请重新登录。");
    }
    if (WRITE_METHODS.has(request.method)) verifyBrowserWrite(request);
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("Cache-Control", "no-store");
    return payload;
  });
}

export function requireSessionToken(request: FastifyRequest): string {
  const token = readCookie(request.headers.cookie, REBUILD_SESSION_COOKIE);
  if (token === null) throw new DomainError("AUTHENTICATION_REQUIRED", "请先登录。");
  return token;
}

export function clientIp(request: FastifyRequest): string {
  return request.socket.remoteAddress ?? "127.0.0.1";
}

function verifyBrowserWrite(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (origin === undefined || !LOCAL_BROWSER_ORIGINS.has(origin)) {
    throw new DomainError("REQUEST_ORIGIN_REJECTED", "请求来源不受信任。");
  }
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new DomainError("REQUEST_CONTENT_TYPE_REJECTED", "写操作只接受JSON。");
  }
}

function duplicateCookie(cookieHeader: string | undefined, name: string): boolean {
  if (cookieHeader === undefined) return false;
  return cookieHeader.split(";").filter((value) => value.trim().startsWith(`${name}=`)).length > 1;
}
