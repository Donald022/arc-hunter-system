# SETUP

This service stays **dry-run** until Donald deliberately configures credentials, approved facts, and `LIVE_SEND_ENABLED=true`.

Do **not** send a real email, buy enrichment credits, publish a public endpoint, or change production Notion records during setup testing.

Hosted AI only. Do not install Ollama, local models, GPU inference, or model containers on the laptop.

## 1. Local commands

```bash
npm install
copy .env.example .env   # Windows
npm run typecheck
npm test
npm run demo:fixtures
```

Postgres is optional for the fixture test suite (in-memory ledger). To apply schema to the **arc hunter system dev** Supabase project:

1. Open Project Settings → Database.
2. Copy the **session pooler** URI (port **5432**, not 6543). Transaction/session mode is required for send reservations.
3. Put it in `.env` as `DATABASE_URL`.
4. `DB_SCHEMA=arc` for the app, or `DB_SCHEMA=arc_test` when running migrations for tests.
5. `npm run migrate`

The MCP connection can verify tables afterward; it cannot supply the database password.

## 2. Always-on host (do not use the laptop as production)

Laptop sleep stops hunts and Slack HTTPS. This repo now has a `Dockerfile` that binds `0.0.0.0`, runs `npm run migrate`, then starts the compiled server. **Do not copy `.env` into the image.** Set secrets in the host’s env UI.

Recommended first host: **Railway** (no gcloud CLI required). Keep `DRY_RUN=true` and `LIVE_SEND_ENABLED=false`.

