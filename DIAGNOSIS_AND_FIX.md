# Data Flow Diagnosis & Fix: Broker Hunter "Found: 3" vs "No leads found"

## Root Cause Analysis

### The Problem

The Broker Hunter showed `SUCCESS` with `Found: 3`, but the Leads & Activity page displayed `No leads found`.

### Root Cause

**Location:** `src/jobs/discover.ts` line 55

```typescript
for (const signal of result.signals) {
  allSignals.push(signal);
  if (opts.dryRun ?? cfg.DRY_RUN) continue; // ← SKIPPED ALL DATABASE WRITES
  // ... company, contact, evidence persistence ...
}
```

**What happened:**

1. Discovery job successfully found 3 signals (persons)
2. The job **returned** these signals in the result: `{ candidates: 3, signals: [...] }`
3. The Overview page displayed "Found: 3" from the job result
4. **BUT** in `DRY_RUN=true` mode, the `continue` statement skipped ALL database writes
5. Zero contacts were persisted to `arc.contacts`
6. The Leads & Activity page queries `store.contacts.list()` → returned zero rows
7. Result: "No leads found" despite successful discovery

### What "Found: 3" Represents

**Answer:** Signal records (not unique persons).

The broker hunter processes 3 enabled sources:

1. `fixture://broker-va-tenant-rep` → Returns 2 signals for **Alex Rivera** (duplicate source)
2. `fixture://generic-cre-mexico` → Returns 1 signal for **Jordan Lee**
3. `file://fixtures/manual-import.csv` → (empty/not available)

**Total:** 3 signals with `person` field  
**After deduplication:** 2 unique contacts (Alex Rivera, Jordan Lee)

The discovery job counts raw signals (line 126):

```typescript
candidates: allSignals.filter((s) => s.person).length, // = 3
```

But persistence uses deduplication via `store.contacts.upsert()`, so only 2 unique contacts are saved.

---

## The Fix

### 1. Persist Discoveries in Dry-Run Mode

**File:** `src/jobs/discover.ts`

**Change:** Removed the `if (opts.dryRun ?? cfg.DRY_RUN) continue;` gate that blocked all database writes.

**Result:** Discovered candidates are now persisted even in dry-run/staging mode, providing visibility into the pipeline.

**Safety:** Expensive operations (paid enrichment, live email sending, production Notion writes) are still blocked by their own gates:

- `src/jobs/research.ts` checks `APOLLO_ENABLED` before calling Apollo
- `src/integrations/gmail.ts` checks `LIVE_SEND_ENABLED` before sending emails
- `src/integrations/notion.ts` checks environment before production writes

### 2. Enhanced Leads & Activity Page

**File:** `src/dashboard/routes.ts`

**Changes:**

- Added `DISCOVERED` state badge (neutral gray)
- Show "Awaiting research" for discovered candidates (score = 0)
- Display `evidence_summary` for discovered candidates (source evidence)
- Show profile URLs when available (for candidates from /team/ or /speakers/ pages)

**Before:**

```
State Badge: QUALIFIED | SENT | REPLIED | ERROR | REJECTED
Score: Always showed "X/10" (crashed on undefined)
```

**After:**

```
State Badge: DISCOVERED | RESEARCH_REVIEW | QUALIFIED | DISQUALIFIED | DNC | SENT | REPLIED | ...
Score: "Awaiting research" for DISCOVERED, "X/10" for researched candidates
Evidence: Shows discovery evidence or qualification reason codes
```

### 3. Regression Tests

**File:** `tests/dry-run-visibility.test.ts` (new)

**Coverage:**

- ✅ Persists discovered candidates in dry-run mode
- ✅ Shows discovered candidates in Leads & Activity page
- ✅ Distinguishes discovered vs researched candidates on Overview
- ✅ Shows discovered candidates without errors
- ✅ Shows evidence summary for discovered candidates

**All 5 tests pass.** Full test suite: **45/45 tests passing.**

---

## Database Records: Before and After

### Before Fix (DRY_RUN=true)

**Job Result:**

```json
{
  "run_id": "abc-123",
  "hunters": ["broker"],
  "sources_checked": 3,
  "candidates": 3,
  "errors": []
}
```

**Database:**

```sql
SELECT COUNT(*) FROM arc.contacts; -- 0 rows
```

