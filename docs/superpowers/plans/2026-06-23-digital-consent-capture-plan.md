# Digital Patient Consent Capture — Implementation Plan

**Date:** 2026-06-23
**Roadmap item:** #3 (NOW tier)
**Companion design:** `docs/superpowers/specs/2026-06-23-digital-consent-capture-design.md`

> **For agentic workers:** Implement task-by-task. Each step is a small, independently verifiable unit. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the hard constraints in the design doc: **all PHI stays on fly.io** (the signature image, the signer identity, the consent decisions); Supabase receives only the non-PHI `consent.captured` audit metadata (`{ consent_id, statement_version, capture_method }`) — never the signature, never the patient name, never the ailment. Do **not** flip `PHI_PERSIST_ENABLED=true` until the fly.io BAA is signed and a Canadian region is confirmed (design §5.2). Until then `saveConsentAction` is a no-op stub, the consent UI still renders and gates the Download button, and the captured signature is baked onto the PDF client-side so the printed document is itself the durable legal artefact.

**Goal:** Capture the patient/SDM's consent (signature or verbal attestation) on a panel at the counter immediately before the prescription/referral PDF is produced, render that signature onto the generated PDF so the artefact is self-contained, and — once roadmap #2's fly.io PHI store is live — persist an immutable, audit-trail-linked consent row that attaches to the assessment via `consent_id`.

**Approach (from the design):** Option A — a `ConsentPanel` co-located with the Download buttons on both terminal wizard steps; a client-only `SignaturePad` (canvas) producing a PNG data URL that is baked into the PDF via `@react-pdf/renderer` `<Image>` and, when fly.io is on, sent to a new `saveConsentAction`; a dedicated `consent` table on fly.io extends #2's schema; a non-PHI `consent.captured` audit event mirrors the `assessment.saved` discipline.

**Dependencies:** roadmap #2 (`persist-assessments-flyio`) must be implemented first — its fly.io `patient`/`assessment`/`phi_audit_log` schema, its `saveAssessmentAction`, and its `PHI_PERSIST_ENABLED` flag are all reused. The #2 plan's Task 7 (`saveAssessmentAction`) gains an optional `consentId` parameter in this plan's Task 7. Tasks 1–6 + 8–10 can be built and merged behind the flag without #2 being live; Task 11 (E2E persistence) requires #2's Phase 2.

