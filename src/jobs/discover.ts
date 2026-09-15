import { getConfig, type AppConfig } from "../config.ts";
import { getStore } from "../db/pool.ts";
import type { Store } from "../db/types.ts";
import { domainFromUrl, normalizeDomain } from "../domain/identities.ts";
import type { CampaignRecord, Hunter, Signal } from "../domain/types.ts";
import { runHunter } from "../hunters/index.ts";
import { loadRegistry } from "../hunters/registry.ts";
import { hashUrl } from "../hunters/parsers.ts";
import { inc } from "../metrics.ts";
import { logger } from "../logger.ts";
import { requireDiscoveryAllowed } from "./controls.ts";
import { seedDefaultCampaigns } from "./campaigns.ts";

export interface DiscoverOptions {
  hunter?: Hunter;
  dryRun?: boolean;
  actor?: string;
  store?: Store;
}

export async function discover(opts: DiscoverOptions = {}): Promise<{
  run_id: string;
  hunters: Hunter[];
  sources_checked: number;
  candidates: number;
  signals: Signal[];
  errors: Array<{ source: string; error: string }>;
}> {
  const store = opts.store ?? getStore();
  const cfg: AppConfig = getConfig();
  await requireDiscoveryAllowed(store);
  await seedDefaultCampaigns(store);

  const registry = loadRegistry();
  const hunters: Hunter[] = opts.hunter
    ? [opts.hunter]
    : (await store.campaigns.list()).filter((c) => c.enabled).map((c) => c.hunter);

  const uniqueHunters = [...new Set(hunters)];
  const job = await store.jobs.start("discover", opts.hunter);
  const allSignals: Signal[] = [];
  const errors: Array<{ source: string; error: string }> = [];
  let sourcesChecked = 0;

  try {
    for (const hunter of uniqueHunters) {
      const campaign = (await store.campaigns.list()).find((c) => c.hunter === hunter);
      if (campaign && !campaign.enabled) continue;
      const result = await runHunter(hunter, registry);
      sourcesChecked += registry.sources.filter((s) => s.hunter === hunter && s.enabled).length;
      errors.push(...result.errors);
      for (const signal of result.signals) {
        allSignals.push(signal);
        if (opts.dryRun ?? cfg.DRY_RUN) continue;
        const domain = signal.company_domain ?? domainFromUrl(signal.source_url);
        const company = await store.companies.upsert({
          name: signal.company,
          domain,
          segment: segmentFor(hunter),
          region_signals: [],
          why_relevant: signal.quoted_evidence.slice(0, 400),
          source_urls: [signal.source_url],
          account_priority: 0,
          status: "active",
          last_seen: signal.observed_at,
        });
        const existing = await store.signals.byHash(signal.raw_content_hash);
        const row = existing ?? (await store.signals.insert(signal, { company_id: company.id }));
        if (signal.person) {
          const contact = await store.contacts.upsert({
            company_id: company.id,
            name: signal.person,
            title: signal.title,
            email_confidence: "None",
            hunter_tags: [hunter],
            role: signal.role,
            direct_buyer_potential: 0,
            connection_potential: 0,
            fit_score: 0,
            evidence_summary: signal.quoted_evidence,
            state: "DISCOVERED",
            do_not_contact: false,
            campaign_id: campaign?.id,
            profile_url:
              signal.source_url.includes("/team/") || signal.source_url.includes("/speakers/")
                ? signal.source_url
                : undefined,
          });
          await store.evidence.insert({
            signal_id: row.id,
            company_id: company.id,
            contact_id: contact.id,
            url: signal.source_url,
            url_hash: hashUrl(signal.source_url + (signal.person ?? "")),
            quoted_text: signal.quoted_evidence,
            published_at: signal.published_at,
            observed_at: signal.observed_at,
            hunter: signal.hunter,
          });
          await store.events.add({
            contact_id: contact.id,
            type: "Discovered",
            actor: opts.actor ?? "discover",
            at: new Date().toISOString(),
            payload: { hunter, source_url: signal.source_url },
          });
        } else {
          await store.evidence.insert({
            signal_id: row.id,
            company_id: company.id,
            url: signal.source_url,
            url_hash: hashUrl(signal.source_url + (signal.person ?? "")),
            quoted_text: signal.quoted_evidence,
            published_at: signal.published_at,
            observed_at: signal.observed_at,
            hunter: signal.hunter,
          });
        }
      }
      if (campaign) {
        await store.campaigns.upsert({ ...campaign, last_run: new Date().toISOString() });
      }
    }
    inc("sources_fetched", sourcesChecked);
    inc("candidates_found", allSignals.filter((s) => s.person).length);
    await store.jobs.finish(job.id, "ok", {
      sources_checked: sourcesChecked,
      candidates: allSignals.filter((s) => s.person).length,
      errors,
    });
    logger.info("discover complete", { run_id: job.id, hunter: opts.hunter });
    return {
      run_id: job.id,
      hunters: uniqueHunters,
      sources_checked: sourcesChecked,
      candidates: allSignals.filter((s) => s.person).length,
      signals: allSignals,
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.jobs.finish(job.id, "error", undefined, msg);
    throw err;
  }
}

function segmentFor(
  hunter: Hunter,
): CampaignRecord["hunter"] extends Hunter ? import("../domain/types.ts").Segment : never {
  if (hunter === "broker") return "Broker";
  if (hunter === "tenant") return "Tenant";
  if (hunter === "network") return "Network";
  if (hunter === "deal") return "Advisor";
  return "Neocloud";
}

export { normalizeDomain };
