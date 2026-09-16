import type { AppConfig } from "../config.ts";

/**
 * Identity gate for every Notion write path (schema creation, future record sync).
 * Ancestry (parent page id) is the source of truth; the [STAGING] title marker is a
 * required second signal, never sufficient on its own.
 *
 * Staging and production have deliberately SEPARATE assertion functions
 * (assertStagingWriteAllowed / assertProductionWriteAllowed) rather than one shared
 * "assert write allowed" helper. A single shared helper previously let the staging
 * setup tool build its own synthetic "pretend NOTION_ENVIRONMENT=staging" config
 * instead of checking the real ambient value — which meant `--apply` never actually
 * verified the operator had NOTION_ENVIRONMENT=staging set for real. Two named,
 * independently-testable functions make that mistake structurally harder to repeat:
 * each one hard-requires its own literal NOTION_ENVIRONMENT value up front.
 */

export const STAGING_MARKER = "[STAGING]";

// Descriptive only (already public in NOTION_SCHEMA_AUDIT.md) — used as a defense-in-depth
// secondary check, never as the primary identity check, and never combined with an id.
export const KNOWN_PRODUCTION_PARENT_TITLE_HINT = "03 — Anchor Tenant";

export interface NotionParentIdentity {
  id: string;
  title: string;
}

export class NotionEnvironmentError extends Error {
  constructor(public reasonCode: string) {
    super(`notion_environment_rejected:${reasonCode}`);
    this.name = "NotionEnvironmentError";
  }
}

export function normalizeNotionId(id: string | undefined | null): string {
  return (id ?? "").replace(/-/g, "").trim().toLowerCase();
}

function hasStagingMarker(title: string): boolean {
  return title.toUpperCase().includes(STAGING_MARKER);
}

function looksLikeKnownProductionTitle(title: string): boolean {
  return title.trim().toLowerCase() === KNOWN_PRODUCTION_PARENT_TITLE_HINT.toLowerCase();
}

export interface EnvironmentCheckResult {
  ok: boolean;
  reason?: string;
}

type StagingIdentityConfig = Pick<
  AppConfig,
  "NOTION_EXPECTED_PARENT_PAGE_ID" | "NOTION_PARENT_PAGE_ID"
>;
type ProductionIdentityConfig = Pick<
  AppConfig,
  "NOTION_PARENT_PAGE_ID" | "NOTION_EXPECTED_PARENT_PAGE_ID"
>;

/**
 * Staging identity: the live parent must match the configured staging parent by id
 * (ancestry), carry the [STAGING] marker, and must not be the production parent by
 * id or by its known title. Titles alone are never sufficient — ancestry is checked
 * first and is the reason a mismatch is rejected even when a marker is present.
 */
export function classifyStagingIdentity(
  cfg: StagingIdentityConfig,
  parent: NotionParentIdentity | undefined,
): EnvironmentCheckResult {
  if (!parent) return { ok: false, reason: "parent_identity_unavailable" };
  const liveId = normalizeNotionId(parent.id);
  if (!liveId) return { ok: false, reason: "parent_identity_unavailable" };

  const expected = normalizeNotionId(cfg.NOTION_EXPECTED_PARENT_PAGE_ID);
  if (!expected) return { ok: false, reason: "missing_expected_staging_parent" };
  if (liveId !== expected) return { ok: false, reason: "parent_ancestry_mismatch" };

  const configuredProduction = normalizeNotionId(cfg.NOTION_PARENT_PAGE_ID);
  if (configuredProduction && liveId === configuredProduction) {
    return { ok: false, reason: "production_parent_rejected" };
  }
  if (looksLikeKnownProductionTitle(parent.title)) {
    return { ok: false, reason: "production_parent_rejected" };
  }
  if (!hasStagingMarker(parent.title)) {
    return { ok: false, reason: "missing_staging_marker" };
  }
  return { ok: true };
}

/**
 * Production identity: the live parent must match the configured production parent
 * by id (ancestry) and must not be [STAGING]-marked or match the configured staging
 * parent id.
 */
export function classifyProductionIdentity(
  cfg: ProductionIdentityConfig,
  parent: NotionParentIdentity | undefined,
): EnvironmentCheckResult {
  if (!parent) return { ok: false, reason: "parent_identity_unavailable" };
  const liveId = normalizeNotionId(parent.id);
  if (!liveId) return { ok: false, reason: "parent_identity_unavailable" };

  if (hasStagingMarker(parent.title)) {
    return { ok: false, reason: "staging_resource_rejected" };
  }
  const stagingId = normalizeNotionId(cfg.NOTION_EXPECTED_PARENT_PAGE_ID);
  if (stagingId && liveId === stagingId) {
    return { ok: false, reason: "staging_resource_rejected" };
  }

  const expectedProduction = normalizeNotionId(cfg.NOTION_PARENT_PAGE_ID);
  if (!expectedProduction) return { ok: false, reason: "missing_expected_production_parent" };
  if (liveId !== expectedProduction) return { ok: false, reason: "parent_ancestry_mismatch" };

  return { ok: true };
}