**Tech stack:** Next.js 16.2.6 server actions (`"use server"`), React 19, `@react-pdf/renderer ^4.5.1` (client Blob, unchanged), `react-signature-canvas` + `signature_pad` (new, local dep), Supabase (non-PHI audit), `pg` (from #2, for the fly.io write), Vitest + React Testing Library.

---

### Task 1: Consent types + versioned statements

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/lib/consent/statements.ts`

- [ ] **Step 1: Add the consent types**

In `src/types/index.ts` (after `AssessmentData` at `types/index.ts:59-67`), add:

```ts
export type SignerRelationship = "self" | "parent" | "guardian" | "sdm"
export type CaptureMethod = "signature" | "verbal_attested"

export interface ConsentCapture {
  consentToAssess: boolean
  consentToRecord: boolean
  consentToFollowup: boolean
  statementVersion: string
  signerName: string
  signerRelationship: SignerRelationship
  signatureDataUrl: string | null
  captureMethod: CaptureMethod
  capturedAt: string
}
```

- [ ] **Step 2: Create the statements module**

`src/lib/consent/statements.ts` — export `CONSENT_STATEMENT_VERSION = "minor-ailments-v1"`, the `ConsentStatement` interface, the `MINOR_AILMENTS_CONSENT_STATEMENTS` array (three statements per design §4.2: `consent_to_assess`, `consent_to_record`, `consent_to_followup`), the `SDM_ATTESTATION` string, and a `computeStatementHash(statements: ConsentStatement[]): string` helper that returns `sha256(JSON.stringify(statements))` as hex (so the persisted `statement_hash` pins the exact text). Interpolation helpers `renderStatement(body, { pharmacyName, ailmentName })` replace `{{pharmacyName}}`/`{{ailmentName}}`.

> Place statement text in a TS module under `src/lib/consent/` (not `data/`) so the `statement_hash` is reproducible from the build and a deploy is required to change legal text (design §7.7). This is a code file, not data-layer config.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/lib/consent/statements.ts
git commit -m "feat(consent): add ConsentCapture types + versioned statements"
```

---

### Task 2: Signature pad (client-only canvas)

**Files:**
- Modify: `package.json`
- Create: `src/components/consent/signature-pad.tsx`

- [ ] **Step 1: Install the signature library (local scope)**

```bash
npm install react-signature-canvas
```

> Install only into this project (local `package.json`); never globally. `react-signature-canvas` pulls `signature_pad` as a peer; confirm both land in `package.json` dependencies. (Design §4.3 — library-agnostic contract; if SSR resilience is a problem, swap to a direct `signature_pad` integration behind the same `onChange`/`onClear` interface.)

- [ ] **Step 2: Implement the component**

`src/components/consent/signature-pad.tsx` — a `"use client"` component that wraps `react-signature-canvas` in a responsive container with a fixed aspect ratio. Props:

```ts
interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
  ariaLabel?: string
}
```

On every `onEnd` stroke event, read `signaturePad.toData("image/png")` (via `ref.current.toDataURL("image/png")`) and call `onChange(dataUrl)` — or `onChange(null)` when `ref.current.isEmpty()`. A "Clear" button calls `ref.current.clear()` then `onChange(null)`. The canvas uses `width: 100%` with a `minHeight` and a dashed border, and is keyboard-announceable via `aria-label`.

- [ ] **Step 3: Dynamic-import with SSR off**

Because `signature_pad` touches `window`, the `SignaturePad` must be loaded client-only. Export the component from the file, and at every import site use `next/dynamic`:

```ts
import dynamic from "next/dynamic"
const SignaturePad = dynamic(
  () => import("@/components/consent/signature-pad").then(m => m.SignaturePad),
  { ssr: false }
)
```

(Imported this way inside `consent-panel.tsx` in Task 3.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/consent/signature-pad.tsx
git commit -m "feat(consent): add client-only SignaturePad canvas component"
```

---

### Task 3: Consent panel UI

**Files:**
- Create: `src/components/consent/consent-panel.tsx`

- [ ] **Step 1: Implement the panel**

`src/components/consent/consent-panel.tsx` — a `"use client"` component. Props per design §4.4:

```ts
interface ConsentPanelProps {
  ailmentName: string
  pharmacyName: string
  encounterType: string
  value: ConsentCapture | null
  onChange: (c: ConsentCapture | null) => void
}
```

Render:
1. The three statements from `MINOR_AILMENTS_CONSENT_STATEMENTS`, each interpolated with `pharmacyName`/`ailmentName` via `renderStatement`, as `<Checkbox>`es (reuse `src/components/ui/checkbox` as `step-patient.tsx:55` does). Mark the two `required: true` ones with `*`.
2. The `<SignaturePad>` (dynamic import from Task 2), visible only when `captureMethod === "signature"`.
3. A printed-name `<Input>` (`src/components/ui/input`) bound to `signerName`.
4. A `signerRelationship` selector (`self | parent | guardian | sdm`) using the existing checkbox/radio pattern. When `!== "self"`, append the `SDM_ATTESTATION` clause below the statements.
5. A "Capture verbal consent instead" toggle (shown when `encounterType !== "In-Person"`, and available on demand otherwise) that flips `captureMethod` to `"verbal_attested"`, hides the pad, and shows a pharmacist-attestation checkbox: *"I confirm I obtained the patient/SDM's verbal consent."*

- [ ] **Step 2: Emit a valid `ConsentCapture` or `null`**

The panel is the single source of validity. Internal `useEffect` recomputes validity on every change:

```ts
const isValid =
  c.consentToAssess &&
  c.consentToRecord &&
  c.signerName.trim().length > 0 &&
  (c.captureMethod === "verbal_attested" ? c.verbalAttested : !!c.signatureDataUrl)
onChange(isValid ? { ...c, capturedAt: new Date().toISOString() } : null)
```

(Track `verbalAttested` in component state; promote it into `ConsentCapture.captureMethod` semantics — `verbal_attested` implies the attestation was given.)

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/consent/consent-panel.tsx
git commit -m "feat(consent): add ConsentPanel with signature + verbal paths"
```

---

### Task 4: Render consent signature onto the PDFs

**Files:**
- Modify: `src/components/combined-pdf.tsx`
- Modify: `src/components/wizard/referral-pdf.tsx`

- [ ] **Step 1: Extend `CombinedPdfProps`**

In `src/components/combined-pdf.tsx`, extend `CombinedPdfProps` (`combined-pdf.tsx:159-169`) with optional consent fields:

```ts
interface CombinedPdfProps {
  // ...existing props...
  consentSignatureDataUrl?: string | null
  consentSignerName?: string
  consentSignerRelationship?: SignerRelationship
  consentCaptureMethod?: CaptureMethod
  consentStatementVersion?: string
  consentCapturedAt?: string
}
```

- [ ] **Step 2: Render the patient/SDM signature block**

In the signatures section (`combined-pdf.tsx:308-315`), widen `signatureSection`/`signatureBox` (`combined-pdf.tsx:129-141`) to a two-column row. Keep the existing pharmacist block on the left; add a patient/SDM block on the right that renders `<Image src={consentSignatureDataUrl} style={...} />` when present, else a `__________` line. Label it "Patient / SDM Signature" and print `{consentSignerName} ({consentSignerRelationship})`. (The left pharmacist block keeps its current blank-line form; roadmap #11 later replaces it with a stroke image.)

> `@react-pdf/renderer`'s `<Image>` accepts a data-URL `src` natively. Size it to fit the right column (e.g. `width: 120, height: 30`).

- [ ] **Step 3: Extend the PHIPA footer**

In the footer block (`combined-pdf.tsx:318-321`), append a consent attestation line when `consentCaptureMethod` is set:

```tsx
<Text>
  Consent captured {consentCaptureMethod === "verbal_attested" ? "verbally" : "in-person"}
  {" "}on {consentCapturedAt} — statement version {consentStatementVersion}.
  {" "}Signer: {consentSignerName} ({consentSignerRelationship}).
</Text>
```

- [ ] **Step 4: Mirror in `referral-pdf.tsx`**

Apply Steps 1–3 identically to `src/components/wizard/referral-pdf.tsx` (props at the top of the file, signature section at `referral-pdf.tsx:222-228`, footer at `referral-pdf.tsx:231-233`). A referral still discloses PHI to the physician, so the consent block applies.

- [ ] **Step 5: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/combined-pdf.tsx src/components/wizard/referral-pdf.tsx
git commit -m "feat(consent): render patient/SDM signature + attestation on PDFs"
```

---

### Task 5: Consent gate + state in the wizard container

**Files:**
- Modify: `src/components/wizard/wizard-container.tsx`

- [ ] **Step 1: Add consent state**

In `WizardContainer` (`wizard-container.tsx:40-48`), add:

```ts
import { ConsentCapture } from "@/types"
import { ConsentPanel } from "@/components/consent/consent-panel"
// ...
const [consent, setConsent] = useState<ConsentCapture | null>(null)
```

- [ ] **Step 2: Render the panel + gate the referral Download**

In the referral branch (`wizard-container.tsx:142-172`), render `<ConsentPanel>` above the "Download Referral PDF" button (`wizard-container.tsx:167`):

```tsx
<ConsentPanel
  ailmentName={ailment.name}
  pharmacyName={pharmacy?.pharmacyName ?? ""}
  encounterType={patient.encounterType}
  value={consent}
  onChange={setConsent}
/>
<Button variant="destructive" onClick={handleDownloadReferral} disabled={!consent}>
  Download Referral PDF
</Button>
```

`handleDownloadReferral` (`wizard-container.tsx:89-99`) is wired in Task 8 (persistence ordering). For now the gate just disables the button; the handler still produces the PDF.

- [ ] **Step 3: Pass consent through to `StepGenerate`**

In the `step === 3 && !isReferral` render (`wizard-container.tsx:173-183`), pass `consent` + `setConsent` down as new props on `<StepGenerate>`:

```tsx
<StepGenerate
  // ...existing props...
  consent={consent}
  onConsentChange={setConsent}
/>
```

(`StepGenerateProps` is extended in Task 6.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/wizard/wizard-container.tsx
git commit -m "feat(consent): add ConsentPanel + gate to wizard referral branch"
```

---

### Task 6: Consent gate on the prescribe step

**Files:**
- Modify: `src/components/wizard/step-generate.tsx`

- [ ] **Step 1: Extend `StepGenerateProps`**

In `src/components/wizard/step-generate.tsx`, extend `StepGenerateProps` (`step-generate.tsx:12-20`):

```ts
interface StepGenerateProps {
  // ...existing props...
  consent: ConsentCapture | null
  onConsentChange: (c: ConsentCapture | null) => void
}
```

Pull `ailment.name` and `pharmacy?.pharmacyName` from the existing props for the panel.

- [ ] **Step 2: Render the panel + gate the Download button**

Render `<ConsentPanel>` above the Download button (`step-generate.tsx:74-81`):

```tsx
<ConsentPanel
  ailmentName={ailment.name}
  pharmacyName={pharmacy?.pharmacyName ?? ""}
  encounterType={patient.encounterType}
  value={consent}
  onChange={onConsentChange}
/>
<Button onClick={handleDownload} disabled={!consent}>
  Download Prescription + Doctor Notification PDF
</Button>
```

- [ ] **Step 3: Thread consent into the PDF render**

In `handleDownload` (`step-generate.tsx:26-51`), pass the consent fields into `<CombinedPdf>` (`step-generate.tsx:35-45`):

```tsx
<CombinedPdf
  // ...existing props...
  consentSignatureDataUrl={consent?.signatureDataUrl ?? null}
  consentSignerName={consent?.signerName}
  consentSignerRelationship={consent?.signerRelationship}
  consentCaptureMethod={consent?.captureMethod}
  consentStatementVersion={consent?.statementVersion}
  consentCapturedAt={consent?.capturedAt}
/>
```

The persistence calls (Task 8) are inserted before `downloadPdf` (`step-generate.tsx:47`) in Task 8; for now `handleDownload` just renders + downloads as today, with the gate ensuring consent was captured.

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/wizard/step-generate.tsx
git commit -m "feat(consent): gate prescribe Download on ConsentPanel"
```

---

### Task 7: `consent.captured` audit event (non-PHI, Supabase)

**Files:**
- Modify: `src/lib/audit-actions.ts`
- Database (Supabase migration): `audit.event_type`, `log_event`

- [ ] **Step 1: Extend the `EventType` union**

In `src/lib/audit-actions.ts` (`audit-actions.ts:5-18`), add `"consent.captured"`:

```ts
type EventType =
  | "auth.login"
  // ... existing ...
  | "pdf.generated"
  | "export.requested"
  | "consent.captured"
```

- [ ] **Step 2: Apply the Supabase migration**

```sql
ALTER TYPE audit.event_type ADD VALUE IF NOT EXISTS 'consent.captured';
```

Extend `audit.log_event` (re-declare the full body from `2026-06-06-audit-log-design.md` "Write Path" plus this branch — preserve all existing per-event checks, including the `assessment.saved` and `fax.sent` branches added by #2 and #1):

```sql
  -- consent.captured: require consent_id + statement_version + capture_method;
  -- forbid any patient/signature/clinical key
  IF p_event_type = 'consent.captured' THEN
    IF (p_metadata->>'consent_id') IS NULL
       OR (p_metadata->>'statement_version') IS NULL
       OR (p_metadata->>'capture_method') IS NULL THEN
      RAISE EXCEPTION 'consent.captured requires consent_id, statement_version, capture_method';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_metadata) k
      WHERE k LIKE 'patient_%' OR k LIKE 'signer_%'
         OR k IN ('name','dob','ailment','signature','png','image','signer_name')
    ) THEN
      RAISE EXCEPTION 'consent.captured metadata must not contain patient/signature data';
    END IF;
  END IF;
```

- [ ] **Step 3: Verify**

```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'audit.event_type'::regtype AND enumlabel = 'consent.captured';
```
Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit-actions.ts
git commit -m "feat(audit): add consent.captured event type (non-PHI)"
```

---

### Task 8: fly.io `consent` schema + store + server action

> **Dependency:** the live write depends on roadmap #2 (fly.io Postgres provisioned under BAA). Define the schema and the write path now; leave the write stubbed behind `PHI_PERSIST_ENABLED` so the feature ships in Phase 1 and lights up automatically once fly.io exists.

**Files:**
- Database (fly.io, when provisioned): `consent` table, `assessment.consent_id` column
- Create: `src/lib/consent-store.ts`
- Create: `src/lib/consent-actions.ts`
- Modify: `src/lib/assessment-actions.ts` (from #2 — accept `consentId`)

- [ ] **Step 1: Define the migration (apply when fly.io is provisioned)**

```sql
CREATE TABLE consent (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id          uuid NOT NULL,
  pharmacist_id        uuid NOT NULL,
  patient_id           uuid NOT NULL REFERENCES patient(id),
  assessment_id        uuid,
  statement_version    text NOT NULL,
  statement_hash       text NOT NULL,
  consent_to_assess    boolean NOT NULL,
  consent_to_record    boolean NOT NULL,
  consent_to_followup  boolean NOT NULL DEFAULT false,
  signer_name          text NOT NULL,
  signer_relationship  text NOT NULL CHECK (signer_relationship IN ('self','parent','guardian','sdm')),
  capture_method       text NOT NULL CHECK (capture_method IN ('signature','verbal_attested')),
  signature_png        bytea,
  ip_address           inet,
  captured_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  withdrawn_at         timestamptz,
  withdrawn_by         uuid,
  withdrawn_reason     text
);
CREATE INDEX consent_pharmacy_captured ON consent (pharmacy_id, captured_at DESC);
CREATE INDEX consent_patient ON consent (patient_id, captured_at DESC);
CREATE INDEX consent_assessment ON consent (assessment_id) WHERE assessment_id IS NOT NULL;

ALTER TABLE assessment ADD COLUMN consent_id uuid REFERENCES consent(id);
CREATE INDEX assessment_consent ON assessment (consent_id);
```

(App-layer RLS equivalent: scope every read/write by `pharmacy_id` from the verified Supabase JWT, per roadmap §6.2. No `UPDATE`/`DELETE` grants on `consent` for the app role beyond the modelled `withdrawn_*` path.)

- [ ] **Step 2: Implement `consent-store.ts`**

`src/lib/consent-store.ts` — concentrates **all** fly.io `consent` access. `pharmacyId` is derived from `requireAuth()` internally; never a parameter. Every function writes `phi_audit_log`.

```ts
import { getPhiPool } from "@/lib/phi/db"
import { computeIdentityHash } from "@/lib/phi/identity"

export interface SaveConsentInput {
  pharmacistId: string
  pharmacyId: string
  patientIdentity: { name: string; dob: string; postalCode: string }
  assessmentId?: string
  statementVersion: string
  statementHash: string
  consentToAssess: boolean
  consentToRecord: boolean
  consentToFollowup: boolean
  signerName: string
  signerRelationship: "self" | "parent" | "guardian" | "sdm"
  captureMethod: "signature" | "verbal_attested"
  signaturePng: Buffer | null
  ipAddress: string | null
}

export async function saveConsent(input: SaveConsentInput): Promise<{ consentId: string; patientId: string }> {
  const pool = getPhiPool()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // Resolve patient via the same identity_hash as #2 (design §7.3 — shared patient row).
    const identityHash = computeIdentityHash(input.patientIdentity)
    const patientRes = await client.query<{ id: string }>(
      `INSERT INTO patient (pharmacy_id, identity_hash, name, dob, postal_code)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (pharmacy_id, identity_hash) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [input.pharmacyId, identityHash, input.patientIdentity.name, input.patientIdentity.dob, input.patientIdentity.postalCode],
    )
    const patientId = patientRes.rows[0].id

    const consentRes = await client.query<{ id: string }>(
      `INSERT INTO consent (
         pharmacy_id, pharmacist_id, patient_id, assessment_id,
         statement_version, statement_hash,
         consent_to_assess, consent_to_record, consent_to_followup,
         signer_name, signer_relationship, capture_method,
         signature_png, ip_address, captured_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       RETURNING id`,
      [
        input.pharmacyId, input.pharmacistId, patientId, input.assessmentId ?? null,
        input.statementVersion, input.statementHash,
        input.consentToAssess, input.consentToRecord, input.consentToFollowup,
        input.signerName, input.signerRelationship, input.captureMethod,
        input.signaturePng, input.ipAddress,
      ],
    )
    const consentId = consentRes.rows[0].id

    await client.query(
      `INSERT INTO phi_audit_log (consent_id, patient_id, pharmacy_id, actor_id, action, metadata)
       VALUES ($1,$2,$3,$4,'consent.captured', $5)`,
      [consentId, patientId, input.pharmacyId, input.pharmacistId,
       JSON.stringify({ statement_version: input.statementVersion, capture_method: input.captureMethod })],
    )

    await client.query("COMMIT")
    return { consentId, patientId }
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}
```

> If #2 exposes a `resolvePatientId({ pharmacyId, identity })` helper (design §7.3 open question), call it here instead of duplicating the upsert. The duplicated upsert above is the self-contained fallback; the helper is the preferred path once #2 lands it.

- [ ] **Step 3: Implement `consent-actions.ts`**

`src/lib/consent-actions.ts` (`"use server"`) — flag-guarded, server-side re-validating:

```ts
"use server"

