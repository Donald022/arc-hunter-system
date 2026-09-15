import { getConfig } from "../config.ts";
import { logger } from "../logger.ts";
import {
  ACTIVITY_TYPES,
  CONTACT_STATES,
  EMAIL_CONFIDENCE,
  HUNTERS,
  ROLES,
  SEGMENTS,
  type CampaignRecord,
  type CompanyRecord,
  type ContactRecord,
  type OutreachEvent,
} from "../domain/types.ts";

const MANUAL_OVERRIDE_STATES = new Set(["DNC", "DISQUALIFIED", "REPLIED", "PAUSED"]);

export interface NotionClient {
  inspect(): Promise<{ parent?: string; data_sources: Record<string, string> }>;
  upsertCompany(company: CompanyRecord): Promise<string>;
  upsertContact(contact: ContactRecord, existing?: { Status?: string; Owner?: string; DoNotContact?: boolean }): Promise<string>;
  addActivity(event: OutreachEvent, contactExternalId?: string): Promise<string>;
  upsertCampaign(campaign: CampaignRecord): Promise<string>;
  fetchCampaigns(): Promise<CampaignRecord[]>;
  fetchFacts(): Promise<unknown>;
}

export class FixtureNotion implements NotionClient {
  pages = new Map<string, Record<string, unknown>>();
  failNext = false;

  async inspect() {
    return {
      parent: process.env.NOTION_PARENT_PAGE_ID,
      data_sources: {
        companies: process.env.NOTION_COMPANIES_DATA_SOURCE_ID ?? "",
        contacts: process.env.NOTION_CONTACTS_DATA_SOURCE_ID ?? "",
        activity: process.env.NOTION_ACTIVITY_DATA_SOURCE_ID ?? "",
        campaigns: process.env.NOTION_CAMPAIGNS_DATA_SOURCE_ID ?? "",
        facts: process.env.NOTION_FACTS_PAGE_ID ?? "",
      },
    };
  }

  async upsertCompany(company: CompanyRecord) {
    this.pages.set(`company:${company.id}`, { ...company });
    return `notion_co_${company.id}`;
  }

  async upsertContact(contact: ContactRecord, existing?: { Status?: string; Owner?: string; DoNotContact?: boolean }) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("notion_write_failed");
    }
    const prev = (this.pages.get(`contact:${contact.id}`) ?? {}) as {
      state?: string;
      owner?: string;
      do_not_contact?: boolean;
    };
    const status = existing?.Status ?? prev.state;
    const merged = { ...contact };
    if (status && MANUAL_OVERRIDE_STATES.has(status)) {
      merged.state = status as ContactRecord["state"];
    }
    if (existing?.Owner ?? prev.owner) merged.owner = existing?.Owner ?? prev.owner;
    if (existing?.DoNotContact || prev.do_not_contact) merged.do_not_contact = true;
    this.pages.set(`contact:${contact.id}`, merged);
    return `notion_ct_${contact.id}`;
  }

  async addActivity(event: OutreachEvent) {
    this.pages.set(`activity:${event.id}`, { ...event });
    return `notion_act_${event.id}`;
  }

  async upsertCampaign(campaign: CampaignRecord) {
    this.pages.set(`campaign:${campaign.id}`, { ...campaign });
    return `notion_camp_${campaign.id}`;
  }

  async fetchCampaigns() {
    return [...this.pages.entries()]
      .filter(([k]) => k.startsWith("campaign:"))
      .map(([, v]) => v as unknown as CampaignRecord);
  }

  async fetchFacts() {
    return { source: "fixture" };
  }
}

let client: NotionClient = new FixtureNotion();

export function setNotionClient(c: NotionClient): void {
  client = c;
}

export function getNotionClient(): NotionClient {
  return client;
}

