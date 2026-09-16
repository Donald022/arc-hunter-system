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

  // Health endpoints for production readiness
  app.get("/health/live", async (_req, reply) => {
    // Liveness: process is responsive
    reply.status(200).send({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/health/ready", async (_req, reply) => {
    const start = Date.now();
    const timeout = 5000; // 5 second timeout

    try {
      const { getPool } = await import("./db/pool.ts");
      const pool = getPool();

      // Check database connectivity with timeout
      const checkPromise = (async () => {
        const result = await pool.query("SELECT 1 as health_check");
        return result.rows.length === 1;
      })();

      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error("Health check timeout")), timeout),
      );

      const dbHealthy = await Promise.race([checkPromise, timeoutPromise]);

      if (!dbHealthy) {
        reply.status(503).send({
          status: "unavailable",
          reason: "database_check_failed",
          duration_ms: Date.now() - start,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Check migrations are applied
      const migrations = await pool.query(`
        SELECT name FROM ${cfg.DB_SCHEMA}.migrations 
        ORDER BY applied_at DESC 
        LIMIT 1
      `);

      if (migrations.rows.length === 0) {
        reply.status(503).send({
          status: "unavailable",
          reason: "no_migrations_applied",
          duration_ms: Date.now() - start,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Optional dependency status (sanitized)
      const dependencies = {
        notion: (cfg as any).NOTION_API_KEY ? "configured" : "not_configured",
        gemini: cfg.LLM_API_KEY && cfg.LLM_LIVE_ENABLED ? "enabled" : "disabled",
        slack: cfg.SLACK_SIGNING_SECRET ? "configured" : "not_configured",
        gmail: cfg.GMAIL_SENDER ? "configured" : "not_configured",
      };

      reply.status(200).send({
        status: "ready",
        duration_ms: Date.now() - start,
        dependencies,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      const errorMsg = err?.message
        ? String(err.message).replace(/postgresql:\/\/[^\s]+/g, "[REDACTED]")
        : "unknown";

      reply.status(503).send({
        status: "unavailable",
        reason: "health_check_error",
        error: errorMsg,
        duration_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      });
    }
  });

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
