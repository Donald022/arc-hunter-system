import { assertTransition } from "../domain/states.ts";
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
} from "../domain/types.ts";
import { normalizeDomain, normalizeEmail, normalizeProfileUrl } from "../domain/identities.ts";
import {
  id,
  nowIso,
  type AuditRow,
  type ExternalSyncRow,
  type LlmUsageRow,
  type SignalRow,
  type StateTransitionRow,
  type Store,
  type SuppressionRow,
} from "./types.ts";

function clone<T>(v: T): T {
  return structuredClone(v);
}

export class MemoryStore implements Store {
  companiesMap = new Map<string, CompanyRecord>();
  contactsMap = new Map<string, ContactRecord>();
  signalsMap = new Map<string, SignalRow>();
  evidenceMap = new Map<string, EvidenceRecord>();
  draftsMap = new Map<string, DraftRecord>();
  eventsList: OutreachEvent[] = [];
  sendsMap = new Map<string, SendAttempt>();
  suppressionList: SuppressionRow[] = [];
  jobsMap = new Map<string, JobRun>();
  campaignsMap = new Map<string, CampaignRecord>();
  pauseState: PauseState = {
    discovery_paused: false,
    outbound_paused: false,
    updated_at: nowIso(),
    updated_by: "system",
  };
  llmMap = new Map<string, LlmUsageRow>();
  enrichMap = new Map<string, number>();
  auditList: AuditRow[] = [];
  syncMap = new Map<string, ExternalSyncRow>();
  transitionsList: StateTransitionRow[] = [];

