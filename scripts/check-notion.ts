import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, resetConfigCache } from "../src/config.ts";

async function main() {
  const envPath = resolve(process.cwd(), ".env");
  console.log(
    JSON.stringify({
      cwd: process.cwd(),
      env_file: existsSync(envPath),
    }),
  );
  resetConfigCache();
  const raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const hasTokenLine = raw
    .split(/\r?\n/)
    .some((l) => l.startsWith("NOTION_TOKEN=") && l.length > "NOTION_TOKEN=".length);
  console.log(
    JSON.stringify({
      has_notion_token_line: hasTokenLine,
      token_line_length: raw.split(/\r?\n/).find((l) => l.startsWith("NOTION_TOKEN="))?.length ?? 0,
    }),
  );
  const cfg = loadConfig();
  console.log(JSON.stringify({ loaded_token_length: cfg.NOTION_TOKEN?.length ?? 0 }));
  if (!cfg.NOTION_TOKEN) {
    console.log("NOTION_TOKEN is empty");
    process.exit(1);
  }
  const headers = {
    authorization: `Bearer ${cfg.NOTION_TOKEN}`,
    "notion-version": cfg.NOTION_API_VERSION,
    "content-type": "application/json",
  };
  const meRes = await fetch("https://api.notion.com/v1/users/me", { headers });
  const me = (await meRes.json()) as {
    type?: string;
    name?: string;
    code?: string;
    message?: string;
    bot?: { workspace_name?: string };
  };
  console.log(
    JSON.stringify(
      {
        token_ok: meRes.ok,
        status: meRes.status,
        bot_name: me.name,
        workspace: me.bot?.workspace_name,
        error: me.code ?? me.message,
      },
      null,
      2,
    ),
  );
  if (!meRes.ok) process.exit(1);
  const searchRes = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ page_size: 20 }),
  });
  const search = (await searchRes.json()) as {
    results?: Array<{
      object: string;
      id: string;
      url?: string;
      properties?: Record<string, { title?: Array<{ plain_text?: string }> }>;
    }>;
  };
  const titles = (search.results ?? []).map((r) => ({
    object: r.object,
    id: r.id,
    url: r.url,
    name: r.properties?.Name?.title?.[0]?.plain_text ?? r.properties?.title?.title?.[0]?.plain_text,
  }));
  console.log(JSON.stringify({ pages_the_bot_can_see: titles.length, titles }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
