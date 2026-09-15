export type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEYS = [
  "token",
  "secret",
  "password",
  "authorization",
  "api_key",
  "apikey",
  "refresh",
  "cookie",
  "body",
  "email_body",
  "exact_body",
];

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 240) return `${value.slice(0, 40)}…[redacted ${value.length} chars]`;
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (SECRET_KEYS.some((s) => lower.includes(s))) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

export interface LogContext {
  run_id?: string;
  lead_id?: string;
  draft_id?: string;
  send_attempt_id?: string;
  hunter?: string;
  [key: string]: unknown;
}

export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...((redact(context) as object) ?? {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string, c?: LogContext) => log("debug", m, c),
  info: (m: string, c?: LogContext) => log("info", m, c),
  warn: (m: string, c?: LogContext) => log("warn", m, c),
  error: (m: string, c?: LogContext) => log("error", m, c),
};