  companies = {
    upsert: async (
      input: Omit<CompanyRecord, "id" | "created_at" | "updated_at"> & { id?: string },
    ) => {
      const domain = normalizeDomain(input.domain);
      if (domain) {
        const existing = [...this.companiesMap.values()].find((c) => c.domain === domain);
        if (existing) {
          const merged: CompanyRecord = {
            ...existing,
            ...input,
            id: existing.id,
            domain,
            source_urls: Array.from(
              new Set([...existing.source_urls, ...(input.source_urls ?? [])]),
            ),
            updated_at: nowIso(),
          };
          this.companiesMap.set(existing.id, merged);
          return clone(merged);
        }
      }
      const rec: CompanyRecord = {
        ...input,
        id: input.id ?? id("co"),
        domain,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      this.companiesMap.set(rec.id, rec);
      return clone(rec);
    },
    get: async (companyId: string) => clone(this.companiesMap.get(companyId)),
    byDomain: async (domain: string) => {
      const d = normalizeDomain(domain);
      return clone([...this.companiesMap.values()].find((c) => c.domain === d));
    },
    list: async () => clone([...this.companiesMap.values()]),
  };

  contacts = {
    upsert: async (
      input: Omit<ContactRecord, "id" | "created_at" | "updated_at"> & { id?: string },
    ) => {
      const email = normalizeEmail(input.work_email);
      const profile = normalizeProfileUrl(input.profile_url);
      if (email) {
        const existing = [...this.contactsMap.values()].find((c) => c.work_email === email);
        if (existing) {
          const merged: ContactRecord = {
            ...existing,
            ...input,
            id: existing.id,
            work_email: email,
            profile_url: profile ?? existing.profile_url,
            hunter_tags: Array.from(new Set([...existing.hunter_tags, ...input.hunter_tags])),
            state: existing.state,
            do_not_contact: existing.do_not_contact || Boolean(input.do_not_contact),
            updated_at: nowIso(),
          };
          this.contactsMap.set(existing.id, merged);
          return clone(merged);
        }
      }
      if (profile) {
        const existing = [...this.contactsMap.values()].find((c) => c.profile_url === profile);
        if (existing) {
          const merged: ContactRecord = {
            ...existing,
            ...input,
            id: existing.id,
            profile_url: profile,
            hunter_tags: Array.from(new Set([...existing.hunter_tags, ...input.hunter_tags])),
            state: existing.state,
            do_not_contact: existing.do_not_contact || Boolean(input.do_not_contact),
            updated_at: nowIso(),
          };
          this.contactsMap.set(existing.id, merged);
          return clone(merged);
        }
      }
      const existingSameEmployer = [...this.contactsMap.values()].find(
        (c) =>
          c.company_id === input.company_id &&
          c.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
      );
      if (existingSameEmployer) {
        const merged: ContactRecord = {
          ...existingSameEmployer,
          ...input,
          id: existingSameEmployer.id,
          work_email: email ?? existingSameEmployer.work_email,
          profile_url: profile ?? existingSameEmployer.profile_url,
          hunter_tags: Array.from(
            new Set([...existingSameEmployer.hunter_tags, ...input.hunter_tags]),
          ),
          state: existingSameEmployer.state,
          do_not_contact: existingSameEmployer.do_not_contact || Boolean(input.do_not_contact),
          updated_at: nowIso(),
        };
        this.contactsMap.set(existingSameEmployer.id, merged);
        return clone(merged);
      }
      const rec: ContactRecord = {
        ...input,
        id: input.id ?? id("ct"),
        work_email: email,
        profile_url: profile,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      this.contactsMap.set(rec.id, rec);
      return clone(rec);
    },
    get: async (contactId: string) => clone(this.contactsMap.get(contactId)),
    byEmail: async (email: string) => {
      const e = normalizeEmail(email);
      return clone([...this.contactsMap.values()].find((c) => c.work_email === e));
    },
    byProfile: async (url: string) => {
      const p = normalizeProfileUrl(url);
      return clone([...this.contactsMap.values()].find((c) => c.profile_url === p));
    },
    list: async (filter?: { state?: ContactState; hunter?: Hunter; q?: string }) => {
      let rows = [...this.contactsMap.values()];
      if (filter?.state) rows = rows.filter((c) => c.state === filter.state);
      if (filter?.hunter) rows = rows.filter((c) => c.hunter_tags.includes(filter.hunter!));
      if (filter?.q) {
        const q = filter.q.toLowerCase();
        rows = rows.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.work_email ?? "").includes(q) ||
            (c.title ?? "").toLowerCase().includes(q),
        );
      }
      return clone(rows);
    },
    setState: async (contactId: string, to: ContactState, actor: string, reason?: string) => {
      const rec = this.contactsMap.get(contactId);
      if (!rec) throw new Error(`contact not found: ${contactId}`);
      assertTransition(rec.state, to);
      const from = rec.state;
      rec.state = to;
      rec.updated_at = nowIso();
      this.transitionsList.push({
        id: id("tr"),
        contact_id: contactId,
        from_state: from,
        to_state: to,
        actor,
        at: rec.updated_at,
        reason,
      });
      return clone(rec);
    },
  };

  signals = {
    insert: async (
      signal: import("../domain/types.ts").Signal,
      extras?: { company_id?: string; contact_id?: string },
    ) => {
      const existing = [...this.signalsMap.values()].find(
        (s) => s.raw_content_hash === signal.raw_content_hash,
      );
      if (existing) return clone(existing);
      const row: SignalRow = {
        id: id("sg"),
        hunter: signal.hunter,
        source_url: signal.source_url,
        source_title: signal.source_title,
        publisher: signal.publisher,
        observed_at: signal.observed_at,
        published_at: signal.published_at,
        company_name: signal.company,
        company_id: extras?.company_id,
        person: signal.person,
        contact_id: extras?.contact_id,
        role: signal.role,
        signal_type: signal.signal_type,
        quoted_evidence: signal.quoted_evidence,
        extractor_version: signal.extractor_version,
        confidence: signal.confidence,
        raw_content_hash: signal.raw_content_hash,
      };
      this.signalsMap.set(row.id, row);
      return clone(row);
    },
    byHash: async (hash: string) =>
      clone([...this.signalsMap.values()].find((s) => s.raw_content_hash === hash)),
    list: async () => clone([...this.signalsMap.values()]),
  };

