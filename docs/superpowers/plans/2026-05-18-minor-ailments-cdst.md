# Ontario Minor Ailments CDST — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js static web app for Ontario pharmacists to assess minor ailments and generate prescription + doctor notification PDFs.

**Architecture:** Static site with client-side-only logic. Ailment data parsed from markdown at build time into JSON. 4-step wizard per ailment with red flag screening, Rx selection, and PDF generation. Pharmacy defaults persisted in localStorage.

**Tech Stack:** Next.js 14+ (App Router), shadcn/ui, Tailwind CSS, @react-pdf/renderer

---

## File Structure

```
cdst-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout
│   │   ├── page.tsx                # Home — ailment grid
│   │   ├── globals.css             # Tailwind base
│   │   └── assess/
│   │       └── [ailment]/
│   │           └── page.tsx        # Wizard page
│   ├── components/
│   │   ├── ailment-grid.tsx        # 19-card grid
│   │   ├── ailment-card.tsx        # Single ailment card
│   │   ├── wizard/
│   │   │   ├── wizard-container.tsx  # Step state + navigation
│   │   │   ├── step-patient.tsx      # Step 1: patient info
│   │   │   ├── step-redflags.tsx     # Step 2: red flags + symptoms
│   │   │   ├── step-rx.tsx           # Step 3: select Rx
│   │   │   ├── step-generate.tsx     # Step 4: generate PDFs
│   │   │   └── wizard-nav.tsx        # Back/Next buttons + step indicator
│   │   ├── pharmacy-settings.tsx   # Dialog for pharmacy defaults
│   │   ├── prescription-pdf.tsx    # @react-pdf/renderer template
│   │   └── notification-pdf.tsx    # @react-pdf/renderer template
│   ├── lib/
│   │   ├── ailments.ts            # Parsed ailment data + types
│   │   ├── parse-ailments.ts      # Build-time MD parser
│   │   ├── pharmacy-storage.ts    # localStorage helpers
│   │   └── pdf-helpers.ts         # PDF download trigger
│   └── types/
│       └── index.ts               # Shared TypeScript types
├── data/
│   └── ailments.json              # Generated at build from MD files
├── ontario-minor-ailments-cards/  # Source markdown (symlinked or copied)
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── next.config.ts
```

---

### Task 1: Scaffold Next.js + shadcn/ui

**Files:**
- Create: `cdst-app/package.json`
- Create: `cdst-app/next.config.ts`
- Create: `cdst-app/tsconfig.json`
- Create: `cdst-app/tailwind.config.ts`
- Create: `cdst-app/src/app/layout.tsx`
- Create: `cdst-app/src/app/globals.css`
- Create: `cdst-app/src/app/page.tsx`

- [ ] **Step 1: Scaffold Next.js project**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST"
npx create-next-app@latest cdst-app --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm
```

- [ ] **Step 2: Install shadcn/ui**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npx shadcn@latest init -d
```

- [ ] **Step 3: Install shadcn components needed**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npx shadcn@latest add button card input label textarea checkbox dialog badge separator alert
```

- [ ] **Step 4: Install PDF library**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm install @react-pdf/renderer
```

- [ ] **Step 5: Verify dev server starts**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm run dev
```

Expected: Server starts on localhost:3000, default Next.js page renders.

- [ ] **Step 6: Commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git init && git add -A && git commit -m "feat: scaffold Next.js + shadcn/ui + @react-pdf/renderer"
```

---

### Task 2: Types + Ailment Data Parser

**Files:**
- Create: `cdst-app/src/types/index.ts`
- Create: `cdst-app/src/lib/parse-ailments.ts`
- Create: `cdst-app/scripts/build-data.ts`
- Create: `cdst-app/data/ailments.json`

- [ ] **Step 1: Create TypeScript types**

Create `cdst-app/src/types/index.ts`:

```ts
export interface RxOption {
  drug: string
  dose: string
  notes: string
}

export interface Ailment {
  id: string
  name: string
  slug: string
  symptoms: string[]
  redFlags: string[]
  rxOptions: RxOption[]
  nonRx: string[]
  followUp: string
}

export interface PatientInfo {
  name: string
  dob: string
  ohip: string
  address: string
  city: string
  postalCode: string
  phone: string
  allergies: string
  currentMeds: string
}

export interface PharmacyDefaults {
  pharmacyName: string
  address: string
  city: string
  province: string
  postalCode: string
  phone: string
  fax: string
  pharmacistName: string
  ocpLicense: string
  registrationNumber: string
}

export interface SelectedRx extends RxOption {
  sig: string
  quantity: string
  refills: string
  duration: string
}

export interface AssessmentData {
  ailment: Ailment
  patient: PatientInfo
  redFlagsChecked: string[]
  hasRedFlag: boolean
  assessmentNotes: string
  selectedRx: SelectedRx | null
  dateOfAssessment: string
}
```

