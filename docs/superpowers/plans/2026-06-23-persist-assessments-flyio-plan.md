# Persist Assessments to fly.io PHI Store — Implementation Plan

**Date:** 2026-06-23
**Roadmap item:** #2 (NOW tier)
**Companion design:** `docs/superpowers/specs/2026-06-23-persist-assessments-flyio-design.md`

> **For agentic workers:** Implement task-by-task. Each step is a small, independently verifiable unit. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the hard constraints in the design doc: **all PHI stays on fly.io**; Supabase receives only the non-PHI `assessment.saved` audit metadata (`{ assessment_id, outcome }`) — never patient data, never the ailment. Do **not** flip `PHI_PERSIST_ENABLED=true` until the fly.io BAA is signed and a Canadian region is confirmed (design §5.2). Until then the persistence path is a no-op stub and the wizard behaves exactly as today.

**Goal:** Persist every completed assessment (prescribe + referral) to fly.io Postgres under a signed BAA, scoped per pharmacy from the verified Supabase JWT, written at the moment a document is produced, with a tamper-evident PHI audit trail on fly.io and a non-PHI `assessment.saved` event on Supabase.

**Approach (from the design):** Option A — a `pg` `Pool` in a server action; `requireAuth()` supplies `{ pharmacist_id, pharmacy_id }` which the store module injects into every query; the clinical payload is stored JSONB-core (`patient` index + immutable `assessment` row + hash-chained `phi_audit_log`); the whole feature is dark behind `PHI_PERSIST_ENABLED` until fly.io is provisioned.

**Tech stack:** Next.js 16.2.6 server actions (`"use server"`), `pg ^8` (new), Supabase SSR client (auth + non-PHI audit), Vitest + React Testing Library. Server actions/route handlers run on the Node runtime (required for `pg`).

---

### Task 0: Ops prerequisites (gate — no code)

**Owner:** ops/infra. Nothing under `src/` is enabled until this completes.

- [ ] **Step 1: Provision fly.io Postgres in a Canadian region**

Create a fly.io Postgres cluster in `yyz` (Toronto) or `yul` (Montreal). Enable encrypted volumes. Capture the connection string as `FLY_PHI_DATABASE_URL` (server-only secret; never `NEXT_PUBLIC_`, never committed).

- [ ] **Step 2: Sign the fly.io BAA**

