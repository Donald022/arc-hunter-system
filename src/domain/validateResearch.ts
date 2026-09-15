import { z } from "zod";
import type { EvidenceInput, HardGateInput } from "../domain/scoring.ts";
import { scoreCandidate, qualificationBin, splitPotentials } from "../domain/scoring.ts";
import type { ScoreBreakdown } from "../domain/types.ts";

const pointBlock = z.object({
  points: z.number(),
  reason: z.string(),
  url: z.string().url().optional(),
});

export const researchSuggestionSchema = z.object({
  hard_gate: z.object({
    hasDcDemandOrOccupier: z.boolean(),
    hasSiteOrPowerInfra: z.boolean(),
    hasRelevantExpansionOrDeal: z.boolean(),
    hasIntroPath: z.boolean(),
    genericCreOnly: z.boolean().default(false),
    genericCloudSalesOnly: z.boolean().default(false),
    staleTitleUncorroborated: z.boolean().default(false),
  }),
  evidence: z.object({
    dcSpecialty: pointBlock.optional(),
    buyerOrTenant: pointBlock.optional(),
    hyperscale: pointBlock.optional(),
    expansion: pointBlock.optional(),
    influence: pointBlock.optional(),
    geo: z
      .object({
        kind: z.enum(["mexico", "latam", "international", "none"]),
        reason: z.string().optional(),
        url: z.string().url().optional(),
      })
      .optional(),
    personalization: pointBlock.optional(),
  }),
  summary: z.string(),
  contradictions: z.array(z.string()).default([]),
  suggested_role: z.enum(["Direct Buyer", "Intermediary", "Introducer"]).optional(),
});

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
  score: ScoreBreakdown;
  bin: ReturnType<typeof qualificationBin>;
  potentials: ReturnType<typeof splitPotentials>;
}

function zeroIfUncited<T extends { points?: number; url?: string } | undefined>(
  block: T,
  requireUrl: boolean,
): T {
  if (!block) return block;
  if (requireUrl && !block.url) {
    return { ...block, points: 0 } as T;
  }
  return block;
}

export function validateResearch(
  raw: unknown,
  opts: { knownUrls: string[]; override?: { reason: string } } = { knownUrls: [] },
): ValidationResult {
  const parsed = researchSuggestionSchema.parse(raw);
  const reasons: string[] = [];
  if (parsed.contradictions.length) reasons.push("source_contradiction");

  const known = new Set(opts.knownUrls.map((u) => u.toLowerCase()));
  const checkUrl = (url?: string, label?: string) => {
    if (!url) return;
    if (!known.size) return;
    if (!known.has(url.toLowerCase())) reasons.push(`uncited_url:${label}`);
  };

  const ev = parsed.evidence;
  checkUrl(ev.dcSpecialty?.url, "dcSpecialty");
  checkUrl(ev.buyerOrTenant?.url, "buyerOrTenant");
  checkUrl(ev.hyperscale?.url, "hyperscale");
  checkUrl(ev.expansion?.url, "expansion");
  checkUrl(ev.influence?.url, "influence");
  checkUrl(ev.geo?.url, "geo");
  checkUrl(ev.personalization?.url, "personalization");

  const evidence: EvidenceInput = {
    dcSpecialty: zeroIfUncited(ev.dcSpecialty, true),
    buyerOrTenant: zeroIfUncited(ev.buyerOrTenant, true),
    hyperscale: zeroIfUncited(ev.hyperscale, true),
    expansion: zeroIfUncited(ev.expansion, false),
    influence: zeroIfUncited(ev.influence, false),
    geo: ev.geo,
    personalization: zeroIfUncited(ev.personalization, true),
  };
  const hard: HardGateInput = parsed.hard_gate;
  const score = scoreCandidate(evidence, hard);
  const bin = qualificationBin(score, opts.override);
  return {
    ok: reasons.length === 0,
    reasons,
    score,
    bin,
    potentials: splitPotentials(score),
  };
}

export function researchFromEvidence(input: EvidenceInput, hard: HardGateInput): ValidationResult {
  const score = scoreCandidate(input, hard);
  return {
    ok: true,
    reasons: [],
    score,
    bin: qualificationBin(score),
    potentials: splitPotentials(score),
  };
}
