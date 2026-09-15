import { describe, expect, it } from "vitest";
import { executeApprovedSend, SyntheticMailbox, setGmailPort } from "../src/integrations/gmail.ts";
import { replies } from "../src/jobs/replies.ts";
import { forbidsAutoSend } from "../src/domain/states.ts";
import {
  approvedFacts,
  seedDraft,
  seedQualifiedContact,
  useTestStore,
  testCfg,
} from "./helpers.ts";
import { loadConfig, resetConfigCache } from "../src/config.ts";
import { FixtureNotion } from "../src/integrations/notion.ts";
import type { AppConfig } from "../src/config.ts";

function liveCfg(): AppConfig {
  resetConfigCache();
  process.env.LIVE_SEND_ENABLED = "true";
  process.env.DRY_RUN = "false";
  process.env.GMAIL_SENDER = "outreach@arc.test";
  return { ...loadConfig(), ...testCfg };
}

describe("gmail send gates", () => {
  it("sends zero when LIVE_SEND_ENABLED is false", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store);
    const draft = await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    setGmailPort(mailbox);
    const cfg = { ...liveCfg(), LIVE_SEND_ENABLED: false, DRY_RUN: true };
    const res = await executeApprovedSend({
      store,
      draft,
      contact,
      actor: "U123",
      gmail: mailbox,
      cfg,
    });
    expect(res.sent).toBe(false);
    expect(mailbox.sent).toHaveLength(0);
  });

  it("sends zero without a work email", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store, {
      work_email: undefined,
      email_confidence: "None",
    });
    const draft = await seedDraft(store, contact, facts);
    draft.contact_email = "missing@example.test";
    const mailbox = new SyntheticMailbox();
    const res = await executeApprovedSend({
      store,
      draft,
      contact,
      actor: "U123",
      gmail: mailbox,
      cfg: liveCfg(),
    });
    expect(res.sent).toBe(false);
    expect(res.message).toMatch(/missing_email|stale|invalid/);
  });

  it("sends zero for DNC contacts", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store, { do_not_contact: true, state: "DNC" });
    const draft = await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    const res = await executeApprovedSend({
      store,
      draft,
      contact,
      actor: "U123",
      gmail: mailbox,
      cfg: liveCfg(),
    });
    expect(res.sent).toBe(false);
    expect(forbidsAutoSend(contact.state, true)).toBe(true);
  });

  it("sends zero when postal address is missing", async () => {
    const store = useTestStore();
    const facts = approvedFacts({ postal_address: "" });
    const contact = await seedQualifiedContact(store);
    const draft = await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    const res = await executeApprovedSend({
      store,
      draft,
      contact,
      actor: "U123",
      gmail: mailbox,
      cfg: liveCfg(),
    });
    expect(res.sent).toBe(false);
    expect(res.message).toContain("missing_compliance");
  });

  it("retries Notion logging only after Gmail success, never Gmail", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store);
    const draft = await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    const notion = new FixtureNotion();
    let notionCalls = 0;
    const res = await executeApprovedSend({
      store,
      draft,
      contact,
      actor: "U123",
      gmail: mailbox,
      cfg: liveCfg(),
      notionWrite: async () => {
        notionCalls += 1;
        notion.failNext = true;
        await notion.upsertContact(contact);
      },
    });
    expect(res.sent).toBe(true);
    expect(mailbox.sent).toHaveLength(1);
    expect(notionCalls).toBe(1);
  });

  it("moves to SEND_UNCERTAIN on Gmail timeout without retrying send", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store);
    const draft = await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    mailbox.timeoutNext = true;
    const res = await executeApprovedSend({
      store,
      draft,
      contact,
      actor: "U123",
      gmail: mailbox,
      cfg: liveCfg(),
    });
    expect(res.message).toBe("SEND_UNCERTAIN");
    expect(mailbox.sent).toHaveLength(0);
    const updated = await store.contacts.get(contact.id);
    expect(updated?.state).toBe("SEND_UNCERTAIN");
  });

  it("stops automation after a reply or opt-out", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store, { state: "SENT", gmail_thread_id: "th_1" });
    await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    mailbox.addReply(
      "th_1",
      "alex.rivera@example-capital-advisors.test",
      "Thanks, interested to learn more.",
    );
    setGmailPort(mailbox);
    const result = await replies({ store });
    expect(result.replies).toBe(1);
    const after = await store.contacts.get(contact.id);
    expect(after?.state).toBe("MANUAL_HANDOFF");
    expect(forbidsAutoSend(after!.state)).toBe(true);

    const c2 = await seedQualifiedContact(store, {
      name: "Casey Nguyen",
      work_email: "other@example-capital-advisors.test",
      state: "SENT",
      gmail_thread_id: "th_2",
    });
    mailbox.addReply(
      "th_2",
      "other@example-capital-advisors.test",
      "Please unsubscribe and opt-out.",
    );
    const opt = await replies({ store });
    expect(opt.opt_outs).toBe(1);
    expect((await store.contacts.get(c2.id))?.state).toBe("DNC");
  });
});
