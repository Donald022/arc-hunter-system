import type pg from "pg";
import { assertTransition } from "../domain/states.ts";
import { normalizeDomain, normalizeEmail, normalizeProfileUrl } from "../domain/identities.ts";
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
import type {
  AuditRow,
  ExternalSyncRow,
  LlmUsageRow,
  SignalRow,
  StateTransitionRow,
  Store,
  SuppressionRow,
} from "./types.ts";

function iso(v: Date | string | null | undefined): string | undefined {
  if (!v) return undefined;
  return v instanceof Date ? v.toISOString() : v;
}

export class PostgresStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  companies = {
    upsert: async (
      input: Omit<CompanyRecord, "id" | "created_at" | "updated_at"> & { id?: string },
    ) => {
      const domain = normalizeDomain(input.domain);
      if (domain) {
        const found = await this.pool.query("SELECT * FROM companies WHERE domain = $1", [domain]);
        if (found.rows[0]) {
          const row = await this.pool.query(
            `UPDATE companies SET name=$1, segment=$2, region_signals=$3, why_relevant=$4,
             source_urls = (SELECT ARRAY(SELECT DISTINCT unnest(source_urls || $5::text[]))),
             account_priority=$6, owner=$7, status=$8, last_seen=$9, notion_page_id=COALESCE($10, notion_page_id),
             updated_at=now() WHERE id=$11 RETURNING *`,
            [
              input.name,
              input.segment ?? null,
              input.region_signals,
              input.why_relevant ?? null,
              input.source_urls,
              input.account_priority,
              input.owner ?? null,
              input.status,
              input.last_seen ?? null,
              input.notion_page_id ?? null,
              found.rows[0].id,
            ],
          );
          return mapCompany(row.rows[0]);
        }
      }
      const row = await this.pool.query(
        `INSERT INTO companies (id, name, domain, segment, region_signals, why_relevant, source_urls, account_priority, owner, status, last_seen, notion_page_id)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          input.id ?? null,
          input.name,
          domain ?? null,
          input.segment ?? null,
          input.region_signals,
          input.why_relevant ?? null,
          input.source_urls,
          input.account_priority,
          input.owner ?? null,
          input.status,
          input.last_seen ?? null,
          input.notion_page_id ?? null,
        ],
      );
      return mapCompany(row.rows[0]);
    },
    get: async (companyId: string) => {
      const r = await this.pool.query("SELECT * FROM companies WHERE id=$1", [companyId]);
      return r.rows[0] ? mapCompany(r.rows[0]) : undefined;
    },
    byDomain: async (domain: string) => {
      const d = normalizeDomain(domain);
      const r = await this.pool.query("SELECT * FROM companies WHERE domain=$1", [d]);
      return r.rows[0] ? mapCompany(r.rows[0]) : undefined;
    },
    list: async () => {
      const r = await this.pool.query("SELECT * FROM companies ORDER BY name");
      return r.rows.map(mapCompany);
    },
  };

  contacts = {
    upsert: async (
      input: Omit<ContactRecord, "id" | "created_at" | "updated_at"> & { id?: string },
    ) => {
      const email = normalizeEmail(input.work_email);
      const profile = normalizeProfileUrl(input.profile_url);
      const existing = email
        ? (await this.pool.query("SELECT * FROM contacts WHERE work_email=$1", [email])).rows[0]
        : profile
          ? (await this.pool.query("SELECT * FROM contacts WHERE profile_url=$1", [profile]))
              .rows[0]
          : (
              await this.pool.query(
                "SELECT * FROM contacts WHERE company_id=$1 AND lower(name)=lower($2)",
                [input.company_id, input.name],
              )
            ).rows[0];
      if (existing) {
        const tags = [...new Set([...(existing.hunter_tags ?? []), ...input.hunter_tags])];
        const r = await this.pool.query(
          `UPDATE contacts SET title=COALESCE($1,title), work_email=COALESCE($2,work_email),
           email_confidence=$3, profile_url=COALESCE($4,profile_url), hunter_tags=$5, role=COALESCE($6,role),
           direct_buyer_potential=$7, connection_potential=$8, fit_score=$9, evidence_summary=COALESCE($10,evidence_summary),
           personalization_fact=COALESCE($11,personalization_fact), score_breakdown=COALESCE($12::jsonb, score_breakdown),
           campaign_id=COALESCE($13,campaign_id), notion_page_id=COALESCE($14,notion_page_id),
           gmail_thread_id=COALESCE($15,gmail_thread_id), last_contacted=COALESCE($16,last_contacted),
           do_not_contact = do_not_contact OR $17, updated_at=now()
           WHERE id=$18 RETURNING *`,
          [
            input.title ?? null,
            email ?? null,
            input.email_confidence,
            profile ?? null,
            tags,
            input.role ?? null,
            input.direct_buyer_potential,
            input.connection_potential,
            input.fit_score,
            input.evidence_summary ?? null,
            input.personalization_fact ?? null,
            input.score_breakdown ? JSON.stringify(input.score_breakdown) : null,
            input.campaign_id ?? null,
            input.notion_page_id ?? null,
            input.gmail_thread_id ?? null,
            input.last_contacted ?? null,
            Boolean(input.do_not_contact),
            existing.id,
          ],
        );
        return mapContact(r.rows[0]);
      }
      const r = await this.pool.query(
        `INSERT INTO contacts (id, company_id, name, title, work_email, email_confidence, profile_url, hunter_tags, role,
          direct_buyer_potential, connection_potential, fit_score, evidence_summary, personalization_fact, state,
          do_not_contact, owner, gmail_thread_id, internal_lead_id, score_breakdown, campaign_id, notion_page_id)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22)
         RETURNING *`,
        [
          input.id ?? null,
          input.company_id,
          input.name,
          input.title ?? null,
          email ?? null,
          input.email_confidence,
          profile ?? null,
          input.hunter_tags,
          input.role ?? null,
          input.direct_buyer_potential,
          input.connection_potential,
          input.fit_score,
          input.evidence_summary ?? null,
          input.personalization_fact ?? null,
          input.state,
          Boolean(input.do_not_contact),
          input.owner ?? null,
          input.gmail_thread_id ?? null,
          input.internal_lead_id ?? null,
          input.score_breakdown ? JSON.stringify(input.score_breakdown) : null,
          input.campaign_id ?? null,
          input.notion_page_id ?? null,
        ],
      );
      return mapContact(r.rows[0]);
    },
    get: async (contactId: string) => {
      const r = await this.pool.query("SELECT * FROM contacts WHERE id=$1", [contactId]);
      return r.rows[0] ? mapContact(r.rows[0]) : undefined;
    },
    byEmail: async (email: string) => {
      const r = await this.pool.query("SELECT * FROM contacts WHERE work_email=$1", [
        normalizeEmail(email),
      ]);
      return r.rows[0] ? mapContact(r.rows[0]) : undefined;
    },
    byProfile: async (url: string) => {
      const r = await this.pool.query("SELECT * FROM contacts WHERE profile_url=$1", [
        normalizeProfileUrl(url),
      ]);
      return r.rows[0] ? mapContact(r.rows[0]) : undefined;
    },
    list: async (filter?: { state?: ContactState; hunter?: Hunter; q?: string }) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filter?.state) {
        params.push(filter.state);
        clauses.push(`state = $${params.length}`);
      }
      if (filter?.hunter) {
        params.push(filter.hunter);
        clauses.push(`$${params.length} = ANY(hunter_tags)`);
      }
      if (filter?.q) {
        params.push(`%${filter.q.toLowerCase()}%`);
        clauses.push(
          `(lower(name) LIKE $${params.length} OR coalesce(work_email,'') LIKE $${params.length} OR lower(coalesce(title,'')) LIKE $${params.length})`,
        );
      }
      const sql = `SELECT * FROM contacts ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY updated_at DESC`;
      const r = await this.pool.query(sql, params);
      return r.rows.map(mapContact);
    },
    setState: async (contactId: string, to: ContactState, actor: string, reason?: string) => {
      const cur = await this.pool.query("SELECT * FROM contacts WHERE id=$1", [contactId]);
      if (!cur.rows[0]) throw new Error(`contact not found: ${contactId}`);
      const from = cur.rows[0].state as ContactState;
      assertTransition(from, to);
      await this.pool.query(
        "INSERT INTO contact_transitions (contact_id, from_state, to_state, actor, reason) VALUES ($1,$2,$3,$4,$5)",
        [contactId, from, to, actor, reason ?? null],
      );
      const r = await this.pool.query(
        "UPDATE contacts SET state=$1, updated_at=now() WHERE id=$2 RETURNING *",
        [to, contactId],
      );
      return mapContact(r.rows[0]);
    },
  };

  signals = {
    insert: async (signal: Signal, extras?: { company_id?: string; contact_id?: string }) => {
      const existing = await this.pool.query("SELECT * FROM signals WHERE raw_content_hash=$1", [
        signal.raw_content_hash,
      ]);
      if (existing.rows[0]) return mapSignal(existing.rows[0]);
      const r = await this.pool.query(
        `INSERT INTO signals (hunter, source_url, source_title, publisher, observed_at, published_at, company_name, company_id, person, contact_id, role, signal_type, quoted_evidence, extractor_version, confidence, raw_content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          signal.hunter,
          signal.source_url,
          signal.source_title,
          signal.publisher,
          signal.observed_at,
          signal.published_at ?? null,
          signal.company,
          extras?.company_id ?? null,
          signal.person ?? null,
          extras?.contact_id ?? null,
          signal.role ?? null,
          signal.signal_type,
          signal.quoted_evidence,
          signal.extractor_version,
          signal.confidence,
          signal.raw_content_hash,
        ],
      );
      return mapSignal(r.rows[0]);
    },
    byHash: async (hash: string) => {
      const r = await this.pool.query("SELECT * FROM signals WHERE raw_content_hash=$1", [hash]);
      return r.rows[0] ? mapSignal(r.rows[0]) : undefined;
    },
    list: async () => {
      const r = await this.pool.query("SELECT * FROM signals");
      return r.rows.map(mapSignal);
    },
  };

  evidence = {
    insert: async (row: Omit<EvidenceRecord, "id"> & { id?: string }) => {
      const existing = await this.pool.query("SELECT * FROM evidence WHERE url_hash=$1", [
        row.url_hash,
      ]);
      if (existing.rows[0]) return mapEvidence(existing.rows[0]);
      const r = await this.pool.query(
        `INSERT INTO evidence (id, signal_id, contact_id, company_id, url, url_hash, quoted_text, published_at, observed_at, hunter)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          row.id ?? null,
          row.signal_id ?? null,
          row.contact_id ?? null,
          row.company_id ?? null,
          row.url,
          row.url_hash,
          row.quoted_text,
          row.published_at ?? null,
          row.observed_at,
          row.hunter,
        ],
      );
      return mapEvidence(r.rows[0]);
    },
    byUrlHash: async (hash: string) => {
      const r = await this.pool.query("SELECT * FROM evidence WHERE url_hash=$1", [hash]);
      return r.rows[0] ? mapEvidence(r.rows[0]) : undefined;
    },
    forContact: async (contactId: string) => {
      const r = await this.pool.query("SELECT * FROM evidence WHERE contact_id=$1", [contactId]);
      return r.rows.map(mapEvidence);
    },
    forCompany: async (companyId: string) => {
      const r = await this.pool.query("SELECT * FROM evidence WHERE company_id=$1", [companyId]);
      return r.rows.map(mapEvidence);
    },
  };

  drafts = {
    insert: async (row: Omit<DraftRecord, "id" | "created_at"> & { id?: string }) => {
      if (row.id) {
        const existing = await this.pool.query("SELECT * FROM drafts WHERE id=$1", [row.id]);
        if (existing.rows[0]) {
          const r = await this.pool.query(
            `UPDATE drafts SET subject=$1, body=$2, body_hash=$3, fact_version_hash=$4, contact_email=$5, sender_address=$6,
             approval_hash=$7, approved_by=$8, approved_at=$9, invalidated=$10, personalization_claims=$11::jsonb,
             arc_claim_ids=$12, word_count=$13 WHERE id=$14 RETURNING *`,
            [
              row.subject,
              row.body,
              row.body_hash,
              row.fact_version_hash,
              row.contact_email,
              row.sender_address,
              row.approval_hash ?? null,
              row.approved_by ?? null,
              row.approved_at ?? null,
              row.invalidated,
              JSON.stringify(row.personalization_claims),
              row.arc_claim_ids,
              row.word_count,
              row.id,
            ],
          );
          return mapDraft(r.rows[0]);
        }
      }
      const r = await this.pool.query(
        `INSERT INTO drafts (id, contact_id, version, subject, body, body_hash, fact_version_hash, contact_email, sender_address,
          approval_hash, approved_by, approved_at, invalidated, personalization_claims, arc_claim_ids, word_count)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) RETURNING *`,
        [
          row.id ?? null,
          row.contact_id,
          row.version,
          row.subject,
          row.body,
          row.body_hash,
          row.fact_version_hash,
          row.contact_email,
          row.sender_address,
          row.approval_hash ?? null,
          row.approved_by ?? null,
          row.approved_at ?? null,
          row.invalidated,
          JSON.stringify(row.personalization_claims),
          row.arc_claim_ids,
          row.word_count,
        ],
      );
      return mapDraft(r.rows[0]);
    },
    get: async (draftId: string) => {
      const r = await this.pool.query("SELECT * FROM drafts WHERE id=$1", [draftId]);
      return r.rows[0] ? mapDraft(r.rows[0]) : undefined;
    },
    latestForContact: async (contactId: string) => {
      const r = await this.pool.query(
        "SELECT * FROM drafts WHERE contact_id=$1 ORDER BY version DESC LIMIT 1",
        [contactId],
      );
      return r.rows[0] ? mapDraft(r.rows[0]) : undefined;
    },
    invalidate: async (draftId: string) => {
      await this.pool.query("UPDATE drafts SET invalidated=true WHERE id=$1", [draftId]);
    },
  };

  events = {
    add: async (row: Omit<OutreachEvent, "id"> & { id?: string }) => {
      const r = await this.pool.query(
        `INSERT INTO outreach_events (id, contact_id, type, actor, at, payload)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6::jsonb) RETURNING *`,
        [
          row.id ?? null,
          row.contact_id ?? null,
          row.type,
          row.actor,
          row.at,
          JSON.stringify(row.payload),
        ],
      );
      return mapEvent(r.rows[0]);
    },
    list: async (contactId?: string) => {
      const r = contactId
        ? await this.pool.query("SELECT * FROM outreach_events WHERE contact_id=$1 ORDER BY at", [
            contactId,
          ])
        : await this.pool.query("SELECT * FROM outreach_events ORDER BY at");
      return r.rows.map(mapEvent);
    },
  };

  sends = {
    reserve: async (row: Omit<SendAttempt, "id" | "created_at"> & { id?: string }) => {
      try {
        const r = await this.pool.query(
          `INSERT INTO send_attempts (id, contact_id, campaign_id, draft_id, draft_version, first_touch, rfc_message_id, status, exact_body, actor)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            row.id ?? null,
            row.contact_id,
            row.campaign_id,
            row.draft_id,
            row.draft_version,
            row.first_touch,
            row.rfc_message_id,
            row.status,
            row.exact_body,
            row.actor,
          ],
        );
        return mapSend(r.rows[0]);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "23505") throw new Error("duplicate_first_touch");
        throw err;
      }
    },
    get: async (sendId: string) => {
      const r = await this.pool.query("SELECT * FROM send_attempts WHERE id=$1", [sendId]);
      return r.rows[0] ? mapSend(r.rows[0]) : undefined;
    },
    byRfc: async (rfc: string) => {
      const r = await this.pool.query("SELECT * FROM send_attempts WHERE rfc_message_id=$1", [rfc]);
      return r.rows[0] ? mapSend(r.rows[0]) : undefined;
    },
    firstTouch: async (contactId: string, campaignId: string) => {
      const r = await this.pool.query(
        "SELECT * FROM send_attempts WHERE contact_id=$1 AND campaign_id=$2 AND first_touch=true",
        [contactId, campaignId],
      );
      return r.rows[0] ? mapSend(r.rows[0]) : undefined;
    },
    update: async (sendId: string, patch: Partial<SendAttempt>) => {
      const r = await this.pool.query(
        `UPDATE send_attempts SET status=COALESCE($1,status), gmail_message_id=COALESCE($2,gmail_message_id),
         gmail_thread_id=COALESCE($3,gmail_thread_id), sent_at=COALESCE($4,sent_at), error=COALESCE($5,error)
         WHERE id=$6 RETURNING *`,
        [
          patch.status ?? null,
          patch.gmail_message_id ?? null,
          patch.gmail_thread_id ?? null,
          patch.sent_at ?? null,
          patch.error ?? null,
          sendId,
        ],
      );
      if (!r.rows[0]) throw new Error("send not found");
      return mapSend(r.rows[0]);
    },
    list: async () => {
      const r = await this.pool.query("SELECT * FROM send_attempts");
      return r.rows.map(mapSend);
    },
  };

  suppression = {
    add: async (row: Omit<SuppressionRow, "id" | "created_at"> & { id?: string }) => {
      const r = await this.pool.query(
        `INSERT INTO suppression (id, email, domain, reason, actor)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5)
         ON CONFLICT DO NOTHING RETURNING *`,
        [
          row.id ?? null,
          normalizeEmail(row.email) ?? null,
          normalizeDomain(row.domain) ?? null,
          row.reason,
          row.actor,
        ],
      );
      if (r.rows[0]) return mapSuppression(r.rows[0]);
      const again = await this.pool.query(
        "SELECT * FROM suppression WHERE email=$1 OR domain=$2 LIMIT 1",
        [normalizeEmail(row.email) ?? null, normalizeDomain(row.domain) ?? null],
      );
      return mapSuppression(again.rows[0]);
    },
    isSuppressed: async (email?: string, domain?: string) => {
      const r = await this.pool.query(
        "SELECT 1 FROM suppression WHERE email=$1 OR domain=$2 LIMIT 1",
        [normalizeEmail(email) ?? null, normalizeDomain(domain) ?? null],
      );
      return r.rows.length > 0;
    },
    list: async () => {
      const r = await this.pool.query("SELECT * FROM suppression");
      return r.rows.map(mapSuppression);
    },
  };

  jobs = {
    start: async (job: string, hunter?: Hunter) => {
      const r = await this.pool.query(
        "INSERT INTO job_runs (job, hunter, status) VALUES ($1,$2,'running') RETURNING *",
        [job, hunter ?? null],
      );
      return mapJob(r.rows[0]);
    },
    finish: async (
      jobId: string,
      status: "ok" | "error",
      result?: Record<string, unknown>,
      error?: string,
    ) => {
      const r = await this.pool.query(
        "UPDATE job_runs SET status=$1, finished_at=now(), result=$2::jsonb, error=$3 WHERE id=$4 RETURNING *",
        [status, result ? JSON.stringify(result) : null, error ?? null, jobId],
      );
      if (!r.rows[0]) throw new Error("job not found");
      return mapJob(r.rows[0]);
    },
    latestByJob: async () => {
      const r = await this.pool.query(
        `SELECT DISTINCT ON (job, coalesce(hunter,'')) * FROM job_runs ORDER BY job, coalesce(hunter,''), started_at DESC`,
      );
      return r.rows.map(mapJob);
    },
    get: async (jobId: string) => {
      const r = await this.pool.query("SELECT * FROM job_runs WHERE id=$1", [jobId]);
      return r.rows[0] ? mapJob(r.rows[0]) : undefined;
    },
  };

  campaigns = {
    upsert: async (row: CampaignRecord) => {
      await this.pool.query(
        `INSERT INTO campaigns (id, name, hunter, enabled, seed_domains, source_urls, search_terms, region_boost, daily_research_cap, daily_send_cap, last_run, notion_page_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, hunter=EXCLUDED.hunter, enabled=EXCLUDED.enabled,
           seed_domains=EXCLUDED.seed_domains, source_urls=EXCLUDED.source_urls, search_terms=EXCLUDED.search_terms,
           region_boost=EXCLUDED.region_boost, daily_research_cap=EXCLUDED.daily_research_cap, daily_send_cap=EXCLUDED.daily_send_cap,
           last_run=EXCLUDED.last_run, notion_page_id=EXCLUDED.notion_page_id`,
        [
          row.id,
          row.name,
          row.hunter,
          row.enabled,
          row.seed_domains,
          row.source_urls,
          row.search_terms,
          row.region_boost,
          row.daily_research_cap,
          row.daily_send_cap,
          row.last_run ?? null,
          row.notion_page_id ?? null,
        ],
      );
      return row;
    },
    get: async (campaignId: string) => {
      const r = await this.pool.query("SELECT * FROM campaigns WHERE id=$1", [campaignId]);
      return r.rows[0] ? mapCampaign(r.rows[0]) : undefined;
    },
    list: async () => {
      const r = await this.pool.query("SELECT * FROM campaigns");
      return r.rows.map(mapCampaign);
    },
  };

  pause = {
    get: async () => {
      const r = await this.pool.query("SELECT * FROM pause_switches WHERE id=1");
      if (!r.rows[0]) throw new Error("pause state unreadable");
      return mapPause(r.rows[0]);
    },
    set: async (patch: Partial<PauseState>, actor: string) => {
      const r = await this.pool.query(
        `UPDATE pause_switches SET
           discovery_paused = COALESCE($1, discovery_paused),
           outbound_paused = COALESCE($2, outbound_paused),
           updated_at=now(), updated_by=$3
         WHERE id=1 RETURNING *`,
        [patch.discovery_paused ?? null, patch.outbound_paused ?? null, actor],
      );
      if (!r.rows[0]) throw new Error("pause state unreadable");
      return mapPause(r.rows[0]);
    },
  };

  llm = {
    getDay: async (day: string) => {
      await this.pool.query(
        "INSERT INTO llm_usage (day) VALUES ($1::date) ON CONFLICT (day) DO NOTHING",
        [day],
      );
      const r = await this.pool.query("SELECT * FROM llm_usage WHERE day=$1::date", [day]);
      return mapLlm(r.rows[0], day);
    },
    add: async (day: string, requests: number, input: number, output: number, usd: number) => {
      const r = await this.pool.query(
        `INSERT INTO llm_usage (day, requests, input_tokens, output_tokens, estimated_usd)
         VALUES ($1::date,$2,$3,$4,$5)
         ON CONFLICT (day) DO UPDATE SET
           requests = llm_usage.requests + EXCLUDED.requests,
           input_tokens = llm_usage.input_tokens + EXCLUDED.input_tokens,
           output_tokens = llm_usage.output_tokens + EXCLUDED.output_tokens,
           estimated_usd = llm_usage.estimated_usd + EXCLUDED.estimated_usd
         RETURNING *`,
        [day, requests, input, output, usd],
      );
      return mapLlm(r.rows[0], day);
    },
  };

  enrichment = {
    creditsToday: async (day: string) => {
      const r = await this.pool.query("SELECT credits FROM enrichment_usage WHERE day=$1::date", [
        day,
      ]);
      return Number(r.rows[0]?.credits ?? 0);
    },
    addCredits: async (day: string, n: number) => {
      const r = await this.pool.query(
        `INSERT INTO enrichment_usage (day, credits) VALUES ($1::date,$2)
         ON CONFLICT (day) DO UPDATE SET credits = enrichment_usage.credits + EXCLUDED.credits
         RETURNING credits`,
        [day, n],
      );
      return Number(r.rows[0].credits);
    },
  };

  audit = {
    add: async (row: Omit<AuditRow, "id"> & { id?: string }) => {
      const r = await this.pool.query(
        `INSERT INTO settings_audit (id, actor, at, setting, old_value, new_value, notion_sync)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING *`,
        [
          row.id ?? null,
          row.actor,
          row.at,
          row.setting,
          JSON.stringify(row.old_value ?? null),
          JSON.stringify(row.new_value ?? null),
          row.notion_sync,
        ],
      );
      return mapAudit(r.rows[0]);
    },
    list: async () => {
      const r = await this.pool.query("SELECT * FROM settings_audit ORDER BY at DESC");
      return r.rows.map(mapAudit);
    },
  };

  sync = {
    upsert: async (row: Omit<ExternalSyncRow, "id"> & { id?: string }) => {
      const r = await this.pool.query(
        `INSERT INTO external_sync (id, entity, internal_id, external_id, last_hash, last_synced_at)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6)
         ON CONFLICT (entity, internal_id) DO UPDATE SET external_id=EXCLUDED.external_id, last_hash=EXCLUDED.last_hash, last_synced_at=EXCLUDED.last_synced_at
         RETURNING *`,
        [
          row.id ?? null,
          row.entity,
          row.internal_id,
          row.external_id,
          row.last_hash ?? null,
          row.last_synced_at,
        ],
      );
      return mapSync(r.rows[0]);
    },
    get: async (entity: string, internalId: string) => {
      const r = await this.pool.query(
        "SELECT * FROM external_sync WHERE entity=$1 AND internal_id=$2",
        [entity, internalId],
      );
      return r.rows[0] ? mapSync(r.rows[0]) : undefined;
    },
  };

  transitions = {
    list: async (contactId: string) => {
      const r = await this.pool.query(
        "SELECT * FROM contact_transitions WHERE contact_id=$1 ORDER BY at",
        [contactId],
      );
      return r.rows.map((row: Record<string, unknown>): StateTransitionRow => ({
        id: String(row.id),
        contact_id: String(row.contact_id),
        from_state: row.from_state as ContactState,
        to_state: row.to_state as ContactState,
        actor: String(row.actor),
        at: iso(row.at as Date) ?? "",
        reason: (row.reason as string) ?? undefined,
      }));
    },
  };
}