- [ ] **Step 2: Create markdown parser**

Create `cdst-app/src/lib/parse-ailments.ts`:

```ts
import fs from "fs"
import path from "path"
import matter from "gray-matter"

export function parseAilments(dir: string) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md") && !f.includes("template"))
  return files.map(file => {
    const raw = fs.readFileSync(path.join(dir, file), "utf-8")
    const lines = raw.split("\n")
    const name = lines[0].replace(/^# /, "").trim()
    const slug = file.replace(/^\d+-/, "").replace(".md", "")
    const id = file.replace(".md", "")

    const sections: Record<string, string> = {}
    let current = ""
    for (const line of lines.slice(1)) {
      if (line.startsWith("## ")) {
        current = line.replace("## ", "").trim().toLowerCase()
        sections[current] = ""
      } else if (current) {
        sections[current] += line + "\n"
      }
    }

    const symptoms = (sections["symptoms"] || "")
      .split("\n").map(l => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)

    const redFlags = (sections["red flags → refer"] || "")
      .split("\n").map(l => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)

    const rxRaw = sections["rx options"] || ""
    const rxOptions = parseRxTable(rxRaw)

    const nonRx = (sections["non-rx"] || "")
      .split("\n").map(l => l.replace(/^[-*]\s*/, "").trim()).filter(Boolean)

    const followUp = (sections["follow-up"] || "").trim()

    return { id, name, slug, symptoms, redFlags, rxOptions, nonRx, followUp }
  })
}

function parseRxTable(raw: string) {
  const lines = raw.split("\n").filter(l => l.includes("|") && !l.match(/^[\s|:-]+$/))
  if (lines.length < 2) return []
  return lines.slice(1).map(line => {
    const cols = line.split("|").map(c => c.trim()).filter(Boolean)
    return { drug: cols[0] || "", dose: cols[1] || "", notes: cols[2] || "" }
  })
}
```

- [ ] **Step 3: Create build script**

Create `cdst-app/scripts/build-data.ts`:

```ts
import fs from "fs"
import path from "path"
import { parseAilments } from "../src/lib/parse-ailments"

const sourceDir = path.resolve(__dirname, "../../Ontario-Minor-Ailments-Cards")
const outDir = path.resolve(__dirname, "../data")
const outFile = path.join(outDir, "ailments.json")

fs.mkdirSync(outDir, { recursive: true })
const ailments = parseAilments(sourceDir)
fs.writeFileSync(outFile, JSON.stringify(ailments, null, 2))
console.log(`Parsed ${ailments.length} ailments → ${outFile}`)
```

- [ ] **Step 4: Install gray-matter if needed, run build script, verify output**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm install gray-matter
npx tsx scripts/build-data.ts
cat data/ailments.json | head -50
```

Expected: JSON array with 19 ailments, each having symptoms, redFlags, rxOptions, etc.

- [ ] **Step 5: Create ailments data accessor**

Create `cdst-app/src/lib/ailments.ts`:

```ts
import ailmentsData from "../../data/ailments.json"
import { Ailment } from "@/types"

export const ailments: Ailment[] = ailmentsData as Ailment[]

export function getAilmentBySlug(slug: string): Ailment | undefined {
  return ailments.find(a => a.slug === slug)
}
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git add -A && git commit -m "feat: types + ailment data parser + static JSON"
```

---

### Task 3: Home Page — Ailment Selection Grid

**Files:**
- Modify: `cdst-app/src/app/page.tsx`
- Create: `cdst-app/src/components/ailment-grid.tsx`
- Create: `cdst-app/src/components/ailment-card.tsx`
- Create: `cdst-app/src/components/pharmacy-settings.tsx`
- Create: `cdst-app/src/lib/pharmacy-storage.ts`

- [ ] **Step 1: Create pharmacy localStorage helpers**

Create `cdst-app/src/lib/pharmacy-storage.ts`:

```ts
import { PharmacyDefaults } from "@/types"

