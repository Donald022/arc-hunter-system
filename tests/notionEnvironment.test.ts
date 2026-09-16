import { describe, expect, it } from "vitest";
import {
  classifyNotionEnvironment,
  classifyStagingIdentity,
  classifyProductionIdentity,
  assertStagingWriteAllowed,
  assertProductionWriteAllowed,
  checkNotionEnvironmentAtStartup,
  notionDashboardSummary,
  NotionEnvironmentError,
  normalizeNotionId,
  type NotionParentIdentity,
} from "../src/integrations/notionEnvironment.ts";

const PRODUCTION_ID = "ad8f51e2e685405db975ef09d24f5dc5";
const STAGING_ID = "11112222333344445555666677778888";

function stagingCfg(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    NOTION_ENVIRONMENT: "staging" as const,
    NOTION_EXPECTED_PARENT_PAGE_ID: STAGING_ID,
    NOTION_PARENT_PAGE_ID: PRODUCTION_ID,
    NOTION_WRITES_ENABLED: false,
    ...overrides,
  };
}

function productionCfg(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    NOTION_ENVIRONMENT: "production" as const,
    NOTION_EXPECTED_PARENT_PAGE_ID: STAGING_ID,
    NOTION_PARENT_PAGE_ID: PRODUCTION_ID,
    NOTION_WRITES_ENABLED: false,
    ...overrides,
  };
}

const stagingParent: NotionParentIdentity = { id: STAGING_ID, title: "[STAGING] ARC Hunter" };
const productionParent: NotionParentIdentity = { id: PRODUCTION_ID, title: "03 — Anchor Tenant" };

