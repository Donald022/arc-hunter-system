import type { ScoreBreakdown } from "./types.ts";

export const SCORE_CAPS = {
  dc_specialty: 25,
  buyer_or_tenant: 25,
  hyperscale_experience: 15,
  expansion_signal: 10,
  influence: 10,
  geo_bonus: 10,
  personalization: 5,
} as const;

export const QUALIFY_THRESHOLD = 70;
export const REVIEW_THRESHOLD = 50;

export interface EvidenceInput {
  dcSpecialty?: { points: number; reason: string; url?: string };
  buyerOrTenant?: { points: number; reason: string; url?: string };
  hyperscale?: { points: number; reason: string; url?: string };
  expansion?: { points: number; reason: string; url?: string };
  influence?: { points: number; reason: string; url?: string };
  geo?: { kind: "mexico" | "latam" | "international" | "none"; reason?: string; url?: string };
  personalization?: { points: number; reason: string; url?: string };
}

export const HARD_GATE_CODES = {
  DC_DEMAND: "dc_demand_or_occupier",
  SITE_OR_POWER: "site_selection_or_power_infra",
  EXPANSION_OR_DEAL: "relevant_expansion_or_deal",
  INTRO_PATH: "direct_introduction_path",
} as const;

export interface HardGateInput {
  hasDcDemandOrOccupier: boolean;
  hasSiteOrPowerInfra: boolean;
  hasRelevantExpansionOrDeal: boolean;
  hasIntroPath: boolean;
  genericCreOnly?: boolean;
  genericCloudSalesOnly?: boolean;
  staleTitleUncorroborated?: boolean;
}

export function evaluateHardGate(input: HardGateInput): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.genericCreOnly) reasons.push("generic_cre");
  if (input.genericCloudSalesOnly) reasons.push("generic_cloud_sales");
  if (input.staleTitleUncorroborated) reasons.push("stale_title_no_corroboration");
  if (reasons.length) return { pass: false, reasons };

  const positive: string[] = [];
  if (input.hasDcDemandOrOccupier) positive.push(HARD_GATE_CODES.DC_DEMAND);
  if (input.hasSiteOrPowerInfra) positive.push(HARD_GATE_CODES.SITE_OR_POWER);
  if (input.hasRelevantExpansionOrDeal) positive.push(HARD_GATE_CODES.EXPANSION_OR_DEAL);
  if (input.hasIntroPath) positive.push(HARD_GATE_CODES.INTRO_PATH);
  if (!positive.length) return { pass: false, reasons: ["no_verifiable_dc_connection"] };
  return { pass: true, reasons: positive };
}

function clamp(n: number, max: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, Math.round(n));
}

function geoPoints(
  kind: EvidenceInput["geo"] extends infer T ? (T extends { kind: infer K } ? K : never) : never,
): number {
  if (kind === "mexico") return 7;
  if (kind === "latam" || kind === "international") return 3;
  return 0;
}

export function scoreCandidate(input: EvidenceInput, hardGate: HardGateInput): ScoreBreakdown {
  const gate = evaluateHardGate(hardGate);
  const dc = clamp(input.dcSpecialty?.points ?? 0, SCORE_CAPS.dc_specialty);
  const buyer = clamp(input.buyerOrTenant?.points ?? 0, SCORE_CAPS.buyer_or_tenant);
  const hyper = clamp(input.hyperscale?.points ?? 0, SCORE_CAPS.hyperscale_experience);
  const exp = clamp(input.expansion?.points ?? 0, SCORE_CAPS.expansion_signal);
  const infl = clamp(input.influence?.points ?? 0, SCORE_CAPS.influence);
  const geo = clamp(geoPoints(input.geo?.kind ?? "none"), SCORE_CAPS.geo_bonus);
  const pers = clamp(input.personalization?.points ?? 0, SCORE_CAPS.personalization);

  const reason_codes: string[] = [];
  if (dc) reason_codes.push("dc_specialty");
  if (buyer) reason_codes.push("buyer_or_tenant");
  if (hyper) reason_codes.push("hyperscale_experience");
  if (exp) reason_codes.push("expansion_signal");
  if (infl) reason_codes.push("influence");
  if (geo === 7) reason_codes.push("mexico_bonus");
  else if (geo === 3) reason_codes.push("latam_or_international_bonus");
  if (pers) reason_codes.push("personalization");
  reason_codes.push(...gate.reasons);

  const total = Math.min(100, dc + buyer + hyper + exp + infl + geo + pers);
  return {
    dc_specialty: dc,
    buyer_or_tenant: buyer,
    hyperscale_experience: hyper,
    expansion_signal: exp,
    influence: infl,
    geo_bonus: geo,
    personalization: pers,
    total,
    reason_codes,
    hard_gate_pass: gate.pass,
    hard_gate_reasons: gate.reasons,
  };
}

export type QualificationBin = "qualified" | "review" | "disqualify";

export function qualificationBin(
  score: ScoreBreakdown,
  override?: { reason: string },
): QualificationBin {
  if (override?.reason) {
    return score.hard_gate_pass
      ? score.total >= REVIEW_THRESHOLD
        ? "qualified"
        : "review"
      : "review";
  }
  if (!score.hard_gate_pass) return "disqualify";
  if (score.total >= QUALIFY_THRESHOLD) return "qualified";
  if (score.total >= REVIEW_THRESHOLD) return "review";
  return "disqualify";
}

export function splitPotentials(score: ScoreBreakdown): {
  direct_buyer_potential: number;
  connection_potential: number;
} {
  const direct = Math.min(
    10,
    Math.round(
      (score.buyer_or_tenant / SCORE_CAPS.buyer_or_tenant) * 6 +
        (score.hyperscale_experience / SCORE_CAPS.hyperscale_experience) * 4,
    ),
  );
  const connection = Math.min(
    10,
    Math.round(
      (score.influence / SCORE_CAPS.influence) * 5 +
        (score.dc_specialty / SCORE_CAPS.dc_specialty) * 3 +
        (score.expansion_signal / SCORE_CAPS.expansion_signal) * 2,
    ),
  );
  return { direct_buyer_potential: direct, connection_potential: connection };
}
