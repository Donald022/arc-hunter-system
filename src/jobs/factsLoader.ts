import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadFactsFromFile, loadFactsFromObject, type ApprovedFactsBundle } from "../domain/facts.ts";

let cached: ApprovedFactsBundle | undefined;

export async function loadFactsCached(loader?: () => Promise<unknown>): Promise<ApprovedFactsBundle> {
  if (cached) return cached;
  if (loader) {
    cached = loadFactsFromObject(await loader());
    return cached;
  }
  const local = resolve(process.cwd(), "config/arc_external_facts.json");
  const example = resolve(process.cwd(), "config/arc_external_facts.example.json");
  const path = existsSync(local) ? local : example;
  cached = loadFactsFromFile(path);
  return cached;
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
