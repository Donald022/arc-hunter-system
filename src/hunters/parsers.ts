import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig } from "../config.ts";
import { contentHash } from "../domain/identities.ts";
import type { Hunter, Role, Signal } from "../domain/types.ts";
import type { SourceDef } from "./registry.ts";
import { fixtureSignals } from "../fixtures/signals.ts";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254",
  "metadata.google.internal",
]);

export function isSsrfSafeUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (!["http:", "https:"].includes(url.protocol))
    return { ok: false, reason: "unsupported_protocol" };
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: "blocked_host" };
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|127\.)/.test(host)) {
    return { ok: false, reason: "private_network" };
  }
  return { ok: true, url };
}

export async function fetchText(
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const safe = isSsrfSafeUrl(url);
  if (!safe.ok) return safe;
  const cfg = getConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.SOURCE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(safe.url, {
      signal: ctrl.signal,
      headers: {
        "user-agent": cfg.SOURCE_USER_AGENT,
        accept: "text/html,application/rss+xml,application/xml,text/xml,text/csv",
      },
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const text = await res.text();
    return { ok: true, text };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "fetch_failed" };
  } finally {
    clearTimeout(t);
  }
}

function signal(
  partial: Omit<Signal, "raw_content_hash" | "observed_at" | "extractor_version"> & Partial<Signal>,
): Signal {
  const observed_at = partial.observed_at ?? new Date().toISOString();
  const extractor_version = partial.extractor_version ?? "v1";
  const raw_content_hash = contentHash([
    partial.hunter,
    partial.source_url,
    partial.company,
    partial.person,
    partial.quoted_evidence,
  ]);
  return { ...partial, observed_at, extractor_version, raw_content_hash };
}

export function parseRss(xml: string, source: SourceDef): Signal[] {
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)];
  const out: Signal[] = [];
  for (const m of items) {
    const block = m[0];
    const title = textBetween(block, "title") ?? source.id;
    const link = textBetween(block, "link") ?? source.url;
    const desc = stripTags(textBetween(block, "description") ?? "").slice(0, 400);
    const pub = textBetween(block, "pubDate");
    out.push(
      signal({
        hunter: source.hunter,
        source_url: link,
        source_title: stripTags(title),
        publisher: new URL(source.url).hostname,
        published_at: pub ? new Date(pub).toISOString() : undefined,
        company: guessCompany(title, desc),
        quoted_evidence: desc || stripTags(title),
        signal_type: "rss_item",
        confidence: 0.4,
      }),
    );
  }
  return out;
}

export function parseHtmlList(html: string, source: SourceDef): Signal[] {
  const titles = [...html.matchAll(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi)].map((m) =>
    stripTags(m[1] ?? ""),
  );
  if (!titles.length) {
    return [
      signal({
        hunter: source.hunter,
        source_url: source.url,
        source_title: source.id,
        publisher: hostname(source.url),
        company: hostname(source.url),
        quoted_evidence: "HTML parser found no people; company-level signal recorded.",
        signal_type: "company_page",
        confidence: 0.2,
      }),
    ];
  }
  return titles.slice(0, 20).map((t) =>
    signal({
      hunter: source.hunter,
      source_url: source.url,
      source_title: t,
      publisher: hostname(source.url),
      company: hostname(source.url),
      quoted_evidence: t.slice(0, 280),
      signal_type: "html_heading",
      confidence: 0.3,
    }),
  );
}

export function parseCsv(text: string, hunter: Hunter): Signal[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header) return [];
  const cols = header.split(",").map((c) => c.trim().toLowerCase());
  const idx = (name: string) => cols.indexOf(name);
  const out: Signal[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const company = cells[idx("company")] ?? "";
    const person = cells[idx("person")] || undefined;
    const url = cells[idx("source_url")] ?? cells[idx("url")] ?? "csv://manual";
    const evidence = cells[idx("evidence")] ?? cells[idx("quoted_evidence")] ?? "";
    const role = (cells[idx("role")] as Role | undefined) || undefined;
    out.push(
      signal({
        hunter,
        source_url: url,
        source_title: cells[idx("title")] || person || company,
        publisher: "manual-csv",
        company,
        person,
        title: cells[idx("title")] || undefined,
        role,
        quoted_evidence: evidence.slice(0, 400),
        signal_type: "manual_csv",
        confidence: 0.7,
        company_domain: cells[idx("domain")] || undefined,
      }),
    );
  }
  return out;
}

export async function parseSource(
  source: SourceDef,
): Promise<{ signals: Signal[]; error?: string; needsSetup?: boolean }> {
  if (source.parser === "fixture") {
    return { signals: fixtureSignals(source.url, source.hunter) };
  }
  if (source.parser === "csv") {
    if (source.url.startsWith("file://")) {
      const path = source.url.replace("file://", "");
      try {
        const text = readFileSync(
          resolve(process.cwd(), path.startsWith("fixtures") ? path : path),
          "utf8",
        );
        return { signals: parseCsv(text, source.hunter) };
      } catch (err) {
        return { signals: [], error: err instanceof Error ? err.message : "csv_read_failed" };
      }
    }
    const fetched = await fetchText(source.url);
    if (!fetched.ok) return { signals: [], error: fetched.reason };
    return { signals: parseCsv(fetched.text, source.hunter) };
  }
  if (source.parser === "rss") {
    const fetched = await fetchText(source.url);
    if (!fetched.ok)
      return { signals: [], error: fetched.reason, needsSetup: fetched.reason.startsWith("http_") };
    return { signals: parseRss(fetched.text, source) };
  }
  if (source.parser === "html" || source.parser === "page") {
    const fetched = await fetchText(source.url);
    if (!fetched.ok) return { signals: [], error: fetched.reason, needsSetup: true };
    return { signals: parseHtmlList(fetched.text, source) };
  }
  return { signals: [], error: "unsupported_parser", needsSetup: true };
}

function textBetween(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m?.[1]?.replace("<![CDATA[", "").replace("]]>", "").trim();
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function guessCompany(title: string, desc: string): string {
  const blob = `${title} ${desc}`;
  const m = blob.match(/\b([A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3})\b/);
  return m?.[1] ?? "Unknown company";
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function hashUrl(url: string): string {
  return createHash("sha256").update(url.trim().toLowerCase()).digest("hex");
}
