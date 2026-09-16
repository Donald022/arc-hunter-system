import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../src/config.ts";

const STAGING_PARENT_ID = "11112222333344445555666677778888";

interface FakeDb {
  id: string;
  title: string;
  properties: Record<string, unknown>;
  dataSourceId: string;
}

function makeFakeNotion() {
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `db${String(counter).padStart(30, "0")}`;
  };
  const pageTitles = new Map<string, string>();
  const parentChildren = new Map<string, FakeDb[]>();
  const databasesById = new Map<string, FakeDb>();

  function setPage(id: string, title: string) {
    pageTitles.set(id.replace(/-/g, ""), title);
  }

  function seedExistingDatabase(
    parentId: string,
    title: string,
    properties: Record<string, unknown>,
  ) {
    const id = nextId();
    const db: FakeDb = { id, title, properties, dataSourceId: `ds_${id}` };
    databasesById.set(id, db);
    const list = parentChildren.get(parentId.replace(/-/g, "")) ?? [];
    list.push(db);
    parentChildren.set(parentId.replace(/-/g, ""), list);
    return db;
  }

  async function fetchImpl(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname;

    const json = (body: unknown, ok = true) =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 400,
        text: async () => JSON.stringify(body),
        json: async () => body,
      } as Response);

    const pageMatch = path.match(/^\/v1\/pages\/([a-f0-9-]+)$/i);
    if (pageMatch && method === "GET") {
      const id = pageMatch[1]!.replace(/-/g, "");
      const title = pageTitles.get(id) ?? "";
      return json({
        id,
        url: `https://notion.so/${id}`,
        properties: { title: { title: title ? [{ plain_text: title }] : [] } },
      });
    }

    const childrenMatch = path.match(/^\/v1\/blocks\/([a-f0-9-]+)\/children$/i);
    if (childrenMatch && method === "GET") {
      const id = childrenMatch[1]!.replace(/-/g, "");
      const dbs = parentChildren.get(id) ?? [];
      return json({
        results: dbs.map((db) => ({
          type: "child_database",
          id: db.id,
          child_database: { title: db.title },
        })),
        has_more: false,
      });
    }

    const dbMatch = path.match(/^\/v1\/databases\/([a-z0-9]+)$/i);
    if (dbMatch && method === "GET") {
      const db = databasesById.get(dbMatch[1]!);
      if (!db) return json({ message: "not found" }, false);
      return json({
        id: db.id,
        data_sources: [{ id: db.dataSourceId }],
        properties: Object.fromEntries(Object.keys(db.properties).map((name) => [name, { name }])),
      });
    }

    if (path === "/v1/databases" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        parent: { page_id: string };
        title: Array<{ text: { content: string } }>;
        initial_data_source: { properties: Record<string, unknown> };
      };
      const title = body.title[0]?.text.content ?? "untitled";
      const db = seedExistingDatabase(
        body.parent.page_id,
        title,
        body.initial_data_source.properties,
      );
      return json({ id: db.id, data_sources: [{ id: db.dataSourceId }] });
    }

    return json({ message: `unhandled ${method} ${path}` }, false);
  }

  function listDatabases(): FakeDb[] {
    return [...databasesById.values()];
  }

  return { fetchImpl, setPage, seedExistingDatabase, listDatabases };
}

async function importFreshScript() {
  vi.resetModules();
  return import("../scripts/setup-notion-staging.ts");
}

