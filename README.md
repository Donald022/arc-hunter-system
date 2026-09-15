# ARC Hunter System

Pilot service that discovers, ranks, drafts, and (after Slack approval) sends **exactly one** first-touch email to potential ARC MX I data-center anchor-tenant intermediaries and buyers.

See [SETUP.md](SETUP.md) for credentials, deployment, and remaining blockers. Defaults are dry-run: no live email, no paid AI, no production Notion writes.

```
npm install
npm run typecheck
npm test
npm run demo:fixtures
```
