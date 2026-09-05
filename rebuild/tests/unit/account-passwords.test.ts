import { scrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashNewPassword,
  legacyScryptRecord,
  shouldUpgradePassword,
  validateNewPassword,
  verifyPassword
} from "@wenmi-rebuild/backend";

describe("account password hashing", () => {
  it("uses the rebuild scrypt parameters for new passwords", async () => {
    const password = "correct horse battery staple";
    const record = await hashNewPassword(password);

    expect(record).toMatchObject({
      format: "scrypt-v2",
      n: 32_768,
      r: 8,
      p: 3,
      keyLength: 64
    });
    await expect(verifyPassword(password, record)).resolves.toBe(true);
    await expect(verifyPassword(`${password}!`, record)).resolves.toBe(false);
  });

  it("verifies old scrypt rows but marks them for upgrade", async () => {
    const password = "legacy-password-ok";
    const salt = "00112233445566778899aabbccddeeff";
    const hash = await legacyHash(password, salt);
    const record = legacyScryptRecord(salt, hash);

    await expect(verifyPassword(password, record)).resolves.toBe(true);
    expect(shouldUpgradePassword(record)).toBe(true);
  });

  it("does not trim or weaken the new password length rule", () => {
    expect(() => validateNewPassword("  padded ok length  ")).not.toThrow();
    expect(() => validateNewPassword("short-password")).toThrow(/15/);
  });
});

function legacyHash(password: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error !== null) reject(error);
      else resolve(Buffer.from(derived).toString("hex"));
    });
  });
}
