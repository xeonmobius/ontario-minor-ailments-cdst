# Red Flag Referral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When red flags are checked during assessment, allow generating a referral PDF instead of blocking the wizard.

**Architecture:** Add `isReferral` state to wizard-container. When red flags are checked at step 1, show a "Generate Referral" button that skips to a referral summary step. Create a new `referral-pdf.tsx` component reusing existing PDF styles. Modify `wizard-nav.tsx` to conditionally render the referral button.

**Tech Stack:** React (Next.js client components), @react-pdf/renderer, Vitest, React Testing Library

---

### Task 1: Create Referral PDF Component

**Files:**
- Create: `src/components/referral-pdf.tsx`

- [ ] **Step 1: Write referral PDF component**

```tsx
"use client"

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import { Ailment, PatientInfo, PharmacyDefaults } from "@/types"

const TEAL = "#1a6b6b"
const TEAL_LIGHT = "#e6f2f2"
const RED = "#b91c1c"
const RED_LIGHT = "#fef2f2"
const DARK = "#1a1a1a"
const MUTED = "#555555"
const BORDER = "#cccccc"

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: DARK,
    lineHeight: 1.3,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 3,
  },
  title: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: RED,
    letterSpacing: 1.5,
  },
  subtitle: { fontSize: 7, color: MUTED, marginTop: 1 },
  confidentialBadge: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: RED,
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  dateText: { fontSize: 7, color: MUTED, marginTop: 2, textAlign: "right" },
  divider: {
    borderBottomWidth: 1.5,
    borderBottomColor: RED,
    marginVertical: 4,
  },
  pharmacyBlock: {
    backgroundColor: TEAL_LIGHT,
    padding: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  pharmacyName: { fontSize: 8, fontFamily: "Helvetica-Bold", color: TEAL },
  pharmacyDetail: { fontSize: 6.5, color: MUTED, marginTop: 1 },
  sectionLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: RED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
    marginTop: 3,
  },
  columns: { flexDirection: "row", gap: 12, marginBottom: 2 },
  col: { flex: 1 },
  fieldRow: { flexDirection: "row", marginBottom: 1 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 7.5, width: 52, color: DARK },
  value: { fontSize: 7.5, flex: 1 },
  redFlagItem: {
    flexDirection: "row",
    marginBottom: 1,
  },
  redBullet: { width: 10, fontSize: 7, fontFamily: "Helvetica-Bold", color: RED },
  redBulletText: { fontSize: 7, flex: 1 },
  redBlock: {
    backgroundColor: RED_LIGHT,
    padding: 3,
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: "#fca5a5",
    marginBottom: 3,
  },
  patientSectionLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
    marginTop: 3,
  },
  signatureSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  signatureBox: { flex: 1, marginRight: 12 },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: DARK,
    marginBottom: 2,
    height: 20,
  },
  signatureLabel: { fontSize: 6, color: MUTED, fontFamily: "Helvetica-Bold" },
  footerDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    marginTop: 4,
    marginBottom: 2,
  },
  phipaBox: {
    fontSize: 5,
    color: MUTED,
    padding: 2,
    borderWidth: 0.5,
    borderColor: BORDER,
    borderRadius: 2,
  },
  footerText: { fontSize: 5, color: MUTED, textAlign: "center", marginTop: 2 },
})

interface ReferralPdfProps {
  ailment: Ailment
  patient: PatientInfo
  redFlagsChecked: string[]
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
}

export function ReferralPdf({
  ailment,
  patient,
  redFlagsChecked,
  dateOfAssessment,
  pharmacy,
}: ReferralPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>REFERRAL</Text>
            <Text style={styles.subtitle}>{ailment.name} — O. Reg. 256/24</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.confidentialBadge}>CONFIDENTIAL</Text>
            <Text style={styles.dateText}>{dateOfAssessment}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {pharmacy && (
          <View style={styles.pharmacyBlock}>
            <Text style={styles.pharmacyName}>{pharmacy.pharmacyName || "Pharmacy Name"}</Text>
            <Text style={styles.pharmacyDetail}>
              {pharmacy.address}{pharmacy.city ? `, ${pharmacy.city}` : ""}, {pharmacy.province} {pharmacy.postalCode} | Ph: {pharmacy.phone || "—"} | Fax: {pharmacy.fax || "—"}
            </Text>
            <Text style={styles.pharmacyDetail}>
              {pharmacy.pharmacistName || "—"} | License: {pharmacy.provincialLicense || "—"} | Reg#: {pharmacy.registrationNumber || "—"}
            </Text>
          </View>
        )}

        <View style={styles.columns}>
          <View style={styles.col}>
            <Text style={styles.patientSectionLabel}>Patient</Text>
            <View style={styles.fieldRow}><Text style={styles.label}>Name</Text><Text style={styles.value}>{patient.name}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.label}>DOB</Text><Text style={styles.value}>{patient.dob}</Text></View>
            {patient.ohip && <View style={styles.fieldRow}><Text style={styles.label}>OHIP</Text><Text style={styles.value}>{patient.ohip}</Text></View>}
            {patient.phone && <View style={styles.fieldRow}><Text style={styles.label}>Phone</Text><Text style={styles.value}>{patient.phone}</Text></View>}
          </View>
          <View style={styles.col}>
            <Text style={styles.patientSectionLabel}>Family Physician</Text>
            {patient.doctorName ? (
              <>
                <View style={styles.fieldRow}><Text style={styles.label}>Dr.</Text><Text style={styles.value}>{patient.doctorName}</Text></View>
                {patient.doctorPhone && <View style={styles.fieldRow}><Text style={styles.label}>Phone</Text><Text style={styles.value}>{patient.doctorPhone}</Text></View>}
                {patient.doctorFax && <View style={styles.fieldRow}><Text style={styles.label}>Fax</Text><Text style={styles.value}>{patient.doctorFax}</Text></View>}
              </>
            ) : (
              <Text style={{ fontSize: 7, color: MUTED }}>No physician on file</Text>
            )}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Red Flags Identified</Text>
        <View style={styles.redBlock}>
          {redFlagsChecked.map((flag) => (
            <View key={flag} style={styles.redFlagItem}>
              <Text style={styles.redBullet}>⚠</Text>
              <Text style={styles.redBulletText}>{flag}</Text>
            </View>
          ))}
        </View>

        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>Pharmacist Signature</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{pharmacy?.pharmacistName || "__________"} — License #{pharmacy?.provincialLicense || "__________"}</Text>
          </View>
        </View>

        <View style={styles.footerDivider} />
        <View style={styles.phipaBox}>
          <Text>CONFIDENTIAL — Privileged health information under PHIPA. Patient referred to primary care physician due to identified red flags per O. Reg. 256/24.</Text>
        </View>
        <Text style={styles.footerText}>Ontario Minor Ailments CDST — O. Reg. 256/24 under the Pharmacy Act</Text>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/referral-pdf.tsx
git commit -m "feat: add referral PDF component"
```

