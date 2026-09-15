import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.ts";
import { getStore } from "../db/pool.ts";
import type { Store } from "../db/types.ts";
import { approvalHash, isApprovalValid } from "../jobs/draft.ts";
import { loadFactsCached } from "../jobs/factsLoader.ts";
import { executeApprovedSend } from "./gmail.ts";
import { logger } from "../logger.ts";
import { inc } from "../metrics.ts";

export interface SlackActionPayload {
  type?: string;
  user?: { id: string };
  actions?: Array<{ action_id: string; value?: string }>;
  view?: { callback_id?: string; private_metadata?: string; state?: { values?: Record<string, Record<string, { value?: string }>> } };
  trigger_id?: string;
  response_url?: string;
  message?: { ts?: string };
}

export function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  nowSeconds?: number;
  windowSeconds?: number;
}): { ok: boolean; reason?: string } {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(now - ts) > (opts.windowSeconds ?? 300)) return { ok: false, reason: "timestamp_expired" };
  const base = `v0:${opts.timestamp}:${opts.rawBody}`;
  const digest = "v0=" + createHmac("sha256", opts.signingSecret).update(base).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(opts.signature);
  if (a.length !== b.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

const seenNonces = new Set<string>();

export function consumeReplayNonce(nonce: string, windowMs = 300_000): boolean {
  const key = nonce;
  if (seenNonces.has(key)) return false;
  seenNonces.add(key);
  setTimeout(() => seenNonces.delete(key), windowMs).unref?.();
  return true;
}

export function resetSlackReplay(): void {
  seenNonces.clear();
}

export function draftBlocks(input: {
  contactName: string;
  company: string;
  role?: string;
  hunterTags: string[];
  score: number;
  direct: number;
  connection: number;
  reasons: string[];
  sources: string[];
  emailConfidence: string;
  factVersion: string;
  subject: string;
  body: string;
  notionUrl?: string;
  draftId: string;
}): unknown[] {
  return [
    { type: "header", text: { type: "plain_text", text: "Draft awaiting approval" } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${input.contactName}* · ${input.company}\nRole: ${input.role ?? "n/a"} · Hunters: ${input.hunterTags.join(", ")}\nScore ${input.score} (buyer ${input.direct} / connection ${input.connection})\nEmail: ${input.emailConfidence} · facts ${input.factVersion.slice(0, 8)}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `Reasons: ${input.reasons.slice(0, 3).join(", ")}\n${input.sources.slice(0, 3).join("\n")}` },
    },
    { type: "section", text: { type: "mrkdwn", text: `*${input.subject}*\n${input.body}` } },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "Approve & Send" }, action_id: "approve_send", value: input.draftId, style: "primary" },
        { type: "button", text: { type: "plain_text", text: "Edit" }, action_id: "edit_draft", value: input.draftId },
        { type: "button", text: { type: "plain_text", text: "Skip" }, action_id: "skip_draft", value: input.draftId },
        { type: "button", text: { type: "plain_text", text: "DNC" }, action_id: "dnc_draft", value: input.draftId, style: "danger" },
      ],
    },
  ];
}