describe("setup-notion-staging", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.NOTION_TOKEN = "fake-token-for-tests";
    process.env.NOTION_EXPECTED_PARENT_PAGE_ID = STAGING_PARENT_ID;
    process.env.NOTION_WRITES_ENABLED = "false";
    process.env.NOTION_ENVIRONMENT = "staging";
    resetConfigCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.NOTION_EXPECTED_PARENT_PAGE_ID;
    delete process.env.NOTION_WRITES_ENABLED;
    delete process.env.NOTION_ENVIRONMENT;
    resetConfigCache();
  });

  it("plan mode performs zero writes even for a fully-missing parent", async () => {
    const fake = makeFakeNotion();
    fake.setPage(STAGING_PARENT_ID, "[STAGING] ARC Hunter");
    global.fetch = fake.fetchImpl as typeof fetch;

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => {
      logs.push(String(s));
    });

    const mod = await importFreshScript();
    await mod.main(["node", "script"]);

    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain('"mode": "plan"');
    expect(out).toContain('"status": "missing"');
    expect(out).toContain("Plan mode only. Zero writes performed.");
    // Never a raw resource id longer than the sanitized "...xxxx" fingerprint.
    expect(out).not.toContain(STAGING_PARENT_ID);
  });

  it("refuses to run without an explicit staging parent", async () => {
    delete process.env.NOTION_EXPECTED_PARENT_PAGE_ID;
    resetConfigCache();
    global.fetch = makeFakeNotion().fetchImpl as typeof fetch;
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(String(s)));
    const mod = await importFreshScript();
    await mod.main(["node", "script"]);
    spy.mockRestore();
    expect(logs.join("\n")).toContain("Explicit staging parent page id required");
  });

  it("rejects the production parent by title even if the id happened to match expected", async () => {
    const fake = makeFakeNotion();
    fake.setPage(STAGING_PARENT_ID, "03 — Anchor Tenant");
    global.fetch = fake.fetchImpl as typeof fetch;
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(String(s)));
    const mod = await importFreshScript();
    await mod.main(["node", "script"]);
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain('"ok": false');
    expect(out).toContain("production_parent_rejected");
  });

  it("--apply is required to create anything, and refuses when NOTION_WRITES_ENABLED=false", async () => {
    const fake = makeFakeNotion();
    fake.setPage(STAGING_PARENT_ID, "[STAGING] ARC Hunter");
    global.fetch = fake.fetchImpl as typeof fetch;
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(String(s)));
    const mod = await importFreshScript();
    await mod.main(["node", "script", "--apply"]);
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain('"apply_refused": true');
    expect(out).toContain("notion_writes_disabled");
    expect(fake.listDatabases()).toHaveLength(0);
  });

  it("staging apply rejects NOTION_ENVIRONMENT=production even with writes enabled and a verified staging parent", async () => {
    process.env.NOTION_WRITES_ENABLED = "true";
    process.env.NOTION_ENVIRONMENT = "production";
    resetConfigCache();
    const fake = makeFakeNotion();
    fake.setPage(STAGING_PARENT_ID, "[STAGING] ARC Hunter");
    global.fetch = fake.fetchImpl as typeof fetch;
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(String(s)));
    const mod = await importFreshScript();
    await mod.main(["node", "script", "--apply"]);
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain('"apply_refused": true');
    expect(out).toContain("staging_write_requires_staging_environment");
    // Zero writes: nothing was created in the fake Notion world.
    expect(fake.listDatabases()).toHaveLength(0);
  });

  it("plan mode still produces a full plan even when NOTION_ENVIRONMENT=production — it never requires pretending staging is production", async () => {
    process.env.NOTION_ENVIRONMENT = "production";
    resetConfigCache();
    const fake = makeFakeNotion();
    fake.setPage(STAGING_PARENT_ID, "[STAGING] ARC Hunter");
    global.fetch = fake.fetchImpl as typeof fetch;
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(String(s)));
    const mod = await importFreshScript();
    await mod.main(["node", "script"]);
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain('"mode": "plan"');
    expect(out).toContain('"status": "missing"');
    expect(fake.listDatabases()).toHaveLength(0);
  });

  it("apply creates all five databases and wires relations to staging data sources only, then a repeat run is idempotent", async () => {
    process.env.NOTION_WRITES_ENABLED = "true";
    resetConfigCache();
    const fake = makeFakeNotion();
    fake.setPage(STAGING_PARENT_ID, "[STAGING] ARC Hunter");
    global.fetch = fake.fetchImpl as typeof fetch;

    const logs1: string[] = [];
    let spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs1.push(String(s)));
    const mod = await importFreshScript();
    await mod.main(["node", "script", "--apply"]);
    spy.mockRestore();
    const firstRun = logs1.join("\n");
    expect(firstRun).toContain('"applied": true');
    expect(firstRun).toContain("[STAGING] ARC Companies");
    expect(firstRun).toContain("[STAGING] ARC Contacts");
    expect(firstRun).toContain("[STAGING] ARC Outreach Activity");
    expect(firstRun).toContain("[STAGING] ARC Campaigns");
    expect(firstRun).toContain("[STAGING] ARC Approved Outreach Facts");

    // Relations must point only at staging data sources created/discovered in this run.
    const companiesDb = fake.listDatabases().find((d) => d.title === "[STAGING] ARC Companies")!;
    const contactsDb = fake.listDatabases().find((d) => d.title === "[STAGING] ARC Contacts")!;
    const activityDb = fake
      .listDatabases()
      .find((d) => d.title === "[STAGING] ARC Outreach Activity")!;
    const companyRelation = contactsDb.properties.Company as {
      relation: { data_source_id: string };
    };
    expect(companyRelation.relation.data_source_id).toBe(companiesDb.dataSourceId);
    const contactRelation = activityDb.properties.Contact as {
      relation: { data_source_id: string };
    };
    expect(contactRelation.relation.data_source_id).toBe(contactsDb.dataSourceId);

    // Second run against the same in-memory world must find everything already
    // present and skip creation (idempotent).
    const logs2: string[] = [];
    spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs2.push(String(s)));
    const mod2 = await importFreshScript();
    await mod2.main(["node", "script", "--apply"]);
    spy.mockRestore();
    const secondRun = logs2.join("\n");
    expect(secondRun).toContain('"applied": true');
    expect(secondRun).toContain('"created": []');
  });

  it("detects a partially-created resource and reports it without patching it", async () => {
    const fake = makeFakeNotion();
    fake.setPage(STAGING_PARENT_ID, "[STAGING] ARC Hunter");
    // Seed a Contacts database missing most required properties.
    fake.seedExistingDatabase(STAGING_PARENT_ID, "[STAGING] ARC Contacts", { Name: {} });
    global.fetch = fake.fetchImpl as typeof fetch;

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => logs.push(String(s)));
    const mod = await importFreshScript();
    await mod.main(["node", "script"]);
    spy.mockRestore();
    const out = logs.join("\n");
    expect(out).toContain('"status": "exists_partial"');
    expect(out).toContain("MANUAL FOLLOW-UP REQUIRED");
    expect(out).toContain("Work Email");
  });
});
