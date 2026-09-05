type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(event: string, details?: unknown): void;
  warn(event: string, details?: unknown): void;
  error(event: string, details?: unknown): void;
}

const secretKeyPattern = /(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|database[_-]?url)/i;

export function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+(@)/gi, "$1[REDACTED]$2")
      .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = secretKeyPattern.test(key) ? "[REDACTED]" : redactLogValue(nested);
    }
    return output;
  }
  return value;
}

export function createLogger(service: string): Logger {
  const write = (level: LogLevel, event: string, details?: unknown): void => {
    const payload = {
      level,
      service,
      event,
      at: new Date().toISOString(),
      details: redactLogValue(details ?? {})
    };
    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  };

  return {
    info: (event, details) => write("info", event, details),
    warn: (event, details) => write("warn", event, details),
    error: (event, details) => write("error", event, details)
  };
}