function mapCompany(row: Record<string, unknown>): CompanyRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    domain: (row.domain as string) ?? undefined,
    segment: (row.segment as CompanyRecord["segment"]) ?? undefined,
    region_signals: (row.region_signals as string[]) ?? [],
    why_relevant: (row.why_relevant as string) ?? undefined,
    source_urls: (row.source_urls as string[]) ?? [],
    account_priority: Number(row.account_priority),
    owner: (row.owner as string) ?? undefined,
    status: String(row.status),
    last_seen: iso(row.last_seen as Date),
    notion_page_id: (row.notion_page_id as string) ?? undefined,
    created_at: iso(row.created_at as Date) ?? "",
    updated_at: iso(row.updated_at as Date) ?? "",
  };
}

function mapContact(row: Record<string, unknown>): ContactRecord {
  return {
    id: String(row.id),
    company_id: String(row.company_id),
    name: String(row.name),
    title: (row.title as string) ?? undefined,
    work_email: (row.work_email as string) ?? undefined,
    email_confidence: (row.email_confidence as ContactRecord["email_confidence"]) ?? "None",
    profile_url: (row.profile_url as string) ?? undefined,
    hunter_tags: (row.hunter_tags as Hunter[]) ?? [],
    role: (row.role as ContactRecord["role"]) ?? undefined,
    direct_buyer_potential: Number(row.direct_buyer_potential),
    connection_potential: Number(row.connection_potential),
    fit_score: Number(row.fit_score),
    evidence_summary: (row.evidence_summary as string) ?? undefined,
    personalization_fact: (row.personalization_fact as string) ?? undefined,
    state: row.state as ContactState,
    do_not_contact: Boolean(row.do_not_contact),
    owner: (row.owner as string) ?? undefined,
    last_contacted: iso(row.last_contacted as Date),
    gmail_thread_id: (row.gmail_thread_id as string) ?? undefined,
    internal_lead_id: (row.internal_lead_id as string) ?? undefined,
    score_breakdown: (row.score_breakdown as ContactRecord["score_breakdown"]) ?? undefined,
    campaign_id: (row.campaign_id as string) ?? undefined,
    notion_page_id: (row.notion_page_id as string) ?? undefined,
    created_at: iso(row.created_at as Date) ?? "",
    updated_at: iso(row.updated_at as Date) ?? "",
  };
}

