import { describe, expect, it, beforeEach } from "vitest";
import { buildApp } from "../src/app.ts";
import { useTestStore } from "./helpers.ts";
import { seedDefaultCampaigns } from "../src/jobs/campaigns.ts";
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

describe("dashboard redesign", () => {
  beforeEach(() => {
    clearSessions();
    resetConfigCache();
    process.env.NODE_ENV = "staging";
    process.env.DASHBOARD_FIXTURE_LOGIN = "true";
    process.env.DRY_RUN = "true";
    loadConfig();
  });

  it("renders dark theme and sidebar navigation", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const overview = await app.inject({ method: "GET", url: "/dashboard", headers: { cookie } });
    expect(overview.statusCode).toBe(200);
    expect(overview.body).toContain("ARC HUNTER");
    expect(overview.body).toContain("Anchor Tenant Intelligence");
    expect(overview.body).toContain("sidebar");
    expect(overview.body).toContain("nav-link");
    expect(overview.body).toContain("--bg-obsidian");
    expect(overview.body).toContain("Mission Control");

    await app.close();
  });

  it("shows stat cards on overview page", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const overview = await app.inject({ method: "GET", url: "/dashboard", headers: { cookie } });
    expect(overview.body).toContain("Leads Discovered");
    expect(overview.body).toContain("Qualified");
    expect(overview.body).toContain("Drafts Pending");
    expect(overview.body).toContain("Emails Sent");
    expect(overview.body).toContain("Replies Received");
    expect(overview.body).toContain("AI Budget Used");
    expect(overview.body).toContain("stat-card");
    expect(overview.body).toContain("stats-grid");

    await app.close();
  });

  it("shows hunter cards with icons and status badges", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const overview = await app.inject({ method: "GET", url: "/dashboard", headers: { cookie } });
    expect(overview.body).toContain("hunter-card");
    expect(overview.body).toContain("hunter-icon");
    expect(overview.body).toContain("badge");
    expect(overview.body).toContain("broker");
    expect(overview.body).toContain("tenant");

    await app.close();
  });

  it("shows control panel with confirmation prompts", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const overview = await app.inject({ method: "GET", url: "/dashboard", headers: { cookie } });
    expect(overview.body).toContain("control-panel");
    expect(overview.body).toContain("Discovery Controls");
    expect(overview.body).toContain("Outbound Controls");
    expect(overview.body).toContain('onsubmit="return confirm');

    await app.close();
  });

  it("shows campaign cards with proper form sections", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const searches = await app.inject({
      method: "GET",
      url: "/dashboard/searches",
      headers: { cookie },
    });
    expect(searches.statusCode).toBe(200);
    expect(searches.body).toContain("Search Campaigns");
    expect(searches.body).toContain("campaign-card");
    expect(searches.body).toContain("campaign-section");
    expect(searches.body).toContain("Seed Domains");
    expect(searches.body).toContain("Search Terms");
    expect(searches.body).toContain("Daily Caps");

    await app.close();
  });

  it("shows filter bar and styled table on leads page", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.statusCode).toBe(200);
    expect(leads.body).toContain("Leads & Activity");
    expect(leads.body).toContain("filter-bar");
    expect(leads.body).toContain("Search by name or company");

    await app.close();
  });

  it("shows empty state when no leads exist", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const leads = await app.inject({ method: "GET", url: "/dashboard/leads", headers: { cookie } });
    expect(leads.body).toContain("empty-state");
    expect(leads.body).toContain("No leads found");

    await app.close();
  });

  it("hides raw metrics in developer details", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);

    const overview = await app.inject({ method: "GET", url: "/dashboard", headers: { cookie } });
    expect(overview.body).toContain("dev-details");
    expect(overview.body).toContain("Developer Details");
    expect(overview.body).toContain("<details");

    await app.close();
  });
});