import { headers } from "next/headers"
import { requireAuth } from "@/lib/auth-guards"
import { isPhiEnabled } from "@/lib/phi/db"
import { saveConsent } from "@/lib/consent-store"
import { logAuditEvent } from "@/lib/audit-actions"
import { computeStatementHash, MINOR_AILMENTS_CONSENT_STATEMENTS, CONSENT_STATEMENT_VERSION } from "@/lib/consent/statements"
import type { ConsentCapture } from "@/types"

export interface SaveConsentPayload {
  consent: ConsentCapture
  patientIdentity: { name: string; dob: string; postalCode: string }
  assessmentId?: string
}

export async function saveConsentAction(
  payload: SaveConsentPayload,
): Promise<{ consentId: string | null }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { consentId: null }

  // Phase-1 no-op: ship dark until fly.io + BAA are ready.
  if (!isPhiEnabled()) return { consentId: null }

  const { consent, patientIdentity, assessmentId } = payload

  // Server-side re-validation (never trust client booleans for a legal artefact).
  if (!consent.consentToAssess || !consent.consentToRecord) {
    throw new Error("Required consents missing.")
  }
  if (!consent.signerName.trim()) {
    throw new Error("Signer name is required.")
  }
  if (consent.captureMethod === "signature" && !consent.signatureDataUrl) {
    throw new Error("Signature is required for capture_method=signature.")
  }
  if (consent.statementVersion !== CONSENT_STATEMENT_VERSION) {
    throw new Error("Consent statement version mismatch.")
  }

  // Decode the data URL to a Buffer for bytea storage. PHI: fly.io only.
  const signaturePng =
    consent.captureMethod === "signature" && consent.signatureDataUrl
      ? Buffer.from(consent.signatureDataUrl.split(",")[1] ?? "", "base64")
      : null
  if (signaturePng && signaturePng.length > 200 * 1024) {
    throw new Error("Signature payload too large.")
  }

  const headerPayload = headers().get("x-forwarded-for")
  const ipAddress = headerPayload?.split(",")[0]?.trim() ?? null

  const statementHash = computeStatementHash(MINOR_AILMENTS_CONSENT_STATEMENTS)

  const { consentId } = await saveConsent({
    pharmacistId: profile.id,
    pharmacyId: profile.pharmacyId,
    patientIdentity,
    assessmentId,
    statementVersion: consent.statementVersion,
    statementHash,
    consentToAssess: consent.consentToAssess,
    consentToRecord: consent.consentToRecord,
    consentToFollowup: consent.consentToFollowup,
    signerName: consent.signerName,
    signerRelationship: consent.signerRelationship,
    captureMethod: consent.captureMethod,
    signaturePng,
    ipAddress,
  })

  // Non-PHI audit only: { consent_id, statement_version, capture_method }.
  await logAuditEvent("consent.captured", {
    consent_id: consentId,
    statement_version: consent.statementVersion,
    capture_method: consent.captureMethod,
  })

  return { consentId }
}
```

- [ ] **Step 4: Accept `consentId` on `saveAssessmentAction` (#2)**

In `src/lib/assessment-actions.ts` (from #2 plan Task 7), add an optional `consentId?: string` to the payload and pass it into `saveAssessment({ ..., consentId })`, which sets `assessment.consent_id`. #2's `SaveAssessmentInput` and its `INSERT INTO assessment` accordingly gain a `consent_id` column write. (This is the only change #3 makes to a #2 file; coordinate so the #2 plan's Task 5 `INSERT` already reserves the column, or add it here.)

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit --pretty
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/consent-store.ts src/lib/consent-actions.ts src/lib/assessment-actions.ts
git commit -m "feat(consent): add fly.io consent schema + flag-guarded saveConsentAction"
```