function mapSignal(row: Record<string, unknown>): SignalRow {
  return {
    id: String(row.id),
    hunter: row.hunter as Hunter,
    source_url: String(row.source_url),
    source_title: String(row.source_title),
    publisher: String(row.publisher),
    observed_at: iso(row.observed_at as Date) ?? "",
    published_at: iso(row.published_at as Date),
    company_name: String(row.company_name),
    company_id: row.company_id ? String(row.company_id) : undefined,
    person: (row.person as string) ?? undefined,
    contact_id: row.contact_id ? String(row.contact_id) : undefined,
    role: (row.role as string) ?? undefined,
    signal_type: String(row.signal_type),
    quoted_evidence: String(row.quoted_evidence),
    extractor_version: String(row.extractor_version),
    confidence: Number(row.confidence),
    raw_content_hash: String(row.raw_content_hash),
  };
}

function mapEvidence(row: Record<string, unknown>): EvidenceRecord {
  return {
    id: String(row.id),
    signal_id: row.signal_id ? String(row.signal_id) : undefined,
    contact_id: row.contact_id ? String(row.contact_id) : undefined,
    company_id: row.company_id ? String(row.company_id) : undefined,
    url: String(row.url),
    url_hash: String(row.url_hash),
    quoted_text: String(row.quoted_text),
    published_at: iso(row.published_at as Date),
    observed_at: iso(row.observed_at as Date) ?? "",
    hunter: row.hunter as Hunter,
  };
}

