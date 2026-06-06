# Prescription Transaction IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unique sequential tx IDs to prescription PDFs, stored in Supabase with non-PHI metadata only.

**Architecture:** New `prescription_tx` table with a SECURITY DEFINER function that atomically assigns the next sequence number per pharmacy per year using advisory locks. Server action `reserveTxId()` calls this function before PDF generation. Tx ID rendered on the PDF and used in the filename.

**Tech Stack:** Supabase (Postgres), Next.js server actions, @react-pdf/renderer

---

### Task 1: Create `prescription_tx` table + function + RLS

**Files:**
- Database migration via Supabase MCP

- [ ] **Step 1: Apply migration**

```
Name: create_prescription_tx_table
```

```sql
CREATE TABLE public.prescription_tx (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  pharmacist_id uuid NOT NULL REFERENCES public.profiles(id),
  year int NOT NULL,
  seq int NOT NULL,
  tx_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX prescription_tx_pharmacy_year_seq ON public.prescription_tx (pharmacy_id, year, seq);

CREATE OR REPLACE FUNCTION public.next_prescription_tx(p_pharmacy_id uuid, p_pharmacist_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  v_year int := EXTRACT(YEAR FROM now());
  v_seq int;
  v_tx_id text;
  v_lock_key bigint := ('prescription_tx:' || p_pharmacy_id)::bigint;
begin
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
  FROM prescription_tx
  WHERE pharmacy_id = p_pharmacy_id AND year = v_year;

  v_tx_id := 'TX-' || v_year || '-' || LPAD(v_seq::text, 6, '0');

  INSERT INTO prescription_tx (pharmacy_id, pharmacist_id, year, seq, tx_id)
  VALUES (p_pharmacy_id, p_pharmacist_id, v_year, v_seq, v_tx_id);

  RETURN v_tx_id;
end;
$$;

-- RLS
ALTER TABLE public.prescription_tx ENABLE ROW LEVEL SECURITY;

CREATE POLICY prescribers_insert ON public.prescription_tx
  FOR INSERT TO authenticated
  WITH CHECK (
    pharmacist_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner', 'pharmacist')
    )
  );

CREATE POLICY pharmacy_read_own_tx ON public.prescription_tx
  FOR SELECT TO authenticated
  USING (
    pharmacy_id = public.get_user_pharmacy_id()
  );
```

- [ ] **Step 2: Verify table exists**

Run via Supabase MCP `execute_sql`:
```sql
SELECT count(*) FROM prescription_tx;
```
Expected: `0`

- [ ] **Step 3: Commit**

No app code changed — migration is applied directly to Supabase.

---

### Task 2: Create `reserveTxId` server action

**Files:**
- Create: `src/lib/prescription-actions.ts`

- [ ] **Step 1: Create the server action**

```typescript
// src/lib/prescription-actions.ts
"use server"

import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/auth-guards"

export async function reserveTxId() {
  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    return { error: "No pharmacy associated with this account." }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc("next_prescription_tx", {
    p_pharmacy_id: profile.pharmacyId,
    p_pharmacist_id: profile.id,
  })

  if (error || !data) {
    return { error: error?.message ?? "Failed to reserve tx ID." }
  }

  return { txId: data as string }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd cdst-app && rtk tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/prescription-actions.ts
git commit -m "feat: add reserveTxId server action for prescription tx IDs"
```

---

### Task 3: Add `txId` prop to `CombinedPdf`

**Files:**
- Modify: `src/components/combined-pdf.tsx`

- [ ] **Step 1: Add txId to props interface**

In `src/components/combined-pdf.tsx`, update the `CombinedPdfProps` interface to add:

```typescript
txId?: string
```

Add it after the `nonRxChecked` prop in the interface and destructure it in the function params.

- [ ] **Step 2: Render tx ID in the PDF header**

In the `<View style={{ alignItems: "flex-end" }}>` block (around line 179), after the `<Text style={styles.dateText}>` line, add:

```tsx
{txId && <Text style={styles.dateText}>Tx: {txId}</Text>}
```

The `dateText` style already exists and is the right size/color for this.

- [ ] **Step 3: Typecheck**

Run: `cd cdst-app && rtk tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/combined-pdf.tsx
git commit -m "feat: render tx ID on prescription PDF"
```

---

### Task 4: Update `step-generate.tsx` to reserve tx ID and change filename

**Files:**
- Modify: `src/components/wizard/step-generate.tsx`

- [ ] **Step 1: Update `handleDownload` to call `reserveTxId`**

Replace the `handleDownload` function with:

```typescript
import { useState } from "react"
import { reserveTxId } from "@/lib/prescription-actions"

// inside component:
const [txId, setTxId] = useState<string | null>(null)

async function handleDownload() {
  if (!txId) {
    const result = await reserveTxId()
    if (result.error) return
    setTxId(result.txId ?? null)
  }
  const doc = <CombinedPdf
    ailment={ailment}
    patient={patient}
    selectedRx={selectedRx}
    assessmentNotes={assessmentNotes}
    dateOfAssessment={dateOfAssessment}
    pharmacy={pharmacy ?? null}
    symptomsChecked={symptomsChecked}
    nonRxChecked={nonRxChecked}
    txId={txId ?? undefined}
  />
  await downloadPdf(doc, `prescription-${dateOfAssessment}-${txId ?? "draft"}.pdf`)
}
```

Add `useState` import (replace the existing `useState` import if missing — currently no state in this component).

Add `reserveTxId` import at the top.

- [ ] **Step 2: Typecheck**

Run: `cd cdst-app && rtk tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/step-generate.tsx
git commit -m "feat: reserve tx ID before PDF download, use in filename"
```

---

### Task 5: End-to-end smoke test

- [ ] **Step 1: Log in and navigate to an ailment assessment**

Go to `/login`, sign in, select an ailment, fill in patient info, select an Rx, proceed to generate step.

- [ ] **Step 2: Click "Download Prescription + Doctor Notification PDF"**

Expected:
1. PDF downloads with filename like `prescription-2026-06-06-TX-2026-000001.pdf`
2. PDF shows `Tx: TX-2026-000001` in the top-right header area
3. Clicking download again uses the same tx ID (not burned a new one)

- [ ] **Step 3: Verify database record**

Run via Supabase MCP:
```sql
SELECT tx_id, pharmacy_id, pharmacist_id, year, seq, created_at FROM prescription_tx ORDER BY created_at DESC LIMIT 5;
```
Expected: One row with the tx_id shown on the PDF.

- [ ] **Step 4: Push**

```bash
git push
```
