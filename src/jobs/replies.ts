import { getStore } from "../db/pool.ts";
import type { Store } from "../db/types.ts";
import { getGmailPort } from "../integrations/gmail.ts";
import { getConfig } from "../config.ts";
import { inc } from "../metrics.ts";
import { logger } from "../logger.ts";

const OPT_OUT = /unsubscribe|opt[-\s]?out|remove me|stop contacting/i;
const BOUNCE = /delivery status notification|undeliverable|mailbox unavailable|550 /i;

export async function replies(opts: { store?: Store; actor?: string } = {}): Promise<{
  run_id: string;
  replies: number;
  opt_outs: number;
  bounces: number;
  review: number;
}> {
  const store = opts.store ?? getStore();
  const job = await store.jobs.start("replies");
  const gmail = getGmailPort();
  const sender = (getConfig().GMAIL_SENDER ?? "").toLowerCase();
  let replyCount = 0;
  let opt = 0;
  let bounce = 0;
  let review = 0;

  try {
    const sentContacts = await store.contacts.list({ state: "SENT" });
    for (const contact of sentContacts) {
      if (!contact.gmail_thread_id) continue;
      const messages = await gmail.listThread(contact.gmail_thread_id);
      const inbound = messages.filter((m) => {
        const from = m.from.toLowerCase();
        if (sender) return !from.includes(sender);
        return Boolean(m.from);
      });
      const seen = new Set<string>();
      for (const msg of inbound) {
        if (seen.has(msg.id)) continue;
        seen.add(msg.id);
        if (OPT_OUT.test(msg.snippet)) {
          contact.do_not_contact = true;
          await store.contacts.upsert(contact);
          await store.contacts.setState(contact.id, "DNC", opts.actor ?? "replies", "opt_out");
          await store.suppression.add({ email: contact.work_email, reason: "opt_out", actor: "replies" });
          opt += 1;
          inc("opt_outs");
          continue;
        }
        if (BOUNCE.test(msg.snippet)) {
          await store.contacts.setState(contact.id, "BOUNCED", opts.actor ?? "replies");
          bounce += 1;
          continue;
        }
        if (!msg.snippet.trim()) {
          review += 1;
          continue;
        }
        await store.contacts.setState(contact.id, "REPLIED", opts.actor ?? "replies");
        contact.owner = "Donald";
        await store.contacts.upsert(contact);
        await store.events.add({
          contact_id: contact.id,
          type: "Replied",
          actor: "replies",
          at: new Date().toISOString(),
          payload: { snippet: msg.snippet.slice(0, 180), gmail_thread_id: contact.gmail_thread_id },
        });
        await store.contacts.setState(contact.id, "MANUAL_HANDOFF", opts.actor ?? "replies");
        replyCount += 1;
        inc("replies");
      }
    }
    await store.jobs.finish(job.id, "ok", { replies: replyCount, opt_outs: opt, bounces: bounce, review });
    logger.info("replies complete", { run_id: job.id });
    return { run_id: job.id, replies: replyCount, opt_outs: opt, bounces: bounce, review };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.jobs.finish(job.id, "error", undefined, msg);
    throw err;
  }
}
