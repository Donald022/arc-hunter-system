import type { ApprovedFact, ApprovedFactsBundle } from "./types.ts";
import { loadFactsFromObject } from "./facts.ts";

/**
 * Parses the "ARC Approved Outreach Facts" Notion database into an ApprovedFactsBundle.
 *
 * Notion content is untrusted data, never executable instructions: every value read
 * here is treated as plain text/booleans/dates to compare and copy, never interpreted
 * or evaluated.
 *
 * ## Observed schema facts (verified read-only, current production database)
 * A read-only property-list query against the configured database confirmed exactly
 * 11 properties — `Name`, `legal_sender_entity`, `approved_sender_name_title`,
 * `reply_to`, `postal_address`, `opt_out_instructions`, `site_location_disclosure`,
 * `approved_wording`, `can_use_in_first_touch`, `approved_by`, `approved_at` — and
 * **zero rows**. That is everything that can currently be observed.
 *
 * ## Explicit application contract (declared here, not inferred from data)
 * With zero rows, the database's *semantics* — whether a row represents one claim or
 * a whole bundle — cannot be conclusively determined from live records. In particular,
 * the absence of an array-typed property does NOT prove "one row = one claim": a
 * rich-text property could in principle hold a serialized bundle document. This module
 * therefore does not attempt to infer the record model from row content at all.
 * Instead, `NOTION_FACTS_RECORD_MODEL` (see `src/config.ts`) is an explicit, declared
 * contract:
 *   - The only supported value today is `"claim_per_row"` — each row is one individual
 *     approved claim (one wording + one approval per row).
 *   - Missing, unset, or any value other than `"claim_per_row"` fails closed
 *     (`buildFactsFromNotionRows` returns `{ ok: false, reason: ... }`); nothing is
 *     inferred as a fallback.
 *   - The configured database's properties are additionally validated against what
 *     claim_per_row requires (see `validateClaimPerRowSchema`) — a database that is
 *     *declared* claim_per_row but is missing the properties that contract needs also
 *     fails closed, rather than silently proceeding with partial data.
 *
 * ## Assumptions that remain unverified because the database is empty
 * The following are consequences of an empty database, not conclusions from it:
 *   - Whether real approved rows will actually conform to claim_per_row in practice
 *     (e.g. one wording per row, not a bundle pasted into `approved_wording`) is
 *     unverified until Donald adds at least one real row.
 *   - There is no stable claim-id, `status`, or `valid_until` property today. `Name`
 *     (the title) is used as the stable claim key until a dedicated claim-id property
 *     exists — duplicate `Name` values are treated as different versions of the same
 *     claim (grouped together, newest `approved_at` wins), not as an error.
 *   - No production first-touch draft can be generated from the Notion source today:
 *     zero rows means zero claims can ever be selected, so every consumer fails closed
 *     to `FACT_REVIEW` (see `src/jobs/factsLoader.ts#loadFactsSafe`). This is expected,
 *     correct, fail-closed behavior — not a bug to work around, and not something this
 *     module should paper over by inventing or accepting placeholder facts.
 */

export const SUPPORTED_RECORD_MODELS = ["claim_per_row"] as const;
export type NotionFactsRecordModel = (typeof SUPPORTED_RECORD_MODELS)[number];

/** Properties claim_per_row requires to exist on the database schema. */
export const CLAIM_PER_ROW_REQUIRED_PROPERTIES = [
  "approved_wording",
  "can_use_in_first_touch",
  "approved_by",
  "approved_at",
] as const;

export interface NotionFactsFailure {
  ok: false;
  reason: string;
}

export interface NotionFactsSuccess {
  ok: true;
  bundle: ApprovedFactsBundle;
  model: NotionFactsRecordModel;
  excluded: Array<{ id: string; reason: string }>;
}

export type NotionFactsResult = NotionFactsSuccess | NotionFactsFailure;

