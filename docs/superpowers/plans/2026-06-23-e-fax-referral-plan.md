# e-Fax Referral + Prescriber Notification — Implementation Plan

**Date:** 2026-06-23
**Roadmap item:** #1 (NOW tier)
**Companion design:** `docs/superpowers/specs/2026-06-23-e-fax-referral-design.md`

> **For agentic workers:** Implement task-by-task. Each step is a small, independently verifiable unit. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the hard constraints in the design doc: PHI (destination number, document bytes) never lands in Supabase; only non-PHI `fax.sent` audit metadata does. Do not enable the feature in production until the provider BAA is signed (`FAX_ENABLED` stays false).

**Goal:** Let a pharmacist send the already-generated prescription or referral PDF to the patient's family physician with one click, directly from the assessment wizard, with an audit trail and a (fly.io, BAA-gated) delivery record.

**Approach (from the design):** Option A — the client builds the PDF Blob exactly as it does today for downloads, POSTs it to `POST /api/fax/send`, which forwards it to the fax provider (Phaxio by default), records a non-PHI `fax.sent` audit event in Supabase, and writes a PHI `fax_delivery` row on fly.io (stubbed until fly.io is provisioned by roadmap #2).

**Tech stack:** Next.js 16.2.6 route handlers, React 19, `@react-pdf/renderer ^4.5.1` (client Blob, unchanged), Supabase (audit), Phaxio v2.1 REST, Vitest + React Testing Library.

---

### Task 1: Add `fax.sent` audit event (non-PHI)

**Files:**
- Modify: `src/lib/audit-actions.ts`
- Database (Supabase migration via MCP): `audit.event_type` enum, `log_event` validation

- [ ] **Step 1: Extend the `EventType` union**

In `src/lib/audit-actions.ts`, add `"fax.sent"` to the `EventType` union (currently `audit-actions.ts:5-18`).

```ts
type EventType =
  | "auth.login"
  | "auth.logout"
  // ... existing ...
  | "pdf.generated"
  | "export.requested"
  | "fax.sent"
```

- [ ] **Step 2: Apply Supabase migration `add_fax_sent_audit_event`**

```sql
ALTER TYPE audit.event_type ADD VALUE IF NOT EXISTS 'fax.sent';

CREATE OR REPLACE FUNCTION audit.log_event(
  p_event_type audit.event_type,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_actor_id uuid;
  v_pharmacy_id uuid;
  v_result uuid;
begin
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT pharmacy_id INTO v_pharmacy_id
  FROM public.profiles WHERE id = v_actor_id;

  IF length(p_metadata::text) > 1024 THEN
    RAISE EXCEPTION 'Metadata exceeds 1KB limit';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_metadata)
    WHERE jsonb_typeof(value) IN ('object', 'array')
  ) THEN
    RAISE EXCEPTION 'Metadata must be flat key-value pairs only';
  END IF;

  -- Existing per-event required-key checks (rx_tx_reserved, pharmacy.updated, export.requested)...

  -- fax.sent: require correlation_id + status + provider; forbid destination/patient keys
  IF p_event_type = 'fax.sent' THEN
    IF (p_metadata->>'correlation_id') IS NULL
       OR (p_metadata->>'status') IS NULL
       OR (p_metadata->>'provider') IS NULL THEN
      RAISE EXCEPTION 'fax.sent requires correlation_id, status, provider';
    END IF;
    -- Defense-in-depth: reject any key that could carry PHI
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_metadata) k
      WHERE k LIKE 'to_%' OR k LIKE 'patient_%' OR k IN ('to_number','destination','fax_number')
    ) THEN
      RAISE EXCEPTION 'fax.sent metadata must not contain destination/patient data';
    END IF;
  END IF;

  INSERT INTO audit.log (event_type, actor_id, pharmacy_id, resource_type, resource_id, metadata)
  VALUES (p_event_type, v_actor_id, v_pharmacy_id, p_resource_type, p_resource_id, p_metadata)
  RETURNING id INTO v_result;

  RETURN v_result;
end;
$$;
```

> Note: re-declare the function with the full prior body (see `docs/superpowers/specs/2026-06-06-audit-log-design.md` for the canonical source) plus the new `fax.sent` branch. Preserve the existing `rx_tx_reserved` / `pharmacy.updated` / `export.requested` required-key checks.

- [ ] **Step 3: Verify**

```sql
SELECT enumlabel FROM pg_enum WHERE enumtypid = 'audit.event_type'::regtype AND enumlabel = 'fax.sent';
```
Expected: one row.

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit-actions.ts
git commit -m "feat(audit): add fax.sent event type (non-PHI)"
```
(Migration is applied directly to Supabase; no app file for it.)

---

### Task 2: Fax provider abstraction + Phaxio implementation

**Files:**
- Create: `src/lib/fax/provider.ts`
- Create: `src/lib/fax/phaxio.ts`
- Create: `src/lib/fax/documo.ts`
- Create: `src/lib/fax/index.ts`

- [ ] **Step 1: Define the provider interface**

`src/lib/fax/provider.ts`:

```ts
export interface FaxSendInput {
  toNumber: string   // E.164, e.g. "+15195551234"
  pdf: Blob          // the document bytes
  callerId: string   // pharmacy fax (sender CSID)
}
export interface FaxSendResult {
  providerFaxId: string
  status: "queued"
}
export interface FaxProvider {
  name: "phaxio" | "documo"
  send(input: FaxSendInput): Promise<FaxSendResult>
  verifyWebhookSignature(header: string, body: string): boolean
}
```

- [ ] **Step 2: Implement Phaxio**

`src/lib/fax/phaxio.ts`:

```ts
import { FaxProvider, FaxSendInput, FaxSendResult } from "./provider"

export const phaxio: FaxProvider = {
  name: "phaxio",
  async send({ toNumber, pdf, callerId }: FaxSendInput): Promise<FaxSendResult> {
    const form = new FormData()
    form.append("to", toNumber)
    form.append("file", pdf, "document.pdf")
    form.append("caller_id", callerId)

    const res = await fetch("https://api.phaxio.com/v2.1/faxes", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(
          `${process.env.PHAXIO_API_KEY}:${process.env.PHAXIO_API_SECRET}`
        ).toString("base64"),
      },
      body: form,
    })
    if (!res.ok) {
      throw new Error(`Phaxio send failed: ${res.status}`)
    }
    const json = (await res.json()) as { data: { id: string } }
    return { providerFaxId: String(json.data.id), status: "queued" }
  },
  verifyWebhookSignature(header: string, body: string): boolean {
    const crypto = require("crypto")
    const expected = crypto
      .createHmac("sha256", process.env.FAX_WEBHOOK_SECRET!)
      .update(body)
      .digest("hex")
    // Phaxio sends signature in the Phaxio-Signature header
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header))
    } catch {
      return false
    }
  },
}
```

- [ ] **Step 3: Documo stub + selector**

`src/lib/fax/documo.ts` — implement only if Documo is chosen; otherwise a stub that throws `new Error("Documo provider not configured")` so the interface is satisfied and the swap is one file.

`src/lib/fax/index.ts`:

```ts
import { FaxProvider } from "./provider"
import { phaxio } from "./phaxio"
import { documo } from "./documo"