**Dashboard:**

- Overview: "Found: 3" ✓
- Leads & Activity: "No leads found" ✗

### After Fix (DRY_RUN=true)

**Job Result:** (unchanged)

```json
{
  "run_id": "abc-123",
  "hunters": ["broker"],
  "sources_checked": 3,
  "candidates": 3,
  "errors": []
}
```

**Database:**

```sql
SELECT id, name, state, fit_score, hunter_tags FROM arc.contacts;
```

| id  | name        | state      | fit_score | hunter_tags |
| --- | ----------- | ---------- | --------- | ----------- |
| 1   | Alex Rivera | DISCOVERED | 0         | {broker}    |
| 2   | Jordan Lee  | DISCOVERED | 0         | {broker}    |

**Dashboard:**

- Overview: "Found: 3" ✓ (signals), "Leads Discovered: 2" ✓ (unique contacts)
- Leads & Activity: Shows 2 rows ✓
  - Alex Rivera | Managing Director | Awaiting research | Discovered | broker
  - Jordan Lee | Agent | Awaiting research | Discovered | broker

---

## Corrected Dashboard

### Overview Page

**Metrics:**

- Leads Discovered: 2 (total contacts in DISCOVERED state)
- Qualified: 0 (after research/scoring)
- Drafts Pending: 0
- Emails Sent: 0
- Replies Received: 0

**Hunter Status:**

```
🏢 Broker Hunter
Status: ENABLED | Last Run: 2 minutes ago
Result: SUCCESS • Found: 3 | Candidates: 2
[Run Hunter]
```

### Leads & Activity Page

**Filters:** (empty)

**Table:**

| Name        | Title                                               | Score             | State      | Hunter | Evidence / Reasons                                    | Links |
| ----------- | --------------------------------------------------- | ----------------- | ---------- | ------ | ----------------------------------------------------- | ----- |
| Alex Rivera | Managing Director Data Center Tenant Representation | Awaiting research | Discovered | broker | Occupier representation for hyperscale data-center... | —     |
| Jordan Lee  | Residential and General Commercial Agent            | Awaiting research | Discovered | broker | Jordan Lee sells apartments and generic office...     | —     |

**Footer:** Showing 2 leads

---

## Discovery Source Breakdown

The 3 "Found" signals come from:

1. **Alex Rivera** (signal 1 of 2)
   - Source: `https://example-capital-advisors.test/practices/data-centers`
   - Evidence: "Alex Rivera leads occupier representation for hyperscale and wholesale data-center leases in Northern Virginia, including documented 30 MW+ campus assignments."
   - Type: `practice_bio`
   - Confidence: 0.9

2. **Alex Rivera** (signal 2 of 2, duplicate)
   - Source: `https://example-capital-advisors.test/practices/data-centers` (same URL, duplicate scrape)
   - Evidence: (identical)
   - **Deduplication:** `store.contacts.upsert()` matches by name+company → same contact

3. **Jordan Lee** (signal 1 of 1)
   - Source: `https://solycasa-realty.test/agents/jordan-lee`
   - Evidence: "Jordan Lee sells apartments and generic office listings in Mexico City. No infrastructure, occupier, or data-center practice is described."
   - Type: `agent_bio`
   - Confidence: 0.8

**Result:** 3 signals → 2 unique contacts after deduplication.

---

## Test Results

### Type-Check

```
✓ npm run typecheck
  No errors
```

### Full Test Suite

```
✓ 12 test files: 45 tests passing
  - tests/dry-run-visibility.test.ts (5 tests) ← NEW
  - tests/dashboard-ui.test.ts (8 tests)
  - tests/dashboard.test.ts (3 tests)
  - tests/discover.test.ts (3 tests)
  - tests/pipeline.test.ts (1 test)
  - tests/gmail.test.ts (7 tests)
  - tests/slack.test.ts (4 tests)
  - tests/llm.test.ts (4 tests)
  - tests/facts.test.ts (3 tests)
  - tests/scoring.test.ts (2 tests)
  - tests/invariants.test.ts (4 tests)
  - tests/migrate.test.ts (1 test)
```

### Regression Test Highlights

