-- Private ARC ledger. Applied with search_path set to DB_SCHEMA (arc or arc_test).
-- RLS enabled with no policies so Data API / anon roles cannot read even if schema were exposed.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT UNIQUE,
  segment TEXT,
  region_signals TEXT[] NOT NULL DEFAULT '{}',
  why_relevant TEXT,
  source_urls TEXT[] NOT NULL DEFAULT '{}',
  account_priority INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen TIMESTAMPTZ,
  notion_page_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hunter TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  seed_domains TEXT[] NOT NULL DEFAULT '{}',
  source_urls TEXT[] NOT NULL DEFAULT '{}',
  search_terms TEXT[] NOT NULL DEFAULT '{}',
  region_boost TEXT NOT NULL DEFAULT '',
  daily_research_cap INTEGER NOT NULL DEFAULT 20,
  daily_send_cap INTEGER NOT NULL DEFAULT 5,
  last_run TIMESTAMPTZ,
  notion_page_id TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  title TEXT,
  work_email TEXT,
  email_confidence TEXT NOT NULL DEFAULT 'None',
  profile_url TEXT,
  hunter_tags TEXT[] NOT NULL DEFAULT '{}',
  role TEXT,
  direct_buyer_potential INTEGER NOT NULL DEFAULT 0,
  connection_potential INTEGER NOT NULL DEFAULT 0,
  fit_score INTEGER NOT NULL DEFAULT 0,
  evidence_summary TEXT,
  personalization_fact TEXT,
  source_date DATE,
  state TEXT NOT NULL DEFAULT 'DISCOVERED',
  do_not_contact BOOLEAN NOT NULL DEFAULT false,
  owner TEXT,
  last_contacted TIMESTAMPTZ,
  gmail_thread_id TEXT,
  internal_lead_id TEXT,
  score_breakdown JSONB,
  campaign_id TEXT REFERENCES campaigns(id),
  notion_page_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contacts_work_email_uidx
  ON contacts (work_email) WHERE work_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_profile_url_uidx
  ON contacts (profile_url) WHERE profile_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hunter TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  company_name TEXT NOT NULL,
  company_id UUID REFERENCES companies(id),
  person TEXT,
  contact_id UUID REFERENCES contacts(id),
  role TEXT,
  signal_type TEXT NOT NULL,
  quoted_evidence TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  raw_content_hash TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES signals(id),
  contact_id UUID REFERENCES contacts(id),
  company_id UUID REFERENCES companies(id),
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL UNIQUE,
  quoted_text TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  hunter TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  version INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  fact_version_hash TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  sender_address TEXT NOT NULL,
  approval_hash TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  invalidated BOOLEAN NOT NULL DEFAULT false,
  personalization_claims JSONB NOT NULL DEFAULT '[]',
  arc_claim_ids TEXT[] NOT NULL DEFAULT '{}',
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, version)
);

CREATE TABLE IF NOT EXISTS outreach_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS send_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  campaign_id TEXT NOT NULL,
  draft_id UUID NOT NULL REFERENCES drafts(id),
  draft_version INTEGER NOT NULL,
  first_touch BOOLEAN NOT NULL DEFAULT true,
  rfc_message_id TEXT NOT NULL UNIQUE,
  gmail_message_id TEXT UNIQUE,
  gmail_thread_id TEXT,
  status TEXT NOT NULL,
  exact_body TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS send_attempts_first_touch_uidx
  ON send_attempts (contact_id, campaign_id) WHERE first_touch;

CREATE TABLE IF NOT EXISTS suppression (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  domain TEXT,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suppression_email_uidx ON suppression (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS suppression_domain_uidx ON suppression (domain) WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job TEXT NOT NULL,
  hunter TEXT,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  result JSONB,
  error TEXT
);

CREATE TABLE IF NOT EXISTS external_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity TEXT NOT NULL,
  internal_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  last_hash TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity, internal_id)
);

CREATE TABLE IF NOT EXISTS llm_usage (
  day DATE PRIMARY KEY,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_usd NUMERIC(12,6) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enrichment_usage (
  day DATE PRIMARY KEY,
  credits INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pause_switches (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  discovery_paused BOOLEAN NOT NULL DEFAULT false,
  outbound_paused BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL DEFAULT 'system'
);

INSERT INTO pause_switches (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  setting TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  notion_sync TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS slack_replays (
  nonce TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE pause_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