const KEY = "cdst-pharmacy-defaults"

export function getPharmacyDefaults(): PharmacyDefaults | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(KEY)
  return raw ? JSON.parse(raw) : null
}

export function savePharmacyDefaults(data: PharmacyDefaults): void {
  localStorage.setItem(KEY, JSON.stringify(data))
}
```

- [ ] **Step 2: Create pharmacy settings dialog**

Create `cdst-app/src/components/pharmacy-settings.tsx`:

```tsx
"use client"
import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getPharmacyDefaults, savePharmacyDefaults } from "@/lib/pharmacy-storage"
import { PharmacyDefaults } from "@/types"

const defaultPharmacy: PharmacyDefaults = {
  pharmacyName: "", address: "", city: "", province: "Ontario",
  postalCode: "", phone: "", fax: "", pharmacistName: "",
  ocpLicense: "", registrationNumber: ""
}

export function PharmacySettings() {
  const [data, setData] = useState<PharmacyDefaults>(defaultPharmacy)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const saved = getPharmacyDefaults()
    if (saved) setData(saved)
  }, [])

  const handleSave = () => {
    savePharmacyDefaults(data)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">⚙</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Pharmacy Defaults</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {([
            ["pharmacyName", "Pharmacy Name"],
            ["address", "Address"], ["city", "City"],
            ["postalCode", "Postal Code"], ["phone", "Phone"],
            ["fax", "Fax"], ["pharmacistName", "Pharmacist Name"],
            ["ocpLicense", "OCP License #"],
            ["registrationNumber", "Registration #"]
          ] as const).map(([key, label]) => (
            <div key={key}>
              <Label>{label}</Label>
              <Input value={data[key]} onChange={e => setData({ ...data, [key]: e.target.value })} />
            </div>
          ))}
          <Button onClick={handleSave}>Save Defaults</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Create ailment card component**

Create `cdst-app/src/components/ailment-card.tsx`:

```tsx
import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Ailment } from "@/types"

export function AilmentCard({ ailment }: { ailment: Ailment }) {
  return (
    <Link href={`/assess/${ailment.slug}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardHeader>
          <CardTitle className="text-base">{ailment.name}</CardTitle>
          <CardDescription className="text-xs line-clamp-2">
            {ailment.symptoms.slice(0, 3).join(" · ")}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 4: Create ailment grid**

Create `cdst-app/src/components/ailment-grid.tsx`:

```tsx
import { ailments } from "@/lib/ailments"
import { AilmentCard } from "./ailment-card"

export function AilmentGrid() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {ailments.map(a => <AilmentCard key={a.id} ailment={a} />)}
    </div>
  )
}
```

- [ ] **Step 5: Update home page**

Modify `cdst-app/src/app/page.tsx`:

```tsx
import { AilmentGrid } from "@/components/ailment-grid"
import { PharmacySettings } from "@/components/pharmacy-settings"

export default function Home() {
  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Ontario Minor Ailments</h1>
          <p className="text-sm text-muted-foreground">Clinical Decision Support Tool — O. Reg. 256/24</p>
        </div>
        <PharmacySettings />
      </div>
      <AilmentGrid />
    </main>
  )
}
```

- [ ] **Step 6: Verify home page renders grid**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm run dev
```

Expected: 19 cards in responsive grid, settings gear icon in header.

- [ ] **Step 7: Commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git add -A && git commit -m "feat: home page with ailment grid + pharmacy settings"
```

---

### Task 4: Wizard Container + Step Navigation

**Files:**
- Create: `cdst-app/src/components/wizard/wizard-container.tsx`
- Create: `cdst-app/src/components/wizard/wizard-nav.tsx`
- Create: `cdst-app/src/app/assess/[ailment]/page.tsx`

- [ ] **Step 1: Create wizard nav**

Create `cdst-app/src/components/wizard/wizard-nav.tsx`:

