import { createHash } from "node:crypto";
import { MemoryStore } from "../src/db/memory.ts";
import { setStore } from "../src/db/pool.ts";
import { loadFactsFromObject, type ApprovedFactsBundle } from "../src/domain/facts.ts";
import { setFactsForTests } from "../src/jobs/factsLoader.ts";
import type { ContactRecord, DraftRecord } from "../src/domain/types.ts";
import { approvalHash, bodyHash } from "../src/jobs/draft.ts";

export function useTestStore(): MemoryStore {
  const store = new MemoryStore();
  setStore(store);
  return store;
}

export function approvedFacts(overrides: Partial<ApprovedFactsBundle> = {}): ApprovedFactsBundle {
  const bundle = loadFactsFromObject({
    utility_mw_current_verified: "",
    utility_mw_target: "",
    it_mw_planned: "",
    land_control_status: "",
    site_location_disclosure: "",
    target_rfs_status: "",
    legal_sender_entity: "ARC MX I (legal entity pending Donald confirmation)",
    approved_sender_name_title: "Donald / ARC outreach (title pending)",
    reply_to: "outreach@arc.test",
    postal_address: "123 Example Street, Example City, ST 00000",
    opt_out_instructions: "Reply STOP to opt out of further email.",
    restricted_claims: ["75 MW secured"],
    facts: [
      {
        id: "cautious_mexico_intro",
        claim: "Evaluating a Mexico data-center opportunity",
        basis: "test fixture",
        evidence_url_or_document: "https://example.test/facts",
        approved_wording:
          "We are evaluating a data-center development opportunity in Mexico and beginning conversations with potential anchor tenants.",
        approved_by: "test",
        approved_at: "2026-09-01T00:00:00.000Z",
        valid_until: "2028-01-01T00:00:00.000Z",
        can_use_in_first_touch: true,
      },
    ],
    ...overrides,
  });
  setFactsForTests(bundle);
  return bundle;
}

export async function seedQualifiedContact(
  store: MemoryStore,
  extra: Partial<ContactRecord> = {},
): Promise<ContactRecord> {
  const company = await store.companies.upsert({
    name: "Example Capital Advisors",
    domain: "example-capital-advisors.test",
    region_signals: [],
    source_urls: ["https://example-capital-advisors.test/practices/data-centers"],
    account_priority: 1,
    status: "active",
  });
  const contact = await store.contacts.upsert({
    company_id: company.id,
    name: "Alex Rivera",
    title: "Managing Director, Data Center Tenant Representation",
    work_email: extra.work_email ?? "alex.rivera@example-capital-advisors.test",
    email_confidence: "Public",
    hunter_tags: ["broker"],
    role: "Intermediary",
    direct_buyer_potential: 8,
    connection_potential: 7,
    fit_score: 82,
    evidence_summary: "Hyperscale occupier representation in Northern Virginia",
    state: extra.state ?? "PENDING_APPROVAL",
    do_not_contact: extra.do_not_contact ?? false,
    campaign_id: "camp-broker",
    ...extra,
  });
  await store.evidence.insert({
    contact_id: contact.id,
    company_id: company.id,
    url: "https://example-capital-advisors.test/practices/data-centers",
    url_hash: createHash("sha256")
      .update("https://example-capital-advisors.test/practices/data-centers")
      .digest("hex"),
    quoted_text: "Occupier representation for hyperscale data-center leases",
    observed_at: new Date().toISOString(),
    hunter: "broker",
  });
  return contact;
}

export async function seedDraft(
  store: MemoryStore,
  contact: ContactRecord,
  facts: ApprovedFactsBundle,
  sender = "outreach@arc.test",
): Promise<DraftRecord> {
  const subject = "Mexico data-center opportunity";
  const body = `Hello {{name}}. ${facts.facts[0]?.approved_wording} Could this fit a requirement or someone in your network?\n--\n${facts.approved_sender_name_title}\n${facts.legal_sender_entity}\n${facts.postal_address}\n${facts.opt_out_instructions}`;
  const draft = await store.drafts.insert({
    contact_id: contact.id,
    version: 1,
    subject,
    body,
    body_hash: bodyHash(subject, body),
    fact_version_hash: facts.version_hash,
    contact_email: contact.work_email ?? "",
    sender_address: sender,
    invalidated: false,
    personalization_claims: [
      {
        text: "occupier representation",
        evidence_url: "https://example-capital-advisors.test/practices/data-centers",
      },
    ],
    arc_claim_ids: ["cautious_mexico_intro"],
    word_count: 90,
  });
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
  await store.drafts.insert({ ...draft, id: draft.id });
  return { ...draft, approval_hash: hash };
}

export const testCfg = {
  NODE_ENV: "test" as const,
  LIVE_SEND_ENABLED: true,
  DRY_RUN: false,
  DAILY_SEND_CAP: 5,
  GMAIL_SENDER: "outreach@arc.test",
};
