import type { SafeErrorResponse } from "@wenmi-rebuild/contracts";
import { isDomainError } from "../domain/errors.js";

export function toSafeErrorResponse(error: unknown): SafeErrorResponse {
  if (isDomainError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "服务暂时无法完成请求，已保留可诊断记录。",
    retryable: true
  };
}