PHIPA/PIPEDA require a signed Business Associate Agreement before any PHI lands at rest. **`PHI_PERSIST_ENABLED` stays `false` until the BAA is countersigned.** (Roadmap §7 open question #2.)

- [ ] **Step 3: Generate the identity salt**

Generate a high-entropy `PHI_IDENTITY_SALT` (e.g. `openssl rand -hex 32`) and store it as a server-only secret. Document rotation as set-once for NOW (design §7.5).

- [ ] **Step 4: Decide the pooler**

Confirm the connection-pooling strategy for short-lived Next.js handlers (fly.io's built-in proxy / a `pgbouncer` sidecar / `pg.Pool` with small `max`). This bounds Task 3's pool sizing. (Design §7.3.)

> Task 0 is the hard gate. Tasks 1–9 may be built and merged behind the flag without it; Task 10 (rollout) requires it.

---

### Task 1: Add the `pg` driver (local dependency)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `pg` into the local project scope**

```bash
npm install pg
npm install -D @types/pg
```

> Install only into this project (local `package.json`); never globally.

- [ ] **Step 2: Verify**

```bash
node -e "require('pg').Pool; console.log('pg ok')"
```
Expected: `pg ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps(phi): add pg driver for fly.io PHI store"
```

---

### Task 2: fly.io schema migration

**Files:**
- Database (fly.io, applied via `psql "$FLY_PHI_DATABASE_URL"`): `patient`, `assessment`, `phi_audit_log`

- [ ] **Step 1: Apply the migration**

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE patient (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id     uuid NOT NULL,
  identity_hash   text NOT NULL,
  name            text NOT NULL,
  dob             date,
  sex             text,
  ohip            text,
  phone           text,
  address         text,
  city            text,
  postal_code     text,
  allergies       text,
  current_meds    text,
  doctor_name     text,
  doctor_license  text,
  doctor_phone    text,
  doctor_fax       text,
  doctor_address  text,
  pregnant        boolean,
  breastfeeding   boolean,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, identity_hash)
);
CREATE INDEX patient_pharmacy ON patient (pharmacy_id, name);
CREATE INDEX patient_identity ON patient (pharmacy_id, identity_hash);

CREATE TABLE assessment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id         uuid NOT NULL,
  pharmacist_id       uuid NOT NULL,
  patient_id          uuid NOT NULL REFERENCES patient(id),
  ailment_slug        text NOT NULL,
  ailment_name        text NOT NULL,
  outcome             text NOT NULL CHECK (outcome IN ('prescribed','referred','abandoned')),
  has_red_flag        boolean NOT NULL DEFAULT false,
  prescription_tx_id  text,
  symptoms_checked    jsonb NOT NULL DEFAULT '[]'::jsonb,
  red_flags_checked   jsonb NOT NULL DEFAULT '[]'::jsonb,
  non_rx_checked      jsonb NOT NULL DEFAULT '[]'::jsonb,
  assessment_notes    text,
  selected_rx         jsonb,
  patient_snapshot    jsonb NOT NULL,
  pharmacy_snapshot   jsonb NOT NULL,
  protocol_version    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prescription_tx_id)
);
CREATE INDEX assessment_pharmacy_created ON assessment (pharmacy_id, created_at DESC);
CREATE INDEX assessment_patient ON assessment (patient_id, created_at DESC);
CREATE INDEX assessment_tx ON assessment (prescription_tx_id);

CREATE TABLE phi_audit_log (
  id            bigserial PRIMARY KEY,
  assessment_id uuid,
  patient_id    uuid,
  pharmacy_id   uuid NOT NULL,
  actor_id      uuid NOT NULL,
  action        text NOT NULL,
  metadata      jsonb DEFAULT '{}'::jsonb,
  chain_hash    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phi_audit_pharmacy ON phi_audit_log (pharmacy_id, created_at DESC);
CREATE INDEX phi_audit_assessment ON phi_audit_log (assessment_id);

CREATE OR REPLACE FUNCTION phi_compute_chain_hash()
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
  FOR EACH ROW EXECUTE FUNCTION phi_compute_chain_hash();
```

> No `UPDATE`/`DELETE` grants are issued to the app role for `assessment`, `patient` (beyond the upsert path), or `phi_audit_log`. Create a dedicated least-privilege fly.io app role (`cdst_app`) with `INSERT`/`SELECT` only.

- [ ] **Step 2: Verify**

```sql
\d patient
\d assessment
\d phi_audit_log
INSERT INTO phi_audit_log (pharmacy_id, actor_id, action) VALUES ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','smoke.test');
SELECT chain_hash IS NOT NULL AS ok FROM phi_audit_log WHERE action='smoke.test';
DELETE FROM phi_audit_log WHERE action='smoke.test';
```
Expected: tables exist; `ok = t`.

- [ ] **Step 3: Commit** (the migration SQL under `docs/superpowers/migrations/` for reproducibility — a docs-only artefact, not a code file)

```bash
git add docs/superpowers/migrations/2026-06-23-persist-assessments-flyio.sql
git commit -m "chore(phi): fly.io schema migration for assessment persistence"
```

---

### Task 3: fly.io pooled client (`src/lib/phi/db.ts`)

**Files:**
- Create: `src/lib/phi/db.ts`

- [ ] **Step 1: Implement the flag-guarded pool singleton**

```ts
import { Pool } from "pg"

let pool: Pool | null = null

export function isPhiEnabled(): boolean {
  return process.env.PHI_PERSIST_ENABLED === "true"
    && !!process.env.FLY_PHI_DATABASE_URL
}

export function getPhiPool(): Pool {
  if (!isPhiEnabled()) {
    throw new Error("PHI persistence is not enabled (PHI_PERSIST_ENABLED / FLY_PHI_DATABASE_URL).")
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.FLY_PHI_DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: true },
    })
  }
  return pool
}
```

> The pool is module-scoped (survives warm restarts). `getPhiPool()` throws loudly if the flag is off so a caller that forgets the guard fails closed rather than silently no-op'ing.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/phi/db.ts
git commit -m "feat(phi): add flag-guarded fly.io pg pool"
```

