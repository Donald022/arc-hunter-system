import { createHash } from "node:crypto";
import { getConfig } from "../config.ts";
import { getStore } from "../db/pool.ts";
import type { Store } from "../db/types.ts";
import { senderCompliance, validateArcClaims, type ApprovedFactsBundle } from "../domain/facts.ts";
import { loadFactsCached } from "./factsLoader.ts";
import { LlmAdapter } from "../integrations/llm.ts";
import { draftSystemPrompt, type DraftLlmOutput } from "../prompts/schemas.ts";
import { inc } from "../metrics.ts";
import { logger } from "../logger.ts";
import type { ContactRecord, DraftRecord } from "../domain/types.ts";

const MIN_WORDS = 80;
const MAX_WORDS = 140;

export function wordCount(body: string, footer: string): number {
  const stripped = body.replace(footer, "").replace(/\s+/g, " ").trim();
  if (!stripped) return 0;
  return stripped.split(" ").length;
}

export function bodyHash(subject: string, body: string): string {
  return createHash("sha256").update(`${subject}\n${body}`).digest("hex");
}

export function approvalHash(input: {
  draftId: string;
  version: number;
  factVersion: string;
  email: string;
  sender: string;
  subject: string;
  body: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.draftId,
        String(input.version),
        input.factVersion,
        input.email,
        input.sender,
        input.subject,
        input.body,
      ].join("|"),
    )
    .digest("hex");
}

export function buildFooter(facts: ApprovedFactsBundle): string {
  const lines = [
    "",
    `--`,
    facts.approved_sender_name_title || "[sender name/title not approved]",
    facts.legal_sender_entity || "[legal entity not approved]",
    facts.postal_address || "[postal address missing]",
    facts.reply_to ? `Reply-to: ${facts.reply_to}` : "[reply-to missing]",
    facts.opt_out_instructions || "[opt-out instructions missing]",
  ];
  return lines.join("\n");
}

export function validateDraftOutput(
  out: DraftLlmOutput,
  facts: ApprovedFactsBundle,
  evidenceUrls: string[],
  footer: string,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const claims = validateArcClaims(out.arc_claim_ids, out.body, facts);
  reasons.push(...claims.reasons);
  const wc = wordCount(out.body, footer);
  if (wc < MIN_WORDS || wc > MAX_WORDS) reasons.push(`word_count:${wc}`);
  for (const p of out.personalization_claims) {
    if (!evidenceUrls.includes(p.evidence_url))
      reasons.push(`personalization_uncited:${p.evidence_url}`);
    if (!out.body.includes(p.text) && p.text) reasons.push(`personalization_not_in_body`);
  }
  const banned = [/nda/i, /calendar/i, /guaranteed/i, /shovel/i, /we represent/i];
  for (const re of banned)
    if (re.test(out.body) || re.test(out.subject)) reasons.push(`banned:${re.source}`);
  return { ok: reasons.length === 0, reasons };
}

