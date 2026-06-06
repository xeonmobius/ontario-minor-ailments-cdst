# Ontario Minor Ailments CDST — Design Spec

**Date:** 2026-05-18
**Status:** Approved

## Overview

Next.js static web app for Ontario pharmacists to prescribe for 19 minor ailments per O. Reg. 256/24. No login. Guided wizard workflow with PDF generation for prescription and doctor notification.

## Tech Stack

- Next.js 14+ (App Router)
- shadcn/ui — all UI components exclusively
- Tailwind CSS (via shadcn)
- @react-pdf/renderer — client-side PDF generation
- localStorage — pharmacy default persistence
- No backend, no auth, no database

## Data Layer

19 markdown files in `Ontario-Minor-Ailments-Cards/` parsed at build time into static JSON. Each ailment:

```ts
interface Ailment {
  id: string
  name: string
  slug: string
  symptoms: string[]
  redFlags: string[]
  rxOptions: { drug: string; dose: string; notes: string }[]
  nonRx: string[]
  followUp: string
}
```

Dermatitis (#06) has sub-conditions handled as nested structure. Prescription and doctor notification templates stored as JSON schemas matching the `.md` template fields.

## Pages & Routing

| Route | Purpose |
|-------|---------|
| `/` | Ailment selection — card grid with all 19 ailments |
| `/assess/[ailment]` | 4-step wizard |

## Wizard Flow

### Step 1 — Patient Info

- shadcn Input fields: name, DOB, address, phone, OHIP number
- Allergies field (default "NKDA")
- Current medications textarea
- Assessment notes textarea
- Validation: name + DOB required

### Step 2 — Red Flags + Symptoms

- Red flag checklist (shadcn Checkbox) — top section
- If ANY red flag checked: red alert banner, "Cannot prescribe — refer to PCP", wizard blocked, cannot proceed
- Symptoms list displayed below for reference (read-only)
- Pharmacist assessment notes textarea

### Step 3 — Select Rx

- Rx options displayed as selectable cards/table from ailment data
- Each shows: drug name, dose, notes
- Pharmacist selects one drug
- Editable fields pre-filled: dose, directions (sig), quantity, refills, duration
- Non-Rx advice section shown below for reference

### Step 4 — Generate PDFs

- Summary preview of all entered data
- Two download buttons: "Prescription PDF" + "Doctor Notification PDF"
- PDFs generated client-side using @react-pdf/renderer matching template formats
- Prescription PDF includes: pharmacy info, patient info, prescriber info, Rx details, clinical assessment, follow-up plan, patient instructions, allergy info
- Doctor Notification PDF includes: fax header, pharmacy/prescriber info, physician info, patient info, assessment details, medication prescribed, follow-up plan, confidentiality notice

## Pharmacy Defaults

- Settings gear icon on home page
- shadcn Dialog: pharmacy name, address, city, postal code, phone, fax, pharmacist name, OCP license number, pharmacy registration number
- Saved to localStorage, pre-fills into PDFs

## Ailment Selection Grid

- 19 cards in responsive grid layout
- Each card shows: ailment name, brief description/icon
- Click navigates to `/assess/[slug]`

## Non-Goals

- No user authentication
- No server-side data persistence
- No multi-user support
- No audit trail beyond generated PDFs
