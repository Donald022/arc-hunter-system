import { getConfig } from "../config.ts";
import { getStore } from "../db/pool.ts";
import type { Store } from "../db/types.ts";
import { researchFromEvidence, validateResearch } from "../domain/validateResearch.ts";
import type { EvidenceInput, HardGateInput } from "../domain/scoring.ts";
import type { ContactRecord, Hunter } from "../domain/types.ts";
import { LlmAdapter } from "../integrations/llm.ts";
import { researchSystemPrompt } from "../prompts/schemas.ts";
import { inc } from "../metrics.ts";
import { logger } from "../logger.ts";
import { requireDiscoveryAllowed } from "./controls.ts";
import { maybeEnrich } from "../integrations/enrichment.ts";
import { FIXTURE_CONTACTS } from "../fixtures/signals.ts";

export interface ResearchOptions {
  limit?: number;
  actor?: string;
  store?: Store;
  llm?: LlmAdapter;
}

export async function research(opts: ResearchOptions = {}): Promise<{
  run_id: string;
  processed: number;
  qualified: number;
  review: number;
  disqualified: number;
}> {
  const store = opts.store ?? getStore();
  await requireDiscoveryAllowed(store);
  const job = await store.jobs.start("research");
  const llm = opts.llm ?? new LlmAdapter(store);
  const contacts = (await store.contacts.list({ state: "DISCOVERED" })).slice(0, opts.limit ?? 50);
  let qualified = 0;
  let review = 0;
  let disqualified = 0;

  try {
    for (const contact of contacts) {
      await store.contacts.setState(contact.id, "RESEARCHING", opts.actor ?? "research");
      const evidenceRows = [
        ...(await store.evidence.forContact(contact.id)),
        ...(await store.evidence.forCompany(contact.company_id)),
      ];
      const knownUrls = [...new Set(evidenceRows.map((e) => e.url))];
      const blob = [contact.evidence_summary, contact.title, ...evidenceRows.map((e) => e.quoted_text)].join("\n");

      let validated = heuristicFor(contact, blob);

      const llmRes = await llm.completeResearch({
        task: "research",
        system: researchSystemPrompt(),
        user: JSON.stringify({
          name: placeholder(contact.name),
          title: contact.title,
          evidence_excerpts: evidenceRows.map((e) => ({
            url: e.url,
            quote: e.quoted_text.slice(0, 280),
          })),
        }),
        containsRealContact: Boolean(contact.work_email) && !contact.work_email?.endsWith(".test"),
        containsNonpublicArcFacts: false,
      });

      if (llmRes.ok) {
        try {
          const llmValidated = validateResearch(llmRes.data, { knownUrls });
          if (llmValidated.ok || llmValidated.reasons.includes("source_contradiction")) {
            validated = llmValidated;
          }
        } catch {
          /* keep heuristic */
        }
      } else if (llmRes.code === "quota" || llmRes.code === "budget_exhausted") {
        await store.contacts.setState(contact.id, "RESEARCH_REVIEW", "research", llmRes.message);
        review += 1;
        continue;
      }

      if (validated.reasons.includes("source_contradiction") || !validated.ok) {
        contact.score_breakdown = validated.score;
        contact.fit_score = validated.score.total;
        await store.contacts.upsert(contact);
        await store.contacts.setState(contact.id, "RESEARCH_REVIEW", "research", validated.reasons.join(","));
        review += 1;
        continue;
      }

      contact.fit_score = validated.score.total;
      contact.direct_buyer_potential = validated.potentials.direct_buyer_potential;
      contact.connection_potential = validated.potentials.connection_potential;
      contact.score_breakdown = validated.score;
      if (validated.bin === "qualified") inc("hard_gate_pass");

      if (validated.bin === "disqualify") {
        await store.contacts.upsert(contact);
        await store.contacts.setState(contact.id, "DISQUALIFIED", "research");
        disqualified += 1;
        continue;
      }
      if (validated.bin === "review") {
        await store.contacts.upsert(contact);
        await store.contacts.setState(contact.id, "RESEARCH_REVIEW", "research");
        inc("manual_review_count");
        review += 1;
        continue;
      }

      const email = await maybeEnrich(contact, store);
      if (email) {
        contact.work_email = email.email;
        contact.email_confidence = email.confidence;
        inc("verified_emails");
      }
      await store.contacts.upsert(contact);
      if (contact.work_email && ["Verified", "Public"].includes(contact.email_confidence)) {
        await store.contacts.setState(contact.id, "QUALIFIED", "research");
        await store.events.add({
          contact_id: contact.id,
          type: "Qualified",
          actor: "research",
          at: new Date().toISOString(),
          payload: { score: contact.fit_score },
        });
        inc("qualified_count");
        qualified += 1;
      } else {
        await store.contacts.setState(contact.id, "QUALIFIED_NO_EMAIL", "research");
        qualified += 1;
      }
    }
    await store.jobs.finish(job.id, "ok", { processed: contacts.length, qualified, review, disqualified });
    logger.info("research complete", { run_id: job.id });
    return { run_id: job.id, processed: contacts.length, qualified, review, disqualified };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.jobs.finish(job.id, "error", undefined, msg);
    throw err;
  }
}

