export const HUNTERS = ["broker", "tenant", "expansion", "deal", "network"] as const;
export type Hunter = (typeof HUNTERS)[number];

export const SEGMENTS = ["Broker", "Tenant", "Colo", "Neocloud", "Advisor", "Network"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const ROLES = ["Direct Buyer", "Intermediary", "Introducer"] as const;
export type Role = (typeof ROLES)[number];

export const EMAIL_CONFIDENCE = ["Verified", "Public", "Unverified", "None"] as const;
export type EmailConfidence = (typeof EMAIL_CONFIDENCE)[number];

export const CONTACT_STATES = [
  "DISCOVERED",
  "RESEARCHING",
  "RESEARCH_REVIEW",
  "DISQUALIFIED",
  "QUALIFIED",
  "QUALIFIED_NO_EMAIL",
  "DRAFT_READY",
  "FACT_REVIEW",
  "PENDING_APPROVAL",
  "EDITING",
  "APPROVED",
  "SENDING",
  "SENT",
  "REPLIED",
  "SKIPPED",
  "DNC",
  "SEND_UNCERTAIN",
  "SEND_FAILED",
  "BOUNCED",
  "MANUAL_HANDOFF",
] as const;
export type ContactState = (typeof CONTACT_STATES)[number];

export const TERMINAL_NO_AUTO_SEND: ReadonlySet<ContactState> = new Set([
  "REPLIED",
  "DNC",
  "DISQUALIFIED",
  "BOUNCED",
  "MANUAL_HANDOFF",
]);

export const ACTIVITY_TYPES = [
  "Discovered",
  "Qualified",
  "Drafted",
  "Approved",
  "Edited",
  "Skipped",
  "DNC",
  "Sent",
  "Replied",
  "Bounced",
  "Error",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface Signal {
  hunter: Hunter;
  source_url: string;
  source_title: string;
  publisher: string;
  observed_at: string;
  published_at?: string;
  company: string;
  company_domain?: string;
  person?: string;
  title?: string;
  role?: Role;
  signal_type: string;
  quoted_evidence: string;
  extractor_version: string;
  confidence: number;
  raw_content_hash: string;
}

export interface ScoreBreakdown {
  dc_specialty: number;
  buyer_or_tenant: number;
  hyperscale_experience: number;
  expansion_signal: number;
  influence: number;
  geo_bonus: number;
  personalization: number;
  total: number;
  reason_codes: string[];
  hard_gate_pass: boolean;
  hard_gate_reasons: string[];
}

export interface ContactRecord {
  id: string;
  company_id: string;
  name: string;
  title?: string;
  work_email?: string;
  email_confidence: EmailConfidence;
  profile_url?: string;
  hunter_tags: Hunter[];
  role?: Role;
  direct_buyer_potential: number;
  connection_potential: number;
  fit_score: number;
  evidence_summary?: string;
  personalization_fact?: string;
  source_date?: string;
  state: ContactState;
  do_not_contact: boolean;
  owner?: string;
  last_contacted?: string;
  gmail_thread_id?: string;
  internal_lead_id?: string;
  score_breakdown?: ScoreBreakdown;
  campaign_id?: string;
  notion_page_id?: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyRecord {
  id: string;
  name: string;
  domain?: string;
  segment?: Segment;
  region_signals: string[];
  why_relevant?: string;
  source_urls: string[];
  account_priority: number;
  owner?: string;
  status: string;
  last_seen?: string;
  notion_page_id?: string;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRecord {
  id: string;
  signal_id?: string;
  contact_id?: string;
  company_id?: string;
  url: string;
  url_hash: string;
  quoted_text: string;
  published_at?: string;
  observed_at: string;
  hunter: Hunter;
}

export interface DraftRecord {
  id: string;
  contact_id: string;
  version: number;
  subject: string;
  body: string;
  body_hash: string;
  fact_version_hash: string;
  contact_email: string;
  sender_address: string;
  approval_hash?: string;
  approved_by?: string;
  approved_at?: string;
  invalidated: boolean;
  personalization_claims: Array<{ text: string; evidence_url: string }>;
  arc_claim_ids: string[];
  word_count: number;
  created_at: string;
}

export interface SendAttempt {
  id: string;
  contact_id: string;
  campaign_id: string;
  draft_id: string;
  draft_version: number;
  first_touch: boolean;
  rfc_message_id: string;
  gmail_message_id?: string;
  gmail_thread_id?: string;
  status: "reserved" | "sent" | "failed" | "uncertain";
  exact_body: string;
  actor: string;
  created_at: string;
  sent_at?: string;
  error?: string;
}

export interface JobRun {
  id: string;
  job: string;
  hunter?: Hunter;
  status: "running" | "ok" | "error";
  started_at: string;
  finished_at?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface CampaignRecord {
  id: string;
  name: string;
  hunter: Hunter;
  enabled: boolean;
  seed_domains: string[];
  source_urls: string[];
  search_terms: string[];
  region_boost: string;
  daily_research_cap: number;
  daily_send_cap: number;
  last_run?: string;
  notion_page_id?: string;
}

export interface PauseState {
  discovery_paused: boolean;
  outbound_paused: boolean;
  updated_at: string;
  updated_by: string;
}

export interface ApprovedFact {
  id: string;
  claim: string;
  basis: string;
  evidence_url_or_document: string;
  approved_wording: string;
  approved_by: string;
  approved_at: string;
  valid_until: string;
  can_use_in_first_touch: boolean;
}

export interface ApprovedFactsBundle {
  version_hash: string;
  loaded_at: string;
  utility_mw_current_verified: string;
  utility_mw_target: string;
  it_mw_planned: string;
  land_control_status: string;
  site_location_disclosure: string;
  target_rfs_status: string;
  legal_sender_entity: string;
  approved_sender_name_title: string;
  reply_to: string;
  postal_address: string;
  opt_out_instructions: string;
  restricted_claims: string[];
  facts: ApprovedFact[];
}

export interface OutreachEvent {
  id: string;
  contact_id?: string;
  type: ActivityType | string;
  actor: string;
  at: string;
  payload: Record<string, unknown>;
}
