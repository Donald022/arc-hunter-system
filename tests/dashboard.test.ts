import { describe, expect, it, beforeEach } from "vitest";
import { buildApp } from "../src/app.ts";
import { useTestStore } from "./helpers.ts";
import { seedDefaultCampaigns } from "../src/jobs/campaigns.ts";
import { setPaused } from "../src/jobs/controls.ts";
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

describe("dashboard and pause controls", () => {
  beforeEach(() => {
    clearSessions();
    resetConfigCache();
    process.env.NODE_ENV = "development";
    process.env.DASHBOARD_FIXTURE_LOGIN = "true";
    process.env.DRY_RUN = "true";
    loadConfig();
  });

  it("rejects unauthorized and CSRF-invalid mutations", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const unauth = await app.inject({ method: "POST", url: "/dashboard/pause", payload: { which: "discovery", paused: "true" } });
    expect([302, 401, 403]).toContain(unauth.statusCode);

    const cookie = await login(app);
    const csrf = await app.inject({ method: "POST", url: "/dashboard/pause", headers: { cookie }, payload: { which: "discovery", paused: "true", _csrf: "nope" } });
    expect(csrf.statusCode).toBe(403);
    await app.close();
  });

  it("does not fetch or partially save unsupported source URLs", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const app = await buildApp();
    const cookie = await login(app);
    const page = await app.inject({ method: "GET", url: "/dashboard/searches", headers: { cookie } });
    const csrf = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    const before = await store.campaigns.get("camp-broker");
    const res = await app.inject({
      method: "POST",
      url: "/dashboard/campaigns/camp-broker",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        _csrf: csrf ?? "",
        enabled: "true",
        seed_domains: "cbre.com",
        search_terms: "data center",
        region_boost: "bonus",
        daily_research_cap: "20",
        daily_send_cap: "5",
        source_urls: "https://evil.example/not-in-registry",
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    const after = await store.campaigns.get("camp-broker");
    expect(after?.source_urls).toEqual(before?.source_urls);
    await app.close();
  });

  it("applies an edited campaign to the next eligible hunt and honors pause", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const broker = await store.campaigns.get("camp-broker");
    await store.campaigns.upsert({ ...broker!, enabled: false, search_terms: ["only-this-term"] });
    await discover({ hunter: "broker", dryRun: false, store });
    expect((await store.contacts.list()).filter((c) => c.hunter_tags.includes("broker"))).toHaveLength(0);

    await store.campaigns.upsert({ ...broker!, enabled: true, search_terms: ["only-this-term"] });
    await setPaused("discovery", true, "test", store);
    await expect(discover({ hunter: "broker", dryRun: false, store })).rejects.toThrow(/discovery_paused/);

    await setPaused("outbound", true, "test", store);
    const pause = await store.pause.get();
    expect(pause.outbound_paused).toBe(true);
  });
});
