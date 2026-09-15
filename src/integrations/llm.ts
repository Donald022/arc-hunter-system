import { getConfig, type AppConfig } from "../config.ts";
import type { Store } from "../db/types.ts";
import { getStore } from "../db/pool.ts";
import { inc } from "../metrics.ts";
import { logger } from "../logger.ts";
import {
  draftOutputSchema,
  researchOutputSchema,
  type DraftLlmOutput,
  type ResearchLlmOutput,
} from "../prompts/schemas.ts";

export type LlmTask = "research" | "draft";

export interface LlmRequest {
  task: LlmTask;
  system: string;
  user: string;
  containsRealContact: boolean;
  containsNonpublicArcFacts: boolean;
}

export interface LlmResult<T> {
  ok: true;
  data: T;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  provider: string;
  model: string;
}

export interface LlmFailure {
  ok: false;
  code:
    | "live_disabled"
    | "unpaid_tier"
    | "budget_exhausted"
    | "quota"
    | "provider_error"
    | "parse_error"
    | "missing_credentials";
  message: string;
}

export type LlmResponse<T> = LlmResult<T> | LlmFailure;

const INPUT_USD_PER_M = 0.3;
const OUTPUT_USD_PER_M = 2.5;

export function estimateUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_USD_PER_M + (outputTokens / 1_000_000) * OUTPUT_USD_PER_M
  );
}

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function isSensitive(req: LlmRequest): boolean {
  return req.containsRealContact || req.containsNonpublicArcFacts;
}

export class LlmAdapter {
  constructor(
    private readonly store: Store = getStore(),
    private readonly cfg: AppConfig = getConfig(),
    private readonly fixtureFn?: (req: LlmRequest) => unknown,
  ) {}

  async completeResearch(req: LlmRequest): Promise<LlmResponse<ResearchLlmOutput>> {
    return this.complete(req, (raw) => researchOutputSchema.parse(raw));
  }

  async completeDraft(req: LlmRequest): Promise<LlmResponse<DraftLlmOutput>> {
    return this.complete(req, (raw) => draftOutputSchema.parse(raw));
  }

  private async complete<T>(req: LlmRequest, parse: (raw: unknown) => T): Promise<LlmResponse<T>> {
    const gate = await this.preflight(req);
    if (!gate.ok) return gate;

    try {
      const raw = await this.callProvider(req);
      const data = parse(raw.json);
      await this.store.llm.add(utcDay(), 1, raw.inputTokens, raw.outputTokens, raw.estimatedUsd);
      inc("ai_requests");
      inc("ai_input_tokens", raw.inputTokens);
      inc("ai_output_tokens", raw.outputTokens);
      inc("ai_estimated_usd", raw.estimatedUsd);
      return {
        ok: true,
        data,
        inputTokens: raw.inputTokens,
        outputTokens: raw.outputTokens,
        estimatedUsd: raw.estimatedUsd,
        provider: this.cfg.LLM_PROVIDER,
        model: this.cfg.LLM_MODEL,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || /quota/i.test(msg)) {
        return { ok: false, code: "quota", message: msg };
      }
      if (msg.includes("parse") || msg.includes("Zod")) {
        return { ok: false, code: "parse_error", message: msg };
      }
      logger.warn("llm provider error", { error: msg });
      return { ok: false, code: "provider_error", message: msg };
    }
  }

