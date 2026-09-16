import { createHash, randomUUID } from "node:crypto";
import { getConfig, type AppConfig } from "../config.ts";
import type { Store } from "../db/types.ts";
import { getStore } from "../db/pool.ts";
import { senderCompliance } from "../domain/facts.ts";
import { forbidsAutoSend, canTransition } from "../domain/states.ts";
import type { ContactRecord, DraftRecord, SendAttempt } from "../domain/types.ts";
import { loadFactsSafe } from "../jobs/factsLoader.ts";
import { requireOutboundAllowed } from "../jobs/controls.ts";
import { isApprovalValid } from "../jobs/draft.ts";
import { inc } from "../metrics.ts";
import { logger } from "../logger.ts";

export interface GmailPort {
  send(input: {
    raw: string;
    rfcMessageId: string;
    threadId?: string;
  }): Promise<{ messageId: string; threadId: string }>;
  listSentByRfc(rfcMessageId: string): Promise<{ messageId: string; threadId: string } | undefined>;
  listThread(
    threadId: string,
  ): Promise<Array<{ id: string; from: string; snippet: string; internalDate: string }>>;
}

export class SyntheticMailbox implements GmailPort {
  sent: Array<{ rfcMessageId: string; messageId: string; threadId: string; raw: string }> = [];
  inbox: Array<{
    threadId: string;
    id: string;
    from: string;
    snippet: string;
    internalDate: string;
  }> = [];
  failNext = false;
  timeoutNext = false;
  constructor(public sender = "outreach@arc.test") {}

  async send(input: { raw: string; rfcMessageId: string; threadId?: string }) {
    if (this.timeoutNext) {
      this.timeoutNext = false;
      throw new Error("gmail_timeout");
    }
    if (this.failNext) {
      this.failNext = false;
      throw new Error("gmail_failed");
    }
    const messageId = `msg_${this.sent.length + 1}`;
    const threadId = input.threadId ?? `th_${this.sent.length + 1}`;
    this.sent.push({ rfcMessageId: input.rfcMessageId, messageId, threadId, raw: input.raw });
    return { messageId, threadId };
  }

  async listSentByRfc(rfcMessageId: string) {
    const hit = this.sent.find((s) => s.rfcMessageId === rfcMessageId);
    return hit ? { messageId: hit.messageId, threadId: hit.threadId } : undefined;
  }

  async listThread(threadId: string) {
    return this.inbox.filter((m) => m.threadId === threadId);
  }

  addReply(threadId: string, from: string, snippet: string) {
    this.inbox.push({
      threadId,
      id: `in_${this.inbox.length + 1}`,
      from,
      snippet,
      internalDate: Date.now().toString(),
    });
  }
}

let mailbox: GmailPort = new SyntheticMailbox();

export function setGmailPort(port: GmailPort): void {
  mailbox = port;
}

export function getGmailPort(): GmailPort {
  return mailbox;
}

export function rfcMessageIdFor(draftId: string, version: number, contactId: string): string {
  const h = createHash("sha256")
    .update(`${draftId}:${version}:${contactId}`)
    .digest("hex")
    .slice(0, 24);
  return `<arc-${h}@arc-hunter.local>`;
}

