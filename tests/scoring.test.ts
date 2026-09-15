import { describe, expect, it } from "vitest";
import { researchFromEvidence } from "../src/domain/validateResearch.ts";
import { SCORE_CAPS } from "../src/domain/scoring.ts";

describe("scoring", () => {
  it("qualifies a Northern Virginia tenant-rep with hyperscale leases and no Mexico history", () => {
    const result = researchFromEvidence(
      {
        dcSpecialty: { points: 25, reason: "official DC practice bio", url: "https://example.test/bio" },
        buyerOrTenant: { points: 25, reason: "occupier representation", url: "https://example.test/bio" },
        hyperscale: { points: 15, reason: "30MW+ assignments", url: "https://example.test/deals" },
        expansion: { points: 8, reason: "recent lease", url: "https://example.test/deals" },
        influence: { points: 8, reason: "MD" },
        geo: { kind: "none" },
        personalization: { points: 4, reason: "named transactions", url: "https://example.test/deals" },
      },
      {
        hasDcDemandOrOccupier: true,
        hasSiteOrPowerInfra: true,
        hasRelevantExpansionOrDeal: true,
        hasIntroPath: true,
      },
    );
    expect(result.score.hard_gate_pass).toBe(true);
    expect(result.score.geo_bonus).toBe(0);
    expect(result.score.total).toBeGreaterThanOrEqual(70);
    expect(result.score.total).toBeLessThanOrEqual(90);
    expect(result.bin).toBe("qualified");
    expect(result.score.dc_specialty).toBeLessThanOrEqual(SCORE_CAPS.dc_specialty);
  });

  it("fails the hard gate for a Mexico-based generic real-estate agent", () => {
    const result = researchFromEvidence(
      { geo: { kind: "mexico", reason: "based in Mexico City" } },
      {
        hasDcDemandOrOccupier: false,
        hasSiteOrPowerInfra: false,
        hasRelevantExpansionOrDeal: false,
        hasIntroPath: false,
        genericCreOnly: true,
      },
    );
    expect(result.score.hard_gate_pass).toBe(false);
    expect(result.bin).toBe("disqualify");
    expect(result.score.reason_codes).toContain("generic_cre");
  });
});
