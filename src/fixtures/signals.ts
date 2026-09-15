import type { Hunter, Role, Signal } from "../domain/types.ts";
import { contentHash } from "../domain/identities.ts";

function s(p: Omit<Signal, "raw_content_hash" | "observed_at" | "extractor_version">): Signal {
  return {
    ...p,
    observed_at: "2026-09-01T00:00:00.000Z",
    extractor_version: "fixture_v1",
    raw_content_hash: contentHash([p.hunter, p.source_url, p.company, p.person, p.quoted_evidence]),
  };
}

export const FIXTURE_CONTACTS = {
  vaBroker: {
    name: "Alex Rivera",
    company: "Example Capital Advisors",
    domain: "example-capital-advisors.test",
    title: "Managing Director, Data Center Tenant Representation",
    role: "Intermediary" as Role,
    profile: "https://example-capital-advisors.test/team/alex-rivera",
    email: "alex.rivera@example-capital-advisors.test",
  },
  mexicoGeneric: {
    name: "Jordan Lee",
    company: "Sol y Casa Realty",
    domain: "solycasa-realty.test",
    title: "Residential and General Commercial Agent",
    role: "Intermediary" as Role,
    profile: "https://solycasa-realty.test/agents/jordan-lee",
  },
  neocloud: {
    name: "Sam Okonkwo",
    company: "Northwind Cloud",
    domain: "northwind-cloud.test",
    title: "VP Real Estate and Infrastructure",
    role: "Direct Buyer" as Role,
    profile: "https://northwind-cloud.test/leadership/sam-okonkwo",
    email: "sam.okonkwo@northwind-cloud.test",
  },
  expansion: {
    name: "Priya Shah",
    company: "Helios Compute",
    domain: "helios-compute.test",
    title: "Head of Capacity Procurement",
    role: "Direct Buyer" as Role,
    profile: "https://helios-compute.test/news/capacity",
  },
  deal: {
    name: "Morgan Chen",
    company: "Summit Site Advisors",
    domain: "summit-site.test",
    title: "Principal, Hyperscale Transactions",
    role: "Intermediary" as Role,
    profile: "https://summit-site.test/deals/2026-va-campus",
    email: "morgan.chen@summit-site.test",
  },
  network: {
    name: "Riley Patel",
    company: "Infra Alliance",
    domain: "infra-alliance.test",
    title: "Partnerships Director",
    role: "Introducer" as Role,
    profile: "https://datacenter-summit.test/speakers/riley-patel",
  },
};