---

### Task 4: Identity hash (`src/lib/phi/identity.ts`)

**Files:**
- Create: `src/lib/phi/identity.ts`

- [ ] **Step 1: Implement the HMAC identity hash**

```ts
import { createHmac } from "node:crypto"

export function computeIdentityHash(args: {
  name: string
  dob: string
  postalCode: string
}): string {
  const salt = process.env.PHI_IDENTITY_SALT
  if (!salt) throw new Error("PHI_IDENTITY_SALT is not configured.")
  const key = `${args.name.trim().toLowerCase()}|${args.dob}|${args.postalCode.replace(/\s+/g, "").toUpperCase()}`
  return createHmac("sha256", salt).update(key).digest("hex")
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/phi/identity.ts
git commit -m "feat(phi): add HMAC patient identity hash"
```

---

### Task 5: Store module (`src/lib/phi/assessment-store.ts`)

**Files:**
- Create: `src/lib/phi/assessment-store.ts`

> **Discipline:** this module is the *only* place that touches fly.io `assessment`/`patient`. `pharmacyId` is derived from `requireAuth()` and injected into every query — it is never accepted as a parameter from a caller. Every function writes a `phi_audit_log` row.

- [ ] **Step 1: Implement `saveAssessment`**

```ts
import { getPhiPool } from "./db"
import { computeIdentityHash } from "./identity"

export interface SaveAssessmentInput {
  pharmacistId: string
  pharmacyId: string
  assessmentId?: string              // client-generated UUID; reused across re-saves
  prescriptionTxId?: string          // 'TX-…' for prescribe; undefined for referral/abandoned
  outcome: "prescribed" | "referred" | "abandoned"
  hasRedFlag: boolean
  ailmentSlug: string
  ailmentName: string
  symptomsChecked: string[]
  redFlagsChecked: string[]
  nonRxChecked: string[]
  assessmentNotes: string
  selectedRx: unknown | null
  patient: Record<string, unknown>   // PatientInfo snapshot source
  pharmacy: Record<string, unknown>  // PharmacyDefaults snapshot source
  protocolVersion?: string
}

export async function saveAssessment(input: SaveAssessmentInput): Promise<{ assessmentId: string }> {
  const pool = getPhiPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const identityHash = computeIdentityHash({
      name: String(input.patient.name ?? ""),
      dob: String(input.patient.dob ?? ""),
      postalCode: String(input.patient.postalCode ?? ""),
    })

    // Upsert patient (linkage index); demographics kept current.
    const patientParams = [
      input.pharmacyId, identityHash,
      input.patient.name, input.patient.dob ?? null, input.patient.sex ?? null,
      input.patient.ohip ?? null, input.patient.phone ?? null,
      input.patient.address ?? null, input.patient.city ?? null, input.patient.postalCode ?? null,
      input.patient.allergies ?? null, input.patient.currentMeds ?? null,
      input.patient.doctorName ?? null, input.patient.doctorLicense ?? null,
      input.patient.doctorPhone ?? null, input.patient.doctorFax ?? null, input.patient.doctorAddress ?? null,
      input.patient.pregnant ?? null, input.patient.breastfeeding ?? null,
    ]
    const patientRes = await client.query<{
      id: string
    }>(`
      INSERT INTO patient (
        pharmacy_id, identity_hash, name, dob, sex, ohip, phone, address, city, postal_code,
        allergies, current_meds, doctor_name, doctor_license, doctor_phone, doctor_fax, doctor_address,
        pregnant, breastfeeding
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (pharmacy_id, identity_hash) DO UPDATE SET
        name = EXCLUDED.name, phone = EXCLUDED.phone, address = EXCLUDED.address,
        city = EXCLUDED.city, postal_code = EXCLUDED.postal_code,
        doctor_name = EXCLUDED.doctor_name, doctor_phone = EXCLUDED.doctor_phone,
        doctor_fax = EXCLUDED.doctor_fax, doctor_address = EXCLUDED.doctor_address,
        updated_at = now()
      RETURNING id
    `, patientParams)
    const patientId = patientRes.rows[0].id

    // Upsert assessment. prescription_tx_id UNIQUE makes prescribe re-downloads idempotent.
    const a = input.assessmentId
    const insertAssessment = await client.query<{ id: string }>(`
      INSERT INTO assessment (
        id, pharmacy_id, pharmacist_id, patient_id, ailment_slug, ailment_name, outcome, has_red_flag,
        prescription_tx_id, symptoms_checked, red_flags_checked, non_rx_checked, assessment_notes,
        selected_rx, patient_snapshot, pharmacy_snapshot, protocol_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (prescription_tx_id) DO UPDATE SET
        ailment_name = EXCLUDED.ailment_name, assessment_notes = EXCLUDED.assessment_notes,
        selected_rx = EXCLUDED.selected_rx, patient_snapshot = EXCLUDED.patient_snapshot,
        pharmacy_snapshot = EXCLUDED.pharmacy_snapshot, protocol_version = EXCLUDED.protocol_version,
        updated_at = now()
      RETURNING id
    `, [
      a ?? undefined, input.pharmacyId, input.pharmacistId, patientId,
      input.ailmentSlug, input.ailmentName, input.outcome, input.hasRedFlag,
      input.prescriptionTxId ?? null,
      JSON.stringify(input.symptomsChecked), JSON.stringify(input.redFlagsChecked),
      JSON.stringify(input.nonRxChecked), input.assessmentNotes ?? null,
      input.selectedRx ? JSON.stringify(input.selectedRx) : null,
      JSON.stringify(input.patient), JSON.stringify(input.pharmacy),
      input.protocolVersion ?? null,
    ])
    const assessmentId = insertAssessment.rows[0].id

    await client.query(
      `INSERT INTO phi_audit_log (assessment_id, patient_id, pharmacy_id, actor_id, action)
       VALUES ($1,$2,$3,$4,'assessment.created')`,
      [assessmentId, patientId, input.pharmacyId, input.pharmacistId],
    )

    await client.query("COMMIT")
    return { assessmentId }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
```

- [ ] **Step 2: Implement `getAssessment` + `listAssessments` (read paths)**

Both inject `pharmacy_id = $…` and write a `phi_audit_log` `assessment.viewed` row. Skeleton:

```ts
export async function getAssessment(args: {
  assessmentId: string
  pharmacyId: string
  pharmacistId: string
}): Promise<Record<string, unknown> | null> {
  const { rows } = await getPhiPool().query(
    `SELECT * FROM assessment WHERE id = $1 AND pharmacy_id = $2`,
    [args.assessmentId, args.pharmacyId],
  )
  await getPhiPool().query(
    `INSERT INTO phi_audit_log (assessment_id, pharmacy_id, actor_id, action)
     VALUES ($1,$2,$3,'assessment.viewed')`,
    [args.assessmentId, args.pharmacyId, args.pharmacistId],
  )
  return rows[0] ?? null
}

export async function listAssessments(args: {
  pharmacyId: string
  pharmacistId: string
  patientId?: string
  limit?: number
  offset?: number
}) {
  const limit = Math.min(args.limit ?? 50, 200)
  const offset = args.offset ?? 0
  const params = [args.pharmacyId, limit, offset]
  if (args.patientId) params.unshift(args.patientId)
  const where = args.patientId ? `pharmacy_id = $1 AND patient_id = $2` : `pharmacy_id = $1`
  // param indices shift accordingly when patientId present — adjust $2/$3/$4
  return getPhiPool().query(
    `SELECT id, ailment_slug, ailment_name, outcome, has_red_flag, prescription_tx_id, created_at
     FROM assessment WHERE ${where}
     ORDER BY created_at DESC LIMIT $${args.patientId ? 3 : 2} OFFSET $${args.patientId ? 4 : 3}`,
    params,
  ).then(r => r.rows)
}
```

> The read paths exist for future admin/PROM features; they are not wired into a UI in this tier. Implement + unit-test the scoping, leave the UI for #13/#10.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/phi/assessment-store.ts
git commit -m "feat(phi): add pharmacy-scoped assessment store + phi audit writes"
```

---

### Task 6: Non-PHI `assessment.saved` audit event (Supabase)

**Files:**
- Modify: `src/lib/audit-actions.ts`
- Database (Supabase migration): `audit.event_type`, `log_event`

- [ ] **Step 1: Extend the `EventType` union**

In `src/lib/audit-actions.ts` (`audit-actions.ts:5-18`), add `"assessment.saved"`.

```ts
type EventType =
  | "auth.login"
  // ... existing ...
  | "pdf.generated"
  | "export.requested"
  | "assessment.saved"
```

- [ ] **Step 2: Apply the Supabase migration**

```sql
ALTER TYPE audit.event_type ADD VALUE IF NOT EXISTS 'assessment.saved';
```

Extend `audit.log_event` (re-declare the full body from `2026-06-06-audit-log-design.md` "Write Path" plus this branch — preserve all existing per-event checks):

```sql
  -- assessment.saved: require assessment_id + outcome; forbid any patient/clinical key
  IF p_event_type = 'assessment.saved' THEN
    IF (p_metadata->>'assessment_id') IS NULL OR (p_metadata->>'outcome') IS NULL THEN
      RAISE EXCEPTION 'assessment.saved requires assessment_id and outcome';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_metadata) k
      WHERE k LIKE 'patient_%' OR k IN ('ailment','ailment_slug','drug','rx','name','dob','ohip','notes')
    ) THEN
      RAISE EXCEPTION 'assessment.saved metadata must not contain patient/clinical data';
    END IF;
  END IF;
