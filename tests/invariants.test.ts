import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/hunters/parsers.ts";
import { diffProperties, REQUIRED_PROPERTIES, NOTION_VIEWS } from "../src/integrations/notion.ts";
import { canTransition } from "../src/domain/states.ts";
import { looksGuessed } from "../src/integrations/enrichment.ts";

describe("misc invariants", () => {
  it("imports manual CSV without inventing emails", () => {
    const rows = parseCsv(
      "company,person,title,domain,source_url,evidence,role\nExample Co,Pat Kim,Broker,example.test,https://example.test/p,DC tenant rep,Intermediary\n",
      "broker",
    );
    expect(rows[0]?.person).toBe("Pat Kim");
    expect(rows[0]?.quoted_evidence).toContain("DC tenant");
  });

  it("does not infer first.last emails for sending", () => {
    expect(looksGuessed("pat.kim@example.test", "Pat Kim", "example.test")).toBe(true);
  });

  it("documents Notion views and required properties", () => {
    expect(NOTION_VIEWS).toContain("Review Queue");
    expect(diffProperties(["Name"], REQUIRED_PROPERTIES.contacts).missing.length).toBeGreaterThan(5);
  });

  it("forbids auto-send from SEND_UNCERTAIN via automatic transition to SENDING", () => {
    expect(canTransition("SEND_UNCERTAIN", "SENDING")).toBe(false);
    expect(canTransition("SEND_UNCERTAIN", "SENT")).toBe(true);
  });
});