export function getFaxProvider(): FaxProvider {
  switch (process.env.FAX_PROVIDER ?? "phaxio") {
    case "documo": return documo
    case "phaxio":
    default: return phaxio
  }
}
export { type FaxSendInput, type FaxSendResult } from "./provider"
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fax
git commit -m "feat(fax): add provider abstraction + Phaxio implementation"
```

---

### Task 3: `POST /api/fax/send` route handler

**Files:**
- Create: `src/app/api/fax/send/route.ts`

- [ ] **Step 1: Implement the route handler**

```ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/auth-guards"
import { getFaxProvider } from "@/lib/fax"
import { logAuditEvent } from "@/lib/audit-actions"
import { isFaxAllowedForPharmacy } from "@/lib/fax-rate-limit"

export async function POST(request: Request) {
  if (process.env.FAX_ENABLED !== "true") {
    return NextResponse.json({ error: "Fax is not enabled." }, { status: 503 })
  }
  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    return NextResponse.json({ error: "No pharmacy associated." }, { status: 400 })
  }

  const form = await request.formData()
  const file = form.get("file")
  const toNumber = String(form.get("toNumber") ?? "")
  const documentType = String(form.get("documentType") ?? "")
  const correlationId = String(form.get("correlationId") ?? "")
  const txId = form.get("txId") ? String(form.get("txId")) : undefined

  if (!(file instanceof Blob) || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Invalid PDF." }, { status: 400 })
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "PDF too large." }, { status: 413 })
  }
  if (!/^\+1\d{10}$/.test(toNumber)) {
    return NextResponse.json({ error: "Invalid destination fax number." }, { status: 400 })
  }
  if (!correlationId || !["prescription", "referral"].includes(documentType)) {
    return NextResponse.json({ error: "Missing metadata." }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: pharmacy } = await supabase
    .from("pharmacies")
    .select("fax")
    .eq("id", profile.pharmacyId)
    .single()
  const callerId = pharmacy?.fax ?? ""
  if (!callerId) {
    return NextResponse.json({ error: "Pharmacy has no sender fax configured." }, { status: 400 })
  }

  const { allowed } = await isFaxAllowedForPharmacy(profile.pharmacyId, supabase)
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again later." }, { status: 429 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const crypto = require("crypto")
  const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex")

  const provider = getFaxProvider()
  let providerFaxId: string
  try {
    const result = await provider.send({ toNumber, pdf: file, callerId })
    providerFaxId = result.providerFaxId
  } catch (err) {
    return NextResponse.json({ error: "Fax provider error." }, { status: 502 })
  }

  // Non-PHI audit (no destination, no patient data)
  await logAuditEvent("fax.sent", {
    correlation_id: correlationId,
    status: "queued",
    provider: provider.name,
    document_type: documentType,
    ...(txId ? { tx_id: txId } : {}),
  })

  // PHI delivery record — fly.io only. Stubbed until fly.io is provisioned (roadmap #2).
  // await writeFaxDelivery({ ... })  // see Task 7

  return NextResponse.json({ ok: true, providerFaxId, correlationId })
}
```

- [ ] **Step 2: Add the rate-limit helper**

Create `src/lib/fax-rate-limit.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

