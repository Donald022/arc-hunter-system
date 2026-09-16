import { describe, expect, it } from "vitest";
import {
  buildFactsFromNotionRows,
  selectClaimsPerRow,
  validateRecordModelConfig,
  validateClaimPerRowSchema,
  CLAIM_PER_ROW_REQUIRED_PROPERTIES,
  type RawNotionFactRow,
} from "../src/domain/notionFacts.ts";
import { hashFacts } from "../src/domain/facts.ts";

function rt(text: string) {
  return { type: "rich_text", rich_text: [{ plain_text: text }] };
}
function title(text: string) {
  return { type: "title", title: [{ plain_text: text }] };
}
function email(text: string) {
  return { type: "email", email: text };
}
function checkbox(v: boolean) {
  return { type: "checkbox", checkbox: v };
}
function date(iso: string) {
  return { type: "date", date: { start: iso } };
}

interface RowInput {
  id: string;
  name: string;
  approvedWording: string;
  canUseInFirstTouch: boolean;
  approvedBy: string;
  approvedAt: string;
  legalSenderEntity?: string;
  approvedSenderNameTitle?: string;
  replyTo?: string;
  postalAddress?: string;
  optOutInstructions?: string;
  siteLocationDisclosure?: string;
}

const COMPLIANCE_DEFAULTS = {
  legalSenderEntity: "ARC MX I LLC",
  approvedSenderNameTitle: "Donald / ARC Outreach",
  replyTo: "outreach@arc-hunter-test.com",
  postalAddress: "123 Example Street, Example City, ST 00000",
  optOutInstructions: "Reply STOP to opt out.",
  siteLocationDisclosure: "",
};

function row(input: RowInput): RawNotionFactRow {
  const c = { ...COMPLIANCE_DEFAULTS, ...input };
  return {
    id: input.id,
    properties: {
      Name: title(c.name),
      approved_wording: rt(c.approvedWording),
      can_use_in_first_touch: checkbox(c.canUseInFirstTouch),
      approved_by: rt(c.approvedBy),
      approved_at: date(c.approvedAt),
      legal_sender_entity: rt(c.legalSenderEntity),
      approved_sender_name_title: rt(c.approvedSenderNameTitle),
      reply_to: email(c.replyTo),
      postal_address: rt(c.postalAddress),
      opt_out_instructions: rt(c.optOutInstructions),
      site_location_disclosure: rt(c.siteLocationDisclosure),
    },
  };
}

const NOW = new Date("2026-09-15T00:00:00.000Z");
const CLAIM_PER_ROW = { recordModel: "claim_per_row" };

// The observed live production schema — 11 properties, used across contract tests.
const LIVE_SCHEMA_PROPERTY_NAMES = [
  "Name",
  "legal_sender_entity",
  "approved_sender_name_title",
  "reply_to",
  "postal_address",
  "opt_out_instructions",
  "site_location_disclosure",
  "approved_wording",
  "can_use_in_first_touch",
  "approved_by",
  "approved_at",
];