```tsx
import { Button } from "@/components/ui/button"

const STEP_LABELS = ["Patient Info", "Red Flags + Symptoms", "Select Rx", "Generate PDFs"]

export function WizardNav({
  step, onBack, onNext, canNext, isLast
}: {
  step: number; onBack: () => void; onNext: () => void
  canNext: boolean; isLast: boolean
}) {
  return (
    <div>
      <div className="flex gap-2 mb-4">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className={`flex-1 text-center text-xs py-2 rounded ${
            i === step ? "bg-primary text-primary-foreground font-semibold"
            : i < step ? "bg-muted text-muted-foreground" : "bg-muted/50 text-muted-foreground"
          }`}>{label}</div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={step === 0}>Back</Button>
        <Button onClick={onNext} disabled={!canNext}>
          {isLast ? "Generate PDFs" : "Next"}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create wizard container**

Create `cdst-app/src/components/wizard/wizard-container.tsx`:

```tsx
"use client"
import { useState } from "react"
import { Ailment, PatientInfo, SelectedRx, AssessmentData } from "@/types"
import { StepPatient } from "./step-patient"
import { StepRedFlags } from "./step-redflags"
import { StepRx } from "./step-rx"
import { StepGenerate } from "./step-generate"
import { WizardNav } from "./wizard-nav"

const defaultPatient: PatientInfo = {
  name: "", dob: "", ohip: "", address: "", city: "",
  postalCode: "", phone: "", allergies: "NKDA", currentMeds: ""
}

