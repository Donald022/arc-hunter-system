import { randomUUID } from "node:crypto";
import type {
  CampaignRecord,
  CompanyRecord,
  ContactRecord,
  ContactState,
  DraftRecord,
  EvidenceRecord,
  Hunter,
  JobRun,
  OutreachEvent,
  PauseState,
  SendAttempt,
  Signal,
} from "../domain/types.ts";

export interface SignalRow {
  id: string;
  hunter: Hunter;
  source_url: string;
  source_title: string;
  publisher: string;
  observed_at: string;
  published_at?: string;
  company_name: string;
  company_id?: string;
  person?: string;
  contact_id?: string;
  role?: string;
  signal_type: string;
  quoted_evidence: string;
  extractor_version: string;
  confidence: number;
  raw_content_hash: string;
}

export interface SuppressionRow {
  id: string;
  email?: string;
  domain?: string;
  reason: string;
  actor: string;
  created_at: string;
}

export interface LlmUsageRow {
  id: string;
  day: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_usd: number;
}

export interface AuditRow {
  id: string;
  actor: string;
  at: string;
  setting: string;
  old_value: unknown;
  new_value: unknown;
  notion_sync: string;
}

export interface ExternalSyncRow {
  id: string;
  entity: string;
  internal_id: string;
  external_id: string;
  last_hash?: string;
  last_synced_at: string;
}

export interface StateTransitionRow {
  id: string;
  contact_id: string;
  from_state: ContactState;
  to_state: ContactState;
  actor: string;
  at: string;
  reason?: string;
}

export interface Store {
  companies: {
    upsert(
      input: Omit<CompanyRecord, "id" | "created_at" | "updated_at"> & { id?: string },
    ): Promise<CompanyRecord>;
    get(id: string): Promise<CompanyRecord | undefined>;
    byDomain(domain: string): Promise<CompanyRecord | undefined>;
    list(): Promise<CompanyRecord[]>;
  };
  contacts: {
    upsert(
      input: Omit<ContactRecord, "id" | "created_at" | "updated_at"> & { id?: string },
    ): Promise<ContactRecord>;
    get(id: string): Promise<ContactRecord | undefined>;
    byEmail(email: string): Promise<ContactRecord | undefined>;
    byProfile(url: string): Promise<ContactRecord | undefined>;
    list(filter?: { state?: ContactState; hunter?: Hunter; q?: string }): Promise<ContactRecord[]>;
    setState(id: string, to: ContactState, actor: string, reason?: string): Promise<ContactRecord>;
  };
  signals: {
    insert(
      signal: Signal,
      extras?: { company_id?: string; contact_id?: string },
    ): Promise<SignalRow>;
    byHash(hash: string): Promise<SignalRow | undefined>;
    list(): Promise<SignalRow[]>;
  };
  evidence: {
    insert(row: Omit<EvidenceRecord, "id"> & { id?: string }): Promise<EvidenceRecord>;
    byUrlHash(hash: string): Promise<EvidenceRecord | undefined>;
    forContact(contactId: string): Promise<EvidenceRecord[]>;
    forCompany(companyId: string): Promise<EvidenceRecord[]>;
  };
  drafts: {
    insert(row: Omit<DraftRecord, "id" | "created_at"> & { id?: string }): Promise<DraftRecord>;
    get(id: string): Promise<DraftRecord | undefined>;
    latestForContact(contactId: string): Promise<DraftRecord | undefined>;
    invalidate(id: string): Promise<void>;
  };
  events: {
    add(row: Omit<OutreachEvent, "id"> & { id?: string }): Promise<OutreachEvent>;
    list(contactId?: string): Promise<OutreachEvent[]>;
  };
  sends: {
    reserve(row: Omit<SendAttempt, "id" | "created_at"> & { id?: string }): Promise<SendAttempt>;
    get(id: string): Promise<SendAttempt | undefined>;
    byRfc(rfc: string): Promise<SendAttempt | undefined>;
    firstTouch(contactId: string, campaignId: string): Promise<SendAttempt | undefined>;
    update(id: string, patch: Partial<SendAttempt>): Promise<SendAttempt>;
    list(): Promise<SendAttempt[]>;
  };
  suppression: {
    add(row: Omit<SuppressionRow, "id" | "created_at"> & { id?: string }): Promise<SuppressionRow>;
    isSuppressed(email?: string, domain?: string): Promise<boolean>;
    list(): Promise<SuppressionRow[]>;
  };
  jobs: {
    start(job: string, hunter?: Hunter): Promise<JobRun>;
    finish(
      id: string,
      status: "ok" | "error",
      result?: Record<string, unknown>,
      error?: string,
    ): Promise<JobRun>;
    latestByJob(): Promise<JobRun[]>;
    get(id: string): Promise<JobRun | undefined>;
  };
  campaigns: {
    upsert(row: CampaignRecord): Promise<CampaignRecord>;
    get(id: string): Promise<CampaignRecord | undefined>;
    list(): Promise<CampaignRecord[]>;
  };
  pause: {
    get(): Promise<PauseState>;
    set(patch: Partial<PauseState>, actor: string): Promise<PauseState>;
  };
  llm: {
    getDay(day: string): Promise<LlmUsageRow>;
    add(
      day: string,
      requests: number,
      input: number,
      output: number,
      usd: number,
    ): Promise<LlmUsageRow>;
  };
  enrichment: {
    creditsToday(day: string): Promise<number>;
    addCredits(day: string, n: number): Promise<number>;
  };
  audit: {
    add(row: Omit<AuditRow, "id"> & { id?: string }): Promise<AuditRow>;
    list(): Promise<AuditRow[]>;
  };
  sync: {
    upsert(row: Omit<ExternalSyncRow, "id"> & { id?: string }): Promise<ExternalSyncRow>;
    get(entity: string, internalId: string): Promise<ExternalSyncRow | undefined>;
  };
  transitions: {
    list(contactId: string): Promise<StateTransitionRow[]>;
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(_prefix?: string): string {
  return randomUUID();
}
