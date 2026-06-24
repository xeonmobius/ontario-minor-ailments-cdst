# Stop Duplicating PMS Data — Implementation Plan

**Date:** 2026-06-23
**Roadmap item:** #5 (NOW tier)
**Spec:** `docs/superpowers/specs/2026-06-23-stop-duplicating-pms-data-design.md`

---

## Goal

Remove the capture, transport, and PDF rendering of six PMS-owned, decision-unused fields (`allergies`, `currentMeds`, `pregnant`, `breastfeeding`, `ohip`, `doctorLicense`) from the CDST. Add a boundary disclaimer to both PDFs stating that allergy/interaction/pregnancy screening is performed in the PMS. This is a pure subtraction + disclaimer; no new state, no DB change, no dependency.

Each step below is a small, independently verifiable unit. The whole change should land in a single PR/commit (it is a cohesive type change), but the steps sequence the work so it can be reviewed and tested incrementally.

---

## Sequenced steps

### Task 1 — Slim the `PatientInfo` type

**File:** `src/types/index.ts` (`:18-37`)

Remove the six fields. New shape:

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

**Verify:** `npx tsc --noEmit` will fail in the next tasks (form/PDF still reference removed fields). That is expected; this task only fixes the type. Do not run the build until Task 5.

### Task 2 — Slim `defaultPatient` in the wizard

**File:** `src/components/wizard/wizard-container.tsx` (`:14-33`)

Delete the `ohip`, `allergies: "NKDA"`, `currentMeds`, `doctorLicense`, `pregnant`, `breastfeeding` keys from `defaultPatient`. Leave `name`, `dob`, `sex`, `address`, `city`, `postalCode`, `phone`, `doctorName`, `doctorPhone`, `doctorFax`, `doctorAddress`, `encounterType`.

**Verify:** no standalone check yet; the field references still compile at this site because no key is read that was removed here.

### Task 3 — Strip the intake form

**File:** `src/components/wizard/step-patient.tsx`

- Remove the **OHIP Number** input block (`:104-111`).
- Remove the **Allergies** input block (`:144-151`).
- Remove the **Current Medications** textarea block (`:152-160`).
- Remove the **License #** input block (`:175-182`).
- Remove the **Pregnant / Breastfeeding** checkbox block (`:65-84`), including the `{patient.sex === "Female" && ( … )}` wrapper. Keep the Sex selector itself (`:48-64`).
- Simplify `handleChange` (`:16-23`): drop the `if (field === "sex" && value !== "Female") { update.pregnant = false; update.breastfeeding = false }` branch — it references removed fields. The function reduces to `onChange({ ...patient, [field]: value })` (cast `value` as needed; preserve the existing `keyof PatientInfo` signature).

**Verify:** `npx tsc --noEmit` — `step-patient.tsx` should now type-check against the slimmed type.

### Task 4 — Update the PDFs (remove rows + add disclaimer)

**File:** `src/components/combined-pdf.tsx`

- Delete the OHIP row (`:222`): `{patient.ohip && <View …>OHIP…</View>}`.
- Delete the Allergies row (`:225`).
- Delete the Meds row (`:226`).
- Delete the Pregnant status row (`:227`).
- Delete the Breastfeeding status row (`:228`).
- Delete the doctor License row (`:246`): `{patient.doctorLicense && <View …>License…</View>}`.
- Add a boundary disclaimer `<Text>` in the footer area (near the existing PHIPA box, after the assessment columns close ~`:239`), styled consistent with the surrounding footer text:

  ```
  Allergy, drug-interaction, and pregnancy/lactation screening are performed in the
  pharmacy management system and are not duplicated by this assessment.
  ```

**File:** `src/components/wizard/referral-pdf.tsx`

- Delete the OHIP row (`:194`).
- Add the same disclaimer `<Text>` inside/under the PHIPA box (`:231-233`), above the existing footer line.

**Verify:** `npx tsc --noEmit` — both PDF components now type-check; `grep -n "allergies\|currentMeds\|pregnant\|breastfeeding\|ohip\|doctorLicense" src/components/combined-pdf.tsx src/components/wizard/referral-pdf.tsx` returns no hits.

### Task 5 — Update tests

**Files:**
- `src/__tests__/step-patient.test.tsx`
- `src/__tests__/step-redflags.test.tsx`
- `src/__tests__/combined-pdf-txid.test.tsx`

All three construct a `PatientInfo` fixture with the removed keys (`step-patient.test.tsx:10-17`, `step-redflags.test.tsx:10-17`, `combined-pdf-txid.test.tsx:23-24`). Update each fixture to the slimmed shape (remove `ohip`, `allergies`, `currentMeds`, `doctorLicense`, `pregnant`, `breastfeeding`).