const WINDOW_MINUTES = 60
const MAX_PER_WINDOW = 20

export async function isFaxAllowedForPharmacy(
  pharmacyId: string,
  supabase: SupabaseClient,
): Promise<{ allowed: boolean }> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const { count } = await supabase
    .from("audit_log_fax_counts")   // a non-PHI per-pharmacy counter view/table
    .select("*", { count: "exact", head: true })
    .eq("pharmacy_id", pharmacyId)
    .gte("created_at", since)
  return { allowed: (count ?? 0) < MAX_PER_WINDOW }
}
```

> Note: the simplest non-PHI counter is a dedicated lightweight table `fax_send_attempts(pharmacy_id, created_at)` in the `public` schema (no PHI). Alternatively, count recent `fax.sent` audit rows for the pharmacy via the audit read path. Pick one and document it; the table approach avoids coupling the rate limit to the tamper-evident log.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/fax/send/route.ts src/lib/fax-rate-limit.ts
git commit -m "feat(fax): add POST /api/fax/send route + rate limiting"
```

---

### Task 4: `POST /api/fax/webhook` route handler

**Files:**
- Create: `src/app/api/fax/webhook/route.ts`

- [ ] **Step 1: Implement the webhook receiver**

```ts
import { NextResponse } from "next/server"
import { getFaxProvider } from "@/lib/fax"

export async function POST(request: Request) {
  if (process.env.FAX_ENABLED !== "true") {
    return new NextResponse(null, { status: 404 })
  }
  const body = await request.text()
  const signature = request.headers.get("Phaxio-Signature") ?? ""
  const provider = getFaxProvider()
  if (!provider.verifyWebhookSignature(signature, body)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 })
  }

  const event = JSON.parse(body) as {
    id: string            // provider fax id
    status: string        // "queued" | "sent" | "success" | "failure"
    completed_at?: number
    error_type?: string
  }

  // PHI delivery-status update — fly.io only. Stubbed until fly.io is provisioned (roadmap #2).
  // await updateFaxDelivery({ providerFaxId: event.id, status: mapStatus(event.status), ... })

  return NextResponse.json({ ok: true })
}

function mapStatus(s: string): "queued" | "sending" | "success" | "failed" {
  if (s === "success") return "success"
  if (s === "failure") return "failed"
  if (s === "sent") return "sending"
  return "queued"
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/fax/webhook/route.ts
git commit -m "feat(fax): add webhook receiver with HMAC verification"
```

