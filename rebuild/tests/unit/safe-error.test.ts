import { describe, expect, it } from "vitest";
import { createLogger, DomainError, redactLogValue, toSafeErrorResponse } from "@wenmi-rebuild/backend";

describe("safe errors and logging", () => {
  it("keeps public errors stable", () => {
    expect(toSafeErrorResponse(new DomainError("FOUNDATION_NOT_IMPLEMENTED", "后续批次实现。"))).toEqual({
      code: "FOUNDATION_NOT_IMPLEMENTED",
      message: "后续批次实现。",
      retryable: false
    });
  });

  it("redacts secrets from structured log details", () => {
    const redacted = redactLogValue({
      databaseUrl: "postgres://wenmi:password@127.0.0.1:54329/wenmi_rebuild_dev",
      nested: { apiKey: "abc" }
    });
    expect(redacted).toEqual({
      databaseUrl: "[REDACTED]",
      nested: { apiKey: "[REDACTED]" }
    });
    expect(createLogger("test")).toBeTruthy();
  });
});