Then update assertions:
- `step-patient.test.tsx`: remove the assertion that the OHIP field is in the document (`:29`) and the allergies assertions (`:34`, `:38-41`). If a test specifically checks the Pregnant/Breastfeeding checkboxes, delete that test (the inputs no longer exist).
- `step-redflags.test.tsx`: same fixture slimming; this file's patient fixture is incidental, so only the fixture needs editing.
- `combined-pdf-txid.test.tsx`: slim the fixture; if any assertion checks the allergies/OHIP/pregnancy render, delete that assertion (those rows no longer exist).

Add one new assertion in `step-patient.test.tsx`: assert the Sex selector is still rendered and that none of the removed labels (`/ohip/i`, `/allergies/i`, `/current medications/i`, `/license/i`, `/pregnant/i`, `/breastfeeding/i`) are in the document.

### Task 6 — Whole-repo grep guard + full build

**Verify:**
- `rg -n "patient\.(allergies|currentMeds|pregnant|breastfeeding|ohip|doctorLicense)" src/` — must return **zero** hits. (A hit indicates a missed call site.)
- `rg -n "\ballergies\b|\bcurrentMeds\b|\bpregnant\b|\bbreastfeeding\b" src/` — review any remaining hits; legitimate hits are only in `data/ailments.json` (e.g. "sulfa allergy", "Pregnancy" red flag) and in the Rx `notes` advisory text, which are unaffected. No `src/` code reference should remain.
- `npm run typecheck` (or `npx tsc --noEmit`) — passes.
- `npm run lint` — passes.
- `npm test` — all green.

---

## Files to create/modify

| File | Action |
|---|---|
| `src/types/index.ts` | Modify — slim `PatientInfo` (remove 6 fields) |
| `src/components/wizard/wizard-container.tsx` | Modify — slim `defaultPatient` |
| `src/components/wizard/step-patient.tsx` | Modify — remove 4 inputs + pregnancy block + side-effect |
| `src/components/combined-pdf.tsx` | Modify — remove 6 render rows + add disclaimer |
| `src/components/wizard/referral-pdf.tsx` | Modify — remove OHIP row + add disclaimer |
| `src/__tests__/step-patient.test.tsx` | Modify — slim fixture, drop removed-field assertions, add absence assertions |
| `src/__tests__/step-redflags.test.tsx` | Modify — slim fixture |
| `src/__tests__/combined-pdf-txid.test.tsx` | Modify — slim fixture + assertions |

**No files created. No new dependencies. No config changes.**

---

## Data / DB changes (summary)

**None.** No table or column is added or removed. This spec only constrains the future fly.io `patient_snapshot` defined in spec #2 (it must not include the six removed keys once #2 ships). Any historical rows written before #2 ships are unaffected because #2 has not shipped yet; if #2 has shipped, historical JSONB snapshots keep their old keys (immutable history) and only new writes use the slimmed shape.

---

## Tests

- **Unit:** `step-patient.test.tsx` — asserts the Sex selector renders and the six removed fields' labels are absent.
- **Unit:** `combined-pdf-txid.test.tsx` — asserts the PDF still renders the tx_id and that no removed-field row appears (the slimmed fixture should produce no "Allergies"/"OHIP"/"Pregnant" text).
- **Regression:** `step-redflags.test.tsx` — confirms red-flag screening is unaffected (the pregnancy red-flag checklist item still renders from `ailment.redFlags`, independent of `patient.pregnant`).
- **Snapshot/grep guard:** the `rg` commands in Task 6 act as a structural regression test against re-introducing the fields.

---

## Verification commands

```bash
# 1. No remaining code references to the removed fields
rg -n "patient\.(allergies|currentMeds|pregnant|breastfeeding|ohip|doctorLicense)" src/   # expect: empty

# 2. Type check
npx tsc --noEmit

# 3. Lint
npm run lint

# 4. Tests
npm test
```

All four must pass (command #1 must print nothing) before the change is considered complete.

---

## Rollout notes

- **No flag needed.** This is a pure subtraction with no behavior change beyond fewer form fields and fewer PDF rows. There is no persistence dependency (the fields were never persisted). Ship directly to production after CI is green.
- **User communication.** A one-line release note for pharmacy users: *"Patient intake no longer asks for allergies, current medications, OHIP, pregnancy/breastfeeding status, or the physician's license number — these are maintained in your PMS, which performs the clinical-safety checks. The assessment PDF now states this explicitly."*
- **Sequencing vs #2.** Safe to ship before or after #2. If shipped **before** #2, #2's `assessment-store.ts` snapshot typing simply never sees the removed keys. If shipped **after** #2, #2's snapshot schema should be re-validated to ensure no code path still writes the removed keys (the grep guard in Task 6 covers this).
- **Disclaimer legal review** is a **soft gate** (same pattern as #3's consent statements and #4's reason taxonomy): the proposed wording ships, and the pharmacy owner's legal/college liaison can request a rephrase without blocking the technical change.
- **Future evolution.** Roadmap #30 (PMS read integration) can later re-introduce the removed fields as **read-only PMS-sourced** values, clearly labelled and never re-typed. The slimmed `PatientInfo` is forward-compatible with that.
