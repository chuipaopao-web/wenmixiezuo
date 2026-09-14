/**
 * AUTH-TAKEOVER-01 身份域令牌模块：自 rebuild/packages/backend/src/domain/accounts/tokens.ts 移植
 * （parity测试与rebuild原件对齐）。readCookie在重复cookie时返回null（拒绝歧义登录态），
 * 优于现行逐段find实现，属安全收紧。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'wenmi_session';
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

export function issueRandomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  const matches = header
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  return matches[0]?.slice(name.length + 1) ?? null;
}

/** 常量时序比较（worker token等共享秘密校验）。 */
export function constantTimeTokenMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined || actual.length === 0 || actual.length > 1_024) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