```

- [ ] **Step 3: Verify**

```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'audit.event_type'::regtype AND enumlabel = 'assessment.saved';
```
Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit-actions.ts
git commit -m "feat(audit): add assessment.saved event type (non-PHI)"
```

---

### Task 7: Server action `saveAssessmentAction` (`src/lib/assessment-actions.ts`)

**Files:**
- Create: `src/lib/assessment-actions.ts`

- [ ] **Step 1: Implement the flag-guarded action**

```ts
"use server"

import { requireAuth } from "@/lib/auth-guards"
import { isPhiEnabled } from "@/lib/phi/db"
import { saveAssessment, SaveAssessmentInput } from "@/lib/phi/assessment-store"
import { logAuditEvent } from "@/lib/audit-actions"
import type { AssessmentData, PharmacyDefaults } from "@/types"

export interface SaveAssessmentPayload {
  assessmentData: AssessmentData
  pharmacy: PharmacyDefaults | null
  outcome: SaveAssessmentInput["outcome"]
  assessmentId?: string
  prescriptionTxId?: string
}

export async function saveAssessmentAction(
  payload: SaveAssessmentPayload,
): Promise<{ assessmentId: string | null }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { assessmentId: null }

  // Phase-1 no-op: ship dark until fly.io + BAA are ready.
  if (!isPhiEnabled()) return { assessmentId: null }

  const { assessmentData, pharmacy, outcome, assessmentId, prescriptionTxId } = payload
  const { ailment, patient, redFlagsChecked, hasRedFlag, assessmentNotes, selectedRx } = assessmentData

  const { assessmentId: savedId } = await saveAssessment({
    pharmacistId: profile.id,
    pharmacyId: profile.pharmacyId,
    assessmentId,
    prescriptionTxId,
    outcome,
    hasRedFlag,
    ailmentSlug: ailment.slug,
    ailmentName: ailment.name,
    symptomsChecked: [],                       // threaded from wizard in Task 9 (symptomsChecked lives on WizardContainer)
    redFlagsChecked,
    nonRxChecked: [],                          // threaded from wizard in Task 9
    assessmentNotes,
    selectedRx,
    patient,
    pharmacy: pharmacy ?? {},
  })

  // Non-PHI audit only: { assessment_id, outcome }. No ailment, no patient data.
  await logAuditEvent("assessment.saved", {
    assessment_id: savedId,
    outcome,
  })

  return { assessmentId: savedId }
}
```

