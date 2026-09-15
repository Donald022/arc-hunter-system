import { describe, expect, it } from "vitest";
import { useTestStore } from "./helpers.ts";
import { seedDefaultCampaigns } from "../src/jobs/campaigns.ts";
import { discover } from "../src/jobs/discover.ts";
import { research } from "../src/jobs/research.ts";
import { HUNTERS } from "../src/domain/types.ts";

describe("five-hunter pipeline", () => {
  it("produces evidence-backed candidates from all five hunters and bins them", async () => {
    const store = useTestStore();
    await seedDefaultCampaigns(store);
    const found = await discover({ dryRun: false, store });
    expect(found.hunters.sort()).toEqual([...HUNTERS].sort());
    expect(found.candidates).toBeGreaterThanOrEqual(5);
    const researched = await research({ store });
    const contacts = await store.contacts.list();
    const va = contacts.find((c) => c.name === "Alex Rivera");
    const mx = contacts.find((c) => c.name === "Jordan Lee");
    expect(va?.fit_score ?? 0).toBeGreaterThanOrEqual(70);
    expect(["QUALIFIED", "QUALIFIED_NO_EMAIL"]).toContain(va?.state);
    expect(mx?.state).toBe("DISQUALIFIED");
    expect(researched.disqualified).toBeGreaterThanOrEqual(1);
    expect(researched.qualified).toBeGreaterThanOrEqual(1);
  });
});
