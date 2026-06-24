# Pharmacist e-Signature on PDF — Implementation Plan

**Date:** 2026-06-24
**Roadmap item:** #11 (NEXT tier) — "Pharmacist e-signature on PDF — Print-ready, legitimate"
**Design:** `docs/superpowers/specs/2026-06-24-pharmacist-e-signature-design.md`
**Status:** Draft (pending review)

---

## Goal

Capture the prescribing pharmacist's stroke signature, render it onto both the prescription (`combined-pdf.tsx`) and referral (`referral-pdf.tsx`) PDFs in the existing pharmacist signature slot so the printed/e-faxed artefact is print-ready and legitimate without a wet-ink step, enroll it as a reusable per-pharmacist credential on fly.io (under BAA, behind `PHI_PERSIST_ENABLED`), and bind each issued document to the credential via a per-act attestation (`signed_at` + `signature_id` + immutable `phi_audit_log`). Mirrors the established patterns: #3's `<SignaturePad>` reuse, #2's fly.io persistence + flag-guarded server actions, and the versioned/hashed `src/lib/` content-governance module.

Phases:
- **Phase 1 (fly.io off / BAA unsigned):** `<SignaturePad>` capture (inline + enrolled-in-session) renders the stroke onto the PDF client-side; attestation gates the Download button; server actions are flag-guarded no-op stubs. The PDF is print-ready in-session.
- **Phase 2 (fly.io on / BAA signed / `PHI_PERSIST_ENABLED=true`):** the credential persists; per-act binding + audit events light up with no further code change.

---

## Sequenced Steps (each a small, verifiable unit)

### Task 1 — Types + versioned attestation module

**Create:**
- `src/types/index.ts` — add `PharmacistSignature` and `PharmacistSigningState` (design §4.1).
- `src/lib/signature/attestation.ts` — `PHARMACIST_ATTESTATION_VERSION = "pharmacist-esig-v1"`, the `PHARMACIST_ATTESTATION` template with `{{license}}` / `{{documentType}}`, `renderAttestation(license, documentType)`, and `computeAttestationHash()` via `node:crypto` `createHash("sha256")` over the canonical template (design §4.2). Pure module, no side effects, SSR-safe.

**Verify:**
- `npm run typecheck` passes.
- Unit test `src/__tests__/attestation.test.ts`:
  - `PHARMACIST_ATTESTATION_VERSION` is a non-empty string.
  - `renderAttestation("12345", "prescription")` contains "Reg #12345" and "prescription" and "O. Reg. 256/24".
  - `renderAttestation(null, "referral")` contains "Reg #__________" (graceful null).
  - `computeAttestationHash()` is a 64-char hex string and is deterministic across two calls in one process.
  - `PHARMACIST_ATTESTATION` contains both interpolation tokens `{{license}}` and `{{documentType}}` exactly once each.

### Task 2 — `<SignaturePad>` (reuse or create at neutral path)

