import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { DomainError } from "../errors.js";
import type { PasswordRecord } from "./types.js";

const KEY_LENGTH = 64;
const NEW_PARAMS = { n: 32_768, r: 8, p: 3, keyLength: KEY_LENGTH as 64, format: "scrypt-v2" as const };
const LEGACY_PARAMS = { n: 16_384, r: 8, p: 1, keyLength: KEY_LENGTH as 64, format: "scrypt-v1-legacy" as const };
const MIN_PASSWORD_CHARS = 15;
const MAX_PASSWORD_CHARS = 128;
const MAX_ACTIVE_HASHES = 2;
const MAX_WAITING_HASHES = 16;

let activeHashes = 0;
const waitingHashes: Array<() => void> = [];

export function validateNewPassword(password: string): string {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_CHARS || length > MAX_PASSWORD_CHARS) {
    throw new DomainError("ACCOUNT_INPUT_INVALID", "密码需要15至128个字符。");
  }
  return password;
}

export async function hashNewPassword(password: string): Promise<PasswordRecord> {
  validateNewPassword(password);
  return hashVerifiedPassword(password);
}

export async function hashVerifiedPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16).toString("hex");
  return {
    ...NEW_PARAMS,
    salt,
    hash: await deriveScrypt(password, salt, NEW_PARAMS)
  };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  if (!isSupportedPasswordRecord(record)) return false;
  if (Array.from(password).length > MAX_PASSWORD_CHARS) {
    await deriveScrypt("", "00000000000000000000000000000000", NEW_PARAMS);
    return false;
  }
  const actual = await deriveScrypt(password, record.salt, record);
  return constantTimeHexMatches(actual, record.hash);
}

export async function verifyUnknownAccountPassword(password: string): Promise<void> {
  const safePassword = Array.from(password).slice(0, MAX_PASSWORD_CHARS).join("");
  await deriveScrypt(safePassword, "00000000000000000000000000000000", NEW_PARAMS);
}

export function shouldUpgradePassword(record: PasswordRecord): boolean {
  return record.format !== NEW_PARAMS.format ||
    record.n !== NEW_PARAMS.n ||
    record.r !== NEW_PARAMS.r ||
    record.p !== NEW_PARAMS.p ||
    record.keyLength !== NEW_PARAMS.keyLength;
}

export function legacyScryptRecord(salt: string, hash: string): PasswordRecord {
  return { ...LEGACY_PARAMS, salt, hash };
}

export function isSupportedPasswordRecord(record: PasswordRecord): boolean {
  const isNew = record.format === "scrypt-v2" && record.n === NEW_PARAMS.n && record.r === NEW_PARAMS.r && record.p === NEW_PARAMS.p;
  const isLegacy = record.format === "scrypt-v1-legacy" && record.n === LEGACY_PARAMS.n && record.r === LEGACY_PARAMS.r && record.p === LEGACY_PARAMS.p;
  return (isNew || isLegacy) &&
    record.keyLength === KEY_LENGTH &&
    /^[a-f0-9]{32,}$/u.test(record.salt) &&
    /^[a-f0-9]{128}$/u.test(record.hash);
}

async function deriveScrypt(
  password: string,
  salt: string,
  params: Pick<PasswordRecord, "n" | "r" | "p" | "keyLength">
): Promise<string> {
  await acquireHashSlot();
  try {
    return await new Promise((resolve, reject) => {
      scrypt(password, salt, params.keyLength, {
        N: params.n,
        r: params.r,
        p: params.p,
        maxmem: 64 * 1024 * 1024
      }, (error, derived) => {
        if (error !== null) reject(error);
        else resolve(Buffer.from(derived).toString("hex"));
      });
    });
  } finally {
    releaseHashSlot();
  }
}

function acquireHashSlot(): Promise<void> {
  if (activeHashes < MAX_ACTIVE_HASHES) {
    activeHashes += 1;
    return Promise.resolve();
  }
  if (waitingHashes.length >= MAX_WAITING_HASHES) {
    throw new DomainError("ACCOUNT_PASSWORD_HASH_BUSY", "密码校验暂时繁忙，请稍后重试。", true);
  }
  return new Promise((resolve) => {
    waitingHashes.push(() => {
      activeHashes += 1;
      resolve();
    });
  });
}

function releaseHashSlot(): void {
  activeHashes -= 1;
  const next = waitingHashes.shift();
  if (next !== undefined) next();
}

function constantTimeHexMatches(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