describe("NOTION_FACTS_RECORD_MODEL — explicit contract, never inferred from data", () => {
  it("fails closed when the record model is not configured (missing)", () => {
    const result = validateRecordModelConfig(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("notion_facts_record_model_not_configured");
  });

  it("fails closed when the record model is an empty string", () => {
    const result = validateRecordModelConfig("   ");
    expect(result.ok).toBe(false);
  });

  it("fails closed on an unknown/unsupported record model value", () => {
    const result = validateRecordModelConfig("bundle_per_row");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("notion_facts_record_model_unsupported");
  });

  it("accepts the only currently-supported value", () => {
    const result = validateRecordModelConfig("claim_per_row");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe("claim_per_row");
  });

  it("buildFactsFromNotionRows fails closed when recordModel is missing, even with valid rows", () => {
    const rows = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const result = buildFactsFromNotionRows(rows, { recordModel: undefined }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("notion_facts_record_model_not_configured");
  });

  it("buildFactsFromNotionRows fails closed on an unsupported configured value", () => {
    const rows = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const result = buildFactsFromNotionRows(rows, { recordModel: "bundle_per_row" }, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("notion_facts_record_model_unsupported");
  });

  it("does not attempt to infer a bundle model from an empty database — fails closed with 'no_rows'", () => {
    const result = buildFactsFromNotionRows([], CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_rows");
  });
});

describe("claim_per_row schema validation (works independent of row count)", () => {
  it("passes for the observed live production schema", () => {
    const result = validateClaimPerRowSchema(LIVE_SCHEMA_PROPERTY_NAMES);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("is case-insensitive on property names", () => {
    const result = validateClaimPerRowSchema(
      LIVE_SCHEMA_PROPERTY_NAMES.map((n) => n.toUpperCase()),
    );
    expect(result.ok).toBe(true);
  });

  it("fails and lists missing properties when the schema doesn't support the contract", () => {
    const result = validateClaimPerRowSchema(["Name", "approved_wording"]);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("can_use_in_first_touch");
    expect(result.missing).toContain("approved_by");
    expect(result.missing).toContain("approved_at");
  });

  it("every required property is part of the documented contract constant", () => {
    expect(CLAIM_PER_ROW_REQUIRED_PROPERTIES).toEqual([
      "approved_wording",
      "can_use_in_first_touch",
      "approved_by",
      "approved_at",
    ]);
  });

  it("buildFactsFromNotionRows fails closed when the configured database's schema doesn't support claim_per_row", () => {
    const rows = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const result = buildFactsFromNotionRows(
      rows,
      { recordModel: "claim_per_row", propertyNames: ["Name", "approved_wording"] },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("schema_missing_required_properties");
  });

  it("buildFactsFromNotionRows proceeds when the schema supports the contract", () => {
    const rows = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const result = buildFactsFromNotionRows(
      rows,
      { recordModel: "claim_per_row", propertyNames: LIVE_SCHEMA_PROPERTY_NAMES },
      NOW,
    );
    expect(result.ok).toBe(true);
  });
});

describe("Notion Approved Facts — claim-per-row selection", () => {
  it("loads multiple approved claims together", () => {
    const rows = [
      row({
        id: "r1",
        name: "Mexico Intro",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
      row({
        id: "r2",
        name: "Utility Status",
        approvedWording: "Wording B",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-02T00:00:00.000Z",
      }),
    ];
    const result = buildFactsFromNotionRows(rows, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.facts).toHaveLength(2);
      const wordings = result.bundle.facts.map((f) => f.approved_wording).sort();
      expect(wordings).toEqual(["Wording A", "Wording B"]);
    }
  });

  it("selects the newest valid version per claim, grouped by Name (duplicate Name = versions of the same claim)", () => {
    const rows = [
      row({
        id: "r1",
        name: "Mexico Intro",
        approvedWording: "Old wording",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-08-01T00:00:00.000Z",
      }),
      row({
        id: "r2",
        name: "Mexico Intro",
        approvedWording: "New wording",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const result = buildFactsFromNotionRows(rows, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.facts).toHaveLength(1);
      expect(result.bundle.facts[0]?.approved_wording).toBe("New wording");
    }
  });

  it("updating one claim does not remove unrelated approved claims", () => {
    const rows = [
      row({
        id: "r1",
        name: "Mexico Intro",
        approvedWording: "Mexico wording v1",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-08-01T00:00:00.000Z",
      }),
      row({
        id: "r2",
        name: "Utility Status",
        approvedWording: "Utility wording",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-08-15T00:00:00.000Z",
      }),
    ];
    const v2 = [
      rows[0]!,
      row({
        id: "r3",
        name: "Mexico Intro",
        approvedWording: "Mexico wording v2",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
      rows[1]!,
    ];
    const result = buildFactsFromNotionRows(v2, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle.facts).toHaveLength(2);
      const mexico = result.bundle.facts.find((f) => f.approved_wording.startsWith("Mexico"));
      const utility = result.bundle.facts.find((f) => f.approved_wording.startsWith("Utility"));
      expect(mexico?.approved_wording).toBe("Mexico wording v2");
      expect(utility?.approved_wording).toBe("Utility wording");
    }
  });

  it("excludes expired facts", () => {
    const rows = [
      row({
        id: "r1",
        name: "Expired claim",
        approvedWording: "Should not appear",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    rows[0]!.properties.valid_until = date("2026-02-01T00:00:00.000Z");
    const result = buildFactsFromNotionRows(rows, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_valid_facts");
  });

  it("excludes revoked/restricted facts by status", () => {
    const rows = [
      row({
        id: "r1",
        name: "Revoked claim",
        approvedWording: "Should not appear",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    rows[0]!.properties.status = { type: "select", select: { name: "Revoked" } };
    const result = buildFactsFromNotionRows(rows, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_valid_facts");
  });

  it("excludes rows with missing approval metadata (no approved_by / no approved_at)", () => {
    const rows = [
      row({
        id: "r1",
        name: "Unapproved",
        approvedWording: "Should not appear",
        canUseInFirstTouch: true,
        approvedBy: "",
        approvedAt: "",
      }),
    ];
    const result = buildFactsFromNotionRows(rows, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_valid_facts");
  });

  it("fails closed on an empty selected fact set (nothing marked first-touch)", () => {
    const rows = [
      row({
        id: "r1",
        name: "Not first touch",
        approvedWording: "Some wording",
        canUseInFirstTouch: false,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const result = buildFactsFromNotionRows(rows, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_valid_facts");
  });

  it("fails closed when compliance fields disagree across selected rows", () => {
    const rows = [
      row({
        id: "r1",
        name: "Claim A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
        legalSenderEntity: "ARC MX I LLC",
      }),
      row({
        id: "r2",
        name: "Claim B",
        approvedWording: "Wording B",
        canUseInFirstTouch: true,
        approvedBy: "Donald",
        approvedAt: "2026-09-01T00:00:00.000Z",
        legalSenderEntity: "A Different Legal Entity",
      }),
    ];
    const result = buildFactsFromNotionRows(rows, CLAIM_PER_ROW, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("inconsistent_compliance_fields");
  });
});

describe("hashFacts determinism", () => {
  it("is unaffected by database row ordering", () => {
    const rowsA = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "D",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
      row({
        id: "r2",
        name: "B",
        approvedWording: "Wording B",
        canUseInFirstTouch: true,
        approvedBy: "D",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const rowsB = [rowsA[1]!, rowsA[0]!];
    const resultA = buildFactsFromNotionRows(rowsA, CLAIM_PER_ROW, NOW);
    const resultB = buildFactsFromNotionRows(rowsB, CLAIM_PER_ROW, NOW);
    expect(resultA.ok && resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      expect(resultA.bundle.version_hash).toBe(resultB.bundle.version_hash);
    }
  });

  it("changes when wording changes", () => {
    const base = row({
      id: "r1",
      name: "A",
      approvedWording: "Original",
      canUseInFirstTouch: true,
      approvedBy: "D",
      approvedAt: "2026-09-01T00:00:00.000Z",
    });
    const changed = row({
      id: "r1",
      name: "A",
      approvedWording: "Changed",
      canUseInFirstTouch: true,
      approvedBy: "D",
      approvedAt: "2026-09-02T00:00:00.000Z",
    });
    const a = buildFactsFromNotionRows([base], CLAIM_PER_ROW, NOW);
    const b = buildFactsFromNotionRows([changed], CLAIM_PER_ROW, NOW);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.bundle.version_hash).not.toBe(b.bundle.version_hash);
  });

  it("changes when a claim is added or removed", () => {
    const one = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "D",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const two = [
      ...one,
      row({
        id: "r2",
        name: "B",
        approvedWording: "Wording B",
        canUseInFirstTouch: true,
        approvedBy: "D",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const a = buildFactsFromNotionRows(one, CLAIM_PER_ROW, NOW);
    const b = buildFactsFromNotionRows(two, CLAIM_PER_ROW, NOW);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.bundle.version_hash).not.toBe(b.bundle.version_hash);
  });

  it("changes when a fact is revoked (can_use_in_first_touch flips) even if another claim keeps it valid", () => {
    const rowsBefore = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: true,
        approvedBy: "D",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
      row({
        id: "r2",
        name: "B",
        approvedWording: "Wording B",
        canUseInFirstTouch: true,
        approvedBy: "D",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
    ];
    const rowsAfter = [
      row({
        id: "r1",
        name: "A",
        approvedWording: "Wording A",
        canUseInFirstTouch: false,
        approvedBy: "D",
        approvedAt: "2026-09-01T00:00:00.000Z",
      }),
      rowsBefore[1]!,
    ];
    const before = buildFactsFromNotionRows(rowsBefore, CLAIM_PER_ROW, NOW);
    const after = buildFactsFromNotionRows(rowsAfter, CLAIM_PER_ROW, NOW);
    expect(before.ok && after.ok).toBe(true);
    if (before.ok && after.ok)
      expect(before.bundle.version_hash).not.toBe(after.bundle.version_hash);
  });

  it("hashFacts itself sorts facts by id so array order never matters", () => {
    const base = {
      legal_sender_entity: "L",
      approved_sender_name_title: "S",
      reply_to: "r@x.com",
      postal_address: "P",
      opt_out_instructions: "O",
    };
    const f1 = {
      id: "a",
      claim: "",
      basis: "",
      evidence_url_or_document: "",
      approved_wording: "w1",
      approved_by: "d",
      approved_at: "2026-09-01T00:00:00.000Z",
      valid_until: "",
      can_use_in_first_touch: true,
    };
    const f2 = {
      id: "b",
      claim: "",
      basis: "",
      evidence_url_or_document: "",
      approved_wording: "w2",
      approved_by: "d",
      approved_at: "2026-09-01T00:00:00.000Z",
      valid_until: "",
      can_use_in_first_touch: true,
    };
    const h1 = hashFacts({
      ...base,
      utility_mw_current_verified: "",
      utility_mw_target: "",
      it_mw_planned: "",
      land_control_status: "",
      site_location_disclosure: "",
      target_rfs_status: "",
      restricted_claims: [],
      facts: [f1, f2],
    });
    const h2 = hashFacts({
      ...base,
      utility_mw_current_verified: "",
      utility_mw_target: "",
      it_mw_planned: "",
      land_control_status: "",
      site_location_disclosure: "",
      target_rfs_status: "",
      restricted_claims: [],
      facts: [f2, f1],
    });
    expect(h1).toBe(h2);
  });
});

describe("selectClaimsPerRow low-level behavior", () => {
  it("reports excluded rows with a reason", () => {
    const { claims, excluded } = selectClaimsPerRow(
      [
        {
          rowId: "r1",
          title: "A",
          approvedWording: "Wording A",
          canUseInFirstTouch: false,
          approvedBy: "D",
          approvedAt: "2026-09-01T00:00:00.000Z",
          legalSenderEntity: "",
          approvedSenderNameTitle: "",
          replyTo: "",
          postalAddress: "",
          optOutInstructions: "",
          siteLocationDisclosure: "",
          claimKey: "",
          status: "",
          validUntil: "",
          category: "",
          disclosureLevel: "",
          evidenceRefs: [],
        },
      ],
      NOW,
    );
    expect(claims).toHaveLength(0);
    expect(excluded[0]?.reason).toBe("not_marked_first_touch");
  });
});