> In Task 9 the client threads `symptomsChecked` and `nonRxChecked` through the payload; the skeleton above leaves them empty to keep the action's signature stable while wiring lands.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assessment-actions.ts
git commit -m "feat(assessment): add flag-guarded saveAssessmentAction server action"
```

---

### Task 8: Generate one `assessmentId` per wizard session

**Files:**
- Modify: `src/components/wizard/wizard-container.tsx`

- [ ] **Step 1: Add a session-scoped `assessmentId`**

In `WizardContainer` (`wizard-container.tsx:40-48`), add:

```ts
import { saveAssessmentAction } from "@/lib/assessment-actions"
// ...
const [assessmentId] = useState(() => crypto.randomUUID())
```

Thread `assessmentId` into `<StepGenerate>` (via the `step === 3 && !isReferral` render at `wizard-container.tsx:173-183`) as a new prop, alongside `symptomsChecked` and `nonRxChecked` if not already passed (they currently are not — add them).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/wizard-container.tsx
git commit -m "feat(assessment): generate session assessmentId in wizard"
```

---

### Task 9: Persist on the prescribe path (fail-closed)

**Files:**
- Modify: `src/components/wizard/step-generate.tsx`

- [ ] **Step 1: Persist before producing the PDF**

In `handleDownload` (`step-generate.tsx:26`), after reserving the tx id (`step-generate.tsx:28-34`) and **before** `downloadPdf` (`step-generate.tsx:47`), call:

```ts
const save = await saveAssessmentAction({
  assessmentData: {
    ailment, patient, redFlagsChecked, hasRedFlag: false,
    assessmentNotes, selectedRx, dateOfAssessment,
  },
  pharmacy,
  outcome: "prescribed",
  assessmentId,
  prescriptionTxId: resolvedTxId ?? undefined,
})
// Fail-closed: a real (non-stub) persistence failure blocks the document.
if (isPhiEnabledClientSideHint === false /* stub returns null, allowed */) {
  // no-op during Phase 1
}
```

Because the action is a server action, the client cannot read `isPhiEnabled()`. Treat `{ assessmentId: null }` as the documented Phase-1 no-op and proceed; treat a thrown error as a hard failure — surface a retryable error and **do not** call `downloadPdf`. (During Phase 1 the action never throws.) Thread `symptomsChecked`, `nonRxChecked`, `redFlagsChecked`, and `pharmacy` into `StepGenerate`'s props (extend `StepGenerateProps` at `step-generate.tsx:12-20`) so the payload is complete.

- [ ] **Step 2: Emit `pdf.generated` (closes an existing dead audit event)**

After a successful save + download, call `logAuditEvent` is server-side only; instead, expose a tiny server action `notePdfGenerated(txId)` in `src/lib/assessment-actions.ts` that emits `pdf.generated { tx_id }` (per the existing `audit-log-design.md` contract). Call it after `downloadPdf` resolves.

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/wizard/step-generate.tsx src/lib/assessment-actions.ts
git commit -m "feat(assessment): persist prescribe-path assessment before PDF (fail-closed)"
```

---

### Task 10: Persist on the referral path

**Files:**
- Modify: `src/components/wizard/wizard-container.tsx`

- [ ] **Step 1: Persist in `handleDownloadReferral`**

In `handleDownloadReferral` (`wizard-container.tsx:89`), before `downloadPdf` (`wizard-container.tsx:98`):

```ts
await saveAssessmentAction({
  assessmentData: {
    ailment, patient, redFlagsChecked, hasRedFlag: true,
    assessmentNotes, selectedRx: null, dateOfAssessment: new Date().toLocaleDateString("en-CA"),
  },
  pharmacy,
  outcome: "referred",
  assessmentId,
  // no prescriptionTxId for referrals
})
```

Same fail-closed rule as Task 9: a thrown error blocks the referral download; the Phase-1 stub no-op (`{ assessmentId: null }`) proceeds normally.

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/wizard-container.tsx
git commit -m "feat(assessment): persist referral-path assessment (closes zero-trace gap)"
```

