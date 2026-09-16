/**
 * Idempotent staging Notion setup tool.
 *
 * Creates or reconciles the five ARC Hunter databases under an explicit staging
 * parent page — never the production parent. Defaults to plan/diff mode (zero
 * writes); pass --apply to create anything, and only after reviewing the plan.
 *
 * Usage:
 *   npx tsx scripts/setup-notion-staging.ts --parent=<staging_parent_page_id>   # plan only
 *   npx tsx scripts/setup-notion-staging.ts --parent=<staging_parent_page_id> --apply
 *
 * If NOTION_EXPECTED_PARENT_PAGE_ID is already set in .env, --parent may be omitted.
 *
 * Plan mode only checks parent identity (ancestry + [STAGING] marker); it never
 * requires NOTION_ENVIRONMENT or NOTION_WRITES_ENABLED to be set to any particular
 * value, so it always works as a safe, zero-write preview. --apply additionally
 * requires, via assertStagingWriteAllowed(), that the REAL (ambient) NOTION_ENVIRONMENT
 * is exactly "staging" and NOTION_WRITES_ENABLED=true — this script never constructs a
 * synthetic "pretend staging" config to satisfy that check.
 *
 * Never prints a token or a complete resource id — only a last-4 fingerprint, the
 * same convention used in NOTION_SCHEMA_AUDIT.md.
 */
import { getConfig } from "../src/config.ts";
import {
  dashifyNotionId,
  fetchPageIdentity,
  notionListChildren,
  matchSpecKey,
  diffProperties,
  createDatabase,
  companiesProperties,
  contactsProperties,
  activityProperties,
  campaignsProperties,
  factsProperties,
  REQUIRED_PROPERTIES,
} from "../src/integrations/notion.ts";
import {
  classifyStagingIdentity,
  assertStagingWriteAllowed,
  NotionEnvironmentError,
  STAGING_MARKER,
  type NotionParentIdentity,
} from "../src/integrations/notionEnvironment.ts";

export function last4(id: string | undefined): string {
  if (!id) return "(none)";
  const clean = id.replace(/-/g, "");
  return clean.length <= 4 ? "****" : `...${clean.slice(-4)}`;
}

type SpecKey = "companies" | "contacts" | "activity" | "campaigns" | "facts";

interface ResourceSpec {
  key: SpecKey;
  title: string;
  requiredProperties: readonly string[] | undefined; // undefined = facts (no diff spec)
}

export const RESOURCE_ORDER: ResourceSpec[] = [
  {
    key: "companies",
    title: "[STAGING] ARC Companies",
    requiredProperties: REQUIRED_PROPERTIES.companies,
  },
  {
    key: "contacts",
    title: "[STAGING] ARC Contacts",
    requiredProperties: REQUIRED_PROPERTIES.contacts,
  },
  {
    key: "activity",
    title: "[STAGING] ARC Outreach Activity",
    requiredProperties: REQUIRED_PROPERTIES.activity,
  },
  {
    key: "campaigns",
    title: "[STAGING] ARC Campaigns",
    requiredProperties: REQUIRED_PROPERTIES.campaigns,
  },
  { key: "facts", title: "[STAGING] ARC Approved Outreach Facts", requiredProperties: undefined },
];

interface ExistingResource {
  id: string;
  dataSourceId?: string;
  title: string;
  propertyNames: string[];
}

interface PlanEntry {
  key: SpecKey;
  title: string;
  status: "missing" | "exists_ok" | "exists_partial";
  existing_id_fingerprint?: string;
  missing_properties?: string[];
  extra_properties?: string[];
}

