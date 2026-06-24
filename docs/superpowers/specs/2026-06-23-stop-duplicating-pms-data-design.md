# Stop Duplicating PMS Data — Design

**Date:** 2026-06-23
**Roadmap item:** #5 (NOW tier) — "Stop duplicating PMS data (keep PDF-only copies, no safety checks)"
**Edge axis:** Focus / respect the PMS boundary
**Status:** Draft (pending user review)

---

## 1. Purpose

The CDST today re-captures several fields that the Pharmacy Management System (PMS) already owns authoritatively and that the CDST **does not use for any decision**. These fields are typed by the pharmacist at the counter, carried through `PatientInfo`, and printed as decoration on the assessment PDFs — but no allergy check, drug-interaction check, pregnancy/lactation Rx gate, or billing action ever runs against them.

Roadmap §3 is explicit: *"Allergy/drug-interaction checking, pregnancy/breastfeeding Rx gating, and auto-billing are explicitly excluded — the PMS already owns clinical-safety checks and claim submission. The CDST must not duplicate PMS responsibilities."* Feature #5 enforces that boundary by **removing the capture and rendering of PMS-owned clinical-safety and billing fields** that the CDST never acts on, eliminating double entry and — critically — removing a liability surface (a printed "Allergies: NKDA" line implies the CDST vetted the prescription against allergies, when it did no such thing).

**Non-goals.** This spec does **not** remove patient identity/demographics the CDST legitimately needs to label its own assessment artefact (name, DOB, sex, address, phone) — those are the "PDF-only copies" the roadmap permits. It also does **not** add a PMS integration or write-back; it simply stops collecting fields the CDST cannot use.

---

## 2. Current State (what exists in code)

### 2.1 The duplicated fields

`PatientInfo` (`src/types/index.ts:18-37`) declares 17 fields. The PMS-owned, decision-unused subset — the duplication this feature removes — is:

| Field | Type | Declared | Captured in UI | Used by any CDST decision? | Rendered on PDF |
|---|---|---|---|---|---|
| `allergies` | string (default `"NKDA"`) | `types/index.ts:27` | `step-patient.tsx:145-151` | **No** — `step-rx.tsx` never reads it; no allergy/interaction engine exists | `combined-pdf.tsx:225` (always) |
| `currentMeds` | string | `types/index.ts:28` | `step-patient.tsx:152-160` | **No** — no interaction check | `combined-pdf.tsx:226` (if non-empty) |
| `pregnant` | boolean | `types/index.ts:35` | `step-patient.tsx:65-74` | **No** — `step-rx.tsx` ignores it; pregnancy is instead surfaced as a **red-flag checklist item** (`ailment.redFlags`, e.g. UTI `data/ailments.json:870` "Pregnancy", VVC `:922`, NVP `:739`) which the pharmacist ticks independently in `step-redflags.tsx:56-82` | `combined-pdf.tsx:227` (red badge) |
| `breastfeeding` | boolean | `types/index.ts:36` | `step-patient.tsx:75-83` | **No** — no lactation Rx gate | `combined-pdf.tsx:228` (red badge) |
| `ohip` | string | `types/index.ts:22` | `step-patient.tsx:104-111` | **No** — billing is out of scope (roadmap §3); no claim is submitted | `combined-pdf.tsx:222` + `referral-pdf.tsx:194` (if non-empty) |
| `doctorLicense` | string | `types/index.ts:30` | `step-patient.tsx:175-182` | **No** — physician credential, PMS/prescriber-directory owned; not validated | `combined-pdf.tsx:246` (if non-empty) |

### 2.2 Fields that STAY (legitimate CDST needs)

These remain untouched — they are the assessment-record identity/routing data the CDST's own artefact requires:

- **Patient identity/demographics:** `name`, `dob`, `sex` (`types/index.ts:19-21`, required at `wizard-container.tsx:54`), `address`, `city`, `postalCode`, `phone` (`:23-26`). These are PHI but they belong to the assessment record the CDST produces; they are the "PDF-only copies" the roadmap explicitly permits.
- **Encounter context:** `encounterType` (`:34`, In-Person/Virtual/Phone) — CDST-specific, printed at `combined-pdf.tsx:234` and `referral-pdf.tsx:196`.
- **Referral routing (consumed by feature #1 e-fax and the referral PDF):** `doctorName`, `doctorPhone`, `doctorFax`, `doctorAddress` (`:29,31-33`). These are needed to *address* a referral/fax; they are contact data, not clinical-safety data. (`doctorFax` in particular is the e-fax destination validated in spec #1.)

### 2.3 Evidence the CDST performs no safety check

`grep` for `allergies|currentMeds|pregnant|breastfeeding` across `src/` returns hits only in: the type definition, the intake form (`step-patient.tsx`), `wizard-container.tsx` default state, the combined PDF render, and test fixtures. There is **zero** reference in `step-rx.tsx`, `step-redflags.tsx`, `step-generate.tsx`, `prescription-actions.ts`, or any `lib/` module. The Rx list presented to the pharmacist (`step-rx.tsx:39-62`) is the raw `ailment.rxOptions` from `data/ailments.json` with no filtering whatsoever. The pregnancy/lactation status therefore has **no effect on the offered regimens** — confirming these fields are decorative.

### 2.4 Interaction with prior specs (#1–#4)

- **#2 persist-assessments-flyio:** its `patient_snapshot` JSONB on fly.io must **not** store the removed fields. This spec tightens #2's snapshot schema (smaller PHI surface = smaller blast radius). The #2 spec's open question §7 (which fields persist) is resolved here: identity/demographics + encounter context persist; clinical-safety/billing fields do not.
- **#1 e-fax:** `doctorFax` stays (it is the fax destination). Unaffected.
- **#3 digital-consent:** unaffected (consent attaches to the assessment, not to allergies).
- **#4 refusal:** unaffected (refusal reasons are CDST-native, not PMS data).

---

## 3. Approach (options + recommendation)

### Option A — Remove capture + render; add boundary disclaimer (RECOMMENDED)

Delete `allergies`, `currentMeds`, `pregnant`, `breastfeeding`, `ohip`, and `doctorLicense` from `PatientInfo`, the intake form, the default-state object, and all PDF render sites. Add a one-line boundary disclaimer to both PDFs stating that allergy/interaction/pregnancy screening is performed in the PMS and is not duplicated by this assessment.

**Pros:** eliminates double entry (the #1 counter-time metric); removes the false-assurance liability surface; shrinks the PHI surface that #2 must protect; aligns the product with roadmap §3 verbatim.
**Cons:** a pharmacy that wants a fully self-contained PDF (no PMS lookup) loses the transcribed allergy/med lines. Mitigated by the disclaimer making the PMS boundary explicit.

### Option B — Keep capture, relabel as "transcribed, not checked"

Retain the fields but relabel them on the form and PDF as "Transcribed from PMS — NOT re-checked by this tool", and gate each behind an opt-in toggle so they default to hidden.

**Pros:** preserves a self-contained PDF for pharmacies that want it.
**Cons:** still double entry; still a PHI surface; the disclaimer does not fully erase the impression that a checked "Allergies" field implies vetting. Violates the roadmap's "remove duplication" intent.

### Option C — Defer to a future PMS read integration

Leave the fields in place today and replace them later with a read-only PMS pull (Kroll/Fillware) that auto-populates them.

**Pros:** best long-term UX.
**Cons:** out of scope for NOW tier (no PMS integration exists; `package.json` has no PMS client; roadmap places PMS interop in LATER tier #30). Deferring leaves the liability surface and double entry in place for the entire GTM window.

**Recommendation: Option A.** It is the only option that actually satisfies roadmap #5's "stop duplicating" mandate, it is cheap, it reduces risk, and it composes cleanly with #2's persistence schema. Option C remains a clean future evolution (a PMS read would simply re-populate the identity fields, which Option A retains).

---

## 4. Components & Data Model

### 4.1 Type change — `PatientInfo` (`src/types/index.ts:18-37`)

Remove six fields. The resulting interface:

```ts
export interface PatientInfo {
  name: string
  dob: string
  sex: string
  address: string
  city: string
  postalCode: string
  phone: string
  doctorName: string
  doctorPhone: string
  doctorFax: string
  doctorAddress: string
  encounterType: string
}
```

(13 fields → 12 fields is incorrect; it is 17 → 12 after removing `ohip`, `allergies`, `currentMeds`, `doctorLicense`, `pregnant`, `breastfeeding`.)

### 4.2 Default state — `defaultPatient` (`wizard-container.tsx:14-33`)

Drop the six keys and the `if (field === "sex" …)` pregnancy-reset branch in `step-patient.tsx:18-22` (no longer reachable). `allergies: "NKDA"` default (`wizard-container.tsx:23`) is deleted.

### 4.3 Intake form — `StepPatient` (`step-patient.tsx`)

- Remove the **Allergies** input (`:144-151`), **Current Medications** textarea (`:152-160`), **OHIP Number** input (`:104-111`), **License #** input (`:175-182`).
- Remove the **Pregnant / Breastfeeding** checkbox block (`:65-84`), including the `sex === "Female"` conditional wrapper. Sex selection itself stays.
- Update `handleChange` (`:16-23`) to drop the pregnancy/breastfeeding auto-clear side-effect.

### 4.4 PDFs

- **`combined-pdf.tsx`** (`src/components/combined-pdf.tsx`): delete the OHIP row (`:222`), Allergies row (`:225`), Meds row (`:226`), Pregnant status row (`:227`), Breastfeeding status row (`:228`), and doctor License row (`:246`). Add a boundary disclaimer line in the footer area near the existing PHIPA box (after `:231` region), e.g.:

  > *"Allergy, drug-interaction, and pregnancy/lactation screening are performed in the pharmacy management system and are not duplicated by this assessment."*

- **`referral-pdf.tsx`** (`src/components/wizard/referral-pdf.tsx`): delete the OHIP row (`:194`). Add the same disclaimer in the footer PHIPA box area (`:231-233`).

### 4.5 Data model impact (delegates to #2)

No new table or column. This spec **constrains** #2's `patient_snapshot` JSONB: the snapshot stored on fly.io **must not** include the six removed keys. When #2 is implemented, `assessment-store.ts` should type its snapshot input against the slimmed `PatientInfo`; any stale fixture still carrying the old keys is a build error, not silent data loss.

### 4.6 Audit / log impact

No audit-event change. The removed fields never appeared in any `log_event` payload (the Supabase audit log is non-PHI and never carried allergies/meds/OHIP). Confirmed by reading `audit-actions.ts` EventType union — no event references these fields.

---

## 5. Security / PHIPA-PIPEDA Posture

**Net effect: reduced PHI surface, reduced liability.**

| Concern | Before | After |
|---|---|---|
| PHI fields on the client-rendered PDF | name, dob, sex, ohip, address, phone, allergies, currentMeds, pregnant, breastfeeding, doctorLicense + routing | name, dob, sex, address, phone + routing (doctorName/Phone/Fax/Address) |
| False-assurance liability | "Allergies: NKDA" printed implies vetting | Removed; disclaimer states screening lives in PMS |
| fly.io snapshot (per #2) | would have carried 6 extra PHI fields | carries none of them — smaller blast radius |
| Double-entry time at counter | 6 extra fields per consult | 0 |

This change **strengthens** the fly.io-BAA / Supabase-auth split from roadmap §6: fewer PHI fields exist anywhere, and the disclaimer makes the CDST-vs-PMS responsibility boundary auditable on the face of the document. No field crosses from fly.io to Supabase or vice-versa as a result of this change (the removed fields were never logged to Supabase).

---

## 6. Edge Cases

1. **Red-flag screening still catches pregnancy.** Removing `patient.pregnant` does NOT weaken screening: ailments where pregnancy is material list it in `ailment.redFlags` (UTI, VVC, NVP, etc.), and the pharmacist ticks it in `step-redflags.tsx`. The standalone boolean was redundant. Verified no ailment's decision logic reads `patient.pregnant`.
2. **Allergy-driven regimen exclusion (e.g. "check sulfa allergy" note on TMP-SMX, `data/ailments.json:886`).** This note lives in the Rx option's `notes` text shown to the pharmacist (`step-rx.tsx:55-57`); it is advisory, not an automated gate, and it remains. The CDST never auto-excluded sulfa-Rx based on `patient.allergies` — it only surfaced the note. Removing the allergies input does not change this; the pharmacist still sees the note and applies PMS-held allergy data.
3. **Pharmacy that relied on the PDF as a standalone record.** Loses the transcribed allergy/med/OHIP/pregnancy lines. The disclaimer directs the reader to the PMS. Acceptable per roadmap §3; flagged under Open Questions for pharmacies without a PMS (rare in the target independent-community segment, which runs Kroll/Nexxsys/Generic).
4. **`doctorLicense` removal on the referral.** The receiving physician's license is their own credential; the CDST was asserting it from patient-reported/PMS data without validation. Removing it removes an unvalidated credential claim from a medico-legal document. The pharmacist's own license (`pharmacy.provincialLicense`) is unaffected and stays.
5. **Existing persisted records (post-#2).** If #2 has shipped and historical assessments carry the old keys in their JSONB snapshot, those rows are left as-is (immutable history). Only new writes use the slimmed shape. No migration backfill is required.
6. **Test fixtures.** Three test files hardcode the removed fields (`__tests__/step-patient.test.tsx`, `step-redflags.test.tsx`, `combined-pdf-txid.test.tsx`). They must be updated in lockstep or the build breaks — see plan.
7. **Accessibility/label associations.** Removing the OHIP/allergies/meds inputs removes their `htmlFor`/`id` pairs; no dangling labels remain because each label is co-located with its input.

---

## 7. Open Questions

1. **Self-contained-PDF pharmacies.** Is there a material segment of target customers (independent Ontario community pharmacies) that have NO PMS and relied on the CDST PDF as the only record carrying allergies/meds? If yes, Option B's opt-in transcription toggle may be needed as a follow-up. (Roadmap assumes all targets run a PMS.)
2. **OHIP on the referral.** Some fax-receiving physicians' offices use OHIP to file the referral. Confirm removal does not create rework on the receiving end; if it does, `ohip` may need to stay on the **referral PDF only** (not the assessment PDF). Default in this spec: remove everywhere for simplicity.
3. **Future PMS read (Option C / roadmap #30).** When a read-only PMS integration lands, should the removed fields re-appear as **read-only PMS-sourced** values (clearly labelled, never re-typed)? This spec's slimmed `PatientInfo` is forward-compatible with that.
4. **`doctorLicense` vs prescriber directory.** Should the CDST hold a (PMS-sourced, read-only) prescriber directory long-term, from which `doctorName/Phone/Fax/Address` are selected rather than typed? Out of scope here but this cleanup makes that future model cleaner by removing the unused credential field now.
5. **Disclaimer wording legal review.** The exact disclaimer text should be reviewed by the pharmacy owner's legal/college liaison; this spec proposes wording but treats final phrasing as a soft gate (same pattern as #3's statements and #4's reasons taxonomy).

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

- `src/types/index.ts` — slim `PatientInfo` (remove 6 fields).
- `src/components/wizard/wizard-container.tsx` — slim `defaultPatient`.
- `src/components/wizard/step-patient.tsx` — remove 4 inputs + pregnancy block + side-effect.
- `src/components/combined-pdf.tsx` — remove 6 render rows + add disclaimer.
- `src/components/wizard/referral-pdf.tsx` — remove OHIP row + add disclaimer.
- `src/__tests__/step-patient.test.tsx`, `src/__tests__/step-redflags.test.tsx`, `src/__tests__/combined-pdf-txid.test.tsx` — update fixtures and assertions.
- (Indirect, via #2) the future `src/lib/phi/assessment-store.ts` snapshot typing — constrained by this spec but not created here.
