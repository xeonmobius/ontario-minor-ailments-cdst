# Refusal / Non-Prescribe Documentation — Implementation Plan

**Date:** 2026-06-23
**Roadmap item:** #4 (NOW tier)
**Companion design:** `docs/superpowers/specs/2026-06-23-refusal-non-prescribe-docs-design.md`

> **For agentic workers:** Implement task-by-task. Each step is a small, independently verifiable unit. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the hard constraints in the design doc: **all PHI stays on fly.io** — the free-text `non_prescribe_rationale` and the abandonment note are clinical reasoning about a specific patient and live only on the `assessment` row; Supabase receives only the non-PHI `assessment.saved` metadata (`{ assessment_id, outcome, reason_category?, reason_taxonomy_version? }`) — never the rationale, never the patient data, never the ailment. The `reason_category` and `reason_taxonomy_version` are non-identifying categories and are permitted in Supabase metadata (mirrors #2's treatment of `outcome`). Do **not** flip `PHI_PERSIST_ENABLED=true` until the fly.io BAA is signed and a Canadian region is confirmed (design §5.2). Until then `saveAssessmentAction` is a no-op stub (inherited from #2), the non-prescribe UI renders, the `<NonPrescribePdf>` downloads, and the printed document is itself the durable legal artefact.

**Goal:** Add a third terminal outcome (`not_prescribed`) and a fourth (`abandoned`) to the assessment wizard, with a structured reason taxonomy + clinician rationale, producing a dedicated Non-Prescribe Documentation PDF; reuse #3's `ConsentPanel` on the non-prescribe branch; extend #2's `assessment` table with one enum value and the reason columns; and wire the abandonment action across the wizard — all shipping dark behind #2's `PHI_PERSIST_ENABLED` flag.

**Approach (from the design):** Option A — a `<NonPrescribePanel>` on step 2 (reason radio + rationale + non-Rx advice) that sets `isNonPrescribe` and branches to a new step-3 summary; a new `<NonPrescribePdf>` document component (client-side `@react-pdf/renderer`); an `<AbandonDialog>` + footer "Assessment Not Completed" action for the `abandoned` outcome; `<ReferralPdf>` gains an optional `referralContext` for the non-red-flag referral sub-case; #2's `saveAssessmentAction` + `assessment` table are extended (enum + columns), and #2's `assessment.saved` Supabase audit metadata is widened to carry `reason_category` — no new audit event.

**Dependencies:** roadmap #2 (`persist-assessments-flyio`) must be implemented first — its fly.io `assessment`/`phi_audit_log` schema, its `saveAssessmentAction`, and its `PHI_PERSIST_ENABLED` flag are all reused and extended. Roadmap #3 (`digital-consent-capture`) must be implemented first — its `ConsentPanel` is reused verbatim on the non-prescribe branch (consent-to-record is the lawful basis for retaining the encounter), and its two-column signature layout is reused on the new PDF. Tasks 1–6 + 8–10 can be built and merged behind the flag without #2/#3 being live; Task 11 (E2E persistence) requires #2's Phase 2.

**Tech stack:** Next.js 16.2.6 server actions (`"use server"`), React 19, `@react-pdf/renderer ^4.5.1` (client Blob, unchanged — no new dependency), Supabase (non-PHI audit), `pg` (from #2, for the fly.io write), Vitest + React Testing Library.

---

### Task 1: Non-prescribe + abandonment types and reason taxonomies

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/lib/non-prescribe/reasons.ts`
- Create: `src/lib/non-prescribe/abandonment-reasons.ts`

- [ ] **Step 1: Add the outcome-reason types**

In `src/types/index.ts` (after `AssessmentData` at `types/index.ts:59-67`), add per design §4.1:

```ts
export type NonPrescribeReason =
  | "patient_declined"
  | "otc_sufficient"
  | "clinical_judgment"
  | "already_treating"
  | "referred_to_physician"
  | "referred_elsewhere"
  | "other"

export type AbandonmentReason =
  | "patient_left"
  | "patient_deferred"
  | "lost_to_followup"
  | "duplicate"
  | "other"
```

- [ ] **Step 2: Create the non-prescribe reasons module**

`src/lib/non-prescribe/reasons.ts` — export `REASON_TAXONOMY_VERSION = "non-prescribe-v1"`, the `NonPrescribeReasonOption` interface, the `NON_PRESCRIBE_REASONS` array (seven options per design §4.2: `patient_declined`, `otc_sufficient`, `clinical_judgment`, `already_treating`, `referred_to_physician` [with `requiresReferralContext: true`], `referred_elsewhere`, `other`), each with `value`/`label`/`guidance`/`requiresReferralContext`, and a `computeReasonTaxonomyHash(reasons): string` helper returning `sha256(JSON.stringify(reasons.map(r => ({ value: r.value, label: r.label }))))` as hex (pins the exact taxonomy in effect — design §4.2).

> Place the taxonomy in a TS module under `src/lib/non-prescribe/` (not `data/`) so `reason_taxonomy_hash` is reproducible from the build and a deploy is required to change governance content (design §7.6, mirrors #3's `statements.ts`).

- [ ] **Step 3: Create the abandonment reasons module**

`src/lib/non-prescribe/abandonment-reasons.ts` — export an `ABANDONMENT_REASONS` array of `{ value: AbandonmentReason; label: string }` pairs (five options per design §4.1). Small and stable; no hash needed (abandonment is not a clinical-decision taxonomy).

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/non-prescribe/reasons.ts src/lib/non-prescribe/abandonment-reasons.ts
git commit -m "feat(non-prescribe): add NonPrescribe/Abandonment types + reason taxonomies"
```

---

### Task 2: Non-prescribe outcome panel (step 2)

**Files:**
- Create: `src/components/wizard/non-prescribe-panel.tsx`

- [ ] **Step 1: Implement the panel**

`src/components/wizard/non-prescribe-panel.tsx` — a `"use client"` component per design §4.3. Props:

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

Render:
1. A heading "Do Not Prescribe" + a one-line summary: *"Record a structured reason and produce a non-prescribe documentation PDF."*
2. A radio list of `NON_PRESCRIBE_REASONS`, reusing the card/radio styling from `step-rx.tsx:38-62`. Selecting one calls `onReasonChange(value)`.
3. When the selected option has `requiresReferralContext === true` (`referred_to_physician`), render the one-line note: *"This will produce a referral document for the patient's family physician."*
4. When the selected option has `guidance`, render it as muted helper text.
5. A `<Textarea>` (`src/components/ui/textarea`, as `step-redflags.tsx:129`) for `rationale`. **Required** when `value === "other"` (client gate; the server re-validates in Task 8); optional-but-recommended otherwise.
6. The `nonRx` self-care advice checkbox list, reusing the exact markup from `step-rx.tsx:110-139` (bound to `nonRxChecked` / `onNonRxChange`). This is the payload that distinguishes `otc_sufficient` from a bare refusal.

> The Rx cards (in `step-rx.tsx`) and this panel are mutually exclusive at the wizard level (Task 4): selecting an Rx clears `nonPrescribeReason` and vice versa. The panel itself does not enforce mutual exclusion — `WizardContainer` does.

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/non-prescribe-panel.tsx
git commit -m "feat(non-prescribe): add NonPrescribePanel on step 2"
```

---

### Task 3: Non-Prescribe Documentation PDF

**Files:**
- Create: `src/components/wizard/non-prescribe-pdf.tsx`

- [ ] **Step 1: Implement the document component**

`src/components/wizard/non-prescribe-pdf.tsx` — a client-side `@react-pdf/renderer` `<Document>` (same pipeline as `<CombinedPdf>` at `combined-pdf.tsx:185` and `<ReferralPdf>` at `referral-pdf.tsx:160`). Props per design §4.4:

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
  consentSignatureDataUrl?: string | null
  consentSignerName?: string
  consentSignerRelationship?: SignerRelationship
  consentCaptureMethod?: CaptureMethod
  consentStatementVersion?: string
  consentCapturedAt?: string
}
```

Reuse the established style objects (copy the `StyleSheet.create({...})` block from `combined-pdf.tsx:21-157` as the base — same TEAL/TEAL_LIGHT/DARK/MUTED/BORDER/GREEN/GREEN_LIGHT constants). Layout per design §4.4:

- **Header:** `<Text style={styles.title}>ASSESSMENT RECORD</Text>` (teal) + subtitle `{ailment.name} — NO PRESCRIPTION ISSUED — O. Reg. 256/24` + CONFIDENTIAL badge + date. (Reuses `headerRow`/`title`/`confidentialBadge`/`dateText` styles.)
- **Pharmacy block:** identical to `combined-pdf.tsx:204-214`.
- **Two columns** (`styles.columns`/`styles.col`): Patient (left, copy `combined-pdf.tsx:218-229`) | Assessment (right, copy `combined-pdf.tsx:230-238`, but replace the Rx duration row with "Outcome: No prescription issued").
- **"Reason no prescription issued" section:** `<Text style={styles.sectionLabel}>Reason No Prescription Issued</Text>` + a styled block rendering `reasonLabel` (reusing `greenBlock` or a new neutral block) + the free-text `rationale` beneath (reusing `notesBlock` from `combined-pdf.tsx:121-128`).
- **"Non-Rx Advice Provided" section:** reuse the exact markup from `combined-pdf.tsx:286-299` (the `greenBlock` + `checkItem` list over the filtered `nonRx` items — reuse `filterCheckedItems` from `src/lib/pdf-filter`).
- **Follow-up:** `<Text>Follow-up</Text>` + `ailment.followUp` (reusing the field-row style).
- **Signatures:** the two-column pharmacist + patient/SDM block from #3 (`digital-consent-capture-design.md` §4.7). Left: pharmacist (blank line, `pharmacy?.pharmacistName`). Right: patient/SDM — render `<Image src={consentSignatureDataUrl} />` when present (sized `width: 120, height: 30`), else a `__________` line; label `{consentSignerName} ({consentSignerRelationship})`.
- **PHIPA footer:** `<Text>CONFIDENTIAL — Privileged health information under PHIPA. Assessment completed; no prescription issued per O. Reg. 256/24. Reason recorded above.</Text>` (reusing `phipaBox`/`footerText` styles) + the #3 consent attestation line: *"Consent captured {in-person|verbally} on {consentCapturedAt} — statement version {consentStatementVersion}. Signer: {consentSignerName} ({consentSignerRelationship})."*

> `@react-pdf/renderer`'s `<Image>` accepts a data-URL `src` natively. The component imports `filterCheckedItems` from `@/lib/pdf-filter` (same as `combined-pdf.tsx:11`).

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/non-prescribe-pdf.tsx
git commit -m "feat(non-prescribe): add NonPrescribePdf document component"
```

---

### Task 4: Referral PDF non-red-flag context (for the `referred_to_physician` sub-case)

**Files:**
- Modify: `src/components/wizard/referral-pdf.tsx`

- [ ] **Step 1: Extend `ReferralPdfProps`**

In `src/components/wizard/referral-pdf.tsx`, extend `ReferralPdfProps` (`referral-pdf.tsx:144-150`) per design §4.7:

```ts
interface ReferralPdfProps {
  ailment: Ailment
  patient: PatientInfo
  redFlagsChecked: string[]
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
  referralContext?: "red_flag" | "non_red_flag"   // default "red_flag" (preserves today's behaviour)
  referralReason?: string                          // free-text, shown when referralContext="non_red_flag"
}
```

- [ ] **Step 2: Branch the body on `referralContext`**

In the body (`referral-pdf.tsx:212-233`):

- When `referralContext === "non_red_flag"` (or implicitly when `redFlagsChecked` is empty AND `referralReason` is set): replace the "Red Flags Identified" section (`referral-pdf.tsx:212-220`) with a "Reason for Referral" block rendering `referralReason` in a styled block (reuse `notesBlock` style from `combined-pdf.tsx:121-128`); change the title colour handling so the header reads as a referral but the body explains it is non-red-flag.
- Update the PHIPA footer (`referral-pdf.tsx:232`) to read: *"Patient referred for physician review."* when `referralContext === "non_red_flag"`, else the existing *"…due to identified red flags per O. Reg. 256/24."* (default).

- [ ] **Step 3: Verify default behaviour is unchanged**

The existing red-flag referral caller (`wizard-container.tsx:91-97`) passes no `referralContext`, so it defaults to `"red_flag"` and the rendered output is byte-identical to today. Confirm by eye + the Task 10 PDF test.

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/wizard/referral-pdf.tsx
git commit -m "feat(non-prescribe): add non-red-flag referralContext to ReferralPdf"
```

---

### Task 5: Abandon dialog

**Files:**
- Create: `src/components/wizard/abandon-dialog.tsx`

- [ ] **Step 1: Implement the dialog**

`src/components/wizard/abandon-dialog.tsx` — a `"use client"` modal component per design §4.8. Props:

```ts
interface AbandonDialogProps {
  open: boolean
  hasPatientIdentity: boolean   // patient.name && patient.dob — drives the "will not be saved" state
  onConfirm: (reason: AbandonmentReason, note: string) => void
  onCancel: () => void
}
```

Render (using the existing `src/components/ui/*` primitives — `Card`, `Button`, `Checkbox`/radio pattern, `Textarea`):
1. A heading "Assessment Not Completed".
2. A radio list of `ABANDONMENT_REASONS` (from Task 1).
3. An optional free-text `<Textarea>` note ("Add a note" — becomes the abandonment note / `assessmentNotes`).
4. A persistent state banner driven by `hasPatientIdentity`: when `false`, show *"No patient name/DOB recorded — this assessment will not be saved."*; when `true`, show *"A partial assessment record will be saved with outcome = abandoned."*
5. A "Confirm — Exit Assessment" button (calls `onConfirm(reason, note)`) and a "Cancel" button (calls `onCancel`). The confirm button is always enabled (abandonment is an exit, not a document — design §4.10).

> Use the existing dialog/modal primitive if one exists in `src/components/ui/`; otherwise render a fixed-position overlay Card (the wizard already uses `Card`/`Button`).

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/abandon-dialog.tsx
git commit -m "feat(non-prescribe): add AbandonDialog for outcome=abandoned"
```

---

### Task 6: Wizard wiring — non-prescribe branch + abandonment action

**Files:**
- Modify: `src/components/wizard/wizard-container.tsx`
- Modify: `src/components/wizard/step-rx.tsx`

- [ ] **Step 1: Add non-prescribe + abandon state to `WizardContainer`**

In `src/components/wizard/wizard-container.tsx` (`wizard-container.tsx:40-48`), add per design §4.1:

```ts
import { NonPrescribeReason, AbandonmentReason } from "@/types"
import { NonPrescribePanel } from "./non-prescribe-panel"
import { NonPrescribePdf } from "./non-prescribe-pdf"
import { AbandonDialog } from "./abandon-dialog"
import { NON_PRESCRIBE_REASONS, REASON_TAXONOMY_VERSION, computeReasonTaxonomyHash } from "@/lib/non-prescribe/reasons"
import { saveAssessmentAction } from "@/lib/assessment-actions"   // from #2
// ... (#3's ConsentPanel + saveConsentAction imports, assumed already present from #3's plan)
const [isNonPrescribe, setIsNonPrescribe] = useState(false)
const [nonPrescribeReason, setNonPrescribeReason] = useState<NonPrescribeReason | null>(null)
const [nonPrescribeRationale, setNonPrescribeRationale] = useState("")
const [abandonOpen, setAbandonOpen] = useState(false)
```

- [ ] **Step 2: Relax step-2 `canNext` + enforce mutual exclusion**

Update `canNext` (`wizard-container.tsx:52-59`) so step 2 advances when **either** an Rx is selected **or** a non-prescribe reason is set:

```ts
const canNext =
  step === 0 ? !!(patient.name && patient.dob)
  : step === 1 ? redFlagsChecked.length === 0
  : step === 2 ? (selectedRx !== null || nonPrescribeReason !== null)
  : true
```

Add mutual-exclusion handlers: `handleSelectRx` (`wizard-container.tsx:70-78`) clears `setNonPrescribeReason(null)` + `setNonPrescribeRationale("")` when an Rx is chosen; a new `handleNonPrescribeReasonChange` clears `setSelectedRx(null)` when a reason is chosen.

- [ ] **Step 3: Add the non-prescribe branch to step 2**

In `StepRx` (`step-rx.tsx`), accept the new non-prescribe props (extend `StepRxProps`) and render `<NonPrescribePanel>` beneath the Rx cards (above or instead of the existing `nonRx` block in `step-rx.tsx:110-139` — the panel now owns the `nonRx` list for the non-prescribe path; the prescribe path keeps its own copy per design §7.7, unless the optional `<NonRxAdvice>` extraction is adopted).

- [ ] **Step 4: Add the step-3 `isNonPrescribe` branch**

In the step-3 render block (`wizard-container.tsx:142-183`), add a third branch between `isReferral` and the prescribe `StepGenerate`:

```tsx
{step === 3 && isNonPrescribe && nonPrescribeReason && (
  <NonPrescribeSummary
    ailment={ailment}
    patient={patient}
    reason={nonPrescribeReason}
    rationale={nonPrescribeRationale}
    nonRxChecked={nonRxChecked}
    consent={consent}
    onConsentChange={setConsent}
    onDownload={handleDownloadNonPrescribe}
  />
)}
```

(The summary can be inlined in `WizardContainer` or factored into a small `<NonPrescribeSummary>`; either is acceptable. It renders: a summary Card (patient, ailment, reason label, rationale preview), #3's `<ConsentPanel>` (consent-to-record gate), and a "Download Non-Prescribe Documentation PDF" button `disabled={!consent || !nonPrescribeReason}`.)

- [ ] **Step 5: Implement `handleDownloadNonPrescribe`**

```ts
async function handleDownloadNonPrescribe() {
  if (!consent || !nonPrescribeReason) return
  const dateOfAssessment = new Date().toLocaleDateString("en-CA")
  try {
    // 1. Consent first (authorises retention) — from #3.
    const consentRes = await saveConsentAction({
      consent,
      patientIdentity: { name: patient.name, dob: patient.dob, postalCode: patient.postalCode },
      assessmentId,
    })
    // 2. Assessment with outcome=not_prescribed — extends #2's saveAssessmentAction (Task 8).
    await saveAssessmentAction({
      /* ...existing #2 payload (patient, ailment, symptoms, etc.)... */
      outcome: "not_prescribed",
      nonPrescribeReason,
      nonPrescribeRationale,
      reasonTaxonomyVersion: REASON_TAXONOMY_VERSION,
      reasonTaxonomyHash: computeReasonTaxonomyHash(NON_PRESCRIBE_REASONS),
      consentId: consentRes.consentId ?? undefined,
    })
    // 3. Document — fail-closed: a thrown error above blocks the download.
    const reasonOpt = NON_PRESCRIBE_REASONS.find(r => r.value === nonPrescribeReason)!
    if (nonPrescribeReason === "referred_to_physician") {
      // Non-red-flag referral sub-case (design §4.7) → reuse <ReferralPdf>.
      const doc = <ReferralPdf
        ailment={ailment} patient={patient} redFlagsChecked={[]}
        dateOfAssessment={dateOfAssessment} pharmacy={pharmacy}
        referralContext="non_red_flag" referralReason={nonPrescribeRationale}
      />
      await downloadPdf(doc, `referral-${dateOfAssessment}.pdf`)
    } else {
      const doc = <NonPrescribePdf
        ailment={ailment} patient={patient}
        reason={nonPrescribeReason} reasonLabel={reasonOpt.label}
        rationale={nonPrescribeRationale}
        nonRxChecked={nonRxChecked} assessmentNotes={assessmentNotes}
        dateOfAssessment={dateOfAssessment} pharmacy={pharmacy}
        consentSignatureDataUrl={consent.signatureDataUrl}
        consentSignerName={consent.signerName}
        consentSignerRelationship={consent.signerRelationship}
        consentCaptureMethod={consent.captureMethod}
        consentStatementVersion={consent.statementVersion}
        consentCapturedAt={consent.capturedAt}
      />
      await downloadPdf(doc, `non-prescribe-${dateOfAssessment}.pdf`)
    }
  } catch (err) {
    console.error("Non-prescribe document failed:", err)
  }
}
```

`assessmentId` is the client UUID from #2 (`useState(() => crypto.randomUUID())` at the `WizardContainer` level). During Phase 1, `saveConsentAction` + `saveAssessmentAction` are no-op stubs returning null and the download proceeds.

- [ ] **Step 6: Wire the abandonment action**

In the wizard footer (in `WizardContainer`'s return, beneath `<WizardNav>` at `wizard-container.tsx:187`), render a low-emphasis "Assessment Not Completed" text button + the `<AbandonDialog>`:

```tsx
<div className="flex justify-center pt-1">
  <Button variant="link" className="text-muted-foreground text-xs" onClick={() => setAbandonOpen(true)}>
    Assessment Not Completed
  </Button>
</div>
<AbandonDialog
  open={abandonOpen}
  hasPatientIdentity={!!(patient.name && patient.dob)}
  onCancel={() => setAbandonOpen(false)}
  onConfirm={handleAbandon}
/>
```

`handleAbandon`:

```ts
async function handleAbandon(reason: AbandonmentReason, note: string) {
  setAbandonOpen(false)
  // Identity guard (design §6): persist only if step 0 was completed.
  if (patient.name && patient.dob) {
    try {
      await saveAssessmentAction({
        /* ...partial #2 payload (patient, whatever symptoms/red-flags captured)... */
        outcome: "abandoned",
        abandonmentReason: reason,
        assessmentNotes: note,
      })
    } catch (err) {
      // Abandonment is an exit — do not block the route on persistence failure.
      console.error("Abandoned-save failed:", err)
    }
  }
  router.push("/")   // require use useRouter from next/navigation
}
```

(Phase-1 stub: `saveAssessmentAction` returns `{ assessmentId: null }` and the route proceeds.)

- [ ] **Step 7: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/wizard/wizard-container.tsx src/components/wizard/step-rx.tsx
git commit -m "feat(non-prescribe): add not_prescribed branch + abandon action to wizard"
```

---

### Task 7: Extend #2's `assessment` schema (fly.io migration)

> **Dependency:** the live migration depends on roadmap #2 (fly.io Postgres provisioned under BAA). Define the migration now; it is applied when fly.io is provisioned alongside #2's base schema.

**Files:**
- Database (fly.io, when provisioned): `assessment` table extension

- [ ] **Step 1: Write the migration**

Per design §4.5 (extends #2's `assessment` table from `persist-assessments-flyio-design.md` §4.3):

```sql
-- Extend #2's outcome CHECK to add 'not_prescribed'.
ALTER TABLE assessment DROP CONSTRAINT IF EXISTS assessment_outcome_check;
ALTER TABLE assessment ADD CONSTRAINT assessment_outcome_check
  CHECK (outcome IN ('prescribed','referred','not_prescribed','abandoned'));

ALTER TABLE assessment ADD COLUMN non_prescribe_reason text
  CHECK (non_prescribe_reason IS NULL OR non_prescribe_reason IN (
    'patient_declined','otc_sufficient','clinical_judgment',
    'already_treating','referred_to_physician','referred_elsewhere','other'
  ));
ALTER TABLE assessment ADD COLUMN non_prescribe_rationale text;
ALTER TABLE assessment ADD COLUMN abandonment_reason text
  CHECK (abandonment_reason IS NULL OR abandonment_reason IN (
    'patient_left','patient_deferred','lost_to_followup','duplicate','other'
  ));
ALTER TABLE assessment ADD COLUMN reason_taxonomy_version text;
ALTER TABLE assessment ADD COLUMN reason_taxonomy_hash text;

CREATE INDEX assessment_non_prescribe
  ON assessment (pharmacy_id, non_prescribe_reason)
  WHERE non_prescribe_reason IS NOT NULL;
```

- [ ] **Step 2: Coordinate with #2's migration ordering**

#2's base `assessment` migration (from #2 plan Task 3) defines the original CHECK as `('prescribed','referred','abandoned')`. #4's migration runs **after** #2's and swaps the CHECK to add `'not_prescribed'`. Confirm the migration filename ordering (e.g. `0002_assessment_non_prescribe.sql` after #2's `0001_phi_core.sql`) so the DROP+RECREATE does not fail on a fresh DB.

- [ ] **Step 3: Verify (on the staging fly.io dev cluster, after provisioning)**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'assessment' AND column_name IN
  ('non_prescribe_reason','non_prescribe_rationale','abandonment_reason','reason_taxonomy_version','reason_taxonomy_hash');
-- Expected: 5 rows.

SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'assessment_outcome_check';
-- Expected: CHECK (outcome IN ('prescribed','referred','not_prescribed','abandoned'))
```

---

### Task 8: Extend #2's `saveAssessmentAction` + store (non-prescribe fields)

**Files:**
- Modify: `src/lib/assessment-actions.ts` (from #2)
- Modify: `src/lib/phi/assessment-store.ts` (from #2)

- [ ] **Step 1: Extend the action payload**

In `src/lib/assessment-actions.ts` (from #2 plan Task 7), add optional non-prescribe fields to the `saveAssessmentAction` payload per design §4.9:

```ts
export interface SaveAssessmentPayload /* extends #2's payload */ {
  // ...existing #2 fields (patient, ailment, symptoms, selectedRx, etc.)...
  outcome: "prescribed" | "referred" | "not_prescribed" | "abandoned"
  nonPrescribeReason?: NonPrescribeReason
  nonPrescribeRationale?: string
  abandonmentReason?: AbandonmentReason
  reasonTaxonomyVersion?: string
  reasonTaxonomyHash?: string
  consentId?: string   // from #3
}
```

Add server-side re-validation (defence-in-depth, design §5.3): when `outcome === "not_prescribed"`, require a valid `nonPrescribeReason` (member of the enum); when `nonPrescribeReason === "other"`, require non-empty `nonPrescribeRationale`. The flag-guard (`if (!isPhiEnabled()) return { assessmentId: null }`) is inherited from #2 unchanged.

- [ ] **Step 2: Write the new columns in the store**

In `src/lib/phi/assessment-store.ts` (from #2 plan Task 5), extend the `INSERT INTO assessment` to include the five new columns when set. The `phi_audit_log` action stays `assessment.created` (the outcome + reason are in the row). The transaction discipline (patient-upsert + assessment-insert + audit in one `BEGIN`/`COMMIT`) is inherited from #2 unchanged.

- [ ] **Step 3: Emit the widened non-PHI audit metadata**

In `saveAssessmentAction` (after the store call), emit #2's `assessment.saved` event with the widened metadata per design §4.6:

```ts
await logAuditEvent("assessment.saved", {
  assessment_id: assessmentId,
  outcome,
  ...(nonPrescribeReason ? { reason_category: nonPrescribeReason } : {}),
  ...(abandonmentReason ? { reason_category: abandonmentReason } : {}),
  ...(reasonTaxonomyVersion ? { reason_taxonomy_version: reasonTaxonomyVersion } : {}),
})
```

No patient data, no ailment, no rationale, no notes. (The Supabase `log_event` validation is widened in Task 9.)

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assessment-actions.ts src/lib/phi/assessment-store.ts
git commit -m "feat(non-prescribe): extend saveAssessmentAction + store with not_prescribed/abandoned fields"
```

---

### Task 9: Widen the Supabase `assessment.saved` audit validation

**Files:**
- Database (Supabase migration): `audit.log_event`
- Modify: `src/lib/audit-actions.ts` (from #2 — only if #2 added an `assessment.saved` branch to the TS union; otherwise no TS change beyond confirming `assessment.saved` is present)

- [ ] **Step 1: Apply the Supabase migration**

Per design §4.6, widen the `assessment.saved` branch of `audit.log_event` (re-declare #2's branch + this addition — preserve all existing per-event checks, including the `consent.captured` branch from #3 and the `fax.sent` branch from #1):

```sql
  -- assessment.saved (widened by #4): require assessment_id + outcome;
  -- permit outcome in {prescribed,referred,not_prescribed,abandoned};
  -- optionally allow reason_category + reason_taxonomy_version (non-identifying);
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
      WHERE k LIKE 'patient_%'
         OR k IN ('ailment','drug','rx','name','dob',
                  'rationale','notes','non_prescribe_rationale')
    ) THEN
      RAISE EXCEPTION 'assessment.saved metadata must not contain patient/clinical data';
    END IF;
  END IF;
```

- [ ] **Step 2: Confirm the TS `EventType` union includes `assessment.saved`**

In `src/lib/audit-actions.ts` (from #2), confirm `"assessment.saved"` is in the `EventType` union (`audit-actions.ts:5-18`). #4 adds no new event type. If #2 has not yet added it, add it here (it is #2's event, but #4 is the second consumer).

- [ ] **Step 3: Verify (on Supabase staging)**

```sql
-- A not_prescribed save emits exactly the non-PHI shape:
SELECT event_type, metadata FROM audit.log
WHERE event_type = 'assessment.saved' AND metadata->>'outcome' = 'not_prescribed'
ORDER BY created_at DESC LIMIT 5;
-- Expected: metadata = { assessment_id, outcome, reason_category, reason_taxonomy_version }.
-- Confirm no 'rationale', 'notes', 'patient_*', 'ailment', or 'name' keys are present.
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit-actions.ts
git commit -m "feat(audit): widen assessment.saved to permit reason_category (non-PHI)"
```

---

### Task 10: Tests

**Files:**
- Create: `src/__tests__/non-prescribe-panel.test.tsx`
- Create: `src/__tests__/non-prescribe-pdf.test.tsx`
- Create: `src/__tests__/abandon-dialog.test.tsx`
- Create: `src/__tests__/non-prescribe-actions.test.ts`

- [ ] **Step 1: Panel validity logic**

`src/__tests__/non-prescribe-panel.test.tsx` — render `<NonPrescribePanel>` with React Testing Library. Assert: with no reason selected, `onReasonChange` has not been called with a value; selecting `patient_declined` calls `onReasonChange("patient_declined")`; selecting `referred_to_physician` surfaces the "will produce a referral document" note; selecting `other` makes the rationale `<Textarea>` required (the gate is enforced upstream in `WizardContainer`, but assert the panel surfaces the `*`); toggling a `nonRx` item calls `onNonRxChange` with the updated array.

- [ ] **Step 2: PDF renders the reason + rationale + advice**

`src/__tests__/non-prescribe-pdf.test.tsx` — render `<NonPrescribePdf>` into a `@react-pdf/renderer` test renderer. Assert: the title text contains "ASSESSMENT RECORD"; the reason label appears; the free-text rationale appears when non-empty; the `nonRx` advice items render only when checked (reuse `filterCheckedItems`); the footer contains "no prescription issued". (Use `react-pdf`'s test utilities or assert on the rendered JSON tree.)

- [ ] **Step 3: Abandon dialog confirm flow**

`src/__tests__/abandon-dialog.test.tsx` — render `<AbandonDialog open={true} hasPatientIdentity={...} />`. Assert: when `hasPatientIdentity` is false, the "will not be saved" banner is shown; when true, the "partial assessment record will be saved" banner is shown; selecting a reason + confirm calls `onConfirm(reason, note)`; cancel calls `onCancel`.

- [ ] **Step 4: Action flag-guard + non-PHI audit shape + server re-validation**

`src/__tests__/non-prescribe-actions.test.ts` — mock `requireAuth`, `isPhiEnabled`, the store, `logAuditEvent`. Assert: flag-off returns `{ assessmentId: null }` and writes nothing; flag-on with `outcome: "not_prescribed"` but missing `nonPrescribeReason` **throws** (server re-validation); flag-on with `nonPrescribeReason: "other"` but empty rationale **throws**; flag-on with a valid payload calls the store and emits `assessment.saved` with metadata **exactly** `{ assessment_id, outcome, reason_category, reason_taxonomy_version }` (no `rationale`, no `notes`, no patient keys). Assert the `non_prescribe_rationale` is passed to the store as a column value, never to `logAuditEvent`.

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/__tests__
git commit -m "test(non-prescribe): cover panel, PDF, abandon dialog, action guard + audit shape"
```

---

### Task 11: End-to-end verification (staging fly.io dev cluster)

> Requires #2's Phase 2 (fly.io provisioned, BAA signed, `PHI_PERSIST_ENABLED=true`) AND #3's Phase 2 (`ConsentPanel` + `saveConsentAction` live).

- [ ] **Step 1: Configure staging env**

Confirm `PHI_PERSIST_ENABLED=true`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT` are set (from #2); the fly.io dev cluster has #2's base migration + the Task-7 non-prescribe migration applied; #3's `consent` migration is applied.

- [ ] **Step 2: Non-prescribe path (patient declined, self-care advice)**

Log in, open an ailment, complete intake (In-Person), pass red-flag screening with none checked, reach step 2. Click "Do Not Prescribe", select `patient_declined`, enter a rationale, check 2 `nonRx` advice items, continue. On the step-3 summary, complete #3's `<ConsentPanel>` (check both required consents, sign). Expect: the Download button enables; on click, a row appears in fly.io `assessment` (`outcome='not_prescribed'`, `non_prescribe_reason='patient_declined'`, `non_prescribe_rationale` set, `reason_taxonomy_version='non-prescribe-v1'`), a `phi_audit_log` `'assessment.created'` row, the linked `assessment.consent_id` set (from #3), and the downloaded `<NonPrescribePdf>` shows the reason label, rationale, advice items, and the patient signature.

- [ ] **Step 3: OTC-sufficient path**

Select `otc_sufficient`, check several `nonRx` items, no rationale. Expect: the PDF's "Non-Rx Advice Provided" section lists the items; the `assessment` row records `non_prescribe_reason='otc_sufficient'`, `non_prescribe_rationale` NULL.

- [ ] **Step 4: Non-red-flag referral sub-case**

Select `referred_to_physician`, enter a referral rationale. Expect: the download produces a `<ReferralPdf>` (NOT `<NonPrescribePdf>`) with `referralContext="non_red_flag"`, the "Reason for Referral" block shows the rationale, the footer reads "referred for physician review"; the `assessment` row records `outcome='not_prescribed'`, `non_prescribe_reason='referred_to_physician'`, `has_red_flag=false`. (Distinct from the red-flag `outcome='referred'` path.)

- [ ] **Step 5: Abandonment with identity**

Complete step 0 (name + DOB), reach step 1, click "Assessment Not Completed", select `patient_left`, confirm. Expect: an `assessment` row with `outcome='abandoned'`, `abandonment_reason='patient_left'`, `has_red_flag` reflecting whatever was screened; route to `/`.

- [ ] **Step 6: Abandonment without identity (no trace)**

Open a fresh assessment, do NOT complete step 0, click "Assessment Not Completed". Expect: the dialog shows the "will not be saved" banner; on confirm, route to `/` with **no** `assessment` row written (identity guard).

- [ ] **Step 7: Verify no PHI leaked to Supabase**

```sql
SELECT event_type, metadata FROM audit.log
WHERE event_type = 'assessment.saved'
  AND metadata->>'outcome' IN ('not_prescribed','abandoned')
ORDER BY created_at DESC LIMIT 10;
```

Expected: metadata = `{ assessment_id, outcome, reason_category, reason_taxonomy_version }` only. No `rationale`, no `notes`, no patient data, no ailment anywhere.

- [ ] **Step 8: Verify cross-pharmacy isolation**

Switch to a second pharmacy; attempt to read the first pharmacy's `not_prescribed` assessment via the store. Expect: `null` (no row), enforced by the `WHERE pharmacy_id = $…` discipline inherited from #2 and covered by the Task-10 actions test.

---

## Data / DB changes (summary)

- **fly.io Postgres (PHI, BAA):** `assessment.outcome` CHECK extended to add `'not_prescribed'` (Task 7); new columns `non_prescribe_reason`, `non_prescribe_rationale`, `abandonment_reason`, `reason_taxonomy_version`, `reason_taxonomy_hash`; new partial index `assessment_non_prescribe`. Dedicated least-privilege app role (from #2): `INSERT`/`SELECT` only; no `UPDATE`/`DELETE` (immutability inherited).
- **Supabase (non-PHI):** no new event type; widen the `assessment.saved` validation branch in `audit.log_event` to permit `outcome='not_prescribed'/'abandoned'` + optional `reason_category` + `reason_taxonomy_version`, and to forbid the free-text `rationale`/`notes` keys (Task 9).
- **Dependencies:** none new — reuses `@react-pdf/renderer` (already present), `pg` (from #2), and the `src/components/ui/*` primitives. No new env vars — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.

## Verification commands

- Typecheck: `npx tsc --noEmit --pretty`
- Lint: `npm run lint`
- Tests: `npx vitest run`
- CI grep (scoping discipline, inherited from #2): `rg -n "FROM assessment|INTO assessment" src/lib/phi` — every match must contain `pharmacy_id`.
- CI grep (no PHI in audit): `rg -n "assessment.saved" src/lib` — confirm the metadata object literal contains no `rationale`/`notes`/`patient_*` keys.

## Rollout notes

- **Phase 0 (ops — inherited from #2):** fly.io Postgres in a Canadian region (`yyz`/`yul`); BAA signed; `PHI_IDENTITY_SALT` set. `PHI_PERSIST_ENABLED` stays `false` until then.
- **Phase 1 (code, behind `PHI_PERSIST_ENABLED=false`):** ship Tasks 1–6 + 8–10. The `<NonPrescribePanel>` renders on step 2, the `<NonPrescribePdf>` downloads, the `<AbandonDialog>` exits the wizard, and #3's `<ConsentPanel>` gates the non-prescribe Download — so the printed document is a complete legal artefact **even with no DB row**. `saveAssessmentAction` is a no-op stub (inherited from #2); Supabase receives no new events. This lets the non-prescribe UX land, typecheck, and test without waiting on ops, and independently of #2/#3 going live.
- **Phase 2 (after #2's and #3's Phase 2):** apply the Task-7 migration on fly.io and `PHI_PERSIST_ENABLED=true` lights up #2, #3, and #4 automatically. Run the Task-11 E2E against staging first.
- **Never** put the free-text rationale, the abandonment note, or any patient/ailment data in the Supabase audit metadata (enforced by the Task-9 `log_event` validation and the Task-10 actions test); **never** omit `pharmacy_id` from a fly.io `assessment` query (inherited from #2); **never** render a non-prescribe document without a captured consent-to-record (fail-closed gate on the non-prescribe branch).
- **Sequencing with siblings:** depends on #2 (`saveAssessmentAction`, `assessment`/`phi_audit_log` schema, `PHI_PERSIST_ENABLED`) and #3 (`ConsentPanel`, `saveConsentAction`, the two-column PDF signature layout). Unblocks #10 (PROM follow-up reads `outcome='not_prescribed'` to decide whether to ask the patient about a prescription that was *not* issued), #13 (analytics rollups over `non_prescribe_reason`), #25 (revenue-leakage optimizer surfaces `patient_declined` / `otc_sufficient` as missed-prescribing opportunities), and #26 (the `reason_taxonomy_version`/`reason_taxonomy_hash` governance feed). Legal/clinical review of `src/lib/non-prescribe/reasons.ts` (design §7.6) is a soft gate before production rollout.