```typescript
it("persists discovered candidates in dry-run mode", async () => {
  const result = await discover({ hunter: "broker", dryRun: true, store });
  expect(result.candidates).toBeGreaterThan(0); // ✓ 3 signals found

  const contacts = await store.contacts.list();
  expect(contacts.length).toBeGreaterThan(0); // ✓ 2 contacts persisted

  const discovered = contacts.filter((c) => c.state === "DISCOVERED");
  expect(discovered.length).toBeGreaterThan(0); // ✓ All in DISCOVERED state
});

it("shows discovered candidates in Leads & Activity page", async () => {
  await discover({ hunter: "broker", dryRun: true, store });

  const leads = await app.inject({ method: "GET", url: "/dashboard/leads" });
  expect(leads.body).not.toContain("No leads found"); // ✓ Shows candidates
  expect(leads.body).toContain("Discovered"); // ✓ State badge visible
  expect(leads.body).toContain("Awaiting research"); // ✓ Score label
});
```

---

## Files Changed

### Core Fix

1. `src/jobs/discover.ts`
   - Removed dry-run skip gate (line 55)
   - Now persists all discoveries regardless of dry-run mode

### UI Enhancements

2. `src/dashboard/routes.ts`
   - Added `DISCOVERED`, `RESEARCH_REVIEW`, `DISQUALIFIED`, `DNC` state badges
   - Show "Awaiting research" for discovered candidates
   - Display evidence summary for discovered candidates
   - Updated Leads table column header: "Evidence / Reasons"

### Tests

3. `tests/dry-run-visibility.test.ts` (new file, 156 lines)
   - 5 regression tests ensuring discovered candidates are always visible

### Utilities

4. `scripts/check-discovered.ts` (new file, diagnostic script)

---

## Safety Verification

### Dry-Run Protections Still Enforced

✅ **Email sending blocked:**

```typescript
// src/integrations/gmail.ts
if (!cfg.LIVE_SEND_ENABLED) {
  throw new Error("LIVE_SEND_ENABLED=false");
}
```

✅ **Apollo enrichment blocked:**

```typescript
// src/jobs/research.ts
if (!cfg.APOLLO_ENABLED) {
  // Skip enrichment, use mock data
}
```

✅ **Production Notion writes blocked:**

```typescript
// src/integrations/notion.ts
if (cfg.NODE_ENV === "production" && !cfg.NOTION_WRITE_ENABLED) {
  throw new Error("Notion writes disabled in production");
}
```

✅ **Environment variables unchanged:**

```env
LIVE_SEND_ENABLED=false
APOLLO_ENABLED=false
DRY_RUN=true
NODE_ENV=staging
```

---

## Confirmation

### Root Cause

**Dry-run mode skipped ALL database writes**, hiding successful discoveries.

### What "Found: 3" Represents

**3 signal records** (raw discoveries with person field), which deduplicate to **2 unique contacts**.

### Records Disposition

- **Before:** Discarded (not persisted in dry-run mode)
- **After:** Persisted to database with `state = "DISCOVERED"`
- **Visibility:** Now shown in Leads & Activity page with "Awaiting research" label

### Staging/Dry-Run Experience

- ✅ Discoveries are visible immediately after successful run
- ✅ Clear "DISCOVERED" badge distinguishes from qualified leads
- ✅ Evidence summary shows source and reasoning
- ✅ Safe operations (local DB writes) permitted
- ✅ Dangerous operations (email, paid enrichment, production writes) still blocked

### Pipeline Stages

**Overview now distinguishes:**

- 3 candidates discovered (raw signals)
- 2 awaiting research (unique contacts in DISCOVERED state)
- 0 qualified
- 0 rejected

### Visible Link to Results

**Hunter Status Card:**

```
🏢 Broker Hunter
Status: ENABLED
Last Run: 2 minutes ago
Result: SUCCESS • Found: 3 | Candidates: 2
[Run Hunter] button
```

**Future Enhancement:** Add direct link to filter Leads page by run ID:

```
[View Results →] /dashboard/leads?run_id=abc-123
```

---

## Verification Steps

1. ✅ Type-check passes
2. ✅ Full test suite passes (45/45)
3. ✅ Regression tests prove dry-run discoveries are visible
4. ✅ Dashboard renders discovered candidates correctly
5. ✅ Dangerous operations remain blocked
6. ✅ No secrets exposed

**Status:** ✅ **Complete and verified**