---

### Task 5: Client helper + Fax button in the prescription step

**Files:**
- Create: `src/lib/fax-client.ts`
- Modify: `src/components/wizard/step-generate.tsx`

- [ ] **Step 1: Create the client helper**

`src/lib/fax-client.ts`:

```ts
export async function sendFax(args: {
  blob: Blob
  toNumber: string
  documentType: "prescription" | "referral"
  correlationId: string
  txId?: string
}): Promise<{ ok: true; providerFaxId: string } | { ok: false; error: string }> {
  const form = new FormData()
  form.append("file", args.blob, "document.pdf")
  form.append("toNumber", args.toNumber)
  form.append("documentType", args.documentType)
  form.append("correlationId", args.correlationId)
  if (args.txId) form.append("txId", args.txId)
  try {
    const res = await fetch("/api/fax/send", { method: "POST", body: form })
    const json = (await res.json()) as { ok?: true; providerFaxId?: string; error?: string }
    if (res.ok && json.ok) return { ok: true, providerFaxId: json.providerFaxId! }
    return { ok: false, error: json.error ?? "Fax failed." }
  } catch {
    return { ok: false, error: "Network error." }
  }
}
```

- [ ] **Step 2: Add the Fax button to `step-generate.tsx`**

In `src/components/wizard/step-generate.tsx`, beside the Download button (`step-generate.tsx:74-81`), add a Fax button. It builds the same `<CombinedPdf .../>` element (already constructed at `step-generate.tsx:35-45`), renders it to a Blob with `pdf(doc).toBlob()` (the same primitive as `pdf-helpers.ts:5`), and calls `sendFax` with `documentType: "prescription"`, `correlationId` derived from the already-resolved `txId`, and `toNumber: patient.doctorFax`. Add local `useState` for `faxStatus` ("idle" | "sending" | "sent" | "error"). Disable the button while `faxStatus === "sending"` and when `!patient.doctorFax`. Show helper text "Add the physician's fax number on the Patient step to enable e-fax" when the destination is missing.

Add imports:

```ts
import { pdf } from "@react-pdf/renderer"
import { sendFax } from "@/lib/fax-client"
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/fax-client.ts src/components/wizard/step-generate.tsx
git commit -m "feat(fax): add Fax button to prescription generate step"
```

---

### Task 6: Fax button in the referral branch

**Files:**
- Modify: `src/components/wizard/wizard-container.tsx`

- [ ] **Step 1: Add the Fax button to the referral summary**