---

### Task 9: Wire the persist ordering (consent → assessment → download)

**Files:**
- Modify: `src/components/wizard/step-generate.tsx`
- Modify: `src/components/wizard/wizard-container.tsx`

- [ ] **Step 1: Prescribe path ordering**

In `handleDownload` (`step-generate.tsx:26-51`), after the tx id is reserved (`step-generate.tsx:28-34`) and **before** `downloadPdf` (`step-generate.tsx:47`), insert:

```ts
// 1. Consent first (authorises the act of recording).
const consentRes = await saveConsentAction({
  consent: consent!,
  patientIdentity: { name: patient.name, dob: patient.dob, postalCode: patient.postalCode },
  assessmentId,
})

// 2. Assessment with consent_id threaded in (from #2's saveAssessmentAction).
await saveAssessmentAction({
  // ...existing payload...
  consentId: consentRes.consentId ?? undefined,
  outcome: "prescribed",
})

// 3. Then the document. Fail-closed: a thrown error above blocks the download.
```

Imports: `saveConsentAction` from `@/lib/consent-actions`, `saveAssessmentAction` from `@/lib/assessment-actions`. A thrown error from either action surfaces a retryable error and **does not** call `downloadPdf`. (During Phase 1 both actions return `{ ...: null }` and proceed normally.) `assessmentId` is the client-generated UUID from #2's Task 8.