function mapDraft(row: Record<string, unknown>): DraftRecord {
  return {
    id: String(row.id),
    contact_id: String(row.contact_id),
    version: Number(row.version),
    subject: String(row.subject),
    body: String(row.body),
    body_hash: String(row.body_hash),
    fact_version_hash: String(row.fact_version_hash),
    contact_email: String(row.contact_email),
    sender_address: String(row.sender_address),
    approval_hash: (row.approval_hash as string) ?? undefined,
    approved_by: (row.approved_by as string) ?? undefined,
    approved_at: iso(row.approved_at as Date),
    invalidated: Boolean(row.invalidated),
    personalization_claims:
      (row.personalization_claims as DraftRecord["personalization_claims"]) ?? [],
    arc_claim_ids: (row.arc_claim_ids as string[]) ?? [],
    word_count: Number(row.word_count),
    created_at: iso(row.created_at as Date) ?? "",
  };
}

function mapEvent(row: Record<string, unknown>): OutreachEvent {
  return {
    id: String(row.id),
    contact_id: row.contact_id ? String(row.contact_id) : undefined,
    type: String(row.type) as OutreachEvent["type"],
    actor: String(row.actor),
    at: iso(row.at as Date) ?? "",
    payload: (row.payload as Record<string, unknown>) ?? {},
  };
}

