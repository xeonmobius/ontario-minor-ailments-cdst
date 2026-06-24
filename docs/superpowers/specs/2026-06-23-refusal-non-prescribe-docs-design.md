# Refusal / Non-Prescribe Documentation — Design

**Date:** 2026-06-23
**Roadmap item:** #4 (NOW tier) — "Refusal / non-prescribe documentation"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST lets an Ontario pharmacist assess and prescribe for 19 minor ailments under **O. Reg. 256/24**. The wizard (`src/components/wizard/wizard-container.tsx:40`) admits exactly **two** terminal outcomes today: **prescribe** (`step-generate.tsx:22`) or **red-flag referral** (the `isReferral` branch, `wizard-container.tsx:142-172`). There is no third path. If a pharmacist screens a patient, finds **no red flag**, and then — for any clinical or patient-driven reason — does **not** prescribe (the patient declines the Rx; OTC/self-care advice is sufficient; the pharmacist's clinical judgment is that no prescription is appropriate; the patient is already treating; the patient asks to see their own physician for a non-red-flag reason), the wizard has nowhere to go: `canNext` at step 2 requires `selectedRx !== null` (`wizard-container.tsx:57-58`), so the pharmacist's only forward options are "pick an Rx" or "go back and check a red flag you did not actually find." Equally, if an assessment is started and the patient walks away, defers, or is lost mid-consult, there is no "assessment not completed" affordance — the pharmacist simply abandons the page and the encounter leaves zero trace.

The result is that **no record is kept of a non-prescribing decision**, which is the exact gap the competitive research flags as ODPRN-identified and industry-wide: *"Refusal reasoning is not captured… inconsistent refusal documentation"* (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §3, gap table row "Refusal/non-prescribe path undocumented"). For an Ontario pharmacist prescribing under the minor-ailments authority, the *decision not to prescribe* is itself a clinically- and legally-significant act that the Ontario College of Pharmacists expects to be documented to the same standard as a prescription — both for continuity of care (the next pharmacist needs to know this patient was assessed and why no Rx issued) and for professional-liability defence (the artefact proves a conscious, reasoned decision, not an omission).

**The goal of this feature** is to add a third terminal outcome — **`not_prescribed`** — to the wizard, captured at the point of decision (step 2, where the Rx would otherwise be selected), with a structured reason taxonomy + a clinician free-text rationale, producing a dedicated **Non-Prescribe Documentation PDF** that is self-contained and print/college-defensible; to add a fourth outcome — **`abandoned`** — for assessments started but not completed, via a wizard-level "Assessment Not Completed" action; and to persist both to roadmap #2's fly.io PHI store (extending #2's `assessment.outcome` enum, which already reserves the `abandoned` value, with `not_prescribed`) behind the same `PHI_PERSIST_ENABLED` flag. It reuses #3's `ConsentPanel` verbatim on the non-prescribe branch (a patient who declines treatment still authorises the pharmacy to retain the record under PHIPA), and it reuses the existing `nonRx` self-care advice list (`step-rx.tsx:110-139`) as the structured "advice given" payload that distinguishes *no Rx + self-care advice* from *no Rx + referred*.

**Out of scope** (per roadmap §3 and §6): allergy/drug-interaction/pregnancy safety logic (PMS-owned), billing/claims (PMS-owned), an amend/correct workflow for non-prescribe records (immutability inherited from #2; corrections are LATER amendment rows), longitudinal care-plan linking beyond the #2 `patient` index (LATER #28), and a patient-facing "why was I not prescribed" explanation portal (the PDF is the patient-facing artefact). Non-red-flag **referral to a physician** is in scope as one `non_prescribe_reason` value that reuses the existing `<ReferralPdf>` path with a context flag (§4.7), not as a new document.

---

## 2. Current State (what exists in code)

### 2.1 The wizard has no third outcome

`WizardContainer` (`wizard-container.tsx:40`) holds the assessment in `useState` and advances a 4-step machine (`step` 0→3). The forward gate (`wizard-container.tsx:52-59`) is:

```ts
const canNext =
  step === 0 ? !!(patient.name && patient.dob)
  : step === 1 ? redFlagsChecked.length === 0   // any red flag → only "Generate Referral"
  : step === 2 ? selectedRx !== null             // MUST pick an Rx to advance
  : true
```

So at step 2 (`Select Rx`, `step-rx.tsx:20`) the **only** way forward is to select a prescription (`wizard-container.tsx:57-58`). The two terminal branches at step 3 are exhaustive and exclusive:

1. `step === 3 && isReferral` → referral summary + Download Referral PDF (`wizard-container.tsx:142-172`).
2. `step === 3 && !isReferral && selectedRx` → `<StepGenerate>` prescribe path (`wizard-container.tsx:173-183`).

There is **no branch** for "assessment completed, no prescription issued." A `rg` for `refus|abandon|declin|non-prescrib|withheld|did not prescrib` across `src/` returns nothing — the concept does not exist in the codebase.

### 2.2 Referral is red-flag-only and leaves a partial trace

`isReferral` is set exclusively by `handleReferral()` (`wizard-container.tsx:84-87`), which is invoked by the "Generate Referral" button in `WizardNav` — and that button is rendered **only** when `hasRedFlags && step === 1` (`wizard-nav.tsx:71`, `wizard-container.tsx:187`). A pharmacist who wants to refer for a non-red-flag reason (patient preference, suspected out-of-scope condition) has no UI path. The referral PDF (`referral-pdf.tsx`) is hardcoded to a red-flag context: its body is "Red Flags Identified" (`referral-pdf.tsx:212-220`) and its footer reads "Patient referred… due to identified red flags" (`referral-pdf.tsx:232`). Per #2's design, the referral path will persist `outcome: 'referred'` with `has_red_flag = true` (`2026-06-23-persist-assessments-flyio-design.md` §4.7) — a non-red-flag referral has no persistence home.

### 2.3 The "Non-Rx Advice" list is the closest existing analog

`StepRx` renders an ailment's `nonRx` self-care items as a checkbox list (`step-rx.tsx:110-139`, sourced from `data/ailments.json` — e.g. acne's `nonRx` at `ailments.json:57`). The checked items (`nonRxChecked` state, `wizard-container.tsx:47`) are today only ever shown on the **prescribe** PDF ("Non-Prescription Advice Provided", `combined-pdf.tsx:286-299`). They are the natural payload for the *"no Rx, but self-care advice given"* case — but they are currently unreachable unless the pharmacist first selects a prescription.