export async function executeApprovedSend(opts: {
  store?: Store;
  draft: DraftRecord;
  contact: ContactRecord;
  actor: string;
  gmail?: GmailPort;
  notionWrite?: (attempt: SendAttempt) => Promise<void>;
  cfg?: AppConfig;
}): Promise<{ ok: boolean; message: string; sent: boolean; attempt?: SendAttempt }> {
  const store = opts.store ?? getStore();
  const cfg = opts.cfg ?? getConfig();
  const gmail = opts.gmail ?? getGmailPort();
  const factsResult = await loadFactsSafe();
  if (!factsResult.ok) {
    if (canTransition(opts.contact.state, "FACT_REVIEW")) {
      await store.contacts.setState(opts.contact.id, "FACT_REVIEW", opts.actor, factsResult.reason);
    }
    return { ok: false, message: `facts_unavailable:${factsResult.reason}`, sent: false };
  }
  const facts = factsResult.facts;
  const sender = cfg.GMAIL_SENDER ?? facts.reply_to ?? "";

  // Import safety validation
  const { validateEmail } = await import("../domain/email-validation.ts");
  const { validateSendRecipient } = await import("../domain/safety.ts");

  // Email validation gate
  const emailValidation = validateEmail(opts.contact.work_email);
  if (!emailValidation.valid) {
    logger.warn("blocked_invalid_email", {
      contact_id: opts.contact.id,
      reason: emailValidation.reason,
    });
    return {
      ok: false,
      message: `invalid_email:${emailValidation.reason}`,
      sent: false,
    };
  }

  // Fixture contamination detection - check if email ends with .test
  const isFixture = opts.contact.work_email?.toLowerCase().endsWith(".test") ?? false;

  // Test recipient allowlist gate
  const sendValidation = validateSendRecipient(opts.contact.work_email, cfg, isFixture);
  if (!sendValidation.allowed) {
    logger.warn("blocked_send_recipient", {
      contact_id: opts.contact.id,
      reason: sendValidation.reason,
      mode: cfg.NODE_ENV,
    });
    return {
      ok: false,
      message: `recipient_blocked:${sendValidation.reason}`,
      sent: false,
    };
  }

  try {
    await requireOutboundAllowed(store, cfg);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "outbound_blocked",
      sent: false,
    };
  }

  const compliance = senderCompliance(facts);
  if (!compliance.ok)
    return {
      ok: false,
      message: `missing_compliance:${compliance.missing.join(",")}`,
      sent: false,
    };
  if (forbidsAutoSend(opts.contact.state, opts.contact.do_not_contact)) {
    return { ok: false, message: "state_forbids_send", sent: false };
  }
  if (!opts.contact.work_email) return { ok: false, message: "missing_email", sent: false };
  if (await store.suppression.isSuppressed(opts.contact.work_email)) {
    return { ok: false, message: "suppressed", sent: false };
  }
  if (!isApprovalValid(opts.draft, facts, opts.contact.work_email, sender)) {
    return { ok: false, message: "stale_or_invalid_approval", sent: false };
  }

  const sentToday = (await store.sends.list()).filter(
    (s) =>
      s.status === "sent" &&
      s.sent_at &&
      s.sent_at.slice(0, 10) === new Date().toISOString().slice(0, 10),
  ).length;
  if (sentToday >= cfg.DAILY_SEND_CAP) return { ok: false, message: "daily_send_cap", sent: false };

  const campaignId = opts.contact.campaign_id ?? "camp-broker";
  const existing = await store.sends.firstTouch(opts.contact.id, campaignId);
  if (existing)
    return {
      ok: true,
      message: "already_sent_or_reserved",
      sent: existing.status === "sent",
      attempt: existing,
    };

  let attempt: SendAttempt;
  try {
    attempt = await store.sends.reserve({
      contact_id: opts.contact.id,
      campaign_id: campaignId,
      draft_id: opts.draft.id,
      draft_version: opts.draft.version,
      first_touch: true,
      rfc_message_id: rfcMessageIdFor(opts.draft.id, opts.draft.version, opts.contact.id),
      status: "reserved",
      exact_body: opts.draft.body,
      actor: opts.actor,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("duplicate_first_touch")) {
      const prior = await store.sends.firstTouch(opts.contact.id, campaignId);
      return {
        ok: true,
        message: "duplicate_click",
        sent: prior?.status === "sent",
        attempt: prior,
      };
    }
    throw err;
  }

  const current = await store.contacts.get(opts.contact.id);
  if (!current) return { ok: false, message: "contact_not_found", sent: false };
  if (current.state === "PENDING_APPROVAL") {
    await store.contacts.setState(current.id, "APPROVED", opts.actor, "pre_send");
  }
  await store.contacts.setState(opts.contact.id, "SENDING", opts.actor);

  try {
    const result = await gmail.send({
      raw: opts.draft.body,
      rfcMessageId: attempt.rfc_message_id,
    });
    attempt = await store.sends.update(attempt.id, {
      status: "sent",
      gmail_message_id: result.messageId,
      gmail_thread_id: result.threadId,
      sent_at: new Date().toISOString(),
    });
    opts.contact.gmail_thread_id = result.threadId;
    opts.contact.last_contacted = attempt.sent_at;
    await store.contacts.upsert(opts.contact);
    await store.contacts.setState(opts.contact.id, "SENT", opts.actor);
    inc("sent");
    try {
      if (opts.notionWrite) await opts.notionWrite(attempt);
    } catch (side) {
      logger.warn("notion side effect failed after gmail success", {
        send_attempt_id: attempt.id,
        error: side instanceof Error ? side.message : String(side),
      });
      await store.events.add({
        contact_id: opts.contact.id,
        type: "Error",
        actor: "notion",
        at: new Date().toISOString(),
        payload: { retry: "notion_only", send_attempt_id: attempt.id },
      });
    }
    await store.events.add({
      contact_id: opts.contact.id,
      type: "Sent",
      actor: opts.actor,
      at: new Date().toISOString(),
      payload: { gmail_message_id: result.messageId, gmail_thread_id: result.threadId },
    });
    return { ok: true, message: "sent", sent: true, attempt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timeout")) {
      const found = await gmail.listSentByRfc(attempt.rfc_message_id);
      if (found) {
        attempt = await store.sends.update(attempt.id, {
          status: "sent",
          gmail_message_id: found.messageId,
          gmail_thread_id: found.threadId,
          sent_at: new Date().toISOString(),
        });
        await store.contacts.setState(opts.contact.id, "SENT", opts.actor);
        return { ok: true, message: "reconciled_sent", sent: true, attempt };
      }
      await store.sends.update(attempt.id, { status: "uncertain", error: msg });
      await store.contacts.setState(opts.contact.id, "SEND_UNCERTAIN", opts.actor, "gmail_timeout");
      inc("uncertain_sends");
      return { ok: false, message: "SEND_UNCERTAIN", sent: false, attempt };
    }
    await store.sends.update(attempt.id, { status: "failed", error: msg });
    await store.contacts.setState(opts.contact.id, "SEND_FAILED", opts.actor, msg);
    return { ok: false, message: msg, sent: false, attempt };
  }
}

export async function liveGmailSend(input: {
  raw: string;
  rfcMessageId: string;
  accessToken: string;
}): Promise<{ messageId: string; threadId: string }> {
  const encoded = Buffer.from(
    `From: me\r\nMessage-ID: ${input.rfcMessageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${input.raw}`,
  ).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) throw new Error(`gmail ${res.status}`);
  const json = (await res.json()) as { id: string; threadId: string };
  return { messageId: json.id, threadId: json.threadId };
}

export function newId(): string {
  return randomUUID();
}