**Decision (design §7.3):** inspect `src/components/consent/signature-pad.tsx`. If present (shipped by #3), import it. If absent, **create** it at the neutral path `src/components/signature/signature-pad.tsx` so both #3 and #11 share it:

- Client-only, exported via `next/dynamic` with `{ ssr: false }` (because `signature_pad` touches `window`).
- Wraps `react-signature-canvas` (peer `signature_pad`); added as a **local** dependency in `package.json` (never global, per user preference).
- Props: `onChange(dataUrl: string | null)`, `onClear()`, `aria-label: string`, `width: number`, `height: number`, `disabled: boolean`.
- Blank detection: emits `null` when `signaturePad.isEmpty()`.

**Verify:**
- `npm run typecheck` + `npm run lint` pass.
- `npm run build` succeeds (SSR-safe import confirmed — no `window is not defined` at build).
- If created here, a component smoke test asserts `onChange(null)` fires on mount (blank canvas) and a `data:image/png` string fires after a programmatic stroke.

### Task 3 — fly.io `pharmacist_signature` migration + `signature-store.ts`

**Create:**
- `docs/superpowers/migrations/2026-06-24-pharmacist-signature.sql` (or the project's migration home; applied at fly.io provisioning): the `pharmacist_signature` table + indexes (design §4.5); the `ALTER TABLE assessment ADD COLUMN pharmacist_signature_id / signed_at / signing_attestation_version` + index; the `ALTER TABLE vaccination ADD COLUMN ...` (same three). This migration is **additive** to #2's and #22's schemas.
- `src/lib/signature-store.ts`:
  - `getCurrentSignature(pharmacistId: string, pharmacyId: string): Promise<PharmacistSignature | null>` — `SELECT ... WHERE pharmacist_id = $1 AND pharmacy_id = $2`; decode `signature_png` bytea → `data:image/png;base64,...`. Returns `null` when `PHI_PERSIST_ENABLED !== "true"` or no row.
  - `upsertSignature(pharmacistId, pharmacyId, pngDataUrl, attestationVersion, attestationHash): Promise<{ id: string } | null>` — decode data URL → bytea; `INSERT ... ON CONFLICT (pharmacist_id) DO UPDATE SET signature_png = EXCLUDED.signature_png, attestation_version = ..., attestation_hash = ..., enrolled_at = now() RETURNING id`; write a `phi_audit_log` row (`event_type = 'signature.enrolled'`, metadata `{ signature_id, attestation_version }`). No-op (`null`) when the flag is off.
  - Every query text contains `pharmacist_id` (CI grep guard, mirroring #2 §5.3).
  - Uses #2's `src/lib/phi/db.ts` `pg.Pool`; throws if the pool is unavailable and the flag is on (fail-loud on misconfiguration, not silent).

**Verify:**
- Unit test `src/__tests__/signature-store.test.ts` (mocked `pg.Pool`):
  - `getCurrentSignature` returns `null` when `PHI_PERSIST_ENABLED` unset.
  - `getCurrentSignature` returns a `PharmacistSignature` with a `data:image/png` URL when a row exists and the flag is on.
  - `upsertSignature` issues `INSERT ... ON CONFLICT (pharmacist_id) DO UPDATE` (assert the SQL text contains both `ON CONFLICT (pharmacist_id)` and `pharmacist_id = $`).
  - `upsertSignature` writes exactly one `phi_audit_log` row with `event_type = 'signature.enrolled'`.
  - `rg -n "FROM pharmacist_signature|INTO pharmacist_signature" src/lib/signature-store.ts` returns lines that all contain `pharmacist_id` (the CI guard).
- `npm run test src/__tests__/signature-store.test.ts` passes.

### Task 4 — Server actions (`src/lib/signature-actions.ts`)

**Create** `src/lib/signature-actions.ts` (`"use server"`):
- `getSignatureAction(): Promise<PharmacistSignature | null>` (design §4.6).
- `enrollSignatureAction({ signatureDataUrl: string; saveAsCredential: boolean }): Promise<{ ok: boolean }>` — `requireAuth()` → `pharmacyId` bail → flag guard (off → `{ ok: true }`) → re-validate data URL present + ≤ 200 KB + `data:image/png` prefix → `upsertSignature(...)` with `PHARMACIST_ATTESTATION_VERSION` + `computeAttestationHash()`.
- `applySignatureAction({ documentType: "prescription" | "referral"; assessmentId?: string; vaccinationId?: string }): Promise<{ signedAt: string | null; signatureId: string | null }>` — `requireAuth()` → flag guard (off → nulls) → look up current `pharmacist_signature.id` (must be enrolled; else bail null) → `UPDATE assessment|vaccination SET pharmacist_signature_id = $, signed_at = now(), signing_attestation_version = $ WHERE id = $ AND pharmacy_id = $ AND signed_at IS NULL` (write-once guard) → `phi_audit_log signature.applied` metadata `{ signature_id, attestation_version, document_type }` → Supabase `signature.applied` metadata strictly `{ signature_id, attestation_version }` → return `{ signedAt, signatureId }`.

**Verify:**
- Unit test `src/__tests__/signature-actions.test.ts`:
  - `getSignatureAction` returns `null` when `PHI_PERSIST_ENABLED` unset (mock `requireAuth` + store).
  - `enrollSignatureAction` returns `{ ok: true }` without calling the store when the flag is off.
  - `enrollSignatureAction` rejects a missing data URL, an oversized data URL (> 200 KB), and a non-`data:image/png` prefix (assert it returns `{ ok: false }` or throws per the chosen convention — the test pins this).
  - `applySignatureAction` issues an `UPDATE ... WHERE signed_at IS NULL` (assert the SQL text).
  - `applySignatureAction` emits a Supabase `signature.applied` event whose metadata has **exactly** the keys `signature_id` + `attestation_version` and **no** stroke/patient/ailment key (PHI-leak guard).
- `npm run test src/__tests__/signature-actions.test.ts` passes.

### Task 5 — Audit event union + Supabase `log_event` validation

**Modify** `src/lib/audit-actions.ts:5-18` — add `"signature.applied"` to the `EventType` union.

**Migration (Supabase, non-PHI):** add `signature.applied` to `audit.event_type`; extend the `log_event` SECURITY DEFINER RPC validation to require `{ signature_id, attestation_version }` and reject patient/stroke/clinical keys (`patient_*`, `name`, `ailment`, `png`, `image`, `signature_*_png`, `stroke`). Mirror the `consent.captured` validation shape from #3.

**Verify:**
- `rg -n "signature.applied" src/lib/audit-actions.ts` returns the union line.
- `rg -n "NEXT_PUBLIC" src/lib/signature-actions.ts src/lib/signature-store.ts src/lib/signature/attestation.ts` returns nothing (no client-exposed secrets).
- `npm run typecheck` passes.

### Task 6 — `<PharmacistSignaturePanel>`

**Create** `src/components/signature/pharmacist-signature-panel.tsx` (client component):
- Props per design §4.4.
- **Enrolled mode** (`enrolled !== null`): renders a read-only `<img src={enrolled.signatureDataUrl}>` preview + pharmacist name + license + the rendered attestation (`renderAttestation`) + an attestation checkbox.
- **Unenrolled mode**: renders the `<SignaturePad>` (Task 2) + a *"Save as my signature for future prescriptions"* checkbox + the attestation checkbox.
- Computes validity: `attested === true && !!signatureDataUrl` (enrolled preview counts as the data URL; inline capture requires a non-`null` pad emission). Calls `onChange(validState | null)`.
- Clears the pad on unmount/`documentType` change.

**Verify:**
- Component test `src/__tests__/pharmacist-signature-panel.test.tsx`:
  - Enrolled mode: attestation unchecked → `onChange(null)`; checked → `onChange` returns a state with `attested: true` + the enrolled data URL.
  - Unenrolled mode: blank pad → `onChange(null)`; after a stroke (`onChange` fires a data URL) + attestation checked → `onChange` returns valid state; the *"Save"* checkbox toggles a flag in the returned state.
  - Renders the rendered attestation text containing the license and documentType.
  - Accessibility fallback: a `captureMethod === "typed"` toggle (per design §6) renders a typed-name `<Input>` instead of the pad and the panel validates `signerName` non-empty.
- `npm run test src/__tests__/pharmacist-signature-panel.test.tsx` passes.

### Task 7 — PDF rendering on both documents

**Modify** `src/components/combined-pdf.tsx`:
- Extend `CombinedPdfProps` (`combined-pdf.tsx:159-169`) with `pharmacistSignatureDataUrl?: string`, `signedAt?: string`, `attestationVersion?: string`, `documentType?: "prescription" | "referral"`.
- In the signature slot (`combined-pdf.tsx:309-315`): when `pharmacistSignatureDataUrl` is present, render `<Image src={pharmacistSignatureDataUrl} style={{ height: 28, width: "auto", objectFit: "contain" }} />` (import `Image` from `@react-pdf/renderer`, already in `package.json`) **instead of** `<View style={styles.signatureLine} />`; append a `<Text>` attestation line: `Electronically signed by {pharmacy?.pharmacistName} (Reg #{pharmacy?.provincialLicense}) on {signedAt} — {attestationVersion}.` When absent, render the existing blank line unchanged (graceful degradation).

**Modify** `src/components/wizard/referral-pdf.tsx`:
- Extend `ReferralPdfProps` (`referral-pdf.tsx:144-150`) with the same four props.
- Apply the identical slot change (`referral-pdf.tsx:222-228`) with `documentType: "referral"` default.

**Verify:**
- Component test additions (or snapshot tests) for `combined-pdf` / `referral-pdf`:
  - With `pharmacistSignatureDataUrl` set → the rendered document contains the `<Image>` and the "Electronically signed by" line; does **not** contain a blank `signatureLine`.
  - Without → contains the blank `signatureLine`; does **not** contain the attestation line (byte-identical to today's output).
- `rg -n "signatureLine" src/components/combined-pdf.tsx src/components/wizard/referral-pdf.tsx` still returns the style def (kept for the absent-stroke branch).
- `npm run build` succeeds (PDF render server-safe).

### Task 8 — Wizard wiring (prescribe + referral)

**Modify** `src/components/wizard/step-generate.tsx`:
- Add `enrolledSignature: PharmacistSignature | null`, `pharmacistName`, `license` to `StepGenerateProps` (threaded from `WizardContainer`).
- Add state `const [signing, setSigning] = useState<PharmacistSigningState | null>(null)`.
- Render `<PharmacistSignaturePanel>` above the Download button (`step-generate.tsx:74`).
- Gate the Download button: `disabled` unless `signing !== null && signing.attested && !!signing.signatureDataUrl`.
- `handleDownload` (`step-generate.tsx:26-51`): after `reserveTxId`, call `applySignatureAction({ documentType: "prescription", assessmentId })` (if enrolled/Phase 2) → `saveConsentAction` (#3) → `saveAssessmentAction({ ..., signatureId: signing.signedAt ? ... : null, signedAt })` → thread `pharmacistSignatureDataUrl={signing.signatureDataUrl}`, `signedAt`, `attestationVersion` into `<CombinedPdf>` → `downloadPdf`. Fail-closed: a thrown action error blocks `downloadPdf` (Phase 2 only; Phase 1 stubs return null and proceed).

**Modify** `src/components/wizard/wizard-container.tsx`:
- Add `enrolledSignature: PharmacistSignature | null` to `WizardContainerProps`.
- Thread `enrolledSignature` + pharmacist name/license into `<StepGenerate>` and the referral branch.
- Add `signing` state; render `<PharmacistSignaturePanel>` in the referral branch (`wizard-container.tsx:142-172`) with `documentType="referral"`.
- Gate the referral Download button (`wizard-container.tsx:167`) on the same validity; `handleDownloadReferral` (`wizard-container.tsx:89-99`) calls `applySignatureAction({ documentType: "referral", assessmentId })` → `saveConsentAction` → `saveAssessmentAction` → thread the stroke into `<ReferralPdf>` → `downloadPdf`.

**Modify** `src/app/assess/[ailment]/page.tsx`:
- After `requireAuth()` (`assess/[ailment]/page.tsx:14`), call `getSignatureAction()` and pass the result as `enrolledSignature` into `<WizardContainer>` (`assess/[ailment]/page.tsx:53`). (The pharmacist identity is already bound via `profile.fullName`/`profile.provincialLicense` per §2.2; #11 adds only the signature fetch.)

**Verify:**
- `npm run typecheck` + `npm run lint` + `npm run build` pass.
- Manual/staging: an enrolled pharmacist sees the preview + attestation; an unenrolled pharmacist sees the pad + *"Save"* checkbox. Download is disabled until attested + stroke present.

### Task 9 — Settings enrollment page

**Create** `src/app/settings/signature/page.tsx` (server component, mirroring `src/app/settings/profile/page.tsx`):
- `requireAuth()` → `getSignatureAction()` → render `<SignatureForm enrolled={...} pharmacistName={profile.fullName} license={profile.provincialLicense} />`.

**Create** `src/app/settings/signature/signature-form.tsx` (client component):
- If `enrolled`, show the current stroke preview + "Re-enroll" (clears + shows the pad) + "Remove my signature" (calls a `clearSignatureAction` — a Phase-2 action that deletes/blanks the row; Phase-1 stub).
- If not enrolled, show the `<SignaturePad>` + an "Enroll" button → `enrollSignatureAction({ signatureDataUrl, saveAsCredential: true })`.
- Show the attestation text + a confirm checkbox before the Enroll button (the pharmacist acknowledges what the signature authorizes).

**Modify** the settings nav (the `src/app/settings/` layout/sidebar) — add a "Signature" link.

**Verify:**
- `npm run build` passes (the dynamic `<SignaturePad>` import is `ssr: false`).
- Manual/staging: enroll → the enrolled stroke round-trips through fly.io and reappears on next page load (Phase 2); Phase 1 stub returns `null` and the form shows the pad without error.

### Task 10 — `#2` / `#22` assessment + vaccination write extensions

**Modify** `src/lib/assessment-actions.ts` (from #2's plan):
- `saveAssessmentAction` payload gains optional `signatureId?: string | null`, `signedAt?: string | null`, `attestationVersion?: string`.
- `assessment-store.ts` `INSERT INTO assessment` includes `pharmacist_signature_id`, `signed_at`, `signing_attestation_version` when provided (or `applySignatureAction` has already stamped them via the `UPDATE`; confirm the composition — design §4.6 step 4 uses `applySignatureAction`'s write-once `UPDATE`, so `saveAssessmentAction` does **not** re-write them; the columns are stamped by `applySignatureAction` only. If the team prefers a single transaction, fold the stamp into `saveAssessmentAction` instead — Open Question, design §7.2-adjacent).

**Modify** `src/lib/vaccination-store.ts` / `src/lib/vaccination-actions.ts` (from #22's plan):
- Same optional payload fields; same stamping rule for the `vaccination` table.

**Verify:**
- `npm run typecheck` passes.
- Unit test additions: `saveAssessmentAction` with a `signatureId` produces an `INSERT`/`UPDATE` containing `pharmacist_signature_id`; without it, the column is null (no regression for unsigned assessments).
- `rg -n "pharmacist_signature_id" src/lib/assessment-actions.ts src/lib/vaccination-actions.ts src/lib/signature-actions.ts` returns the expected call sites.

### Task 11 — Tests (whole-feature + guards)

- Add/extend `src/__tests__/step-generate.test.tsx` (and the referral-branch assertions) to cover the new gate (disabled until attested + stroke) and the action ordering (`applySignatureAction` before `saveAssessmentAction` before `downloadPdf`) — mock the three actions and assert call order.
- Add `src/__tests__/signature-pdf.test.tsx` covering both PDFs with and without the stroke (Task 7 assertions consolidated).
- **CI guard greps** (added to the test file or a `scripts/`-free inline `test.concurrent`):
  - `rg -n "NEXT_PUBLIC" src/lib/signature-actions.ts src/lib/signature-store.ts src/lib/signature/attestation.ts src/components/signature/` → must be empty (no client-exposed secrets).
  - `rg -n "signature.*png|signature_png|signatureDataUrl" src/lib/audit-actions.ts` → must be empty (no stroke reference in the Supabase audit path).
  - `rg -n "FROM pharmacist_signature|INTO pharmacist_signature" src/lib/signature-store.ts` → every hit line contains `pharmacist_id`.
  - `rg -n "twilio|resend|node-cron" package.json` → unchanged (no new transport dependency introduced by #11).

**Verify:**
- `npm run test` (full suite) passes.

### Task 12 — Whole-repo verification

- `npm run typecheck` — passes.
- `npm run lint` — passes.
- `npm run test` — passes (all new + existing tests).
- `npm run build` — passes; the `<SignaturePad>` dynamic import is `ssr: false` and does not break the server build.
- `rg -n "signature" src/components/combined-pdf.tsx src/components/wizard/referral-pdf.tsx` — confirms the `<Image>` branch + the graceful-degradation blank-line branch both exist.

---

## Files to Create / Modify (consolidated, real paths)

**Create:**
- `src/types/index.ts` (modify — add types)
- `src/lib/signature/attestation.ts`
- `src/lib/signature-store.ts`
- `src/lib/signature-actions.ts`
- `src/components/signature/pharmacist-signature-panel.tsx`
- `src/components/signature/signature-pad.tsx` (**only if #3 has not shipped** `src/components/consent/signature-pad.tsx` — design §7.3)
- `src/app/settings/signature/page.tsx`
- `src/app/settings/signature/signature-form.tsx`
- `docs/superpowers/migrations/2026-06-24-pharmacist-signature.sql` (or the project's migration home)
- `src/__tests__/attestation.test.ts`
- `src/__tests__/signature-store.test.ts`
- `src/__tests__/signature-actions.test.ts`
- `src/__tests__/pharmacist-signature-panel.test.tsx`
- `src/__tests__/signature-pdf.test.tsx`

**Modify:**
- `src/lib/audit-actions.ts` — add `"signature.applied"` to `EventType`.
- `src/components/combined-pdf.tsx` — signature-slot `<Image>` + attestation line.
- `src/components/wizard/referral-pdf.tsx` — same.
- `src/components/wizard/step-generate.tsx` — panel render + gate + action ordering + PDF props.
- `src/components/wizard/wizard-container.tsx` — referral-branch panel + gate + ordering + PDF props + `enrolledSignature` prop plumbing.
- `src/app/assess/[ailment]/page.tsx` — `getSignatureAction()` fetch + pass-through.
- `src/lib/assessment-actions.ts` (from #2) — optional `signatureId`/`signedAt` payload acceptance.
- `src/lib/vaccination-store.ts` / `src/lib/vaccination-actions.ts` (from #22) — same.
- `src/app/settings/` layout/nav — "Signature" link.
- `package.json` — `react-signature-canvas` + peer `signature_pad` as **local** deps (**only if #3 has not already added them**).

---

## Data / DB Changes

**fly.io Postgres (PHI, under BAA):**
- New `pharmacist_signature` table (id, pharmacist_id UNIQUE, pharmacy_id, signature_png bytea, attestation_version, attestation_hash, enrolled_at, created_at) + two indexes (design §4.5).
- `assessment` (from #2) += `pharmacist_signature_id uuid REFERENCES pharmacist_signature(id)`, `signed_at timestamptz`, `signing_attestation_version text` + a partial index on `signed_at`.
- `vaccination` (from #22) += the same three columns.
- `phi_audit_log` += two new event types: `signature.enrolled` (PHI-only, written by `upsertSignature`) and `signature.applied` (written by `applySignatureAction`).

**Supabase (non-PHI):**
- `audit.event_type` += `signature.applied`.
- `log_event` validation: require `{ signature_id, attestation_version }`; reject stroke/patient/clinical keys.

**No new env vars** — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.

---

## Tests

- **Unit:** `attestation.test.ts` (version + render + hash determinism), `signature-store.test.ts` (flag guard, upsert SQL + audit row, `pharmacist_id` scoping), `signature-actions.test.ts` (flag guard, validation, write-once `UPDATE`, non-PHI audit shape).
- **Component:** `pharmacist-signature-panel.test.tsx` (enrolled/unenrolled modes, attestation gate, accessibility typed fallback), `signature-pdf.test.tsx` (both PDFs with + without stroke).
- **Integration:** `step-generate.test.tsx` extensions (gate disabled→enabled, action ordering `applySignatureAction` → `saveConsentAction` → `saveAssessmentAction` → `downloadPdf`).
- **CI guard greps:** no `NEXT_PUBLIC` in signature modules; no stroke reference in the Supabase audit path; every `pharmacist_signature` query contains `pharmacist_id`; no new transport dependency in `package.json`.

---

## Verification Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build

# Guard greps (expected: empty / the asserted pattern)
rg -n "NEXT_PUBLIC" src/lib/signature-actions.ts src/lib/signature-store.ts src/lib/signature/attestation.ts src/components/signature/
rg -n "signature.*png|signature_png|signatureDataUrl" src/lib/audit-actions.ts          # must be empty
rg -n "FROM pharmacist_signature|INTO pharmacist_signature" src/lib/signature-store.ts  # every line has pharmacist_id
rg -n "twilio|resend|node-cron" package.json                                             # unchanged
rg -n "signature.applied" src/lib/audit-actions.ts                                      # the new union member
```

---

## Rollout Notes

- **Hard gate (blocks Phase 2):** signed fly.io BAA (roadmap §7 #2) + `PHI_PERSIST_ENABLED=true` + `react-signature-canvas`/`signature_pad` installed locally. Until these land, #11 ships in Phase 1 (stroke renders client-side from React state; server actions are no-op stubs; the PDF is print-ready in-session).
- **Soft gates (review, not blocking):**
  - Pharmacist + legal review of the attestation text (`src/lib/signature/attestation.ts`) before launch — it is the medico-legal wording on every issued prescription.
  - Ontario College of Pharmacists confirmation that an electronic signature (stroke + attestation) is acceptable for O. Reg. 256/24 minor-ailments prescriptions (expected yes under the *Electronic Commerce Act, 2000*; controlled substances are out of scope and not signed here).
- **No flag of its own:** #11 reuses #2's `PHI_PERSIST_ENABLED` exactly as #1/#3/#4/#22/#10 do — no new env var, no new ops surface.
- **Sibling coordination:** confirm with #3 which feature ships `<SignaturePad>` first (design §7.3) so the component is single-instance. Confirm with #2 whether the per-act stamp lands in `applySignatureAction` (write-once `UPDATE`) or in `saveAssessmentAction` (single transaction) — the plan defaults to the former for immutability; the latter is a valid alternative.
- **Phase-1 user-visible value:** even with fly.io dark, the PDF stops requiring a wet-ink step (the captured stroke bakes in client-side), which is the roadmap #11 headline ("print-ready, legitimate"). Persistence + per-act audit are the Phase-2 compliance deepening.