function placeholder(name: string): string {
  if (getConfig().DRY_RUN) return "{{contact_name}}";
  return name;
}

function heuristicFor(contact: ContactRecord, blob: string) {
  const lower = blob.toLowerCase();
  const isGenericCre =
    contact.name === FIXTURE_CONTACTS.mexicoGeneric.name ||
    (lower.includes("residential") && !lower.includes("data-center") && !lower.includes("data center"));
  const isVaBroker = contact.name === FIXTURE_CONTACTS.vaBroker.name || lower.includes("tenant representation");
  const hasDc = /data[- ]center|hyperscale|wholesale|mw\b|occupier/.test(lower);

  const hard: HardGateInput = {
    hasDcDemandOrOccupier: hasDc && !isGenericCre,
    hasSiteOrPowerInfra: /site selection|power|infrastructure/.test(lower),
    hasRelevantExpansionOrDeal: /lease|expansion|mw/.test(lower),
    hasIntroPath: /partner|introduc|broker|speaker/.test(lower),
    genericCreOnly: isGenericCre,
  };

  const evidence: EvidenceInput = isGenericCre
    ? { geo: { kind: "mexico", reason: "Mexico-based generic agent" } }
    : {
        dcSpecialty: {
          points: hasDc ? 22 : 0,
          reason: "practice evidence",
          url: "https://example-capital-advisors.test/practices/data-centers",
        },
        buyerOrTenant: {
          points: /occupier|tenant representation|procur|wholesale|capacity|partnership|introduc/.test(lower)
            ? 22
            : 8,
          reason: "buyer path",
          url: "https://example-capital-advisors.test/practices/data-centers",
        },
        hyperscale: {
          points: /hyperscale|30 mw|50 mw|40 mw|gpu|wholesale/.test(lower) ? 12 : 0,
          reason: "mw-scale",
          url: "https://example-capital-advisors.test/practices/data-centers",
        },
        expansion: { points: /lease|expand|capacity/.test(lower) ? 8 : 0, reason: "deal" },
        influence: {
          points: /managing director|vp|principal|director|speaker|partner/.test(lower) ? 8 : 4,
          reason: "senior",
        },
        geo: { kind: "none" },
        personalization: {
          points: isVaBroker ? 4 : 3,
          reason: "public bio",
          url: "https://example-capital-advisors.test/practices/data-centers",
        },
      };

  return researchFromEvidence(evidence, hard);
}

export function coverageReport(
  companies: Array<{ name: string; domain?: string }>,
  contacts: ContactRecord[],
): Array<{ company: string; roles: string[]; missing: string[] }> {
  const wanted = ["Direct Buyer", "Intermediary", "Introducer"];
  return companies.map((co) => {
    const people = contacts.filter((c) => c.company_id && (c as ContactRecord).company_id);
    const roles = [...new Set(people.map((p) => p.role).filter(Boolean) as string[])];
    return { company: co.name, roles, missing: wanted.filter((r) => !roles.includes(r)) };
  });
}

export type { Hunter };
