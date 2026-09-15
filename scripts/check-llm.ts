import { loadConfig, resetConfigCache } from "../src/config.ts";

async function main() {
  resetConfigCache();
  const cfg = loadConfig();
  console.log(
    JSON.stringify({
      provider: cfg.LLM_PROVIDER,
      model: cfg.LLM_MODEL,
      billing: cfg.LLM_BILLING_TIER,
      live: cfg.LLM_LIVE_ENABLED,
      key_present: Boolean(cfg.LLM_API_KEY),
      key_len: cfg.LLM_API_KEY?.length ?? 0,
      live_send: cfg.LIVE_SEND_ENABLED,
      daily_usd_cap: cfg.DAILY_LLM_USD_CAP,
      daily_req_cap: cfg.DAILY_LLM_REQUEST_CAP,
    }),
  );
  if (!cfg.LLM_API_KEY || cfg.LLM_PROVIDER !== "gemini" || !cfg.LLM_LIVE_ENABLED) {
    process.exit(1);
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.LLM_MODEL)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": cfg.LLM_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with the single word pong." }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8 },
    }),
  });
  const body = (await res.json()) as {
    error?: { message?: string; status?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  console.log(
    JSON.stringify({
      http_ok: res.ok,
      status: res.status,
      error_status: body.error?.status,
      error_message: body.error?.message?.slice(0, 180),
      input_tokens: body.usageMetadata?.promptTokenCount,
      output_tokens: body.usageMetadata?.candidatesTokenCount,
      note: "synthetic ping only; no contact names or ARC facts",
    }),
  );
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