  evidence = {
    insert: async (row: Omit<EvidenceRecord, "id"> & { id?: string }) => {
      const existing = [...this.evidenceMap.values()].find((e) => e.url_hash === row.url_hash);
      if (existing) return clone(existing);
      const rec: EvidenceRecord = { ...row, id: row.id ?? id("ev") };
      this.evidenceMap.set(rec.id, rec);
      return clone(rec);
    },
    byUrlHash: async (hash: string) =>
      clone([...this.evidenceMap.values()].find((e) => e.url_hash === hash)),
    forContact: async (contactId: string) =>
      clone([...this.evidenceMap.values()].filter((e) => e.contact_id === contactId)),
    forCompany: async (companyId: string) =>
      clone([...this.evidenceMap.values()].filter((e) => e.company_id === companyId)),
  };

  drafts = {
    insert: async (row: Omit<DraftRecord, "id" | "created_at"> & { id?: string }) => {
      const rec: DraftRecord = { ...row, id: row.id ?? id("dr"), created_at: nowIso() };
      this.draftsMap.set(rec.id, rec);
      return clone(rec);
    },
    get: async (draftId: string) => clone(this.draftsMap.get(draftId)),
    latestForContact: async (contactId: string) => {
      const rows = [...this.draftsMap.values()]
        .filter((d) => d.contact_id === contactId)
        .sort((a, b) => b.version - a.version);
      return clone(rows[0]);
    },
    invalidate: async (draftId: string) => {
      const d = this.draftsMap.get(draftId);
      if (d) d.invalidated = true;
    },
  };

  events = {
    add: async (row: Omit<OutreachEvent, "id"> & { id?: string }) => {
      const rec: OutreachEvent = { ...row, id: row.id ?? id("evnt") };
      this.eventsList.push(rec);
      return clone(rec);
    },
    list: async (contactId?: string) =>
      clone(
        contactId ? this.eventsList.filter((e) => e.contact_id === contactId) : this.eventsList,
      ),
  };

  sends = {
    reserve: async (row: Omit<SendAttempt, "id" | "created_at"> & { id?: string }) => {
      if (row.first_touch) {
        const dup = [...this.sendsMap.values()].find(
          (s) =>
            s.contact_id === row.contact_id && s.campaign_id === row.campaign_id && s.first_touch,
        );
        if (dup) throw new Error("duplicate_first_touch");
      }
      const rec: SendAttempt = { ...row, id: row.id ?? id("sa"), created_at: nowIso() };
      this.sendsMap.set(rec.id, rec);
      return clone(rec);
    },
    get: async (sendId: string) => clone(this.sendsMap.get(sendId)),
    byRfc: async (rfc: string) =>
      clone([...this.sendsMap.values()].find((s) => s.rfc_message_id === rfc)),
    firstTouch: async (contactId: string, campaignId: string) =>
      clone(
        [...this.sendsMap.values()].find(
          (s) => s.contact_id === contactId && s.campaign_id === campaignId && s.first_touch,
        ),
      ),
    update: async (sendId: string, patch: Partial<SendAttempt>) => {
      const rec = this.sendsMap.get(sendId);
      if (!rec) throw new Error("send not found");
      Object.assign(rec, patch);
      return clone(rec);
    },
    list: async () => clone([...this.sendsMap.values()]),
  };

  suppression = {
    add: async (row: Omit<SuppressionRow, "id" | "created_at"> & { id?: string }) => {
      const rec: SuppressionRow = {
        ...row,
        id: row.id ?? id("sup"),
        email: normalizeEmail(row.email),
        domain: normalizeDomain(row.domain),
        created_at: nowIso(),
      };
      this.suppressionList.push(rec);
      return clone(rec);
    },
    isSuppressed: async (email?: string, domain?: string) => {
      const e = normalizeEmail(email);
      const d = normalizeDomain(domain);
      return this.suppressionList.some((s) => (e && s.email === e) || (d && s.domain === d));
    },
    list: async () => clone(this.suppressionList),
  };