  async preflight(req: LlmRequest): Promise<LlmResponse<never> | { ok: true }> {
    const sensitive = isSensitive(req);
    const live = this.cfg.LLM_LIVE_ENABLED && this.cfg.LLM_PROVIDER !== "fixture";

    if (sensitive && this.cfg.LLM_BILLING_TIER !== "paid" && live) {
      return {
        ok: false,
        code: "unpaid_tier",
        message: "Real contact or nonpublic ARC facts cannot use the unpaid Gemini tier",
      };
    }
    if (live && this.cfg.LLM_BILLING_TIER !== "paid" && sensitive) {
      return {
        ok: false,
        code: "unpaid_tier",
        message: "LLM_BILLING_TIER must be paid for real-contact jobs",
      };
    }
    if (this.cfg.LLM_PROVIDER !== "fixture" && !live) {
      return {
        ok: false,
        code: "live_disabled",
        message: "LLM_LIVE_ENABLED=false; using live provider blocked",
      };
    }
    if (live && !this.cfg.LLM_API_KEY) {
      return { ok: false, code: "missing_credentials", message: "LLM_API_KEY missing" };
    }

    const reservedUsd = estimateUsd(
      this.cfg.LLM_RESERVED_INPUT_TOKENS,
      this.cfg.LLM_RESERVED_OUTPUT_TOKENS,
    );
    const usage = await this.store.llm.getDay(utcDay());
    if (usage.requests + 1 > this.cfg.DAILY_LLM_REQUEST_CAP) {
      return { ok: false, code: "budget_exhausted", message: "daily LLM request cap reached" };
    }
    if (usage.estimated_usd + reservedUsd > this.cfg.DAILY_LLM_USD_CAP) {
      return { ok: false, code: "budget_exhausted", message: "daily LLM USD cap reached" };
    }
    return { ok: true };
  }

  private async callProvider(req: LlmRequest): Promise<{
    json: unknown;
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
  }> {
    if (this.cfg.LLM_PROVIDER === "fixture" || this.fixtureFn) {
      const json = this.fixtureFn ? this.fixtureFn(req) : defaultFixture(req);
      const inputTokens = Math.ceil((req.system.length + req.user.length) / 4);
      const outputTokens = Math.ceil(JSON.stringify(json).length / 4);
      return {
        json,
        inputTokens,
        outputTokens,
        estimatedUsd: estimateUsd(inputTokens, outputTokens),
      };
    }
    return geminiComplete(req, this.cfg);
  }
}

export async function geminiComplete(
  req: LlmRequest,
  cfg: AppConfig,
): Promise<{ json: unknown; inputTokens: number; outputTokens: number; estimatedUsd: number }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.LLM_MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": cfg.LLM_API_KEY ?? "",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  if (res.status === 429) throw new Error("429 quota");
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const json = JSON.parse(text) as unknown;
  const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
  return { json, inputTokens, outputTokens, estimatedUsd: estimateUsd(inputTokens, outputTokens) };
}

function defaultFixture(req: LlmRequest): unknown {
  if (req.task === "research") {
    return {
      hard_gate: {
        hasDcDemandOrOccupier: req.user.includes("data-center") || req.user.includes("hyperscale"),
        hasSiteOrPowerInfra: req.user.includes("site") || req.user.includes("power"),
        hasRelevantExpansionOrDeal: req.user.includes("lease") || req.user.includes("MW"),
        hasIntroPath: req.user.includes("broker") || req.user.includes("introduc"),
        genericCreOnly: req.user.includes("GENERIC_CRE"),
        genericCloudSalesOnly: false,
        staleTitleUncorroborated: false,
      },
      evidence: {
        dcSpecialty: { points: 20, reason: "fixture", url: "https://example.test/evidence" },
        buyerOrTenant: { points: 20, reason: "fixture", url: "https://example.test/evidence" },
        hyperscale: { points: 10, reason: "fixture", url: "https://example.test/evidence" },
        expansion: { points: 5, reason: "fixture" },
        influence: { points: 8, reason: "fixture" },
        geo: { kind: "none" },
        personalization: { points: 3, reason: "fixture", url: "https://example.test/evidence" },
      },
      summary: "Fixture research summary.",
      contradictions: [],
      suggested_role: "Intermediary",
    };
  }
  return {
    subject: "Mexico data-center opportunity",
    body: "Hello {{name}}. We are evaluating a data-center development opportunity in Mexico and beginning conversations with potential anchor tenants. Your public practice bio describes occupier representation for hyperscale leases, which is why we are writing. This note is a first conversation only. Could this fit a requirement you are working or someone in your network who handles capacity? We can share more detail if useful. Thank you for considering a short reply, and please ignore this if the topic is not relevant to your work this year or next.",
    personalization_claims: [],
    arc_claim_ids: [],
    target_role: "Intermediary",
    word_count: 48,
  };
}

export const llm = new LlmAdapter();
