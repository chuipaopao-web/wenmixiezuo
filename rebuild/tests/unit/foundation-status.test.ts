import { describe, expect, it } from "vitest";
import { foundationStatusSchema } from "@wenmi-rebuild/contracts";
import { createFoundationStatus } from "@wenmi-rebuild/backend";

describe("foundation status contract", () => {
  it("states unavailable product capabilities honestly", () => {
    const status = createFoundationStatus("api", true);
    expect(foundationStatusSchema.parse(status).capabilities).toEqual({
      login: "not-implemented",
      registration: "not-implemented",
      taskExecution: "not-implemented",
      migrations: "implemented"
    });
  });
});