export function WizardContainer({ ailment }: { ailment: Ailment }) {
  const [step, setStep] = useState(0)
  const [patient, setPatient] = useState<PatientInfo>(defaultPatient)
  const [redFlagsChecked, setRedFlagsChecked] = useState<string[]>([])
  const [assessmentNotes, setAssessmentNotes] = useState("")
  const [selectedRx, setSelectedRx] = useState<SelectedRx | null>(null)

  const hasRedFlag = redFlagsChecked.length > 0
  const canNext = step === 0
    ? !!(patient.name && patient.dob)
    : step === 1
    ? true
    : step === 2
    ? !!selectedRx
    : true

  const assessment: AssessmentData = {
    ailment, patient, redFlagsChecked, hasRedFlag,
    assessmentNotes, selectedRx, dateOfAssessment: new Date().toISOString().split("T")[0]
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold">{ailment.name}</h2>
        <p className="text-sm text-muted-foreground">Ontario Minor Ailment — O. Reg. 256/24</p>
      </div>

      {step === 0 && <StepPatient patient={patient} onChange={setPatient} />}
      {step === 1 && <StepRedFlags ailment={ailment} checked={redFlagsChecked} onChange={setRedFlagsChecked} notes={assessmentNotes} onNotesChange={setAssessmentNotes} />}
      {step === 2 && !hasRedFlag && <StepRx ailment={ailment} selected={selectedRx} onChange={setSelectedRx} />}
      {step === 3 && !hasRedFlag && <StepGenerate assessment={assessment} />}

      {step === 1 && hasRedFlag && (
        <div className="mt-4">
          <WizardNav step={step} onBack={() => setStep(step - 1)} onNext={() => {}} canNext={false} isLast={false} />
        </div>
      )}

      {!(step === 1 && hasRedFlag) && (
        <WizardNav
          step={step}
          onBack={() => setStep(Math.max(0, step - 1))}
          onNext={() => { if (step < 3) setStep(step + 1) }}
          canNext={canNext}
          isLast={step === 3}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create assess page**

Create `cdst-app/src/app/assess/[ailment]/page.tsx`:

```tsx
import { getAilmentBySlug } from "@/lib/ailments"
import { WizardContainer } from "@/components/wizard/wizard-container"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { notFound } from "next/navigation"

export default async function AssessPage({ params }: { params: Promise<{ ailment: string }> }) {
  const { ailment: slug } = await params
  const ailment = getAilmentBySlug(slug)
  if (!ailment) notFound()

  return (
    <main className="min-h-screen p-6">
      <Link href="/"><Button variant="ghost" size="sm" className="mb-4">← Back to Ailments</Button></Link>
      <WizardContainer ailment={ailment} />
    </main>
  )
}
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git add -A && git commit -m "feat: wizard container + step nav + assess page"
```

---

### Task 5: Step 1 — Patient Info + Step 2 — Red Flags + Symptoms

**Files:**
- Create: `cdst-app/src/components/wizard/step-patient.tsx`
- Create: `cdst-app/src/components/wizard/step-redflags.tsx`

- [ ] **Step 1: Create patient info step**

Create `cdst-app/src/components/wizard/step-patient.tsx`:

```tsx
"use client"
import { PatientInfo } from "@/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function StepPatient({ patient, onChange }: {
  patient: PatientInfo; onChange: (p: PatientInfo) => void
}) {
  const set = (key: keyof PatientInfo, val: string) => onChange({ ...patient, [key]: val })

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Patient Information</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Full Name *</Label>
          <Input value={patient.name} onChange={e => set("name", e.target.value)} placeholder="Jane Smith" />
        </div>
        <div>
          <Label>Date of Birth *</Label>
          <Input type="date" value={patient.dob} onChange={e => set("dob", e.target.value)} />
        </div>
        <div>
          <Label>OHIP Number</Label>
          <Input value={patient.ohip} onChange={e => set("ohip", e.target.value)} placeholder="1234-567-89" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={patient.phone} onChange={e => set("phone", e.target.value)} placeholder="(555) 123-4567" />
        </div>
        <div className="col-span-2">
          <Label>Address</Label>
          <Input value={patient.address} onChange={e => set("address", e.target.value)} placeholder="123 Main St, Toronto, ON" />
        </div>
        <div>
          <Label>City</Label>
          <Input value={patient.city} onChange={e => set("city", e.target.value)} />
        </div>
        <div>
          <Label>Postal Code</Label>
          <Input value={patient.postalCode} onChange={e => set("postalCode", e.target.value)} />
        </div>
        <div className="col-span-2">
          <Label>Allergies</Label>
          <Input value={patient.allergies} onChange={e => set("allergies", e.target.value)} placeholder="NKDA" />
        </div>
        <div className="col-span-2">
          <Label>Current Medications</Label>
          <Textarea value={patient.currentMeds} onChange={e => set("currentMeds", e.target.value)} placeholder="List current medications" rows={3} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create red flags + symptoms step**

Create `cdst-app/src/components/wizard/step-redflags.tsx`:

```tsx
"use client"
import { Ailment } from "@/types"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

export function StepRedFlags({ ailment, checked, onChange, notes, onNotesChange }: {
  ailment: Ailment; checked: string[]; onChange: (f: string[]) => void
  notes: string; onNotesChange: (n: string) => void
}) {
  const toggle = (flag: string) => {
    onChange(checked.includes(flag) ? checked.filter(f => f !== flag) : [...checked, flag])
  }
  const hasRedFlag = checked.length > 0

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-destructive">Red Flags — Screen for Referral</h3>
        <p className="text-sm text-muted-foreground">Check each red flag present. If ANY is checked, patient must be referred to primary care physician.</p>
        <div className="space-y-2">
          {ailment.redFlags.map(flag => (
            <div key={flag} className="flex items-start gap-3 p-3 rounded border bg-card">
              <Checkbox checked={checked.includes(flag)} onCheckedChange={() => toggle(flag)} />
              <span className="text-sm">{flag}</span>
            </div>
          ))}
        </div>
      </div>

      {hasRedFlag && (
        <Alert variant="destructive">
          <AlertTitle className="font-bold">Cannot Prescribe</AlertTitle>
          <AlertDescription>Red flag(s) detected. Patient must be referred to their primary care physician. This assessment cannot proceed.</AlertDescription>
        </Alert>
      )}

      {!hasRedFlag && (
        <>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Symptoms</h3>
            <div className="flex flex-wrap gap-2">
              {ailment.symptoms.map(s => <Badge key={s} variant="secondary">{s}</Badge>)}
            </div>
          </div>
          <div>
            <Label>Assessment Notes</Label>
            <Textarea value={notes} onChange={e => onNotesChange(e.target.value)} placeholder="Clinical observations..." rows={3} />
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify steps render**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm run dev
```

Navigate to an ailment → Step 1 shows patient form → Step 2 shows red flags checkboxes. Check a red flag → see "Cannot Prescribe" alert.

- [ ] **Step 4: Commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git add -A && git commit -m "feat: patient info step + red flags/symptoms step"
```

---

### Task 6: Step 3 — Select Rx

**Files:**
- Create: `cdst-app/src/components/wizard/step-rx.tsx`

- [ ] **Step 1: Create Rx selection step**

Create `cdst-app/src/components/wizard/step-rx.tsx`:

```tsx
"use client"
import { useState } from "react"
import { Ailment, SelectedRx, RxOption } from "@/types"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

export function StepRx({ ailment, selected, onChange }: {
  ailment: Ailment; selected: SelectedRx | null; onChange: (rx: SelectedRx | null) => void
}) {
  const [editing, setEditing] = useState<Record<string, string>>({})

  const select = (opt: RxOption) => {
    const rx: SelectedRx = {
      ...opt,
      sig: editing.sig || opt.dose,
      quantity: editing.quantity || "",
      refills: editing.refills || "0",
      duration: editing.duration || ""
    }
    onChange(selected?.drug === opt.drug ? null : rx)
  }

  const updateField = (field: string, value: string) => {
    setEditing({ ...editing, [field]: value })
    if (selected) onChange({ ...selected, [field]: value })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Select Prescription</h3>
        <p className="text-sm text-muted-foreground">Choose one medication from the options below.</p>
      </div>

      <div className="space-y-3">
        {ailment.rxOptions.map(opt => (
          <Card
            key={opt.drug}
            className={`cursor-pointer transition-colors ${selected?.drug === opt.drug ? "ring-2 ring-primary" : "hover:bg-accent"}`}
            onClick={() => select(opt)}
          >
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-semibold">{opt.drug}</CardTitle>
              <CardDescription className="text-xs">
                {opt.dose} {opt.notes && `— ${opt.notes}`}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {selected && (
        <div className="space-y-3 border rounded-lg p-4">
          <h4 className="font-semibold text-sm">Prescription Details — {selected.drug}</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Directions (Sig)</Label>
              <Input value={editing.sig ?? selected.sig} onChange={e => updateField("sig", e.target.value)} />
            </div>
            <div>
              <Label>Quantity</Label>
              <Input value={editing.quantity ?? selected.quantity} onChange={e => updateField("quantity", e.target.value)} />
            </div>
            <div>
              <Label>Refills</Label>
              <Input value={editing.refills ?? selected.refills} onChange={e => updateField("refills", e.target.value)} />
            </div>
            <div>
              <Label>Duration</Label>
              <Input value={editing.duration ?? selected.duration} onChange={e => updateField("duration", e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold mb-2">Non-Rx Advice</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          {ailment.nonRx.map(n => <li key={n}>{n}</li>)}
        </ul>
      </div>

      <div>
        <h4 className="text-sm font-semibold mb-2">Follow-up</h4>
        <p className="text-sm text-muted-foreground">{ailment.followUp}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify Rx selection works**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm run dev
```

Navigate through wizard to step 3 → click a drug card → see prescription detail fields → edit fields.

- [ ] **Step 3: Commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git add -A && git commit -m "feat: Rx selection step with editable prescription details"
```

---

### Task 7: Step 4 — PDF Generation

**Files:**
- Create: `cdst-app/src/components/wizard/step-generate.tsx`
- Create: `cdst-app/src/components/prescription-pdf.tsx`
- Create: `cdst-app/src/components/notification-pdf.tsx`
- Create: `cdst-app/src/lib/pdf-helpers.ts`

- [ ] **Step 1: Create PDF download helper**

Create `cdst-app/src/lib/pdf-helpers.ts`:

```ts
import { pdf } from "@react-pdf/renderer"
import { ReactElement } from "react"

export async function downloadPdf(document: ReactElement, filename: string) {
  const blob = await pdf(document).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 2: Create prescription PDF template**

Create `cdst-app/src/components/prescription-pdf.tsx`:

```tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import { AssessmentData } from "@/types"

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  header: { fontSize: 16, textAlign: "center", marginBottom: 20, fontFamily: "Helvetica-Bold" },
  section: { marginBottom: 12 },
  label: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  row: { flexDirection: "row", marginBottom: 2 },
  cell: { flex: 1 },
  table: { borderWidth: 1, borderColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  tableCell: { flex: 1, padding: 4, borderRightWidth: 1, borderColor: "#000" },
  tableHeader: { backgroundColor: "#f0f0f0", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#666", textAlign: "center" }
})

export function PrescriptionPdf({ assessment }: { assessment: AssessmentData }) {
  const { patient, selectedRx, ailment } = assessment
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.header}>PRESCRIPTION</Text>

        <View style={styles.section}>
          <Text style={styles.label}>Minor Ailment Diagnosed</Text>
          <Text>{ailment.name} — O. Reg. 256/24</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Patient Information</Text>
          <View style={styles.row}>
            <View style={styles.cell}><Text>Name: {patient.name}</Text></View>
            <View style={styles.cell}><Text>DOB: {patient.dob}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={styles.cell}><Text>OHIP: {patient.ohip}</Text></View>
            <View style={styles.cell}><Text>Phone: {patient.phone}</Text></View>
          </View>
          <Text>Address: {patient.address}, {patient.city}, {patient.postalCode}</Text>
        </View>

        {selectedRx && (
          <View style={styles.section}>
            <Text style={styles.label}>Prescription Details</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={styles.tableCell}>Drug</Text>
                <Text style={styles.tableCell}>Dose</Text>
                <Text style={styles.tableCell}>Directions</Text>
                <Text style={styles.tableCell}>Quantity</Text>
                <Text style={styles.tableCell}>Refills</Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={styles.tableCell}>{selectedRx.drug}</Text>
                <Text style={styles.tableCell}>{selectedRx.dose}</Text>
                <Text style={styles.tableCell}>{selectedRx.sig}</Text>
                <Text style={styles.tableCell}>{selectedRx.quantity}</Text>
                <Text style={styles.tableCell}>{selectedRx.refills}</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>Allergies</Text>
          <Text>{patient.allergies}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Assessment Notes</Text>
          <Text>{assessment.assessmentNotes || "None"}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Follow-up</Text>
          <Text>{ailment.followUp}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Date of Assessment</Text>
          <Text>{assessment.dateOfAssessment}</Text>
        </View>

        <View style={styles.footer}>
          <Text>Ontario Minor Ailment Prescribing — O. Reg. 256/24 | Generated by CDST</Text>
        </View>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 3: Create doctor notification PDF template**

Create `cdst-app/src/components/notification-pdf.tsx`:

```tsx
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import { AssessmentData } from "@/types"
import { PharmacyDefaults } from "@/types"

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  header: { fontSize: 14, textAlign: "center", marginBottom: 4, fontFamily: "Helvetica-Bold" },
  confidential: { textAlign: "center", fontSize: 8, color: "#999", marginBottom: 20 },
  section: { marginBottom: 12 },
  label: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  row: { flexDirection: "row", marginBottom: 2 },
  cell: { flex: 1 },
  table: { borderWidth: 1, borderColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  tableCell: { flex: 1, padding: 4, borderRightWidth: 1, borderColor: "#000" },
  tableHeader: { backgroundColor: "#f0f0f0", fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#666", textAlign: "center" },
  divider: { borderBottomWidth: 1, borderColor: "#ccc", marginBottom: 12 }
})

export function NotificationPdf({ assessment, pharmacy }: {
  assessment: AssessmentData; pharmacy: PharmacyDefaults | null
}) {
  const { patient, selectedRx, ailment } = assessment
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.header}>CONFIDENTIAL — FAX TRANSMISSION</Text>
        <Text style={styles.confidential}>Minor Ailment Assessment Notification — O. Reg. 256/24</Text>

        {pharmacy && (
          <View style={styles.section}>
            <Text style={styles.label}>From (Pharmacy)</Text>
            <Text>{pharmacy.pharmacyName}</Text>
            <Text>{pharmacy.pharmacistName} — OCP #{pharmacy.ocpLicense}</Text>
            <Text>{pharmacy.address}, {pharmacy.city}, ON {pharmacy.postalCode}</Text>
            <Text>Tel: {pharmacy.phone} | Fax: {pharmacy.fax}</Text>
          </View>
        )}

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.label}>Patient Information</Text>
          <View style={styles.row}>
            <View style={styles.cell}><Text>Name: {patient.name}</Text></View>
            <View style={styles.cell}><Text>DOB: {patient.dob}</Text></View>
          </View>
          <View style={styles.row}>
            <View style={styles.cell}><Text>OHIP: {patient.ohip}</Text></View>
            <View style={styles.cell}><Text>Phone: {patient.phone}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Assessment Details</Text>
          <Text>Minor Ailment: {ailment.name}</Text>
          <Text>Date: {assessment.dateOfAssessment}</Text>
          <Text style={{ marginTop: 4 }}>Red Flags Ruled Out: {assessment.redFlagsChecked.length === 0 ? "None present" : "See notes"}</Text>
          <Text>Assessment Notes: {assessment.assessmentNotes || "None"}</Text>
        </View>

        {selectedRx && (
          <View style={styles.section}>
            <Text style={styles.label}>Medication Prescribed</Text>
            <View style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={styles.tableCell}>Drug</Text>
                <Text style={styles.tableCell}>Dose</Text>
                <Text style={styles.tableCell}>Directions</Text>
                <Text style={styles.tableCell}>Duration</Text>
              </View>
              <View style={styles.tableRow}>
                <Text style={styles.tableCell}>{selectedRx.drug}</Text>
                <Text style={styles.tableCell}>{selectedRx.dose}</Text>
                <Text style={styles.tableCell}>{selectedRx.sig}</Text>
                <Text style={styles.tableCell}>{selectedRx.duration}</Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>Allergies</Text>
          <Text>{patient.allergies}</Text>
          <Text style={{ marginTop: 4 }}>Current Medications: {patient.currentMeds || "None reported"}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Follow-up</Text>
          <Text>{ailment.followUp}</Text>
          <Text style={{ marginTop: 4 }}>Patient instructed to seek medical attention if symptoms worsen or new symptoms develop.</Text>
        </View>

        <View style={styles.section}>
          <Text style={{ fontSize: 8, color: "#666" }}>
            This notification is for informational purposes per O. Reg. 256/24. No action required unless clinical concerns.
            Confidential per PHIPA 2004.
          </Text>
        </View>

        <View style={styles.footer}>
          <Text>Ontario Minor Ailment Notification — O. Reg. 256/24 | Generated by CDST</Text>
        </View>
      </Page>
    </Document>
  )
}
```

- [ ] **Step 4: Create generate step component**

Create `cdst-app/src/components/wizard/step-generate.tsx`:

```tsx
"use client"
import { useState } from "react"
import { AssessmentData } from "@/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getPharmacyDefaults } from "@/lib/pharmacy-storage"
import { downloadPdf } from "@/lib/pdf-helpers"
import { PrescriptionPdf } from "@/components/prescription-pdf"
import { NotificationPdf } from "@/components/notification-pdf"
import dynamic from "next/dynamic"

export function StepGenerate({ assessment }: { assessment: AssessmentData }) {
  const [loading, setLoading] = useState<string | null>(null)
  const pharmacy = getPharmacyDefaults()
  const { patient, selectedRx, ailment } = assessment

  const handleDownload = async (type: "prescription" | "notification") => {
    setLoading(type)
    try {
      if (type === "prescription") {
        await downloadPdf(<PrescriptionPdf assessment={assessment} />, `prescription-${ailment.slug}.pdf`)
      } else {
        await downloadPdf(<NotificationPdf assessment={assessment} pharmacy={pharmacy} />, `notification-${ailment.slug}.pdf`)
      }
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Generate Documents</h3>

      <Card>
        <CardHeader><CardTitle className="text-sm">Assessment Summary</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <p><span className="font-semibold">Patient:</span> {patient.name} (DOB: {patient.dob})</p>
          <p><span className="font-semibold">Ailment:</span> {ailment.name}</p>
          <p><span className="font-semibold">Medication:</span> {selectedRx?.drug} — {selectedRx?.dose}</p>
          <p><span className="font-semibold">Directions:</span> {selectedRx?.sig}</p>
          <p><span className="font-semibold">Date:</span> {assessment.dateOfAssessment}</p>
        </CardContent>
      </Card>

      <div className="flex gap-4">
        <Button onClick={() => handleDownload("prescription")} disabled={!!loading} className="flex-1">
          {loading === "prescription" ? "Generating..." : "Download Prescription PDF"}
        </Button>
        <Button onClick={() => handleDownload("notification")} disabled={!!loading} variant="outline" className="flex-1">
          {loading === "notification" ? "Generating..." : "Download Doctor Notification PDF"}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify PDF generation**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm run dev
```

Complete wizard → step 4 → click "Download Prescription PDF" → PDF downloads with patient info, Rx details, ailment name.

- [ ] **Step 6: Commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git add -A && git commit -m "feat: PDF generation for prescription + doctor notification"
```

---

### Task 8: Build Verification + Polish

**Files:**
- Modify: various files for any fixes

- [ ] **Step 1: Run build**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Fix any build errors, re-run until clean**

- [ ] **Step 3: Full E2E walkthrough — test every step**

1. Open home page → 19 cards render
2. Click ailment → wizard opens
3. Step 1: Fill patient info, verify name + DOB required
4. Step 2: Check red flag → verify "Cannot Prescribe" blocks proceeding
5. Step 2: Uncheck all red flags → verify symptoms shown, proceed
6. Step 3: Click drug card → verify editable fields, proceed
7. Step 4: Download both PDFs → verify content
8. Test pharmacy settings → save defaults → verify pre-fill in PDFs

- [ ] **Step 4: Final commit**

```bash
cd "/Users/shannonchowdhury/Desktop/Minor Ailments/CDST/cdst-app"
git add -A && git commit -m "feat: build verification + polish"
```