async function fetchExistingStagingResources(
  parentDashed: string,
): Promise<Map<SpecKey, ExistingResource>> {
  const blocks = await notionListChildren(parentDashed);
  const found = new Map<SpecKey, ExistingResource>();
  for (const block of blocks) {
    if (block.type !== "child_database") continue;
    const id = String(block.id);
    const dbTitle = (block.child_database as { title?: string } | undefined)?.title ?? "";
    if (!dbTitle.toUpperCase().includes(STAGING_MARKER)) continue; // only ever look at staging-marked resources
    const spec = matchSpecKey(dbTitle);
    if (!spec) continue;
    const { notionRequest } = await import("../src/integrations/notion.ts");
    const db = (await notionRequest(`/databases/${id}`)) as {
      data_sources?: Array<{ id: string }>;
      properties?: Record<string, { name?: string }>;
    };
    const dataSourceId = db.data_sources?.[0]?.id;
    let propertyNames = Object.values(db.properties ?? {})
      .map((p) => p.name ?? "")
      .filter(Boolean);
    if (dataSourceId && propertyNames.length === 0) {
      const ds = (await notionRequest(`/data_sources/${dataSourceId}`)) as {
        properties?: Record<string, { name?: string }>;
      };
      propertyNames = Object.values(ds.properties ?? {})
        .map((p) => p.name ?? "")
        .filter(Boolean);
    }
    found.set(spec as SpecKey, { id, dataSourceId, title: dbTitle, propertyNames });
  }
  return found;
}

export function buildPlan(existing: Map<SpecKey, ExistingResource>): PlanEntry[] {
  return RESOURCE_ORDER.map((spec) => {
    const have = existing.get(spec.key);
    if (!have) return { key: spec.key, title: spec.title, status: "missing" };
    if (!spec.requiredProperties) {
      return {
        key: spec.key,
        title: spec.title,
        status: "exists_ok",
        existing_id_fingerprint: last4(have.id),
      };
    }
    const diff = diffProperties(have.propertyNames, spec.requiredProperties);
    const partial = diff.missing.length > 0;
    return {
      key: spec.key,
      title: spec.title,
      status: partial ? "exists_partial" : "exists_ok",
      existing_id_fingerprint: last4(have.id),
      missing_properties: diff.missing,
      extra_properties: diff.extra,
    };
  });
}