In the referral branch of `src/components/wizard/wizard-container.tsx` (`wizard-container.tsx:142-172`), beside the existing "Download Referral PDF" button (`wizard-container.tsx:167`), add a "Fax referral" button. Reuse the `<ReferralPdf .../>` element already built in `handleDownloadReferral` (`wizard-container.tsx:89-99`): refactor that handler so the element construction is shared, render it to a Blob with `pdf(doc).toBlob()`, and call `sendFax` with `documentType: "referral"`, a freshly generated `correlationId` (`crypto.randomUUID()`), and `toNumber: patient.doctorFax`. Add `faxStatus` state mirrored from Task 5; disable when `!patient.doctorFax`.

Add imports:

```ts
import { pdf } from "@react-pdf/renderer"
import { sendFax } from "@/lib/fax-client"
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/wizard/wizard-container.tsx
git commit -m "feat(fax): add Fax button to referral branch"
```

---

### Task 7: fly.io `fax_delivery` delivery record (schema + stubbed write)

> **Dependency:** This task's live write depends on roadmap #2 (fly.io Postgres provisioned under BAA). Define the schema and the write path now; leave the write stubbed behind a feature check so the feature can ship in Phase 1 and light up automatically once fly.io exists.

**Files:**
- Create: `src/lib/fax/delivery-store.ts` (stubbed)
- Database (fly.io, when provisioned): `fax_delivery` table

- [ ] **Step 1: Define the migration (apply when fly.io is provisioned)**

```sql
CREATE TABLE fax_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL,
  pharmacist_id uuid NOT NULL,
  tx_id text NULL,
  correlation_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('prescription','referral')),
  to_number text NOT NULL,
  from_number text,
  provider text NOT NULL,
  provider_fax_id text,
  direction text NOT NULL DEFAULT 'outbound',
  status text NOT NULL CHECK (status IN ('queued','sending','success','failed')),
  content_sha256 text NOT NULL,
  page_count int,
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fax_delivery_pharmacy_sent ON fax_delivery (pharmacy_id, sent_at DESC);
CREATE INDEX fax_delivery_provider_lookup ON fax_delivery (provider, provider_fax_id);
CREATE INDEX fax_delivery_correlation ON fax_delivery (correlation_id);
```

(App-layer RLS equivalent: scope every read/write by `pharmacy_id` from the verified Supabase JWT, per roadmap §6.2.)

- [ ] **Step 2: Create the stubbed delivery store**

`src/lib/fax/delivery-store.ts`:

```ts
export interface FaxDeliveryInput {
  pharmacyId: string
  pharmacistId: string
  txId?: string
  correlationId: string
  documentType: "prescription" | "referral"
  toNumber: string
  fromNumber: string
  provider: string
  providerFaxId: string
  contentSha256: string
}

export async function writeFaxDelivery(_input: FaxDeliveryInput): Promise<void> {
  if (process.env.FLY_PHI_STORE_URL !== "true") return // no-op until fly.io is provisioned
  // TODO(roadmap #2): INSERT INTO fax_delivery ... on fly.io Postgres (BAA)
}

export async function updateFaxDeliveryByProviderId(
  _providerFaxId: string,
  _status: "queued" | "sending" | "success" | "failed",
  _error?: string,
): Promise<void> {
  if (process.env.FLY_PHI_STORE_URL !== "true") return
  // TODO(roadmap #2): upsert status/delivered_at on fly.io
}
```

- [ ] **Step 3: Wire the calls**

In `src/app/api/fax/send/route.ts`, after the audit event, call `writeFaxDelivery({ ... })` (replace the Task-3 stub comment). In `src/app/api/fax/webhook/route.ts`, call `updateFaxDeliveryByProviderId(event.id, mapStatus(event.status), event.error_type)` (replace the Task-4 stub comment).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit --pretty`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fax/delivery-store.ts src/app/api/fax/send/route.ts src/app/api/fax/webhook/route.ts
git commit -m "feat(fax): add fax_delivery schema + stubbed delivery-store write"
```

---

### Task 8: Tests