/**
 * Validates the declared NOTION_FACTS_RECORD_MODEL value. This is a config contract
 * check, never a data-inference step — an empty database is neither evidence for nor
 * against any particular value here.
 */
export function validateRecordModelConfig(
  value: string | undefined,
): { ok: true; model: NotionFactsRecordModel } | { ok: false; reason: string } {
  if (!value || !value.trim()) {
    return { ok: false, reason: "notion_facts_record_model_not_configured" };
  }
  const trimmed = value.trim();
  if (!(SUPPORTED_RECORD_MODELS as readonly string[]).includes(trimmed)) {
    return { ok: false, reason: "notion_facts_record_model_unsupported" };
  }
  return { ok: true, model: trimmed as NotionFactsRecordModel };
}

/**
 * Validates that the database's actual property names support the claim_per_row
 * contract. Case-insensitive match on property name. Independent of row count — this
 * checks schema, not data, so it works even when the database has zero rows.
 */
export function validateClaimPerRowSchema(propertyNames: string[]): {
  ok: boolean;
  missing: string[];
} {
  const have = new Set(propertyNames.map((n) => n.toLowerCase()));
  const missing = CLAIM_PER_ROW_REQUIRED_PROPERTIES.filter((req) => !have.has(req.toLowerCase()));
  return { ok: missing.length === 0, missing };
}

/**
 * Minimal shape of a Notion API property value we need to read. Untrusted input —
 * deliberately typed as a loose record rather than a discriminated union so a
 * malformed/unexpected shape degrades to an empty value instead of a crash.
 */
export type NotionPropertyValue = Record<string, unknown>;

export interface RawNotionFactRow {
  id: string;
  properties: Record<string, NotionPropertyValue>;
}

function richTextOf(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((t) =>
      t && typeof t === "object" ? String((t as { plain_text?: unknown }).plain_text ?? "") : "",
    )
    .join("")
    .trim();
}

function textOf(prop: NotionPropertyValue | undefined): string {
  if (!prop) return "";
  const type = String(prop.type ?? "");
  if (type === "title") return richTextOf(prop.title);
  if (type === "rich_text") return richTextOf(prop.rich_text);
  if (type === "email") return String(prop.email ?? "").trim();
  if (type === "url") return String(prop.url ?? "").trim();
  if (type === "select") {
    const select = prop.select as { name?: unknown } | null | undefined;
    return String(select?.name ?? "").trim();
  }
  return "";
}

function boolOf(prop: NotionPropertyValue | undefined): boolean {
  if (!prop || prop.type !== "checkbox") return false;
  return prop.checkbox === true;
}

function dateOf(prop: NotionPropertyValue | undefined): string {
  if (!prop || prop.type !== "date") return "";
  const date = prop.date as { start?: unknown } | null | undefined;
  return String(date?.start ?? "");
}