export async function notionRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const cfg = getConfig();
  if (!cfg.NOTION_TOKEN) throw new Error("NOTION_TOKEN missing");
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.NOTION_TOKEN}`,
      "notion-version": cfg.NOTION_API_VERSION,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`notion ${res.status}: ${await res.text()}`);
  return res.json();
}

export const REQUIRED_PROPERTIES = {
  companies: [
    "Name",
    "Domain",
    "Segment",
    "Region Signals",
    "Why Relevant",
    "Source URLs",
    "Account Priority",
    "Owner",
    "Status",
    "Last Seen",
  ],
  contacts: [
    "Name",
    "Company",
    "Title",
    "Work Email",
    "Email Confidence",
    "Profile URL",
    "Hunter Tags",
    "Role",
    "Direct Buyer Potential",
    "Connection Potential",
    "Fit Score",
    "Evidence Summary",
    "Evidence URLs",
    "Personalization Fact",
    "Source Date",
    "Status",
    "Do Not Contact",
    "Owner",
    "Last Contacted",
    "Gmail Thread ID",
    "Internal Lead ID",
  ],
  activity: [
    "Name",
    "Contact",
    "Type",
    "Time",
    "Actor",
    "Subject",
    "Exact Body",
    "Research Snapshot",
    "Gmail Message ID",
    "Gmail Thread ID",
    "Approval Version",
    "Error",
  ],
  campaigns: [
    "Name",
    "Hunter",
    "Enabled",
    "Seed Domains",
    "Source URLs",
    "Search Terms",
    "Region Boost",
    "Daily Research Cap",
    "Daily Send Cap",
    "Last Run",
  ],
};

export function diffProperties(
  existingNames: string[],
  required: string[],
): { missing: string[]; extra: string[] } {
  const have = new Set(existingNames);
  return {
    missing: required.filter((r) => !have.has(r)),
    extra: existingNames.filter((n) => !required.includes(n)),
  };
}

export const NOTION_VIEWS = [
  "Review Queue",
  "Drafts Awaiting Approval",
  "Sent / Donald Owns",
  "Replies / Action Needed",
  "DNC",
  "Company Coverage",
];

function plainText(rich?: Array<{ plain_text?: string }>): string {
  return (rich ?? []).map((t) => t.plain_text ?? "").join("").trim();
}

async function notionListChildren(blockId: string): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ page_size: "100" });
    if (cursor) q.set("start_cursor", cursor);
    const json = (await notionRequest(`/blocks/${blockId}/children?${q.toString()}`)) as {
      results?: Array<Record<string, unknown>>;
      has_more?: boolean;
      next_cursor?: string | null;
    };
    out.push(...(json.results ?? []));
    cursor = json.has_more ? json.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}

function matchSpecKey(title: string): keyof typeof REQUIRED_PROPERTIES | "facts" | undefined {
  const t = title.toLowerCase();
  if (t.includes("approved") && t.includes("fact")) return "facts";
  if (t.includes("fact") && t.includes("outreach")) return "facts";
  if (t.includes("compan")) return "companies";
  if (t.includes("contact")) return "contacts";
  if (t.includes("activit") || t.includes("outreach")) return "activity";
  if (t.includes("campaign")) return "campaigns";
  return undefined;
}

export async function inspectLiveNotion(): Promise<{
  mode: "inspect";
  parent: { id: string; title: string; url?: string } | undefined;
  children: Array<{
    object: string;
    id: string;
    title: string;
    spec_key?: string;
    data_source_id?: string;
    property_names?: string[];
    missing?: string[];
    extra?: string[];
  }>;
  suggested_env: Record<string, string>;
  unmapped_required: string[];
}> {
  const cfg = getConfig();
  if (!cfg.NOTION_TOKEN) throw new Error("NOTION_TOKEN missing");
  if (!cfg.NOTION_PARENT_PAGE_ID) throw new Error("NOTION_PARENT_PAGE_ID missing");
  logger.info("notion inspect (no writes)");

  const parentId = cfg.NOTION_PARENT_PAGE_ID.replace(/-/g, "");
  const dashed = `${parentId.slice(0, 8)}-${parentId.slice(8, 12)}-${parentId.slice(12, 16)}-${parentId.slice(16, 20)}-${parentId.slice(20)}`;
  const page = (await notionRequest(`/pages/${dashed}`)) as {
    id: string;
    url?: string;
    properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
  };
  const parentTitle =
    plainText(page.properties?.title?.title) ||
    plainText(page.properties?.Name?.title) ||
    "03 — Anchor Tenant";

  const blocks = await notionListChildren(dashed);
  const children: Array<{
    object: string;
    id: string;
    title: string;
    spec_key?: string;
    data_source_id?: string;
    property_names?: string[];
    missing?: string[];
    extra?: string[];
  }> = [];

  for (const block of blocks) {
    const type = String(block.type ?? "");
    if (type !== "child_database" && type !== "child_page") continue;
    const id = String(block.id);
    if (type === "child_page") {
      const child = (block.child_page as { title?: string } | undefined)?.title ?? "";
      const spec = matchSpecKey(child);
      children.push({ object: "page", id, title: child, spec_key: spec === "facts" ? "facts" : undefined });
      continue;
    }
    const dbTitle = (block.child_database as { title?: string } | undefined)?.title ?? "";
    const db = (await notionRequest(`/databases/${id}`)) as {
      id: string;
      title?: Array<{ plain_text?: string }>;
      data_sources?: Array<{ id: string; name?: string }>;
      properties?: Record<string, { name?: string }>;
    };
    const title = dbTitle || plainText(db.title);
    const dataSourceId = db.data_sources?.[0]?.id;
    let propertyNames = Object.values(db.properties ?? {}).map((p) => p.name ?? "").filter(Boolean);
    if (dataSourceId && propertyNames.length === 0) {
      const ds = (await notionRequest(`/data_sources/${dataSourceId}`)) as {
        properties?: Record<string, { name?: string }>;
      };
      propertyNames = Object.values(ds.properties ?? {}).map((p) => p.name ?? "").filter(Boolean);
    }
    const spec = matchSpecKey(title);
    const required = spec && spec !== "facts" ? REQUIRED_PROPERTIES[spec] : undefined;
    const diff = required ? diffProperties(propertyNames, required) : undefined;
    children.push({
      object: "database",
      id,
      title,
      spec_key: spec,
      data_source_id: dataSourceId,
      property_names: propertyNames,
      missing: diff?.missing,
      extra: diff?.extra,
    });
  }

  const suggested_env: Record<string, string> = {};
  for (const child of children) {
    if (child.spec_key === "companies" && child.data_source_id) suggested_env.NOTION_COMPANIES_DATA_SOURCE_ID = child.data_source_id;
    if (child.spec_key === "contacts" && child.data_source_id) suggested_env.NOTION_CONTACTS_DATA_SOURCE_ID = child.data_source_id;
    if (child.spec_key === "activity" && child.data_source_id) suggested_env.NOTION_ACTIVITY_DATA_SOURCE_ID = child.data_source_id;
    if (child.spec_key === "campaigns" && child.data_source_id) suggested_env.NOTION_CAMPAIGNS_DATA_SOURCE_ID = child.data_source_id;
    if (child.spec_key === "facts") suggested_env.NOTION_FACTS_PAGE_ID = child.id;
  }

  const need = ["companies", "contacts", "activity", "campaigns", "facts"];
  const have = new Set(children.map((c) => c.spec_key).filter(Boolean));
  return {
    mode: "inspect",
    parent: { id: page.id, title: parentTitle, url: page.url },
    children,
    suggested_env,
    unmapped_required: need.filter((k) => !have.has(k)),
  };
}

export async function inspectNotionParent(): Promise<{
  mode: "inspect";
  parent: string | undefined;
  mapped: Record<string, string | undefined>;
  note: string;
  live?: Awaited<ReturnType<typeof inspectLiveNotion>>;
}> {
  const cfg = getConfig();
  const live = cfg.NOTION_TOKEN && cfg.NOTION_PARENT_PAGE_ID ? await inspectLiveNotion() : undefined;
  return {
    mode: "inspect",
    parent: cfg.NOTION_PARENT_PAGE_ID,
    mapped: {
      companies: cfg.NOTION_COMPANIES_DATA_SOURCE_ID,
      contacts: cfg.NOTION_CONTACTS_DATA_SOURCE_ID,
      activity: cfg.NOTION_ACTIVITY_DATA_SOURCE_ID,
      campaigns: cfg.NOTION_CAMPAIGNS_DATA_SOURCE_ID,
      facts: cfg.NOTION_FACTS_PAGE_ID,
    },
    note: "Default is inspect/diff. Pass --apply to create databases under the parent page. Uses Notion data sources API version 2025-09-03.",
    live,
  };
}

function titleProp(content: string) {
  return [{ type: "text" as const, text: { content } }];
}

function selectOptions(names: readonly string[]) {
  return { select: { options: names.map((name) => ({ name })) } };
}

function multiSelectOptions(names: readonly string[]) {
  return { multi_select: { options: names.map((name) => ({ name })) } };
}

type CreatedDatabase = { id: string; data_source_id: string; title: string };

async function createDatabase(
  parentPageId: string,
  title: string,
  properties: Record<string, unknown>,
): Promise<CreatedDatabase> {
  const created = (await notionRequest("/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: titleProp(title),
      is_inline: false,
      initial_data_source: { properties },
    }),
  })) as { id: string; data_sources?: Array<{ id: string }> };
  const data_source_id = created.data_sources?.[0]?.id;
  if (!data_source_id) throw new Error(`no_data_source:${title}`);
  return { id: created.id, data_source_id, title };
}

export async function applyHunterDatabases(): Promise<{
  created: string[];
  skipped: string[];
  env: Record<string, string>;
}> {
  const cfg = getConfig();
  if (!cfg.NOTION_TOKEN || !cfg.NOTION_PARENT_PAGE_ID) {
    throw new Error("NOTION_TOKEN and NOTION_PARENT_PAGE_ID required for --apply");
  }
  const live = await inspectLiveNotion();
  const parentId = live.parent?.id ?? cfg.NOTION_PARENT_PAGE_ID;
  const existing = new Map(live.children.filter((c) => c.spec_key).map((c) => [c.spec_key!, c]));
  const created: string[] = [];
  const skipped: string[] = [];
  const env: Record<string, string> = { ...live.suggested_env };

  const ensure = async (key: string, title: string, build: () => Promise<CreatedDatabase>, envKey: string, useDatabaseId = false) => {
    const have = existing.get(key as keyof typeof REQUIRED_PROPERTIES | "facts");
    if (have?.data_source_id || (useDatabaseId && have?.id)) {
      skipped.push(title);
      if (have.data_source_id) env[envKey] = have.data_source_id;
      if (useDatabaseId) env[envKey] = have.id;
      return have;
    }
    const db = await build();
    created.push(title);
    env[envKey] = useDatabaseId ? db.id : db.data_source_id;
    existing.set(key as keyof typeof REQUIRED_PROPERTIES | "facts", {
      object: "database",
      id: db.id,
      title: db.title,
      spec_key: key,
      data_source_id: db.data_source_id,
    });
    return db;
  };

  const companies = await ensure("companies", "ARC Companies", () =>
    createDatabase(parentId, "ARC Companies", {
      Name: { title: {} },
      Domain: { url: {} },
      Segment: selectOptions(SEGMENTS),
      "Region Signals": multiSelectOptions(["Mexico", "LATAM", "International", "US", "Other"]),
      "Why Relevant": { rich_text: {} },
      "Source URLs": { rich_text: {} },
      "Account Priority": { number: { format: "number" } },
      Owner: { rich_text: {} },
      Status: selectOptions(["Active", "Watch", "Paused", "Disqualified", "DNC"]),
      "Last Seen": { date: {} },
    }), "NOTION_COMPANIES_DATA_SOURCE_ID");

  const companiesDs = "data_source_id" in companies && companies.data_source_id ? companies.data_source_id : env.NOTION_COMPANIES_DATA_SOURCE_ID;

  await ensure("contacts", "ARC Contacts", () =>
    createDatabase(parentId, "ARC Contacts", {
      Name: { title: {} },
      Company: { relation: { data_source_id: companiesDs, type: "single_property", single_property: {} } },
      Title: { rich_text: {} },
      "Work Email": { email: {} },
      "Email Confidence": selectOptions(EMAIL_CONFIDENCE),
      "Profile URL": { url: {} },
      "Hunter Tags": multiSelectOptions(HUNTERS),
      Role: selectOptions(ROLES),
      "Direct Buyer Potential": { number: { format: "number" } },
      "Connection Potential": { number: { format: "number" } },
      "Fit Score": { number: { format: "number" } },
      "Evidence Summary": { rich_text: {} },
      "Evidence URLs": { rich_text: {} },
      "Personalization Fact": { rich_text: {} },
      "Source Date": { date: {} },
      Status: selectOptions(CONTACT_STATES),
      "Do Not Contact": { checkbox: {} },
      Owner: { rich_text: {} },
      "Last Contacted": { date: {} },
      "Gmail Thread ID": { rich_text: {} },
      "Internal Lead ID": { rich_text: {} },
    }), "NOTION_CONTACTS_DATA_SOURCE_ID");

  const contactsDs = existing.get("contacts")?.data_source_id ?? env.NOTION_CONTACTS_DATA_SOURCE_ID;

  await ensure("activity", "ARC Outreach Activity", () =>
    createDatabase(parentId, "ARC Outreach Activity", {
      Name: { title: {} },
      Contact: { relation: { data_source_id: contactsDs, type: "single_property", single_property: {} } },
      Type: selectOptions(ACTIVITY_TYPES),
      Time: { date: {} },
      Actor: { rich_text: {} },
      Subject: { rich_text: {} },
      "Exact Body": { rich_text: {} },
      "Research Snapshot": { rich_text: {} },
      "Gmail Message ID": { rich_text: {} },
      "Gmail Thread ID": { rich_text: {} },
      "Approval Version": { number: { format: "number" } },
      Error: { rich_text: {} },
    }), "NOTION_ACTIVITY_DATA_SOURCE_ID");

  await ensure("campaigns", "ARC Campaigns", () =>
    createDatabase(parentId, "ARC Campaigns", {
      Name: { title: {} },
      Hunter: selectOptions(HUNTERS),
      Enabled: { checkbox: {} },
      "Seed Domains": { rich_text: {} },
      "Source URLs": { rich_text: {} },
      "Search Terms": { rich_text: {} },
      "Region Boost": { rich_text: {} },
      "Daily Research Cap": { number: { format: "number" } },
      "Daily Send Cap": { number: { format: "number" } },
      "Last Run": { date: {} },
    }), "NOTION_CAMPAIGNS_DATA_SOURCE_ID");

  await ensure(
    "facts",
    "ARC Approved Outreach Facts",
    () =>
      createDatabase(parentId, "ARC Approved Outreach Facts", {
        Name: { title: {} },
        legal_sender_entity: { rich_text: {} },
        approved_sender_name_title: { rich_text: {} },
        reply_to: { email: {} },
        postal_address: { rich_text: {} },
        opt_out_instructions: { rich_text: {} },
        site_location_disclosure: { rich_text: {} },
        approved_wording: { rich_text: {} },
        can_use_in_first_touch: { checkbox: {} },
        approved_by: { rich_text: {} },
        approved_at: { date: {} },
      }),
    "NOTION_FACTS_PAGE_ID",
    true,
  );

  return { created, skipped, env };
}