1. Push this repo to GitHub (private).
2. [railway.app](https://railway.app) → New project → Deploy from GitHub → this repo.
3. Set variables (same names as `.env`). Required for a dry-run host:

```
NODE_ENV=production
LISTEN_HOST=0.0.0.0
PORT=8080
APP_BASE_URL=https://YOUR-RAILWAY-DOMAIN
DRY_RUN=true
LIVE_SEND_ENABLED=false
DASHBOARD_FIXTURE_LOGIN=false
DATABASE_URL=...
DB_SCHEMA=arc
NOTION_* (all mapped IDs)
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
SLACK_CHANNEL_ID
SLACK_APPROVER_IDS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GMAIL_SENDER
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash-lite
LLM_API_KEY
LLM_BILLING_TIER=paid
LLM_LIVE_ENABLED=true
INTERNAL_JOB_TOKEN
DASHBOARD_SESSION_SECRET
```

Generate new long random values for `INTERNAL_JOB_TOKEN` and `DASHBOARD_SESSION_SECRET` on the host. Do not reuse laptop demo strings.

4. After deploy, open `https://YOUR-DOMAIN/health`. You should see `"ok":true,"live_send":false`.
5. Slack app → Interactivity → Request URL: `https://YOUR-DOMAIN/slack/actions` → Save.
6. Optional later: custom domain `hunter.noaintelligence.xyz`.

Expose only:

- `GET /health`
- `POST /slack/actions` (Slack signing secret)
- `POST /internal/jobs/*` (bearer `INTERNAL_JOB_TOKEN`, not public)
- `/dashboard/*` (OIDC later; fixture login is forbidden in production)

Daily hunts: add a Railway cron or Cloud Scheduler that POSTs `/internal/jobs/discover` (and research/draft/reconcile/replies) with the bearer token. Until that exists, you can trigger jobs from a private caller.

Put Postgres backups on a schedule (`pg_dump` of schema `arc`). Free-plan Supabase has **no PITR** and may **pause after inactivity**; daily jobs usually prevent pause, but verify before depending on it for production. The separate **main** Supabase project is untouched until you point `DATABASE_URL` at it and run `npm run migrate`.

## 3. Hosted Gemini (paid Developer API)

Default model for real contacts: `gemini-3.5-flash-lite` via the Gemini Developer API, dedicated project, **Prepay** billing. Live Google error for new keys (15 Sep 2026): `gemini-2.5-flash-lite` is closed to new users. Paid standard text snapshot for Flash-Lite 3.5: **$0.30 / 1M input**, **$2.50 / 1M output** (includes thinking tokens). **$5 minimum initial prepayment** (credit, not a subscription). **Do not enable auto-reload** unless Donald decides to.

Application caps (not a guarantee against provider billing lag):

- `DAILY_LLM_USD_CAP=0.20`
- `DAILY_LLM_REQUEST_CAP=50`

A ChatGPT / Cursor / Claude subscription does **not** pay this API.

**Never** send real names, emails, or nonpublic ARC facts through Google's **free** Gemini tier (unpaid terms allow human review / model improvement). Set `LLM_BILLING_TIER=paid` and `LLM_LIVE_ENABLED=true` only after creating the paid key.

1. Create a dedicated Google AI Studio / Gemini API project.
2. Enable billing / Prepay. Verify **live** prices and terms: https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/terms
3. Create an API key; store only in secret env (`LLM_API_KEY`).
4. `LLM_PROVIDER=gemini` `LLM_MODEL=gemini-3.5-flash-lite` `LLM_BILLING_TIER=paid`
5. Inspect usage in Google Cloud / AI Studio. Keep `LLM_LIVE_ENABLED=false` until that checklist is done.

## 4. Slack

Create an app with Interactivity enabled, Request URL `https://<host>/slack/actions`. Scopes: `chat:write`, `commands` if you add slash commands later. Invite the bot to `#arc-anchor-outreach`. Set `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID`, `SLACK_APPROVER_IDS` (comma-separated Slack user IDs). Buttons: Approve & Send, Edit, Skip, DNC.

## 5. Gmail / Google Workspace

OAuth client (internal) with `gmail.send` and `gmail.readonly`. Obtain a refresh token for the ARC-controlled mailbox. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GMAIL_SENDER`. Production start must refuse live sends unless this plus approved facts, postal address, opt-out, Slack approvers, and `LIVE_SEND_ENABLED=true` are valid.

## 6. Notion

Target API version `2025-09-03` (data sources, not legacy database-only query).

```
npx tsx scripts/setup-notion.ts          # inspect/diff only
npx tsx scripts/setup-notion.ts --apply  # create under parent — do not run against production
```

Map existing **03 — Anchor Tenant** properties by name/ID. Env: `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`, `NOTION_COMPANIES_DATA_SOURCE_ID`, `NOTION_CONTACTS_DATA_SOURCE_ID`, `NOTION_ACTIVITY_DATA_SOURCE_ID`, `NOTION_CAMPAIGNS_DATA_SOURCE_ID`, `NOTION_FACTS_PAGE_ID`.

Views to create in the Contacts database: Review Queue; Drafts Awaiting Approval; Sent / Donald Owns; Replies / Action Needed; DNC; Company Coverage.

Manual Notion `DNC` / `Disqualified` / `Replied` / `Paused` overrides automation.

## 7. Dashboard login

Local fixture login is labeled and **rejected when `NODE_ENV=production`**. Production: set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, and `DASHBOARD_OPERATOR_EMAILS`. HTTPS + secure cookies + CSRF on mutations. Dashboard cannot raise spend caps, edit approved ARC claims, or send email.

## 8. n8n (optional)

Import `n8n/daily-jobs.json`. Put `ARC_HUNTER_BASE_URL` and `ARC_INTERNAL_JOB_TOKEN` in n8n credentials, not in the JSON. Cron on the VM is equivalent: call the same `/internal/jobs/{discover,research,reconcile,replies}` endpoints.

## 9. Remaining blockers (do not guess)

| Item | Status |
|---|---|
| Legal sender entity (PDF “NOA Intelligence, Inc.” vs ARC) | **Unverified — Donald must choose** |
| Approved sender name/title, reply-to, postal address, opt-out wording | Blank; sending disabled |
| Every MW, land, RFS, cooling, fiber, BTS, financing claim | Blank / `can_use_in_first_touch=false`. `data-center-specs (2).pdf` was **not** treated as externally approved |
| Notion 03 — Anchor Tenant data-source IDs | Not mapped in this build (inspect script ready) |
| Slack workspace, channel, approver IDs | Missing |
| Gmail OAuth refresh token | Missing |
| Gemini paid project + live price check | Missing; `LLM_LIVE_ENABLED=false` |
| Apollo | `APOLLO_ENABLED=false`; do not buy credits |
| Main vs dev Supabase | Dev project is the only database this build is allowed to touch; main project stays untouched until you point `DATABASE_URL` at it |
| Supabase advisors on empty `public` schema | `public.rls_auto_enable()` is executable by anon/authenticated (pre-existing project function, not ARC tables). ARC tables will live in private `arc` with RLS and no policies. |
| Session pooler connection string | Still needed to run `npm run migrate`; MCP cannot supply the database password |
| Non-US recipient email rules | Review at go-live (CAN-SPAM is US baseline) |

## 10. Build verification (this Cursor session)

Exercised locally, all mocked / in-memory:

- `npm run typecheck` — pass
- `npm test` — 32/32 pass (no Postgres, no live Gmail/Slack/Notion/Gemini)
- `npm run demo:fixtures` — in-memory five-hunter dry run (no `DATABASE_URL`; no emails sent)

Not exercised (blocked on credentials Donald has not pasted):

- `npm run migrate` against the dev project (needs session-pooler URI)
- Live Notion inspect of 03 — Anchor Tenant
- Live Slack, Gmail, Gemini, Apollo

Supabase advisors on the **empty** `public` schema (no ARC tables applied yet): `public.rls_auto_enable()` is executable by anon/authenticated. That function is pre-existing on the project, not created by this build. ARC tables will live in private `arc` with RLS enabled and no policies.

## 11. Railway deployment (always-on host)

**Service:** https://arc-hunter-production.up.railway.app  
**Status:** ✓ Deployed and running  
**Branch:** Connected to `Donald022/arc-hunter-system` repository  

### Available endpoints:

- `GET /health` — Health check (public)
- `GET /metrics` — Metrics snapshot (public)
- `GET /dashboard` — Operator dashboard (requires login)
- `POST /slack/actions` — Slack webhook for approvals
- `POST /internal/jobs/:job` — Trigger jobs: discover, research, draft, reconcile, replies (requires `INTERNAL_JOB_TOKEN`)

### Current configuration:

- `NODE_ENV=staging` — Allows fixture login for testing
- `DASHBOARD_FIXTURE_LOGIN=true` — Demo login enabled
- `DRY_RUN=true` — Safe mode (no live sends)
- `LIVE_SEND_ENABLED=false` — Email sending disabled
- `LLM_LIVE_ENABLED=true` — Gemini API connected
- `DATABASE_URL` — Connected to Supabase dev project
- All 44 required environment variables uploaded

### Deployment commands:

```bash
# View status
railway status

# View logs
railway logs

# Redeploy
railway redeploy --yes

# Update environment variables
railway variable set KEY=value
```

### Notes:

- Migrations run automatically on container start
- Service auto-redeploys on git push to connected branch
- Railway CLI requires authentication: `railway login`
- Config as Code (`railway.json`) is deprecated but works until 2026-12-01

## 12. Manual verification checklist (still dry-run)

- [x] `npm test` and `npm run typecheck` pass
- [x] `npm run demo:fixtures` prints five-hunter placeholder output
- [x] Migrations apply to `arc` / `arc_test` on Railway deployment
- [x] Railway deployment healthy and accessible
- [x] Dashboard fixture login works on Railway
- [x] Pause discovery blocks CLI and `Run now` (covered by tests)
- [x] Slack signature tests pass; no real channel posts
- [ ] Approved facts record filled by Donald before any live send
- [x] `LIVE_SEND_ENABLED` remains false until the row above is complete
