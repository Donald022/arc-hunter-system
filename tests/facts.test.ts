import { describe, expect, it } from "vitest";
import { containsRestrictedClaim, loadFactsFromFile, validateArcClaims } from "../src/domain/facts.ts";
import { isApprovalValid, approvalHash } from "../src/jobs/draft.ts";
import { approvedFacts } from "./helpers.ts";
import { resetFactsCache } from "../src/jobs/factsLoader.ts";

describe("approved facts", () => {
  it("loads example facts with first-touch disabled by default", () => {
    resetFactsCache();
    const facts = loadFactsFromFile();
    expect(facts.legal_sender_entity).toBe("");
    expect(facts.facts.every((f) => f.can_use_in_first_touch === false || !f.approved_by)).toBe(true);
    expect(facts.facts[0]?.can_use_in_first_touch).toBe(false);
  });

  it("rejects an unsupported ARC power claim", () => {
    const facts = approvedFacts();
    const body = "We have 75 MW secured and available for IT on a shovel ready campus.";
    const hits = containsRestrictedClaim(body, facts);
    expect(hits.length).toBeGreaterThan(0);
    const check = validateArcClaims(["not-a-real-id"], body, facts);
    expect(check.ok).toBe(false);
  });

  it("invalidates approval when the fact version changes", () => {
    const facts = approvedFacts();
    const draft = {
      id: "dr_1",
      contact_id: "ct_1",
      version: 1,
      subject: "Mexico data-center opportunity",
      body: facts.facts[0]!.approved_wording,
      body_hash: "x",
      fact_version_hash: facts.version_hash,
      contact_email: "a@example-capital-advisors.test",
      sender_address: "outreach@arc.test",
      invalidated: false,
      personalization_claims: [],
      arc_claim_ids: ["cautious_mexico_intro"],
      word_count: 90,
      created_at: new Date().toISOString(),
      approval_hash: "",
    };
    draft.approval_hash = approvalHash({
      draftId: draft.id,
      version: draft.version,
      factVersion: draft.fact_version_hash,
      email: draft.contact_email,
      sender: draft.sender_address,
      subject: draft.subject,
      body: draft.body,
    });
    expect(isApprovalValid(draft, facts, draft.contact_email, draft.sender_address)).toBe(true);
    const stale = approvedFacts({ postal_address: "999 Changed Avenue" });
    expect(stale.version_hash).not.toBe(facts.version_hash);
    expect(isApprovalValid(draft, stale, draft.contact_email, draft.sender_address)).toBe(false);
  });
});
