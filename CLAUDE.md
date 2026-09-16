# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pilot service that discovers, ranks, drafts, and (after Slack approval) sends **exactly one** first-touch email to potential ARC MX I data-center anchor-tenant intermediaries and buyers. TypeScript (strict) + Fastify. PostgreSQL in a private `arc` schema on Supabase is the transaction ledger; Notion mirrors it for humans; Slack is the approval gate; Gmail is the only sender.

The system defaults to a fully safe dry-run mode: no live email, no paid AI calls, no production Notion writes. See `SETUP.md` for credentials, deployment, and outstanding blockers.

## Safety rules (do not bypass)

- Never send a real email, buy enrichment credits, publish a public endpoint, or change production Notion records unless Donald explicitly authorizes it.
- Do not install, run, or configure a local model, Ollama, GPU inference, or model containers — hosted AI only.
- Live AI calls require `LLM_LIVE_ENABLED=true` AND `LLM_BILLING_TIER=paid`; code must fail closed otherwise.
- `DRY_RUN=true` and `LIVE_SEND_ENABLED=false` are the safe defaults; `loadConfig()` (`src/config.ts`) throws if `LIVE_SEND_ENABLED=true` while `DRY_RUN=true`, and throws if `DASHBOARD_FIXTURE_LOGIN=true` while `NODE_ENV=production`.
- Do not invent ARC facts or outreach wording. Approved wording comes only from `config/arc_external_facts.example.json` / the loaded facts bundle (`src/domain/facts.ts`) — see "Facts and compliance" below.
- Business rules live in `src/domain` and `src/jobs`. CLI (`src/cli.ts`), HTTP (`src/app.ts`), and n8n (`n8n/daily-jobs.json`) must all call the same job functions — don't duplicate logic in a route handler.

## Commands

```bash
npm install
npm run typecheck
npm test                 # vitest run (single worker, sequential — see below)
npm run test:watch
npm run dev
npm run migrate
npm run build
npm run format / format:check

# CLI pipeline commands (in-memory store, seeded with default campaigns)
npm run discover   -- --hunter broker|tenant|expansion|deal|network
npm run research   -- --limit N
npm run draft      -- --limit N
npm run reconcile
npm run replies
npm run demo:fixtures   # runs discover -> research -> draft end-to-end on fixtures, prints summary
```

- Run a single test file: `npx vitest run tests/scoring.test.ts`
- Run a single test by name: `npx vitest run tests/scoring.test.ts -t "test name"`
- `vitest.config.ts` sets `fileParallelism: false` and non-concurrent sequencing — tests share mutable singletons (config cache, active store) via `tests/setup.ts` / `tests/helpers.ts`, so don't parallelize or add `.concurrent`.
- `tests/setup.ts` forces `LLM_PROVIDER=fixture`, `LLM_LIVE_ENABLED=false`, `DRY_RUN=true`, `LIVE_SEND_ENABLED=false` globally; individual tests override via `getConfig`/`resetConfigCache` or `tests/helpers.ts` (`useTestStore`, `approvedFacts`, `seedQualifiedContact`, `seedDraft`).
- Postgres is optional for tests and `demo:fixtures` — without `DATABASE_URL` set, `getStore()` (`src/db/pool.ts`) falls back to the in-memory `MemoryStore`.

## Architecture

### Pipeline (jobs)

The core flow is a chain of idempotent jobs in `src/jobs/`, each callable from CLI, HTTP (`POST /internal/jobs/:job`), or n8n, and each taking an injectable `store: Store`:

1. **discover** (`src/jobs/discover.ts`) — for each enabled `CampaignRecord` (or one `--hunter`), runs `runHunter` (`src/hunters/index.ts`) against sources in `config/sources.yml` (parsed via `src/hunters/registry.ts`, executed via `src/hunters/parsers.ts` — rss/html/csv/page/fixture parsers). Upserts `CompanyRecord`/`ContactRecord`/`EvidenceRecord`, always persists for visibility even in dry-run (only _expensive_ ops — enrichment, live email, prod Notion — are gated). Blocked by `requireDiscoveryAllowed` (`src/jobs/controls.ts`) when discovery is paused.
2. **research** — enriches discovered contacts (optionally via Apollo, gated by `APOLLO_ENABLED`), scores them (`src/domain/scoring.ts`), and applies hard gates/state transitions.
3. **draft** — generates the first-touch email via the LLM (`src/integrations/llm.ts`, prompts in `src/prompts/*.md`, schemas in `src/prompts/schemas.ts`), validates every claim against the approved facts bundle (`src/domain/facts.ts`), and produces a `DraftRecord`.
4. **reconcile** — reconciles ledger state with Notion / external state.
5. **replies** — polls for Gmail replies and updates contact state.

