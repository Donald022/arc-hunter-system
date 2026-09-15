import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

function loadDotEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

loadDotEnv();

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  });

const optionalString = z
  .string()
  .optional()
  .transform((v) => {
    const s = v?.trim() ?? "";
    return s.length ? s : undefined;
  });

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().default("http://127.0.0.1:8787"),
  PORT: z.coerce.number().int().positive().default(8787),
  LISTEN_HOST: z.string().default("127.0.0.1"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: optionalString,
  DB_SCHEMA: z.string().default("arc"),
  PG_POOL_MAX: z.coerce.number().int().positive().default(4),

  NOTION_TOKEN: optionalString,
  NOTION_PARENT_PAGE_ID: optionalString,
  NOTION_COMPANIES_DATA_SOURCE_ID: optionalString,
  NOTION_CONTACTS_DATA_SOURCE_ID: optionalString,
  NOTION_ACTIVITY_DATA_SOURCE_ID: optionalString,
  NOTION_CAMPAIGNS_DATA_SOURCE_ID: optionalString,
  NOTION_FACTS_PAGE_ID: optionalString,
  NOTION_API_VERSION: z.string().default("2025-09-03"),

  SLACK_BOT_TOKEN: optionalString,
  SLACK_SIGNING_SECRET: optionalString,
  SLACK_CHANNEL_ID: optionalString,
  SLACK_APPROVER_IDS: csv,
  SLACK_REPLAY_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REFRESH_TOKEN: optionalString,
  GMAIL_SENDER: optionalString,

  LLM_PROVIDER: z.enum(["gemini", "fixture"]).default("fixture"),
  LLM_MODEL: z.string().default("gemini-3.5-flash-lite"),
  LLM_API_KEY: optionalString,
  LLM_BILLING_TIER: z.enum(["paid", "unpaid", ""]).optional().transform((v) => v || undefined),
  LLM_LIVE_ENABLED: bool.default(false),
  DAILY_LLM_USD_CAP: z.coerce.number().nonnegative().default(0.2),
  DAILY_LLM_REQUEST_CAP: z.coerce.number().int().nonnegative().default(50),
  LLM_MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  LLM_RESERVED_INPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  LLM_RESERVED_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1500),

  APOLLO_API_KEY: optionalString,
  APOLLO_ENABLED: bool.default(false),
  DAILY_ENRICHMENT_CAP: z.coerce.number().int().nonnegative().default(10),

  INTERNAL_JOB_TOKEN: z.string().min(8).default("change-me-internal-job-token"),
  DRY_RUN: bool.default(true),
  LIVE_SEND_ENABLED: bool.default(false),
  DAILY_SEND_CAP: z.coerce.number().int().nonnegative().default(5),

  DASHBOARD_SESSION_SECRET: z.string().min(16).default("change-me-dashboard-session-secret"),
  DASHBOARD_OPERATOR_EMAILS: csv,
  DASHBOARD_FIXTURE_LOGIN: bool.default(true),
  OIDC_ISSUER: optionalString,
  OIDC_CLIENT_ID: optionalString,
  OIDC_CLIENT_SECRET: optionalString,
  OIDC_REDIRECT_URI: optionalString,

  SOURCE_USER_AGENT: z.string().default("ARC-Hunter-System/0.1 (+research; contact operator)"),
  SOURCE_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SOURCE_MAX_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

export type AppConfig = z.infer<typeof configSchema>;

let cached: AppConfig | undefined;

export function loadConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  const merged: Record<string, unknown> = { ...process.env, ...overrides };
  const parsed = configSchema.parse(merged);
  if (parsed.NODE_ENV === "production" && parsed.DASHBOARD_FIXTURE_LOGIN) {
    throw new Error("DASHBOARD_FIXTURE_LOGIN cannot be enabled when NODE_ENV=production");
  }
  if (parsed.LIVE_SEND_ENABLED && parsed.DRY_RUN) {
    throw new Error("LIVE_SEND_ENABLED=true is incompatible with DRY_RUN=true");
  }
  return parsed;
}

export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}

export function isProduction(cfg: AppConfig = getConfig()): boolean {
  return cfg.NODE_ENV === "production";
}