### 2.4 #2's schema reserves `abandoned` but not `not_prescribed`; neither has a UI

Roadmap #2's `assessment` table (`2026-06-23-persist-assessments-flyio-design.md` §4.3) defines:

```sql
outcome text NOT NULL CHECK (outcome IN ('prescribed','referred','abandoned'))
```

The `abandoned` value is named but **has no producer** anywhere in #2's plan — #2's open question §7.4 explicitly defers it: *"Should 'abandoned' assessments be persisted? … #4 refusal docs depends on a persistence home."* There is **no** `not_prescribed` value in #2's enum, so #4 must extend the CHECK constraint. There is also no `non_prescribe_reason` / rationale column on #2's `assessment` table — #4 adds them.

### 2.5 The persistence + audit + consent foundation (#2, #3) is specified but not shipped

#4 is the third feature layered on #2's fly.io PHI store and #3's consent capture:

- **#2** provides `patient` / `assessment` / `phi_audit_log` (`persist-assessments-flyio-design.md` §4.3–4.4), the `saveAssessmentAction` server action (#2 plan Task 7), the `PHI_PERSIST_ENABLED` flag, and the `assessment.saved` non-PHI Supabase audit event (`audit-actions.ts:5-18`, metadata strictly `{ assessment_id, outcome }`).
- **#3** provides the `ConsentPanel` (`digital-consent-capture-design.md` §4.4), the `consent_id` linkage on `assessment`, and the stub-behind-flag pattern that lets UI ship in Phase 1 while fly.io is dark. #3's edge-case list (`digital-consent-capture-design.md` §6) explicitly says: *"for a refusal of the assessment itself — that flow is roadmap #4 (refusal/non-prescribe documentation), where the consent panel is reused with `outcome: 'abandoned'`."*

