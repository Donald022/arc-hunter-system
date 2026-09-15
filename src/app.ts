import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { getConfig } from "./config.ts";
import { loadFactsCached } from "./jobs/factsLoader.ts";
import { senderCompliance } from "./domain/facts.ts";
import { logger } from "./logger.ts";
import { getStore } from "./db/pool.ts";
import { registerDashboard } from "./dashboard/routes.ts";
import { verifySlackSignature, handleSlackAction } from "./integrations/slack.ts";
import { discover } from "./jobs/discover.ts";
import { research } from "./jobs/research.ts";
import { draft } from "./jobs/draft.ts";
import { reconcile } from "./jobs/reconcile.ts";
import { replies } from "./jobs/replies.ts";
import { snapshotMetrics } from "./metrics.ts";
import { HUNTERS, type Hunter } from "./domain/types.ts";

export async function buildApp() {
  const cfg = getConfig();
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(formbody);
  const store = getStore();

  app.get("/health", async () => ({
    ok: true,
    dry_run: cfg.DRY_RUN,
    live_send: cfg.LIVE_SEND_ENABLED,
    llm_live: cfg.LLM_LIVE_ENABLED,
    schema: cfg.DB_SCHEMA,
  }));

  app.get("/metrics", async () => snapshotMetrics());

  app.post("/internal/jobs/:job", async (req, reply) => {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${cfg.INTERNAL_JOB_TOKEN}`)
      return reply.code(401).send({ error: "unauthorized" });
    const job = (req.params as { job: string }).job;
    const body = (req.body ?? {}) as { hunter?: string; limit?: number };
    try {
      if (job === "discover") {
        const hunter =
          body.hunter && HUNTERS.includes(body.hunter as Hunter)
            ? (body.hunter as Hunter)
            : undefined;
        return await discover({ hunter, store, actor: "internal" });
      }
      if (job === "research") return await research({ limit: body.limit, store });
      if (job === "draft") return await draft({ limit: body.limit, store });
      if (job === "reconcile") return await reconcile({ store });
      if (job === "replies") return await replies({ store });
      return reply.code(404).send({ error: "unknown_job" });
    } catch (err) {
      logger.error("internal job failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/slack/actions", async (req, reply) => {
    const raw = (req as FastifyRequestWithRaw).rawBody ?? JSON.stringify(req.body ?? {});
    const ts = String(req.headers["x-slack-request-timestamp"] ?? "");
    const sig = String(req.headers["x-slack-signature"] ?? "");
    if (!cfg.SLACK_SIGNING_SECRET) return reply.code(503).send({ error: "slack_not_configured" });
    const verified = verifySlackSignature({
      signingSecret: cfg.SLACK_SIGNING_SECRET,
      timestamp: ts,
      rawBody:
        typeof req.body === "object" && req.body && "payload" in (req.body as object)
          ? new URLSearchParams(req.body as Record<string, string>).toString()
          : raw,
      signature: sig,
    });
    if (!verified.ok) return reply.code(401).send({ error: verified.reason });
    reply.code(200).send({ ok: true });
    const payloadRaw =
      typeof req.body === "object" && req.body && "payload" in (req.body as object)
        ? JSON.parse(String((req.body as { payload: string }).payload))
        : req.body;
    void handleSlackAction(payloadRaw).catch((err) =>
      logger.error("slack action failed", { error: String(err) }),
    );
  });

  await registerDashboard(app, store);
  return app;
}

type FastifyRequestWithRaw = { rawBody?: string };

export async function assertLiveSendReady(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.LIVE_SEND_ENABLED) return;
  const facts = await loadFactsCached();
  const compliance = senderCompliance(facts);
  const missing: string[] = [...compliance.missing];
  if (!cfg.GMAIL_SENDER) missing.push("GMAIL_SENDER");
  if (!cfg.GOOGLE_REFRESH_TOKEN) missing.push("GOOGLE_REFRESH_TOKEN");
  if (!cfg.SLACK_APPROVER_IDS.length) missing.push("SLACK_APPROVER_IDS");
  if (!cfg.SLACK_SIGNING_SECRET) missing.push("SLACK_SIGNING_SECRET");
  if (missing.length) {
    throw new Error(`LIVE_SEND_ENABLED=true but missing: ${missing.join(", ")}`);
  }
}

export async function startServer(): Promise<void> {
  const cfg = getConfig();
  await assertLiveSendReady();
  const app = await buildApp();
  await app.listen({ port: cfg.PORT, host: cfg.LISTEN_HOST });
  logger.info("listening", { port: cfg.PORT, host: cfg.LISTEN_HOST });
}
