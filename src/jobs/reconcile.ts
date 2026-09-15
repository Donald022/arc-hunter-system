import { getStore } from "../db/pool.ts";
import type { Store } from "../db/types.ts";
import { getGmailPort } from "../integrations/gmail.ts";
import { logger } from "../logger.ts";
import { seedDefaultCampaigns } from "./campaigns.ts";
import { loadFactsCached } from "./factsLoader.ts";

export async function reconcile(opts: { store?: Store } = {}): Promise<{
  run_id: string;
  uncertain_resolved: number;
  pause: Awaited<ReturnType<Store["pause"]["get"]>>;
  facts_hash: string;
}> {
  const store = opts.store ?? getStore();
  await seedDefaultCampaigns(store);
  const job = await store.jobs.start("reconcile");
  const gmail = getGmailPort();
  let resolved = 0;
  try {
    const sends = await store.sends.list();
    for (const s of sends.filter((x) => x.status === "uncertain")) {
      const found = await gmail.listSentByRfc(s.rfc_message_id);
      if (found) {
        await store.sends.update(s.id, {
          status: "sent",
          gmail_message_id: found.messageId,
          gmail_thread_id: found.threadId,
          sent_at: new Date().toISOString(),
        });
        const contact = await store.contacts.get(s.contact_id);
        if (contact && contact.state === "SEND_UNCERTAIN") {
          await store.contacts.setState(contact.id, "SENT", "reconcile", "found_in_sent");
        }
        resolved += 1;
      }
    }
    const facts = await loadFactsCached();
    const pause = await store.pause.get();
    await store.jobs.finish(job.id, "ok", {
      uncertain_resolved: resolved,
      facts_hash: facts.version_hash,
    });
    logger.info("reconcile complete", { run_id: job.id });
    return { run_id: job.id, uncertain_resolved: resolved, pause, facts_hash: facts.version_hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.jobs.finish(job.id, "error", undefined, msg);
    throw err;
  }
}