**Files:**
- Create: `src/__tests__/fax-client.test.ts`
- Modify: `src/__tests__/audit-actions.test.ts` (if it exists and covers the union) — otherwise add `src/__tests__/fax-route.test.ts`

- [ ] **Step 1: Unit-test the client helper**

`src/__tests__/fax-client.test.ts` — mock `global.fetch`, assert it posts multipart with the right fields and returns `{ ok, providerFaxId }` on 200 and `{ ok:false, error }` on non-2xx. Assert it never serializes the destination into a URL or query string.

- [ ] **Step 2: Unit-test destination validation**

`src/__tests__/fax-route.test.ts` — exercise the `/api/fax/send` validation branches with a mocked auth + provider: rejects non-E.164 `toNumber` (400), non-PDF file (400), oversized file (413), missing pharmacy fax (400), and rate-limit excess (429). Mock the provider `send` so no network call occurs.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__
git commit -m "test(fax): cover client helper + send-route validation"
```

---

### Task 9: End-to-end verification (staging/provider sandbox)

- [ ] **Step 1: Configure sandbox env**

Set `FAX_ENABLED=true`, `FAX_PROVIDER=phaxio`, sandbox `PHAXIO_API_KEY`/`PHAXIO_API_SECRET`, `FAX_WEBHOOK_SECRET`. Register the staging `/api/fax/webhook` URL in the Phaxio dashboard.

- [ ] **Step 2: Prescription fax**

Log in, open an ailment assessment, fill patient data **including `doctorFax`**, select an Rx, reach the generate step. Click **Fax to physician**. Expect: button shows "Sending" → "Sent — delivery pending"; a `fax.sent` audit row appears (verify via `getAuditLog`); a fax appears in the Phaxio sandbox.

- [ ] **Step 3: Referral fax**

Open an assessment, check a red flag, reach the referral summary. Click **Fax referral**. Expect the same flow using a referral document.

- [ ] **Step 4: Negative path**

Remove `doctorFax` from the patient step. Expect: both Fax buttons disabled with helper text; Download still works.

- [ ] **Step 5: Verify no PHI leaked to Supabase**

```sql
SELECT metadata FROM audit.log WHERE event_type = 'fax.sent' ORDER BY created_at DESC LIMIT 5;
```
Expected: only `{ correlation_id, status, provider, document_type, [tx_id] }`. No destination/patient fields.

---

## Data / DB changes (summary)

- **Supabase:** add `fax.sent` to `audit.event_type`; extend `log_event` with `fax.sent` required-key + PHI-rejection validation; add a non-PHI rate-limit counter (`fax_send_attempts` or count via audit read path).
- **fly.io (when provisioned, roadmap #2):** `fax_delivery` table (Task 7).
- **Env:** `FAX_ENABLED`, `FAX_PROVIDER`, `PHAXIO_API_KEY`, `PHAXIO_API_SECRET`, `FAX_WEBHOOK_SECRET`, `FLY_PHI_STORE_URL`.

## Verification commands

- Typecheck: `npx tsc --noEmit --pretty`
- Lint: `npm run lint`
- Tests: `npx vitest run`

## Rollout notes

- **Phase 0 (ops):** create Phaxio/Documo account; **sign the BAA**; provision sandbox keys.
- **Phase 1 (code, behind `FAX_ENABLED`):** ship Tasks 1–6 + 8 with the delivery-record write stubbed (Task 7). Feature is dark until `FAX_ENABLED=true`. The Supabase audit + provider send are live; the fly.io delivery record is a no-op.
- **Phase 2 (after roadmap #2 provisions fly.io):** apply the `fax_delivery` migration on fly.io, flip `FLY_PHI_STORE_URL`, and the stubbed writes in Task 7 activate automatically. At this point also tighten destination validation against the stored assessment's physician fax (remove the client-supplied-trust caveat in the design §5.3).
- **Never** put provider credentials in the client bundle (`NEXT_PUBLIC_`), and **never** persist a destination fax number in Supabase.