function findProp(
  properties: Record<string, NotionPropertyValue>,
  ...candidateNames: string[]
): NotionPropertyValue | undefined {
  const lower = new Map(Object.entries(properties).map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of candidateNames) {
    const hit = lower.get(name.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

interface ExtractedRow {
  rowId: string;
  title: string;
  approvedWording: string;
  canUseInFirstTouch: boolean;
  approvedBy: string;
  approvedAt: string;
  legalSenderEntity: string;
  approvedSenderNameTitle: string;
  replyTo: string;
  postalAddress: string;
  optOutInstructions: string;
  siteLocationDisclosure: string;
  // Forward-compatible only — absent on the current live schema. Name remains the
  // contract's stable claim key today; these are used opportunistically if a future
  // schema migration adds them (see module doc comment).
  claimKey: string;
  status: string;
  validUntil: string;
  category: string;
  disclosureLevel: string;
  evidenceRefs: string[];
}

function extractRow(row: RawNotionFactRow): ExtractedRow {
  const p = row.properties;
  const evidenceRaw = textOf(findProp(p, "evidence urls", "evidence_url_or_document", "evidence"));
  return {
    rowId: row.id,
    title: textOf(findProp(p, "name", "title")),
    approvedWording: textOf(findProp(p, "approved_wording")),
    canUseInFirstTouch: boolOf(findProp(p, "can_use_in_first_touch")),
    approvedBy: textOf(findProp(p, "approved_by")),
    approvedAt: dateOf(findProp(p, "approved_at")) || textOf(findProp(p, "approved_at")),
    legalSenderEntity: textOf(findProp(p, "legal_sender_entity")),
    approvedSenderNameTitle: textOf(findProp(p, "approved_sender_name_title")),
    replyTo: textOf(findProp(p, "reply_to")),
    postalAddress: textOf(findProp(p, "postal_address")),
    optOutInstructions: textOf(findProp(p, "opt_out_instructions")),
    siteLocationDisclosure: textOf(findProp(p, "site_location_disclosure")),
    claimKey: textOf(findProp(p, "claim_id", "claim_key", "key")),
    status: textOf(findProp(p, "status")),
    validUntil: dateOf(findProp(p, "valid_until")) || textOf(findProp(p, "valid_until")),
    category: textOf(findProp(p, "category")),
    disclosureLevel: textOf(findProp(p, "disclosure_level")),
    evidenceRefs: evidenceRaw ? [evidenceRaw] : [],
  };
}

const EXCLUDED_STATUSES = new Set(["draft", "rejected", "revoked", "restricted", "superseded"]);

/** Name today; a dedicated claim-id property, if one is added later. */
function stableClaimKey(row: ExtractedRow): string {
  if (row.claimKey.trim()) return row.claimKey.trim();
  if (row.title.trim()) return row.title.trim().toLowerCase();
  return row.rowId;
}

function hasValidApprovalMetadata(row: ExtractedRow): boolean {
  if (!row.approvedBy.trim()) return false;
  if (!row.approvedAt.trim()) return false;
  const t = Date.parse(row.approvedAt);
  return !Number.isNaN(t);
}

function isExcludedByStatus(row: ExtractedRow): boolean {
  if (!row.status.trim()) return false;
  return EXCLUDED_STATUSES.has(row.status.trim().toLowerCase());
}

function isExpired(row: ExtractedRow, now: Date): boolean {
  if (!row.validUntil.trim()) return false;
  const t = Date.parse(row.validUntil);
  if (Number.isNaN(t)) return false;
  return t <= now.getTime();
}

/**
 * The claim_per_row selection algorithm: require can_use_in_first_touch, require
 * valid approval metadata, exclude draft/rejected/revoked/restricted/superseded,
 * exclude expired, group by stable claim key (Name, duplicates = versions of the same
 * claim), keep the newest valid version per group, preserve all unrelated claims.
 */
export function selectClaimsPerRow(
  rows: ExtractedRow[],
  now: Date,
): {
  claims: ApprovedFact[];
  selectedRows: ExtractedRow[];
  excluded: Array<{ id: string; reason: string }>;
} {
  const excluded: Array<{ id: string; reason: string }> = [];
  const groups = new Map<string, ExtractedRow[]>();

  for (const row of rows) {
    const key = stableClaimKey(row);
    if (!row.canUseInFirstTouch) {
      excluded.push({ id: key, reason: "not_marked_first_touch" });
      continue;
    }
    if (isExcludedByStatus(row)) {
      excluded.push({ id: key, reason: `status:${row.status.trim().toLowerCase()}` });
      continue;
    }
    if (!hasValidApprovalMetadata(row)) {
      excluded.push({ id: key, reason: "missing_approval_metadata" });
      continue;
    }
    if (isExpired(row, now)) {
      excluded.push({ id: key, reason: "expired" });
      continue;
    }
    if (!row.approvedWording.trim()) {
      excluded.push({ id: key, reason: "empty_wording" });
      continue;
    }
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const claims: ApprovedFact[] = [];
  const selectedRows: ExtractedRow[] = [];
  for (const [key, bucket] of groups) {
    const newest = [...bucket].sort((a, b) => {
      const ta = Date.parse(a.approvedAt);
      const tb = Date.parse(b.approvedAt);
      if (tb !== ta) return tb - ta;
      return a.rowId.localeCompare(b.rowId);
    })[0]!;
    selectedRows.push(newest);
    claims.push({
      id: key,
      claim: newest.title || key,
      basis: newest.category || "",
      evidence_url_or_document: newest.evidenceRefs[0] ?? "",
      approved_wording: newest.approvedWording,
      approved_by: newest.approvedBy,
      approved_at: newest.approvedAt,
      valid_until: newest.validUntil,
      can_use_in_first_touch: newest.canUseInFirstTouch,
    });
  }
  return { claims, selectedRows, excluded };
}

const COMPLIANCE_FIELDS = [
  "legalSenderEntity",
  "approvedSenderNameTitle",
  "replyTo",
  "postalAddress",
  "optOutInstructions",
  "siteLocationDisclosure",
] as const;

/**
 * The sender/legal fields are denormalized across every row in the current schema.
 * If two rows disagree on a value that should be workspace-wide, that is a data
 * integrity problem, not something safe to silently resolve — fail closed instead
 * of guessing which row is authoritative.
 */
function resolveComplianceFields(
  rows: ExtractedRow[],
):
  | { ok: true; values: Record<(typeof COMPLIANCE_FIELDS)[number], string> }
  | { ok: false; reason: string } {
  const values = {} as Record<(typeof COMPLIANCE_FIELDS)[number], string>;
  for (const field of COMPLIANCE_FIELDS) {
    const distinct = new Set(rows.map((r) => r[field]).filter((v) => v.trim().length > 0));
    if (distinct.size > 1) return { ok: false, reason: "inconsistent_compliance_fields" };
    values[field] = distinct.size === 1 ? [...distinct][0]! : "";
  }
  return { ok: true, values };
}

export interface BuildFactsOptions {
  /** The declared NOTION_FACTS_RECORD_MODEL value — never inferred from row data. */
  recordModel: string | undefined;
  /**
   * The database's property names, fetched independently of row content (works even
   * with zero rows). When provided, validated against validateClaimPerRowSchema
   * before any row is processed. Omit only when the caller cannot fetch schema
   * separately from rows (selection then proceeds on the declared contract alone).
   */
  propertyNames?: string[];
}

export function buildFactsFromNotionRows(
  rawRows: RawNotionFactRow[],
  opts: BuildFactsOptions,
  now = new Date(),
): NotionFactsResult {
  const modelResult = validateRecordModelConfig(opts.recordModel);
  if (!modelResult.ok) return { ok: false, reason: modelResult.reason };

  if (opts.propertyNames) {
    const schema = validateClaimPerRowSchema(opts.propertyNames);
    if (!schema.ok) return { ok: false, reason: "schema_missing_required_properties" };
  }

  if (rawRows.length === 0) return { ok: false, reason: "no_rows" };

  const rows = rawRows.map(extractRow);
  const { claims, selectedRows, excluded } = selectClaimsPerRow(rows, now);
  if (claims.length === 0) return { ok: false, reason: "no_valid_facts" };

  const compliance = resolveComplianceFields(selectedRows);
  if (!compliance.ok) return { ok: false, reason: compliance.reason };

  const bundle = loadFactsFromObject({
    utility_mw_current_verified: "",
    utility_mw_target: "",
    it_mw_planned: "",
    land_control_status: "",
    site_location_disclosure: compliance.values.siteLocationDisclosure,
    target_rfs_status: "",
    legal_sender_entity: compliance.values.legalSenderEntity,
    approved_sender_name_title: compliance.values.approvedSenderNameTitle,
    reply_to: compliance.values.replyTo,
    postal_address: compliance.values.postalAddress,
    opt_out_instructions: compliance.values.optOutInstructions,
    restricted_claims: [],
    facts: claims,
  });

  return { ok: true, bundle, model: modelResult.model, excluded };
}
