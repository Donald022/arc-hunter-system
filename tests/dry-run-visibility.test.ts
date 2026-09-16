import { describe, expect, it, beforeEach } from "vitest";
import { buildApp } from "../src/app.ts";
import { useTestStore } from "./helpers.ts";
import { seedDefaultCampaigns } from "../src/jobs/campaigns.ts";
import { discover } from "../src/jobs/discover.ts";
import { loadConfig, resetConfigCache } from "../src/config.ts";
import { clearSessions } from "../src/dashboard/routes.ts";

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const res = await app.inject({
    method: "POST",
    url: "/dashboard/login",
    payload: new URLSearchParams({ email: "operator@arc.test" }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const setCookie = res.headers["set-cookie"];
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookie?.split(";")[0] ?? "";
}

describe("dry-run discovery visibility", () => {
  beforeEach(() => {
    clearSessions();
    resetConfigCache();
    process.env.NODE_ENV = "staging";
    process.env.DASHBOARD_FIXTURE_LOGIN = "true";
    process.env.DRY_RUN = "true";
    loadConfig();
  });

  it("persists discovered candidates in dry-run mode", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);

    // Run discovery in dry-run mode
    const result = await discover({ hunter: "broker", dryRun: true, store });

    // Verify the job result shows signals found (may include duplicates)
    expect(result.candidates).toBeGreaterThan(0);

    // Verify contacts were persisted to the database (deduplicated)
    const contacts = await store.contacts.list();
    expect(contacts.length).toBeGreaterThan(0);

    // Verify all discovered contacts are in DISCOVERED state
    const discovered = contacts.filter((c) => c.state === "DISCOVERED");
    expect(discovered.length).toBeGreaterThan(0);

    // Verify each has required fields
    for (const contact of discovered) {
      expect(contact.name).toBeTruthy();
      expect(contact.hunter_tags).toContain("broker");
      expect(contact.fit_score).toBe(0); // Not yet researched
      expect(contact.state).toBe("DISCOVERED");
    }
  });

  it("shows discovered candidates in Leads & Activity page", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    // Run discovery in dry-run mode
    const result = await discover({ hunter: "broker", dryRun: true, store });
    expect(result.candidates).toBeGreaterThan(0);

    // Check Leads & Activity page
    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Verify it shows the discovered candidates
    expect(leads.body).not.toContain("No leads found");
    expect(leads.body).toContain("Discovered"); // State badge
    expect(leads.body).toContain("Awaiting research"); // Score display

    // Verify it shows discovered contacts (may be less than signals due to deduplication)
    const contacts = await store.contacts.list();
    const discovered = contacts.filter((c) => c.state === "DISCOVERED");
    expect(discovered.length).toBeGreaterThan(0);

    const contactRows = (leads.body.match(/<tr>/g) || []).length - 1; // Subtract header row
    expect(contactRows).toBe(discovered.length);

    await app.close();
  });

  it("distinguishes discovered vs researched candidates on Overview", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    // Run discovery in dry-run mode
    await discover({ hunter: "broker", dryRun: true, store });

    // Check Overview page
    const overview = await app.inject({ method: "GET", url: "/dashboard", headers: { cookie } });
    expect(overview.statusCode).toBe(200);

    // Should show "Leads Discovered" stat card
    expect(overview.body).toContain("Leads Discovered");

    // Should show discovered count is greater than qualified count
    const contacts = await store.contacts.list();
    const discovered = contacts.filter((c) => c.state === "DISCOVERED").length;
    const qualified = contacts.filter((c) => c.state === "QUALIFIED").length;
    expect(discovered).toBeGreaterThan(qualified);

    await app.close();
  });

  it("shows discovered candidates without errors", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    // Run discovery in dry-run mode
    await discover({ hunter: "broker", dryRun: true, store });

    // Check Leads & Activity page renders successfully
    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Verify it shows the candidates
    expect(leads.body).toContain("Discovered");
    expect(leads.body).toContain("Awaiting research");

    await app.close();
  });

  it("shows evidence summary for discovered candidates", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    // Run discovery in dry-run mode
    await discover({ hunter: "broker", dryRun: true, store });

    // Get a discovered contact
    const contacts = await store.contacts.list();
    const discovered = contacts.find((c) => c.state === "DISCOVERED");
    expect(discovered).toBeTruthy();
    expect(discovered!.evidence_summary).toBeTruthy();

    // Check Leads & Activity page shows evidence
    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.body).toContain("Evidence / Reasons"); // Column header

    await app.close();
  });
});
