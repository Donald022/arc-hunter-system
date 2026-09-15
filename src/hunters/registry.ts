import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { HUNTERS, type Hunter } from "../domain/types.ts";

export const PARSER_TYPES = ["rss", "html", "csv", "page", "fixture"] as const;
export type ParserType = (typeof PARSER_TYPES)[number];

export const sourceSchema = z.object({
  id: z.string(),
  hunter: z.enum(HUNTERS),
  parser: z.enum(PARSER_TYPES),
  enabled: z.boolean().default(false),
  cadence: z.string().default("daily"),
  url: z.string(),
  selector: z.string().optional(),
  notes: z.string().optional(),
});

export type SourceDef = z.infer<typeof sourceSchema>;

export const registrySchema = z.object({
  sources: z.array(sourceSchema),
  target_accounts: z
    .object({
      brokers: z.array(z.string()).default([]),
      operators: z.array(z.string()).default([]),
    })
    .default({ brokers: [], operators: [] }),
});

export type SourceRegistry = z.infer<typeof registrySchema>;

export function loadRegistry(path = resolve(process.cwd(), "config/sources.yml")): SourceRegistry {
  const raw = YAML.parse(readFileSync(path, "utf8"));
  return registrySchema.parse(raw);
}

export function sourcesForHunter(registry: SourceRegistry, hunter: Hunter, enabledOnly = true): SourceDef[] {
  return registry.sources.filter((s) => s.hunter === hunter && (!enabledOnly || s.enabled));
}

export function parserSupported(parser: string): parser is ParserType {
  return (PARSER_TYPES as readonly string[]).includes(parser);
}
