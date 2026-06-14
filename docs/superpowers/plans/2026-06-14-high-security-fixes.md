# High-Severity Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five High findings from the 2026-06-14 security audit — invite TOCTOU (5), non-transactional signup (6), duplicated signup paths (7), missing rate limiting (8), missing middleware (9).

**Architecture:** Three DB migrations (create_pharmacy_owner RPC, rate_limits table + check_rate_limit RPC) plus code changes scoped to `src/lib/auth-actions.ts`, a new `src/lib/rate-limit.ts`, a new `src/middleware.ts`, and deletion of the dead `/api/auth/signup` route. TDD on 5, 6, 8 (behavior changes). Pure deletion on 7. Config-style + manual verification on 9.

**Tech Stack:** Next.js 16 (App Router, server actions), `@supabase/ssr` 0.10.3, Vitest 4, Supabase Postgres (cloud, ca-central-1).

**Spec:** `docs/superpowers/specs/2026-06-14-high-security-fixes-design.md`

---

## File Structure

| Path | Purpose |
|------|---------|
| `src/app/api/auth/signup/route.ts` | Deleted (Fix 7). |
| `src/lib/auth-actions.ts` | `signup` uses new RPC; `signupWithInvite` becomes atomic-claim-first; rate-limit checks inserted in `login`/`signup`/`signupWithInvite`/`forgotPassword`. |
| `src/lib/rate-limit.ts` | New — `checkRateLimit` + `enforceRateLimit`. |
| `src/middleware.ts` | New — `@supabase/ssr` route protection + session refresh. |
| `supabase/migrations/<ts>_create_pharmacy_owner.sql` | New — transactional signup RPC. |
| `supabase/migrations/<ts>_rate_limits.sql` | New — table + check_rate_limit RPC + RLS. |
| `supabase/migrations/<ts>_rate_limit_prune_cron.sql` | New — pg_cron schedule (or doc-only). |
| `src/__tests__/auth-actions.test.ts` | New or extended — `signup`/`signupWithInvite` TDD. |
| `src/__tests__/rate-limit.test.ts` | New — helper TDD. |

---

## Task 1: Delete dead `/api/auth/signup` route (Fix 7)

**Why first:** Smallest, independent, unblocks conceptual cleanup before touching the surviving signup path.

**Files:**
- Delete: `src/app/api/auth/signup/route.ts`

- [ ] **Step 1: Verify nothing references the route**

```bash
cd cdst-app && rg "/api/auth/signup" src/
```
Expected: no matches. If anything matches, STOP and report — the spec assumed this route is unreferenced; if something does, the deletion plan needs revisiting.

- [ ] **Step 2: Delete the route**

```bash
cd cdst-app && rtk rm src/app/api/auth/signup/route.ts
```

If the directory is now empty, also remove it:
```bash
cd cdst-app && rmdir src/app/api/auth/signup 2>/dev/null || true
```

- [ ] **Step 3: Verify build still compiles**

```bash
cd cdst-app && npx tsc --noEmit
```
Expected: same baseline (4 pre-existing errors in test fixtures). No new errors. The signup route deletion shouldn't affect anything since nothing imports it.

- [ ] **Step 4: Run full test suite**

