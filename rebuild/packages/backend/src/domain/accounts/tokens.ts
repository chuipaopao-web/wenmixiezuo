import { createHash, randomBytes } from "node:crypto";

export function issueRandomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashRateLimitScope(value: string): string {
  return hashToken(value.trim().toLowerCase());
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  const matches = header
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  return matches[0]?.slice(name.length + 1) ?? null;
}