export async function draft(
  opts: { limit?: number; actor?: string; store?: Store; llm?: LlmAdapter } = {},
): Promise<{
  run_id: string;
  drafted: number;
  fact_review: number;
}> {
  const store = opts.store ?? getStore();
  const facts = await loadFactsCached();
  const job = await store.jobs.start("draft");
  const llm = opts.llm ?? new LlmAdapter(store);
  const qualified = (await store.contacts.list({ state: "QUALIFIED" })).slice(0, opts.limit ?? 10);
  let drafted = 0;
  let fact_review = 0;
  const footer = buildFooter(facts);
  const compliance = senderCompliance(facts);

  try {
    for (const contact of qualified) {
      if (contact.do_not_contact) continue;
      const suppressed = await store.suppression.isSuppressed(contact.work_email, undefined);
      if (suppressed) {
        await store.contacts.setState(contact.id, "DNC", "draft", "suppressed");
        continue;
      }
      if (!contact.work_email) {
        await store.contacts.setState(contact.id, "QUALIFIED_NO_EMAIL", "draft");
        continue;
      }
      if (!compliance.ok) {
        await store.contacts.setState(
          contact.id,
          "FACT_REVIEW",
          "draft",
          compliance.missing.join(","),
        );
        fact_review += 1;
        continue;
      }

      const evidence = await store.evidence.forContact(contact.id);
      const urls = evidence.map((e) => e.url);
      const user = JSON.stringify({
        approved_external_facts: {
          version: facts.version_hash,
          wording: facts.facts.filter((f) => f.can_use_in_first_touch),
        },
        contact: {
          name: "{{name}}",
          title: contact.title,
          company: "{{company}}",
          email: "{{email}}",
          role: contact.role,
        },
        evidence: evidence.map((e) => ({
          url: e.url,
          date: e.published_at,
          quote: e.quoted_text.slice(0, 200),
        })),
        reason_for_contact: contact.evidence_summary,
        direct_buyer_potential: contact.direct_buyer_potential,
        connection_potential: contact.connection_potential,
        campaign: contact.campaign_id,
        approved_sender: facts.approved_sender_name_title,
      });

      let produced: DraftLlmOutput | undefined;
      let reasons: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await llm.completeDraft({
          task: "draft",
          system: draftSystemPrompt(),
          user,
          containsRealContact: true,
          containsNonpublicArcFacts: true,
        });
        if (!res.ok) {
          reasons = [res.code];
          break;
        }
        const check = validateDraftOutput(res.data, facts, urls, footer);
        if (check.ok) {
          produced = res.data;
          reasons = [];
          break;
        }
        reasons = check.reasons;
        inc("draft_rejects");
      }

      if (!produced) {
        await store.contacts.setState(contact.id, "FACT_REVIEW", "draft", reasons.join(","));
        fact_review += 1;
        continue;
      }

      const body = `${produced.body.trim()}\n${footer}`;
      const latest = await store.drafts.latestForContact(contact.id);
      const version = (latest?.version ?? 0) + 1;
      const rec = await store.drafts.insert({
        contact_id: contact.id,
        version,
        subject: produced.subject,
        body,
        body_hash: bodyHash(produced.subject, body),
        fact_version_hash: facts.version_hash,
        contact_email: contact.work_email,
        sender_address: getConfig().GMAIL_SENDER ?? facts.reply_to,
        invalidated: false,
        personalization_claims: produced.personalization_claims,
        arc_claim_ids: produced.arc_claim_ids,
        word_count: wordCount(produced.body, footer),
      });
      await store.contacts.setState(contact.id, "DRAFT_READY", "draft");
      await store.contacts.setState(contact.id, "PENDING_APPROVAL", "draft");
      await store.events.add({
        contact_id: contact.id,
        type: "Drafted",
        actor: opts.actor ?? "draft",
        at: new Date().toISOString(),
        payload: { draft_id: rec.id, version },
      });
      drafted += 1;
    }
    await store.jobs.finish(job.id, "ok", { drafted, fact_review });
    logger.info("draft complete", { run_id: job.id });
    return { run_id: job.id, drafted, fact_review };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await store.jobs.finish(job.id, "error", undefined, msg);
    throw err;
  }
}

export function isApprovalValid(
  draft: DraftRecord,
  facts: ApprovedFactsBundle,
  email: string,
  sender: string,
): boolean {
  if (draft.invalidated) return false;
  if (draft.fact_version_hash !== facts.version_hash) return false;
  if (draft.contact_email !== email) return false;
  if (draft.sender_address !== sender) return false;
  if (!draft.approval_hash) return false;
  const expected = approvalHash({
    draftId: draft.id,
    version: draft.version,
    factVersion: draft.fact_version_hash,
    email: draft.contact_email,
    sender: draft.sender_address,
    subject: draft.subject,
    body: draft.body,
  });
  return draft.approval_hash === expected;
}