---

### Task 11: Tests

**Files:**
- Create: `src/__tests__/phi-identity.test.ts`
- Create: `src/__tests__/phi-assessment-store.test.ts`
- Create: `src/__tests__/assessment-actions.test.ts`

- [ ] **Step 1: Identity-hash determinism + canonicalisation**

`src/__tests__/phi-identity.test.ts` — assert the same `{name,dob,postalCode}` produces the same hash; that casing/whitespace in name and postal code canonicalise away; that two different patients collide only on identical normalised inputs; that a missing `PHI_IDENTITY_SALT` throws.

- [ ] **Step 2: Store pharmacy-scoping + idempotency**

`src/__tests__/phi-assessment-store.test.ts` — stand up a temporary fly.io test database (or a `pg`-mock that asserts on emitted SQL text). Assert: (a) every `INSERT`/`SELECT` text contains `pharmacy_id`; (b) `saveAssessment` with the same `prescriptionTxId` twice yields one `assessment` row (idempotent) but two `phi_audit_log` rows; (c) `getAssessment` for `pharmacyId: A` cannot read a row saved under `pharmacyId: B`; (d) the three statements run in one transaction (a forced failure mid-way rolls back the patient row too).

- [ ] **Step 3: Action flag-guard + non-PHI audit shape**