export async function handleSlackAction(
  payload: SlackActionPayload,
  opts?: { store?: Store; replayKey?: string },
): Promise<{ ok: boolean; message: string; sent?: boolean }> {
  const cfg = getConfig();
  const store = opts?.store ?? getStore();
  const userId = payload.user?.id ?? "";
  if (!cfg.SLACK_APPROVER_IDS.includes(userId)) {
    return { ok: false, message: "unauthorized" };
  }
  const nonce = opts?.replayKey ?? `${payload.message?.ts ?? ""}:${payload.actions?.[0]?.action_id}:${payload.actions?.[0]?.value}`;
  if (!consumeReplayNonce(nonce)) return { ok: false, message: "replay" };

  const action = payload.actions?.[0];
  if (payload.type === "view_submission" && payload.view?.callback_id === "edit_draft") {
    return applyEdit(payload, store, userId);
  }
  if (!action?.value) return { ok: false, message: "missing_action" };
  const draft = await store.drafts.get(action.value);
  if (!draft) return { ok: false, message: "draft_not_found" };
  const contact = await store.contacts.get(draft.contact_id);
  if (!contact) return { ok: false, message: "contact_not_found" };

  if (action.action_id === "skip_draft") {
    await store.contacts.setState(contact.id, "SKIPPED", userId, "slack_skip");
    await store.events.add({
      contact_id: contact.id,
      type: "Skipped",
      actor: userId,
      at: new Date().toISOString(),
      payload: { draft_id: draft.id },
    });
    return { ok: true, message: "skipped" };
  }
  if (action.action_id === "dnc_draft") {
    contact.do_not_contact = true;
    await store.contacts.upsert(contact);
    await store.contacts.setState(contact.id, "DNC", userId, "slack_dnc");
    await store.suppression.add({ email: contact.work_email, reason: "slack_dnc", actor: userId });
    await store.events.add({
      contact_id: contact.id,
      type: "DNC",
      actor: userId,
      at: new Date().toISOString(),
      payload: {},
    });
    return { ok: true, message: "dnc" };
  }
  if (action.action_id === "edit_draft") {
    await store.contacts.setState(contact.id, "EDITING", userId);
    return { ok: true, message: "edit_modal" };
  }
  if (action.action_id === "approve_send") {
    const latest = await store.contacts.get(contact.id);
    if (latest && (latest.state === "SENT" || latest.state === "SENDING" || latest.state === "SEND_UNCERTAIN")) {
      return { ok: true, message: "already_sent_or_reserved", sent: latest.state === "SENT" };
    }
    const facts = await loadFactsCached();
    const sender = cfg.GMAIL_SENDER ?? facts.reply_to;
    const hash = approvalHash({
      draftId: draft.id,
      version: draft.version,
      factVersion: draft.fact_version_hash,
      email: draft.contact_email,
      sender: draft.sender_address,
      subject: draft.subject,
      body: draft.body,
    });
    draft.approval_hash = hash;
    draft.approved_by = userId;
    draft.approved_at = new Date().toISOString();
    await store.drafts.insert(draft);
    if (!isApprovalValid(draft, facts, contact.work_email ?? "", sender ?? "")) {
      return { ok: false, message: "approval_invalid" };
    }
    await store.contacts.setState(contact.id, "APPROVED", userId);
    inc("approvals");
    const result = await executeApprovedSend({ store, draft, contact, actor: userId });
    return { ok: result.ok, message: result.message, sent: result.sent };
  }
  return { ok: false, message: "unknown_action" };
}

async function applyEdit(payload: SlackActionPayload, store: Store, userId: string) {
  const draftId = payload.view?.private_metadata ?? "";
  const values = payload.view?.state?.values ?? {};
  const subject = Object.values(values).flatMap((v) => Object.values(v)).find((x) => x.value)?.value;
  const body = [...Object.values(values).flatMap((v) => Object.values(v))].map((x) => x.value).filter(Boolean)[1];
  const prev = await store.drafts.get(draftId);
  if (!prev) return { ok: false, message: "draft_not_found" };
  await store.drafts.invalidate(prev.id);
  const next = await store.drafts.insert({
    ...prev,
    id: undefined as unknown as string,
    version: prev.version + 1,
    subject: subject ?? prev.subject,
    body: body ?? prev.body,
    body_hash: createHashCompat(subject ?? prev.subject, body ?? prev.body),
    approval_hash: undefined,
    approved_by: undefined,
    approved_at: undefined,
    invalidated: false,
  });
  const contact = await store.contacts.get(prev.contact_id);
  if (contact) {
    await store.contacts.setState(contact.id, "PENDING_APPROVAL", userId, "edited");
    await store.events.add({
      contact_id: contact.id,
      type: "Edited",
      actor: userId,
      at: new Date().toISOString(),
      payload: { draft_id: next.id, version: next.version },
    });
  }
  logger.info("draft edited", { draft_id: next.id });
  return { ok: true, message: "edited" };
}

function createHashCompat(subject: string, body: string): string {
  return approvalHash({
    draftId: "x",
    version: 0,
    factVersion: "x",
    email: "x",
    sender: "x",
    subject,
    body,
  });
}
