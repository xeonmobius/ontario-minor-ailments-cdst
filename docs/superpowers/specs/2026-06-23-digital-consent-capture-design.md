# Digital Patient Consent Capture — Design

**Date:** 2026-06-23
**Roadmap item:** #3 (NOW tier) — "Digital patient consent capture (signature)"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST lets an Ontario pharmacist assess and prescribe for 19 minor ailments under **O. Reg. 256/24**, generates a combined prescription + physician-notification PDF, and — after roadmap #2 ships — persists the assessment to a PHI store. What it does **not** do today is capture the patient's (or their substitute decision-maker's) **consent** to any of it. There is no consent field on `PatientInfo` (`src/types/index.ts:18-37`), no consent field on `AssessmentData` (`src/types/index.ts:59-67`), no consent event in the audit union (`src/lib/audit-actions.ts:5-18`), and no consent UI anywhere in the 4-step wizard. The closest thing in the codebase is a *pharmacist* signature line on the generated PDF (`src/components/combined-pdf.tsx:309-315`, `src/components/wizard/referral-pdf.tsx:222-228`) and a PHIPA confidentiality footer (`combined-pdf.tsx:319`, `referral-pdf.tsx:232`) — both of which document the *pharmacist's* act, not the *patient's* authorisation.

This is a PHIPA and professional-liability gap. Under the **Personal Health Information Protection Act** (PHIPA s.20–21), a pharmacy as a health-information custodian must have a lawful basis to collect, use, and retain a patient's PHI; expressed consent at the point of collection is the cleanest basis and the one an Ontario College of Pharmacists inspector will look for first. Under the **Health Care Consent Act, 1996** (HCCA) and O. Reg. 256/24, the pharmacist must also hold consent to provide the minor-ailments assessment and treatment, including the authority to prescribe. For patients who lack capacity (minors, incapacitated adults), consent must be obtained from a **substitute decision-maker (SDM)** under the HCCA hierarchy. Today none of this is captured digitally: a pharmacist either relies on implied consent with no artefact, or on a paper form that is never linked to the assessment record the CDST keeps.

**The goal of this feature** is to capture the patient/SDM's consent **digitally, at the counter, immediately before the document is produced**, render that consent (including the signature) onto the generated PDF so the printed/e-faxed artefact is self-contained and print-ready, and — once roadmap #2's fly.io PHI store is live — persist an immutable, audit-trail-linked consent record that attaches to the assessment via a `consent_id`. It is the compliance companion to #2: where #2 ensures the *assessment* is retained, #3 ensures the *authorisation to retain and to treat* is retained alongside it, and is referenced by name in the roadmap's PHIPA control matrix (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §6.3, "Consent" row) and in the #2 design itself (§5.2: *"the digital-consent feature (#3) will attach a `consent_id` to each assessment when it ships"*).

