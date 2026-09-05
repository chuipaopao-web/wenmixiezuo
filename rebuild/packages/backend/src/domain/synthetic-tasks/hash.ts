import { createHash } from "node:crypto";
import { DomainError } from "../errors.js";
import type { SyntheticJsonValue } from "./types.js";

const maxSyntheticJsonBytes = 256 * 1024;

export function hashSyntheticTaskPayload(payload: SyntheticJsonValue): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function normalizeSyntheticJson(value: unknown, label: string): SyntheticJsonValue {
  const normalized = normalizeJsonValue(value, label, { seen: new Set(), nodes: 0, depth: 0 });
  if (Buffer.byteLength(stableStringify(normalized), "utf8") > maxSyntheticJsonBytes) {
    throw new DomainError("TASK_REQUEST_INVALID", `${label} JSON 字节数过大。`);
  }
  return normalized;
}

function normalizeJsonValue(
  value: unknown,
  label: string,
  state: { readonly seen: Set<object>; nodes: number; depth: number }
): SyntheticJsonValue {
  state.nodes += 1;
  if (state.nodes > 10_000 || state.depth > 64) {
    throw new DomainError("TASK_REQUEST_INVALID", `${label} JSON 结构过大。`);
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new DomainError("TASK_REQUEST_INVALID", `${label} 只能包含有限数字。`);
    }
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" || value === null) {
      return value;
    }
    throw new DomainError("TASK_REQUEST_INVALID", `${label} 必须是 JSON 值。`);
  }
  if (Array.isArray(value)) {
    if (state.seen.has(value)) {
      throw new DomainError("TASK_REQUEST_INVALID", `${label} 不能包含循环引用。`);
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new DomainError("TASK_REQUEST_INVALID", `${label} 不能包含稀疏数组。`);
      }
    }
    state.seen.add(value);
    state.depth += 1;
    const output = value.map((item) => normalizeJsonValue(item, label, state));
    state.depth -= 1;
    state.seen.delete(value);
    return output;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DomainError("TASK_REQUEST_INVALID", `${label} 只能包含普通 JSON 对象。`);
  }
  if (state.seen.has(value)) {
    throw new DomainError("TASK_REQUEST_INVALID", `${label} 不能包含循环引用。`);
  }
  state.seen.add(value);
  state.depth += 1;
  const output = Object.create(null) as Record<string, SyntheticJsonValue>;
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entryValue = (value as Record<string, unknown>)[key];
    if (entryValue === undefined) {
      throw new DomainError("TASK_REQUEST_INVALID", `${label} 不能包含 undefined。`);
    }
    Object.defineProperty(output, key, {
      value: normalizeJsonValue(entryValue, label, state),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  state.depth -= 1;
  state.seen.delete(value);
  return output;
}

function stableStringify(value: SyntheticJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}
