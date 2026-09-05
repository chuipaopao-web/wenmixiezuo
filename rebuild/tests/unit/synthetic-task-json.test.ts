import { describe, expect, it } from "vitest";
import { DomainError, hashSyntheticTaskPayload, normalizeSyntheticJson } from "@wenmi-rebuild/backend";

describe("synthetic task JSON normalization", () => {
  it("hashes normalized payloads deterministically and includes own __proto__ keys", () => {
    const parsed = JSON.parse('{"b":2,"__proto__":{"x":1},"a":1}') as unknown;
    const normalized = normalizeSyntheticJson(parsed, "payload");
    expect(Object.getPrototypeOf(normalized)).toBeNull();
    expect(JSON.stringify(normalized)).toBe('{"__proto__":{"x":1},"a":1,"b":2}');
    expect(hashSyntheticTaskPayload(normalized)).toBe(
      hashSyntheticTaskPayload(normalizeSyntheticJson(JSON.parse('{"a":1,"__proto__":{"x":1},"b":2}'), "payload"))
    );
  });

  it("rejects non JSON values instead of letting them drift between hash and PostgreSQL JSON", () => {
    expect(() => normalizeSyntheticJson({ now: new Date() }, "payload")).toThrow(DomainError);
    expect(() => normalizeSyntheticJson({ bad: Number.NaN }, "payload")).toThrow(DomainError);
    expect(() => normalizeSyntheticJson({ missing: undefined }, "payload")).toThrow(DomainError);
    const sparse = new Array(2);
    expect(() => normalizeSyntheticJson(sparse, "payload")).toThrow(/稀疏数组/);
  });

  it("rejects cycles and overly deep structures", () => {
    const cycle: Record<string, unknown> = {};
    cycle["self"] = cycle;
    expect(() => normalizeSyntheticJson(cycle, "payload")).toThrow(/循环引用/);

    let deep: unknown = null;
    for (let index = 0; index < 70; index += 1) {
      deep = [deep];
    }
    expect(() => normalizeSyntheticJson(deep, "payload")).toThrow(/过大/);
  });

  it("rejects oversized serialized JSON while preserving normal values", () => {
    expect(normalizeSyntheticJson({ text: "ok" }, "payload")).toEqual({ text: "ok" });
    expect(() => normalizeSyntheticJson({ text: "x".repeat(260 * 1024) }, "payload")).toThrow(/字节数过大/);
  });
});