describe("classifyStagingIdentity (identity only — no NOTION_ENVIRONMENT dependency)", () => {
  it("accepts the correct staging parent with the [STAGING] marker", () => {
    const result = classifyStagingIdentity(stagingCfg(), stagingParent);
    expect(result.ok).toBe(true);
  });

  it("rejects the production parent id even without checking the title", () => {
    const result = classifyStagingIdentity(stagingCfg(), {
      id: PRODUCTION_ID,
      title: "Some Renamed Title",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects the known production title even if somehow given the staging id", () => {
    const result = classifyStagingIdentity(stagingCfg(), {
      id: STAGING_ID,
      title: "03 — Anchor Tenant",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("production_parent_rejected");
  });

  it("blocks when the [STAGING] marker is missing, even if the id matches expected", () => {
    const result = classifyStagingIdentity(stagingCfg(), {
      id: STAGING_ID,
      title: "ARC Hunter Staging Area",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_staging_marker");
  });

  it("blocks on incorrect ancestry (id does not match the configured staging parent)", () => {
    const result = classifyStagingIdentity(stagingCfg(), {
      id: "99990000111122223333444455556666",
      title: "[STAGING] Some Other Page",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parent_ancestry_mismatch");
  });

  it("fails closed when NOTION_EXPECTED_PARENT_PAGE_ID is not configured", () => {
    const result = classifyStagingIdentity(
      stagingCfg({ NOTION_EXPECTED_PARENT_PAGE_ID: undefined }),
      stagingParent,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_expected_staging_parent");
  });

  it("titles alone are not sufficient — a matching marker with the wrong id is still rejected", () => {
    const result = classifyStagingIdentity(stagingCfg(), {
      id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "[STAGING] ARC Hunter",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parent_ancestry_mismatch");
  });

  it("does not read or require NOTION_ENVIRONMENT at all — identity is independent of the ambient mode label", () => {
    // A config object with no NOTION_ENVIRONMENT key still classifies correctly,
    // proving this identity check can never accidentally require "production" (or
    // any other ambient value) for staging setup.
    const cfgWithoutEnvironmentField = {
      NOTION_EXPECTED_PARENT_PAGE_ID: STAGING_ID,
      NOTION_PARENT_PAGE_ID: PRODUCTION_ID,
    };
    const result = classifyStagingIdentity(cfgWithoutEnvironmentField, stagingParent);
    expect(result.ok).toBe(true);
  });
});

describe("classifyProductionIdentity (identity only — no NOTION_ENVIRONMENT dependency)", () => {
  it("accepts a clean production parent matching the configured production ancestry", () => {
    const result = classifyProductionIdentity(productionCfg(), productionParent);
    expect(result.ok).toBe(true);
  });

  it("rejects any [STAGING]-marked resource", () => {
    const result = classifyProductionIdentity(productionCfg(), stagingParent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("staging_resource_rejected");
  });

  it("rejects the configured staging resource id even without the marker", () => {
    const result = classifyProductionIdentity(productionCfg(), {
      id: STAGING_ID,
      title: "Renamed without marker",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("staging_resource_rejected");
  });

  it("verifies ancestry against the expected production parent — a clean, non-staging parent at the wrong id is still rejected", () => {
    const result = classifyProductionIdentity(productionCfg(), {
      id: "77778888999900001111222233334444",
      title: "Some Other Clean Page",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parent_ancestry_mismatch");
  });

  it("fails closed when no expected production parent is configured", () => {
    const result = classifyProductionIdentity(
      productionCfg({ NOTION_PARENT_PAGE_ID: undefined }),
      productionParent,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_expected_production_parent");
  });
});

describe("classifyNotionEnvironment (status dispatcher, ambient-mode aware — for display only)", () => {
  it("dispatches to staging rules when NOTION_ENVIRONMENT=staging", () => {
    expect(classifyNotionEnvironment(stagingCfg(), stagingParent).ok).toBe(true);
  });

  it("dispatches to production rules when NOTION_ENVIRONMENT=production", () => {
    expect(classifyNotionEnvironment(productionCfg(), productionParent).ok).toBe(true);
  });

  it("fails closed on an ambiguous/unknown NOTION_ENVIRONMENT value", () => {
    const result = classifyNotionEnvironment(
      {
        NOTION_ENVIRONMENT: "unknown" as never,
        NOTION_EXPECTED_PARENT_PAGE_ID: STAGING_ID,
        NOTION_PARENT_PAGE_ID: PRODUCTION_ID,
      },
      stagingParent,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ambiguous_notion_environment");
  });
});

describe("assertStagingWriteAllowed — the staging setup tool's write gate", () => {
  it("staging apply rejects NOTION_ENVIRONMENT=production even with a verified staging parent and writes enabled", () => {
    expect(() =>
      assertStagingWriteAllowed(
        productionCfg({ NOTION_WRITES_ENABLED: true, NOTION_EXPECTED_PARENT_PAGE_ID: STAGING_ID }),
        stagingParent,
      ),
    ).toThrow(/staging_write_requires_staging_environment/);
  });

  it("staging apply rejects a writes-disabled configuration even with a verified staging parent", () => {
    expect(() =>
      assertStagingWriteAllowed(stagingCfg({ NOTION_WRITES_ENABLED: false }), stagingParent),
    ).toThrow(/notion_writes_disabled/);
  });

  it("staging apply rejects the production parent", () => {
    expect(() =>
      assertStagingWriteAllowed(stagingCfg({ NOTION_WRITES_ENABLED: true }), productionParent),
    ).toThrow(NotionEnvironmentError);
  });

  it("staging apply accepts a mocked verified staging parent when environment=staging and writes are enabled", () => {
    expect(() =>
      assertStagingWriteAllowed(stagingCfg({ NOTION_WRITES_ENABLED: true }), stagingParent),
    ).not.toThrow();
  });

  it("never leaks an id or title in the thrown error message", () => {
    try {
      assertStagingWriteAllowed(stagingCfg({ NOTION_WRITES_ENABLED: true }), productionParent);
      throw new Error("expected throw");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(PRODUCTION_ID);
      expect(message).not.toContain("Anchor Tenant");
    }
  });
});

describe("assertProductionWriteAllowed — the production sync write gate", () => {
  it("production sync rejects NOTION_ENVIRONMENT=staging even with a verified production parent and writes enabled", () => {
    expect(() =>
      assertProductionWriteAllowed(
        stagingCfg({ NOTION_WRITES_ENABLED: true, NOTION_PARENT_PAGE_ID: PRODUCTION_ID }),
        productionParent,
      ),
    ).toThrow(/production_write_requires_production_environment/);
  });

  it("production sync rejects a writes-disabled configuration", () => {
    expect(() =>
      assertProductionWriteAllowed(
        productionCfg({ NOTION_WRITES_ENABLED: false }),
        productionParent,
      ),
    ).toThrow(/notion_writes_disabled/);
  });

  it("production sync rejects a [STAGING]-marked resource", () => {
    expect(() =>
      assertProductionWriteAllowed(productionCfg({ NOTION_WRITES_ENABLED: true }), stagingParent),
    ).toThrow(NotionEnvironmentError);
  });

  it("production sync accepts a verified production parent when environment=production and writes are enabled", () => {
    expect(() =>
      assertProductionWriteAllowed(
        productionCfg({ NOTION_WRITES_ENABLED: true }),
        productionParent,
      ),
    ).not.toThrow();
  });
});

describe("no shared helper accidentally requires production for staging setup", () => {
  it("classifyStagingIdentity's required config type has no NOTION_ENVIRONMENT field to accidentally depend on", () => {
    // Structural proof: calling it with a plain object that has only the two
    // ancestry-related keys (no NOTION_ENVIRONMENT at all) type-checks and behaves
    // identically to passing the full AppConfig-shaped staging config.
    const minimal = {
      NOTION_EXPECTED_PARENT_PAGE_ID: STAGING_ID,
      NOTION_PARENT_PAGE_ID: PRODUCTION_ID,
    };
    expect(classifyStagingIdentity(minimal, stagingParent).ok).toBe(true);
  });

  it("assertStagingWriteAllowed and assertProductionWriteAllowed are distinct functions with independent environment checks", () => {
    expect(assertStagingWriteAllowed).not.toBe(assertProductionWriteAllowed);
  });
});

describe("checkNotionEnvironmentAtStartup", () => {
  it("allows startup with writes disabled regardless of identity (reads always available)", () => {
    const result = checkNotionEnvironmentAtStartup(
      stagingCfg({ NOTION_WRITES_ENABLED: false }),
      productionParent,
    );
    expect(result.ok).toBe(true);
  });

  it("validates identity at startup when writes are enabled", () => {
    const result = checkNotionEnvironmentAtStartup(
      stagingCfg({ NOTION_WRITES_ENABLED: true }),
      productionParent,
    );
    expect(result.ok).toBe(false);
  });
});

describe("notionDashboardSummary", () => {
  it("never includes a token, only booleans/strings describing state", () => {
    const summary = notionDashboardSummary({
      NOTION_ENVIRONMENT: "staging",
      NOTION_WRITES_ENABLED: false,
      NOTION_TOKEN: "ntn_should_never_appear_in_output",
    });
    expect(JSON.stringify(summary)).not.toContain("ntn_should_never_appear_in_output");
    expect(summary).toEqual({ environment: "staging", connected: true, writesEnabled: false });
  });
});

describe("normalizeNotionId", () => {
  it("strips dashes and lowercases for comparison", () => {
    expect(normalizeNotionId("AD8F51E2-E685-405D-B975-EF09D24F5DC5")).toBe(
      normalizeNotionId(PRODUCTION_ID),
    );
  });
});