```bash
cd cdst-app && npm test
```
Expected: 79/79 pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(security): delete dead /api/auth/signup route (audit #7)"
```

Do not push.

---

## Task 2: Migration — `create_pharmacy_owner` RPC (Fix 6 prerequisite)

**Files:**
- Apply via MCP `supabase_apply_migration`
- Create: `supabase/migrations/<ts>_create_pharmacy_owner.sql`

- [ ] **Step 1: Inspect existing RLS policies on `pharmacies`, `profiles`, `pharmacy_members`**

Call MCP `supabase_execute_sql`:
```sql
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('pharmacies', 'profiles', 'pharmacy_members')
ORDER BY tablename, cmd;
```
Record output. The RPC will run as the calling user (SECURITY INVOKER), so the new user's JWT must permit:
- INSERT into `pharmacies` (probably permitted because the user is the `created_by`)
- UPSERT into `profiles` for their own `id`
- INSERT into `pharmacy_members` for their own `user_id`

If any of these permissions are missing or restricted, the RPC will fail at runtime and Task 3's tests will surface it. Note any concerns but proceed.

- [ ] **Step 2: Apply the migration via MCP**

Call `supabase_apply_migration` with:
- `name`: `create_pharmacy_owner`
- `query`:
```sql
CREATE OR REPLACE FUNCTION public.create_pharmacy_owner(
  p_user_id       uuid,
  p_pharmacy      jsonb,
  p_profile       jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_pharmacy_id uuid;
BEGIN
  INSERT INTO public.pharmacies (
    name, address, city, province, postal_code, phone, fax,
    accreditation_number, created_by, subscription_status, subscription_tier, seats
  )
  VALUES (
    p_pharmacy->>'name',
    p_pharmacy->>'address',
    p_pharmacy->>'city',
    p_pharmacy->>'province',
    p_pharmacy->>'postal_code',
    p_pharmacy->>'phone',
    NULLIF(p_pharmacy->>'fax', ''),
    NULLIF(p_pharmacy->>'accreditation_number', ''),
    p_user_id,
    'active',
    'basic',
    5
  )
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.profiles (id, pharmacy_id, full_name, email, province)
  VALUES (
    p_user_id,
    v_pharmacy_id,
    p_profile->>'full_name',
    p_profile->>'email',
    p_profile->>'province'
  )
  ON CONFLICT (id) DO UPDATE SET
    pharmacy_id = EXCLUDED.pharmacy_id,
    full_name   = EXCLUDED.full_name;

  INSERT INTO public.pharmacy_members (user_id, pharmacy_id, role)
  VALUES (p_user_id, v_pharmacy_id, 'owner');

  RETURN v_pharmacy_id;
END;
$$;
```

- [ ] **Step 3: Save migration file**

Use the MCP-returned version, or UTC `202606141917` if none.

Path: `supabase/migrations/<ts>_create_pharmacy_owner.sql`

Contents:
```sql
-- Migration: create_pharmacy_owner
-- Transactional wrapper for signup's pharmacy+profile+member inserts.
-- SECURITY INVOKER — runs as the just-signed-up user's JWT. RLS permits
-- the inserts because the caller is the new owner.
-- Replaces the previous non-transactional sequence of three separate inserts
-- from src/lib/auth-actions.ts:signup. Closes audit item #6.
-- Source: docs/superpowers/specs/2026-06-14-high-security-fixes-design.md

CREATE OR REPLACE FUNCTION public.create_pharmacy_owner(
  p_user_id       uuid,
  p_pharmacy      jsonb,
  p_profile       jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_pharmacy_id uuid;
BEGIN
  INSERT INTO public.pharmacies (
    name, address, city, province, postal_code, phone, fax,
    accreditation_number, created_by, subscription_status, subscription_tier, seats
  )
  VALUES (
    p_pharmacy->>'name',
    p_pharmacy->>'address',
    p_pharmacy->>'city',
    p_pharmacy->>'province',
    p_pharmacy->>'postal_code',
    p_pharmacy->>'phone',
    NULLIF(p_pharmacy->>'fax', ''),
    NULLIF(p_pharmacy->>'accreditation_number', ''),
    p_user_id,
    'active',
    'basic',
    5
  )
  RETURNING id INTO v_pharmacy_id;

  INSERT INTO public.profiles (id, pharmacy_id, full_name, email, province)
  VALUES (
    p_user_id,
    v_pharmacy_id,
    p_profile->>'full_name',
    p_profile->>'email',
    p_profile->>'province'
  )
  ON CONFLICT (id) DO UPDATE SET
    pharmacy_id = EXCLUDED.pharmacy_id,
    full_name   = EXCLUDED.full_name;

  INSERT INTO public.pharmacy_members (user_id, pharmacy_id, role)
  VALUES (p_user_id, v_pharmacy_id, 'owner');

  RETURN v_pharmacy_id;
END;
$$;
```

- [ ] **Step 4: Verify function exists and shape is correct**

Call MCP `supabase_execute_sql`:
```sql
SELECT p.proname, l.lanname, p.prosecdef as security_definer,
       pg_get_function_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) LIKE '%SET search_path = ''''' as has_search_path_pin
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
JOIN pg_language l ON p.prolang = l.oid
WHERE n.nspname = 'public' AND p.proname = 'create_pharmacy_owner';
```
Expected:
- one row
- `prosecdef = false` (SECURITY INVOKER)
- `has_search_path_pin = true`
- args = `p_user_id uuid, p_pharmacy jsonb, p_profile jsonb`

- [ ] **Step 5: Run advisors**

Call MCP `supabase_get_advisors` type `security`. Expected: still 13 baseline lints, no NEW ones tied to this function.

If a `function_search_path_mutable` lint appears on `create_pharmacy_owner`, the `SET search_path = ''` didn't take. Re-verify and report.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): create_pharmacy_owner RPC for transactional signup"
```

Do not push.

---

## Task 3: TDD — `signup` uses `create_pharmacy_owner` RPC (Fix 6)

**Files:**
- Create: `src/__tests__/auth-actions.test.ts`
- Modify: `src/lib/auth-actions.ts:25-94` (`signup` function only)

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/auth-actions.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}))

import { signup } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

function buildFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  const defaults: Record<string, string> = {
    email: "new@example.com",
    password: "password123",
    fullName: "New User",
    pharmacyName: "New Pharmacy",
    address: "1 Main St",
    city: "Toronto",
    postalCode: "M5V1A1",
    phone: "4165551234",
    fax: "",
  }
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v)
  }
  return fd
}

function mockSupabase(opts: {
  signUpError?: boolean
  rpcError?: boolean
} = {}) {
  const signUp = vi.fn().mockResolvedValue(
    opts.signUpError
      ? { data: { user: null }, error: { message: "Email already registered" } }
      : { data: { user: { id: "u-new" } }, error: null }
  )

  const rpc = vi.fn().mockResolvedValue(
    opts.rpcError
      ? { data: null, error: { message: "pharmacy insert failed" } }
      : { data: "pharm-new", error: null }
  )

  const supabase = {
    auth: { signUp },
    rpc,
  }

  vi.mocked(createClient).mockResolvedValue(supabase as any)
  return { supabase, signUp, rpc }
}

describe("signup", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns signUp error without calling RPC when auth fails", async () => {
    const { rpc } = mockSupabase({ signUpError: true })

    const result = await signup(undefined, buildFormData())

    expect(result).toEqual({ error: "Email already registered" })
    expect(rpc).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  it("returns contact-support error when RPC fails", async () => {
    const { rpc } = mockSupabase({ rpcError: true })

    const result = await signup(undefined, buildFormData())

    expect(rpc).toHaveBeenCalledWith("create_pharmacy_owner", expect.objectContaining({
      p_user_id: "u-new",
    }))
    expect(result).toEqual({
      error: "Account created but pharmacy setup failed. Please contact support.",
    })
    expect(redirect).not.toHaveBeenCalled()
  })

  it("redirects to / on full success", async () => {
    mockSupabase()

    await signup(undefined, buildFormData())

    expect(redirect).toHaveBeenCalledWith("/")
  })

  it("passes pharmacy and profile fields to RPC as jsonb", async () => {
    const { rpc } = mockSupabase()

    await signup(undefined, buildFormData({ pharmacyName: "Shoppers", city: "Mississauga" }))

    expect(rpc).toHaveBeenCalledWith("create_pharmacy_owner", {
      p_user_id: "u-new",
      p_pharmacy: expect.objectContaining({
        name: "Shoppers",
        city: "Mississauga",
        province: "Ontario",
      }),
      p_profile: expect.objectContaining({
        full_name: "New User",
        email: "new@example.com",
        province: "Ontario",
      }),
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cdst-app && npm test -- src/__tests__/auth-actions.test.ts
```

Expected RED:
- "returns signUp error without calling RPC when auth fails" — may pass against current code (current code returns `authError.message` after signUp failure). That's OK.
- "returns contact-support error when RPC fails" — FAILS because current code calls three separate inserts (no RPC). The mock's `from()` doesn't exist on the supabase object → TypeError, OR the assertion on the contact-support message fails. Either way, RED for the right reason: the current code doesn't use an RPC.
- "redirects to / on full success" — likely FAILS because current code calls `from("pharmacies").insert(...)` which the mock doesn't expose → TypeError. Good — RED for the right reason.
- "passes pharmacy and profile fields to RPC as jsonb" — same TypeError, RED.

If all tests pass against current code, the test is wrong. Re-examine and adjust.

- [ ] **Step 3: Implement the fix**

Replace the `signup` function (currently `src/lib/auth-actions.ts:25-94`) with:

```typescript
export async function signup(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string
  const pharmacyName = formData.get("pharmacyName") as string
  const address = formData.get("address") as string
  const city = formData.get("city") as string
  const postalCode = formData.get("postalCode") as string
  const phone = formData.get("phone") as string
  const fax = (formData.get("fax") as string) || ""

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: "owner",
        pharmacy_name: pharmacyName,
        address,
        city,
        province: "Ontario",
        postal_code: postalCode,
        phone,
        fax,
      },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  if (authData.user) {
    const { error: rpcError } = await supabase.rpc("create_pharmacy_owner", {
      p_user_id: authData.user.id,
      p_pharmacy: {
        name: pharmacyName,
        address,
        city,
        province: "Ontario",
        postal_code: postalCode,
        phone,
        fax,
      },
      p_profile: {
        full_name: fullName,
        email,
        province: "Ontario",
      },
    })

    if (rpcError) {
      return { error: "Account created but pharmacy setup failed. Please contact support." }
    }
  }

  await logAuditEvent("auth.signup", { pharmacy_name: pharmacyName })
  revalidatePath("/", "layout")
  redirect("/")
}
```

Do NOT touch other functions in `auth-actions.ts` (`login`, `signupWithInvite`, `logout`, `createInvitation`, `forgotPassword`, `resetPassword`, `changePassword`, `changeEmail`). Task 4 rewrites `signupWithInvite`; Task 7 wires rate-limit checks. They're separate tasks.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cdst-app && npm test -- src/__tests__/auth-actions.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 5: Run the full test suite**

```bash
cd cdst-app && npm test
```
Expected: all green. If anything else broke, fix the implementation (not the tests) and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth-actions.ts src/__tests__/auth-actions.test.ts
git commit -m "fix(auth): signup uses create_pharmacy_owner RPC for atomic DB inserts (audit #6)"
```

---

## Task 4: TDD — Atomic invite claim in `signupWithInvite` (Fix 5)

**Files:**
- Modify: `src/__tests__/auth-actions.test.ts` (extend)
- Modify: `src/lib/auth-actions.ts` (`signupWithInvite` only)

- [ ] **Step 1: Verify `invitations.accepted_at` is nullable**

Call MCP `supabase_execute_sql`:
```sql
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'invitations' AND column_name = 'accepted_at';
```
Expected: `is_nullable = 'YES'`. If `NO`, apply a quick migration via MCP `supabase_apply_migration` first:
```sql
ALTER TABLE public.invitations ALTER COLUMN accepted_at DROP NOT NULL;
```
Save as `supabase/migrations/<ts>_invitations_accepted_at_nullable.sql`. Commit before proceeding.

- [ ] **Step 2: Write the failing tests**

Append to `src/__tests__/auth-actions.test.ts`:

```typescript
import { signupWithInvite } from "@/lib/auth-actions"

function mockInviteClaimSupabase(opts: {
  claimData?: { pharmacy_id: string; email: string } | null
  claimError?: object | null
  signUpError?: boolean
  signUpUser?: { id: string } | null
}) {
  const claimSingle = vi.fn().mockResolvedValue({
    data: opts.claimData === undefined ? null : opts.claimData,
    error: opts.claimError === undefined ? { code: "PGRK116" } : opts.claimError,
  })

  const releaseUpdate = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  const signUp = vi.fn().mockResolvedValue(
    opts.signUpError
      ? { data: { user: null }, error: { message: "Sign-up failed" } }
      : { data: { user: opts.signUpUser ?? { id: "u-invite" } }, error: null }
  )

  const profilesUpsert = {
    upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
  const membersInsert = {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  const invitationsChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: claimSingle,
  }

  const invitationsReleaseChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }

  const from = vi.fn((table: string) => {
    if (table === "invitations") {
      // First call to invitations is always the claim (via the long chain).
      // Subsequent calls are releases (short .update().eq() chains).
      // Use a call counter to disambiguate.
      fromCalls[table] = (fromCalls[table] ?? 0) + 1
      return fromCalls[table] === 1 ? invitationsChain : invitationsReleaseChain
    }
    if (table === "profiles") return profilesUpsert
    if (table === "pharmacy_members") return membersInsert
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })
  const fromCalls: Record<string, number> = {}

  const supabase = {
    auth: { signUp },
    from,
  }

  vi.mocked(createClient).mockResolvedValue(supabase as any)
  return { supabase, claimSingle, signUp, invitationsChain, invitationsReleaseChain }
}

describe("signupWithInvite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns invalid-invite error when claim finds no rows (already accepted / expired / unknown)", async () => {
    const { signUp } = mockInviteClaimSupabase({ claimData: null, claimError: { code: "PGRK116" } })

    const fd = new FormData()
    fd.set("token", "tok-1")
    fd.set("email", "a@b.com")
    fd.set("password", "password123")
    fd.set("fullName", "Invitee")
    fd.set("provincialLicense", "LIC")
    fd.set("province", "Ontario")

    const result = await signupWithInvite(fd)

    expect(result).toEqual({ error: "Invalid or expired invitation." })
    expect(signUp).not.toHaveBeenCalled()
  })

  it("returns email-mismatch error and releases the claim when email differs", async () => {
    const { invitationsReleaseChain, signUp } = mockInviteClaimSupabase({
      claimData: { pharmacy_id: "pharm-1", email: "right@example.com" },
      claimError: null,
    })

    const fd = new FormData()
    fd.set("token", "tok-1")
    fd.set("email", "wrong@example.com")
    fd.set("password", "password123")
    fd.set("fullName", "Invitee")
    fd.set("provincialLicense", "LIC")
    fd.set("province", "Ontario")

    const result = await signupWithInvite(fd)

    expect(result).toEqual({ error: "Email does not match the invitation." })
    expect(invitationsReleaseChain.update).toHaveBeenCalledWith({ accepted_at: null })
    expect(signUp).not.toHaveBeenCalled()
  })

  it("releases the claim and returns signUp error when auth fails", async () => {
    const { invitationsReleaseChain, signUp } = mockInviteClaimSupabase({
      claimData: { pharmacy_id: "pharm-1", email: "right@example.com" },
      claimError: null,
      signUpError: true,
    })

    const fd = new FormData()
    fd.set("token", "tok-1")
    fd.set("email", "right@example.com")
    fd.set("password", "password123")
    fd.set("fullName", "Invitee")
    fd.set("provincialLicense", "LIC")
    fd.set("province", "Ontario")

    const result = await signupWithInvite(fd)

    expect(result).toEqual({ error: "Sign-up failed" })
    expect(invitationsReleaseChain.update).toHaveBeenCalledWith({ accepted_at: null })
  })

  it("upserts profile and inserts member on full success", async () => {
    const { signUp } = mockInviteClaimSupabase({
      claimData: { pharmacy_id: "pharm-1", email: "right@example.com" },
      claimError: null,
    })

    const fd = new FormData()
    fd.set("token", "tok-1")
    fd.set("email", "right@example.com")
    fd.set("password", "password123")
    fd.set("fullName", "Invitee")
    fd.set("provincialLicense", "LIC")
    fd.set("province", "Ontario")

    const result = await signupWithInvite(fd)

    expect(result).toEqual({ success: true })
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "right@example.com",
      password: "password123",
    }))
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd cdst-app && npm test -- src/__tests__/auth-actions.test.ts
```

Expected RED:
- "returns invalid-invite error when claim finds no rows" — FAILS because current code does a SELECT (not an UPDATE-claim). The mock's claim chain (update.eq.is.gt.select.single) is never invoked; current code's select.eq.single chain returns null because the mock's `from("invitations")` returns the claim chain (which has no top-level `select`). The test asserts "Invalid or expired invitation." but current code returns "Invalid or expired invitation." only on selectError — and with no rows actually selected, current code may return a different path. Either way, RED — the current code uses a different query shape.

If any test passes against current code, the mock isn't tight enough. Re-examine.

- [ ] **Step 4: Implement the fix**

Replace `signupWithInvite` (currently `src/lib/auth-actions.ts:96-165`) with:

```typescript
export async function signupWithInvite(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string
  const provincialLicense = formData.get("provincialLicense") as string
  const province = formData.get("province") as string
  const token = formData.get("token") as string

  const { data: invite, error: claimError } = await supabase
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("pharmacy_id, email")
    .single()

  if (claimError || !invite) {
    return { error: "Invalid or expired invitation." }
  }

  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    await supabase
      .from("invitations")
      .update({ accepted_at: null })
      .eq("token", token)
    return { error: "Email does not match the invitation." }
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: "pharmacist",
        provincial_license: provincialLicense,
        province,
        pharmacy_id: invite.pharmacy_id,
      },
    },
  })

  if (authError) {
    await supabase
      .from("invitations")
      .update({ accepted_at: null })
      .eq("token", token)
    return { error: authError.message }
  }

  if (authData.user) {
    await supabase.from("profiles").upsert({
      id: authData.user.id,
      pharmacy_id: invite.pharmacy_id,
      full_name: fullName,
      email,
      province,
      provincial_license: provincialLicense,
    })
    await supabase.from("pharmacy_members").insert({
      user_id: authData.user.id,
      pharmacy_id: invite.pharmacy_id,
      role: "pharmacist",
    })
  }

  revalidatePath("/", "layout")
  return { success: true }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd cdst-app && npm test -- src/__tests__/auth-actions.test.ts
```
Expected: all tests in both `signup` and `signupWithInvite` describe blocks pass.

- [ ] **Step 6: Run the full suite**

```bash
cd cdst-app && npm test
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth-actions.ts src/__tests__/auth-actions.test.ts
git commit -m "fix(security): atomic invite claim eliminates TOCTOU race (audit #5)"
```

---

## Task 5: Migration — `rate_limits` table + `check_rate_limit` RPC (Fix 8 prerequisite)

**Files:**
- Apply via MCP `supabase_apply_migration`
- Create: `supabase/migrations/<ts>_rate_limits.sql`

- [ ] **Step 1: Apply the migration via MCP**

Call `supabase_apply_migration` with:
- `name`: `rate_limits`
- `query`:
```sql
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key           text NOT NULL,
  bucket_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limits_no_access ON public.rate_limits;
CREATE POLICY rate_limits_no_access ON public.rate_limits
  FOR ALL TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key       text,
  p_window_ms bigint,
  p_max       integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now        timestamptz := now();
  v_bucket     timestamptz;
  v_count      integer;
BEGIN
  v_bucket := to_timestamp(
    (extract(epoch from v_now)::bigint / (p_window_ms / 1000)) * (p_window_ms / 1000)
  );

  INSERT INTO public.rate_limits (key, bucket_start, count)
  VALUES (p_key, v_bucket, 1)
  ON CONFLICT (key, bucket_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;
```

- [ ] **Step 2: Save migration file**

Path: `supabase/migrations/<ts>_rate_limits.sql`. Contents = the SQL from Step 1, prefixed with:
```sql
-- Migration: rate_limits
-- Fixed-window rate-limit counters. RLS denies all direct access from
-- authenticated/anon; writes go through check_rate_limit SECURITY DEFINER.
-- Closes audit item #8 (no rate limiting on auth endpoints).
-- Source: docs/superpowers/specs/2026-06-14-high-security-fixes-design.md
```

- [ ] **Step 3: Verify table + function**

Call MCP `supabase_execute_sql`:
```sql
SELECT c.column_name, c.data_type, c.is_nullable
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.table_name='rate_limits'
ORDER BY c.ordinal_position;
```
Expected: 3 rows (key text, bucket_start timestamptz, count integer).

Then:
```sql
SELECT p.proname, p.prosecdef,
       pg_get_functiondef(p.oid) LIKE '%SET search_path = ''%' as has_pin
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' AND p.proname = 'check_rate_limit';
```
Expected: one row, `prosecdef = true`, `has_pin = true`.

- [ ] **Step 4: Smoke test the function**

Call MCP `supabase_execute_sql`:
```sql
SELECT public.check_rate_limit('smoke-test', 60000, 2) as attempt1,
       public.check_rate_limit('smoke-test', 60000, 2) as attempt2,
       public.check_rate_limit('smoke-test', 60000, 2) as attempt3;
```
Expected: `attempt1 = t`, `attempt2 = t`, `attempt3 = f`.

Clean up:
```sql
DELETE FROM public.rate_limits WHERE key = 'smoke-test';
```

- [ ] **Step 5: Run advisors**

Call MCP `supabase_get_advisors` type `security`. Expected: still 13 baseline lints, no new ones on `check_rate_limit` or `rate_limits`.

If `function_search_path_mutable` appears, the `SET search_path = ''` didn't take — fix and re-verify.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): rate_limits table + check_rate_limit SECURITY DEFINER"
```

---

## Task 6: TDD — `rate-limit.ts` helper (Fix 8)

**Files:**
- Create: `src/__tests__/rate-limit.test.ts`
- Create: `src/lib/rate-limit.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/rate-limit.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

import { checkRateLimit, enforceRateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

function mockRpc(result: boolean | null) {
  const rpc = vi.fn().mockResolvedValue({ data: result, error: null })
  vi.mocked(createClient).mockResolvedValue({ rpc } as any)
  return rpc
}

describe("checkRateLimit", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns true when RPC returns true", async () => {
    const rpc = mockRpc(true)
    const result = await checkRateLimit("login:1.2.3.4:a@b.com", 10, 60_000)
    expect(result).toBe(true)
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "login:1.2.3.4:a@b.com",
      p_window_ms: 60_000,
      p_max: 10,
    })
  })

  it("returns false when RPC returns false", async () => {
    mockRpc(false)
    const result = await checkRateLimit("k", 5, 1000)
    expect(result).toBe(false)
  })

  it("returns false when RPC returns null (defensive fail-closed)", async () => {
    mockRpc(null)
    const result = await checkRateLimit("k", 5, 1000)
    expect(result).toBe(false)
  })
})

describe("enforceRateLimit", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns null when under cap", async () => {
    mockRpc(true)
    const result = await enforceRateLimit("k", 10, 60_000)
    expect(result).toBeNull()
  })

  it("returns standard error object when at/over cap", async () => {
    mockRpc(false)
    const result = await enforceRateLimit("k", 10, 60_000)
    expect(result).toEqual({ error: "Too many attempts. Please try again later." })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cdst-app && npm test -- src/__tests__/rate-limit.test.ts
```
Expected: tests FAIL with import error (file doesn't exist yet) or `undefined is not a function`. RED for the right reason.

- [ ] **Step 3: Implement the helper**

Create `src/lib/rate-limit.ts`:
```typescript
import { createClient } from "@/lib/supabase/server"

export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_window_ms: windowMs,
    p_max: max,
  })
  return data === true
}

export async function enforceRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<{ error: string } | null> {
  const ok = await checkRateLimit(key, max, windowMs)
  return ok ? null : { error: "Too many attempts. Please try again later." }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cdst-app && npm test -- src/__tests__/rate-limit.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Run the full suite**

```bash
cd cdst-app && npm test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rate-limit.ts src/__tests__/rate-limit.test.ts
git commit -m "feat(security): rate-limit helper wrapping check_rate_limit RPC (audit #8)"
```

---

## Task 7: Wire rate-limit checks into auth actions + login API route (Fix 8)

**Files:**
- Modify: `src/lib/auth-actions.ts` (top of `login`, `signup`, `signupWithInvite`, `forgotPassword`)
- Modify: `src/app/api/auth/login/route.ts` (top of `POST`)

**No new tests** — the call sites are thin (one-liner guards). The behavior is verified by Task 6's helper tests plus the existing server-action tests, which still pass (the rate-limit mock returns `null` for `enforceRateLimit` by default if you mock the module — but we won't bother, since the existing tests don't import `rate-limit` and the live RPC won't fire in tests anyway because no real DB call reaches the helper). The risk is low because the guards are pure early-returns.

(If existing tests start failing because they invoke `enforceRateLimit` which tries to call the real `createClient`, the existing `createClient` mocks already intercept the call — `supabase.rpc` will be undefined on the mock and the helper will throw. In that case, add a `vi.mock("@/lib/rate-limit", ...)` to the auth-actions test file. Verify before assuming.)

- [ ] **Step 1: Add an IP-extraction helper inline**

Add at the top of `src/lib/auth-actions.ts` (after the existing imports):
```typescript
import { enforceRateLimit } from "@/lib/rate-limit"
import { headers } from "next/headers"

function getClientIp(): string {
  const h = headers()
  return h.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? h.get("x-real-ip")?.trim()
    ?? "unknown"
}
```

(`headers()` is synchronous in Next 15+. If the project is on an older Next where it returns a Promise, switch to `await headers()` and make `getClientIp` async. Check `next.config.ts`/package.json — Next 16.2.6, so sync is correct.)

- [ ] **Step 2: Wire rate-limit into `login`**

At the top of the `login` function body (`auth-actions.ts`), right after `const supabase = await createClient()`:

```typescript
const ip = getClientIp()
const limited = await enforceRateLimit(`login:${ip}:${formData.get("email")}`, 10, 60_000)
if (limited) return limited
```

- [ ] **Step 3: Wire rate-limit into `signup`**

At the top of the `signup` function body, right after `const supabase = await createClient()`:

```typescript
const ip = getClientIp()
const limited = await enforceRateLimit(`signup:${ip}`, 5, 300_000)
if (limited) return limited
```

- [ ] **Step 4: Wire rate-limit into `signupWithInvite`**

At the top of the `signupWithInvite` function body:

```typescript
const ip = getClientIp()
const limited = await enforceRateLimit(`invite:${ip}:${formData.get("token")}`, 5, 300_000)
if (limited) return limited
```

- [ ] **Step 5: Wire rate-limit into `forgotPassword`**

At the top of the `forgotPassword` function body:

```typescript
const ip = getClientIp()
const limited = await enforceRateLimit(`forgot:${ip}:${formData.get("email")}`, 3, 300_000)
if (limited) return limited
```

- [ ] **Step 6: Wire rate-limit into login API route**

Modify `src/app/api/auth/login/route.ts`. Add at the top of the `POST` function, after the JSON parse:

```typescript
import { createClient } from "@/lib/supabase/server"
import { enforceRateLimit } from "@/lib/rate-limit"

// ...inside POST, after const { email, password } = await request.json():
const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  ?? request.headers.get("x-real-ip")?.trim()
  ?? "unknown"
const limited = await enforceRateLimit(`login:${ip}:${email}`, 10, 60_000)
if (limited) return NextResponse.json(limited, { status: 429 })
```

Use the existing `NextResponse` import. Don't re-import `createClient` if it's already imported — check first.

- [ ] **Step 7: Run typecheck**

```bash
cd cdst-app && npx tsc --noEmit
```
Expected: same baseline (4 pre-existing test-fixture errors). No new errors.

If existing auth-action tests fail because they invoke the real `enforceRateLimit` → real `createClient` (not mocked in those tests), add to `src/__tests__/auth-actions.test.ts`:
```typescript
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
}))
```
Place near the other `vi.mock` calls.

- [ ] **Step 8: Run the full test suite**

```bash
cd cdst-app && npm test
```
Expected: all green. If failures, fix the test setup (not the implementation).

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth-actions.ts src/app/api/auth/login/route.ts src/__tests__/auth-actions.test.ts
git commit -m "feat(security): wire rate-limit checks into auth endpoints (audit #8)"
```

---

## Task 8: Add `middleware.ts` for route protection + session refresh (Fix 9)

**Agreed TDD exception:** config-style. Verified by manual integration in Task 9.

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Create the middleware**

Create `src/middleware.ts` with exactly this content:
```typescript
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"]

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return true
  if (pathname.startsWith("/invite/")) return true
  return false
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  const { data: { session } } = await supabase.auth.getSession()

  const publicPath = isPublicPath(request.nextUrl.pathname)

  if (!session && !publicPath) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/login"
    redirectUrl.searchParams.set("redirect", request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (session && publicPath && !request.nextUrl.pathname.startsWith("/invite/")) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/"
    return NextResponse.redirect(redirectUrl)
  }

  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)",
  ],
}
```

- [ ] **Step 2: Run typecheck + lint**

```bash
cd cdst-app && npx tsc --noEmit && npm run lint
```
Expected: no new errors tied to middleware.ts.

- [ ] **Step 3: Run the full test suite (regression guard)**

```bash
cd cdst-app && npm test
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(security): add middleware for route protection + session refresh (audit #9)"
```

---

## Task 9: Final verification

**Files:** none modified.

- [ ] **Step 1: Full local verification**

```bash
cd cdst-app && npm test && npm run lint && npx tsc --noEmit && npm run build
```
Expected: every command exits 0. Build completes successfully.

- [ ] **Step 2: Manual rate-limit smoke test**

Call MCP `supabase_execute_sql` to confirm the rate limiter still works as designed:
```sql
SELECT public.check_rate_limit('verify-test', 60000, 2) as a1,
       public.check_rate_limit('verify-test', 60000, 2) as a2,
       public.check_rate_limit('verify-test', 60000, 2) as a3;
```
Expected: `t, t, f`. Then clean up:
```sql
DELETE FROM public.rate_limits WHERE key = 'verify-test';
```

- [ ] **Step 3: Manual middleware integration test**

```bash
cd cdst-app && npm run dev
```

In another terminal:
```bash
curl -i -s http://localhost:3000/ | head -1
```
Expected: `HTTP/1.1 307` redirect to `/login`.

```bash
curl -i -s http://localhost:3000/login | head -1
```
Expected: `HTTP/1.1 200` (or 307 to `/` if you have a valid session cookie — clear cookies first to test the unauthenticated case).

```bash
curl -i -s http://localhost:3000/invite/anytoken | head -1
```
Expected: `HTTP/1.1 200` (invite page renders without auth).

- [ ] **Step 4: Manual invite-flow test (optional, needs a real invite)**

Generate an invite via the team UI, copy the link, attempt to sign up with it twice concurrently (two browsers/tabs). Confirm only one succeeds; the other gets "Invalid or expired invitation." without creating a duplicate account.

- [ ] **Step 5: Run advisors one more time**

Call MCP `supabase_get_advisors` type `security`. Expected: same 13 baseline lints, zero new.

- [ ] **Step 6: Branch summary**

```bash
git log --oneline main..fix/high-security-5-9
git diff main..fix/high-security-5-9 --stat
```
Capture commit list and stat.

Do NOT push, merge, or amend. Report and surface merge decision to user.

---

## Self-Review Notes

- **Spec coverage:** Each of the five High findings maps to ≥1 task. Fix 5 → Task 4. Fix 6 → Tasks 2 + 3. Fix 7 → Task 1. Fix 8 → Tasks 5 + 6 + 7. Fix 9 → Task 8. Task 9 is verification.
- **TDD:** Tasks 3, 4, 6 follow red-green strictly. Tasks 1, 7, 8 are deletion / wiring / config (agreed exceptions), with regression coverage via the full test suite.
- **Type consistency:** RPC parameter names (`p_user_id`, `p_pharmacy`, `p_profile` in Fix 6; `p_key`, `p_window_ms`, `p_max` in Fix 8) match between the SQL function signatures and the TS call sites.
- **Ordering rationale:** Task 1 first because Fix 7 is pure deletion. Tasks 2/3 (Fix 6) and Task 4 (Fix 5) are independent and can be done in any order, but 6 before 5 keeps auth-actions edits sequential. Tasks 5/6/7 (Fix 8) come next. Task 8 (Fix 9 middleware) is independent and comes last so its integration test in Task 9 reflects the final state.
- **Mock-shape risk:** Task 4's invite claim has a long `.update().eq().is().gt().select().single()` chain. The mock handles first-call vs subsequent-call distinction via a per-table counter so the release path doesn't collide with the claim path. Verified the chain shape against the actual supabase-js API.
