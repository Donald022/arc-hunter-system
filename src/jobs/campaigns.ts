import type { CampaignRecord, Hunter } from "../domain/types.ts";
import type { Store } from "../db/types.ts";
import { getStore } from "../db/pool.ts";

export const DEFAULT_CAMPAIGNS: CampaignRecord[] = [
  {
    id: "camp-broker",
    name: "Broker Hunter",
    hunter: "broker",
    enabled: true,
    seed_domains: ["cbre.com", "jll.com", "nmrk.com", "cushmanwakefield.com", "colliers.com", "cresa.com"],
    source_urls: ["fixture://broker-va-tenant-rep"],
    search_terms: ["data center tenant representation", "hyperscale occupier"],
    region_boost: "Mexico/LATAM bonus only",
    daily_research_cap: 20,
    daily_send_cap: 5,
  },
  {
    id: "camp-tenant",
    name: "Tenant Hunter",
    hunter: "tenant",
    enabled: true,
    seed_domains: [],
    source_urls: ["fixture://tenant-neocloud-expansion"],
    search_terms: ["capacity procurement", "infrastructure expansion"],
    region_boost: "Mexico/LATAM bonus only",
    daily_research_cap: 20,
    daily_send_cap: 5,
  },
  {
    id: "camp-expansion",
    name: "Expansion Signal Hunter",
    hunter: "expansion",
    enabled: true,
    seed_domains: [],
    source_urls: ["fixture://expansion-capital-and-mw"],
    search_terms: ["MW expansion", "capital raise capacity"],
    region_boost: "Mexico/LATAM bonus only",
    daily_research_cap: 20,
    daily_send_cap: 5,
  },
  {
    id: "camp-deal",
    name: "Deal Hunter",
    hunter: "deal",
    enabled: true,
    seed_domains: [],
    source_urls: ["fixture://deal-hyperscale-lease"],
    search_terms: ["hyperscale lease", "site acquisition"],
    region_boost: "Mexico/LATAM bonus only",
    daily_research_cap: 20,
    daily_send_cap: 5,
  },
  {
    id: "camp-network",
    name: "Network Hunter",
    hunter: "network",
    enabled: true,
    seed_domains: [],
    source_urls: ["fixture://network-conference-speaker"],
    search_terms: ["conference speaker", "sector partnerships"],
    region_boost: "Mexico/LATAM bonus only",
    daily_research_cap: 20,
    daily_send_cap: 5,
  },
];

export async function seedDefaultCampaigns(store: Store = getStore()): Promise<void> {
  const existing = await store.campaigns.list();
  if (existing.length) return;
  for (const c of DEFAULT_CAMPAIGNS) await store.campaigns.upsert(c);
}

export function hunterToCampaignId(hunter: Hunter): string {
  return `camp-${hunter}`;
}
