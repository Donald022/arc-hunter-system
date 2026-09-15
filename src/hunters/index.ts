import type { Hunter } from "../domain/types.ts";
import { loadRegistry, sourcesForHunter, type SourceRegistry } from "./registry.ts";
import { parseSource } from "./parsers.ts";
import type { Signal } from "../domain/types.ts";

export async function runHunter(
  hunter: Hunter,
  registry: SourceRegistry = loadRegistry(),
  opts: { includeDisabled?: boolean } = {},
): Promise<{
  signals: Signal[];
  errors: Array<{ source: string; error: string; needsSetup?: boolean }>;
}> {
  const sources = sourcesForHunter(registry, hunter, !opts.includeDisabled);
  const signals: Signal[] = [];
  const errors: Array<{ source: string; error: string; needsSetup?: boolean }> = [];
  for (const source of sources) {
    const result = await parseSource(source);
    signals.push(...result.signals);
    if (result.error)
      errors.push({ source: source.id, error: result.error, needsSetup: result.needsSetup });
  }
  return { signals, errors };
}

export { loadRegistry, sourcesForHunter };