  jobs = {
    start: async (job: string, hunter?: Hunter) => {
      const rec: JobRun = { id: id("job"), job, hunter, status: "running", started_at: nowIso() };
      this.jobsMap.set(rec.id, rec);
      return clone(rec);
    },
    finish: async (
      jobId: string,
      status: "ok" | "error",
      result?: Record<string, unknown>,
      error?: string,
    ) => {
      const rec = this.jobsMap.get(jobId);
      if (!rec) throw new Error("job not found");
      rec.status = status;
      rec.finished_at = nowIso();
      rec.result = result;
      rec.error = error;
      return clone(rec);
    },
    latestByJob: async () => {
      const by = new Map<string, JobRun>();
      for (const j of this.jobsMap.values()) {
        const key = `${j.job}:${j.hunter ?? ""}`;
        const prev = by.get(key);
        if (!prev || prev.started_at < j.started_at) by.set(key, j);
      }
      return clone([...by.values()]);
    },
    get: async (jobId: string) => clone(this.jobsMap.get(jobId)),
  };

  campaigns = {
    upsert: async (row: CampaignRecord) => {
      this.campaignsMap.set(row.id, clone(row));
      return clone(row);
    },
    get: async (campaignId: string) => clone(this.campaignsMap.get(campaignId)),
    list: async () => clone([...this.campaignsMap.values()]),
  };

  pause = {
    get: async () => clone(this.pauseState),
    set: async (patch: Partial<PauseState>, actor: string) => {
      this.pauseState = {
        ...this.pauseState,
        ...patch,
        updated_at: nowIso(),
        updated_by: actor,
      };
      return clone(this.pauseState);
    },
  };

  llm = {
    getDay: async (day: string) => {
      const existing = this.llmMap.get(day);
      if (existing) return clone(existing);
      const rec: LlmUsageRow = {
        id: id("llm"),
        day,
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        estimated_usd: 0,
      };
      this.llmMap.set(day, rec);
      return clone(rec);
    },
    add: async (day: string, requests: number, input: number, output: number, usd: number) => {
      const rec = await this.llm.getDay(day);
      rec.requests += requests;
      rec.input_tokens += input;
      rec.output_tokens += output;
      rec.estimated_usd += usd;
      this.llmMap.set(day, rec);
      return clone(rec);
    },
  };

  enrichment = {
    creditsToday: async (day: string) => this.enrichMap.get(day) ?? 0,
    addCredits: async (day: string, n: number) => {
      const next = (this.enrichMap.get(day) ?? 0) + n;
      this.enrichMap.set(day, next);
      return next;
    },
  };

  audit = {
    add: async (row: Omit<AuditRow, "id"> & { id?: string }) => {
      const rec: AuditRow = { ...row, id: row.id ?? id("aud") };
      this.auditList.push(rec);
      return clone(rec);
    },
    list: async () => clone(this.auditList),
  };

  sync = {
    upsert: async (row: Omit<ExternalSyncRow, "id"> & { id?: string }) => {
      const key = `${row.entity}:${row.internal_id}`;
      const rec: ExternalSyncRow = {
        ...row,
        id: row.id ?? this.syncMap.get(key)?.id ?? id("sync"),
      };
      this.syncMap.set(key, rec);
      return clone(rec);
    },
    get: async (entity: string, internalId: string) =>
      clone(this.syncMap.get(`${entity}:${internalId}`)),
  };

  transitions = {
    list: async (contactId: string) =>
      clone(this.transitionsList.filter((t) => t.contact_id === contactId)),
  };
}

let singleton: MemoryStore | undefined;

export function getMemoryStore(): MemoryStore {
  singleton ??= new MemoryStore();
  return singleton;
}

export function resetMemoryStore(): MemoryStore {
  singleton = new MemoryStore();
  return singleton;
}
