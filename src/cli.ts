import { getConfig } from "./config.ts";
import { useMemoryStore } from "./db/pool.ts";
import { seedDefaultCampaigns } from "./jobs/campaigns.ts";
import { discover } from "./jobs/discover.ts";
import { research } from "./jobs/research.ts";
import { draft } from "./jobs/draft.ts";
import { reconcile } from "./jobs/reconcile.ts";
import { replies } from "./jobs/replies.ts";
import { loadFactsCached } from "./jobs/factsLoader.ts";
import { HUNTERS, type Hunter } from "./domain/types.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  const pref = process.argv.find((a) => a.startsWith(`${name}=`));
  return pref?.slice(name.length + 1);
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  const cmd = process.argv[2] ?? "help";
  const store = useMemoryStore();
  await seedDefaultCampaigns(store);
  const hunterArg = arg("--hunter");
  const hunter =
    hunterArg && HUNTERS.includes(hunterArg as Hunter) ? (hunterArg as Hunter) : undefined;
  const limit = arg("--limit") ? Number(arg("--limit")) : undefined;
  const dryRun = flag("--dry-run") || getConfig().DRY_RUN;

  if (cmd === "discover") {
    const res = await discover({ hunter, dryRun, store });
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  if (cmd === "research") {
    await discover({ dryRun: false, store });
    const res = await research({ limit, store });
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  if (cmd === "draft") {
    const res = await draft({ limit, store });
    console.log(JSON.stringify(res, null, 2));
    return;
  }
  if (cmd === "reconcile") {
    console.log(JSON.stringify(await reconcile({ store }), null, 2));
    return;
  }
  if (cmd === "replies") {
    console.log(JSON.stringify(await replies({ store }), null, 2));
    return;
  }
  if (cmd === "demo") {
    await discover({ dryRun: false, store });
    const researched = await research({ store });
    const drafted = await draft({ store });
    const facts = await loadFactsCached();
    const contacts = await store.contacts.list();
    const signals = await store.signals.list();
    const summary = {
      hunters: HUNTERS,
      signals: signals.length,
      contacts: contacts.map((c) => ({
        name: c.name.includes(" ") ? `${c.name.split(" ")[0]} {{last}}` : "{{name}}",
        hunter: c.hunter_tags,
        state: c.state,
        score: c.fit_score,
        reasons: c.score_breakdown?.reason_codes ?? [],
      })),
      research: researched,
      draft: drafted,
      facts: {
        hash: facts.version_hash,
        can_use_in_first_touch: facts.facts.filter(
          (f: { can_use_in_first_touch: boolean }) => f.can_use_in_first_touch,
        ).length,
        sender_ready: Boolean(facts.legal_sender_entity && facts.postal_address),
      },
      note: "Fixture dry run. No live email, Notion write, or paid API call.",
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`commands: discover|research|draft|reconcile|replies|demo
  --hunter broker|tenant|expansion|deal|network
  --limit N
  --dry-run`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
