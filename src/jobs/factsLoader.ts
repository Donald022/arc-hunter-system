import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig } from "../config.ts";
import {
  loadFactsFromFile,
  loadFactsFromObject,
  type ApprovedFactsBundle,
} from "../domain/facts.ts";
import { buildFactsFromNotionRows } from "../domain/notionFacts.ts";

let cached: ApprovedFactsBundle | undefined;

async function loadFactsFromNotionSource(): Promise<ApprovedFactsBundle> {
  const cfg = getConfig();
  const { fetchFactsRows, fetchFactsPropertyNames } = await import("../integrations/notion.ts");
  // Schema is fetched independently of rows so the claim_per_row contract can be
  // validated even when the database has zero rows.
  const propertyNames = await fetchFactsPropertyNames();
  const rows = await fetchFactsRows();
  const result = buildFactsFromNotionRows(
    rows,
    { recordModel: cfg.NOTION_FACTS_RECORD_MODEL, propertyNames },
    new Date(),
  );
  if (!result.ok) throw new Error(result.reason);
  return result.bundle;
}

export async function loadFactsCached(
  loader?: () => Promise<unknown>,
): Promise<ApprovedFactsBundle> {
  if (cached) return cached;
  if (loader) {
    cached = loadFactsFromObject(await loader());
    return cached;
  }
  if (getConfig().FACTS_SOURCE === "notion") {
    cached = await loadFactsFromNotionSource();
    return cached;
  }
  const local = resolve(process.cwd(), "config/arc_external_facts.json");
  const example = resolve(process.cwd(), "config/arc_external_facts.example.json");
  const path = existsSync(local) ? local : example;
  cached = loadFactsFromFile(path);
  return cached;
}

/**
 * Sanitized, fail-closed variant for call sites that must never crash on a facts
 * failure (Notion outage, ambiguous record model, no valid facts, malformed file).
 * The reason string is a short code only — never fact content, ids, or wording.
 */
export type FactsLoadResult =
  { ok: true; facts: ApprovedFactsBundle } | { ok: false; reason: string };

export async function loadFactsSafe(): Promise<FactsLoadResult> {
  try {
    const facts = await loadFactsCached();
    return { ok: true, facts };
  } catch (err) {
    const reason = err instanceof Error && err.message ? err.message : "facts_unavailable";
    // Only ever surface short, known reason codes — never raw error text that could
    // include file paths, stack detail, or (in principle) fact content.
    const safe =
      /^[a-z0-9_:.-]+$/i.test(reason) && reason.length <= 80 ? reason : "facts_unavailable";
    return { ok: false, reason: safe };
  }
}

export function resetFactsCache(): void {
  cached = undefined;
}

export function setFactsForTests(bundle: ApprovedFactsBundle): void {
  cached = bundle;
}

export function factsFilePresent(): boolean {
  return existsSync(resolve(process.cwd(), "config/arc_external_facts.example.json"));
}
