import { describe, expect, it, vi } from "vitest";

vi.mock("../src/jobs/factsLoader.ts", () => ({
  loadFactsSafe: vi.fn(async () => ({ ok: false as const, reason: "test_forced_failure" })),
  loadFactsCached: vi.fn(async () => {
    throw new Error("test_forced_failure");
  }),
  resetFactsCache: vi.fn(),
  setFactsForTests: vi.fn(),
  factsFilePresent: vi.fn(() => true),
}));

import { draft } from "../src/jobs/draft.ts";
import { executeApprovedSend, SyntheticMailbox } from "../src/integrations/gmail.ts";
import {
  useTestStore,
  seedQualifiedContact,
  seedDraft,
  approvedFacts,
  testCfg,
} from "./helpers.ts";
import { loadConfig } from "../src/config.ts";

describe("facts unavailable — fail closed (never draft, never send)", () => {
  it("draft() places every currently-qualified lead into FACT_REVIEW instead of crashing or drafting", async () => {
    const store = useTestStore();
    const contact = await seedQualifiedContact(store, { state: "QUALIFIED" });
    const result = await draft({ store });
    expect(result.drafted).toBe(0);
    expect(result.fact_review).toBeGreaterThanOrEqual(1);
    const updated = await store.contacts.get(contact.id);
    expect(updated?.state).toBe("FACT_REVIEW");
  });

  it("executeApprovedSend refuses to send when facts are unavailable, sanitized reason only", async () => {
    const store = useTestStore();
    // Build a draft using real facts machinery (bypasses the mock via helpers), then
    // attempt to send while the mocked loader reports unavailable facts.
    const realFacts = approvedFacts();
    const contact = await seedQualifiedContact(store);
    const draftRecord = await seedDraft(store, contact, realFacts);
    const mailbox = new SyntheticMailbox();
    const res = await executeApprovedSend({
      store,
      draft: draftRecord,
      contact,
      actor: "U123",
      gmail: mailbox,
      cfg: { ...loadConfig(), ...testCfg },
    });
    expect(res.sent).toBe(false);
    expect(res.message).toContain("facts_unavailable");
    expect(mailbox.sent).toHaveLength(0);
  });
});