All state changes go through the `ContactState` machine in `src/domain/states.ts` (`CONTACT_STATES`, `ALLOWED` transition map, `assertTransition`). Never mutate `ContactRecord.state` directly — go through `canTransition`/`assertTransition`, and check `forbidsAutoSend` before any send-adjacent action. Terminal safety states (`REPLIED`, `DNC`, `DISQUALIFIED`, `BOUNCED`, `MANUAL_HANDOFF`) never auto-resume.

Sending itself is additionally gated by `requireOutboundAllowed` (`src/jobs/controls.ts`): requires `!outbound_paused`, `LIVE_SEND_ENABLED=true`, `!DRY_RUN`. `assertLiveSendReady` (`src/app.ts`) is checked at server startup and refuses to start with `LIVE_SEND_ENABLED=true` unless sender compliance, Gmail creds, and Slack approvers are all present.

### Storage abstraction

`src/db/types.ts` defines the `Store` interface (contacts, companies, evidence, drafts, signals, campaigns, jobs, events, pause, audit, etc.). Two implementations:

- `src/db/memory.ts` — `MemoryStore`, in-memory, used by CLI/tests/demo.
- `src/db/postgres.ts` — `PostgresStore`, backed by `pg`, schema set via `DB_SCHEMA` (`arc` in prod, `arc_test` for migration tests).

`src/db/pool.ts` (`getStore()`) picks Postgres if `DATABASE_URL` is set, else memory; `setStore`/`useMemoryStore` let CLI and tests force a specific store. Schema lives in `migrations/001_init.sql`, applied via `npm run migrate` (`src/db/migrate.ts`).

### Facts and compliance (`src/domain/facts.ts`)

All outward-facing claims are gated by an `ApprovedFactsBundle` loaded from `config/arc_external_facts.example.json` (or the Notion facts record) via `loadFactsFromFile`/`loadFactsFromObject`, cached by `src/jobs/factsLoader.ts` (`loadFactsCached`). Each fact has `can_use_in_first_touch` and `valid_until`; `usableFactIds`/`firstTouchWording` filter to currently-usable facts. `validateArcClaims` checks a draft's `arc_claim_ids` are all approved/unexpired, the approved wording literally appears in the body, and the body doesn't match any `RESTRICTED_CLAIM_PATTERNS` (e.g. "75 MW secured", "shovel-ready", "we represent") or bundle-specific `restricted_claims`. `senderCompliance` checks legal entity, sender name, reply-to, postal address, and opt-out wording are all present — required before any live send. The bundle is content-hashed (`hashFacts`/`version_hash`) so drafts pin to the exact fact version they were generated against.

### Config (`src/config.ts`)

Single Zod schema (`configSchema`) parses `process.env` (plus a hand-rolled `.env` loader since `dotenv` isn't used) into a typed `AppConfig`, cached via `getConfig()`/`resetConfigCache()`. New env vars should be added here with sane, safe-by-default values (booleans default to `false`/off, dry-run defaults to `true`). `.env.example` documents all vars used in deployment.

### Dashboard (`src/dashboard/`)

Server-rendered operator UI mounted by `registerDashboard` in `src/app.ts`. `routes.ts` holds Fastify routes, `components.ts` renders HTML fragments, `styles.ts` holds the (dark "operations console" themed) CSS. Auth is either a labeled fixture login (`DASHBOARD_FIXTURE_LOGIN=true`, forbidden when `NODE_ENV=production`) or OIDC (`OIDC_*` vars). The dashboard cannot raise spend caps, edit approved facts, or send email — those are separate privileged paths.

### Integrations (`src/integrations/`)

Thin clients for external services, each respecting the relevant feature flag/cap: `llm.ts` (Gemini, gated by `LLM_LIVE_ENABLED`/`LLM_BILLING_TIER`/daily USD & request caps), `gmail.ts` (OAuth send/read, gated by `LIVE_SEND_ENABLED`), `notion.ts` (CRM mirror, data-source API `2025-09-03`), `slack.ts` (approval buttons + HMAC signature verification via `verifySlackSignature`).

### HTTP surface (`src/app.ts`)

- `GET /health` — public, reports `dry_run`/`live_send`/`llm_live`/schema flags.
- `GET /metrics` — public, `src/metrics.ts` in-process counters snapshot.
- `POST /internal/jobs/:job` — bearer `INTERNAL_JOB_TOKEN`, dispatches to discover/research/draft/reconcile/replies.
- `POST /slack/actions` — verifies Slack signature before processing approval button clicks.
- `/dashboard/*` — operator UI.

## Conventions

- Run `npm run format` before committing.
- Hunters are one of exactly five: `broker | tenant | expansion | deal | network` (`HUNTERS` in `src/domain/types.ts`) — this list is threaded through campaigns, sources, scoring, and CLI flags; adding a hunter means updating all of those.
