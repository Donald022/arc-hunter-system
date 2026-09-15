import { describe, expect, it } from "vitest";
import { LlmAdapter, estimateUsd } from "../src/integrations/llm.ts";
import { MemoryStore } from "../src/db/memory.ts";
import { loadConfig, resetConfigCache, type AppConfig } from "../src/config.ts";

function cfg(partial: Partial<AppConfig>): AppConfig {
  resetConfigCache();
  process.env.LLM_PROVIDER = "gemini";
  process.env.LLM_LIVE_ENABLED = "true";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_BILLING_TIER = "paid";
  process.env.DAILY_LLM_USD_CAP = "0.20";
  process.env.DAILY_LLM_REQUEST_CAP = "50";
  return { ...loadConfig(), ...partial };
}

const req = {
  task: "research" as const,
  system: "sys",
  user: "Alex Rivera work email alex@example.com",
  containsRealContact: true,
  containsNonpublicArcFacts: true,
};

describe("hosted LLM adapter", () => {
  it("rejects real-contact inputs on the unpaid tier", async () => {
    const store = new MemoryStore();
    const llm = new LlmAdapter(
      store,
      cfg({ LLM_BILLING_TIER: "unpaid", LLM_LIVE_ENABLED: true, LLM_PROVIDER: "gemini" }),
    );
    const res = await llm.completeResearch(req);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("unpaid_tier");
  });

  it("blocks new calls after the daily application budget is spent", async () => {
    const store = new MemoryStore();
    await store.llm.add(new Date().toISOString().slice(0, 10), 0, 0, 0, 0.2);
    const llm = new LlmAdapter(
      store,
      cfg({
        DAILY_LLM_USD_CAP: 0.2,
        LLM_RESERVED_INPUT_TOKENS: 8000,
        LLM_RESERVED_OUTPUT_TOKENS: 1500,
      }),
    );
    const res = await llm.completeResearch(req);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("budget_exhausted");
  });

  it("parks work on provider 429/quota without bypassing the budget", async () => {
    const store = new MemoryStore();
    const llm = new LlmAdapter(store, cfg({ LLM_PROVIDER: "fixture" }), () => {
      throw new Error("429 quota");
    });
    const res = await llm.completeResearch({
      ...req,
      containsRealContact: false,
      containsNonpublicArcFacts: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("quota");
    const usage = await store.llm.getDay(new Date().toISOString().slice(0, 10));
    expect(usage.requests).toBe(0);
  });

  it("estimates model cost from the published flash-lite rates", () => {
    expect(estimateUsd(10_000, 2_000)).toBeCloseTo(0.008, 6);
  });
});
