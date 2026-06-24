# Persist Assessments to fly.io PHI Store — Design

**Date:** 2026-06-23
**Roadmap item:** #2 (NOW tier) — "Persist assessments to PHI store (fly.io Postgres, BAA)"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST lets an Ontario pharmacist prescribe for 19 minor ailments under **O. Reg. 256/24**, but it keeps **no record of the assessment itself**. The full clinical payload — patient demographics, the red flags screened, the symptoms observed, the regimen chosen, the notes typed — exists only as React state inside the wizard (`src/components/wizard/wizard-container.tsx:40-48`) and is destroyed the moment the pharmacist navigates away, closes the tab, or refreshes. The only thing that survives today is a non-PHI transaction id (`reserveTxId()` in `src/lib/prescription-actions.ts:6`, persisted to Supabase `prescription_tx`), which by deliberate design (`docs/superpowers/specs/2026-06-06-prescription-tx-id-design.md` "PHI Analysis") carries **no clinical content at all**.

This is a legal, audit, and college-compliance blocker. An Ontario pharmacist who prescribes under the minor-ailments authority must be able to produce the assessment record on demand; the Ontario College of Pharmacists and PHIPA both treat the absence of a retained health-information record as a serious finding. The competitive research (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §3) lists this as the single most consequential unforced gap in the build.

**The goal of this feature** is to persist the complete assessment to a PHI-grade store on **fly.io Postgres under a signed BAA**, scoped per pharmacy, written at the moment a document is produced, with a tamper-evident PHI audit trail. It is the foundation that #3 (digital consent), #4 (refusal / non-prescribe documentation), and #10 (PROM follow-up pipeline) build on, and it tightens #1 (e-fax) by letting the destination fax be validated against stored state rather than client-supplied input.

