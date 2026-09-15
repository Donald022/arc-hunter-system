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
import { darkTheme } from "./styles.ts";
import { badge, statCard, progressBar, hunterIcon, emptyState, alert, esc } from "./components.ts";

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

interface LayoutOptions {
  title: string;
  pageTitle: string;
  pageDescription?: string;
  badges?: string[];
  body: string;
  csrf: string;
  user?: string;
  activePage: "overview" | "searches" | "leads";
}

function layout({
  title,
  pageTitle,
  pageDescription,
  badges,
  body,
  csrf,
  user,
  activePage,
}: LayoutOptions): string {
  const cfg = getConfig();
  const statusBadges = badges ?? [];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${esc(title)} · ARC Hunter</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>${darkTheme}</style>
</head>
<body>
  <div class="dashboard-layout">
    <!-- Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="sidebar-wordmark">ARC HUNTER</div>
        <div class="sidebar-subtitle">Anchor Tenant Intelligence</div>
      </div>
      <nav class="sidebar-nav">
        <a href="/dashboard" class="nav-link ${activePage === "overview" ? "active" : ""}">Overview</a>
        <a href="/dashboard/searches" class="nav-link ${activePage === "searches" ? "active" : ""}">Searches</a>
        <a href="/dashboard/leads" class="nav-link ${activePage === "leads" ? "active" : ""}">Leads & Activity</a>
      </nav>
      <div class="sidebar-footer">
        <div>System Status</div>
        ${cfg.NODE_ENV === "production" ? "" : `<div style="margin-top:4px;font-size:11px;color:#C99A45;">⚠ ${cfg.NODE_ENV.toUpperCase()}</div>`}
        ${user ? `<div class="sidebar-user">Logged in: ${esc(user)}</div>` : ""}
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <header class="page-header">
        <div class="page-header-top">
          <h1 class="page-title">${esc(pageTitle)}</h1>
          <div class="page-badges">
            ${statusBadges.join("")}
          </div>
        </div>
        ${pageDescription ? `<p class="page-description">${esc(pageDescription)}</p>` : ""}
      </header>
      <div class="page-content">
        ${body}
        <input type="hidden" name="_csrf" value="${esc(csrf)}"/>
      </div>
    </main>
  </div>
</body>
</html>`;
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

export async function registerDashboard(
  app: FastifyInstance,
  store: Store = getStore(),
): Promise<void> {
  app.get("/dashboard/login", async (req, reply) => {
    const cfg = getConfig();
    const demo = cfg.DASHBOARD_FIXTURE_LOGIN;
    const body = `
      <div class="card" style="max-width: 400px; margin: 60px auto;">
        <h2 style="margin-bottom: 16px; color: var(--text-primary);">ARC Hunter Login</h2>
        ${
          demo
            ? `
          ${alert({ type: "warning", message: "<strong>Demo login stub</strong> — fixture mode only. Impossible when NODE_ENV=production." })}
          <form method="post" action="/dashboard/login">
            <div class="form-row">
              <label>Email
                <input type="email" name="email" value="operator@arc.test" required/>
              </label>
            </div>
            <input type="hidden" name="_csrf" value="login"/>
            <button type="submit" class="primary" style="width: 100%;">Demo Sign In</button>
          </form>
        `
            : `
          ${alert({ type: "info", message: "Configure OIDC_ISSUER / OIDC_CLIENT_ID. Fixture login is disabled." })}
        `
        }
      </div>
    `;
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Login · ARC Hunter</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>${darkTheme}</style>
</head>
<body>
  ${body}
</body>
</html>`;
    return reply.type("text/html").send(html);
  });

  app.post("/dashboard/login", async (req, reply) => {
    const cfg = getConfig();
    if (!cfg.DASHBOARD_FIXTURE_LOGIN) {
      return reply.code(403).send("fixture login disabled");
    }
    const email = String(
      (req.body as { email?: string })?.email ?? "operator@arc.test",
    ).toLowerCase();
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

    // Calculate statistics
    const discovered = contacts.length;
    const qualified = contacts.filter(
      (c) => c.state === "QUALIFIED" || c.state === "QUALIFIED_NO_EMAIL",
    ).length;
    const draftsPending = contacts.filter((c) => c.state === "PENDING_APPROVAL").length;
    const sent = contacts.filter((c) => c.state === "SENT").length;
    const replied = contacts.filter(
      (c) => c.state === "REPLIED" || c.state === "MANUAL_HANDOFF",
    ).length;
    const enrichmentCredits = await store.enrichment.creditsToday(utcDay());

    // LLM usage
    const llmPercentage =
      cfg.DAILY_LLM_REQUEST_CAP > 0 ? (llm.requests / cfg.DAILY_LLM_REQUEST_CAP) * 100 : 0;
    const llmUsdPercentage =
      cfg.DAILY_LLM_USD_CAP > 0 ? (llm.estimated_usd / cfg.DAILY_LLM_USD_CAP) * 100 : 0;

    // Status badges for header
    const statusBadges = [
      badge({
        type: pause.discovery_paused ? "error" : "success",
        label: pause.discovery_paused ? "Discovery Paused" : "Discovery Active",
        dot: true,
      }),
      badge({
        type: pause.outbound_paused || !cfg.LIVE_SEND_ENABLED ? "warning" : "success",
        label: pause.outbound_paused
          ? "Outbound Paused"
          : cfg.LIVE_SEND_ENABLED
            ? "Outbound Armed"
            : "Dry Run Mode",
        dot: true,
      }),
    ];

    const body = `
      <!-- Statistics Grid -->
      <div class="stats-grid">
        ${statCard({ label: "Leads Discovered", value: discovered, meta: "Total prospects" })}
        ${statCard({ label: "Qualified", value: qualified, meta: "Ready for outreach" })}
        ${statCard({ label: "Drafts Pending", value: draftsPending, meta: "Awaiting approval" })}
        ${statCard({ label: "Emails Sent", value: sent, meta: "Active outreach" })}
        ${statCard({ label: "Replies Received", value: replied, meta: "Engagement" })}
        ${statCard({ label: "AI Budget Used", value: "$" + llm.estimated_usd.toFixed(4), meta: llm.requests + " requests today" })}
      </div>

      <!-- AI Usage Card -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">AI & Enrichment Usage</div>
            <div class="card-subtitle">Daily caps and current consumption</div>
          </div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 500; color: var(--text-secondary); margin-bottom: 4px;">
            LLM Requests
          </div>
          ${progressBar({ current: llm.requests, max: cfg.DAILY_LLM_REQUEST_CAP, showNumbers: true })}
        </div>
        <div style="margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 500; color: var(--text-secondary); margin-bottom: 4px;">
            LLM Budget (USD)
          </div>
          ${progressBar({
            current: parseFloat(llm.estimated_usd.toFixed(4)),
            max: cfg.DAILY_LLM_USD_CAP,
            showNumbers: true,
          })}
        </div>
        <div style="font-size: 13px; color: var(--text-secondary);">
          Enrichment credits used today: <strong style="color: var(--text-primary);">${enrichmentCredits}</strong>
        </div>
      </div>

      <!-- Control Panel -->
      <div class="control-panel">
        <div class="control-row">
          <div class="control-info">
            <div class="control-label">Discovery Controls</div>
            <div class="control-description">
              ${pause.discovery_paused ? "Discovery is paused. Resume to continue finding prospects." : "Discovery is active. Hunter jobs will process on schedule."}
            </div>
          </div>
          <form class="inline" method="post" action="/dashboard/pause" onsubmit="return confirm('${pause.discovery_paused ? "Resume" : "Pause"} all prospect discovery?')">
            <input type="hidden" name="_csrf" value="${user.csrf}"/>
            <input type="hidden" name="which" value="discovery"/>
            <input type="hidden" name="paused" value="${pause.discovery_paused ? "false" : "true"}"/>
            <button class="${pause.discovery_paused ? "primary" : "danger"}">
              ${pause.discovery_paused ? "Resume Discovery" : "Pause Discovery"}
            </button>
          </form>
        </div>
        <div class="control-row">
          <div class="control-info">
            <div class="control-label">Outbound Controls</div>
            <div class="control-description">
              ${pause.outbound_paused ? "Outbound is paused. No emails will be sent." : cfg.LIVE_SEND_ENABLED ? "Outbound is armed. Approved emails will be sent." : "Dry run mode. No real emails will be sent."}
            </div>
          </div>
          <form class="inline" method="post" action="/dashboard/pause" onsubmit="return confirm('${pause.outbound_paused ? "Resume" : "Pause"} outbound email sending?')">
            <input type="hidden" name="_csrf" value="${user.csrf}"/>
            <input type="hidden" name="which" value="outbound"/>
            <input type="hidden" name="paused" value="${pause.outbound_paused ? "false" : "true"}"/>
            <button class="${pause.outbound_paused ? "primary" : "danger"}">
              ${pause.outbound_paused ? "Resume Outbound" : "Pause Outbound"}
            </button>
          </form>
        </div>
      </div>

      <!-- Hunter Status -->
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">Hunter Status</div>
            <div class="card-subtitle">Individual prospect discovery engines</div>
          </div>
        </div>
        <div class="hunter-grid">
          ${HUNTERS.map((h) => {
            const j = jobs.find((x) => x.hunter === h || (x.job === "discover" && x.hunter === h));
            const campaign = (store as any)._campaigns?.find?.((c: any) => c.hunter === h);
            const isEnabled = campaign?.enabled !== false;
            const lastRun = j?.started_at ? new Date(j.started_at).toLocaleString() : "Never";
            const result = j?.result as any;
            const candidatesFound = result?.found ?? result?.candidates ?? 0;

            return `<div class="hunter-card">
              ${hunterIcon({ hunter: h })}
              <div class="hunter-info">
                <div class="hunter-name">${esc(h)}</div>
                <div class="hunter-meta">
                  <span>${badge({
                    type: !isEnabled
                      ? "neutral"
                      : j?.status === "ok"
                        ? "success"
                        : j?.status === "error"
                          ? "error"
                          : "neutral",
                    label: !isEnabled
                      ? "Disabled"
                      : j?.status === "ok"
                        ? "Success"
                        : j?.status === "error"
                          ? "Failed"
                          : j?.status === "running"
                            ? "Running"
                            : "Never Run",
                  })}</span>
                  <span>Last run: ${esc(lastRun)}</span>
                  ${candidatesFound > 0 ? `<span>Found: ${candidatesFound}</span>` : ""}
                </div>
              </div>
              <div class="hunter-actions">
                <form class="inline" method="post" action="/dashboard/run">
                  <input type="hidden" name="_csrf" value="${user.csrf}"/>
                  <input type="hidden" name="hunter" value="${h}"/>
                  <button class="small" ${pause.discovery_paused || !isEnabled ? "disabled" : ""}>
                    Run Now
                  </button>
                </form>
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <!-- Developer Details -->
      <details class="dev-details">
        <summary>Developer Details (Raw Metrics)</summary>
        <pre>${esc(JSON.stringify(snapshotMetrics(), null, 2))}</pre>
      </details>
    `;

    return reply.type("text/html").send(
      layout({
        title: "Overview",
        pageTitle: "Mission Control",
        pageDescription: "ARC Hunter System operational dashboard",
        badges: statusBadges,
        body,
        csrf: user.csrf,
        user: user.email,
        activePage: "overview",
      }),
    );
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
        const enabledSources = sources.filter((s) => s.enabled);
        const supportedSources = sources.filter((s) => parserSupported(s.parser));

        return `<div class="campaign-card">
          <div class="campaign-header">
            <div>
              <div class="campaign-name">${esc(c.name)}</div>
              <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                Hunter: <strong style="color: var(--text-primary);">${esc(c.hunter)}</strong>
              </div>
            </div>
            ${badge({
              type: c.enabled ? "success" : "neutral",
              label: c.enabled ? "Enabled" : "Disabled",
            })}
          </div>
          
          <form method="post" action="/dashboard/campaigns/${esc(c.id)}" class="campaign-form">
            <input type="hidden" name="_csrf" value="${user.csrf}"/>
            
            <div class="campaign-section">
              <div class="campaign-label">Status</div>
              <div>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                  <input type="checkbox" name="enabled" ${c.enabled ? "checked" : ""}/>
                  <span style="font-size: 14px; color: var(--text-primary);">Campaign enabled</span>
                </label>
              </div>
            </div>

            <div class="campaign-section">
              <div class="campaign-label">Seed Domains</div>
              <div>
                <input 
                  type="text" 
                  name="seed_domains" 
                  value="${esc(c.seed_domains.join(", "))}" 
                  placeholder="example.com, another.com"
                />
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                  Comma-separated list of starting domains
                </div>
              </div>
            </div>

            <div class="campaign-section">
              <div class="campaign-label">Search Terms</div>
              <div>
                <input 
                  type="text" 
                  name="search_terms" 
                  value="${esc(c.search_terms.join(", "))}" 
                  placeholder="keywords, phrases"
                />
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                  Comma-separated keywords for discovery
                </div>
              </div>
            </div>

            <div class="campaign-section">
              <div class="campaign-label">Region Boost</div>
              <div>
                <input 
                  type="text" 
                  name="region_boost" 
                  value="${esc(c.region_boost)}" 
                  placeholder="US, Mexico, etc."
                />
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                  Regional priority for scoring
                </div>
              </div>
            </div>

            <div class="campaign-section">
              <div class="campaign-label">Daily Caps</div>
              <div class="form-inline">
                <label>
                  Research Cap
                  <input 
                    type="number" 
                    name="daily_research_cap" 
                    min="0" 
                    max="200" 
                    value="${c.daily_research_cap}"
                    style="width: 100px;"
                  />
                </label>
                <label>
                  Send Cap
                  <input 
                    type="number" 
                    name="daily_send_cap" 
                    min="0" 
                    max="50" 
                    value="${c.daily_send_cap}"
                    style="width: 100px;"
                  />
                </label>
              </div>
            </div>

            <div class="campaign-section">
              <div class="campaign-label">Source URLs</div>
              <div>
                <textarea 
                  name="source_urls" 
                  rows="4"
                  placeholder="https://example.com/feed&#10;https://another.com/data"
                >${esc(c.source_urls.join("\n"))}</textarea>
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
                  One URL per line. Registry parsers: ${sources
                    .map((s) => {
                      const supported = parserSupported(s.parser);
                      return `<span style="color: ${supported ? "var(--success)" : "var(--error)"}">${s.id} (${s.parser}${s.enabled ? "" : ", disabled"})</span>`;
                    })
                    .join(", ")}
                </div>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;">
              <button type="submit" class="primary">Save Changes</button>
            </div>
          </form>
        </div>`;
      })
      .join("");

    const body =
      campaigns.length > 0
        ? cards
        : emptyState({
            title: "No campaigns configured",
            description:
              "Campaign configuration will be automatically seeded on first discovery run.",
          });

    return reply.type("text/html").send(
      layout({
        title: "Searches",
        pageTitle: "Search Campaigns",
        pageDescription: "Configure hunter search parameters, domains, terms, and source URLs",
        body,
        csrf: user.csrf,
        user: user.email,
        activePage: "searches",
      }),
    );
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

    // State badge helper
    const stateBadge = (s: string) => {
      const badges: Record<
        string,
        { type: "success" | "warning" | "error" | "neutral"; label: string }
      > = {
        QUALIFIED: { type: "success", label: "Qualified" },
        QUALIFIED_NO_EMAIL: { type: "warning", label: "No Email" },
        PENDING_APPROVAL: { type: "warning", label: "Draft Pending" },
        SENT: { type: "success", label: "Sent" },
        REPLIED: { type: "success", label: "Replied" },
        MANUAL_HANDOFF: { type: "success", label: "Handoff" },
        REJECTED: { type: "neutral", label: "Rejected" },
        ERROR: { type: "error", label: "Error" },
      };
      const b = badges[s] ?? { type: "neutral", label: s };
      return badge({ type: b.type, label: b.label });
    };

    const body = `
      <!-- Filter Bar -->
      <div class="filter-bar">
        <form method="get" style="display: contents;">
          <input 
            type="text" 
            name="q" 
            placeholder="Search by name or company..." 
            value="${esc(q ?? "")}"
          />
          <input 
            type="text" 
            name="state" 
            placeholder="Filter by state..." 
            value="${esc(state ?? "")}"
            style="flex: 0 0 200px;"
          />
          <input 
            type="text" 
            name="hunter" 
            placeholder="Filter by hunter..." 
            value="${esc(hunter ?? "")}"
            style="flex: 0 0 200px;"
          />
          <button type="submit" class="primary">Filter</button>
          ${q || state || hunter ? '<a href="/dashboard/leads" style="padding: 8px 16px; color: var(--text-secondary); text-decoration: none;">Clear</a>' : ""}
        </form>
      </div>

      ${alert({
        type: "info",
        message:
          "Approval and sending happens in Slack. This page provides read-only visibility into the pipeline.",
      })}

      ${
        contacts.length > 0
          ? `
        <div class="card" style="padding: 0; overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Title</th>
                <th>Score</th>
                <th>State</th>
                <th>Hunter</th>
                <th>Reason Codes</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              ${contacts
                .map((c) => {
                  const reasonCodes = (c.score_breakdown?.reason_codes ?? []).join(", ");
                  const hunterTag = c.hunter_tags?.[0] ?? "—";
                  const notionLink = c.notion_page_id
                    ? `<a href="https://notion.so/${c.notion_page_id}" target="_blank" style="color: var(--accent-gold); text-decoration: none; margin-right: 8px;">Notion</a>`
                    : "";
                  const gmailLink = c.gmail_thread_id
                    ? `<a href="https://mail.google.com/mail/u/0/#search/${encodeURIComponent(c.gmail_thread_id)}" target="_blank" style="color: var(--accent-gold); text-decoration: none;">Gmail</a>`
                    : "";

                  return `<tr>
                  <td style="font-weight: 500;">${esc(c.name)}</td>
                  <td>${esc(c.title ?? "—")}</td>
                  <td style="font-variant-numeric: tabular-nums;">
                    <span style="display: inline-block; padding: 2px 8px; background: ${
                      c.fit_score >= 8
                        ? "var(--success-dim)"
                        : c.fit_score >= 6
                          ? "var(--warning-dim)"
                          : "rgba(255,255,255,0.05)"
                    }; border-radius: 4px; font-size: 12px; font-weight: 600;">
                      ${c.fit_score}/10
                    </span>
                  </td>
                  <td>${stateBadge(c.state)}</td>
                  <td style="font-size: 12px; color: var(--text-secondary);">${esc(hunterTag)}</td>
                  <td style="font-size: 12px; color: var(--text-secondary); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${esc(reasonCodes || "—")}
                  </td>
                  <td style="white-space: nowrap;">
                    ${notionLink}${gmailLink}
                    ${!notionLink && !gmailLink ? "—" : ""}
                  </td>
                </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 16px;">
          Showing ${contacts.length} lead${contacts.length === 1 ? "" : "s"}
        </div>
      `
          : emptyState({
              title: "No leads found",
              description:
                q || state || hunter
                  ? "Try adjusting your filters or clearing them to see all leads."
                  : "No leads have been discovered yet. Check the Overview page to run hunters.",
            })
      }
    `;

    return reply.type("text/html").send(
      layout({
        title: "Leads",
        pageTitle: "Leads & Activity",
        pageDescription:
          "Browse discovered prospects, review qualification scores, and track engagement",
        body,
        csrf: user.csrf,
        user: user.email,
        activePage: "leads",
      }),
    );
  });

  app.post("/dashboard/pause", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    if (!checkCsrf(req, user)) return reply.code(403).send("csrf");
    const body = req.body as { which?: string; paused?: string };
    if (body.which !== "discovery" && body.which !== "outbound")
      return reply.code(400).send("bad which");
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
    const urls = (body.source_urls ?? "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
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
      return reply
        .code(503)
        .send("OIDC is not configured. Local fixture login is for development only.");
    }
    const url = new URL(
      "/authorize",
      cfg.OIDC_ISSUER.endsWith("/") ? cfg.OIDC_ISSUER : cfg.OIDC_ISSUER + "/",
    );
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