- [ ] **Step 2: Referral path ordering**

In `handleDownloadReferral` (`wizard-container.tsx:89-99`), insert the same two calls before `downloadPdf` (`wizard-container.tsx:98`) with `outcome: "referred"` and no `prescriptionTxId`.

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/wizard/step-generate.tsx src/components/wizard/wizard-container.tsx
git commit -m "feat(consent): persist consent before assessment before PDF (fail-closed)"
```

---

### Task 10: Tests

**Files:**
- Create: `src/__tests__/consent-panel.test.tsx`
- Create: `src/__tests__/consent-actions.test.ts`
- Create: `src/__tests__/consent-store.test.ts`

- [ ] **Step 1: Panel validity logic**

`src/__tests__/consent-panel.test.tsx` — render `<ConsentPanel>` with React Testing Library. Assert: with both required checkboxes unchecked, `onChange` receives `null`; checking only `consent_to_assess` still yields `null`; checking both required + entering a name + a non-empty signature yields a valid `ConsentCapture` with `captureMethod: "signature"`; switching to verbal attestation hides the pad and yields validity without a signature; `signerRelationship !== "self"` surfaces the SDM attestation clause. Mock the dynamic `SignaturePad` to avoid canvas SSR in jsdom.

- [ ] **Step 2: Action flag-guard + non-PHI audit shape**

`src/__tests__/consent-actions.test.ts` — mock `requireAuth`, `isPhiEnabled`, `saveConsent`, `logAuditEvent`. Assert: flag-off returns `{ consentId: null }` and calls **neither** `saveConsent` nor `logAuditEvent`; flag-on with a missing required consent **throws** (server re-validation); flag-on with a valid payload calls `saveConsent` and emits `consent.captured` with metadata **exactly** `{ consent_id, statement_version, capture_method }` (no `signature`, no `signer_name`, no patient keys). Assert the signature data URL is decoded to a `Buffer` and capped at 200 KB.

- [ ] **Step 3: Store pharmacy-scoping**

`src/__tests__/consent-store.test.ts` — stand up a `pg`-mock that asserts on emitted SQL text. Assert: (a) every `INSERT`/`SELECT` on `consent` contains `pharmacy_id`; (b) the patient upsert + consent insert + audit insert run in one transaction (a forced failure mid-way rolls back all three); (c) `signature_png` is written as a `bytea` parameter, never interpolated into SQL text; (d) `saveConsent` for `pharmacyId: A` cannot read or write a row under `pharmacyId: B` (the `WHERE pharmacy_id = $…` discipline).

- [ ] **Step 4: Run tests**

```bash
npx vitest run
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/__tests__
git commit -m "test(consent): cover panel validity, action guard + audit shape, store scoping"
```

---

### Task 11: End-to-end verification (staging fly.io dev cluster)

> Requires #2's Phase 2 (fly.io provisioned, BAA signed, `PHI_PERSIST_ENABLED=true`).

- [ ] **Step 1: Configure staging env**

Confirm `PHI_PERSIST_ENABLED=true`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT` are set (from #2) and the fly.io dev cluster has both the #2 migration and the Task-8 `consent` migration applied.

- [ ] **Step 2: Prescribe path with signature**

Log in, open an ailment, complete intake (In-Person), select an Rx, reach the generate step. On the `ConsentPanel`: check both required statements, enter the patient's printed name, draw a signature. Expect: the Download button enables; on click, a row appears in fly.io `consent` (`capture_method='signature'`, non-null `signature_png`, `signer_relationship='self'`), a `phi_audit_log` `'consent.captured'` row, the linked `assessment.consent_id` is set, and the downloaded PDF shows the patient signature image + the attestation footer.

- [ ] **Step 3: SDM (minor) path**

Set `signerRelationship` to `parent`, enter the parent's name, have the parent sign. Expect: the PDF shows "Signer: {parent} (parent)" with the SDM attestation clause appended; the `consent` row records the relationship.

- [ ] **Step 4: Virtual encounter + verbal attestation**

Set `encounterType` to `Virtual` on step 0. Expect: the panel defaults to verbal attestation (pad hidden); the pharmacist attestation checkbox is shown; the PDF footer reads "Consent captured verbally"; the `consent` row has `signature_png IS NULL`, `capture_method='verbal_attested'`.

- [ ] **Step 5: Referral path**

Check a red flag, reach the referral summary, complete the consent panel, download. Expect: a `consent` row + a `phi_audit_log` row, `assessment.consent_id` set on the `outcome='referred'` assessment (the today-zero-trace referral from #2 now also carries consent).

- [ ] **Step 6: Declined required consent**

Uncheck `consent_to_record`. Expect: the Download button is disabled on both terminal steps; no document can be produced; no `consent` or `assessment` row is written.

- [ ] **Step 7: Follow-up opt-out**

Leave `consent_to_followup` unchecked. Expect: the `consent` row has `consent_to_followup=false` (this is the flag roadmap #10 keys off to skip the patient's PROM SMS).

- [ ] **Step 8: Verify no PHI leaked to Supabase**

```sql
SELECT event_type, metadata FROM audit.log WHERE event_type = 'consent.captured' ORDER BY created_at DESC LIMIT 5;
```
Expected: metadata = `{ consent_id, statement_version, capture_method }` only. No signature, no signer name, no patient data anywhere.

- [ ] **Step 9: Verify cross-pharmacy isolation**

Switch to a second pharmacy (multi-pharmacy switcher); attempt to read the first pharmacy's `consent_id` via the store. Expect: `null` (no row), enforced by the `WHERE pharmacy_id = $…` discipline and covered by the Task-10 store test.

---

## Data / DB changes (summary)

- **fly.io Postgres (PHI, BAA):** `consent` table + `assessment.consent_id` column + indexes (Task 8, Step 1). Dedicated least-privilege app role (from #2): `INSERT`/`SELECT` only on `consent`; the `withdrawn_*` columns are the only modelled mutable path.
- **Supabase (non-PHI):** add `consent.captured` to `audit.event_type`; extend `log_event` with the `consent.captured` required-key + PHI/signature-rejection branch (Task 7).
- **Dependencies:** `react-signature-canvas` (+ peer `signature_pad`) — Task 2. Reuses `pg` from #2.
- **Env (server-only):** none new — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.

## Verification commands

- Typecheck: `npx tsc --noEmit --pretty`
- Lint: `npm run lint`
- Tests: `npx vitest run`
- CI grep (scoping discipline): `rg -n "FROM consent|INTO consent" src/lib/consent` — every match must contain `pharmacy_id`.

## Rollout notes

- **Phase 0 (ops — inherited from #2):** fly.io Postgres in a Canadian region (`yyz`/`yul`); BAA signed; `PHI_IDENTITY_SALT` set. `PHI_PERSIST_ENABLED` stays `false` until then.
- **Phase 1 (code, behind `PHI_PERSIST_ENABLED=false`):** ship Tasks 1–7 + 9–10. The `ConsentPanel` renders, gates the Download buttons, and the captured signature is baked onto the PDF client-side — so the printed/e-faxed document is a complete legal artefact **even with no DB row**. `saveConsentAction` is a no-op stub; Supabase receives no new events. This lets the consent UX land, typecheck, and test without waiting on ops, and independently of #2's persistence going live.
- **Phase 2 (after #2's Phase 2):** apply the `consent` migration on fly.io (Task 8 Step 1) and `PHI_PERSIST_ENABLED=true` lights up both #2 and #3 automatically. Run the Task-11 E2E against staging first.
- **Never** put the signature data URL or signer name in the Supabase audit metadata; **never** omit `pharmacy_id` from a fly.io `consent` query (enforced by the Task-10 store test and the CI grep); **never** render a document without a captured consent (fail-closed gate on both terminal steps).
- **Sequencing with siblings:** depends on #2 (`saveAssessmentAction`, `patient`/`assessment`/`phi_audit_log` schema, `PHI_PERSIST_ENABLED`, `resolvePatientId`). Unblocks #10 (reads `consent.consent_to_followup`), #4 (reuses the `ConsentPanel` for the refusal/abandon branch), and reserves the PDF signature-block layout for #11 (pharmacist e-signature). Legal review of `src/lib/consent/statements.ts` (design §7.7) is a soft gate before production rollout.