`src/__tests__/assessment-actions.test.ts` — mock `requireAuth`, `isPhiEnabled`, `saveAssessment`, `logAuditEvent`. Assert: flag-off returns `{ assessmentId: null }` and calls **neither** `saveAssessment` nor `logAuditEvent`; flag-on calls `saveAssessment` and emits `assessment.saved` with metadata **exactly** `{ assessment_id, outcome }` (no ailment, no patient keys).

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__
git commit -m "test(phi): cover identity hash, store scoping/idempotency, action guard"
```

---

### Task 12: End-to-end verification (staging fly.io dev cluster)

- [ ] **Step 1: Configure staging env**

Set `PHI_PERSIST_ENABLED=true`, `FLY_PHI_DATABASE_URL=<staging fly.io yyz>`, `PHI_IDENTITY_SALT=<staging salt>`. Confirm the fly.io dev cluster has the Task-2 migration applied.

- [ ] **Step 2: Prescribe path**

Log in, open an ailment, complete intake, select an Rx, click Download. Expect: a row in fly.io `assessment` with `outcome='prescribed'`, the reserved `prescription_tx_id`, a matching `patient` row, and a `phi_audit_log` `'assessment.created'` row; a Supabase `assessment.saved` row whose metadata is exactly `{ assessment_id, outcome }`.

- [ ] **Step 3: Referral path**

Open an assessment, check a red flag, reach the referral summary, click Download. Expect: a fly.io `assessment` row with `outcome='referred'`, `has_red_flag=true`, `prescription_tx_id IS NULL` — the today-zero-trace gap is now closed.

- [ ] **Step 4: Re-download idempotency**

On the same prescribe assessment, click Download again. Expect: `assessment.updated_at` advances, no second `assessment` row, a second `phi_audit_log` row; one `assessment.saved` per click is acceptable.

- [ ] **Step 5: Verify no PHI leaked to Supabase**

```sql
SELECT event_type, metadata FROM audit.log WHERE event_type = 'assessment.saved' ORDER BY created_at DESC LIMIT 5;
SELECT event_type, metadata FROM audit.log WHERE event_type = 'pdf.generated' ORDER BY created_at DESC LIMIT 5;
```
Expected: `assessment.saved` metadata = `{ assessment_id, outcome }` only; `pdf.generated` = `{ tx_id }` only. No patient/ailment/drug keys anywhere.

- [ ] **Step 6: Verify cross-pharmacy isolation**

Create a second pharmacy, switch to it (multi-pharmacy switcher), attempt `getAssessment` for the first pharmacy's `assessment_id`. Expect: `null` (no row), and a `phi_audit_log` `'assessment.viewed'` row recording the denied attempt's lookup.

---

## Data / DB changes (summary)

- **fly.io Postgres (PHI, BAA):** `patient`, `assessment`, `phi_audit_log` tables + `phi_compute_chain_hash` trigger + indexes (Task 2). Dedicated least-privilege app role (`cdst_app`): `INSERT`/`SELECT` only, no `UPDATE`/`DELETE`.
- **Supabase (non-PHI):** add `assessment.saved` to `audit.event_type`; extend `log_event` with the `assessment.saved` required-key + PHI-rejection branch (Task 6).
- **Dependencies:** `pg` + `@types/pg` (Task 1).
- **Env (server-only):** `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.

## Verification commands

- Typecheck: `npx tsc --noEmit --pretty`
- Lint: `npm run lint`
- Tests: `npx vitest run`

## Rollout notes

- **Phase 0 (ops — Task 0, the gate):** provision fly.io Postgres in a **Canadian region** (`yyz`/`yul`); **sign the BAA**; generate `PHI_IDENTITY_SALT`; confirm the pooler. `PHI_PERSIST_ENABLED` stays `false`.
- **Phase 1 (code, behind `PHI_PERSIST_ENABLED=false`):** ship Tasks 1–11. `saveAssessmentAction` is a no-op stub; the wizard behaves exactly as today; Supabase receives no new events. This lets the persistence code land, typecheck, and test without waiting on ops.
- **Phase 2 (after Task 0 completes):** apply the fly.io migration (Task 2), flip `PHI_PERSIST_ENABLED=true`, and persistence lights up with no further code change. Run the Task-12 E2E against staging first.
- **Never** put `FLY_PHI_DATABASE_URL` / `PHI_IDENTITY_SALT` in the client bundle (`NEXT_PUBLIC_`); **never** persist patient/ailment/drug data in Supabase; **never** omit `pharmacy_id` from a fly.io query (enforced by the Task-11 store test and the CI grep `rg -n "FROM assessment|INTO assessment|FROM patient" src/lib/phi`).
- **Sequencing with siblings:** this feature is the foundation for #3 (consent attaches a `consent_id` to the assessment), #4 (refusal docs become `outcome:'abandoned'` + structured reasons), #10 (PROM follow-up joins on `patient_id`/`assessment_id`), and tightens #1 (e-fax destination becomes validatable against `assessment.patient_snapshot.doctor_fax`). Build it before those.
