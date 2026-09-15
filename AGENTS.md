# ARC Hunter System — agent notes

TypeScript (strict) + Fastify service. PostgreSQL in a private `arc` schema on Supabase is the transaction ledger. Notion is the human CRM mirror. Slack is approval. Gmail is the only sender.

## Rules

- Never send a real email, buy enrichment credits, publish an endpoint, or change production Notion records unless Donald explicitly authorizes it.
- Do not install, run, or configure a local model, Ollama, GPU inference, or model containers.
- Live AI calls require `LLM_LIVE_ENABLED=true` and `LLM_BILLING_TIER=paid`. Fail closed otherwise.
- Business rules live in TypeScript (`src/domain`, `src/jobs`). CLI, HTTP, and n8n must call the same functions.
- Default `DRY_RUN=true` and `LIVE_SEND_ENABLED=false`.
- Do not invent ARC facts. Approved outreach wording comes from `config/arc_external_facts.example.json` / the Notion facts record.

## Commands

```
npm install
npm run typecheck
npm test
npm run migrate
npm run demo:fixtures
```

`SETUP.md` lists remaining credentials and blockers.