fly.io is **not yet provisioned** and the **BAA is not yet signed** (roadmap §7 open questions #1, #2), so — exactly as #1, #2, and #3 do — #4 ships dark behind `PHI_PERSIST_ENABLED`: the non-prescribe UI, the documentation PDF, and the abandonment action all land in Phase 1 (the printed PDF is itself the durable legal artefact), and the fly.io writes + `assessment.saved` events light up automatically in Phase 2 with no further code change.

### 2.6 Identity, scoping, and PDF primitives already exist

- `requireAuth()` (`src/lib/auth-guards.ts:44`) → `{ id, pharmacyId, ... }` is the actor + scoping pair every fly.io row needs.
- PDF generation is 100% client-side via `pdf(document).toBlob()` (`src/lib/pdf-helpers.ts:5`), so a new `<NonPrescribePdf>` document component follows the identical render path as `<CombinedPdf>` and `<ReferralPdf>` — no server round-trip, no new transport. `downloadPdf(doc, filename)` (`pdf-helpers.ts`) is reused unchanged.
- The `<ConsentPanel>` from #3 is a self-contained, validity-emitting component (`digital-consent-capture-design.md` §4.4) that #4 drops into the non-prescribe branch with no modification.

---

## 3. Approach (options + recommendation)

The design hinges on five decisions: (a) where in the wizard the non-prescribe decision is captured, (b) the granularity of the reason taxonomy, (c) the documentation artefact (new PDF vs. reuse), (d) how abandonment is exposed, and (e) how non-prescribe data is persisted and audited. Options are evaluated against roadmap §6.2 (PHI on fly.io, Supabase = auth + non-PHI), §6.4 (the partitioning rule), and §4 (counter-speed wedge: 3-minute consult), and against the professional reality that the Ontario College expects the *non-prescribe* decision documented to the same standard as the prescribe decision.

### Option A — Structured "Do Not Prescribe" branch at step 2, new `<NonPrescribePdf>`, wizard-level "Assessment Not Completed" action, extend #2's enum with `not_prescribed` (RECOMMENDED)

Add a **third forward affordance at step 2** (`Select Rx`) — a clearly-labelled "Do Not Prescribe / No Prescription" control beside the Rx cards — that, when invoked, reveals a `<NonPrescribeOutcomePanel>` (reason taxonomy + free-text rationale + confirm the self-care advice given). Selecting it sets a new wizard state `isNonPrescribe = true` and advances to step 3, where a **third step-3 branch** (`step === 3 && isNonPrescribe`) renders a summary, #3's `<ConsentPanel>` (consent-to-record is the legally load-bearing one here), and a "Download Non-Prescribe Documentation PDF" button backed by a **new** `<NonPrescribePdf>` document component. Separately, a low-emphasis **"Assessment Not Completed"** action (a text button in the wizard footer/nav, available on every step) opens a small dialog to capture an abandonment reason and save `outcome: 'abandoned'`. Persistence extends #2's `assessment` table: the `outcome` CHECK gains `'not_prescribed'`; two new columns (`non_prescribe_reason`, `non_prescribe_rationale`) capture the structured + free-text rationale; the existing `assessment.saved` Supabase audit event carries an optional `reason_category` when `outcome='not_prescribed'`.

- **Pros:** Faithful to the ODPRN gap (the point is *consistent, structured* refusal documentation — a free-text-only model does not fix the consistency problem). Mirrors the existing two-branch wizard pattern (a third `isNonPrescribe` branch parallel to `isReferral`), so the state-machine churn is minimal and symmetric. The dedicated PDF is a self-contained legal artefact even before fly.io exists (Phase 1), exactly as #1/#2/#3 established. Reuses #3's `ConsentPanel` and #2's `saveAssessmentAction` + `phi_audit_log` unchanged in shape — #4 only extends the enum and adds columns. The `nonRx` advice list finally becomes reachable for the no-Rx case it was always semantically meant for. Sibling-friendly: #10 (PROM follow-up) reads `outcome` to decide whether to ask the patient about a prescription that was *not* issued; #26 (governance) versions the reason taxonomy; #12 (smart sig) ignores `not_prescribed` rows.
- **Cons:** Adds a fourth document component (`<NonPrescribePdf>`) and a new step-3 branch, modestly growing the wizard's surface. The reason taxonomy is content that needs pharmacist/legal review (mitigated by placing it in a versioned TS module under `src/lib/`, same discipline as #3's `statements.ts`). Abandonment may lack full patient identity (the #2 store rejects an abandoned save without `name`/`dob`), so the abandon action must gracefully no-op when step 0 was not completed (documented edge case, §6).

### Option B — Free-text "no prescribe" note only, no structured reason taxonomy, no dedicated PDF

Same third branch and same abandonment action, but the "reason" is a single free-text `<Textarea>` ("Reason no prescription issued") appended to the assessment, and the documentation is produced by reusing `<CombinedPdf>` with the Rx section blanked.

- **Pros:** Smallest code change; no taxonomy to maintain or review.
- **Cons:** Directly concedes the ODPRN gap the roadmap says this feature exists to close — *"nobody does it consistently"* is precisely a *structure* problem, and free-text notes are the status quo that fails. No queryable reason data (a pharmacy owner cannot ask "how many assessments ended in patient-declined this month?"), which weakens #13 (analytics) and #25 (revenue-leakage optimizer) downstream. Reusing `<CombinedPdf>` with a blank Rx section produces a confusing, unprofessional artefact titled "PRESCRIPTION" for a non-prescription — exactly the kind of document an inspector would flag.
- **Rejected** as the primary path; the structured taxonomy in Option A is the whole point of the feature.

### Option C — Dedicated "Outcome" decision step (step 2.5) between Rx selection and generate

Insert a new wizard step that forces an explicit outcome choice (prescribe / refer / do-not-prescribe / abandon) for every assessment, updating the `StepIndicator` (`wizard-nav.tsx:7`) and the `step` machine.

- **Pros:** Maximum salience; every assessment records a conscious outcome.
- **Cons:** Slows the consult (an extra navigation and screen switch) when the roadmap §4 wedge is explicitly *counter speed* (3-minute target). Adds state-machine churn (the `canNext` logic, the referral jump at `wizard-container.tsx:84-87`, and the #3 consent gate all need rework). Most assessments *do* prescribe — forcing an explicit outcome choice for the majority case is friction for no benefit. Semantically the outcome is a property of the *terminal* act, not a separate clinical step.
- **Rejected** for NOW; revisit if user testing shows pharmacists fail to find the "Do Not Prescribe" affordance on step 2.

### Recommendation

**Option A.** It is the faithful implementation of the roadmap gap (structured, consistent refusal documentation), the smallest change that produces a self-contained legal artefact on a dedicated PDF in Phase 1, and it is symmetric with the existing two-branch wizard (a third `isNonPrescribe` branch). It extends rather than reworks #2 (enum + two columns) and #3 (reuses `ConsentPanel` verbatim), and it finally gives the existing `nonRx` advice list a reachable no-Rx home. The abandonment action is the minimal, non-intrusive way to close the "started but not completed" trace gap #2 named but did not build.

---

## 4. Components & Data Model

### 4.1 New wizard state + outcome taxonomy type

`WizardContainer` (`wizard-container.tsx:40-48`) gains a non-prescribe outcome state alongside the existing block:

```ts
const [isNonPrescribe, setIsNonPrescribe] = useState(false)
const [nonPrescribeReason, setNonPrescribeReason] = useState<NonPrescribeReason | null>(null)
const [nonPrescribeRationale, setNonPrescribeRationale] = useState("")
```

New types in `src/types/index.ts` (after `AssessmentData` at `types/index.ts:59-67`):

```ts
// The structured reason a completed assessment ended without a prescription.
// Kept enum-stable for queryability (feeds #13 analytics, #25 revenue-leakage).
export type NonPrescribeReason =
  | "patient_declined"      // patient declined the offered Rx / any Rx
  | "otc_sufficient"        // self-care / OTC advice given; no Rx needed
  | "clinical_judgment"     // pharmacist judged no Rx appropriate (not a candidate)
  | "already_treating"      // patient already on a suitable treatment
  | "referred_to_physician"  // non-red-flag referral to the patient's physician
  | "referred_elsewhere"    // referred to a non-physician route (walk-in, ED, dentist)
  | "other"

// The reason an assessment was started but not completed (outcome='abandoned').
export type AbandonmentReason =
  | "patient_left"          // patient left before completion
  | "patient_deferred"      // patient chose to defer / think about it
  | "lost_to_followup"      // could not complete (e.g., virtual call dropped)
  | "duplicate"             // duplicate assessment opened in error
  | "other"
```

> The taxonomy is deliberately small (YAGNI) and grounded in minor-ailments counter practice. `referred_to_physician` is the non-red-flag referral case (§4.7) — distinct from the red-flag `isReferral` path. `referred_elsewhere` covers non-physician routes without inventing a new document.

### 4.2 Versioned reason labels (`src/lib/non-prescribe/reasons.ts`, new)

Mirrors #3's `statements.ts` discipline: the reason set is governance content that will change, so it is a TS module under `src/lib/` (not `data/` — the gnhf constraint forbids editing `data/`, and a content hash must be reproducible from the build). Exports the canonical label set + a `REASON_TAXONOMY_VERSION` + a content hash, so a persisted non-prescribe record pins *which taxonomy was in effect*:

```ts
export const REASON_TAXONOMY_VERSION = "non-prescribe-v1"

export interface NonPrescribeReasonOption {
  value: NonPrescribeReason
  label: string         // short radio label
  guidance: string | null  // one-line clinician guidance shown when selected (e.g. "Counsel on OTC options")
  requiresReferralContext: boolean  // true for referred_to_physician → routes via <ReferralPdf> (§4.7)
}

export const NON_PRESCRIBE_REASONS: NonPrescribeReasonOption[] = [
  { value: "patient_declined",      label: "Patient declined prescription",         guidance: "Document what was offered and the patient's reason.", requiresReferralContext: false },
  { value: "otc_sufficient",        label: "OTC / self-care advice sufficient",     guidance: "Record advice given below.",                            requiresReferralContext: false },
  { value: "clinical_judgment",     label: "Pharmacist clinical judgment — not appropriate", guidance: null,                                       requiresReferralContext: false },
  { value: "already_treating",      label: "Patient already on treatment",          guidance: null,                                                    requiresReferralContext: false },
  { value: "referred_to_physician", label: "Referred to family physician (non-red-flag)", guidance: "Use when no red flag but physician review warranted.", requiresReferralContext: true },
  { value: "referred_elsewhere",    label: "Referred elsewhere (walk-in, ED, dentist)", guidance: null,                                                 requiresReferralContext: false },
  { value: "other",                 label: "Other (specify in rationale)",          guidance: null,                                                    requiresReferralContext: false },
]

export function computeReasonTaxonomyHash(reasons: NonPrescribeReasonOption[]): string {
  // sha256 of the stable (value,label) pairs — pins the exact taxonomy in effect
}
```

`reason_taxonomy_hash` is persisted on the assessment row (§4.5) so a later taxonomy edit cannot retroactively change what a past decision meant — matching #3's `statement_hash` and feeding roadmap #26 (governance).

### 4.3 Non-prescribe outcome panel (`src/components/wizard/non-prescribe-panel.tsx`, new)

A `"use client"` component rendered on step 2 alongside the Rx cards (the Rx selection and the non-prescribe path are mutually exclusive — selecting one clears the other). Props:

```ts
interface NonPrescribePanelProps {
  ailment: Ailment
  value: NonPrescribeReason | null
  onReasonChange: (r: NonPrescribeReason | null) => void
  rationale: string
  onRationaleChange: (s: string) => void
  nonRxChecked: string[]
  onNonRxChange: (items: string[]) => void
}
```

Renders:
1. A radio list of `NON_PRESCRIBE_REASONS` (reusing the existing card/radio styling from `step-rx.tsx:38-62`).
2. When `requiresReferralContext === true` (`referred_to_physician`), a one-line note: *"This will produce a referral document for the patient's family physician."*
3. A `<Textarea>` for `rationale` (required when `reason === 'other'`; optional but recommended otherwise).
4. The existing `nonRx` self-care advice checkbox list (moved/shared from `step-rx.tsx:110-139`) so the pharmacist records what advice *was* given — this is the payload that distinguishes `otc_sufficient` from a bare refusal.

The panel emits a valid `(reason, rationale)` pair via `onReasonChange` / `onRationaleChange`; the wizard's step-2 `canNext` becomes *"either an Rx is selected OR a non-prescribe reason is set"* (§4.6).

### 4.4 The Non-Prescribe Documentation PDF (`src/components/wizard/non-prescribe-pdf.tsx`, new)

A client-side `@react-pdf/renderer` `<Document>` (same pipeline as `<CombinedPdf>` at `combined-pdf.tsx:185` and `<ReferralPdf>` at `referral-pdf.tsx:160`). Props:

```ts
interface NonPrescribePdfProps {
  ailment: Ailment
  patient: PatientInfo
  reason: NonPrescribeReason
  reasonLabel: string
  rationale: string
  nonRxChecked: string[]
  assessmentNotes: string
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
  // #3 consent fields (rendered in the footer attestation):
  consentSignerName?: string
  consentSignerRelationship?: SignerRelationship
  consentCaptureMethod?: CaptureMethod
  consentStatementVersion?: string
  consentCapturedAt?: string
}
```

Layout (mirrors the established two-PDF style — teal accent, pharmacy block, two-column patient/assessment, PHIPA footer):
- **Header:** title "ASSESSMENT RECORD — NO PRESCRIPTION ISSUED" (teal, not red — this is not an alert); subtitle `{ailment.name} — O. Reg. 256/24`; CONFIDENTIAL badge; date.
- **Pharmacy block:** identical to `combined-pdf.tsx:204-214`.
- **Two columns:** Patient (left, `combined-pdf.tsx:218-229`) | Assessment (right): ailment, date, encounter, "Red flags: None identified" (or list if any were screened in then ruled out — the non-prescribe path can follow a red-flag screen that was later cleared, though typically `has_red_flag=false`).
- **"Reason no prescription issued" section:** the `reasonLabel` in a styled block + the free-text `rationale` beneath (reusing the `notesBlock` style from `combined-pdf.tsx:121-128`).
- **"Non-Rx Advice Provided" section:** the checked `nonRx` items in the green block (reusing `greenBlock` / `checkItem` from `combined-pdf.tsx:115-120`, `:286-299`).
- **Follow-up:** `ailment.followUp` (reusing the field row style).
- **Signatures:** the two-column pharmacist + patient/SDM block from #3 (`digital-consent-capture-design.md` §4.7) — the patient/SDM side carries #3's captured signature image when present.
- **PHIPA footer:** *"CONFIDENTIAL — Privileged health information under PHIPA. Assessment completed; no prescription issued per O. Reg. 256/24. Reason recorded above."* + the #3 consent attestation line.

> The document is deliberately titled "ASSESSMENT RECORD" not "NON-PRESCRIPTION" — it documents the *assessment*, whose outcome happens to be no Rx. This is the language an Ontario College inspector expects.

### 4.5 Persistence: extend #2's `assessment` table (fly.io, PHI under BAA)

#4 extends #2's schema (`persist-assessments-flyio-design.md` §4.3) with one enum value and two columns. The `abandoned` value already exists in #2's CHECK; #4 adds `not_prescribed` and the reason/rationale columns:

```sql
-- Extend #2's outcome CHECK to add 'not_prescribed'.
ALTER TABLE assessment DROP CONSTRAINT IF EXISTS assessment_outcome_check;
ALTER TABLE assessment ADD CONSTRAINT assessment_outcome_check
  CHECK (outcome IN ('prescribed','referred','not_prescribed','abandoned'));

-- Structured reason category. Nullable; set only when outcome='not_prescribed'.
-- Non-identifying on its own (a category, not patient data) — allowed in Supabase audit metadata (§5.1).
ALTER TABLE assessment ADD COLUMN non_prescribe_reason text
  CHECK (non_prescribe_reason IS NULL OR non_prescribe_reason IN (
    'patient_declined','otc_sufficient','clinical_judgment',
    'already_treating','referred_to_physician','referred_elsewhere','other'
  ));

-- Clinician free-text rationale (PHI: clinical reasoning about a specific patient).
ALTER TABLE assessment ADD COLUMN non_prescribe_rationale text;

-- Structured abandonment reason. Nullable; set only when outcome='abandoned'.
ALTER TABLE assessment ADD COLUMN abandonment_reason text
  CHECK (abandonment_reason IS NULL OR abandonment_reason IN (
    'patient_left','patient_deferred','lost_to_followup','duplicate','other'
  ));

-- Pins the exact reason taxonomy in effect at capture time (governance; #26).
ALTER TABLE assessment ADD COLUMN reason_taxonomy_version text;
ALTER TABLE assessment ADD COLUMN reason_taxonomy_hash text;

-- Index for analytics queries (#13): non-prescribe outcomes by reason per pharmacy.
CREATE INDEX assessment_non_prescribe
  ON assessment (pharmacy_id, non_prescribe_reason)
  WHERE non_prescribe_reason IS NOT NULL;
```

> `non_prescribe_rationale` is free-text clinical reasoning about a specific patient → **PHI, fly.io only, never Supabase**. `non_prescribe_reason` and `abandonment_reason` are non-identifying categories (like `outcome` itself, which #2 already permits in Supabase metadata) → allowed in the Supabase `assessment.saved` event (§4.6). The two `reason_taxonomy_*` columns are non-identifying metadata, allowed on both stores; they appear in Supabase audit metadata.

### 4.6 Non-PHI Supabase audit (extend #2's `assessment.saved`, no new event)

#4 does **not** introduce a new audit event. It extends #2's `assessment.saved` metadata (`persist-assessments-flyio-design.md` §4.6) to carry the reason category when applicable. #2's metadata was strictly `{ assessment_id, outcome }`; #4 widens it to:

```ts
// assessment.saved metadata (Supabase, non-PHI) — all values non-identifying:
{
  assessment_id: string,
  outcome: "prescribed" | "referred" | "not_prescribed" | "abandoned",
  reason_category?: NonPrescribeReason | AbandonmentReason,  // present only for not_prescribed / abandoned
  reason_taxonomy_version?: string,                           // present only for not_prescribed
}
```

Extend the `audit.log_event` SECURITY DEFINER function (re-declaring #2's branch + this addition — preserve all existing per-event checks):

```sql
  -- assessment.saved: require assessment_id + outcome (from #2);
  -- optionally allow reason_category + reason_taxonomy_version (from #4);
  -- forbid any patient/clinical key, and forbid the free-text rationale.
  IF p_event_type = 'assessment.saved' THEN
    IF (p_metadata->>'assessment_id') IS NULL OR (p_metadata->>'outcome') IS NULL THEN
      RAISE EXCEPTION 'assessment.saved requires assessment_id + outcome';
    END IF;
    IF (p_metadata->>'outcome') NOT IN ('prescribed','referred','not_prescribed','abandoned') THEN
      RAISE EXCEPTION 'assessment.saved: invalid outcome';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_metadata) k
      WHERE k LIKE 'patient_%' OR k IN ('ailment','drug','rx','name','dob',
                                        'rationale','notes','non_prescribe_rationale')
    ) THEN
      RAISE EXCEPTION 'assessment.saved metadata must not contain patient/clinical data';
    END IF;
  END IF;
```

> The free-text `non_prescribe_rationale` is explicitly rejected from Supabase metadata (`rationale`, `notes`, `non_prescribe_rationale` keys forbidden) — it lives only on fly.io. `reason_category` and `reason_taxonomy_version` are non-identifying and permitted, exactly as #2 permitted `outcome`.

### 4.7 Non-red-flag referral reuses `<ReferralPdf>` with a context flag

When `non_prescribe_reason === 'referred_to_physician'`, the documentation artefact is the existing `<ReferralPdf>` (`referral-pdf.tsx`) rather than `<NonPrescribePdf>`, because the act is a physician referral (the PDF carries the physician fax block). But `<ReferralPdf>` is today hardcoded to a red-flag context (`referral-pdf.tsx:212-232`). #4 adds an optional `referralContext` prop:

```ts
interface ReferralPdfProps {
  // ...existing props (ailment, patient, redFlagsChecked, dateOfAssessment, pharmacy)...
  referralContext?: "red_flag" | "non_red_flag"   // default "red_flag" (preserves today's behaviour)
  referralReason?: string                          // free-text, shown when referralContext="non_red_flag"
}
```

When `referralContext === "non_red_flag"`: the "Red Flags Identified" section (`referral-pdf.tsx:212-220`) is replaced by a "Reason for Referral" block rendering `referralReason` (the non-prescribe rationale), and the footer (`referral-pdf.tsx:232`) reads "Patient referred for physician review" instead of "due to identified red flags." Default behaviour is unchanged, so the existing red-flag path is unaffected.

### 4.8 Abandonment action (`src/components/wizard/abandon-dialog.tsx`, new + wizard wiring)

A small modal/dialog component triggered by a low-emphasis **"Assessment Not Completed"** text button rendered in the wizard footer on every step (in `WizardNav` or directly in `WizardContainer`, below the existing nav row). The dialog captures:

```ts
interface AbandonDialogProps {
  open: boolean
  onConfirm: (reason: AbandonmentReason, note: string) => void
  onCancel: () => void
}
```

A radio list of `ABANDONMENT_REASONS` (sourced from a small `src/lib/non-prescribe/abandonment-reasons.ts` module) + an optional free-text note. On confirm, `WizardContainer` calls `saveAssessmentAction({ outcome: 'abandoned', abandonmentReason, assessmentNotes: note, ... })` (behind `PHI_PERSIST_ENABLED`) and routes to `/` (the dashboard). **Identity guard:** per #2's edge case, the store rejects an abandoned save without `patient.name && patient.dob`; the abandon action therefore persists **only if step 0 was completed** (`patient.name && patient.dob`), otherwise it routes to `/` with no trace (documented in §6). A confirm-state on the dialog ("This assessment will not be saved — no patient name/DOB recorded") makes the no-trace case explicit.

### 4.9 Server-action wiring (reuses #2's `saveAssessmentAction`)

No new server action. #4 extends #2's `saveAssessmentAction` payload (`persist-assessments-flyio-design.md` §4.7) with optional non-prescribe fields:

```ts
saveAssessmentAction({
  // ...existing #2 payload (patient, ailment, symptoms, etc.)...
  outcome: "not_prescribed" | "abandoned",
  nonPrescribeReason?: NonPrescribeReason,        // when not_prescribed
  nonPrescribeRationale?: string,                 // when not_prescribed
  abandonmentReason?: AbandonmentReason,          // when abandoned
  reasonTaxonomyVersion?: string,                 // when not_prescribed
  reasonTaxonomyHash?: string,                    // when not_prescribed
  consentId?: string,                              // from #3
})
```

#2's `saveAssessment` (`assessment-store.ts`) writes the new columns from this payload; the `phi_audit_log` action remains `assessment.created` (the outcome is in the row, not the action name). The non-PHI `assessment.saved` Supabase event (§4.6) carries `reason_category` + `reason_taxonomy_version` when set.

**Phase-1 stub:** when `PHI_PERSIST_ENABLED !== "true"`, `saveAssessmentAction` returns `{ assessmentId: null }` without writing (inherited from #2), so the non-prescribe UI + PDF ship dark and the printed `<NonPrescribePdf>` is the durable artefact.

### 4.10 Gate wiring (fail-closed, mirrors #3)

- **Non-prescribe branch (`wizard-container.tsx`, new `isNonPrescribe` step-3 branch):** the "Download Non-Prescribe Documentation PDF" button is `disabled` unless #3's `consent !== null` (consent-to-record is required to retain the encounter) AND `nonPrescribeReason !== null`. On click: `saveConsentAction` (from #3) → `saveAssessmentAction({ outcome: 'not_prescribed', ... })` → `downloadPdf(<NonPrescribePdf/>)`, in that order (fail-closed — a thrown error blocks the download, identical rule to #2 §5.3 / #3 §4.8).
- **Non-red-flag referral sub-case:** when `nonPrescribeReason === 'referred_to_physician'`, the branch renders `downloadPdf(<ReferralPdf referralContext="non_red_flag" referralReason={rationale} />)` instead, with the same consent + persistence ordering.
- **Abandon action:** the abandon dialog's confirm button is always enabled (abandonment is an exit, not a document); the persistence call is best-effort behind the flag and never blocks the route to `/`.

---

## 5. Security / PHIPA-PIPEDA Posture

This feature places no *new* class of PHI at rest beyond what #2 already establishes (the assessment row) — it adds two clinical-text columns (`non_prescribe_rationale`, the abandonment note) and two non-identifying category columns to the existing `assessment` table. It therefore inherits every control #2 establishes (#2 §5) and every consent control #3 establishes (#3 §5), and adds non-prescribe-specific notes.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| `non_prescribe_rationale` (free-text clinician reasoning) | PHI (clinical reasoning about a specific patient) | **fly.io** `assessment.non_prescribe_rationale`. Never Supabase. Forbidden in `assessment.saved` metadata by name (`rationale`, `non_prescribe_rationale`). |
| Abandonment free-text note (when `abandonment_reason='other'`) | PHI (encounter context about a specific patient) | **fly.io** `assessment.assessment_notes` (reuses #2's column). Never Supabase. |
| `non_prescribe_reason` / `abandonment_reason` (category enums) | Non-identifying on their own (a category, not patient data) | Allowed on **both** stores. Appears in Supabase `assessment.saved` metadata as `reason_category`. Mirrors #2's treatment of `outcome`. |
| `reason_taxonomy_version` / `reason_taxonomy_hash` | Non-identifying (describes the taxonomy, not the patient) | Allowed on **both** stores. Appears in Supabase `assessment.saved` metadata. |
| `outcome='not_prescribed'` / `'abandoned'` | Non-identifying on its own | Allowed on **both** stores (per #2 §5.1, which already permits `outcome`). |
| The `<NonPrescribePdf>` bytes (rendered client-side) | PHI in transit to the printer / patient | Rendered and downloaded client-side via `pdf(document).toBlob()` (same as `<CombinedPdf>`); never cross the wire to Supabase. e-fax of this PDF would route via #1's `fax_delivery` (fly.io) — out of scope for #4 but the partitioning is already established. |
| #3 consent fields reused on the non-prescribe branch | Same classification as in #3 §5.1 | Unchanged from #3 — `consent_id` (non-identifying) allowed on both stores; signature image + signer name on fly.io only. |

**Rule of thumb (roadmap §6.4):** the free-text rationale and the abandonment note could describe a patient's clinical state → fly.io. The reason *category* and the taxonomy *version* describe the software's classification scheme → allowed on Supabase.

### 5.2 Regulatory mapping

- **PHIPA s.12 / s.10.1:** retaining the non-prescribe decision and logging every PHI access satisfies custodian accountability; the #2 `phi_audit_log` hash chain (inherited) provides tamper-evidence. The non-prescribe record is retained under the same ~10-year Ontario pharmacy retention as the prescribe record (#2 §5.2) — the College expects the *decision not to prescribe* to survive as long as a prescription would.
- **PHIPA s.20–21 (consent):** a patient who declines treatment still had PHI collected (the screening, the demographics). #3's `consent_to_record` is the lawful basis for retaining the non-prescribe record; the non-prescribe branch reuses #3's `ConsentPanel` so this basis is captured explicitly. If the patient declines `consent_to_record`, the documentation PDF still generates (it is given to the patient), but no fly.io row is written (fail-closed persistence gate) — documented in §6.
- **O. Reg. 256/24 + professional liability:** the Ontario College of Pharmacists expects the *non-prescribe* decision to be documented to the same standard as a prescription (continuity of care + liability defence). The structured reason taxonomy + the dedicated `<NonPrescribePdf>` are the artefact that meets this expectation — directly closing the ODPRN-flagged industry gap.
- **PIPEDA Principle 4.5 (limiting use):** the non-prescribe record is collected for the purpose of continuity of care and professional-liability defence, not for secondary marketing; the `reason_category` analytics (feeding #13) are aggregate, non-identifying.
- **Data residency:** inherits #2's Canadian-region fly.io requirement (`yyz`/`yul`); the non-prescribe PHI does not leave Canada.

### 5.3 Application security

- **Authorization is app-layer, not RLS** — identical to #2 §5.3. All fly.io `assessment` access (including the new columns) funnels through #2's `src/lib/phi/assessment-store.ts`, which injects `pharmacy_id` from the verified JWT on every query. The CI grep rule #2 establishes (`rg -n "FROM assessment|INTO assessment" src/lib/phi`) covers the new columns automatically — no new rule needed.
- **Server-side re-validation:** the `saveAssessmentAction` payload is validated server-side (inherited from #2); #4 adds a check that `non_prescribe_reason` is a valid enum value when `outcome='not_prescribed'` (defence-in-depth — the client radio list already constrains this, but the server never trusts client input for a legal artefact).
- **Fail-closed persistence:** the non-prescribe Download is blocked if `saveAssessmentAction` throws (Phase 2), guaranteeing every produced `<NonPrescribePdf>` has a stored record. (Phase-1 stub no-op returns null and proceeds, so the wizard is unaffected while fly.io is dark.) The abandon action is *not* fail-closed — it is an exit, and a persistence failure routes to `/` regardless (documented in §6).
- **Immutability:** inherited from #2 — no `UPDATE`/`DELETE` on `assessment`. A non-prescribe decision recorded in error is corrected by a future amendment row (#26 governance), not by editing the row.
- **No new env vars, no new dependencies, no new auth model.** The `<NonPrescribePdf>` is a pure `@react-pdf/renderer` component (already a dependency); the panels reuse existing `src/components/ui/*` primitives. The feature is additive UI + two columns.

---

## 6. Edge Cases

- **fly.io not yet provisioned / BAA unsigned (Phase 1):** `PHI_PERSIST_ENABLED` is off; `saveAssessmentAction` returns `{ assessmentId: null }` without writing. The non-prescribe panel renders, the `<NonPrescribePdf>` downloads, and the printed document (with the reason + rationale + advice + consent attestation) is itself the durable legal artefact. The flag, schema, and audit branch are ready so flipping the switch lights up persistence with no further code change.
- **Patient declines a required consent (`consent_to_record`):** the #3 `ConsentPanel` gate stays closed on the non-prescribe branch; the Download button is disabled. The pharmacist either re-offers consent or — if the patient firmly declines record-retention — produces nothing and the encounter is not retained (legally defensible: PHIPA has limited exceptions but minor-ailments documentation is not one of them without consent). Documented; no row written, no PDF produced.
- **Non-prescribe after a red flag was screened in then cleared:** the non-prescribe path is reachable only from step 2, which is reachable only when `redFlagsChecked.length === 0` (`wizard-container.tsx:55-56`). So a non-prescribe record normally has `has_red_flag = false`. If a pharmacist checks a red flag, then un-checks it and proceeds, the resulting `not_prescribed` row correctly records `has_red_flag = false` (the final screened state). Documented.
- **Non-red-flag referral (`referred_to_physician`):** produces `<ReferralPdf referralContext="non_red_flag" />` (§4.7), not `<NonPrescribePdf>`. The persistence `outcome` is `'not_prescribed'` with `non_prescribe_reason='referred_to_physician'` (NOT `'referred'`, which #2 reserves for the red-flag path with `has_red_flag=true`). This keeps the two referral semantics distinct and queryable.
- **Abandonment before step 0 completed (no `name`/`dob`):** per #2's edge case, the store rejects an abandoned save without patient identity. The abandon action therefore checks `patient.name && patient.dob`: if present, it persists `outcome: 'abandoned'`; if absent, it routes to `/` with no trace and the dialog shows an explicit "will not be saved" confirm state. An abandonment truly before identity capture leaves no record — acceptable (there is nothing identifiable to retain).
- **Abandonment mid-virtual-call (`lost_to_followup`):** captured via the abandon dialog; if step 0 was completed, a partial-assessment row is written with `outcome='abandoned'`, `abandonment_reason='lost_to_followup'`, and whatever symptoms/red-flags were captured so far (the JSONB arrays from #2). This is compliance-valuable: it records that the encounter happened.
- **Re-download / re-open idempotency:** the non-prescribe path reuses #2's client-generated `assessmentId` per wizard mount, so a pharmacist who downloads the non-prescribe PDF, goes back, and downloads again amends the same row's `updated_at` rather than duplicating it (inherited from #2 §6).
- **Pharmacist selects an Rx then switches to non-prescribe:** selecting the "Do Not Prescribe" control clears `selectedRx` (and vice versa) — the two are mutually exclusive. The wizard's `canNext` at step 2 reflects whichever path is active.
- **`reason='other'` with empty rationale:** the panel requires a non-empty rationale when `reason === 'other'` (client gate + server re-validation). For other reasons, the rationale is optional but recommended (the panel surfaces a gentle prompt).
- **Reason taxonomy changes (governance):** `reason_taxonomy_version` + `reason_taxonomy_hash` pin the exact taxonomy in effect, so a later edit to `NON_PRESCRIBE_REASONS` cannot retroactively change what a past decision's category meant. Matches #3's `statement_hash` pattern; feeds #26.
- **Platform admin access:** explicitly **not** granted to non-prescribe rows (mirrors #2 §5.3). Analytics over `reason_category` (#13) go through aggregate, non-identifying rollups, not direct PHI reads.
- **Two non-prescribe reasons for one assessment:** prevented by the radio list (one reason per assessment). If a pharmacist's reasoning spans categories, the `other` reason + free-text rationale captures it; a multi-label taxonomy is LATER.

---

## 7. Open Questions

1. **fly.io provisioning + BAA timing (the hard gate).** Inherited verbatim from #2 §7.1: confirm fly.io Postgres is stood up in a **Canadian region** (`yyz`/`yul`) and the BAA is signed before `PHI_PERSIST_ENABLED` flips true. Non-prescribe persistence rides the same flag as #2/#3.
2. **One audit event or two?** #4 extends #2's `assessment.saved` metadata with `reason_category` rather than introducing a new `non_prescribe.recorded` event. Rationale: one assessment → one `assessment.saved` event regardless of outcome, matching #2's discipline. The alternative (a distinct event) is cleaner for inspector-facing audit readability but creates event redundancy. Confirm the consolidated-metadata approach is acceptable; if inspectors expect to see non-prescribe decisions called out by event name, switch to a distinct `non_prescribe.recorded` event.
3. **`outcome` value naming: `not_prescribed` vs. `no_rx` vs. `declined`.** `not_prescribed` is recommended (clinically neutral, covers both patient-declined and pharmacist-judged cases). Confirm the term, as it appears in the enum, in the Supabase audit metadata, and in any future analytics dashboard label. (`abandoned` is already named by #2.)
4. **Should the abandonment action be available before step 0?** Today the design gates persistence on `patient.name && patient.dob`. An alternative is to always persist an abandonment row (even anonymous) for aggregate "started-but-not-finished" analytics. Recommend *no* — an anonymous abandonment has no compliance value and pollutes the `assessment` table. Confirm.
5. **Non-red-flag referral: separate outcome or a reason category?** #4 models it as `outcome='not_prescribed'` + `non_prescribe_reason='referred_to_physician'`, reusing `<ReferralPdf>` with a context flag (§4.7). An alternative is a fourth `outcome='referred_non_red_flag'`. Recommend the reason-category model (keeps the outcome enum at four values, and the referral-vs-non-prescribe distinction is queryable via `non_prescribe_reason`). Confirm; revisit if analytics (#13) struggle with the join.
6. **Reason taxonomy review.** The §4.1/§4.2 taxonomy is drafted from minor-ailments counter practice but **must be reviewed by a practising pharmacist** (and ideally the pharmacy's clinical lead) before launch. Where does the reviewed taxonomy live — `src/lib/non-prescribe/reasons.ts` (code, requires a deploy) or `data/` (editable, but the gnhf constraint forbids editing `data/` and a content hash must be reproducible from the build)? Recommend a TS module under `src/lib/non-prescribe/` (same discipline as #3's `statements.ts`); confirm.
7. **Is the `nonRx` advice list duplicated between the prescribe and non-prescribe branches?** Both `StepRx` (prescribe path, `step-rx.tsx:110-139`) and the new `NonPrescribePanel` (§4.3) render the same ailment `nonRx` list. Recommend extracting a shared `<NonRxAdvice>` component to avoid two copies drifting; confirm whether NOW does the extraction or leaves the duplication (YAGNI vs. DRY).
8. **Should `non_prescribe_rationale` be encrypted at the column level beyond fly.io's volume encryption?** It is free-text clinical reasoning and the most sensitive non-prescribe field. Inherits #2's AES-256-at-rest (fly.io encrypted volumes) + TLS. Recommend *no* additional column-level encryption for NOW (YAGNI; the volume encryption + BAA + app-layer scoping is the roadmap §6.3 control). Confirm.
9. **Patient-facing explanation.** Should the `<NonPrescribePdf>` include a patient-friendly summary section (e.g., "What this means for you") distinct from the clinical record? Recommend *no* for NOW (the document is the clinical/legal record; a patient-friendly overlay is a #24/#28 concern); confirm.
10. **Withdrawal / correction of a non-prescribe decision.** If a pharmacist later realises a non-prescribe decision was recorded in error (e.g., the patient returns and *is* prescribed), the immutability model (inherited from #2) means the correction is a new `assessment` row (the new prescribe) + a future amendment row (#26). Confirm this is acceptable for NOW vs. needing an in-place `outcome` correction (which #2 forbids).

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/types/index.ts` — add `NonPrescribeReason`, `AbandonmentReason` types.
- `src/lib/non-prescribe/reasons.ts` — versioned non-prescribe reason taxonomy + `REASON_TAXONOMY_VERSION` + hash.
- `src/lib/non-prescribe/abandonment-reasons.ts` — abandonment reason list (small).
- `src/components/wizard/non-prescribe-panel.tsx` — the step-2 outcome panel (reason radio + rationale + non-Rx advice).
- `src/components/wizard/non-prescribe-pdf.tsx` — the Non-Prescribe Documentation PDF (`@react-pdf/renderer`).
- `src/components/wizard/abandon-dialog.tsx` — the "Assessment Not Completed" modal.
- `src/__tests__/non-prescribe-panel.test.tsx`, `src/__tests__/non-prescribe-pdf.test.tsx`, `src/__tests__/abandon-dialog.test.tsx` — panel validity, PDF rendering of reason/rationale/advice, abandon confirm flow.
- *(Optional, per §7.7)* `src/components/wizard/non-rx-advice.tsx` — shared `nonRx` list extracted from `step-rx.tsx`.

**Modified:**
- `src/components/wizard/wizard-container.tsx` — add `isNonPrescribe` / `nonPrescribeReason` / `nonPrescribeRationale` state; new step-3 `isNonPrescribe` branch rendering summary + `<ConsentPanel>` (from #3) + Download button; "Assessment Not Completed" footer action + `<AbandonDialog>`; call `saveAssessmentAction({ outcome: 'not_prescribed'/'abandoned', ... })` before `downloadPdf`; relax step-2 `canNext` to allow the non-prescribe path.
- `src/components/wizard/step-rx.tsx` — render the `<NonPrescribePanel>` affordance; make Rx selection and non-prescribe mutually exclusive; (optional) extract `<NonRxAdvice>` per §7.7.
- `src/components/wizard/step-redflags.tsx` — no change (the red-flag → referral path is unchanged); documented for clarity.
- `src/components/wizard/referral-pdf.tsx` — add optional `referralContext` + `referralReason` props for the non-red-flag referral sub-case (§4.7); default behaviour unchanged.
- `src/lib/assessment-actions.ts` (from #2) — extend the `saveAssessmentAction` payload with optional `nonPrescribeReason` / `nonPrescribeRationale` / `abandonmentReason` / `reasonTaxonomyVersion` / `reasonTaxonomyHash`; pass them into `saveAssessment`.
- `src/lib/phi/assessment-store.ts` (from #2) — write the new columns in the `INSERT INTO assessment`; the `phi_audit_log` action stays `assessment.created`.
- `src/lib/audit-actions.ts` (from #2) — no new event type; the existing `assessment.saved` branch (added by #2) is widened to permit `reason_category` + `reason_taxonomy_version` metadata (the Supabase `log_event` validation branch is extended per §4.6).

**Database (fly.io, applied at provisioning, extends #2's schema):** `assessment.outcome` CHECK gains `'not_prescribed'`; new columns `non_prescribe_reason`, `non_prescribe_rationale`, `abandonment_reason`, `reason_taxonomy_version`, `reason_taxonomy_hash`; new partial index `assessment_non_prescribe` (§4.5).

**Database (Supabase, non-PHI):** no new event type; widen the `assessment.saved` validation branch in `audit.log_event` to permit `outcome='not_prescribed'/'abandoned'` + optional `reason_category` + `reason_taxonomy_version`, and to forbid the free-text `rationale`/`notes`/`non_prescribe_rationale` keys (§4.6).

**Environment (server-only):** no new env vars — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`. No new dependencies.