**Out of scope** (per roadmap §3 and §6): allergy / drug-interaction checking, pregnancy / breastfeeding Rx gating, and billing / claims — the PMS owns all of these. The assessment record stores *what the pharmacist decided and documented*; it does **not** re-derive or duplicate clinical-safety logic. It also does not, in this tier, introduce an amend/correct workflow, longitudinal care plans, or patient-facing access — those are LATER (#26 governance, #28 chronic module).

---

## 2. Current State (what exists in code)

### 2.1 The assessment lives only in component state

`WizardContainer` (`src/components/wizard/wizard-container.tsx:40`) holds the entire assessment in `useState`:

- `patient` (`PatientInfo`, `wizard-container.tsx:42`; default at `wizard-container.tsx:14-33`)
- `redFlagsChecked`, `symptomsChecked`, `assessmentNotes`, `selectedRx`, `nonRxChecked`, `isReferral` (`wizard-container.tsx:43-48`)

There is no `useEffect` persistence, no server action that receives this bundle, and no database write. `AssessmentData` (`src/types/index.ts:59-67`) is the typed shape of exactly this bundle — and it has **zero call sites that persist it**. A `rg` for `AssessmentData` returns only the type definition.

### 2.2 The two terminal flows

1. **Prescribe path** — `StepGenerate` (`src/components/wizard/step-generate.tsx:22`). On download (`step-generate.tsx:26`), it lazily reserves a tx id via `reserveTxId()` (`step-generate.tsx:28-34`) and renders `<CombinedPdf>` with that `txId` (`step-generate.tsx:35-45`). The tx id is the *only* durable artefact, and it is non-PHI.
2. **Referral path** — the `isReferral` branch of the wizard (`wizard-container.tsx:142-172`). It renders a referral summary and a "Download Referral PDF" button (`wizard-container.tsx:167`) backed by `handleDownloadReferral()` (`wizard-container.tsx:89-99`). **No tx id is reserved and no record of any kind is kept** — a referral today leaves zero trace in the system.

### 2.3 What is already persisted, and where

- **Supabase (non-PHI):** `prescription_tx` (tx id + `pharmacy_id` + `pharmacist_id` + `year`/`seq`, per `2026-06-06-prescription-tx-id-design.md`); `profiles`, `pharmacies`, `pharmacy_members`, `invitations`; `audit.log` (non-PHI events only, per `2026-06-06-audit-log-design.md`).
- **Supabase `audit.log`** is explicitly non-PHI by design (`audit-log-design.md` "PHI Analysis" + "Future PHI Events (fly.io)"). PHI audit events (`patient_record.viewed`, `assessment.saved`, `prescription.created`) are named in that spec as belonging to fly.io, not Supabase.
- **fly.io:** nothing. Not provisioned. No BAA signed (roadmap §7 open questions #1, #2).

### 2.4 Audit events declared but never emitted

`EventType` (`src/lib/audit-actions.ts:5-18`) includes `assessment.opened` and `pdf.generated`, but neither has a call site (roadmap §3 gap table: "Audit events declared but never emitted"). The `log_event` SECURITY DEFINER function (`2026-06-06-audit-log-design.md` "Write Path") validates metadata to ≤1 KB flat key-value and enforces required keys per event type. There is **no `assessment.saved` event** today.

### 2.5 Identity and scoping primitives already exist

`requireAuth()` (`src/lib/auth-guards.ts:44`) → `getProfile()` (`auth-guards.ts:5`) returns `{ id, pharmacyId, activeRole, isPlatformAdmin, fullName, ... }`. `id` is the pharmacist (Supabase `profiles.id`); `pharmacyId` is `profiles.pharmacy_id`. These are exactly the ownership keys roadmap §6.2 specifies for scoping fly.io rows. The Supabase cookie session reaches server actions via `createClient()` (`src/lib/supabase/server.ts:4`) and route handlers via `createRouteHandlerClient()` (`src/lib/supabase/route-handler.ts:5`).

### 2.6 No Postgres driver is installed

`package.json` (`src/../package.json:13-28`) depends only on `@supabase/ssr` and `@supabase/supabase-js`. There is no `pg`, no `postgres`, no Drizzle/Kysely. Introducing fly.io Postgres means adding a driver (see §3).

---

## 3. Approach (options + recommendation)

The design hinges on five decisions: (a) the data-plane transport, (b) authentication / authorization of the write, (c) the write trigger, (d) the schema shape, (e) where the PHI audit trail lives. Options below are evaluated against roadmap §6.2 (PHI on fly.io, Supabase = auth + non-PHI) and §6.4 (the partitioning rule).

### Option A — In-process `pg` pool + app-layer scoping + JSONB-core schema (RECOMMENDED)

A Next.js server action opens a pooled connection to fly.io Postgres via a `pg` `Pool`, verifies the Supabase cookie session through the existing `requireAuth()` path to obtain `{ pharmacist_id, pharmacy_id }`, and INSERTs the assessment row with those values injected server-side (never from client input). The bulk of the clinical payload (symptoms, red flags, non-Rx advice, selected regimen, notes) is stored as `jsonb` columns that mirror the existing TS shapes (`PatientInfo`, `SelectedRx`, `string[]`); the few fields that must be queryable/indexable (`ailment_slug`, `outcome`, `patient_id`, `prescription_tx_id`, `created_at`) are promoted to real columns. PHI access is logged to a `phi_audit_log` table on fly.io that mirrors the Supabase hash-chain pattern.

- **Pros:** Smallest safe surface. Reuses `requireAuth()`/`auth-guards.ts` unchanged — no new auth model. JSONB mirrors `AssessmentData` (`types/index.ts:59`) one-to-one, so the legal record is a faithful, low-friction snapshot of what the pharmacist saw, with no fragile normalization. App-layer scoping is *exactly* the roadmap §6.2 linking model. `pg` `Pool` survives serverless connection churn. Forward-compatible: #3 (consent), #4 (refusal), #10 (PROM) append JSONB keys or sibling rows rather than reshape the core.
- **Cons:** Authorization is enforced in application code, not Postgres RLS — fly.io Postgres has no auth relationship to Supabase identities, so there is no DB-level principal to bind. Mitigated by (i) concentrating every fly.io read/write in one module (`src/lib/phi/assessment-store.ts`) that always injects `pharmacy_id` from the verified JWT, (ii) a defence-in-depth lint/review rule that no query in `src/lib/phi/**` omits a `WHERE pharmacy_id = $…` clause, and (iii) the PHI audit trail recording every access. The BAA is a hard gate regardless.

### Option B — Standalone fly.io API service with its own auth

Run a small API on fly.io that the Next.js app calls over HTTP; the service authenticates the pharmacist independently and owns DB-level auth.

- **Pros:** fly.io owns its whole data plane; DB-level enforcement becomes possible.
- **Cons:** Doubles the deploy surface, invents a second auth model and token-minting flow, adds a network hop and a new failure mode, and is premature for a per-pharmacy-tenant scale where one Next.js app already holds the Supabase JWT. Violates YAGNI for the NOW tier.
- **Rejected** for this tier; revisit only if DB-level RLS becomes a hard requirement (e.g., multi-region or regulated audit).

### Option C — Encrypted PHI columns on Supabase

Keep all data on Supabase, encrypt PHI at the column level (pgcrypto / Supabase Vault).

- **Pros:** No new infrastructure; one database.
- **Cons:** Directly violates roadmap §6.2 ("Supabase is retained for auth and non-PHI metadata only") and §6.4 (the partitioning rule). Supabase's BAA posture and the clean custody boundary of a dedicated fly.io PHI store are lost; a single credentials leak exposes auth *and* PHI together. This is precisely the architecture the roadmap was written to forbid.
- **Rejected.**

### Recommendation

**Option A.** It is the faithful implementation of the roadmap architecture, the smallest safe change set, and the JSONB-core design means every downstream NOW/NEXT feature extends rather than rewrites it.

---

## 4. Components & Data Model

### 4.1 Data-plane client (`src/lib/phi/db.ts`, new)

A lazily-initialised `pg.Pool` singleton, created only when `process.env.PHI_PERSIST_ENABLED === "true"` and `FLY_PHI_DATABASE_URL` is set. Connection params: small `max` (e.g. 5), `connectionTimeoutMillis`, `ssl` required (`{ rejectUnauthorized: true }` against the fly.io cert). Exported helper `getPhiPool()` throws a typed error if the flag is off — so any call site that forgets the guard fails loudly rather than silently writing PHI nowhere. The pool is module-scoped to survive HMR/dev warm restarts.

### 4.2 Identity hashing (`src/lib/phi/identity.ts`, new)

`computeIdentityHash({ name, dob, postalCode })` returns `HMAC-SHA256(PHI_IDENTITY_SALT, lower(trim(name)) || '|' || dob || '|' || upper(postalCode))` as hex. HMAC (not a raw hash) prevents rainbow-table linkage across pharmacies and permits salt rotation. The salt is a server-only env var (`PHI_IDENTITY_SALT`); it is never shipped to the client and never prefixed `NEXT_PUBLIC_`.

### 4.3 Schema (fly.io Postgres — PHI, under BAA)

All tables row-scoped by `pharmacy_id` (copied from the Supabase JWT; no cross-DB FK is enforceable between fly.io and Supabase, per roadmap §6.2 — the application enforces ownership). `patient` is an identity index so repeat assessments for the same person link (feeds #10 PROM follow-up and #28 longitudinal); `assessment.patient_snapshot` is the immutable point-in-time truth for the legal record (so a later patient-edit cannot rewrite history).

```sql
-- patient: re-identifiable patient index (PHI). One row per real person per pharmacy.
CREATE TABLE patient (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id     uuid NOT NULL,
  identity_hash   text NOT NULL,            -- HMAC per §4.2
  name            text NOT NULL,
  dob             date,
  sex             text,
  ohip            text,                     -- OHIP/PHN — PHI; fly.io only
  phone           text,
  address         text,
  city            text,
  postal_code     text,
  allergies       text,
  current_meds    text,
  doctor_name     text,
  doctor_license  text,
  doctor_phone    text,
  doctor_fax      text,
  doctor_address  text,
  pregnant        boolean,
  breastfeeding   boolean,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, identity_hash)
);
CREATE INDEX patient_pharmacy ON patient (pharmacy_id, name);
CREATE INDEX patient_identity ON patient (pharmacy_id, identity_hash);

-- assessment: the legal clinical record (PHI). One row per consult.
CREATE TABLE assessment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- assessment_id; the cross-feature correlation key
  pharmacy_id         uuid NOT NULL,
  pharmacist_id       uuid NOT NULL,            -- actor who captured it
  patient_id          uuid NOT NULL REFERENCES patient(id),
  ailment_slug        text NOT NULL,            -- e.g. 'acne' (queryable)
  ailment_name        text NOT NULL,            -- denormalised at capture time
  outcome             text NOT NULL CHECK (outcome IN ('prescribed','referred','abandoned')),
  has_red_flag        boolean NOT NULL DEFAULT false,
  prescription_tx_id  text,                     -- 'TX-…' when outcome=prescribed (ref to Supabase prescription_tx.tx_id; non-PHI)
  symptoms_checked    jsonb NOT NULL DEFAULT '[]'::jsonb,
  red_flags_checked   jsonb NOT NULL DEFAULT '[]'::jsonb,
  non_rx_checked      jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessment_notes    text,
  selected_rx         jsonb,                    -- SelectedRx | null  (drug, dose, sig, quantity, refills, duration, notes)
  patient_snapshot    jsonb NOT NULL,           -- immutable PatientInfo at capture (legal truth)
  pharmacy_snapshot   jsonb NOT NULL,           -- immutable PharmacyDefaults at capture
  protocol_version    text,                     -- ailments.json content hash (#26 governance forward-compat)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prescription_tx_id)                   -- one assessment per tx id; NULLs are distinct (multiple non-prescribe rows allowed)
);
CREATE INDEX assessment_pharmacy_created ON assessment (pharmacy_id, created_at DESC);
CREATE INDEX assessment_patient ON assessment (patient_id, created_at DESC);
CREATE INDEX assessment_tx ON assessment (prescription_tx_id);
```

> Note on `UNIQUE (prescription_tx_id)`: PostgreSQL treats multiple NULLs as distinct, so referrals/abandoned records (which carry no tx id) do not collide. For `outcome='prescribed'`, the uniqueness constraint makes re-download idempotent — see §6.

### 4.4 PHI audit trail (fly.io — mirrors Supabase `audit.log` hash chain)

This is the PHI-bearing audit log the Supabase `audit-log-design.md` explicitly defers to fly.io ("Future PHI Events"). Same hash-chain construction (`audit-log-design.md` "Tamper Evidence") so a Commissioner can verify integrity, and so direct-DB tampering is detectable.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE phi_audit_log (
  id            bigserial PRIMARY KEY,
  assessment_id uuid,
  patient_id    uuid,
  pharmacy_id   uuid NOT NULL,
  actor_id      uuid NOT NULL,                 -- pharmacist (Supabase profiles.id, opaque)
  action        text NOT NULL,                 -- 'assessment.created' | 'assessment.viewed' | 'patient.viewed' | 'assessment.amended'
  metadata      jsonb DEFAULT '{}'::jsonb,
  chain_hash    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phi_audit_pharmacy ON phi_audit_log (pharmacy_id, created_at DESC);
CREATE INDEX phi_audit_assessment ON phi_audit_log (assessment_id);

CREATE OR REPLACE FUNCTION phi.compute_chain_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
declare v_prev text;
begin
  SELECT chain_hash INTO v_prev FROM phi_audit_log ORDER BY id DESC LIMIT 1;
  v_prev := coalesce(v_prev, '');
  NEW.chain_hash := encode(digest(
    v_prev || NEW.action || NEW.actor_id::text || coalesce(NEW.pharmacy_id::text,'') || NEW.created_at::text,
    'sha256'), 'hex');
  RETURN NEW;
end; $$;

CREATE TRIGGER phi_audit_chain BEFORE INSERT ON phi_audit_log
  FOR EACH ROW EXECUTE FUNCTION phi.compute_chain_hash();
```

App-layer write discipline: no `UPDATE`/`DELETE` policy is ever granted on `assessment`, `patient`, or `phi_audit_log` by the store module — corrections are future amendment rows (out of scope for NOW; see #26).

### 4.5 Store module (`src/lib/phi/assessment-store.ts`, new)

Concentrates **all** fly.io reads/writes. Every function takes the verified `{ pharmacistId, pharmacyId }` pair (from `requireAuth()`) and injects `pharmacy_id` into every query — it is never read from the payload.

- `saveAssessment(input): Promise<{ assessmentId: string }>`
  1. `upsert patient` on `(pharmacy_id, identity_hash)` (`ON CONFLICT … DO UPDATE SET … RETURNING id`) — keeps demographics current for the linkage index.
  2. `insert assessment … on conflict (prescription_tx_id) do update` when `prescriptionTxId` is present (idempotent re-download); otherwise a plain insert. Uses the client-supplied `assessmentId` when provided so a re-save amends the same row's `updated_at` rather than creating a duplicate.
  3. `insert into phi_audit_log (…, 'assessment.created', …)`.
  4. Returns `{ assessmentId }`. All three statements run in one `client` transaction from the pool (`pool.connect()` → `BEGIN`/`COMMIT`), so a partial failure leaves no orphan patient row and no audit row without its assessment.
- `getAssessment({ assessmentId, pharmacyId })` — single-row select, `WHERE id = $1 AND pharmacy_id = $2`; writes `assessment.viewed` to `phi_audit_log`.
- `listAssessments({ pharmacyId, patientId?, ailmentSlug?, limit, offset })` — always scoped by `pharmacy_id`.

### 4.6 Non-PHI Supabase audit event (`assessment.saved`)

Add `"assessment.saved"` to the `EventType` union (`src/lib/audit-actions.ts:5-18`) and to `audit.event_type`. Metadata is **strictly** `{ assessment_id, outcome }` — no patient data, **no `ailment_slug`** (the ailment is clinical content and therefore PHI-adjacent; see §5.1 and Open Question §7.3). Extend the `log_event` validation to require `assessment_id` + `outcome` for `assessment.saved` and to reject any patient/clinical key (`patient_*`, `ailment`, `drug`, `rx_*`, `name`, `dob`). `assessment_id` is an opaque UUID — non-identifying, safe on Supabase.

### 4.7 Server action + client wiring

- `src/lib/assessment-actions.ts` (new, `"use server"`) — `saveAssessmentAction(payload: AssessmentData & { outcome, assessmentId?, prescriptionTxId? })`:
  1. `requireAuth()` → `{ id: pharmacistId, pharmacyId }`. Bail with `{ assessmentId: null }` (not an error) when `!pharmacyId`.
  2. **Guard:** if `process.env.PHI_PERSIST_ENABLED !== "true"` → return `{ assessmentId: null }` (no-op stub; lets the wizard ship dark, mirroring the #1 e-fax stubbing pattern). Log nothing.
  3. Build the persistence input (compute `identity_hash`; assemble `patient_snapshot`/`pharmacy_snapshot`/JSONB arrays from the payload), call `saveAssessment(…)`.
  4. Emit the non-PHI Supabase `assessment.saved` event with `{ assessment_id, outcome }`.
  5. Return `{ assessmentId }`.

- **Prescribe wiring** (`src/components/wizard/step-generate.tsx`): on "Download" (`step-generate.tsx:26`), **persist before producing the Blob** — call `saveAssessmentAction` with `outcome: 'prescribed'`, the already-reserved `txId` (`step-generate.tsx:24`) as `prescriptionTxId`, and a client-generated `assessmentId` (`crypto.randomUUID()` created once via `useState` on first need). Only on `{ assessmentId }` success (or no-op stub return) does the existing `downloadPdf(…)` (`step-generate.tsx:47`) proceed. **Fail-closed:** a real persistence error blocks the document, guaranteeing every produced PDF has a stored record. (Stubbed no-op during Phase 1 never blocks.)

- **Referral wiring** (`src/components/wizard/wizard-container.tsx`, referral branch `:142-172`): `handleDownloadReferral` (`wizard-container.tsx:89`) gains a `saveAssessmentAction({ outcome: 'referred' })` call before `downloadPdf` (`wizard-container.tsx:98`). `prescriptionTxId` is `undefined`; `assessmentId` is a client UUID. This closes the today-zero-trace referral gap.

- **`assessmentId` lifecycle:** generated once per wizard mount (`useState(() => crypto.randomUUID())` at the `WizardContainer` level, `wizard-container.tsx:41` neighbourhood) and threaded into both terminal steps, so a pharmacist who downloads, goes back, and downloads again amends the same assessment row instead of duplicating it.

---

## 5. Security / PHIPA-PIPEDA Posture

This feature is the first to place PHI at rest in the system, so it must instantiate the controls roadmap §6.3 promises and respect the §6.4 partitioning rule exactly.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| Patient name, DOB, sex, OHIP, address, phone, doctor fields, allergies, meds, pregnancy | PHI | **fly.io** `patient` + `assessment.patient_snapshot`. Never Supabase. OHIP is a PHN — fly.io only. |
| Red flags / symptoms / non-Rx advice / selected regimen / notes / ailment | PHI (clinical) | **fly.io** `assessment.*` jsonb/columns. `ailment_slug`/`ailment_name` live here; they do **not** go to Supabase audit. |
| `identity_hash` | Pseudonymous identifier | fly.io `patient.identity_hash`. HMAC'd, not raw. |
| `assessment_id` (UUID) | Non-identifying | Allowed on **both** stores — the correlation key. Appears in Supabase `assessment.saved` metadata. |
| `prescription_tx_id` | Non-PHI (per `prescription-tx-id-design.md`) | Originates on Supabase `prescription_tx`; mirrored as `assessment.prescription_tx_id` for joinability. May appear in either audit log. |
| `pharmacy_id`, `pharmacist_id` | Non-PHI (business/employee) | Originate on Supabase; copied to fly.io as scoping keys. |
| `outcome` (`prescribed`/`referred`/`abandoned`) | Non-identifying on its own | Allowed in Supabase `assessment.saved` metadata. |

**Reconciliation note:** the older `audit-log-design.md` events table lists `assessment.opened | { ailment }`. Carrying the ailment in the *non-PHI* Supabase log is inconsistent with the stricter stance above (ailment is clinical). This spec recommends ailment stay off Supabase entirely; see Open Question §7.3.

### 5.2 Regulatory mapping

- **PHIPA s.12 / s.10.1:** retaining the assessment record and logging every PHI access satisfies custodian accountability; the on-fly.io `phi_audit_log` hash chain provides the tamper-evidence PHIPA s.10.1 will require once proclaimed.
- **PIPEDA Principle 4.1 / 4.7 / 4.5:** fly.io is a third-party service handling PHI → a **signed BAA is a hard gate** before any production PHI write. AES-256 at rest (fly.io encrypted volumes) + TLS in transit satisfy Principle 4.7; purpose limitation (assessment documentation only) satisfies 4.5.
- **PHIPA s.17 (cross-border):** fly.io regions must be chosen in **Canada** (e.g., `yyz` / `yul`) so PHI does not leave Ontario/Canada. This is the single most important ops decision and must be verified at provisioning. (Contrast with e-fax #1, where a US transport is at least debatable; for *storage* there is no reason to leave Canada.)
- **Retention:** Ontario pharmacy record retention is ~10 years for Rx records (`prescription-tx-id-design.md` "Data Retention"). The assessment record inherits the same minimum; no automated deletion is implemented in this tier — rows persist until a retention job is added (LATER). Documented in the data-flow map.
- **Consent linkage:** the digital-consent feature (#3) will attach a `consent_id` to each assessment when it ships. For now, the pharmacist's authenticated act of saving is the recorded disclosure/creation event.

### 5.3 Application security

- **Authorization is app-layer, not RLS.** fly.io Postgres has no principal tied to Supabase auth, so there is no DB-level RLS to lean on. Defence in depth: (i) all fly.io access funnels through `src/lib/phi/assessment-store.ts`, which injects `pharmacy_id` from the verified JWT on every query; (ii) the module exposes no function that accepts `pharmacyId` from a caller — it derives it internally; (iii) a CI grep/lint rule (`rg -n "FROM assessment|INTO assessment|FROM patient" src/lib/phi`) verifies every query text contains `pharmacy_id`; (iv) every read/write also writes `phi_audit_log`, so cross-pharmacy access is both prevented and detectable.
- **Credentials / salt:** `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT` are server-only env vars, never `NEXT_PUBLIC_`. The DB pool is constructed only inside server actions / route handlers (Node runtime), never in client components.
- **Fail-closed persistence:** on the prescribe path, a persistence failure blocks PDF generation, so a document can never exist without its record. (During Phase 1 the flag-off no-op returns success-without-writing, so the wizard is unaffected.)
- **Immutability:** the store module offers no `UPDATE`/`DELETE` for clinical content. Corrections are deferred to an amendment-row model (#26). `patient` demographics are upserted (the index is meant to track current contact info), but `assessment.patient_snapshot` is write-once — the legal record reflects what was true at capture.
- **Idempotency / re-download:** the client reuses one `assessmentId` per wizard session and the DB enforces `UNIQUE (prescription_tx_id)`, so re-downloading the same prescription amends one row rather than creating duplicates.

---

## 6. Edge Cases

- **fly.io not yet provisioned / BAA unsigned (Phase 1):** `PHI_PERSIST_ENABLED` is off; `saveAssessmentAction` returns `{ assessmentId: null }` without writing or auditing. The wizard behaves exactly as today. The flag and the schema are ready so flipping the switch lights up persistence with no further code change.
- **Referral leaves zero trace today:** this feature fixes that — `outcome: 'referred'` rows are created with `prescription_tx_id = NULL` and `has_red_flag = true`.
- **Pharmacist goes back and re-downloads:** the same `assessmentId` is reused; `saveAssessment` upserts (prescribe) or updates `updated_at` (referral), so no duplicate rows.
- **Two pharmacists at the same pharmacy assess the same patient:** both resolve to the same `patient.id` via `identity_hash`; each gets its own `assessment` row with its own `pharmacist_id`. Correct.
- **Identity-hash collision** (two distinct patients with the same name+DOB+postal): the upsert would merge them into one `patient` row. Acceptable for NOW (rare); pharmacist-confirmed patient matching is LATER. Documented; not a data-loss risk because `assessment.patient_snapshot` preserves the per-visit truth.
- **Persistence failure mid-consult:** prescribe path blocks the PDF (fail-closed) and surfaces a retryable error; referral path same. No partial record (the store wraps patient-upsert + assessment-insert + audit in one transaction).
- **No patient name/DOB:** step 0 (`wizard-container.tsx:52-59`) requires `name && dob` to advance, so a prescribe/referral save always has identity inputs. An "abandoned" save (§7.2) may lack them — the store rejects an abandoned save without `name`/`dob` rather than writing an un-linkable row.
- **Patient edits their demographics later:** `patient` (the index) updates; past `assessment.patient_snapshot` rows do not — the historical record is immutable.
- **OHIP field empty:** `patient.ohip` is nullable; no issue.
- **Platform admin access:** explicitly **not** granted to `assessment`/`patient` in this tier (mirrors `prescription-tx-id-design.md` "No platform_admin access"). Commissioner/exports are handled via the existing `export.requested` flow against the audit logs, not direct PHI reads. Direct PHI admin reads are a separate, separately-audited LATER capability.
- **`assessment.opened` / `pdf.generated` have no call sites today:** wiring `pdf.generated` is in scope as a side-effect of this feature (a PDF is now produced against a persisted record), emitting `{ tx_id }` per the existing audit contract. `assessment.opened` remains unwired (open question §7.4).

---

## 7. Open Questions

1. **fly.io provisioning + BAA timing (the hard gate).** Confirm fly.io Postgres is stood up in a **Canadian region** (`yyz`/`yul`) and the BAA is signed before `PHI_PERSIST_ENABLED` flips true. This is roadmap open question #2 and the single prerequisite for the feature going live.
2. **Driver / ORM choice.** Raw `pg` + a ~30-line query helper is recommended for NOW (YAGNI, full control over the `pharmacy_id` discipline). Revisit Drizzle/Kysely when the query count grows. Confirm `pg` is acceptable vs. `postgres.js`.
3. **Connection pooling in a serverless-ish runtime.** Next.js route handlers/server actions are effectively short-lived; `pg.Pool` with a small `max` + fly.io's built-in connection cap (or a PgBouncer-style pgbouncer sidecar / fly.io's internal proxy) is required to avoid exhausting connections. Confirm the pooling strategy at provisioning.
4. **Should "abandoned" assessments be persisted?** There is compliance value in recording that an assessment was started and not completed (and #4 refusal docs depends on a persistence home). Recommend yes, behind a sub-toggle, with `outcome: 'abandoned'`. Confirm.
5. **`identity_hash` salt management.** `PHI_IDENTITY_SALT` rotation strategy — rotation re-hashes the `patient.identity_hash` column and invalidates prior uniqueness. Decide rotation cadence (or treat as set-once for NOW).
6. **Patient dedup / matching UI.** Best-effort `identity_hash` is sufficient for NOW; a pharmacist-confirmed patient-picker (avoiding accidental merges) is LATER. Confirm NOW-tier scope.
7. **Reconcile `assessment.opened { ailment }` in the older audit design.** That event metadata carries the ailment in the *non-PHI* Supabase log, which conflicts with §5.1's stance that ailment is clinical/PHI. Options: (a) drop ailment from `assessment.opened` metadata, (b) move `assessment.opened` entirely to the fly.io `phi_audit_log`, (c) accept that ailment category (not the specific clinical finding) is non-PHI. Recommend (a) or (b); needs a decision.
8. **Protocol versioning now or later?** Capturing `protocol_version` (a hash of `data/ailments.json`) at save time gives audit defensibility when protocols change (#26 governance). It's one extra column; recommend capturing now even though the governance UI is LATER.
9. **Amendment / correction workflow.** Out of scope for NOW (immutability enforced), but the schema should not preclude an `assessment_amendment` sibling table. Confirm the write-once stance is acceptable for launch.
10. **Where does the `pharmacist_id` come from on fly.io?** It is `profiles.id` (Supabase) copied as an opaque uuid. If a pharmacist is ever removed from Supabase, their fly.io rows' `pharmacist_id` must remain resolvable for audit. Confirm an immutable "pharmacist directory" or soft-delete policy on Supabase `profiles`.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/phi/db.ts` — pooled fly.io Postgres client (flag-guarded).
- `src/lib/phi/identity.ts` — HMAC identity hash.
- `src/lib/phi/assessment-store.ts` — all fly.io reads/writes, pharmacy-scoped.
- `src/lib/phi/audit.ts` — PHI audit-log writer (hash-chained).
- `src/lib/assessment-actions.ts` — `saveAssessmentAction` server action (flag-guarded no-op stub in Phase 1).

**Modified:**
- `src/lib/audit-actions.ts` — add `"assessment.saved"` to the `EventType` union.
- `src/components/wizard/wizard-container.tsx` — generate one `assessmentId` per session; persist `outcome: 'referred'` in `handleDownloadReferral`.
- `src/components/wizard/step-generate.tsx` — persist `outcome: 'prescribed'` (fail-closed) before `downloadPdf`; emit `pdf.generated`.
- `package.json` — add `pg` (and `@types/pg`) dependency.

**Database (fly.io, applied at provisioning):** `patient`, `assessment`, `phi_audit_log` tables + `compute_chain_hash` trigger + indexes (§4.3–4.4).

**Database (Supabase, non-PHI):** add `assessment.saved` to `audit.event_type`; extend `log_event` validation (require `assessment_id`+`outcome`; reject patient/clinical keys).

**Environment (server-only):** `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.
