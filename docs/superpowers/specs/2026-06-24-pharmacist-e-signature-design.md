# Pharmacist e-Signature on PDF — Design

**Date:** 2026-06-24
**Roadmap item:** #11 (NEXT tier) — "Pharmacist e-signature on PDF — Print-ready, legitimate"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST generates a combined prescription + physician-notification PDF (`src/components/combined-pdf.tsx`) and a red-flag referral PDF (`src/components/wizard/referral-pdf.tsx`) that end in a **blank pharmacist signature line** — a 20 pt-tall empty rule at `combined-pdf.tsx:309-315` and `referral-pdf.tsx:222-228`. The printed PDF is therefore **not print-ready and not legitimate until the pharmacist wet-signs it after printing**. This is the exact gap roadmap item #11 names ("Pharmacist e-signature on PDF — Print-ready, legitimate"): every consult ends with a manual sign-and-fax step that costs time and is the last paper residue in an otherwise digital workflow. PharmAssess and MAPflow both close it; the CDST does not.

There is no stroke-capture infrastructure anywhere in the codebase today. A `rg` for `signature|Signature|e-sign|esig|signPad` across `src/` returns **only** the two blank-line PDF blocks and their style names (`signatureSection`, `signatureBox`, `signatureLine`, `signatureLabel`). There is no signature pad, no signature table, no e-sign credential, no per-act signing event. The pharmacist's *identity* is, however, already correctly bound to the authenticated prescriber: the `PharmacyDefaults` built in `src/app/assess/[ailment]/page.tsx:39-40` populates `pharmacistName` from `profile.fullName` and `provincialLicense` from `profile.provincialLicense` (the `Profile` returned by `requireAuth()` in `src/lib/auth-guards.ts:31-41`), so the printed name + license on the PDF already reflect the **actual prescribing pharmacist**, not a pharmacy-wide default. There is therefore no latent identity-attribution bug to fix — #11 layers a captured **stroke** on top of an already-correct identity binding, and persists both as the durable medico-legal authentication artefact.

Two sibling features explicitly anticipated #11 and reserved the path for it:

- **Roadmap #3 (digital patient consent)** — its design (`2026-06-23-digital-consent-capture-design.md` §4.3) introduces a client-only `<SignaturePad>` (`src/components/consent/signature-pad.tsx`, dynamically imported with `next/dynamic` and `{ ssr: false }`, wrapping `react-signature-canvas`) whose `onChange(dataUrl | null)` / `onClear()` contract is **purpose-agnostic** — it captures a stroke, regardless of who is signing. #11 reuses this component verbatim for the pharmacist stroke. The same design (§4.7) states: *"The existing single-column pharmacist signature section becomes a two-column row: pharmacist left (existing), patient/SDM right (new) — reserving the layout space roadmap #11 (pharmacist e-signature) will later fill with a stroke image instead of today's blank line."* #11 fills the left half of that reserved two-column block.
- **Roadmap #2 (persist assessments, fly.io)** — its `assessment` table, `phi_audit_log`, `PHI_PERSIST_ENABLED` flag, `assessment-store.ts` (the only module that touches `assessment`, pharmacy-scoped), and `saveAssessmentAction` (flag-guarded no-op stub in Phase 1) are the persistence foundation #11 extends with `pharmacist_signature_id` + `signed_at` + `signing_attestation_version`.

**The goal of this feature** is to (a) capture the prescribing pharmacist's stroke signature, (b) render it onto both PDFs in the existing pharmacist signature slot so the printed/e-faxed artefact is print-ready and legitimate without a wet-ink step, (c) bind it to the authenticated pharmacist identity (`Profile`), and (d) persist both a reusable per-pharmacist e-signature **credential** and a per-act **attestation** on fly.io under BAA — so each issued prescription/referral carries a tamper-evident, audit-trail-linked record of *who authorized it and when*, satisfying the Ontario College of Pharmacists documentation expectation and the roadmap §4 "liability shield" framing.

