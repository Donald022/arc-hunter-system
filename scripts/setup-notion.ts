import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyHunterDatabases, inspectNotionParent, REQUIRED_PROPERTIES, NOTION_VIEWS } from "../src/integrations/notion.ts";
import { getConfig } from "../src/config.ts";

const apply = process.argv.includes("--apply");

function upsertEnv(values: Record<string, string>): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) throw new Error("missing_.env");
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const keys = new Set(Object.keys(values));
  const next = lines.map((line) => {
    const eq = line.indexOf("=");
    if (eq < 1) return line;
    const key = line.slice(0, eq).trim();
    if (!keys.has(key)) return line;
    keys.delete(key);
    return `${key}=${values[key]}`;
  });
  for (const key of keys) next.push(`${key}=${values[key]}`);
  writeFileSync(path, next.join("\n"), "utf8");
}

async function main() {
  const inspect = await inspectNotionParent();
  const liveChildren = (inspect.live?.children ?? []).map((c) => ({
    title: c.title,
    spec_key: c.spec_key,
    data_source_id: c.data_source_id,
    missing: c.missing,
  }));
  console.log(
    JSON.stringify(
      {
        parent: inspect.live?.parent ?? inspect.parent,
        existing: liveChildren,
        unmapped: inspect.live?.unmapped_required,
        env_already: inspect.mapped,
        required: REQUIRED_PROPERTIES,
        views_to_add_manually: NOTION_VIEWS,
      },
      null,
      2,
    ),
  );
  if (!apply) {
    console.log("Dry inspect only. Existing Market Map / CRM databases were not changed.");
    return;
  }
  const cfg = getConfig();
  if (!cfg.NOTION_TOKEN || !cfg.NOTION_PARENT_PAGE_ID) {
    throw new Error("NOTION_TOKEN and NOTION_PARENT_PAGE_ID required for --apply");
  }
  const result = await applyHunterDatabases();
  upsertEnv(result.env);
  console.log(JSON.stringify({ applied: true, created: result.created, skipped: result.skipped, env_keys: Object.keys(result.env) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
