# Patient Pre-Intake Link — Implementation Plan

**Date:** 2026-06-24
**Roadmap item:** #8 (NEXT tier) — "Patient pre-intake link (mobile; demographics + symptoms filled before arrival)"
**Design:** `docs/superpowers/specs/2026-06-24-patient-pre-intake-link-design.md`
**Status:** Draft (pending review)

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a pharmacist generate a short-lived, single-use, HMAC-signed link for an ailment; let the patient fill demographics + presenting symptoms on a no-login mobile page; persist the PHI submission to fly.io (BAA-gated); and pre-fill the wizard at the counter. Establishes the shared `src/lib/signed-links/` primitive that roadmap #10 reuses.

**Architecture:** New `src/lib/signed-links/` (`node:crypto`, no new dependency) signs/verifies purpose-bound, expiring tokens. New Supabase non-PHI `pre_intake` slot table + `SECURITY DEFINER` `consume_pre_intake_slot` RPC for atomic single-use. New fly.io PHI `pre_intake_submission` table (behind `PHI_PERSIST_ENABLED`, extends #2). New no-login route `/intake/[token]`. Pharmacist dashboard picker + wizard `initialPatient`/`initialSymptoms` pre-fill.

**Tech Stack:** Next.js 16, React 19, Supabase (non-PHI), fly.io Postgres (PHI, #2), `node:crypto`, vitest.

**Two-phase shipping (mirrors every #2-dependent feature):**
- **Phase 1 (ships live, no fly.io/BAA needed):** Tasks 1–6, 8, 10 — signed-link module, Supabase slot + RPC, audit events, generate-link UI + dashboard picker shell, no-login intake page + form, wizard pre-fill plumbing, tests. The link generates, the page renders, the patient fills and submits (slot flips honestly to `submitted`), but the PHI write is a graceful no-op until fly.io is up.
- **Phase 2 (gated on `PHI_PERSIST_ENABLED` + signed BAA, inherits #2's procurement):** Task 7 + the fly.io write half of Task 4 — `pre_intake_submission` write + `loadIntakeAction` retrieval → the actual end-to-end pre-fill value.

---

### Task 1: Add `intake.link_generated` + `intake.submitted` audit events

**Files:**
- Database migration (Supabase MCP)
- Modify: `src/lib/audit-actions.ts`

- [ ] **Step 1: Apply migration `add_intake_audit_events`**

```sql
ALTER TYPE audit.event_type ADD VALUE 'intake.link_generated';
ALTER TYPE audit.event_type ADD VALUE 'intake.submitted';
```

- [ ] **Step 2: Extend `log_event` validation** to accept `intake.link_generated` / `intake.submitted` with metadata restricted to `{ intake_id }` only — reject any `ailment_*` or patient-identifying key (mirroring #2's `assessment.saved` discipline). (If `log_event` uses an allowlist per event type, add both events with the `{ intake_id }` allowlist; if it uses a denylist, add `ailment`, `name`, `dob`, `phone`, `address`, `postal_code` to the global denylist as in #2.)

- [ ] **Step 3: Add to the `EventType` union** in `src/lib/audit-actions.ts:5-18`:

```ts
  | "intake.link_generated"
  | "intake.submitted"
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit-actions.ts
git commit -m "feat: add intake.link_generated and intake.submitted audit events"
```

---

### Task 2: Signed-link module (`src/lib/signed-links/index.ts`) + tests (the #10-shared primitive)

**Files:**
- Create: `src/lib/signed-links/index.ts`
- Test: `src/__tests__/signed-links.test.ts`
- Env: `SIGNED_LINK_SECRET` (server-only; document in `.env.example` if present — do NOT create new config files per constraints)

- [ ] **Step 1: Write the failing test** `src/__tests__/signed-links.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.stubEnv("SIGNED_LINK_SECRET", "test-secret-32-chars-min-length-aaaaa")

import {
  signLink,
  verifyLink,
  newResourceId,
  DEFAULT_PRE_INTAKE_TTL_SECONDS,
} from "@/lib/signed-links"

describe("signed-links", () => {
  const now = 1_000_000

  it("round-trips a valid pre_intake token", () => {
    const resourceId = newResourceId()
    const token = signLink({ resourceId, pharmacyId: "pharm-1", purpose: "pre_intake" })
    const payload = verifyLink(token, "pre_intake", now + 100)
    expect(payload).not.toBeNull()
    expect(payload!.resourceId).toBe(resourceId)
    expect(payload!.pharmacyId).toBe("pharm-1")
    expect(payload!.purpose).toBe("pre_intake")
    expect(payload!.exp).toBeGreaterThan(now)
  })

  it("rejects a tampered payload (MAC mismatch)", () => {
    const token = signLink({ resourceId: "r1", pharmacyId: "p1", purpose: "pre_intake" })
    const [payloadB64] = token.split(".")
    const tampered = `${payloadB64}X.${token.split(".")[1]}`
    expect(verifyLink(tampered, "pre_intake", now + 100)).toBeNull()
  })

  it("rejects a tampered MAC", () => {
    const token = signLink({ resourceId: "r1", pharmacyId: "p1", purpose: "pre_intake" })
    const tampered = `${token.slice(0, -2)}AA`
    expect(verifyLink(tampered, "pre_intake", now + 100)).toBeNull()
  })

  it("rejects an expired token", () => {
    const token = signLink({ resourceId: "r1", pharmacyId: "p1", purpose: "pre_intake" }, 60)
    const payload = verifyLink(token, "pre_intake", now + 120)
    expect(payload).toBeNull()
  })

  it("rejects a token verified against the wrong purpose (purpose-binding)", () => {
    const token = signLink({ resourceId: "r1", pharmacyId: "p1", purpose: "pre_intake" })
    expect(verifyLink(token, "prom_followup", now + 100)).toBeNull()
  })

  it("a prom_followup token cannot be replayed as pre_intake", () => {
    const token = signLink({ resourceId: "r1", pharmacyId: "p1", purpose: "prom_followup" })
    expect(verifyLink(token, "pre_intake", now + 100)).toBeNull()
  })

  it("respects a custom ttl", () => {
    const token = signLink({ resourceId: "r1", pharmacyId: "p1", purpose: "pre_intake" }, 10)
    expect(verifyLink(token, "pre_intake", now + 5)).not.toBeNull()
    expect(verifyLink(token, "pre_intake", now + 20)).toBeNull()
  })

  it("DEFAULT_PRE_INTAKE_TTL_SECONDS is 24 hours", () => {
    expect(DEFAULT_PRE_INTAKE_TTL_SECONDS).toBe(60 * 60 * 24)
  })

  it("newResourceId returns unique uuids", () => {
    const a = newResourceId()
    const b = newResourceId()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/signed-links.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation** `src/lib/signed-links/index.ts`

```ts
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto"

export type SignedLinkPurpose = "pre_intake" | "prom_followup"

export interface SignedLinkPayload {
  resourceId: string
  pharmacyId: string
  purpose: SignedLinkPurpose
  exp: number // unix seconds
}

export const DEFAULT_PRE_INTAKE_TTL_SECONDS = 60 * 60 * 24 // 24h

function getSecret(): string {
  const secret = process.env.SIGNED_LINK_SECRET
  if (!secret || secret.length < 32) {
    throw new Error("SIGNED_LINK_SECRET must be set and >= 32 chars")
  }
  return secret
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input
  return buf.toString("base64url")
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url")
}

function mac(payloadJson: string, purpose: SignedLinkPurpose, secret: string): Buffer {
  return createHmac("sha256", secret).update(`${payloadJson}|${purpose}`).digest()
}

export function newResourceId(): string {
  return randomUUID()
}

export function signLink(
  payload: Omit<SignedLinkPayload, "exp"> & { exp?: number },
  ttlSeconds: number = DEFAULT_PRE_INTAKE_TTL_SECONDS,
): string {
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + ttlSeconds
  const full: SignedLinkPayload = {
    resourceId: payload.resourceId,
    pharmacyId: payload.pharmacyId,
    purpose: payload.purpose,
    exp,
  }
  const json = JSON.stringify({
    resourceId: full.resourceId,
    pharmacyId: full.pharmacyId,
    purpose: full.purpose,
    exp: full.exp,
  })
  const sig = mac(json, full.purpose, getSecret())
  return `${b64url(json)}.${b64url(sig)}`
}

export function verifyLink(
  token: string,
  expectedPurpose: SignedLinkPurpose,
  now: number = Math.floor(Date.now() / 1000),
): SignedLinkPayload | null {
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [payloadB64, sigB64] = parts
  let json: string
  try {
    json = fromB64url(payloadB64).toString("utf8")
  } catch {
    return null
  }
  let parsed: SignedLinkPayload
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (
    typeof parsed.resourceId !== "string" ||
    typeof parsed.pharmacyId !== "string" ||
    typeof parsed.purpose !== "string" ||
    typeof parsed.exp !== "number"
  ) {
    return null
  }
  if (parsed.purpose !== expectedPurpose) return null
  if (parsed.exp <= now) return null

  let expected: Buffer
  try {
    expected = mac(json, parsed.purpose, getSecret())
  } catch {
    return null
  }
  const provided = fromB64url(sigB64)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null
  }
  return parsed
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/signed-links.test.ts`
Expected: PASS (9)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/signed-links/index.ts src/__tests__/signed-links.test.ts
git commit -m "feat: add signed-links module (shared pre-intake + PROM primitive)"
```

---

### Task 3: Supabase non-PHI `pre_intake` slot table + `consume_pre_intake_slot` RPC

**Files:**
- Database migration (Supabase MCP)
- No `src/` changes in this task (queries live in Task 4's module)

- [ ] **Step 1: Apply migration `create_pre_intake_slot`**

```sql
-- NON-PHI: a pharmacy's pending-intake slot for an ailment. Created BEFORE any
-- patient data exists, so the row itself identifies a pharmacy + ailment, not a person.
CREATE TABLE public.pre_intake (
  intake_id    uuid PRIMARY KEY,
  pharmacy_id  uuid NOT NULL REFERENCES public.pharmacies(id),
  ailment_slug text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','submitted','consumed','expired')),
  created_by   uuid NOT NULL,                 -- pharmacist profiles.id
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  submitted_at timestamptz,
  consumed_at  timestamptz
);

CREATE INDEX pre_intake_pharmacy_status_created
  ON public.pre_intake (pharmacy_id, status, created_at DESC);

ALTER TABLE public.pre_intake ENABLE ROW LEVEL SECURITY;

CREATE POLICY pre_intake_pharmacy_read
  ON public.pre_intake FOR SELECT
  USING (pharmacy_id IN (
    SELECT pharmacy_id FROM public.pharmacy_members
    WHERE user_id = auth.uid() AND is_active
  ));

CREATE POLICY pre_intake_pharmacy_insert
  ON public.pre_intake FOR INSERT
  WITH CHECK (pharmacy_id IN (
    SELECT pharmacy_id FROM public.pharmacy_members
    WHERE user_id = auth.uid() AND is_active
  ));

CREATE POLICY pre_intake_pharmacy_update
  ON public.pre_intake FOR UPDATE
  USING (pharmacy_id IN (
    SELECT pharmacy_id FROM public.pharmacy_members
    WHERE user_id = auth.uid() AND is_active
  ));
```

> RLS covers pharmacist read/insert/update for their own pharmacy. The **patient submit path** has no `auth.uid()`, so it uses the `SECURITY DEFINER` RPC below instead of a direct UPDATE — keeping the unauthenticated surface to a single narrow RPC.

- [ ] **Step 2: Add the atomic single-use flip RPC `consume_pre_intake_slot`**

```sql
CREATE OR REPLACE FUNCTION public.consume_pre_intake_slot(
  p_intake_id uuid,
  p_pharmacy_id uuid
) RETURNS public.pre_intake AS $$
DECLARE row public.pre_intake;
BEGIN
  -- Atomic single-use: only a 'pending', unexpired, pharmacy-bound slot flips.
  UPDATE public.pre_intake
     SET status = 'submitted', submitted_at = now()
   WHERE intake_id = p_intake_id
     AND pharmacy_id = p_pharmacy_id
     AND status = 'pending'
     AND expires_at > now()
  RETURNING * INTO row;
  RETURN row;  -- NULL if nothing matched (expired / already-consumed / wrong pharmacy)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 3: (Optional) add a cron to mark stale slots `expired`** — e.g. a Supabase scheduled function `UPDATE pre_intake SET status='expired' WHERE status='pending' AND expires_at <= now()`. Non-blocking; document for ops.

- [ ] **Step 4: Verify** in the Supabase dashboard that the table + RPC exist and RLS is enabled; manually test the RPC returns NULL for a second consume of the same row.

- [ ] **Step 5: Commit** (migration SQL only; `src/` lands in Task 4)

```bash
git commit --allow-empty -m "feat(db): add pre_intake slot table + consume_pre_intake_slot RPC"
```

---

### Task 4: Intake types + server actions (`src/lib/intake/`)

**Files:**
- Create: `src/lib/intake/types.ts`
- Create: `src/lib/intake/actions.ts`
- Test: `src/__tests__/intake-actions.test.ts`

- [ ] **Step 1: Create `src/lib/intake/types.ts`**

```ts
export interface PreIntakeSubmission {
  name: string
  dob: string
  sex: "" | "Male" | "Female" | "Other"
  phone: string
  address: string
  city: string
  postalCode: string
  ohip?: string
  doctorName?: string
  doctorPhone?: string
  doctorFax?: string
  doctorAddress?: string
  symptomsChecked: string[]
}

export interface IntakeContext {
  pharmacyName: string
  ailmentName: string
  symptoms: string[]
}
```

- [ ] **Step 2: Write the failing test** `src/__tests__/intake-actions.test.ts` covering:
  - `generateIntakeLinkAction`: calls `requireAuth`; returns `{ error }` if `!profile.pharmacyId`; returns `{ error }` for an unknown slug; on success inserts a `pre_intake` slot scoped to `profile.pharmacyId`, logs `intake.link_generated { intake_id }`, and returns a URL whose token `verifyLink(_, "pre_intake")` accepts.
  - `getIntakeContextAction`: rejects a bad/expired token; for a valid token returns `{ pharmacyName, ailmentName, symptoms }` (symptoms == `getAilmentBySlug(slot.ailment_slug).symptoms`) and **no PHI**.
  - `submitIntakeAction`: rejects a bad token; rejects when the slot is not `pending` (single-use, via the RPC returning NULL); rejects `symptomsChecked` containing a string not in `ailment.symptoms`; when `PHI_PERSIST_ENABLED !== "true"` performs the slot flip (honest single-use) but writes nothing to fly.io and returns `{ ok: true }` (graceful); logs `intake.submitted { intake_id }`.
  - `loadIntakeAction`: calls `requireAuth`; returns `{ error }` if the intake's `pharmacy_id !== profile.pharmacyId`; returns `{ patient, symptomsChecked }` from the fly.io submission when `PHI_PERSIST_ENABLED === "true"`.

  Mock `@/lib/supabase/server`, `@/lib/auth-guards`, `@/lib/audit-actions`, `@/lib/ailments`, `@/lib/signed-links`, and `@/lib/phi/db` (the fly.io pool, per #2). Use `vi.stubEnv("PHI_PERSIST_ENABLED", …)` and `vi.stubEnv("SIGNED_LINK_SECRET", …)`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/intake-actions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Write `src/lib/intake/actions.ts`**

```ts
"use server"

import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"
import { getAilmentBySlug } from "@/lib/ailments"
import { signLink, verifyLink, newResourceId } from "@/lib/signed-links"
import { getPhiPool } from "@/lib/phi/db" // from #2; throws if PHI_PERSIST_ENABLED off
import type { PreIntakeSubmission, IntakeContext } from "./types"
import type { PatientInfo } from "@/types"

const PRE_INTAKE_TTL =
  Number(process.env.PRE_INTAKE_TTL_SECONDS) || 60 * 60 * 24

function appUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL must be set")
  return base.replace(/\/$/, "")
}

export async function generateIntakeLinkAction(
  ailmentSlug: string,
): Promise<{ url?: string; intakeId?: string; error?: string }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { error: "No pharmacy associated with this account." }
  const ailment = getAilmentBySlug(ailmentSlug)
  if (!ailment) return { error: "Unknown ailment." }

  const intakeId = newResourceId()
  const supabase = await createClient()
  const { error } = await supabase.from("pre_intake").insert({
    intake_id: intakeId,
    pharmacy_id: profile.pharmacyId,
    ailment_slug: ailmentSlug,
    status: "pending",
    created_by: profile.id,
    expires_at: new Date(Date.now() + PRE_INTAKE_TTL * 1000).toISOString(),
  })
  if (error) return { error: error.message }

  const token = signLink(
    { resourceId: intakeId, pharmacyId: profile.pharmacyId, purpose: "pre_intake" },
    PRE_INTAKE_TTL,
  )
  await logAuditEvent("intake.link_generated", { intake_id: intakeId })
  return { url: `${appUrl()}/intake/${token}`, intakeId }
}

export async function getIntakeContextAction(
  token: string,
): Promise<IntakeContext | { error: string }> {
  const payload = verifyLink(token, "pre_intake")
  if (!payload) return { error: "This intake link is no longer valid." }
  const supabase = await createClient()
  const { data: slot } = await supabase
    .from("pre_intake")
    .select("ailment_slug, pharmacy_id, status")
    .eq("intake_id", payload.resourceId)
    .eq("pharmacy_id", payload.pharmacyId)
    .single()
  if (!slot) return { error: "This intake link is no longer valid." }
  if (slot.status !== "pending") return { error: "This intake has already been submitted." }
  const ailment = getAilmentBySlug(slot.ailment_slug)
  if (!ailment) return { error: "This intake link is no longer valid." }
  const { data: pharm } = await supabase
    .from("pharmacies")
    .select("name")
    .eq("id", payload.pharmacyId)
    .single()
  return {
    pharmacyName: pharm?.name ?? "Your pharmacy",
    ailmentName: ailment.name,
    symptoms: ailment.symptoms,
  }
}

export async function submitIntakeAction(
  token: string,
  submission: PreIntakeSubmission,
): Promise<{ ok: true } | { error: string }> {
  const payload = verifyLink(token, "pre_intake")
  if (!payload) return { error: "This intake link is no longer valid." }
  if (!submission.name?.trim() || !submission.dob?.trim()) {
    return { error: "Name and date of birth are required." }
  }
  const supabase = await createClient()
  const { data: slot } = await supabase
    .from("pre_intake")
    .select("ailment_slug")
    .eq("intake_id", payload.resourceId)
    .eq("pharmacy_id", payload.pharmacyId)
    .single()
  if (!slot) return { error: "This intake link is no longer valid." }
  const ailment = getAilmentBySlug(slot.ailment_slug)
  if (!ailment) return { error: "This intake link is no longer valid." }
  // Server-side symptom validation: reject any string not on the ailment's checklist.
  const allowed = new Set(ailment.symptoms)
  for (const s of submission.symptomsChecked) {
    if (!allowed.has(s)) return { error: "Invalid symptom selection." }
  }

  // Atomic single-use flip via SECURITY DEFINER RPC (patient has no RLS identity).
  const { data: consumed, error: rpcError } = await supabase.rpc("consume_pre_intake_slot", {
    p_intake_id: payload.resourceId,
    p_pharmacy_id: payload.pharmacyId,
  })
  if (rpcError || !consumed) return { error: "This intake link is no longer valid." }

  await logAuditEvent("intake.submitted", { intake_id: payload.resourceId })

  // PHI write — gated on fly.io (#2). Graceful no-op when off (slot already flipped honestly).
  if (process.env.PHI_PERSIST_ENABLED === "true") {
    try {
      const pool = getPhiPool()
      await pool.query(
        `INSERT INTO pre_intake_submission
           (intake_id, pharmacy_id, patient_payload, symptoms_checked, submitted_from)
         VALUES ($1, $2, $3, $4, 'web')`,
        [
          payload.resourceId,
          payload.pharmacyId,
          submission,
          JSON.stringify(submission.symptomsChecked),
        ],
      )
    } catch {
      // Non-blocking to the patient: slot is already 'submitted' (single-use honoured).
    }
  }

  return { ok: true }
}

export async function loadIntakeAction(
  intakeId: string,
): Promise<{ patient: PatientInfo; symptomsChecked: string[] } | { error: string }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { error: "No pharmacy associated with this account." }
  const supabase = await createClient()
  const { data: slot } = await supabase
    .from("pre_intake")
    .select("pharmacy_id, ailment_slug, status")
    .eq("intake_id", intakeId)
    .single()
  if (!slot || slot.pharmacy_id !== profile.pharmacyId) {
    return { error: "Intake not found." }
  }
  if (process.env.PHI_PERSIST_ENABLED !== "true") {
    return { error: "PHI persistence is not enabled." }
  }
  const pool = getPhiPool()
  const { rows } = await pool.query(
    `SELECT patient_payload, symptoms_checked
       FROM pre_intake_submission
      WHERE intake_id = $1 AND pharmacy_id = $2`,
    [intakeId, profile.pharmacyId],
  )
  if (rows.length === 0) return { error: "Submission not found." }
  const sub = rows[0].patient_payload as PreIntakeSubmission
  const patient: PatientInfo = {
    name: sub.name ?? "",
    dob: sub.dob ?? "",
    sex: sub.sex ?? "",
    ohip: sub.ohip ?? "",
    address: sub.address ?? "",
    city: sub.city ?? "",
    postalCode: sub.postalCode ?? "",
    phone: sub.phone ?? "",
    allergies: "NKDA",            // PMS-owned — default, pharmacist reviews (#5)
    currentMeds: "",             // PMS-owned — default (#5)
    doctorName: sub.doctorName ?? "",
    doctorLicense: "",           // not collected — #5 removes this field
    doctorPhone: sub.doctorPhone ?? "",
    doctorFax: sub.doctorFax ?? "",
    doctorAddress: sub.doctorAddress ?? "",
    encounterType: "",           // pharmacist-entered
    pregnant: false,             // ailment-clinical via redFlags checklist (#5)
    breastfeeding: false,
  }
  // Mark consumed (terminal single-use on the pharmacist side too).
  await supabase
    .from("pre_intake")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("intake_id", intakeId)
    .eq("status", "submitted")
  return { patient, symptomsChecked: rows[0].symptoms_checked ?? [] }
}
```

> **Note on `getPhiPool`:** this is #2's helper (`persist-assessments-flyio-design.md` §4.1). If #2 is not yet implemented, gate the fly.io calls behind `process.env.PHI_PERSIST_ENABLED === "true"` (as shown) and import `getPhiPool` lazily inside the guard so the module compiles without #2's `phi/db.ts` present. The non-PHI paths (slot + audit) work without #2.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/intake-actions.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/lib/intake/types.ts src/lib/intake/actions.ts src/__tests__/intake-actions.test.ts
git commit -m "feat: add pre-intake server actions (generate/context/submit/load)"
```

---

### Task 5: No-login intake route + mobile form (`src/app/intake/[token]/`)

**Files:**
- Create: `src/app/intake/[token]/page.tsx`
- Create: `src/app/intake/[token]/intake-form.tsx`
- Test: `src/__tests__/intake-form.test.tsx`

- [ ] **Step 1: Create the server component** `src/app/intake/[token]/page.tsx`

```tsx
import { getIntakeContextAction } from "@/lib/intake/actions"
import { IntakeForm } from "./intake-form"

export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const ctx = await getIntakeContextAction(token)
  if ("error" in ctx) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold mb-2">Link no longer valid</h1>
          <p className="text-sm text-muted-foreground">{ctx.error}</p>
          <p className="text-sm text-muted-foreground mt-3">
            Please ask the pharmacy staff for a new link.
          </p>
        </div>
      </main>
    )
  }
  return <IntakeForm token={token} context={ctx} />
}
```

- [ ] **Step 2: Create the client form** `src/app/intake/[token]/intake-form.tsx` — mobile-first, fields per `PreIntakeSubmission` (§4.6), `symptomsChecked` bound to `context.symptoms`, PHIPA collection notice, submit → `submitIntakeAction(token, payload)` → confirmation screen with re-submit disabled. Reuse `@/components/ui/{input,label,checkbox,button}`.

- [ ] **Step 3: Write the component test** `src/__tests__/intake-form.test.tsx` asserting: symptom list renders from `context.symptoms`; required-field validation; submit calls `submitIntakeAction`; on `{ ok: true }` shows confirmation and disables the button; on `{ error }` shows the error.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/intake-form.test.tsx` then `npx tsc --noEmit`
Expected: PASS; no errors

- [ ] **Step 5: Commit**

```bash
git add src/app/intake/[token] src/__tests__/intake-form.test.tsx
git commit -m "feat: add no-login patient pre-intake page + mobile form"
```

---

### Task 6: Dashboard picker + generate-link UI

**Files:**
- Create: `src/components/dashboard/intake-picker.tsx`
- Modify: `src/app/page.tsx` (render `<IntakePicker>` near `page.tsx:60`)
- Modify: `src/components/ailment-card.tsx` (or a sibling) — per-card "Generate pre-intake link" action (Copy + optional QR)

- [ ] **Step 1: Create `IntakePicker`** — a client component that queries submitted `pre_intake` slots for the active pharmacy (via a small server-action wrapper or a Supabase client query scoped by RLS) and renders a list linking to `/assess/[ailment]?intake={intake_id}`. Cap to the 20 most-recent `status='submitted'` rows. (Patient name for the list comes from `loadIntakeAction` at click time — Phase-2; in Phase 1 show ailment + time only.)

- [ ] **Step 2: Add the generate-link action** to the ailment card — calls `generateIntakeLinkAction(slug)`, on success shows a Copy button (and an optional dependency-free QR render of the URL).

- [ ] **Step 3: Render `<IntakePicker>`** on the dashboard (`src/app/page.tsx:60`, alongside `<AilmentGrid>`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/intake-picker.tsx src/app/page.tsx src/components/ailment-card.tsx
git commit -m "feat: add pre-intake link generation + dashboard picker"
```

---

### Task 7: fly.io `pre_intake_submission` migration (Phase-2, BAA-gated)

**Files:**
- Database migration on fly.io Postgres (extends #2's schema)

- [ ] **Step 1: Apply migration** (only after #2's fly.io is provisioned and a BAA is signed)

```sql
-- fly.io Postgres. PHI (demographics identify; symptoms describe clinical state).
CREATE TABLE pre_intake_submission (
  intake_id        uuid PRIMARY KEY,                     -- = Supabase pre_intake.intake_id (by value)
  pharmacy_id      uuid NOT NULL,
  patient_payload  jsonb NOT NULL,                       -- PreIntakeSubmission
  symptoms_checked jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  submitted_from   text                                  -- best-effort 'web' only (no IP/UA — §5.4)
);
CREATE INDEX pre_intake_submission_pharmacy
  ON pre_intake_submission (pharmacy_id, submitted_at DESC);

-- Optional cleanup: hard-delete consumed submissions after N days (retention TBD — §7.1).
-- e.g. a pg_cron job: DELETE FROM pre_intake_submission WHERE submitted_at < now() - interval '7 days';
```

- [ ] **Step 2: Verify** `submitIntakeAction` writes a row when `PHI_PERSIST_ENABLED=true` and `loadIntakeAction` reads it back end-to-end in staging.

- [ ] **Step 3: Commit** (migration SQL only)

```bash
git commit --allow-empty -m "feat(db): add pre_intake_submission PHI table on fly.io (BAA-gated)"
```

---

### Task 8: Wizard pre-fill plumbing (`initialPatient` / `initialSymptoms`)

**Files:**
- Modify: `src/components/wizard/wizard-container.tsx`
- Modify: `src/app/assess/[ailment]/page.tsx`
- Test: `src/__tests__/wizard-container.test.tsx` (or sibling)

- [ ] **Step 1: Extend `WizardContainerProps`** with optional `initialPatient?: PatientInfo` and `initialSymptoms?: string[]`; seed the initial `useState` for `patient` (`wizard-container.tsx:42`) and `symptomsChecked` (`wizard-container.tsx:44`) from these props when provided. Default state is unchanged when absent.

- [ ] **Step 2: Read `searchParams.intake`** in `src/app/assess/[ailment]/page.tsx`; if present, call `loadIntakeAction(intakeId)` (already auth'd + pharmacy-scoped). On success pass `initialPatient` + `initialSymptoms` to `<WizardContainer>`. On any error/expired/consumed, fall through to the blank wizard (graceful).

- [ ] **Step 3: Write the test** asserting: with `initialPatient`/`initialSymptoms` provided, `StepPatient` shows the seeded values and `canNext` at step 0 is true; without them, behaviour is identical to today (blank defaults).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/wizard-container.test.tsx` then `npx tsc --noEmit`
Expected: PASS; no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/wizard/wizard-container.tsx src/app/assess/[ailment]/page.tsx src/__tests__/wizard-container.test.tsx
git commit -m "feat: pre-fill wizard from a consumed pre-intake submission"
```

---

### Task 9: Whole-repo guards + verification

- [ ] **Step 1: PHI-leak guard grep** — assert no PHI keys leak into Supabase paths:

```bash
rg -n "ailment_slug|patient_payload|name|dob|ohip" src/lib/intake/actions.ts | \
  rg -v "ailment_slug.*ailment_slug|getAilmentBySlug|slot\.ailment_slug|ailment = |ailment\.symptoms|ailment\.name|ailmentName|submission\.|sub\.|patient_payload" 
```
Expected: no matches that indicate an ailment/patient value being sent to Supabase audit or stored on a Supabase table. (Manual review of `logAuditEvent` calls — only `{ intake_id }`.)

- [ ] **Step 2: No-NEXT_PUBLIC-leak guard**:

```bash
rg -n "NEXT_PUBLIC_(SIGNED_LINK|PHI)" src/
```
Expected: no matches (secrets are server-only).

- [ ] **Step 3: No-new-dependency guard**:

```bash
rg -n '"twilio"|"resend"|"jsonwebtoken"|"jose"|"qrcode"|"@anthropic-ai' package.json
```
Expected: no matches.

- [ ] **Step 4: Typecheck + lint + test + build**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all pass

- [ ] **Step 5: Commit** any guard/CI rule additions (e.g. an eslint rule or a `scripts/` check) — note: per constraints, do NOT add files under `scripts/`; if a CI grep is desired, document it in the plan only.

---

### Task 10: Staging E2E (Phase-1 slice + Phase-2 once fly.io is up)

- [ ] **Step 1 (Phase 1):** Log in as a pharmacist → dashboard → generate a pre-intake link for an ailment → open the link in a clean browser (no session) → fill demographics + tick symptoms → submit → confirm the slot flips to `submitted` in Supabase and the audit row `intake.submitted { intake_id }` exists. Confirm the dashboard picker shows the submitted slot (ailment + time; no PHI on Supabase).

- [ ] **Step 2 (Phase 2, after fly.io/BAA):** With `PHI_PERSIST_ENABLED=true`, repeat the submit → confirm a `pre_intake_submission` row exists on fly.io. From the dashboard, click the intake → confirm `/assess/[ailment]?intake=…` opens the wizard with `patient` and `symptomsChecked` pre-filled and the slot `consumed`. Edit a field, proceed through the consult, confirm the consumed intake cannot be reloaded.

- [ ] **Step 3: Negative tests** — expired token, replayed submit (second submit rejected), tampered token, wrong-pharmacy `loadIntakeAction` (rejected), symptom-string not in `ailment.symptoms` (rejected), `PHI_PERSIST_ENABLED` off (graceful submit, no fly.io write, no phantom intake on the dashboard).

---

## Files to create / modify (summary)

**Created:** `src/lib/signed-links/index.ts`; `src/lib/intake/types.ts`; `src/lib/intake/actions.ts`; `src/app/intake/[token]/page.tsx`; `src/app/intake/[token]/intake-form.tsx`; `src/components/dashboard/intake-picker.tsx`; `src/__tests__/signed-links.test.ts`; `src/__tests__/intake-actions.test.ts`; `src/__tests__/intake-form.test.tsx`; (wizard pre-fill test if not existing).

**Modified:** `src/lib/audit-actions.ts` (two events); `src/components/wizard/wizard-container.tsx` (`initialPatient`/`initialSymptoms`); `src/app/assess/[ailment]/page.tsx` (read `?intake=`); `src/app/page.tsx` (render `<IntakePicker>`); `src/components/ailment-card.tsx` (generate-link action).

**Database (Supabase, non-PHI):** `pre_intake` table + RLS + `consume_pre_intake_slot` RPC (Task 3); two `audit.event_type` values + `log_event` validation (Task 1).

**Database (fly.io, PHI, BAA-gated):** `pre_intake_submission` table (Task 7, Phase-2).

**Environment (server-only):** `SIGNED_LINK_SECRET` (≥32 chars); optional `PRE_INTAKE_TTL_SECONDS`; `NEXT_PUBLIC_APP_URL` (confirm present). `PHI_PERSIST_ENABLED` + `FLY_PHI_DATABASE_URL` inherited from #2.

## Tests

- `signed-links.test.ts` — round-trip, tamper-detection (payload + MAC), expiry, purpose-binding (both directions), custom TTL, default TTL constant, uuid uniqueness.
- `intake-actions.test.ts` — generate (auth, pharmacy scope, unknown slug), context (bad token, non-PHI payload), submit (bad token, single-use atomicity, symptom validation, PHI_PERSIST_ENABLED gating, graceful no-op, audit metadata), load (auth, pharmacy scope, missing/expired).
- `intake-form.test.tsx` — symptom rendering, required validation, submit success/confirmation, error display.
- wizard pre-fill test — seeding when provided; blank default unchanged.
- CI guard greps (Task 9) — PHI-leak, NEXT_PUBLIC-leak, no-new-dependency.

## Verification commands

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
# guards
rg -n "NEXT_PUBLIC_(SIGNED_LINK|PHI)" src/                 # expect none
rg -n '"twilio"|"resend"|"jsonwebtoken"|"jose"|"qrcode"' package.json  # expect none
```

## Rollout notes

- **Phase 1 ships live** with no fly.io/BAA dependency: the signed-link module, the Supabase `pre_intake` slot + RPC, the audit events, the generate-link UI, the dashboard picker shell, the no-login intake page + form, and the wizard pre-fill plumbing. In Phase 1 the link generates, the page renders, the patient submits (slot flips honestly to `submitted`), but the PHI write is a graceful no-op and the dashboard shows no PHI names — the counter-time pre-fill value is dormant until fly.io lands.
- **Phase 2** (the actual pre-fill at the counter) is gated on `PHI_PERSIST_ENABLED === "true"` + a signed BAA with fly.io, identical to #2/#3/#4. It lands with the same procurement; no separate flag.
- **Soft gates (non-blocking):** legal/privacy-officer review of the no-login collection notice (§4.7); AODA WCAG 2.1 AA conformance review for the patient-facing page (§7.8); optional per-IP rate limit on the public submit path (§7.11).
- **Hard gates:** signed fly.io BAA + `SIGNED_LINK_SECRET` provisioned (≥32 chars) before any production link is minted.
- **Forward-compat:** the signed-link module is purpose-tagged for `"prom_followup"` — roadmap #10 reuses `signLink`/`verifyLink` for its no-login PROM-response pages without changes, and mirrors the single-use-on-resource pattern (keyed on `prom_response.responded_at`). The `pre_intake` slot design (non-PHI slot + PHI submission on fly.io) is the template #10's `prom_*` tables will follow.
- **No regressions:** the wizard pre-fill is strictly additive (`initialPatient`/`initialSymptoms` default to today's blank state); a consult without a pre-intake is byte-identical to the current flow.
