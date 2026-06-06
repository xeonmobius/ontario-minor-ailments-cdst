# Red Flag Referral Workflow

## Summary

When a pharmacist checks any red flag during step 1 of the assessment wizard, the normal prescribing path is blocked. Instead, a "Generate Referral" button appears. Clicking it advances to a referral summary screen where the pharmacist can download a referral PDF to fax to the patient's family physician.

## User Flow

1. **Step 1 (Red Flags)** — User checks one or more red flags
   - Warning alert: "Cannot Prescribe — patient must be referred"
   - "Next" button replaced with red "Generate Referral" button
   - Symptoms and assessment notes sections remain hidden

2. **Referral Summary (new step 4)** — After clicking "Generate Referral"
   - Summary card: patient name, ailment, checked red flags, family physician
   - "Download Referral PDF" button generates and downloads PDF
   - "Start New Assessment" link returns to dashboard

## Wizard State Changes

- `wizard-container.tsx`: Add `isReferral` boolean. When red flags are checked at step 1 and user clicks "Generate Referral", set `isReferral = true` and jump to step 4.
- `wizard-nav.tsx`: At step 1 with red flags checked, show "Generate Referral" button (red variant) instead of "Next".
- Steps 2 (Rx) and 3 (Generate PDFs) are skipped entirely during referral.

## Referral PDF

File: `src/components/referral-pdf.tsx`

Layout (reuses existing PDF styles from `combined-pdf.tsx`):
- **Header**: "REFERRAL" title, ailment name, O. Reg. 256/24 subtitle, CONFIDENTIAL badge, date
- **Pharmacy block**: Same teal block as prescription PDF
- **Two columns**: Patient info (left) | Family Physician (right)
- **Red Flags Identified**: List of checked red flags with red checkmarks
- **Signature**: Pharmacist signature line
- **Footer**: PHIPA notice

Props needed: `ailment`, `patient`, `redFlagsChecked`, `dateOfAssessment`, `pharmacy`

## Files to Modify

- `src/components/wizard/wizard-container.tsx` — add `isReferral` state, referral step logic
- `src/components/wizard/wizard-nav.tsx` — conditional "Generate Referral" button
- `src/components/wizard/step-generate.tsx` — render referral step when `isReferral` is true

## Files to Create

- `src/components/referral-pdf.tsx` — referral PDF template

## Out of Scope

- Storing referral records in database
- Emailing the referral
- Tracking referral status
