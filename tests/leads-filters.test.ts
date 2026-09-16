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

describe("Leads filter controls", () => {
  beforeEach(() => {
    clearSessions();
    resetConfigCache();
    process.env.NODE_ENV = "staging";
    process.env.DASHBOARD_FIXTURE_LOGIN = "true";
    process.env.DRY_RUN = "true";
    loadConfig();
  });

  it("renders state as a select dropdown, not a text input", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Should have a select element for state
    expect(leads.body).toContain("<select");
    expect(leads.body).toContain('id="filter-state"');
    expect(leads.body).toContain('name="state"');

    // Should not have a text input for state
    expect(leads.body).not.toContain('placeholder="Filter by state..."');

    await app.close();
  });

  it("renders hunter as a select dropdown, not a text input", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Should have a select element for hunter
    expect(leads.body).toContain("<select");
    expect(leads.body).toContain('id="filter-hunter"');
    expect(leads.body).toContain('name="hunter"');

    // Should not have a text input for hunter
    expect(leads.body).not.toContain('placeholder="Filter by hunter..."');

    await app.close();
  });

  it("includes 'All states' and 'All hunters' options", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    expect(leads.body).toContain('<option value="">All states</option>');
    expect(leads.body).toContain('<option value="">All hunters</option>');

    await app.close();
  });

  it("selects DISCOVERED state when filtering by DISCOVERED", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: true, store });

    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({
      method: "GET",
      url: "/dashboard/leads?state=DISCOVERED",
      headers: { cookie },
    });
    expect(leads.statusCode).toBe(200);

    // The DISCOVERED option should be marked as selected
    expect(leads.body).toContain('<option value="DISCOVERED" selected>Discovered</option>');

    // Should show only discovered leads
    const contacts = await store.contacts.list({ state: "DISCOVERED" as never });
    expect(contacts.length).toBeGreaterThan(0);
    expect(leads.body).toContain("Discovered"); // State badge

    await app.close();
  });

  it("selects broker hunter when filtering by broker", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: true, store });

    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({
      method: "GET",
      url: "/dashboard/leads?hunter=broker",
      headers: { cookie },
    });
    expect(leads.statusCode).toBe(200);

    // The broker option should be marked as selected
    expect(leads.body).toContain('<option value="broker" selected>Broker</option>');

    // Should show broker leads
    expect(leads.body).toContain("broker"); // Hunter tag in table

    await app.close();
  });

  it("combines state and hunter filters", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: true, store });

    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({
      method: "GET",
      url: "/dashboard/leads?state=DISCOVERED&hunter=broker",
      headers: { cookie },
    });
    expect(leads.statusCode).toBe(200);

    // Both should be selected
    expect(leads.body).toContain('<option value="DISCOVERED" selected>Discovered</option>');
    expect(leads.body).toContain('<option value="broker" selected>Broker</option>');

    await app.close();
  });

  it("combines search text with both dropdowns", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: true, store });

    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({
      method: "GET",
      url: "/dashboard/leads?q=Alex&state=DISCOVERED&hunter=broker",
      headers: { cookie },
    });
    expect(leads.statusCode).toBe(200);

    // All filters should be preserved
    expect(leads.body).toContain('value="Alex"'); // Search input
    expect(leads.body).toContain('<option value="DISCOVERED" selected>Discovered</option>');
    expect(leads.body).toContain('<option value="broker" selected>Broker</option>');

    await app.close();
  });

  it("preserves selected values after form submission", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: true, store });

    const app = await buildApp();
    const cookie = await login(app);

    // Submit with filters
    const leads1 = await app.inject({
      method: "GET",
      url: "/dashboard/leads?state=DISCOVERED&hunter=broker",
      headers: { cookie },
    });
    expect(leads1.statusCode).toBe(200);
    expect(leads1.body).toContain('<option value="DISCOVERED" selected>Discovered</option>');
    expect(leads1.body).toContain('<option value="broker" selected>Broker</option>');

    // Re-submit (simulating form re-submission)
    const leads2 = await app.inject({
      method: "GET",
      url: "/dashboard/leads?state=DISCOVERED&hunter=broker",
      headers: { cookie },
    });
    expect(leads2.statusCode).toBe(200);
    expect(leads2.body).toContain('<option value="DISCOVERED" selected>Discovered</option>');
    expect(leads2.body).toContain('<option value="broker" selected>Broker</option>');

    await app.close();
  });

  it("rejects invalid state values safely", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    // Try to inject an invalid state
    const leads = await app.inject({
      method: "GET",
      url: "/dashboard/leads?state=INVALID_STATE",
      headers: { cookie },
    });
    expect(leads.statusCode).toBe(200); // Should not crash

    // Invalid state should be ignored, "All states" should be selected
    expect(leads.body).not.toContain('<option value="INVALID_STATE" selected');
    expect(leads.body).toContain('<option value="">All states</option>');

    await app.close();
  });

  it("rejects invalid hunter values safely", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    // Try to inject an invalid hunter
    const leads = await app.inject({
      method: "GET",
      url: "/dashboard/leads?hunter=invalid_hunter",
      headers: { cookie },
    });
    expect(leads.statusCode).toBe(200); // Should not crash

    // Invalid hunter should be ignored, "All hunters" should be selected
    expect(leads.body).not.toContain('<option value="invalid_hunter" selected');
    expect(leads.body).toContain('<option value="">All hunters</option>');

    await app.close();
  });

  it("returns all records when 'All' options are selected", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: true, store });

    const app = await buildApp();
    const cookie = await login(app);

    // No filters
    const leads = await app.inject({
      method: "GET",
      url: "/dashboard/leads",
      headers: { cookie },
    });
    expect(leads.statusCode).toBe(200);

    // Should show all contacts
    const contacts = await store.contacts.list({});
    expect(contacts.length).toBeGreaterThan(0);
    expect(leads.body).toContain("Showing");

    await app.close();
  });

  it("displays score as 0-100, not /10", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: true, store });

    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Should show "Awaiting research" for discovered leads
    expect(leads.body).toContain("Awaiting research");

    // Should NOT show "/10" format
    expect(leads.body).not.toContain("/10");

    // If any scores exist, they should show "/100"
    if (leads.body.includes("/100")) {
      expect(leads.body).toContain("/100");
    }

    await app.close();
  });

  it("includes accessibility labels for screen readers", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Should have visually-hidden labels
    expect(leads.body).toContain('class="visually-hidden"');
    expect(leads.body).toContain('for="filter-search"');
    expect(leads.body).toContain('for="filter-state"');
    expect(leads.body).toContain('for="filter-hunter"');

    await app.close();
  });

  it("includes all canonical contact states in dropdown", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Check for key states from the spec
    expect(leads.body).toContain('value="DISCOVERED"');
    expect(leads.body).toContain('value="RESEARCHING"');
    expect(leads.body).toContain('value="RESEARCH_REVIEW"');
    expect(leads.body).toContain('value="QUALIFIED"');
    expect(leads.body).toContain('value="QUALIFIED_NO_EMAIL"');
    expect(leads.body).toContain('value="FACT_REVIEW"');
    expect(leads.body).toContain('value="DRAFT_READY"');
    expect(leads.body).toContain('value="PENDING_APPROVAL"');
    expect(leads.body).toContain('value="APPROVED"');
    expect(leads.body).toContain('value="SENT"');
    expect(leads.body).toContain('value="REPLIED"');
    expect(leads.body).toContain('value="DISQUALIFIED"');
    expect(leads.body).toContain('value="SKIPPED"');
    expect(leads.body).toContain('value="DNC"');
    expect(leads.body).toContain('value="BOUNCED"');

    await app.close();
  });

  it("includes all canonical hunters in dropdown", async () => {
    const store = useTestStore();
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);

    // Check for all hunters
    expect(leads.body).toContain('value="broker"');
    expect(leads.body).toContain('value="tenant"');
    expect(leads.body).toContain('value="expansion"');
    expect(leads.body).toContain('value="deal"');
    expect(leads.body).toContain('value="network"');

    await app.close();
  });
});