**Out of scope** (per roadmap §3 and §6): re-consent workflows for changing the treatment plan mid-stream, consent withdrawal/management UI (modelled in the schema but not built in NOW — see §6, Edge cases), longitudinal consent across visits (each assessment captures its own consent), pharmacist e-signature (#11, a separate NOW-tier feature — #3 reserves the signature-block layout space for it but does not implement the pharmacist's signature capture), and any consent-to-bill / consent-to-insure flow (billing is owned by the PMS per roadmap §3). Allergy/interaction/pregnancy safety logic remains PMS-owned and out of scope.

---

## 2. Current State (what exists in code)

### 2.1 No consent anywhere

A `rg` for `consent|Consent` across `src/` returns only the PHIPA footer text on the two PDF components (`combined-pdf.tsx:319`, `referral-pdf.tsx:232`) and unrelated style names. There is:

- **No consent field** on `PatientInfo` (`types/index.ts:18-37`) or `AssessmentData` (`types/index.ts:59-67`).
- **No consent UI** in the wizard. The wizard is a 4-step flow (`src/components/wizard/wizard-container.tsx:40`, `step` state 0→3) with no consent step and no consent panel.
- **No consent audit event** in the `EventType` union (`audit-actions.ts:5-18`) or in the `audit.event_type` enum (`docs/superpowers/specs/2026-06-06-audit-log-design.md` "Events" table).
- **No consent table** on Supabase or (per roadmap #2's spec) on fly.io. The #2 design's `assessment` table (`2026-06-23-persist-assessments-flyio-design.md` §4.3) has **no `consent_id` column** — #3 must add it.

### 2.2 The two terminal flows where consent must be captured

1. **Prescribe path** — `StepGenerate` (`src/components/wizard/step-generate.tsx:22`). On download (`step-generate.tsx:26`), it reserves a tx id (`step-generate.tsx:28-34`, via `reserveTxId()` in `src/lib/prescription-actions.ts:6`), renders `<CombinedPdf>` (`step-generate.tsx:35-45`), and downloads (`step-generate.tsx:47`). The Download button lives at `step-generate.tsx:74-81`. **This is the natural gate** for consent: the patient signs immediately before the document is produced.
2. **Referral path** — the `isReferral` branch of the wizard (`wizard-container.tsx:142-172`), with the "Download Referral PDF" button at `wizard-container.tsx:167` backed by `handleDownloadReferral()` (`wizard-container.tsx:89-99`). A referral is still a clinical act that discloses PHI to the patient's family physician (`referral-pdf.tsx` carries patient name, DOB, red flags), so consent — at minimum consent to record and to disclose to the physician — applies here too.

### 2.3 PDF generation is client-side (signature can ride the same path)

Per the #1 e-fax design (and verifiable in `src/lib/pdf-helpers.ts:5`), PDFs are rendered entirely in the browser with `pdf(document).toBlob()`. The two document components, `<CombinedPdf>` and `<ReferralPdf>`, already accept rich props (`CombinedPdfProps` at `combined-pdf.tsx:159-169`) and already render a pharmacist signature block + PHIPA footer (`combined-pdf.tsx:308-321`, `referral-pdf.tsx:222-232`). This means a captured signature (a PNG data URL produced by a canvas pad) can be threaded into the same client-side render path and baked into the PDF with **no server round-trip** — the signature never has to leave the browser to appear on the printed document. (Persistence to fly.io is a *separate*, additive concern handled behind a flag in §4.5.)

### 2.4 Encounter type already implies capture method

`PatientInfo.encounterType` (`types/index.ts:34`) is one of `In-Person | Virtual | Phone`, captured on step 0 (`step-patient.tsx:86-103`). This already tells us whether a tablet signature is physically possible (In-Person) or whether a verbal-attested fallback is required (Virtual/Phone). The consent UI adapts to it (§4.4, §6).

### 2.5 The persistence + audit foundation (#2) is specified but not shipped

Roadmap #2's design (`2026-06-23-persist-assessments-flyio-design.md`) specifies the fly.io PHI store this feature depends on: the `patient` table (§4.3), the `assessment` table (§4.3, which #3 extends with `consent_id`), the hash-chained `phi_audit_log` (§4.4), the flag-guarded `pg.Pool` (`src/lib/phi/db.ts`, #2 plan Task 3), and the `saveAssessmentAction` server action (#2 plan Task 7) which #3 will thread a `consentId` into. fly.io is **not yet provisioned** and the **BAA is not yet signed** (roadmap §7 open questions #1, #2) — so, exactly as #1 and #2 do, #3 ships dark behind `PHI_PERSIST_ENABLED`: the signature-pad UI and the on-PDF signature render in Phase 1 (the printed PDF is itself the durable legal artefact), and the fly.io consent row + `consent.captured` events light up automatically in Phase 2 with no further code change.

### 2.6 Identity and scoping primitives already exist

`requireAuth()` (`src/lib/auth-guards.ts:44`) returns the pharmacist's `{ id, pharmacyId, activeRole, ... }`. `id` is the witnessing pharmacist (the actor who captured the consent); `pharmacyId` is the scoping key roadmap §6.2 requires for every fly.io row. These are exactly the ownership/witness fields a consent record needs.

---

## 3. Approach (options + recommendation)

The design hinges on five decisions: (a) the signature capture UX, (b) where in the wizard the consent gate sits, (c) the granularity of consent (one bundled statement vs. separate opt-ins), (d) the transport of the signature bytes, and (e) where the consent record lives. Options are evaluated against roadmap §6.2 (PHI on fly.io, Supabase = auth + non-PHI) and §6.4 (the partitioning rule), and against the professional reality of an Ontario pharmacy counter (2–3 minute consult, tablet at the counter, patient may be a minor or lack capacity).

### Option A — Signature-pad panel gating the terminal step, three-part consent, PNG data URL → PDF + fly.io (RECOMMENDED)

Add a **`ConsentPanel`** rendered directly above the Download button on both terminal screens (`step-generate.tsx:74` and the referral branch `wizard-container.tsx:167`). The panel presents three consent statements sourced from a versioned `src/lib/consent/statements.ts` module (see §4.2):

1. **`consent_to_assess`** (required) — consent to the minor-ailments assessment and, if appropriate, prescribing under O. Reg. 256/24.
2. **`consent_to_record`** (required) — PHIPA consent to collect/use/retain PHI for this assessment and the pharmacy record.
3. **`consent_to_followup`** (optional opt-in) — consent to be contacted for follow-up about the outcome; this is the opt-in that roadmap #10 (PROM follow-up pipeline) keys off.

The signer is captured via an HTML5 `<canvas>` signature pad (a client-only dynamically-imported wrapper around `signature_pad`, e.g. `react-signature-canvas`). The canvas produces a PNG **data URL** that is (a) threaded as a new prop into `<CombinedPdf>` / `<ReferralPdf>` and baked into the PDF via `@react-pdf/renderer`'s `<Image>` (no server round-trip), and (b) when fly.io is enabled, sent to a new `saveConsentAction` server action that writes an immutable `consent` row + a `phi_audit_log` row, returning a `consent_id` that is then threaded into `saveAssessmentAction` so the assessment row's `consent_id` is set. A signer-relationship selector (`self | parent | guardian | sdm`) plus a printed-name field handles SDM consent under the HCCA. The Download button is **disabled** until the two required consents are checked, the printed name is non-empty, and the signature is non-blank — a fail-closed gate guaranteeing no document is produced without a captured authorisation.

- **Pros:** Mirrors how paper consent works today at the counter, so staff retraining is trivial. The signature lands on the PDF, so the printed/e-faxed artefact is self-contained and court/college-defensible **even before fly.io exists** (Phase 1). The three-part split cleanly separates PHIPA-record consent from HCCA-treatment consent, and the opt-in #3c unlocks roadmap #10 without re-prompting. The data-URL transport reuses the existing client-side PDF pipeline (no new server transport in Phase 1) and never touches Supabase. Sibling-friendly: #11 (pharmacist e-sig) extends the same two-column signature block; #4 (refusal docs) reuses the consent panel for the referral/abandon branch; #10 reads `consent.consent_to_followup` to decide whether to send the SMS.
- **Cons:** Adds a client dependency (`react-signature-canvas` / `signature_pad`) and a canvas that must be resilient to Next.js SSR (mitigated by `next/dynamic` with `ssr: false`). Touch-screen hardware quality varies at independent pharmacies (mitigated by the verbal-attested fallback in §4.4). Like #2, persistence is app-layer-scoped not RLS, and the BAA is a hard gate.

### Option B — Typed-name + checkbox only (no signature)

Same three-part consent statements and same gate, but the "signature" is the patient typing their name into a box plus checking a checkbox attesting *"typing my name constitutes my signature."* This is the e-signature model under the Ontario *Electronic Commerce Act, 2000* (which gives electronic signatures legal force) but is weaker evidence of identity than a biometric stroke capture.

- **Pros:** Zero new dependencies; trivially accessible (motor-impairment friendly); works on virtual/phone without a fallback path.
- **Cons:** Weak. A typed name is trivially spoofable and provides poor evidence of the *act* of signing; an inspector or a college complaint would give it less weight than a captured stroke. PharmAssess and MAPflow both capture stroke signatures, so this also concedes a competitive point the roadmap §4 wedge depends on. Does not satisfy the roadmap's explicit "(signature)" annotation on item #3.
- **Rejected** as the primary path; retained as the **accessibility fallback** that Option A falls back to (§4.4) rather than as the default.

### Option C — Dedicated consent step (step 3.5) before document generation

Insert consent as its own numbered wizard step between step 2 (Rx selection) and step 3 (generate/referral), updating the `StepIndicator` (`wizard-nav.tsx`) and the `step` state machine (`wizard-container.tsx:41`).

- **Pros:** Maximum visual salience; consent gets its own screen and its own step in the progress indicator; clean separation from the generate UI.
- **Cons:** Slows the consult (an extra navigation and a full-screen switch) when the roadmap §4 wedge is explicitly *counter speed* (3-minute consult target). Adds state-machine churn (the `canNext` logic at `wizard-container.tsx:52-59` and the referral jump at `wizard-container.tsx:84-87` both need rework). Consent is naturally a *gate on the act of producing the document*, not a separate clinical step like screening or Rx selection — semantically it belongs adjacent to the Download button, not between Rx and generate.
- **Rejected** for NOW; revisit if user testing shows pharmacists miss the panel co-located with the Download button.

### Recommendation

**Option A.** It is the faithful implementation of the roadmap (explicit "signature" + PHIPA control matrix "Consent" row), the smallest change that produces a self-contained legal artefact on the PDF in Phase 1, and the three-part consent model is the foundation #10 (follow-up opt-in), #4 (refusal/abandon consent), and #11 (pharmacist e-sig layout) extend rather than rework. The signature-pad dependency and SSR concern are well-trodden problems with standard solutions (§4.3).

---

## 4. Components & Data Model

### 4.1 New wizard prop plumbing

`WizardContainer` (`wizard-container.tsx:40`) gains a consent state object and threads the resulting `signatureDataUrl` + `consentId` into both terminal children:

```ts
// wizard-container.tsx — new state alongside the existing useState block (:42-48)
const [consent, setConsent] = useState<ConsentCapture | null>(null)
```

`ConsentCapture` (new type in `src/types/index.ts`) is the client-side shape carried through to the PDF render and the server action:

```ts
export type SignerRelationship = "self" | "parent" | "guardian" | "sdm"
export type CaptureMethod = "signature" | "verbal_attested"

export interface ConsentCapture {
  consentToAssess: boolean        // required (HCCA / O. Reg. 256/24)
  consentToRecord: boolean        // required (PHIPA s.20-21)
  consentToFollowup: boolean      // optional opt-in (feeds roadmap #10)
  statementVersion: string        // e.g. "minor-ailments-v1" (governance, mirrors #2 protocol_version)
  signerName: string              // printed name of the signer (patient or SDM)
  signerRelationship: SignerRelationship
  signatureDataUrl: string | null // PNG data URL from the canvas; null when verbal_attested
  captureMethod: CaptureMethod
  capturedAt: string              // ISO timestamp set at the moment of gate-pass
}
```

### 4.2 Versioned consent statements (`src/lib/consent/statements.ts`, new)

Consent text is legal content that will change; it is versioned the same way #2 versions `protocol_version`. A TS module (not `data/` — see §7.6) exports the current statement set + a `statementVersion` constant + a content hash, so the persisted consent row records *exactly which text the patient signed*:

```ts
export const CONSENT_STATEMENT_VERSION = "minor-ailments-v1"

export interface ConsentStatement {
  key: "consent_to_assess" | "consent_to_record" | "consent_to_followup"
  label: string         // checkbox label (short)
  body: string          // full statement text (rendered expanded; also baked onto the PDF)
  required: boolean
}

export const MINOR_AILMENTS_CONSENT_STATEMENTS: ConsentStatement[] = [
  {
    key: "consent_to_assess",
    label: "Consent to assess and prescribe",
    required: true,
    body: "I consent to the pharmacist at {{pharmacyName}} assessing me for {{ailmentName}} and, if clinically appropriate, prescribing a treatment under Ontario Regulation 256/24 (Designated Minor Ailments) under the Pharmacy Act.",
  },
  {
    key: "consent_to_record",
    label: "Consent to record my health information (PHIPA)",
    required: true,
    body: "I consent to the pharmacy collecting, using, and retaining my personal health information for the purpose of this minor ailment assessment and my pharmacy record, in accordance with the Personal Health Information Protection Act, 2004 (PHIPA).",
  },
  {
    key: "consent_to_followup",
    label: "Optional: contact me for follow-up",
    required: false,
    body: "I agree that the pharmacy may contact me (by text message or email) to follow up on the outcome of this assessment. I understand this is optional and refusing will not affect my care.",
  },
]

// SDM attestation clause appended when signerRelationship !== "self"
export const SDM_ATTESTATION =
  "I confirm that I am the parent, guardian, or substitute decision-maker of the above-named patient and that I am legally authorized to give this consent under the Health Care Consent Act, 1996."
```

`{{pharmacyName}}` / `{{ailmentName}}` are interpolated at render time from the wizard's existing props (`pharmacy.pharmacyName`, `ailment.name`).

### 4.3 Signature capture (`src/components/consent/signature-pad.tsx`, new)

A client-only component (dynamically imported with `next/dynamic`, `{ ssr: false }`, because `signature_pad` touches `window` and Next.js 16 renders server-side by default). Wraps `react-signature-canvas` (a thin, maintained wrapper around `signature_pad`). Exposes:

- `onChange(dataUrl: string | null)` — emits a PNG data URL on every stroke end; `null` when the canvas is cleared/blank (determined by `signaturePad.isEmpty()`).
- `onClear()` — clears the canvas.
- Props for `aria-label`, width, height, and a `disabled` state.

Blank-canvas detection (`signaturePad.isEmpty()`) is the validity check: a "signature" of zero points does not satisfy the gate. The data URL is JPEG/PNG from `canvas.toDataURL("image/png")` — typically 5–30 KB, well under any transport limit.

> **Library choice:** `react-signature-canvas` (+ its peer `signature_pad`) is the canonical React wrapper, MIT-licensed, and is added as a **local** project dependency (`package.json`), never global (per the user's standing preference). If bundle size or SSR resilience is a concern, a direct `signature_pad` integration is the fallback; the `onChange`/`onClear` contract above is library-agnostic.

### 4.4 Consent panel (`src/components/consent/consent-panel.tsx`, new)

Renders the three statements from §4.2 as checkboxes (the two required ones marked `*`), the `<SignaturePad>`, the printed-name `<Input>`, the `SignerRelationship` selector, and — when `patient.encounterType !== "In-Person"` — a "Capture verbal consent instead" toggle that switches `captureMethod` to `"verbal_attested"` and hides the canvas (replacing it with a pharmacist-attestation checkbox: *"I confirm I obtained the patient/SDM's verbal consent."*). Exposes:

```ts
interface ConsentPanelProps {
  ailmentName: string
  pharmacyName: string
  encounterType: string                  // drives default capture method
  value: ConsentCapture | null
  onChange: (c: ConsentCapture | null) => void
}
```

The panel computes its own validity and surfaces it via `onChange` (a `null` value means "not yet validly captured"). It is the single source of truth the terminal steps read to enable/disable their Download buttons.

### 4.5 Consent persistence (`src/lib/consent-store.ts`, new on fly.io; `src/lib/consent-actions.ts`, new server action)

Mirrors the #2 `assessment-store.ts` discipline: this module is the **only** place that touches fly.io `consent`. `pharmacyId` is derived from `requireAuth()` and injected into every query — never accepted from a caller. Every function writes a `phi_audit_log` row.

**Schema (fly.io Postgres — PHI, under BAA).** Extends the #2 schema (`2026-06-23-persist-assessments-flyio-design.md` §4.3/§4.4) with a `consent` table and a `consent_id` column on `assessment`:

```sql
-- consent: the patient/SDM authorisation captured for an assessment (PHI).
CREATE TABLE consent (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- consent_id; the cross-feature key
  pharmacy_id          uuid NOT NULL,
  pharmacist_id        uuid NOT NULL,             -- witnessing/capturing pharmacist (actor)
  patient_id           uuid NOT NULL REFERENCES patient(id),
  assessment_id        uuid,                      -- set when the assessment is saved (nullable during the brief window before saveAssessment runs)
  statement_version    text NOT NULL,             -- matches CONSENT_STATEMENT_VERSION
  statement_hash       text NOT NULL,             -- sha256 of the exact statement text signed
  consent_to_assess    boolean NOT NULL,
  consent_to_record    boolean NOT NULL,
  consent_to_followup  boolean NOT NULL DEFAULT false,
  signer_name          text NOT NULL,
  signer_relationship  text NOT NULL CHECK (signer_relationship IN ('self','parent','guardian','sdm')),
  capture_method       text NOT NULL CHECK (capture_method IN ('signature','verbal_attested')),
  signature_png        bytea,                     -- PHI: the stroke image. NULL when verbal_attested.
  ip_address           inet,                      -- PII under PIPEDA; truncated to /24 after 90 days (audit-log-design.md §Retention)
  captured_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Withdrawal lifecycle (out of scope to BUILD in NOW, but modelled so the schema does not preclude it):
  withdrawn_at         timestamptz,
  withdrawn_by         uuid,
  withdrawn_reason     text
);
CREATE INDEX consent_pharmacy_captured ON consent (pharmacy_id, captured_at DESC);
CREATE INDEX consent_patient ON consent (patient_id, captured_at DESC);
CREATE INDEX consent_assessment ON consent (assessment_id) WHERE assessment_id IS NOT NULL;

-- Link the assessment to its consent (#2 design §4.3 assessment table gains this column):
ALTER TABLE assessment ADD COLUMN consent_id uuid REFERENCES consent(id);
CREATE INDEX assessment_consent ON assessment (consent_id);
```

> `signature_png` is stored as `bytea`. The PNG identifies the patient (it is their stroke), so it is PHI and lives on fly.io only — **never** Supabase. `ip_address` follows the same PII-truncation rule as the Supabase audit log (`audit-log-design.md` "Retention").

**Server action** `src/lib/consent-actions.ts` (`"use server"`):

- `saveConsentAction(payload: { consent: ConsentCapture; patientIdentity: { name, dob, postalCode }; assessmentId?: string }): Promise<{ consentId: string | null }>`
  1. `requireAuth()` → `{ id: pharmacistId, pharmacyId }`. Bail with `{ consentId: null }` when `!pharmacyId`.
  2. **Guard:** if `process.env.PHI_PERSIST_ENABLED !== "true"` → return `{ consentId: null }` (no-op stub; the wizard ships dark, exactly like #1/#2). Log nothing.
  3. **Server-side re-validation:** reject if `!consentToAssess || !consentToRecord || !signerName.trim()`, or if `captureMethod === "signature"` and `!signatureDataUrl` (defence-in-depth — the client gate already enforces this, but the server never trusts client input).
  4. Resolve `patient_id` via the same `identity_hash` upsert #2's `assessment-store.ts` uses (so consent and assessment share the same patient row), or accept a `patientId` from the #2 save flow when the two actions are composed.
  5. `INSERT INTO consent (...)` with `signature_png` decoded from the data URL, `pharmacist_id`/`pharmacy_id` from the JWT, `ip_address` from `request.headers` (Server Actions expose headers via `headers()` from `next/headers`).
  6. `INSERT INTO phi_audit_log (..., 'consent.captured', ...)` with metadata `{ consent_id, statement_version, capture_method }`.
  7. Emit the **non-PHI** Supabase `consent.captured` event with metadata strictly `{ consent_id, statement_version, capture_method }` — no signature, no patient, no ailment (§5.1).
  8. Return `{ consentId }`.

**Composition with #2's save flow.** Consent is saved *before* the assessment (consent authorises the act of recording). The terminal-step handler calls `saveConsentAction` first; on success it threads the returned `consentId` into `saveAssessmentAction`'s payload, and #2's `saveAssessment` writes `assessment.consent_id = $consentId`. Both happen before `downloadPdf`. In Phase 1 (fly.io off) both actions are no-op stubs returning null and the only durable artefact is the PDF itself, which carries the signature.

### 4.6 Non-PHI Supabase audit event (`consent.captured`)

Add `"consent.captured"` to the `EventType` union (`audit-actions.ts:5-18`) and to `audit.event_type`. Metadata is **strictly** `{ consent_id, statement_version, capture_method }` — all non-identifying. Extend the `log_event` validation to require those three keys for `consent.captured` and to reject any patient/clinical/signature key (`patient_*`, `name`, `dob`, `ailment`, `signature`, `signer_*`, `png`, `image`). `consent_id` is an opaque UUID — non-identifying, safe on Supabase. Mirrors the `assessment.saved` discipline established by #2 (`2026-06-23-persist-assessments-flyio-design.md` §4.6).

### 4.7 PDF signature rendering (`combined-pdf.tsx`, `referral-pdf.tsx`, modified)

Both document components gain two new optional props — `signatureDataUrl?: string` and `signerName?: string`, plus `signerRelationship`/`captureMethod`/`statementVersion` for the consent block — and render, beside the existing pharmacist signature block, a **patient/SDM signature block** with the captured image via `@react-pdf/renderer`'s `<Image src={signatureDataUrl} />`. The PHIPA footer block (`combined-pdf.tsx:318-320`, `referral-pdf.tsx:231-233`) is extended with a one-line consent attestation:

> *"Patient/SDM consent captured [in-person | verbally] on [captured_at] — statement version [statement_version]. Signer: [signerName] ([signerRelationship])."*

The existing single-column pharmacist signature section (`signatureSection`/`signatureBox` at `combined-pdf.tsx:129-141`) becomes a two-column row: pharmacist left (existing), patient/SDM right (new) — reserving the layout space roadmap #11 (pharmacist e-signature) will later fill with a stroke image instead of today's blank line. When `signatureDataUrl` is absent (verbal attestation, or Phase 1 persistence-off but signature present — the image still renders from the client data URL), the block renders `__________` with the attestation text.

### 4.8 Gate wiring (fail-closed)

- **Prescribe (`step-generate.tsx:26-51`):** the Download button (`step-generate.tsx:75`) is `disabled` unless `consent !== null && consent.consentToAssess && consent.consentToRecord && !!consent.signerName.trim() && (captureMethod === "verbal_attested" || !!consent.signatureDataUrl)`. On click, `handleDownload` calls `saveConsentAction` → `saveAssessmentAction({ ..., consentId })` → `downloadPdf`, in that order. A thrown error from either action blocks `downloadPdf` (fail-closed, identical rule to #2 §5.3).
- **Referral (`wizard-container.tsx:89-99`, `:167`):** identical gate and ordering on `handleDownloadReferral`. Consent is required for referrals too (the referral PDF discloses PHI to the physician).

---

## 5. Security / PHIPA-PIPEDA Posture

This feature places additional PHI at rest (the signature image, the signer identity, the consent decisions) and adds a new PHI table to the fly.io store, so it inherits every control #2 establishes and adds consent-specific ones.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| `signature_png` (the patient's stroke) | PHI (biometric-ish identifier of the patient) | **fly.io** `consent.signature_png`. Never Supabase. Never in a URL/query string. Threaded client→server only inside the `saveConsentAction` POST body. |
| `signer_name`, `signer_relationship` | PHI (identifies the patient or their SDM) | **fly.io** `consent.*`. Never Supabase. |
| `consent_to_assess` / `consent_to_record` / `consent_to_followup` decisions | PHI-adjacent (tied to a specific patient's care) | **fly.io** `consent.*`. The opt-in decision is what #10 keys off; it lives on fly.io, joined by `patient_id`. |
| `statement_version`, `statement_hash` | Non-identifying (describes the legal text, not the patient) | Allowed on **both** stores. Appears in Supabase `consent.captured` metadata. |
| `capture_method` (`signature`/`verbal_attested`) | Non-identifying | Allowed on **both** stores. |
| `consent_id` (UUID) | Non-identifying | Allowed on **both** stores — the correlation key. Appears in Supabase `consent.captured` metadata and in `assessment.consent_id`. |
| `assessment_id`, `patient_id`, `pharmacy_id`, `pharmacist_id` | Same classification as in #2 §5.1 | fly.io columns + scoping keys; never patient-identifying on their own. |
| `ip_address` | PII under PIPEDA (not PHI) | **fly.io** `consent.ip_address`. Truncated to `/24` (IPv4) / `/48` (IPv6) after 90 days, matching the Supabase audit-log rule (`audit-log-design.md` "Retention"). Never Supabase. |

**Rule of thumb (roadmap §6.4):** if a field could identify the patient or describes their clinical/legal state, it goes to fly.io. The signature image and the signer identity clearly qualify; the statement version and capture method do not.

### 5.2 Regulatory mapping

- **PHIPA s.20–21 (consent):** expressed consent at the point of collection is the cleanest lawful basis for the custodian (the pharmacy) to collect/use PHI. #3 captures it explicitly and retains the artefact. The three-part split separates PHIPA-record consent (`consent_to_record`) from HCCA-treatment consent (`consent_to_assess`).
- **PHIPA s.12 / s.10.1:** the consent record is itself PHI and inherits #2's `phi_audit_log` hash chain; every consent read/write is logged with actor + timestamp, providing the tamper-evidence the College expects.
- **HCCA 1996 (substitute decision-makers):** `signer_relationship` + the SDM attestation clause (§4.2) capture the chain of authority when the patient lacks capacity. The HCCA hierarchy (guardian → attorney for personal care → representative → spouse/partner → child → parent → sibling → other relative) is not encoded as a strict validator in NOW — the pharmacist attests the relationship — but the field is structured so a future LATER tier can validate it.
- **O. Reg. 256/24:** the `consent_to_assess` statement explicitly references the regulation, so the artefact ties the consent to the prescribing authority the pharmacist is exercising.
- **Ontario *Electronic Commerce Act, 2000*:** gives electronic signatures legal force; a captured stroke signature satisfies it (Option B typed-name also satisfies it but more weakly — §3).
- **PIPEDA Principles 4.1 / 4.3 / 4.7:** the signed BAA with fly.io (a hard gate, inherited from #2) satisfies 4.1 accountability for the third-party processor; expressed consent satisfies 4.3; AES-256 at rest + TLS in transit (inherited) satisfy 4.7. The optional `consent_to_followup` opt-in satisfies PIPEDA's requirement that consent for *secondary* purposes (marketing/follow-up comms distinct from care) be opt-in, not presumed.
- **Retention:** inherits #2's ~10-year Ontario pharmacy record retention. The consent record is retained at least as long as the assessment it authorises. No automated deletion in this tier.
- **Withdrawal (PHIPA s.21):** a patient may withdraw consent. The schema models it (`withdrawn_at`, `withdrawn_by`, `withdrawn_reason`) but **building the withdrawal UI is out of scope for NOW** (§6, §7.4); the columns exist so a future tier does not need a migration. A withdrawal in the interim is handled by the existing pharmacist-correction-of-record process and documented in `notes`/amendment rows.

### 5.3 Application security

- **Authorization is app-layer, not RLS** — identical to #2 §5.3. All fly.io `consent` access funnels through `src/lib/consent-store.ts`, which injects `pharmacy_id` from the verified JWT on every query and accepts no `pharmacyId` parameter from a caller. A CI grep/lint rule (`rg -n "FROM consent|INTO consent" src/lib/consent`) verifies every query text contains `pharmacy_id`.
- **Server-side re-validation:** the action never trusts the client's claim that consent was given — it re-checks the booleans and the signature presence before writing (§4.5 step 3).
- **Signature transport:** the data URL travels only inside the `saveConsentAction` POST body (Server Action), never in a URL, never in a query string, never logged. The signature is rendered onto the PDF client-side before any server call, so the printed artefact exists even if persistence is off.
- **Immutability:** the store module offers no `UPDATE`/`DELETE` for clinical content (matching #2). The `withdrawn_*` columns are the only mutable path, and a write to them is itself an audited `consent.withdrawn` PHI event (future). Corrections are deferred to an amendment-row model (shared with #2's #26 governance).
- **Consent-before-record ordering:** the terminal-step handler calls `saveConsentAction` before `saveAssessmentAction`, and the assessment row's `consent_id` is the FK proving an authorisation existed before the record was created. This ordering is the legal-correctness invariant.
- **Fail-closed:** a persistence failure (Phase 2) blocks `downloadPdf`, so a document can never exist without either a persisted consent *or* — in Phase 1 — a captured signature baked into the PDF itself. (Phase-1 stub no-op returns null and proceeds, so the wizard is unaffected while fly.io is dark.)

---

## 6. Edge Cases

- **fly.io not yet provisioned / BAA unsigned (Phase 1):** `PHI_PERSIST_ENABLED` is off; `saveConsentAction` returns `{ consentId: null }` without writing or auditing. The `ConsentPanel` still renders, still gates the Download button, and the captured signature is still baked onto the PDF via the client-side data URL — so the printed/e-faxed document is a complete legal artefact even with no DB row. The flag and the schema are ready so flipping the switch lights up persistence with no further code change.
- **Virtual / phone encounter:** `patient.encounterType !== "In-Person"` → the panel defaults to `captureMethod: "verbal_attested"`, hides the canvas, and shows the pharmacist-attestation checkbox instead. The PDF consent block renders "captured verbally" and the attesting pharmacist's identity (from the JWT). Legal under the Electronic Commerce Act; documented as weaker evidence.
- **Minor or incapacitated patient:** the pharmacist selects `signer_relationship` ∈ `{parent, guardian, sdm}`, enters the SDM's printed name, and the SDM signs the canvas. The SDM attestation clause is appended to the statement text and baked onto the PDF. The patient remains the subject (`patient_id`); the signer is the SDM.
- **Patient cannot sign a tablet (motor impairment, no stylus, hardware failure):** pharmacist switches to `verbal_attested` (same path as virtual). The signature pad is never the only path.
- **Blank or trivial signature:** `signaturePad.isEmpty()` rejects zero-point canvases. A single squiggle is *not* rejected in NOW (validating stroke quality is out of scope and adversarial to real use); the printed-name field + pharmacist witness + audit trail together establish the act. Open Question §7.5.
- **Pharmacist goes back and re-downloads (re-download idempotency from #2):** in Phase 2, the consent is already persisted with a `consent_id`; the panel detects an existing consent for the session `assessmentId` and pre-fills/satisfies the gate without re-prompting. In Phase 1, the consent is in React state only and survives within the session; a hard refresh loses it and re-prompts (acceptable; the PDF was already produced and is the durable artefact).
- **Patient declines follow-up opt-in:** `consent_to_followup = false`. The assessment proceeds (the two required consents are still given); roadmap #10's pipeline reads this flag and skips the patient. The opt-out is recorded.
- **Patient declines a *required* consent:** the gate stays closed; no document is produced. The pharmacist either explains and re-offers, or — for a refusal of the assessment itself — that flow is roadmap #4 (refusal/non-prescribe documentation), where the consent panel is reused with `outcome: 'abandoned'`.
- **Two consents captured for the same assessment:** prevented by the save ordering (consent before assessment, `consent_id` set once) and by a unique expectation on `(assessment_id)` where non-null via the index (§4.5). A second consent for the same `assessment_id` is a re-capture that amends `updated` — modelled as a new consent row + an audit event rather than an in-place update (immutability), with the assessment's `consent_id` repointed. Open Question §7.6 on whether NOW needs this re-point path.
- **Withdrawal of consent (PHIPA s.21):** schema-modelled (`withdrawn_*` columns) but no UI in NOW. Documented; the interim process is a pharmacist-recorded correction. See §5.2.
- **Consent statement changes (governance):** `statement_version` + `statement_hash` pin the exact text the patient signed, so a later edit to `statements.ts` cannot retroactively change what a past consent meant. Matches the `protocol_version` pattern in #2 and feeds roadmap #26 (clinical content governance).
- **Platform admin access:** explicitly **not** granted to `consent` in this tier (mirrors #2 §5.3 and `prescription-tx-id-design.md`). Commissioner/exports go through the existing `export.requested` audit flow, not direct PHI reads.
- **Signature data URL too large:** PNGs from `signature_pad` are typically 5–30 KB; a hard cap (e.g. 200 KB) in the action rejects pathological inputs before the fly.io write.

---

## 7. Open Questions

1. **fly.io provisioning + BAA timing (the hard gate).** Inherited verbatim from #2 §7.1: confirm fly.io Postgres is stood up in a **Canadian region** (`yyz`/`yul`) and the BAA is signed before `PHI_PERSIST_ENABLED` flips true. Consent persistence is on the same flag as #2.
2. **One server action or two?** The design uses a dedicated `saveConsentAction` + threads `consentId` into #2's `saveAssessmentAction`. An alternative is to fold consent into the assessment payload and write both in #2's transaction. The dedicated action is recommended (consent is a separable legal artefact that can exist for a non-prescribe flow like #4's refusal), but confirm the composition ordering (consent → assessment) is acceptable vs. a single atomic transaction.
3. **Patient identity coupling with #2.** `saveConsentAction` needs a `patient_id`. Should it (a) upsert the patient itself via #2's `identity_hash` (duplicating the upsert), (b) accept a `patientId` returned by a refactored #2 helper, or (c) require the assessment to save first and back-link? Recommend (b): #2 exposes `resolvePatientId({ pharmacyId, identity })` and both consent and assessment call it, sharing one patient row. Confirm #2 will expose this helper.
4. **HCCA SDM hierarchy validation.** NOW records the pharmacist-attested `signer_relationship`; it does not validate the HCCA hierarchy (guardian → attorney → …). Is the attestation sufficient for launch, or does the College expect enforced ordering? Recommend attestation for NOW; enforcement is LATER.
5. **Signature quality / anti-spoofing.** Should the panel reject a signature below some minimum stroke count or bounding-box size? Risk: false rejections of legitimate signatures (elderly patients, tremor). Recommend *no* quality gate in NOW beyond `isEmpty()`; the printed name + witness + audit chain carry the evidentiary weight.
6. **Re-capture / re-point path.** If a pharmacist re-opens an assessment and re-captures consent, is the new consent a new row (and `assessment.consent_id` repointed) or an amendment? Recommend new row + repoint + `consent.amended` audit event, but confirm whether NOW needs this path at all (re-download idempotency in #2 suggests re-capture is rare).
7. **Statement text provenance and legal review.** The §4.2 statement text is drafted to be Ontario/PHIPA/HCCA-appropriate but **must be reviewed by a pharmacist and ideally legal counsel** before launch. Where does the reviewed-and-approved text live — in `src/lib/consent/statements.ts` (code, requires a deploy to change) or in a content file under `data/` (editable without a deploy)? The hard constraint forbids this iteration from editing `data/`, but the *recommendation for the implementation* is a TS module under `src/lib/consent/` so the `statement_hash` is reproducible from the build. Confirm.
8. **Consent for the referral/abandon path specifically.** A referral still discloses PHI to the physician; #3 requires consent there too. But the *consent_to_assess* statement ("if clinically appropriate, prescribing") is arguably a poor fit when the outcome is a referral not a prescription. Should the referral path use a different statement subset (e.g. consent_to_assess + consent_to_record + a "consent to refer/disclose to my physician" clause)? Recommend a single statement set for NOW with the wording covering both outcomes; refine in #4.
9. **Multi-language consent (roadmap #24).** The statement text is English-only in NOW. #24 (multilingual patient instructions, FR-first) will need translated consent statements with their own `statement_version`. Confirm the `statement_version`/`statement_hash` scheme is extensible to a `statement_locale` dimension.
10. **Audit event naming.** `consent.captured` is used for both the fly.io PHI event and the Supabase non-PHI event. They carry different payloads (PHI vs. non-PHI). Confirm this dual use is acceptable vs. distinct names (e.g. fly.io `consent.captured` + Supabase `consent.recorded`). Recommend dual use with the store-module boundary enforcing the payload difference, matching how #2 uses `assessment.created` (fly.io) vs. `assessment.saved` (Supabase).

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/types/index.ts` — add `ConsentCapture`, `SignerRelationship`, `CaptureMethod` types.
- `src/lib/consent/statements.ts` — versioned consent statement set + `CONSENT_STATEMENT_VERSION` + hash.
- `src/components/consent/signature-pad.tsx` — client-only canvas wrapper (dynamic import, `ssr: false`).
- `src/components/consent/consent-panel.tsx` — the consent UI (statements + pad + signer fields + verbal fallback).
- `src/lib/consent-store.ts` — all fly.io `consent` reads/writes, pharmacy-scoped, audit-writing.
- `src/lib/consent-actions.ts` — `saveConsentAction` server action (flag-guarded no-op stub in Phase 1).
- `src/__tests__/consent-panel.test.tsx`, `src/__tests__/consent-actions.test.ts`, `src/__tests__/consent-store.test.ts` — panel validity logic, action flag-guard + non-PHI audit shape, store pharmacy-scoping.

**Modified:**
- `src/lib/audit-actions.ts` — add `"consent.captured"` (and `"consent.amended"` if §7.6 is adopted) to the `EventType` union.
- `src/components/wizard/wizard-container.tsx` — add consent state; render `<ConsentPanel>` in the referral branch; gate `handleDownloadReferral`; call `saveConsentAction` → `saveAssessmentAction` before `downloadPdf`.
- `src/components/wizard/step-generate.tsx` — render `<ConsentPanel>`; gate the Download button; call `saveConsentAction` → `saveAssessmentAction` before `downloadPdf`; thread `signatureDataUrl`/`signerName`/etc. into `<CombinedPdf>`.
- `src/components/combined-pdf.tsx`, `src/components/wizard/referral-pdf.tsx` — add consent props; render patient/SDM signature block + consent attestation in the footer; widen the signature section to two columns.
- `src/lib/assessment-actions.ts` (from #2) — accept an optional `consentId` and pass it into `saveAssessment` so `assessment.consent_id` is set.
- `package.json` — add `react-signature-canvas` (+ peer `signature_pad`) as a local dependency.

**Database (fly.io, applied at provisioning, extends #2's schema):** `consent` table + `assessment.consent_id` column + indexes (§4.5); `consent.captured` action added to the `phi_audit_log` write paths.

**Database (Supabase, non-PHI):** add `consent.captured` to `audit.event_type`; extend `log_event` validation (require `consent_id` + `statement_version` + `capture_method`; reject patient/signature/clinical keys).

**Environment (server-only):** no new env vars — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`. The signature-pad library is client-only and needs no secrets.