function mapSend(row: Record<string, unknown>): SendAttempt {
  return {
    id: String(row.id),
    contact_id: String(row.contact_id),
    campaign_id: String(row.campaign_id),
    draft_id: String(row.draft_id),
    draft_version: Number(row.draft_version),
    first_touch: Boolean(row.first_touch),
    rfc_message_id: String(row.rfc_message_id),
    gmail_message_id: (row.gmail_message_id as string) ?? undefined,
    gmail_thread_id: (row.gmail_thread_id as string) ?? undefined,
    status: row.status as SendAttempt["status"],
    exact_body: String(row.exact_body),
    actor: String(row.actor),
    created_at: iso(row.created_at as Date) ?? "",
    sent_at: iso(row.sent_at as Date),
    error: (row.error as string) ?? undefined,
  };
}

function mapSuppression(row: Record<string, unknown>): SuppressionRow {
  return {
    id: String(row.id),
    email: (row.email as string) ?? undefined,
    domain: (row.domain as string) ?? undefined,
    reason: String(row.reason),
    actor: String(row.actor),
    created_at: iso(row.created_at as Date) ?? "",
  };
}

function mapJob(row: Record<string, unknown>): JobRun {
  return {
    id: String(row.id),
    job: String(row.job),
    hunter: (row.hunter as Hunter) ?? undefined,
    status: row.status as JobRun["status"],
    started_at: iso(row.started_at as Date) ?? "",
    finished_at: iso(row.finished_at as Date),
    result: (row.result as Record<string, unknown>) ?? undefined,
    error: (row.error as string) ?? undefined,
  };
}

