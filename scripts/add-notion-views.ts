/**
 * Create operator views on ARC Contacts. Does not modify Market Map or the old CRMs.
 */
import { inspectLiveNotion, notionRequest } from "../src/integrations/notion.ts";

const VIEW_NAMES = [
  "Review Queue",
  "Drafts Awaiting Approval",
  "Sent / Donald Owns",
  "Replies / Action Needed",
  "DNC",
  "Company Coverage",
] as const;

function selectAnyOf(values: string[]) {
  return { property: "Status", select: { equals: values } };
}

function viewsToCreate(companyPropertyId: string) {
  return [
    {
      name: "Review Queue",
      filter: selectAnyOf(["RESEARCH_REVIEW", "QUALIFIED", "QUALIFIED_NO_EMAIL", "FACT_REVIEW"]),
    },
    {
      name: "Drafts Awaiting Approval",
      filter: selectAnyOf(["DRAFT_READY", "PENDING_APPROVAL", "EDITING"]),
    },
    {
      name: "Sent / Donald Owns",
      filter: selectAnyOf(["SENT", "SEND_UNCERTAIN", "SEND_FAILED", "MANUAL_HANDOFF"]),
    },
    {
      name: "Replies / Action Needed",
      filter: selectAnyOf(["REPLIED", "BOUNCED"]),
    },
    {
      name: "DNC",
      filter: {
        or: [
          { property: "Status", select: { equals: ["DNC"] } },
          { property: "Do Not Contact", checkbox: { equals: true } },
        ],
      },
    },
    {
      name: "Company Coverage",
      configuration: {
        type: "table",
        group_by: {
          type: "relation",
          property_id: companyPropertyId,
          sort: { type: "ascending" },
          hide_empty_groups: true,
        },
      },
    },
  ];
}

async function listViewIds(databaseId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ database_id: databaseId });
    if (cursor) q.set("start_cursor", cursor);
    const json = (await notionRequest(`/views?${q.toString()}`)) as {
      results?: Array<{ id: string }>;
      has_more?: boolean;
      next_cursor?: string | null;
    };
    ids.push(...(json.results ?? []).map((r) => r.id));
    cursor = json.has_more ? (json.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return ids;
}

async function main() {
  const live = await inspectLiveNotion();
  const contacts = live.children.find((c) => c.spec_key === "contacts" && c.object === "database");
  if (!contacts?.id || !contacts.data_source_id) {
    throw new Error("ARC Contacts database not found under the parent page");
  }

  const ds = (await notionRequest(`/data_sources/${contacts.data_source_id}`)) as {
    properties?: Record<string, { id?: string; name?: string; type?: string }>;
  };
  const companyProp = Object.values(ds.properties ?? {}).find((p) => p.name === "Company");
  if (!companyProp?.id) throw new Error("Company property missing on ARC Contacts");

  const existingIds = await listViewIds(contacts.id);
  const existingNames = new Set<string>();
  for (const id of existingIds) {
    const view = (await notionRequest(`/views/${id}`)) as { name?: string };
    if (view.name) existingNames.add(view.name);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const spec of viewsToCreate(companyProp.id)) {
    if (
      existingNames.has(spec.name) ||
      !VIEW_NAMES.includes(spec.name as (typeof VIEW_NAMES)[number])
    ) {
      if (existingNames.has(spec.name)) skipped.push(spec.name);
      continue;
    }
    const body: Record<string, unknown> = {
      database_id: contacts.id,
      data_source_id: contacts.data_source_id,
      name: spec.name,
      type: "table",
    };
    if ("filter" in spec) body.filter = spec.filter;
    if ("configuration" in spec) body.configuration = spec.configuration;
    await notionRequest("/views", { method: "POST", body: JSON.stringify(body) });
    created.push(spec.name);
  }

  console.log(
    JSON.stringify(
      {
        database: contacts.title,
        existing_views: [...existingNames],
        created,
        skipped,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
