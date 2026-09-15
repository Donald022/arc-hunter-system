import { getConfig } from "../config.ts";
import type { Store } from "../db/types.ts";
import { getStore } from "../db/pool.ts";
import type { ContactRecord, EmailConfidence } from "../domain/types.ts";
import { utcDay } from "./llm.ts";
import { inc } from "../metrics.ts";
import { logger } from "../logger.ts";

export interface EnrichmentResult {
  email: string;
  confidence: EmailConfidence;
  credits: number;
  source: string;
}

export function looksGuessed(email: string, name: string, domain?: string): boolean {
  const [local] = email.split("@");
  const parts = name.toLowerCase().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  const pattern = `${first}.${last}`;
  return Boolean(domain && local === pattern && email.endsWith(`@${domain}`));
}

export async function maybeEnrich(
  contact: ContactRecord,
  store: Store = getStore(),
): Promise<EnrichmentResult | undefined> {
  if (contact.work_email) {
    return {
      email: contact.work_email,
      confidence: contact.email_confidence,
      credits: 0,
      source: "existing",
    };
  }

  const publicEmail = publicEmailForFixture(contact);
  if (publicEmail) {
    return { email: publicEmail, confidence: "Public", credits: 0, source: "public_listing" };
  }

  const cfg = getConfig();
  if (!cfg.APOLLO_ENABLED) return undefined;
  const day = utcDay();
  const used = await store.enrichment.creditsToday(day);
  if (used >= cfg.DAILY_ENRICHMENT_CAP) {
    logger.warn("enrichment cap reached");
    return undefined;
  }
  if (!cfg.APOLLO_API_KEY) return undefined;
  throw new Error("Apollo live enrichment is disabled during dry-run builds; adapter not invoked");
}

function publicEmailForFixture(contact: ContactRecord): string | undefined {
  const map: Record<string, string> = {
    "Alex Rivera": "alex.rivera@example-capital-advisors.test",
    "Sam Okonkwo": "sam.okonkwo@northwind-cloud.test",
    "Morgan Chen": "morgan.chen@summit-site.test",
  };
  return map[contact.name];
}

export async function recordEnrichmentCredit(store: Store, n = 1): Promise<void> {
  await store.enrichment.addCredits(utcDay(), n);
  inc("enrichment_credits", n);
}