/**
 * Status-only dispatcher for the dashboard/startup summary, where "which environment
 * is this" is read from the ambient config rather than asserted against a specific
 * intended write target. Never use this for an authorization decision — use
 * assertStagingWriteAllowed / assertProductionWriteAllowed instead, which each
 * hard-require their own literal NOTION_ENVIRONMENT value.
 */
export function classifyNotionEnvironment(
  cfg: Pick<
    AppConfig,
    "NOTION_ENVIRONMENT" | "NOTION_EXPECTED_PARENT_PAGE_ID" | "NOTION_PARENT_PAGE_ID"
  >,
  parent: NotionParentIdentity | undefined,
): EnvironmentCheckResult {
  if (cfg.NOTION_ENVIRONMENT === "staging") return classifyStagingIdentity(cfg, parent);
  if (cfg.NOTION_ENVIRONMENT === "production") return classifyProductionIdentity(cfg, parent);
  return { ok: false, reason: "ambiguous_notion_environment" };
}

type WriteGateConfig = Pick<
  AppConfig,
  | "NOTION_ENVIRONMENT"
  | "NOTION_EXPECTED_PARENT_PAGE_ID"
  | "NOTION_PARENT_PAGE_ID"
  | "NOTION_WRITES_ENABLED"
>;

/**
 * Authorizes a STAGING write. Throws a sanitized NotionEnvironmentError (reason code
 * only — never an id, title, or token) unless ALL of the following hold:
 *   - the real (not synthesized) NOTION_ENVIRONMENT is exactly "staging"
 *   - NOTION_WRITES_ENABLED is true
 *   - the freshly-fetched parent identity passes classifyStagingIdentity
 * Call this immediately before every staging write, with a parent identity fetched
 * fresh in that same call — never a cached/assumed value.
 */
export function assertStagingWriteAllowed(
  cfg: WriteGateConfig,
  parent: NotionParentIdentity | undefined,
): void {
  if (cfg.NOTION_ENVIRONMENT !== "staging") {
    throw new NotionEnvironmentError("staging_write_requires_staging_environment");
  }
  if (!cfg.NOTION_WRITES_ENABLED) throw new NotionEnvironmentError("notion_writes_disabled");
  const identity = classifyStagingIdentity(cfg, parent);
  if (!identity.ok) throw new NotionEnvironmentError(identity.reason ?? "unknown");
}

/**
 * Authorizes a PRODUCTION write. Throws a sanitized NotionEnvironmentError unless ALL
 * of the following hold:
 *   - the real NOTION_ENVIRONMENT is exactly "production"
 *   - NOTION_WRITES_ENABLED is true
 *   - the freshly-fetched parent identity passes classifyProductionIdentity
 * Call this immediately before every production write, with a parent identity
 * fetched fresh in that same call.
 */
export function assertProductionWriteAllowed(
  cfg: WriteGateConfig,
  parent: NotionParentIdentity | undefined,
): void {
  if (cfg.NOTION_ENVIRONMENT !== "production") {
    throw new NotionEnvironmentError("production_write_requires_production_environment");
  }
  if (!cfg.NOTION_WRITES_ENABLED) throw new NotionEnvironmentError("notion_writes_disabled");
  const identity = classifyProductionIdentity(cfg, parent);
  if (!identity.ok) throw new NotionEnvironmentError(identity.reason ?? "unknown");
}

/**
 * Startup identity check for whichever environment is currently configured. Safe
 * reads are always allowed regardless of outcome; this only gates whether writes may
 * proceed later in the process lifetime.
 */
export function checkNotionEnvironmentAtStartup(
  cfg: Pick<
    AppConfig,
    | "NOTION_ENVIRONMENT"
    | "NOTION_EXPECTED_PARENT_PAGE_ID"
    | "NOTION_PARENT_PAGE_ID"
    | "NOTION_WRITES_ENABLED"
  >,
  parent: NotionParentIdentity | undefined,
): EnvironmentCheckResult {
  if (!cfg.NOTION_WRITES_ENABLED) return { ok: true, reason: "writes_disabled_reads_only" };
  return classifyNotionEnvironment(cfg, parent);
}

/**
 * Sanitized dashboard summary — environment, connection, and write-gate status only.
 * Never includes a token, page id, or data source id.
 */
export function notionDashboardSummary(
  cfg: Pick<AppConfig, "NOTION_ENVIRONMENT" | "NOTION_WRITES_ENABLED" | "NOTION_TOKEN">,
): { environment: "staging" | "production"; connected: boolean; writesEnabled: boolean } {
  return {
    environment: cfg.NOTION_ENVIRONMENT,
    connected: Boolean(cfg.NOTION_TOKEN),
    writesEnabled: cfg.NOTION_WRITES_ENABLED,
  };
}