function mapCampaign(row: Record<string, unknown>): CampaignRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    hunter: row.hunter as Hunter,
    enabled: Boolean(row.enabled),
    seed_domains: (row.seed_domains as string[]) ?? [],
    source_urls: (row.source_urls as string[]) ?? [],
    search_terms: (row.search_terms as string[]) ?? [],
    region_boost: String(row.region_boost ?? ""),
    daily_research_cap: Number(row.daily_research_cap),
    daily_send_cap: Number(row.daily_send_cap),
    last_run: iso(row.last_run as Date),
    notion_page_id: (row.notion_page_id as string) ?? undefined,
  };
}

function mapPause(row: Record<string, unknown>): PauseState {
  return {
    discovery_paused: Boolean(row.discovery_paused),
    outbound_paused: Boolean(row.outbound_paused),
    updated_at: iso(row.updated_at as Date) ?? "",
    updated_by: String(row.updated_by),
  };
}

function mapLlm(row: Record<string, unknown>, day: string): LlmUsageRow {
  return {
    id: String(row.day ?? day),
    day,
    requests: Number(row.requests),
    input_tokens: Number(row.input_tokens),
    output_tokens: Number(row.output_tokens),
    estimated_usd: Number(row.estimated_usd),
  };
}

function mapAudit(row: Record<string, unknown>): AuditRow {
  return {
    id: String(row.id),
    actor: String(row.actor),
    at: iso(row.at as Date) ?? "",
    setting: String(row.setting),
    old_value: row.old_value,
    new_value: row.new_value,
    notion_sync: String(row.notion_sync),
  };
}

function mapSync(row: Record<string, unknown>): ExternalSyncRow {
  return {
    id: String(row.id),
    entity: String(row.entity),
    internal_id: String(row.internal_id),
    external_id: String(row.external_id),
    last_hash: (row.last_hash as string) ?? undefined,
    last_synced_at: iso(row.last_synced_at as Date) ?? "",
  };
}