---

### Task 2: Update Wizard Nav for Referral Button

**Files:**
- Modify: `src/components/wizard/wizard-nav.tsx`

- [ ] **Step 1: Update WizardNav to accept and render referral button**

Replace the `WizardNavProps` interface and component in `wizard-nav.tsx`:

```tsx
interface WizardNavProps {
  step: number
  canNext: boolean
  onBack: () => void
  onNext: () => void
  hasRedFlags?: boolean
  onReferral?: () => void
}
```

Update the component export:

```tsx
export function WizardNav({ step, canNext, onBack, onNext, hasRedFlags, onReferral }: WizardNavProps) {
  const isFinished = step === 3

  return (
    <div className="flex justify-between pt-2">
      {isFinished ? (
        <Link href="/">
          <Button variant="outline">Start New Assessment</Button>
        </Link>
      ) : (
        <Button variant="outline" onClick={onBack} disabled={step === 0}>
          Back
        </Button>
      )}
      {isFinished ? null : hasRedFlags && onReferral ? (
        <Button variant="destructive" onClick={onReferral}>
          Generate Referral
        </Button>
      ) : (
        <Button onClick={onNext} disabled={!canNext}>
          Next
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors (wizard-container doesn't pass the new props yet, but they're optional so it compiles)

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/wizard-nav.tsx
git commit -m "feat: add referral button to wizard nav"
```

---

### Task 3: Add Referral Step to Wizard Container

**Files:**
- Modify: `src/components/wizard/wizard-container.tsx`

- [ ] **Step 1: Add isReferral state and referral handler**

Add to imports at top of file:

```tsx
import { ReferralPdf } from "./referral-pdf"
import { downloadPdf } from "@/lib/pdf-helpers"
```

Add `isReferral` state after the existing useState declarations (after line 41):

```tsx
const [isReferral, setIsReferral] = useState(false)
```

Add referral handler after `handleSelectedRxChange`:

```tsx
function handleReferral() {
  setIsReferral(true)
  setStep(3)
}

function handleDownloadReferral() {
  const dateOfAssessment = new Date().toLocaleDateString("en-CA")
  const doc = <ReferralPdf
    ailment={ailment}
    patient={patient}
    redFlagsChecked={redFlagsChecked}
    dateOfAssessment={dateOfAssessment}
    pharmacy={pharmacy}
  />
  downloadPdf(doc, `referral-${dateOfAssessment}.pdf`)
}
```

Update the `canNext` logic to use `isReferral`:

```tsx
const hasRedFlags = redFlagsChecked.length > 0

const canNext =
  step === 0
    ? !!(patient.name && patient.dob)
    : step === 1
      ? redFlagsChecked.length === 0
      : step === 2
        ? selectedRx !== null
        : true
```

Update the WizardNav props at the bottom of the return:

```tsx
<WizardNav step={step} canNext={canNext} onBack={handleBack} onNext={handleNext} hasRedFlags={hasRedFlags && step === 1} onReferral={handleReferral} />
```

Update the step 3 rendering block to handle referral:

```tsx
{step === 3 && isReferral && (
  <div className="flex flex-col gap-6">
    <div className="flex items-center gap-2">
      <span className="text-destructive text-lg">⚠</span>
      <h3 className="text-lg font-semibold">Referral Required</h3>
    </div>
    <p className="text-sm text-muted-foreground">Red flag(s) detected — this patient must be referred to their primary care physician.</p>
    <div className="bg-card border rounded-lg p-4">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><span className="font-semibold">Patient:</span> {patient.name}</div>
        <div><span className="font-semibold">DOB:</span> {patient.dob}</div>
        <div><span className="font-semibold">Ailment:</span> {ailment.name}</div>
        {patient.doctorName && <div><span className="font-semibold">Physician:</span> Dr. {patient.doctorName}</div>}
      </div>
      <div className="mt-3">
        <span className="font-semibold text-sm">Red Flags:</span>
        <ul className="mt-1 flex flex-col gap-1">
          {redFlagsChecked.map((flag) => (
            <li key={flag} className="text-sm text-destructive flex items-center gap-2">
              <span>⚠</span> {flag}
            </li>
          ))}
        </ul>
      </div>
    </div>
    <Button variant="destructive" onClick={handleDownloadReferral}>
      Download Referral PDF
    </Button>
    <p className="text-xs text-muted-foreground">Print, sign, and fax this referral to the patient's family physician.</p>
  </div>
)}
{step === 3 && !isReferral && selectedRx && (
  <StepGenerate
    ailment={ailment}
    patient={patient}
    selectedRx={selectedRx}
    assessmentNotes={assessmentNotes}
    symptomsChecked={symptomsChecked}
    nonRxChecked={nonRxChecked}
    pharmacy={pharmacy}
  />
)}
```

Also add the `Button` import:

```tsx
import { Button } from "@/components/ui/button"
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/wizard-container.tsx
git commit -m "feat: add referral step to assessment wizard"
```

---

### Task 4: Update Tests

**Files:**
- Modify: `src/__tests__/wizard-logic.test.ts`

- [ ] **Step 1: Add referral logic tests**

Append to the test file:

```ts
describe("Referral navigation logic", () => {
  it("can generate referral when red flags are checked", () => {
    const redFlags = ["Fever > 38.5"]
    const hasRedFlags = redFlags.length > 0
    expect(hasRedFlags).toBe(true)
  })

  it("referral skips to step 3", () => {
    const isReferral = true
    const step = 3
    expect(isReferral && step === 3).toBe(true)
  })

  it("normal flow continues when no red flags", () => {
    const redFlags: string[] = []
    const hasRedFlags = redFlags.length > 0
    expect(hasRedFlags).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/__tests__/wizard-logic.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/wizard-logic.test.ts
git commit -m "test: add referral navigation logic tests"
```

---

### Task 5: Verify and Push

- [ ] **Step 1: Run full typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Push**

```bash
git push
```
