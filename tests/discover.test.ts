import { describe, expect, it } from "vitest";
import { useTestStore } from "./helpers.ts";
import { seedDefaultCampaigns } from "../src/jobs/campaigns.ts";
import { discover } from "../src/jobs/discover.ts";
import { parseSource } from "../src/hunters/parsers.ts";
import { isSsrfSafeUrl } from "../src/hunters/parsers.ts";

describe("discovery and dedupe", () => {
  it("collapses duplicate fixture source records into one contact", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    await discover({ hunter: "broker", dryRun: false, store });
    const people = (await store.contacts.list()).filter((c) => c.name === "Alex Rivera");
    expect(people).toHaveLength(1);
    const signals = (await store.signals.list()).filter((s) => s.person === "Alex Rivera");
    expect(signals.length).toBeGreaterThanOrEqual(1);
  });

  it("does not fabricate leads when a source is blocked or down", async () => {
    const result = await parseSource({
      id: "down",
      hunter: "expansion",
      parser: "rss",
      enabled: true,
      cadence: "daily",
      url: "https://127.0.0.1/does-not-exist.xml",
    });
    expect(result.signals).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it("rejects private-network source URLs", () => {
    expect(isSsrfSafeUrl("https://169.254.169.254/latest").ok).toBe(false);
    expect(isSsrfSafeUrl("http://10.0.0.5/feed").ok).toBe(false);
    expect(isSsrfSafeUrl("https://www.example.com/feed").ok).toBe(true);
  });
});