export function fixtureSignals(url: string, hunter: Hunter): Signal[] {
  switch (url) {
    case "fixture://broker-va-tenant-rep":
      return [
        s({
          hunter,
          source_url: "https://example-capital-advisors.test/practices/data-centers",
          source_title: "Data Center Tenant Representation — Northern Virginia",
          publisher: "example-capital-advisors.test",
          company: FIXTURE_CONTACTS.vaBroker.company,
          company_domain: FIXTURE_CONTACTS.vaBroker.domain,
          person: FIXTURE_CONTACTS.vaBroker.name,
          title: FIXTURE_CONTACTS.vaBroker.title,
          role: FIXTURE_CONTACTS.vaBroker.role,
          signal_type: "practice_bio",
          quoted_evidence:
            "Alex Rivera leads occupier representation for hyperscale and wholesale data-center leases in Northern Virginia, including documented 30 MW+ campus assignments.",
          confidence: 0.9,
        }),
        s({
          hunter,
          source_url: "https://example-capital-advisors.test/practices/data-centers",
          source_title: "Data Center Tenant Representation — Northern Virginia (duplicate page)",
          publisher: "example-capital-advisors.test",
          company: FIXTURE_CONTACTS.vaBroker.company,
          company_domain: FIXTURE_CONTACTS.vaBroker.domain,
          person: FIXTURE_CONTACTS.vaBroker.name,
          title: FIXTURE_CONTACTS.vaBroker.title,
          role: FIXTURE_CONTACTS.vaBroker.role,
          signal_type: "practice_bio",
          quoted_evidence:
            "Alex Rivera leads occupier representation for hyperscale and wholesale data-center leases in Northern Virginia, including documented 30 MW+ campus assignments.",
          confidence: 0.9,
        }),
      ];
    case "fixture://generic-cre-mexico":
      return [
        s({
          hunter,
          source_url: "https://solycasa-realty.test/agents/jordan-lee",
          source_title: "Mexico City residential and general commercial listings",
          publisher: "solycasa-realty.test",
          company: FIXTURE_CONTACTS.mexicoGeneric.company,
          company_domain: FIXTURE_CONTACTS.mexicoGeneric.domain,
          person: FIXTURE_CONTACTS.mexicoGeneric.name,
          title: FIXTURE_CONTACTS.mexicoGeneric.title,
          role: FIXTURE_CONTACTS.mexicoGeneric.role,
          signal_type: "agent_bio",
          quoted_evidence:
            "Jordan Lee sells apartments and generic office listings in Mexico City. No infrastructure, occupier, or data-center practice is described.",
          confidence: 0.8,
        }),
      ];
    case "fixture://tenant-neocloud-expansion":
      return [
        s({
          hunter,
          source_url: "https://northwind-cloud.test/news/infrastructure-2026",
          source_title: "Northwind Cloud expands GPU capacity",
          publisher: "northwind-cloud.test",
          company: FIXTURE_CONTACTS.neocloud.company,
          company_domain: FIXTURE_CONTACTS.neocloud.domain,
          person: FIXTURE_CONTACTS.neocloud.name,
          title: FIXTURE_CONTACTS.neocloud.title,
          role: FIXTURE_CONTACTS.neocloud.role,
          signal_type: "company_news",
          quoted_evidence:
            "VP Real Estate and Infrastructure Sam Okonkwo said the company is procuring additional wholesale data-center capacity for GPU clusters.",
          confidence: 0.85,
        }),
      ];
    case "fixture://expansion-capital-and-mw":
      return [
        s({
          hunter,
          source_url: "https://helios-compute.test/press/series-c-capacity",
          source_title: "Helios Compute raises capital to add 40 MW",
          publisher: "helios-compute.test",
          company: FIXTURE_CONTACTS.expansion.company,
          company_domain: FIXTURE_CONTACTS.expansion.domain,
          person: FIXTURE_CONTACTS.expansion.name,
          title: FIXTURE_CONTACTS.expansion.title,
          role: FIXTURE_CONTACTS.expansion.role,
          signal_type: "capital_and_capacity",
          quoted_evidence:
            "Helios Compute announced a capital raise to fund a 40 MW IT capacity expansion and named Priya Shah as head of capacity procurement.",
          confidence: 0.8,
        }),
      ];
    case "fixture://deal-hyperscale-lease":
      return [
        s({
          hunter,
          source_url: "https://summit-site.test/news/va-hyperscale-lease",
          source_title: "Summit advised tenant on 50 MW Virginia lease",
          publisher: "summit-site.test",
          company: FIXTURE_CONTACTS.deal.company,
          company_domain: FIXTURE_CONTACTS.deal.domain,
          person: FIXTURE_CONTACTS.deal.name,
          title: FIXTURE_CONTACTS.deal.title,
          role: FIXTURE_CONTACTS.deal.role,
          signal_type: "reported_lease",
          quoted_evidence:
            "Morgan Chen represented the unnamed hyperscale occupier on a publicly reported 50 MW data-center lease in Northern Virginia.",
          confidence: 0.88,
        }),
      ];
    case "fixture://network-conference-speaker":
      return [
        s({
          hunter,
          source_url: "https://datacenter-summit.test/speakers/riley-patel",
          source_title: "Riley Patel — infrastructure partnerships",
          publisher: "datacenter-summit.test",
          company: FIXTURE_CONTACTS.network.company,
          company_domain: FIXTURE_CONTACTS.network.domain,
          person: FIXTURE_CONTACTS.network.name,
          title: FIXTURE_CONTACTS.network.title,
          role: FIXTURE_CONTACTS.network.role,
          signal_type: "conference_speaker",
          quoted_evidence:
            "Riley Patel moderates operator–investor introductions at the Data Center Summit and manages sector partnerships for Infra Alliance.",
          confidence: 0.75,
        }),
      ];
    default:
      return [];
  }
}

export function allFixtureHunterIds(): string[] {
  return [
    "fixture://broker-va-tenant-rep",
    "fixture://tenant-neocloud-expansion",
    "fixture://expansion-capital-and-mw",
    "fixture://deal-hyperscale-lease",
    "fixture://network-conference-speaker",
  ];
}
