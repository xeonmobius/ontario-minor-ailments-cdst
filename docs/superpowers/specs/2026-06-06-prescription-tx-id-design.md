# Prescription Transaction IDs

## Goal

Add a unique, sequential tx ID to every prescription PDF generated. The tx ID is stored in Supabase alongside minimal non-PHI metadata for audit and cross-reference purposes.

## PHI Analysis

A standalone tx ID is **not PHI**. We store only:

| Column | PHI? |
|--------|------|
| tx_id (formatted) | No |
| pharmacy_id | No |
| pharmacist_id | No |
| created_at | No |

No patient info, drug names, ailment names, or clinical data stored.

### Adversarial Review Summary

Full adversarial review conducted 2026-06-06. Key findings addressed:

- **PDF filename**: Changed from patient-name-based to tx-id-based (was PHI)
- **RLS**: Explicit SQL provided with platform_admin decision documented
- **Concurrency**: Advisory lock prevents race conditions on seq generation
- **Retention**: 10-year minimum per Ontario pharmacy regulations

### Residual risks (documented, acceptable)

- Sequential numbers reveal prescribing volume (business data, not PHI)
- `pharmacist_id` + `created_at` is a quasi-identifier in low-volume pharmacies — mitigated by same-pharmacy-only RLS
- Full table breach exposes business analytics, not patient data

## Data Model

### Table: `prescription_tx`

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| pharmacy_id | uuid | FK → pharmacies.id, NOT NULL |
| pharmacist_id | uuid | FK → profiles.id, NOT NULL |
| year | int | NOT NULL |
| seq | int | NOT NULL |
| tx_id | text | UNIQUE, NOT NULL — formatted as `TX-{YYYY}-{NNNNNN}` |
| created_at | timestamptz | NOT NULL, default now() |

Unique constraint on `(pharmacy_id, year, seq)` to prevent duplicates.

### Sequence generation

A Postgres function with advisory lock to prevent race conditions:

```sql
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
  -- Advisory lock prevents concurrent seq assignment for same pharmacy
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
```

The `pg_advisory_xact_lock` ensures that if two pharmacists click "Download" simultaneously, each gets a unique seq. The `SECURITY DEFINER` function bypasses RLS for the INSERT while still enforcing auth at the server action level.

Format: `TX-2026-000001` (6-digit zero-padded). Max 999,999 per pharmacy per year.

## Flow

1. User clicks "Download Prescription" in `step-generate.tsx`
2. Client calls server action `reserveTxId()`
3. Server action:
   - Verifies authenticated user via `requireAuth()`
   - Calls `next_prescription_tx(pharmacy_id, pharmacist_id)`
   - Returns formatted `tx_id` string
4. Client passes `tx_id` into `<CombinedPdf>` as a new prop
5. PDF renders tx ID in header (top-right, below CONFIDENTIAL badge)
6. PDF downloads with tx-id-based filename: `prescription-2026-06-06-TX-2026-000001.pdf`

## PDF Changes

- New prop `txId?: string` on `CombinedPdf`
- Rendered as `Tx: TX-2026-000001` in small text below the date, top-right corner
- **Filename changed to `prescription-{date}-{txId}.pdf`** — removes patient name from filename (was PHI leakage via browser downloads, file system, print spooler)

## API Surface

- **Server action:** `reserveTxId()` in a new `src/lib/prescription-actions.ts`
  - No inputs needed (reads pharmacy_id + pharmacist_id from profile)
  - Returns `{ txId: string }` or `{ error: string }`
  - Must NOT log pharmacist_id, pharmacy_id, or tx_id

## RLS

Explicit policies:

```sql
-- INSERT: owner or pharmacist at the pharmacy
CREATE POLICY prescribers_insert ON prescription_tx
  FOR INSERT TO authenticated
  WITH CHECK (
    pharmacist_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('owner', 'pharmacist')
    )
  );

-- SELECT: members of same pharmacy only (owner + pharmacist)
-- pharmacist_id visible to same-pharmacy members (needed for audit)
-- owner can see all pharmacists' tx; pharmacists see all (same pharmacy)
CREATE POLICY pharmacy_read_own_tx ON prescription_tx
  FOR SELECT TO authenticated
  USING (
    pharmacy_id = public.get_user_pharmacy_id()
  );

-- No platform_admin access to prescription_tx.
-- If needed later, create a separate audit role with explicit justification.
-- No UPDATE or DELETE.
```

## Data Retention

- **Minimum 10 years** from `created_at`, per Ontario Pharmacy Act regulation (O. Reg. 256/24 prescribing records)
- No automated deletion — rows persist indefinitely until a retention policy is implemented
- Future: add a batch archive function that soft-deletes rows older than 10 years

## Files Changed

- `src/components/combined-pdf.tsx` — add `txId` prop, render in header
- `src/components/wizard/step-generate.tsx` — call `reserveTxId()` before PDF generation, change filename
- `src/lib/prescription-actions.ts` — new file, `reserveTxId()` server action
- Database migration — create `prescription_tx` table + `next_prescription_tx` function + RLS