function printManualChecklist(plan: PlanEntry[], parentArg: string | undefined): void {
  const partials = plan.filter((p) => p.status === "exists_partial");
  if (partials.length === 0) return;
  console.log("\n--- MANUAL FOLLOW-UP REQUIRED (this tool never patches existing databases) ---");
  for (const p of partials) {
    console.log(`\n${p.title} (id ${p.existing_id_fingerprint}) is missing properties:`);
    for (const m of p.missing_properties ?? []) console.log(`  - ${m}`);
    console.log("  Add these manually in the Notion UI, matching NOTION_SCHEMA_AUDIT.md types.");
  }
  console.log(
    "\nRead-only re-verification command (no writes, safe to re-run any time):\n" +
      "  npx tsx scripts/setup-notion-staging.ts" +
      (parentArg ? ` --parent=${parentArg}` : ""),
  );
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const apply = argv.includes("--apply");
  const parentArg = argv.find((a) => a.startsWith("--parent="))?.split("=")[1];
  const cfg = getConfig();
  if (!cfg.NOTION_TOKEN) {
    console.log(JSON.stringify({ ok: false, reason: "NOTION_TOKEN missing" }, null, 2));
    process.exitCode = 1;
    return;
  }
  const parentId = parentArg ?? cfg.NOTION_EXPECTED_PARENT_PAGE_ID;
  if (!parentId) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason:
            "Explicit staging parent page id required. Pass --parent=<id> or set NOTION_EXPECTED_PARENT_PAGE_ID in .env.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  // Read-only identity check first — never lists children or creates anything
  // until the parent is confirmed to be a staging resource. This uses the real
  // ambient config (cfg.NOTION_EXPECTED_PARENT_PAGE_ID / cfg.NOTION_PARENT_PAGE_ID),
  // never a synthesized "pretend this is staging" override — identity here does not
  // depend on NOTION_ENVIRONMENT at all, so plan mode never requires pretending
  // staging is production and works regardless of NOTION_ENVIRONMENT's value.
  const parent: NotionParentIdentity = await fetchPageIdentity(parentId);
  const identity = classifyStagingIdentity(cfg, parent);
  if (!identity.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: identity.reason,
          parent_fingerprint: last4(parent.id),
          parent_title: parent.title,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const dashed = dashifyNotionId(parentId);
  const existing = await fetchExistingStagingResources(dashed);
  const plan = buildPlan(existing);

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "plan",
        parent_fingerprint: last4(parent.id),
        parent_title: parent.title,
        plan: plan.map((p) => ({
          resource: p.title,
          status: p.status,
          id: p.existing_id_fingerprint,
          missing_properties: p.missing_properties,
          extra_properties: p.extra_properties,
        })),
      },
      null,
      2,
    ),
  );
  printManualChecklist(plan, parentArg);

  if (!apply) {
    console.log("\nPlan mode only. Zero writes performed.");
    return;
  }

  // Re-validate immediately before writing — never trust a check performed earlier
  // in the process lifetime. assertStagingWriteAllowed uses the REAL ambient cfg
  // (never a synthesized override) and hard-requires NOTION_ENVIRONMENT=staging,
  // NOTION_WRITES_ENABLED=true, AND a passing identity check, all three, before any
  // write is attempted.
  try {
    assertStagingWriteAllowed(cfg, parent);
  } catch (err) {
    const reason = err instanceof NotionEnvironmentError ? err.reasonCode : "unknown";
    console.log(JSON.stringify({ ok: false, apply_refused: true, reason }, null, 2));
    process.exitCode = 1;
    return;
  }

  const created: string[] = [];
  const skipped: string[] = [];

  async function ensureCreated(
    key: SpecKey,
    title: string,
    build: () => Promise<{ id: string; data_source_id: string }>,
  ): Promise<{ id: string; data_source_id?: string }> {
    const have = existing.get(key);
    if (have) {
      skipped.push(title);
      return { id: have.id, data_source_id: have.dataSourceId };
    }
    const db = await build();
    created.push(title);
    existing.set(key, { id: db.id, dataSourceId: db.data_source_id, title, propertyNames: [] });
    return db;
  }

  const companies = await ensureCreated("companies", "[STAGING] ARC Companies", () =>
    createDatabase(parentId, "[STAGING] ARC Companies", companiesProperties()),
  );
  const companiesDs = companies.data_source_id ?? existing.get("companies")?.dataSourceId ?? "";

  const contacts = await ensureCreated("contacts", "[STAGING] ARC Contacts", () =>
    createDatabase(parentId, "[STAGING] ARC Contacts", contactsProperties(companiesDs)),
  );
  const contactsDs = contacts.data_source_id ?? existing.get("contacts")?.dataSourceId ?? "";

  await ensureCreated("activity", "[STAGING] ARC Outreach Activity", () =>
    createDatabase(parentId, "[STAGING] ARC Outreach Activity", activityProperties(contactsDs)),
  );

  await ensureCreated("campaigns", "[STAGING] ARC Campaigns", () =>
    createDatabase(parentId, "[STAGING] ARC Campaigns", campaignsProperties()),
  );

  await ensureCreated("facts", "[STAGING] ARC Approved Outreach Facts", () =>
    createDatabase(parentId, "[STAGING] ARC Approved Outreach Facts", factsProperties()),
  );

  console.log(
    "\n" +
      JSON.stringify(
        {
          applied: true,
          created,
          skipped,
          note: "Relations were wired to staging data sources discovered/created in this same run only.",
        },
        null,
        2,
      ),
  );
}

const isDirectRun = (() => {
  const entry = process.argv[1] ?? "";
  return entry.replace(/\\/g, "/").endsWith("scripts/setup-notion-staging.ts");
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
