import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getConfig } from "../config.ts";
import { getStore } from "../db/pool.ts";
import type { Store } from "../db/types.ts";
import { snapshotMetrics } from "../metrics.ts";
import { loadRegistry, parserSupported } from "../hunters/registry.ts";
import { isSsrfSafeUrl } from "../hunters/parsers.ts";
import { setPaused } from "../jobs/controls.ts";
import { discover } from "../jobs/discover.ts";
import { seedDefaultCampaigns } from "../jobs/campaigns.ts";
import { HUNTERS, type Hunter } from "../domain/types.ts";
import { utcDay } from "../integrations/llm.ts";
import { getNotionClient } from "../integrations/notion.ts";

const sessions = new Map<string, { email: string; csrf: string; exp: number }>();

export function signCookie(value: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${sig}`;
}

export function unsignCookie(input: string, secret: string): string | undefined {
  const i = input.lastIndexOf(".");
  if (i < 1) return undefined;
  const value = input.slice(0, i);
  const sig = input.slice(i + 1);
  const expected = createHmac("sha256", secret).update(value).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return value;
}

export function newCsrf(): string {
  return randomBytes(16).toString("hex");
}

function layout(title: string, body: string, csrf: string, user?: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)} · ARC Hunter</title>
<style>
:root { font-family: ui-sans-serif, system-ui, sans-serif; color: #102a43; background: #f0f4f8; }
body { margin: 0; }
header { background: #102a43; color: #fff; padding: 12px 20px; display: flex; gap: 16px; align-items: center; }
header a { color: #d9e2ec; text-decoration: none; }
main { padding: 20px; max-width: 1100px; margin: 0 auto; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { border: 1px solid #d9e2ec; padding: 8px; text-align: left; font-size: 14px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 99px; background: #d9e2ec; font-size: 12px; }
.ok { background: #c6f6d5; } .warn { background: #fefcbf; } .err { background: #fed7d7; }
form.inline { display: inline; }
button, input, select { font: inherit; padding: 6px 10px; }
.card { background: #fff; padding: 16px; margin-bottom: 16px; border: 1px solid #d9e2ec; }
.demo { background: #fff3cd; padding: 8px 12px; margin-bottom: 12px; }
</style></head>
<body>
<header>
  <strong>ARC Hunter</strong>
  <a href="/dashboard">Overview</a>
  <a href="/dashboard/searches">Searches</a>
  <a href="/dashboard/leads">Leads &amp; activity</a>
  <span style="margin-left:auto">${user ? esc(user) : ""}</span>
</header>
<main>${body}<input type="hidden" name="_csrf" value="${esc(csrf)}"/></main>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function sessionFrom(req: FastifyRequest): { email: string; csrf: string } | undefined {
  const cfg = getConfig();
  const raw = req.cookies?.arc_session;
  if (!raw) return undefined;
  const id = unsignCookie(raw, cfg.DASHBOARD_SESSION_SECRET);
  if (!id) return undefined;
  const s = sessions.get(id);
  if (!s || s.exp < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return s;
}

function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const s = sessionFrom(req);
  if (!s) {
    reply.redirect("/dashboard/login");
    return undefined;
  }
  return s;
}

function checkCsrf(req: FastifyRequest, session: { csrf: string }): boolean {
  const body = req.body as { _csrf?: string } | undefined;
  const header = req.headers["x-csrf-token"];
  const token = body?._csrf ?? (typeof header === "string" ? header : undefined);
  if (!token || token !== session.csrf) return false;
  return true;
}

export async function registerDashboard(app: FastifyInstance, store: Store = getStore()): Promise<void> {
  app.get("/dashboard/login", async (req, reply) => {
    const cfg = getConfig();
    const demo = cfg.DASHBOARD_FIXTURE_LOGIN;
    const html = layout(
      "Login",
      `${demo ? `<div class="demo"><strong>Demo login stub</strong> — fixture mode only. Impossible when NODE_ENV=production.</div>
      <form method="post" action="/dashboard/login">
        <label>Email <input name="email" value="operator@arc.test"/></label>
        <input type="hidden" name="_csrf" value="login"/>
        <button type="submit">Demo sign in</button>
      </form>` : `<p>Configure OIDC_ISSUER / OIDC_CLIENT_ID. Fixture login is disabled.</p>`}`,
      "login",
    );
    return reply.type("text/html").send(html);
  });

  app.post("/dashboard/login", async (req, reply) => {
    const cfg = getConfig();
    if (!cfg.DASHBOARD_FIXTURE_LOGIN) {
      return reply.code(403).send("fixture login disabled");
    }
    const email = String((req.body as { email?: string })?.email ?? "operator@arc.test").toLowerCase();
    if (cfg.DASHBOARD_OPERATOR_EMAILS.length && !cfg.DASHBOARD_OPERATOR_EMAILS.includes(email)) {
      return reply.code(403).send("not allowlisted");
    }
    const sid = randomBytes(16).toString("hex");
    const csrf = newCsrf();
    sessions.set(sid, { email, csrf, exp: Date.now() + 12 * 3600_000 });
    reply.setCookie("arc_session", signCookie(sid, cfg.DASHBOARD_SESSION_SECRET), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: cfg.NODE_ENV === "production",
    });
    return reply.redirect("/dashboard");
  });

  app.get("/dashboard", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    await seedDefaultCampaigns(store);
    const jobs = await store.jobs.latestByJob();
    const pause = await store.pause.get();
    const contacts = await store.contacts.list();
    const llm = await store.llm.getDay(utcDay());
    const cfg = getConfig();
    const rows = HUNTERS.map((h) => {
      const j = jobs.find((x) => x.hunter === h || (x.job === "discover" && x.hunter === h));
      return `<tr><td>${h}</td><td>${j?.status ?? "never"}</td><td>${j?.started_at ?? "—"}</td>
        <td>${esc(JSON.stringify(j?.result ?? {}))}</td>
        <td><form class="inline" method="post" action="/dashboard/run"><input type="hidden" name="_csrf" value="${user.csrf}"/>
        <input type="hidden" name="hunter" value="${h}"/><button ${pause.discovery_paused ? "disabled" : ""}>Run now</button></form></td></tr>`;
    }).join("");
    const body = `
      <h1>Overview</h1>
      <div class="card">
        <span class="badge ${pause.discovery_paused ? "err" : "ok"}">discovery ${pause.discovery_paused ? "paused" : "on"}</span>
        <span class="badge ${pause.outbound_paused || !cfg.LIVE_SEND_ENABLED ? "warn" : "ok"}">outbound ${pause.outbound_paused ? "paused" : cfg.LIVE_SEND_ENABLED ? "armed" : "dry-run"}</span>
        <form class="inline" method="post" action="/dashboard/pause"><input type="hidden" name="_csrf" value="${user.csrf}"/>
          <input type="hidden" name="which" value="discovery"/><input type="hidden" name="paused" value="${pause.discovery_paused ? "false" : "true"}"/>
          <button>${pause.discovery_paused ? "Resume discovery" : "Pause all prospect discovery"}</button></form>
        <form class="inline" method="post" action="/dashboard/pause"><input type="hidden" name="_csrf" value="${user.csrf}"/>
          <input type="hidden" name="which" value="outbound"/><input type="hidden" name="paused" value="${pause.outbound_paused ? "false" : "true"}"/>
          <button>${pause.outbound_paused ? "Resume outbound" : "Pause outbound"}</button></form>
      </div>
      <div class="card">
        <p>AI ${llm.requests}/${cfg.DAILY_LLM_REQUEST_CAP} requests · ~$${llm.estimated_usd.toFixed(4)} / $${cfg.DAILY_LLM_USD_CAP.toFixed(2)} · enrichment credits today: ${await store.enrichment.creditsToday(utcDay())}</p>
        <p>Qualified ${contacts.filter((c) => c.state === "QUALIFIED" || c.state === "QUALIFIED_NO_EMAIL").length} · drafts pending ${contacts.filter((c) => c.state === "PENDING_APPROVAL").length} · sent ${contacts.filter((c) => c.state === "SENT").length} · replies ${contacts.filter((c) => c.state === "REPLIED" || c.state === "MANUAL_HANDOFF").length}</p>
      </div>
      <table><thead><tr><th>Hunter</th><th>Last result</th><th>Last run</th><th>Detail</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <pre>${esc(JSON.stringify(snapshotMetrics(), null, 2))}</pre>`;
    return reply.type("text/html").send(layout("Overview", body, user.csrf, user.email));
  });

  app.get("/dashboard/searches", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    await seedDefaultCampaigns(store);
    const campaigns = await store.campaigns.list();
    const registry = loadRegistry();
    const cards = campaigns
      .map((c) => {
        const sources = registry.sources.filter((s) => s.hunter === c.hunter);
        return `<div class="card"><h3>${esc(c.name)}</h3>
          <form method="post" action="/dashboard/campaigns/${esc(c.id)}">
            <input type="hidden" name="_csrf" value="${user.csrf}"/>
            <label>Enabled <input type="checkbox" name="enabled" ${c.enabled ? "checked" : ""}/></label>
            <label>Seed domains <input name="seed_domains" value="${esc(c.seed_domains.join(", "))}" size="60"/></label><br/>
            <label>Search terms <input name="search_terms" value="${esc(c.search_terms.join(", "))}" size="60"/></label><br/>
            <label>Region boost <input name="region_boost" value="${esc(c.region_boost)}"/></label>
            <label>Research cap <input name="daily_research_cap" type="number" min="0" max="200" value="${c.daily_research_cap}"/></label>
            <label>Send cap <input name="daily_send_cap" type="number" min="0" max="50" value="${c.daily_send_cap}"/></label><br/>
            <label>Source URLs <textarea name="source_urls" rows="3" cols="80">${esc(c.source_urls.join("\n"))}</textarea></label>
            <p>Registry parsers: ${sources.map((s) => `${s.id} (${s.parser}${s.enabled ? "" : ", disabled"})`).join("; ")}</p>
            <button>Save</button>
          </form></div>`;
      })
      .join("");
    return reply.type("text/html").send(layout("Searches", `<h1>Searches</h1>${cards}`, user.csrf, user.email));
  });

  app.get("/dashboard/leads", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const q = (req.query as { q?: string; state?: string; hunter?: string }).q;
    const state = (req.query as { state?: string }).state;
    const hunter = (req.query as { hunter?: Hunter }).hunter;
    const contacts = await store.contacts.list({
      q,
      state: state as never,
      hunter: HUNTERS.includes(hunter as Hunter) ? (hunter as Hunter) : undefined,
    });
    const rows = contacts
      .map(
        (c) => `<tr><td>${esc(c.name)}</td><td>${c.fit_score}</td><td>${c.state}</td>
        <td>${esc((c.score_breakdown?.reason_codes ?? []).join(", "))}</td>
        <td>${c.notion_page_id ? `<a href="https://notion.so/${c.notion_page_id}">Notion</a>` : "—"}</td>
        <td>${c.gmail_thread_id ? esc(c.gmail_thread_id) : "—"}</td></tr>`,
      )
      .join("");
    const body = `<h1>Leads &amp; activity</h1>
      <form method="get"><input name="q" placeholder="search" value="${esc(q ?? "")}"/>
      <input name="state" placeholder="state" value="${esc(state ?? "")}"/>
      <input name="hunter" placeholder="hunter" value="${esc(hunter ?? "")}"/>
      <button>Filter</button></form>
      <p>Approval and send live in Slack only — this page has no send button.</p>
      <table><thead><tr><th>Name</th><th>Score</th><th>State</th><th>Reasons</th><th>Notion</th><th>Gmail</th></tr></thead><tbody>${rows}</tbody></table>`;
    return reply.type("text/html").send(layout("Leads", body, user.csrf, user.email));
  });

  app.post("/dashboard/pause", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!checkCsrf(req, user)) return reply.code(403).send("csrf");
    const body = req.body as { which?: string; paused?: string };
    if (body.which !== "discovery" && body.which !== "outbound") return reply.code(400).send("bad which");
    await setPaused(body.which, body.paused === "true", user.email, store);
    return reply.redirect("/dashboard");
  });

  app.post("/dashboard/run", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!checkCsrf(req, user)) return reply.code(403).send("csrf");
    const hunter = (req.body as { hunter?: string }).hunter as Hunter;
    if (!HUNTERS.includes(hunter)) return reply.code(400).send("bad hunter");
    const campaign = (await store.campaigns.list()).find((c) => c.hunter === hunter);
    if (campaign && !campaign.enabled) return reply.code(409).send("hunter disabled");
    await discover({ hunter, store, actor: user.email, dryRun: getConfig().DRY_RUN });
    return reply.redirect("/dashboard");
  });

  app.post("/dashboard/campaigns/:id", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!checkCsrf(req, user)) return reply.code(403).send("csrf");
    const id = (req.params as { id: string }).id;
    const existing = await store.campaigns.get(id);
    if (!existing) return reply.code(404).send("not found");
    const body = req.body as Record<string, string | undefined>;
    const seed = splitCsv(body.seed_domains);
    const terms = splitCsv(body.search_terms);
    const urls = (body.source_urls ?? "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const researchCap = Number(body.daily_research_cap);
    const sendCap = Number(body.daily_send_cap);
    if (!Number.isInteger(researchCap) || researchCap < 0 || researchCap > 200) {
      return reply.code(400).send("invalid research cap");
    }
    if (!Number.isInteger(sendCap) || sendCap < 0 || sendCap > 50) {
      return reply.code(400).send("invalid send cap");
    }
    const registry = loadRegistry();
    for (const url of urls) {
      if (url.startsWith("fixture://") || url.startsWith("file://")) continue;
      const known = registry.sources.find((s) => s.url === url);
      if (!known) {
        return reply.code(400).send(`Needs setup: unsupported source URL ${url}`);
      }
      if (!parserSupported(known.parser)) return reply.code(400).send("Needs setup");
      if (known.parser !== "fixture" && known.parser !== "csv") {
        const safe = isSsrfSafeUrl(url);
        if (!safe.ok) return reply.code(400).send(`Needs setup: ${safe.reason}`);
      }
    }
    const next = {
      ...existing,
      enabled: body.enabled === "on" || body.enabled === "true",
      seed_domains: seed,
      search_terms: terms,
      source_urls: urls.length ? urls : existing.source_urls,
      region_boost: body.region_boost ?? existing.region_boost,
      daily_research_cap: researchCap,
      daily_send_cap: sendCap,
    };
    await store.campaigns.upsert(next);
    let notionSync = "skipped";
    try {
      await getNotionClient().upsertCampaign(next);
      notionSync = "ok";
    } catch {
      notionSync = "error";
    }
    await store.audit.add({
      actor: user.email,
      at: new Date().toISOString(),
      setting: `campaign:${id}`,
      old_value: existing,
      new_value: next,
      notion_sync: notionSync,
    });
    return reply.redirect("/dashboard/searches");
  });

  app.get("/dashboard/oidc/start", async (_req, reply) => {
    const cfg = getConfig();
    if (!cfg.OIDC_ISSUER || !cfg.OIDC_CLIENT_ID) {
      return reply.code(503).send("OIDC is not configured. Local fixture login is for development only.");
    }
    const url = new URL("/authorize", cfg.OIDC_ISSUER.endsWith("/") ? cfg.OIDC_ISSUER : cfg.OIDC_ISSUER + "/");
    url.searchParams.set("client_id", cfg.OIDC_CLIENT_ID);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    if (cfg.OIDC_REDIRECT_URI) url.searchParams.set("redirect_uri", cfg.OIDC_REDIRECT_URI);
    return reply.redirect(url.toString());
  });
}

function splitCsv(v?: string): string[] {
  return (v ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function clearSessions(): void {
  sessions.clear();
}

export { sessions };
