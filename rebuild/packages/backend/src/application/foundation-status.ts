import type { FoundationStatus, ServiceName } from "@wenmi-rebuild/contracts";
import { ENVIRONMENT_MARKER } from "../infrastructure/config.js";

export function createFoundationStatus(service: ServiceName, configured: boolean): FoundationStatus {
  return {
    service,
    rebuildEnvironment: "rebuild-local",
    foundation: "batch-108",
    database: {
      required: true,
      configured,
      marker: ENVIRONMENT_MARKER
    },
    capabilities: {
      login: "implemented",
      registration: "not-implemented",
      taskExecution: "not-implemented",
      migrations: "implemented"
    }
  };
}