**Out of scope** (per roadmap §3/§6 and the feature's NOW-tier discipline): qualified/PKI digital signatures (eIDAS-style cryptographic signatures — overkill for a pharmacy prescription; the Ontario *Electronic Commerce Act, 2000* gives electronic signatures legal force without PKI, and roadmap §6.1 confirms FDA 21 CFR Part 11 does not apply), wet-ink scan/upload (the CDST does not import paper), MFA-per-prescription (authentication already occurred at login via Supabase Auth), multi-party/co-signer signatures for adapted prescribing (LATER), and any change to the PMS-owned clinical-safety boundary (the signature attests authorship; it does not validate the regimen — `step-rx.tsx:39-62` renders `ailment.rxOptions` raw and the PMS owns allergy/interaction/pregnancy checks per roadmap §3).

---

## 2. Current State (what exists in code)

### 2.1 A blank signature line and nothing more

The pharmacist signature block is identical on both PDFs:

```tsx
// combined-pdf.tsx:308-315 (referral-pdf.tsx:222-228 is the same)
<View style={styles.signatureSection}>
  <View style={styles.signatureBox}>
    <Text style={...}>Pharmacist Signature</Text>
    <View style={styles.signatureLine} />           // ← blank 20pt rule
    <Text style={styles.signatureLabel}>
      {pharmacy?.pharmacistName || "__________"} — License #{pharmacy?.provincialLicense || "__________"}
    </Text>
  </View>
</View>
```

`signatureLine` (`combined-pdf.tsx:135-140`) is a single bottom border — a line to sign on. There is no `<Image>`, no captured stroke, no signature field on `AssessmentData` (`src/types/index.ts:59-67`) or `PharmacyDefaults` (`src/types/index.ts:39-50`), no signature table on Supabase or (per #2's spec) on fly.io. The pharmacist is expected to print and wet-sign, per the helper text at `step-generate.tsx:78-80` ("Print, sign, and fax to the physician") and `wizard-container.tsx:170`.

### 2.2 Identity is already correctly bound to the authenticated prescriber

`src/app/assess/[ailment]/page.tsx:30-43` builds the `PharmacyDefaults` object that feeds both PDFs, and it sources the pharmacist identity from the authenticated `Profile`, **not** from a pharmacy-wide default:

```tsx
// assess/[ailment]/page.tsx:39-40
pharmacistName: profile.fullName ?? "",
provincialLicense: profile.provincialLicense ?? "",
```

`Profile` (`auth-guards.ts:31-41`, `types/index.ts:72-82`) is returned by `requireAuth()`, which verifies the Supabase JWT. So `pharmacy.pharmacistName` / `pharmacy.provincialLicense` on the PDF already equal the logged-in prescriber's name + Ontario College of Pharmacists registration number. #11 inherits this correct binding and adds the stroke image on top of it; it does **not** need to re-plumb identity.

### 2.3 The `<SignaturePad>` is specified by #3 (and reusable)

Roadmap #3's design (`2026-06-23-digital-consent-capture-design.md` §4.3) specifies `src/components/consent/signature-pad.tsx`:

- Client-only, dynamically imported with `next/dynamic` and `{ ssr: false }` (because `signature_pad` touches `window` and Next.js 16 renders server-side by default).
- Wraps `react-signature-canvas` (a maintained wrapper around `signature_pad`), added as a **local** project dependency (`package.json`), never global (per the user's standing preference).
- Exposes `onChange(dataUrl: string | null)` (emits a PNG data URL on every stroke end; `null` when cleared/blank via `signaturePad.isEmpty()`), `onClear()`, and props for `aria-label`, width, height, `disabled`.

The canvas is purpose-agnostic: it does not know or care whether the signer is the patient or the pharmacist. **#11 imports the same component for the pharmacist's stroke** — no second pad, no second dependency. (If #11 ships before #3, #11 creates the pad at a neutral path and #3 imports from there — Open Question §7.3.)

### 2.4 The #2 persistence + audit foundation

Roadmap #2 (`2026-06-23-persist-assessments-flyio-design.md`) specifies the fly.io PHI store this feature depends on: the `patient` table, the `assessment` table (which #3 extends with `consent_id` and #4 with `non_prescribe_reason`/`abandonment_reason` columns), the hash-chained `phi_audit_log`, the flag-guarded `pg.Pool` (`src/lib/phi/db.ts`), and the `saveAssessmentAction` server action which #11 threads `signatureId` + `signedAt` into. fly.io is **not yet provisioned** and the **BAA is not yet signed** (roadmap §7 open questions #1, #2), so — exactly as #1, #2, #3, #4, #22, and #10 do — #11 ships dark behind `PHI_PERSIST_ENABLED`: the signature renders onto the PDF client-side (the printed PDF is itself the durable artefact in Phase 1), and the fly.io credential + `signature.applied` events light up automatically in Phase 2 with no further code change.

### 2.5 Auth identity is rich; the pharmacist is an authenticated principal

Unlike #3's patient (unauthenticated, identity attested by the pharmacist), the pharmacist is a fully authenticated, named, licensed principal: `Profile` carries `id`, `pharmacyId`, `activeRole`, `fullName`, `email`, `province`, `provincialLicense`. `requireAuth()`/`requireRole("owner","pharmacist")` (`auth-guards.ts:44-55`) scope every action. This asymmetry is the design justification for the **saved-credential** model in §3: a pharmacist who issues many prescriptions per day should enroll a signature once and have it auto-apply, rather than re-sign a pad on every consult the way an unauthenticated patient must consent on every visit.

### 2.6 A settings surface already exists for self-managed profile data

`src/app/settings/` contains `profile/`, `pharmacy/`, `password/`, `team/` — each a server component (`page.tsx`) that calls `requireAuth()` and renders a client form (`*-form.tsx`). There is no `signature/` page. #11 adds `src/app/settings/signature/` for credential enrollment/management, mirroring this established pattern exactly.

---

## 3. Approach (options + recommendation)

The design hinges on four decisions: (a) **per-act fresh capture vs. a saved reusable credential**, (b) **where the credential lives**, (c) **the per-document attestation model**, and (d) **the gate (hard vs. soft)**. Options are evaluated against roadmap §6.2 (PHI on fly.io, Supabase = auth + non-PHI) and §6.4 (the partitioning rule), and against the professional reality of an Ontario pharmacy counter (a pharmacist may issue 10+ minor-ailments prescriptions per day; every second counts against the roadmap §4 "counter speed" wedge).

### Option A — Saved pharmacist e-signature credential + per-document attestation, fly.io PHI (RECOMMENDED)

The pharmacist **enrolls** a signature once, on a new settings page (`src/app/settings/signature/`), by drawing on the #3 `<SignaturePad>`. The stroke is saved to fly.io as a reusable per-pharmacist **credential** (one current row per pharmacist, upsertable — the pharmacist may re-enroll). At document generation, the enrolled signature **auto-applies** to the PDF (replacing the blank line), and the pharmacist confirms a per-document **attestation checkbox** on the terminal step:

> *"I confirm that I am the pharmacist named above, hold Ontario College of Pharmacists registration #[license], and am authorizing this [prescription | referral] under Ontario Regulation 256/24 in my capacity as the prescribing pharmacist."*

The act is timestamped (`signed_at`) on the assessment/vaccination row and audit-logged (`phi_audit_log signature.applied` PHI event + non-PHI Supabase `signature.applied`). If the pharmacist is **not yet enrolled**, the terminal step offers a one-time inline capture with a *"Save as my signature"* checkbox (progressive inline enrollment); if they decline to save, the stroke renders for this document only and is not persisted as a credential. In Phase 1 (fly.io off), the credential is a no-op stub and the stroke lives in React state for the session — the PDF still renders print-ready in-session.

- **Pros:** This is the production-standard UX for high-volume e-prescribing (DocuSign, Adobe Sign, and every e-Rx system use a saved credential + per-act application). It is the fastest counter path — no re-signing every consult, which directly serves the roadmap §4 "counter speed" wedge where Option B fails. Identity binding is strong: saved credential + authenticated `Profile` + per-act attestation + immutable audit trail together carry the per-prescription medico-legal weight even with a reused image. It reuses #3's `<SignaturePad>` verbatim (no new pad, no new dependency beyond the one #3 already adds). It is sibling-friendly: the same credential auto-applies to the vaccination VAR PDF (#22), refusal/non-prescribe docs (#4), and any future signed document. The per-act attestation is the binding that distinguishes "I enrolled a signature" from "I authorized *this* prescription at *this* time."
- **Cons:** A reused stroke image is weaker *per-act* biometric evidence than a freshly captured signature (mitigated by the attestation + `signed_at` + immutable `phi_audit_log`; the Ontario *Electronic Commerce Act, 2000* accepts a saved electronic signature, and this is how every production e-signature works). The credential is PHI on fly.io (a biometric stroke of an identified pharmacist) — it adds a small PHI surface (mitigated by one row per pharmacist, upsertable only by that pharmacist via JWT-scoped queries). It requires the settings page + the per-act action plumbing.

### Option B — Per-consult fresh capture (mirror #3 patient consent exactly)

Every consult, the pharmacist signs the pad once on the terminal step (no saved credential); the stroke renders on that document only and, when fly.io is on, is persisted on the assessment row. Strongest per-act biometric evidence; no credential table; no settings page.

- **Cons:** Slower at the counter — re-signing on every consult fights the roadmap §4 "counter speed" wedge, which is the primary differentiator vs. PharmAssess/MAPflow. Pharmacists already resist the wet-ink step; an electronic re-sign every time is friction, not relief. It also under-uses the fact that the pharmacist is an authenticated, named principal (§2.5) — the whole point of authentication is that you don't have to re-prove identity on every act.
- **Rejected** as the primary path; the saved-credential model (Option A) is the production-standard UX and is what "print-ready, legitimate" actually means in practice.

### Option C — Typed-name + checkbox attestation only (no stroke)

The pharmacist types their name and checks the attestation; no stroke image is captured. Weakest evidence — trivially spoofable, provides poor proof of the *act* of signing. Concedes the competitive point #3 already rejected for patients (`2026-06-23-digital-consent-capture-design.md` §3 Option B). Also fails the roadmap's explicit "e-signature" annotation on item #11.
- **Rejected** as the primary path; retained only as the **accessibility fallback** (per #3 §4.4's verbal/typed fallback discipline) for a pharmacist who cannot use the pad.

### Recommendation

**Option A.** It is the faithful implementation of roadmap #11 ("e-signature on PDF — print-ready, legitimate"), the production-standard UX for a high-volume authenticated prescriber, and the smallest change that reuses both #3's `<SignaturePad>` and #2's fly.io foundation. The per-document attestation + `signed_at` + immutable `phi_audit_log` carry the per-act medico-legal weight; the saved credential is convenience + identity binding. The credential is one upsertable row per pharmacist on fly.io (PHI under BAA, behind the same `PHI_PERSIST_ENABLED` flag as #2/#3). The architecture cleanly separates the **mutable credential** (the pharmacist manages it) from the **immutable per-act binding** (write-once on the assessment row), which is the medico-legally correct separation.

---

## 4. Components & Data Model

### 4.1 New types (`src/types/index.ts`)

```ts
// The enrolled per-pharmacist credential (server-fetched, fly.io-backed when PHI_PERSIST_ENABLED).
export interface PharmacistSignature {
  pharmacistId: string
  signatureDataUrl: string        // PNG data URL: client → server → fly.io bytea → decoded back to client for PDF render
  enrolledAt: string              // ISO timestamp of current enrollment
  attestationVersion: string      // PHARMACIST_ATTESTATION_VERSION pinned at enrollment
}

// The per-act state carried through the terminal-step panel to the action + PDF.
export interface PharmacistSigningState {
  attested: boolean                        // the per-document attestation checkbox
  signatureDataUrl: string | null          // enrolled stroke (preview) OR inline-captured stroke (unenrolled)
  attestationVersion: string
  signedAt: string | null                  // set by applySignatureAction; null until applied
}
```

### 4.2 Versioned attestation statement (`src/lib/signature/attestation.ts`, new)

Mirrors the content-governance precedent now firmly established across #3 (`statements.ts`) / #4 (`reasons.ts`) / #6 (`differentials.ts`) / #22 (`vaccines/catalog.ts`) / #9 (`citations.ts`) / #10 (`prom.ts`): curated legal/governance content needing a reproducible hash lives in a versioned TS module under `src/lib/`, never in `data/` (gnhf constraint forbids `data/` edits; the hash must be reproducible from the build). Feeds roadmap #26 (clinical content governance) and #14 (outcomes).

```ts
import { createHash } from "node:crypto"

export const PHARMACIST_ATTESTATION_VERSION = "pharmacist-esig-v1"

export const PHARMACIST_ATTESTATION =
  "I confirm that I am the pharmacist named above, hold Ontario College of Pharmacists registration #{{license}}, and am authorizing this {{documentType}} under Ontario Regulation 256/24 (Designated Minor Ailments) under the Pharmacy Act, in my capacity as the prescribing pharmacist."

export function renderAttestation(license: string | null, documentType: "prescription" | "referral"): string {
  return PHARMACIST_ATTESTATION
    .replace("{{license}}", license?.trim() || "__________")
    .replace("{{documentType}}", documentType)
}

// sha256 of the canonical attestation template (un-interpolated); reproducible from the build.
export function computeAttestationHash(): string {
  return createHash("sha256").update(PHARMACIST_ATTESTATION).digest("hex")
}
```

### 4.3 `<SignaturePad>` (REUSE #3's `src/components/consent/signature-pad.tsx`)

No new component. #11 imports the existing client-only pad (§2.3) for both the settings-page enrollment and the terminal-step inline capture. If #11 ships before #3, #11 creates the pad at a neutral path `src/components/signature/signature-pad.tsx` and #3 imports from there — the shared location is decided in Open Question §7.3, but the component is single-instance regardless.

### 4.4 `<PharmacistSignaturePanel>` (`src/components/signature/pharmacist-signature-panel.tsx`, new)

Rendered on the terminal step (above the Download button, alongside #3's `<ConsentPanel>`). Two modes:

- **Enrolled** (`enrolled !== null`): shows a read-only preview of the saved stroke + the pharmacist's name + license, followed by the attestation checkbox. The Download button is disabled until `attested === true`.
- **Unenrolled** (`enrolled === null`): shows the `<SignaturePad>` for a one-time inline capture + a *"Save as my signature for future prescriptions"* checkbox (progressive inline enrollment) + the attestation checkbox. The Download button is disabled until the stroke is non-blank AND `attested === true`.

```ts
interface PharmacistSignaturePanelProps {
  enrolled: PharmacistSignature | null
  pharmacistName: string                     // Profile.fullName (already bound to the PDF name per §2.2)
  license: string | null                     // Profile.provincialLicense
  documentType: "prescription" | "referral"
  value: PharmacistSigningState | null
  onChange: (v: PharmacistSigningState | null) => void
}
```

The panel computes its own validity and surfaces it via `onChange` (`null` = not yet validly captured/attested), exactly as #3's `<ConsentPanel>` does (`2026-06-23-digital-consent-capture-design.md` §4.4).

### 4.5 Credential persistence (`src/lib/signature-store.ts`, new on fly.io)

The **only** module that touches fly.io `pharmacist_signature`. Scoped by `pharmacist_id` (from the JWT) and indexed by `pharmacy_id`. **Unlike** #2/#3's immutable clinical rows, this is an **UPSERTABLE** credential — the pharmacist manages it, and re-enrollment overwrites the stroke. Every upsert writes a `phi_audit_log` row (`signature.enrolled`), preserving enrollment history even though the `bytea` is overwritten.

**Schema (fly.io Postgres — PHI, under BAA).** A new `pharmacist_signature` table; extends #2's `assessment` and #22's `vaccination` tables with the per-act binding columns:

```sql
-- pharmacist_signature: the enrolled per-pharmacist e-signature credential (PHI).
CREATE TABLE pharmacist_signature (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacist_id        uuid NOT NULL,                 -- one current credential per pharmacist
  pharmacy_id          uuid NOT NULL,                 -- scoping key (#2 §5.1 discipline)
  signature_png        bytea NOT NULL,                -- PHI: the pharmacist's stroke image
  attestation_version  text NOT NULL,                 -- matches PHARMACIST_ATTESTATION_VERSION at enrollment
  attestation_hash     text NOT NULL,                 -- sha256 of the attestation template (governance)
  enrolled_at          timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pharmacist_signature_one ON pharmacist_signature (pharmacist_id);
CREATE INDEX pharmacist_signature_pharmacy ON pharmacist_signature (pharmacy_id);

-- Per-act binding: link each issued document to the credential that signed it.
ALTER TABLE assessment ADD COLUMN pharmacist_signature_id  uuid REFERENCES pharmacist_signature(id);
ALTER TABLE assessment ADD COLUMN signed_at               timestamptz;
ALTER TABLE assessment ADD COLUMN signing_attestation_version text;
CREATE INDEX assessment_signed ON assessment (signed_at) WHERE signed_at IS NOT NULL;

-- #22's vaccination table gets the same three columns (the VAR PDF is also a signed document).
ALTER TABLE vaccination ADD COLUMN pharmacist_signature_id  uuid REFERENCES pharmacist_signature(id);
ALTER TABLE vaccination ADD COLUMN signed_at               timestamptz;
ALTER TABLE vaccination ADD COLUMN signing_attestation_version text;
```

> `signature_png` is stored as `bytea`. The stroke identifies the pharmacist (it is their biometric mark), so it is PHI and lives on fly.io only — **never** Supabase. The `pharmacist_id` UNIQUE constraint enforces one current credential per pharmacist; upsert (`ON CONFLICT (pharmacist_id) DO UPDATE`) overwrites the stroke on re-enrollment while `phi_audit_log` retains the history of enrollment events.

**Store module** (`src/lib/signature-store.ts`):

- `getCurrentSignature(pharmacistId, pharmacyId): Promise<PharmacistSignature | null>` — `SELECT` the current row scoped `WHERE pharmacist_id = $1 AND pharmacy_id = $2`; decode `signature_png` to a data URL. Returns `null` when unenrolled or when `PHI_PERSIST_ENABLED` is off.
- `upsertSignature(pharmacistId, pharmacyId, pngBytes, attestationVersion, attestationHash): Promise<{ id: string }>` — `INSERT ... ON CONFLICT (pharmacist_id) DO UPDATE SET signature_png = ..., enrolled_at = now()`; writes a `phi_audit_log signature.enrolled` row with metadata `{ signature_id, attestation_version }`. No-op (returns `null`) when the flag is off.

Every query text contains `pharmacist_id` (CI grep guard, mirroring #2 §5.3's `pharmacy_id` rule).

### 4.6 Server actions (`src/lib/signature-actions.ts`, new `"use server"`)

Mirrors the #2 `saveAssessmentAction` discipline. All three are flag-guarded no-op stubs in Phase 1 (`PHI_PERSIST_ENABLED !== "true"` → return null/false without writing or auditing), exactly like #1/#2/#3.

- `getSignatureAction(): Promise<PharmacistSignature | null>`
  1. `requireAuth()` → `{ id: pharmacistId, pharmacyId }`. Bail with `null` when `!pharmacyId`.
  2. Guard: if `PHI_PERSIST_ENABLED !== "true"` → return `null` (unenrolled appearance → panel shows inline capture).
  3. `getCurrentSignature(pharmacistId, pharmacyId)`.

- `enrollSignatureAction({ signatureDataUrl, saveAsCredential }): Promise<{ ok: boolean }>`
  1. `requireAuth()` → `{ id, pharmacyId }`. Bail when `!pharmacyId`.
  2. Guard: flag off → return `{ ok: true }` without writing (Phase-1 stub; the client keeps the stroke in React state for the session).
  3. **Server-side re-validation:** reject if the data URL is absent/blank or exceeds a 200 KB cap, or if `signaturePad.isEmpty()`-equivalent (defence-in-depth — the client gate already enforces this).
  4. Decode the data URL to `bytea`; `upsertSignature(...)` with `PHARMACIST_ATTESTATION_VERSION` + `computeAttestationHash()`.
  5. Return `{ ok: true }`.

- `applySignatureAction({ documentType, assessmentId?, vaccinationId? }): Promise<{ signedAt: string | null; signatureId: string | null }>`
  1. `requireAuth()` → `{ id, pharmacyId }`. Bail when `!pharmacyId`.
  2. Guard: flag off → return `{ signedAt: null, signatureId: null }` (Phase-1 stub).
  3. Look up the current `pharmacist_signature.id` for this pharmacist (must be enrolled; if not, bail — the panel should have prevented this).
  4. `UPDATE assessment SET pharmacist_signature_id = $, signed_at = now(), signing_attestation_version = $ WHERE id = $assessmentId AND pharmacy_id = $pharmacyId` (or the `vaccination` equivalent). **Write-once**: guarded by `WHERE signed_at IS NULL` so a re-download does not re-stamp.
  5. `phi_audit_log signature.applied` with metadata `{ signature_id, attestation_version, document_type }`.
  6. Emit the **non-PHI** Supabase `signature.applied` event with metadata strictly `{ signature_id, attestation_version }` — no stroke, no patient, no ailment (§5.1).
  7. Return `{ signedAt, signatureId }`.

### 4.7 Non-PHI Supabase audit event (`signature.applied`)

Add `"signature.applied"` to the `EventType` union (`audit-actions.ts:5-18`) and to `audit.event_type`. Metadata is **strictly** `{ signature_id, attestation_version }` — both non-identifying (an opaque UUID + a version string). Extend `log_event` validation to require those two keys for `signature.applied` and to reject any patient/clinical/stroke key (`patient_*`, `name`, `ailment`, `png`, `image`, `signature_*_png`). Mirrors the `consent.captured` / `assessment.saved` discipline (#2 §4.6, #3 §4.6).

> `signature.enrolled` is **PHI-only on fly.io** (the enrollment carries the stroke via the `bytea` write implicitly) — it has **no** Supabase mirror, because any enrollment event is intrinsically tied to the pharmacist's identified stroke. Only the per-act `signature.applied` (which carries no stroke, just the opaque `signature_id`) is mirrored to Supabase.

### 4.8 PDF rendering (`combined-pdf.tsx`, `referral-pdf.tsx`, modified)

Both document components gain optional props:

```ts
pharmacistSignatureDataUrl?: string   // the enrolled stroke (PNG data URL)
signedAt?: string                     // ISO timestamp from applySignatureAction
attestationVersion?: string           // for the attestation line
documentType: "prescription" | "referral"   // for the attestation text
```

The pharmacist signature slot (`combined-pdf.tsx:311-313`, `referral-pdf.tsx:224-226`) renders:

- **When `pharmacistSignatureDataUrl` is present:** an `<Image src={pharmacistSignatureDataUrl} style={{ height: 28, objectFit: "contain" }} />` from `@react-pdf/renderer` (already in `package.json`) **instead of** the blank `signatureLine`, followed by the existing name/license line, followed by a new attestation line: *"Electronically signed by [pharmacistName] (Reg #[license]) on [signed_at] — [attestationVersion]."* rendered via `@react-pdf/renderer` `<Text>`.
- **When absent** (Phase 1 persistence-off but inline-captured stroke present in React state, OR fully unenrolled): renders the existing blank `signatureLine` unchanged — graceful degradation to today's behaviour, so the PDF always generates.

#3's planned two-column widening (`2026-06-23-digital-consent-capture-design.md` §4.7) places the pharmacist **left** and the patient/SDM **right**. #11 fills the **left** column with the stroke; #3 fills the right. When both #3 and #11 are present, the signature section is a two-column row: pharmacist stroke (left) + patient/SDM stroke (right).

### 4.9 Gate wiring (per-document attestation is the hard gate; enrollment is soft)

- **Prescribe** (`step-generate.tsx:74-81`): the Download button is `disabled` unless `signing !== null && signing.attested && !!signing.signatureDataUrl`. On click, `handleDownload` calls `applySignatureAction` → `saveConsentAction` (#3) → `saveAssessmentAction({ ..., signatureId, signedAt })` (threading the per-act binding) → `downloadPdf`, in that order. A thrown error from any action blocks `downloadPdf` (fail-closed, identical rule to #2 §5.3 and #3 §4.8).
- **Referral** (`wizard-container.tsx:89-99`, `:167`): identical gate and ordering on `handleDownloadReferral` with `documentType: "referral"`.
- **Settings enrollment** (`src/app/settings/signature/`): no gate — the pharmacist manages their own credential freely; `enrollSignatureAction` is the only write path.

The attestation checkbox is the per-act hard gate: no document is produced without the pharmacist affirming authorship. Enrollment is **soft** — an unenrolled pharmacist can still complete an inline capture in-session (Phase-1-friendly), and a fully-blank signature degrades gracefully to the wet-sign line rather than blocking the consult.

---

## 5. Security / PHIPA-PIPEDA Posture

This feature places PHI at rest (the pharmacist's stroke image, the per-act signing record) and adds a new PHI table to the fly.io store, so it inherits every control #2 establishes and adds signature-specific ones.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| `signature_png` (the pharmacist's stroke) | PHI (biometric identifier of an identified pharmacist) | **fly.io** `pharmacist_signature.signature_png`. Never Supabase. Never in a URL/query string. Threaded client→server only inside the `enrollSignatureAction` POST body. |
| `enrolled_at`, `attestation_version`, `attestation_hash` | Non-identifying (describe the credential/legal text, not a patient) | Allowed on **both** stores; `attestation_version` appears in Supabase `signature.applied` metadata. |
| `signature_id` (UUID) | Non-identifying | Allowed on **both** stores — the correlation key. Appears in Supabase `signature.applied` metadata and in `assessment.pharmacist_signature_id`. |
| `pharmacist_id`, `pharmacy_id` | Non-PHI (pharmacy employees; roadmap §6.4: "describes the pharmacist or the software account → stays in Supabase") | Scoping keys, consistent with #2 §5.1. Appear on both stores as ownership columns. |
| `signed_at` on `assessment`/`vaccination` | PHI-adjacent (tied to a specific patient's care event) | **fly.io** column. Never Supabase. |

**Rule of thumb (roadmap §6.4):** the stroke image identifies the pharmacist (it is their biometric mark) and ties to a patient's care event via the per-act binding — clearly PHI → fly.io. The attestation version and the opaque signature_id do not.

### 5.2 Regulatory mapping

- **Ontario *Electronic Commerce Act, 2000*:** gives electronic signatures legal force in Ontario; a captured stroke + a per-act attestation satisfies it. No PKI/"qualified" signature is required for a pharmacy prescription — this is not a FDA 21 CFR Part 11 system (roadmap §6.1 confirms Part 11 does not apply), and the *Electronic Commerce Act* deliberately does not mandate PKI.
- **Pharmacy Act / O. Reg. 256/24:** the attestation explicitly cites the regulation and the pharmacist's College registration number (`{{license}}`), binding the legal authority to prescribe to the captured stroke. The printed PDF's attestation line ("Electronically signed by … Reg #… on …") makes the electronic origin and the authority self-evident to the receiving physician and to a College inspector.
- **PHIPA s.12 / s.10.1:** the `pharmacist_signature` credential and the per-act `signed_at` are PHI, inheriting #2's `phi_audit_log` hash chain (tamper-evidence) + AES-256 at rest + TLS in transit.
- **PIPEDA Principles 4.1 / 4.7:** the signed BAA with fly.io (hard gate, inherited from #2) satisfies 4.1 accountability for the third-party processor; AES-256 + TLS satisfy 4.7 safeguards.
- **Retention:** the enrolled credential lives for the pharmacist's tenure; the per-act `signed_at` inherits the assessment's ~10-year Ontario pharmacy record retention (#2). Re-enrollment overwrites the `bytea`, but the `phi_audit_log` preserves the full enrollment history.
- **Not 21 CFR Part 11 (confirmed):** roadmap §6.1 explicitly states Part 11 does not apply to a pharmacy documentation tool; no Part 11 validation is required. #11 therefore does not implement Part 11 controls (audit-review-by-clause, copes of records, device checks) — the PHIPA/`phi_audit_log` controls suffice.

### 5.3 Application security

- **Authorization is app-layer, not RLS** — identical to #2 §5.3. All fly.io `pharmacist_signature` access funnels through `src/lib/signature-store.ts`, which injects `pharmacist_id` + `pharmacy_id` from the verified JWT and accepts neither as a caller parameter. A pharmacist can read/write **only their own** credential (`UNIQUE(pharmacist_id)` + `WHERE pharmacist_id = $jwt`). A CI grep/lint rule (`rg -n "FROM pharmacist_signature|INTO pharmacist_signature" src/lib/signature-store.ts`) verifies every query text contains `pharmacist_id`.
- **Server-side re-validation:** `enrollSignatureAction` never trusts the client's claim that the stroke is non-blank — it re-checks the data URL presence + size cap before the upsert (§4.6 step 3).
- **Mutable credential vs. immutable per-act binding** (the medico-legally correct separation): the `pharmacist_signature` row is the **only mutable PHI write path** in the system besides #3's `withdrawn_*` columns — justified because it is a self-managed credential, not clinical content. Every upsert is audit-logged (`signature.enrolled`), preserving history despite the `bytea` overwrite. The per-act binding (`assessment.pharmacist_signature_id` / `signed_at` / `signing_attestation_version`) is **write-once** — `applySignatureAction`'s `UPDATE ... WHERE signed_at IS NULL` prevents re-stamping on re-download.
- **Stroke transport:** the data URL travels only inside the `enrollSignatureAction` POST body (Server Action), never in a URL, never logged. The stroke is rendered onto the PDF client-side from the React-state data URL, so the printed artefact exists even if persistence is off.
- **Fail-soft (not fail-closed) for persistence; fail-closed for attestation:** a persistence failure (Phase 1) does **not** block `downloadPdf` — the stroke renders from React state and the PDF is print-ready in-session (unlike #3's patient consent, where the signature *is* the legal artefact being gated). The gate that **is** enforced is the attestation: no document is produced without the pharmacist affirming authorship. In Phase 2 (fly.io on), `applySignatureAction` failing *does* block `downloadPdf` (fail-closed), so no document exists without a persisted per-act binding.

---

## 6. Edge Cases

- **fly.io not yet provisioned / BAA unsigned (Phase 1):** `PHI_PERSIST_ENABLED` is off; `getSignatureAction` returns `null` (unenrolled appearance); `enrollSignatureAction`/`applySignatureAction` are no-op stubs returning `null`/`{ok:true}`. The panel still renders, the attestation checkbox still gates, and an inline-captured stroke is baked onto the PDF via the client-side data URL — so the printed/e-faxed document is print-ready and legitimate in-session even with no DB row. A hard refresh loses the in-session stroke (acceptable; the PDF was already produced). The flag and schema are ready so flipping the switch lights up persistence + per-act binding with no further code change.
- **Unenrolled pharmacist at the terminal step:** the panel shows the `<SignaturePad>` for a one-time inline capture + a *"Save as my signature"* checkbox. If they check "save", `enrollSignatureAction` persists the credential (Phase 2) and it auto-applies next time. If they decline, the stroke renders this once only and is not enrolled (one-off); next consult re-prompts.
- **Re-enrollment (the pharmacist re-draws in settings):** `upsertSignature` overwrites the `bytea` + `enrolled_at`; `phi_audit_log signature.enrolled` records the event. Prior documents retain their `signed_at` + `signature_id` pointing at the (now-current) credential row — see Open Question §7.6 on whether NOW needs a per-act stroke snapshot (bytea copied onto the assessment row) for maximal image immutability; recommended **no** for NOW (reference + audit trail suffices).
- **Re-download of an already-signed assessment (idempotency from #2):** `applySignatureAction`'s `WHERE signed_at IS NULL` guard prevents re-stamping; the persisted `signature_id` + `signed_at` are reused, and `getSignatureAction` returns the enrolled stroke to re-render the PDF identically. No duplicate audit event.
- **Pharmacist lacks a license number** (`Profile.provincialLicense` is null): the attestation renders "Registration #: __________" and the PDF attestation line shows "Reg #__________". A pharmacist cannot legally practice without one, so this is a data-completeness issue surfaced (not blocked) — the panel does not gate on it.
- **Vaccination documents (#22):** the VAR PDF is also a pharmacist-authorized document; `applySignatureAction` with `vaccinationId` stamps `vaccination.signed_at` + `vaccination.pharmacist_signature_id` (the columns added in §4.5). The same credential auto-applies.
- **Referral documents:** a referral is still a pharmacist-authorized act (it discloses PHI to the physician and the pharmacist takes responsibility for the red-flag decision). #11 signs referrals too, with `documentType: "referral"` in the attestation.
- **Non-prescribe / abandon outcomes (#4):** a `not_prescribed` or `abandoned` assessment is still a pharmacist decision. Open Question §7.7 — recommend signing all outcomes for consistency (the pharmacist attests the decision regardless of prescribe/refer/not-prescribe), but confirm whether the attestation wording needs a third `documentType`.
- **Pharmacists sharing a workstation:** each is authenticated individually (Supabase JWT); the credential is per-`pharmacist_id`, so there is no cross-contamination. The `<SignaturePad>` canvas is cleared on panel unmount/role switch.
- **Blank or trivial stroke at enrollment:** `signaturePad.isEmpty()` rejects zero-point canvases. A single squiggle is *not* rejected in NOW (validating stroke quality is out of scope and adversarial to real use), mirroring #3 §7.5; the registration number + attestation + audit trail carry the evidentiary weight.
- **Signature data URL too large:** PNGs from `signature_pad` are typically 5–30 KB; a 200 KB cap in `enrollSignatureAction` rejects pathological inputs before the fly.io write (mirrors #3 §6).
- **Withdrawn/retired pharmacist:** their credential row remains (historical assessments reference `signature_id`); a LATER deactivation flow can blank the `bytea` while keeping `signed_at` on historical rows. Out of scope for NOW.
- **Accessibility (motor impairment, no stylus):** the panel offers the typed-name + checkbox attestation fallback (Option C from §3, retained as the accessibility path per #3 §4.4), which renders a typed-name line on the PDF instead of a stroke. The attestation + audit trail still bind the act.
- **Platform admin access:** explicitly **not** granted to `pharmacist_signature` in this tier (mirrors #2 §5.3). Exports go through the existing `export.requested` audit flow, not direct PHI reads.

---

## 7. Open Questions

1. **fly.io provisioning + BAA timing (the hard gate).** Inherited verbatim from #2 §7.1: confirm fly.io Postgres is stood up in a **Canadian region** (`yyz`/`yul`) and the BAA is signed before `PHI_PERSIST_ENABLED` flips true. Signature persistence rides the same flag as #2/#3.
2. **Saved credential (reference) vs. per-act stroke snapshot.** The design references the credential row (`assessment.pharmacist_signature_id`) rather than copying the `bytea` onto each assessment row. This is simpler and keeps the PHI surface small, but means a re-enrolled stroke retroactively changes what a past document's `signature_id` resolves to (the `phi_audit_log` preserves the *history of enrollments*, not prior bytes). If an inspector demands per-act image immutability, snapshot the `bytea` onto the assessment row at signing time. Recommend **reference + audit trail for NOW**; snapshotting is LATER. Confirm.
3. **`<SignaturePad>` ownership / shared location.** #3's spec creates `src/components/consent/signature-pad.tsx`; #11 reuses it. If #11 ships before #3, #11 creates it at a neutral path `src/components/signature/signature-pad.tsx` and #3 imports from there (the component is purpose-agnostic and should not live under `consent/`). Confirm the shared location + the import direction so the two features don't duplicate the component.
4. **Attestation text provenance and legal review.** The §4.2 attestation is drafted to be Ontario/Pharmacy-Act/O.-Reg.-256/24-appropriate but **must be reviewed by a pharmacist and ideally legal counsel** before launch. Confirm the TS-module-under-`src/lib/signature/` location (reproducible `attestation_hash` for #26 governance) — consistent with the now-recurring precedent across #3/#4/#6/#9/#10/#22 — rather than a `data/` file (gnhf forbids `data/` edits this iteration anyway).
5. **Hard gate vs. soft gate at the terminal step.** The design makes the attestation a **hard** gate (no document without affirming authorship) but persistence **soft** (blank-line fallback in Phase 1). Confirm this is the right balance — specifically, whether an unenrolled pharmacist in Phase 1 should be *blocked* from generating until they capture an inline stroke, or *allowed* to fall through to the blank line (today's behaviour). Recommend allow-through (soft) to avoid blocking consults while fly.io is dark.
6. **Re-enrollment image history.** The `bytea` is overwritten on upsert; only `phi_audit_log` preserves enrollment events (timestamps + versions, not prior bytes). Is that sufficient, or must historical strokes be retained? Recommend audit-log-only for NOW; bytea-snapshot-per-enrollment is LATER.
7. **Signing non-prescribe / abandon outcomes (#4).** Should every assessment outcome carry a pharmacist signature, or only `prescribed` + `referred`? Recommend **all outcomes** for consistency (the pharmacist attests the decision regardless of outcome), but confirm whether the attestation needs a third `documentType` (e.g. "decision") beyond `prescription` | `referral`.
8. **Multi-pharmacy pharmacists.** `pharmacist_id` is globally unique (Supabase profile), but `pharmacy_id` scopes the credential. A pharmacist practising at two pharmacies — one credential or one per pharmacy? Recommend **one per `pharmacist_id`** (the stroke is the person's, not the pharmacy's), with `pharmacy_id` as a denormalised scoping/index column updated on upsert. Confirm this does not conflict with #2's `pharmacy_id`-scoping discipline.
9. **College-format compliance.** Does the Ontario College of Pharmacists prescribe a specific prescription signature format, or a wet-ink requirement for any substance? Minor ailments under O. Reg. 256/24 are not controlled substances, so an electronic signature is expected to be College-acceptable (the *Electronic Commerce Act* applies), but confirm with the pharmacy's College compliance contact before launch.
10. **Audit event naming.** `signature.applied` (Supabase non-PHI) vs. `signature.enrolled` (fly.io PHI-only, no Supabase mirror). Confirm this dual-store naming convention is acceptable — it mirrors #2/#3's `assessment.created` (fly.io) vs. `assessment.saved` (Supabase) and `consent.captured` discipline, but #11 is the first case where one of the two events has **no** Supabase mirror at all (because enrollment is intrinsically tied to the identified stroke).

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/types/index.ts` — add `PharmacistSignature`, `PharmacistSigningState` types.
- `src/lib/signature/attestation.ts` — versioned/hashed attestation statement (`PHARMACIST_ATTESTATION_VERSION` + `renderAttestation` + `computeAttestationHash`).
- `src/lib/signature-store.ts` — all fly.io `pharmacist_signature` reads/writes, `pharmacist_id`-scoped, audit-writing (`getCurrentSignature`, `upsertSignature`).
- `src/lib/signature-actions.ts` — `getSignatureAction` / `enrollSignatureAction` / `applySignatureAction` server actions (flag-guarded no-op stubs in Phase 1).
- `src/components/signature/pharmacist-signature-panel.tsx` — terminal-step panel (enrolled preview OR inline capture + attestation).
- `src/components/signature/signature-pad.tsx` — **only if #3 has not already shipped `src/components/consent/signature-pad.tsx`** (Open Question §7.3); otherwise reuse #3's.
- `src/app/settings/signature/page.tsx` + `signature-form.tsx` — credential enrollment/management page (pharmacist self-service).
- `src/__tests__/pharmacist-signature-panel.test.tsx`, `src/__tests__/signature-actions.test.ts`, `src/__tests__/signature-store.test.ts`, `src/__tests__/attestation.test.ts` — panel validity logic, action flag-guard + non-PHI audit shape, store pharmacist-scoping, attestation hash determinism.

**Modified:**
- `src/lib/audit-actions.ts` — add `"signature.applied"` to the `EventType` union.
- `src/components/combined-pdf.tsx`, `src/components/wizard/referral-pdf.tsx` — add `pharmacistSignatureDataUrl` / `signedAt` / `attestationVersion` / `documentType` props; render `<Image>` in the pharmacist signature slot when present; append the attestation line.
- `src/components/wizard/step-generate.tsx` — render `<PharmacistSignaturePanel>`; gate the Download button on `attested` + stroke; call `applySignatureAction` → `saveConsentAction` (#3) → `saveAssessmentAction` before `downloadPdf`; thread the stroke into `<CombinedPdf>`.
- `src/components/wizard/wizard-container.tsx` — render the panel in the referral branch; gate `handleDownloadReferral`; thread the stroke into `<ReferralPdf>` with `documentType: "referral"`.
- `src/app/assess/[ailment]/page.tsx` — call `getSignatureAction()` server-side and pass the enrolled `PharmacistSignature | null` into `<WizardContainer>` (the `Profile` identity plumbing already exists per §2.2; #11 adds only the signature fetch).
- `src/lib/assessment-actions.ts` (from #2) — accept `signatureId` + `signedAt` + `attestationVersion` and write the `assessment` columns.
- `src/lib/vaccination-store.ts` / `src/lib/vaccination-actions.ts` (from #22) — accept the same and write the `vaccination` columns.
- `src/app/settings/` layout/nav — add a link to the new signature settings page.

**Database (fly.io, applied at provisioning, extends #2/#22 schema):** `pharmacist_signature` table + `assessment` columns (`pharmacist_signature_id`, `signed_at`, `signing_attestation_version`) + `vaccination` columns (same three) + `phi_audit_log` `signature.enrolled` / `signature.applied` write paths.

**Database (Supabase, non-PHI):** add `signature.applied` to `audit.event_type`; extend `log_event` validation (require `signature_id` + `attestation_version`; reject patient/stroke/clinical keys).

**Environment (server-only):** no new env vars — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`. `react-signature-canvas` (+ peer `signature_pad`) is added as a **local** dependency (per the user's standing preference) — shared with #3, so added once by whichever ships first.
