import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { ApprovedFact, ApprovedFactsBundle } from "./types.ts";

export const RESTRICTED_CLAIM_PATTERNS = [
  /75\s*mw\s+secured/i,
  /75\s*mw\s+available\s+for\s+it/i,
  /shovel[\s-]?ready/i,
  /we represent/i,
  /utility power.{0,40}secured/i,
  /land control.{0,20}secured/i,
];

export const factSchema = z.object({
  id: z.string().min(1),
  claim: z.string().default(""),
  basis: z.string().default(""),
  evidence_url_or_document: z.string().default(""),
  approved_wording: z.string().default(""),
  approved_by: z.string().default(""),
  approved_at: z.string().default(""),
  valid_until: z.string().default(""),
  can_use_in_first_touch: z.boolean().default(false),
});

export const factsBundleSchema = z.object({
  utility_mw_current_verified: z.string().default(""),
  utility_mw_target: z.string().default(""),
  it_mw_planned: z.string().default(""),
  land_control_status: z.string().default(""),
  site_location_disclosure: z.string().default(""),
  target_rfs_status: z.string().default(""),
  legal_sender_entity: z.string().default(""),
  approved_sender_name_title: z.string().default(""),
  reply_to: z.string().default(""),
  postal_address: z.string().default(""),
  opt_out_instructions: z.string().default(""),
  restricted_claims: z.array(z.string()).default([]),
  facts: z.array(factSchema).default([]),
});

export function hashFacts(bundle: Omit<ApprovedFactsBundle, "version_hash" | "loaded_at">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        legal: bundle.legal_sender_entity,
        sender: bundle.approved_sender_name_title,
        reply: bundle.reply_to,
        postal: bundle.postal_address,
        opt: bundle.opt_out_instructions,
        facts: bundle.facts.map((f) => ({
          id: f.id,
          wording: f.approved_wording,
          until: f.valid_until,
          use: f.can_use_in_first_touch,
        })),
      }),
    )
    .digest("hex");
}

export function loadFactsFromObject(raw: unknown, loadedAt = new Date().toISOString()): ApprovedFactsBundle {
  const parsed = factsBundleSchema.parse(raw);
  const version_hash = hashFacts(parsed);
  return { ...parsed, version_hash, loaded_at: loadedAt };
}

export function loadFactsFromFile(path = resolve(process.cwd(), "config/arc_external_facts.example.json")): ApprovedFactsBundle {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return loadFactsFromObject(raw);
}

export function firstTouchWording(bundle: ApprovedFactsBundle): string[] {
  const now = Date.now();
  return bundle.facts
    .filter((f) => f.can_use_in_first_touch && f.approved_wording.trim())
    .filter((f) => {
      if (!f.valid_until) return true;
      const t = Date.parse(f.valid_until);
      return Number.isNaN(t) ? false : t > now;
    })
    .map((f) => f.approved_wording);
}

export function usableFactIds(bundle: ApprovedFactsBundle): Set<string> {
  const now = Date.now();
  return new Set(
    bundle.facts
      .filter((f) => f.can_use_in_first_touch && f.approved_wording.trim())
      .filter((f) => {
        if (!f.valid_until) return true;
        const t = Date.parse(f.valid_until);
        return Number.isNaN(t) ? false : t > now;
      })
      .map((f) => f.id),
  );
}

export function senderCompliance(bundle: ApprovedFactsBundle): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!bundle.legal_sender_entity.trim()) missing.push("legal_sender_entity");
  if (!bundle.approved_sender_name_title.trim()) missing.push("approved_sender_name_title");
  if (!bundle.reply_to.trim()) missing.push("reply_to");
  if (!bundle.postal_address.trim()) missing.push("postal_address");
  if (!bundle.opt_out_instructions.trim()) missing.push("opt_out_instructions");
  return { ok: missing.length === 0, missing };
}

export function containsRestrictedClaim(text: string, bundle: ApprovedFactsBundle): string[] {
  const hits: string[] = [];
  for (const re of RESTRICTED_CLAIM_PATTERNS) {
    if (re.test(text)) hits.push(re.source);
  }
  for (const extra of bundle.restricted_claims) {
    if (extra && text.toLowerCase().includes(extra.toLowerCase())) hits.push(extra);
  }
  return hits;
}

export function validateArcClaims(
  claimIds: string[],
  body: string,
  bundle: ApprovedFactsBundle,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const allowed = usableFactIds(bundle);
  for (const id of claimIds) {
    if (!allowed.has(id)) reasons.push(`unapproved_or_expired_claim:${id}`);
  }
  const restricted = containsRestrictedClaim(body, bundle);
  for (const r of restricted) reasons.push(`restricted_claim:${r}`);

  const factById = new Map(bundle.facts.map((f) => [f.id, f]));
  for (const id of claimIds) {
    const fact = factById.get(id);
    if (fact?.approved_wording && !body.includes(fact.approved_wording) && fact.can_use_in_first_touch) {
      reasons.push(`wording_not_in_body:${id}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function emptyFacts(): ApprovedFactsBundle {
  return loadFactsFromObject({
    utility_mw_current_verified: "",
    utility_mw_target: "",
    it_mw_planned: "",
    land_control_status: "",
    site_location_disclosure: "",
    target_rfs_status: "",
    legal_sender_entity: "",
    approved_sender_name_title: "",
    reply_to: "",
    postal_address: "",
    opt_out_instructions: "",
    restricted_claims: [],
    facts: [],
  });
}

export type { ApprovedFact, ApprovedFactsBundle };
