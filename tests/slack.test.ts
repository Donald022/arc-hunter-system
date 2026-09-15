import { createHmac } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import {
  handleSlackAction,
  resetSlackReplay,
  verifySlackSignature,
} from "../src/integrations/slack.ts";
import { approvedFacts, seedDraft, seedQualifiedContact, useTestStore } from "./helpers.ts";
import { getConfig, loadConfig, resetConfigCache } from "../src/config.ts";
import { SyntheticMailbox, setGmailPort } from "../src/integrations/gmail.ts";

const SECRET = "slack-signing-secret-for-tests";

function sign(body: string, ts: string): string {
  return "v0=" + createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
}

describe("slack approval", () => {
  beforeEach(() => {
    resetSlackReplay();
    resetConfigCache();
    process.env.SLACK_APPROVER_IDS = "U123";
    process.env.SLACK_SIGNING_SECRET = SECRET;
    process.env.LIVE_SEND_ENABLED = "true";
    process.env.DRY_RUN = "false";
    process.env.GMAIL_SENDER = "outreach@arc.test";
    loadConfig();
  });

  it("rejects unauthorized approvers and sends nothing", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store);
    const draft = await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    setGmailPort(mailbox);
    const res = await handleSlackAction(
      { user: { id: "U999" }, actions: [{ action_id: "approve_send", value: draft.id }] },
      { store, replayKey: "unauth" },
    );
    expect(res.ok).toBe(false);
    expect(mailbox.sent).toHaveLength(0);
  });

  it("treats a replayed action as a no-send", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store);
    const draft = await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    setGmailPort(mailbox);
    const first = await handleSlackAction(
      { user: { id: "U123" }, actions: [{ action_id: "skip_draft", value: draft.id }] },
      { store, replayKey: "same" },
    );
    const second = await handleSlackAction(
      { user: { id: "U123" }, actions: [{ action_id: "approve_send", value: draft.id }] },
      { store, replayKey: "same" },
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.message).toBe("replay");
    expect(mailbox.sent).toHaveLength(0);
  });

  it("double-click approve produces at most one Gmail send", async () => {
    const store = useTestStore();
    const facts = approvedFacts();
    const contact = await seedQualifiedContact(store);
    await seedDraft(store, contact, facts);
    const mailbox = new SyntheticMailbox();
    setGmailPort(mailbox);
    const payload = {
      user: { id: "U123" },
      actions: [
        {
          action_id: "approve_send" as const,
          value: (await store.drafts.latestForContact(contact.id))!.id,
        },
      ],
    };
    const a = await handleSlackAction(payload, { store, replayKey: "click-a" });
    const b = await handleSlackAction(payload, { store, replayKey: "click-b" });
    expect(a.sent || b.sent).toBe(true);
    expect(mailbox.sent.length).toBeLessThanOrEqual(1);
  });

  it("verifies Slack signatures and expired timestamps", () => {
    const raw = "payload=%7B%7D";
    const ts = String(Math.floor(Date.now() / 1000));
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: ts,
        rawBody: raw,
        signature: sign(raw, ts),
      }).ok,
    ).toBe(true);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: String(Math.floor(Date.now() / 1000) - 10_000),
        rawBody: raw,
        signature: sign(raw, String(Math.floor(Date.now() / 1000) - 10_000)),
      }).ok,
    ).toBe(false);
  });
});

void getConfig;
