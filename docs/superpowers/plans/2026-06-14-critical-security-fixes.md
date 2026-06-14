# Critical Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four Critical findings from the 2026-06-14 security audit (tier bypass, unscoped audit-log read, hardcoded insecure cookie flag, broken cookie spread).

**Architecture:** Three server-side patches plus one DB migration. Fixes 1 & 2 are behavior changes covered by TDD unit tests using the existing mock-`createClient` pattern (`src/__tests__/audit-actions.test.ts`). Fixes 3 & 4 delete broken manual cookie overrides so `@supabase/ssr` attaches correct attributes; verified by response inspection, not unit test (per agreed exception in the design spec).

**Tech Stack:** Next.js 16 (App Router, server actions), `@supabase/ssr` 0.10.3, Vitest 4, Supabase Postgres (cloud, ca-central-1).

**Spec:** `docs/superpowers/specs/2026-06-14-critical-security-fixes-design.md`

---

## File Structure

| Path | Purpose |
|------|---------|
| `supabase/migrations/2026XXXX0001_profiles_subscription_tier.sql` | New — DDL for tier column. |
| `src/lib/pharmacy-actions.ts` | Modified — `addPharmacy` reads tier from profile. |
| `src/lib/audit-actions.ts` | Modified — `getAuditLog` adds auth + pharmacy scope. |
| `src/app/api/auth/login/route.ts` | Modified — drop `secure: false`; preserve attrs. |
| `src/app/api/auth/signup/route.ts` | Modified — replace `c as any` with correct spread. |
| `src/app/api/auth/logout/route.ts` | Modified — replace `c as any` with correct spread. |
| `src/__tests__/pharmacy-actions.test.ts` | New — TDD for `addPharmacy` tier logic. |
| `src/__tests__/audit-actions.test.ts` | Extended — TDD for `getAuditLog` authz. |

---

## Task 1: Verify existing RLS and add `profiles.subscription_tier` column

**Why first:** Fix 1 depends on this column. RLS verification was outstanding in the audit; do it once here so the new column inherits correct policies.

**Files:**
- Run SQL via MCP `supabase_execute_sql` (verification)
- Apply via MCP `supabase_apply_migration` (DDL)
- Create: `supabase/migrations/2026XXXX0001_profiles_subscription_tier.sql`

- [ ] **Step 1: Inspect existing profiles policies**

Run via MCP `supabase_execute_sql`:
```sql
SELECT polname, polcmd, qual, with_check
FROM pg_policy
WHERE polrelid = 'public.profiles'::regclass;
```
Record output. We need to confirm: (a) a SELECT policy allows users to read their own row, (b) the UPDATE policy's `with_check` does NOT permit changing `subscription_tier` (or that no UPDATE policy exists).

- [ ] **Step 2: If an UPDATE policy exists and is permissive, tighten it**

If Step 1 shows an update policy whose `with_check` allows arbitrary column writes, replace it with a column-restricted version. Skip this step if no UPDATE policy exists (default deny is safe) or if the existing `with_check` is already scoped. Document the decision in the migration file's comments.

- [ ] **Step 3: Apply the migration via MCP**

Call `supabase_apply_migration` with name `profiles_subscription_tier` and query:
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'basic';

COMMENT ON COLUMN public.profiles.subscription_tier IS
  'Per-user plan tier: basic | pro | enterprise. Source of truth for seat limits. Set via service-role only.';

-- Belt-and-suspenders: prevent authenticated/anon from updating this column
-- directly, regardless of any future permissive UPDATE policy on profiles.
REVOKE UPDATE (subscription_tier) ON public.profiles FROM authenticated, anon;
```

- [ ] **Step 4: Save the migration file for history**

Create `supabase/migrations/2026XXXX0001_profiles_subscription_tier.sql` (replace `2026XXXX0001` with the timestamp `supabase_apply_migration` returns) containing the exact SQL from Step 3. This is for repo history; the live DB was mutated in Step 3.

- [ ] **Step 5: Verify column exists and RLS still passes**

Run via MCP `supabase_execute_sql`:
```sql
SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' AND column_name='subscription_tier';
```
Expect one row: `subscription_tier | text | 'basic'::text`.

Then call MCP `supabase_get_advisors` with type `security`. Expect empty `lints` array.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): add profiles.subscription_tier column for plan limits"
```

---

## Task 2: TDD — `addPharmacy` tier bypass fix

**Files:**
- Create: `src/__tests__/pharmacy-actions.test.ts`
- Modify: `src/lib/pharmacy-actions.ts:64-128` (`addPharmacy` function)

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/pharmacy-actions.test.ts`:
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
  redirect: vi.fn((path: string) => {
    // Next's redirect throws a NEXT_REDIRECT; for tests we just resolve.
    return undefined
  }),
}))

import { addPharmacy } from "@/lib/pharmacy-actions"
import { createClient } from "@/lib/supabase/server"

type Chain = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  data: unknown
}

function mockSupabase(opts: {
  userId?: string | null
  subscriptionTier?: string
  ownerCount?: number
}) {
  const userId = opts.userId ?? "u-1"
  const profilesSingle = vi
    .fn()
    .mockResolvedValue({ data: { subscription_tier: opts.subscriptionTier ?? "basic" }, error: null })

  const membersCountRange = vi
    .fn()
    .mockResolvedValue({ count: opts.ownerCount ?? 0, error: null })

  // members.select(...).eq(...).eq(...).eq(...).select head/range shape:
  // mimic the { count, head: true } call by returning count on first await.
  const membersChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    range: membersCountRange,
  }

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: profilesSingle }),
        }),
      }
    }
    if (table === "pharmacy_members") {
      return membersChain
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  const supabase = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId === null ? null : { id: userId } } }),
    },
    from,
  }

  vi.mocked(createClient).mockResolvedValue(supabase as any)
  return supabase
}

describe("addPharmacy — tier enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("caps basic-tier user at 1 owned pharmacy", async () => {
    mockSupabase({ subscriptionTier: "basic", ownerCount: 1 })

    const fd = new FormData()
    fd.set("name", "Shoppers")
    fd.set("address", "1 Main")
    fd.set("city", "Toronto")
    fd.set("province", "Ontario")
    fd.set("postalCode", "M5V1A1")
    fd.set("phone", "4165551234")

    const result = await addPharmacy(undefined, fd)

    expect(result).toEqual({
      error: "Your plan allows 1 pharmacies. Upgrade to add more.",
    })
  })

  it("ignores client-supplied tier in formData", async () => {
    mockSupabase({ subscriptionTier: "basic", ownerCount: 1 })

    const fd = new FormData()
    fd.set("tier", "enterprise") // bypass attempt
    fd.set("name", "Shoppers")
    fd.set("address", "1 Main")
    fd.set("city", "Toronto")
    fd.set("province", "Ontario")
    fd.set("postalCode", "M5V1A1")
    fd.set("phone", "4165551234")

    const result = await addPharmacy(undefined, fd)

    expect(result).toEqual({
      error: "Your plan allows 1 pharmacies. Upgrade to add more.",
    })
  })

  it("defaults to basic when profile tier is missing", async () => {
    mockSupabase({ subscriptionTier: undefined as unknown as string, ownerCount: 1 })

    const fd = new FormData()
    fd.set("name", "Shoppers")
    fd.set("address", "1 Main")
    fd.set("city", "Toronto")
    fd.set("province", "Ontario")
    fd.set("postalCode", "M5V1A1")
    fd.set("phone", "4165551234")

    const result = await addPharmacy(undefined, fd)

    expect(result).toEqual({
      error: "Your plan allows 1 pharmacies. Upgrade to add more.",
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cdst-app && npm test -- src/__tests__/pharmacy-actions.test.ts
```
Expected: 3 tests FAIL. Reasons:
- "caps basic-tier user at 1 owned pharmacy" — fails because the current code reads `tier` from formData, so when count=1 and tier=undefined → limit=1, count(1) >= limit(1) → returns the error. **Check:** if this test passes against the buggy code, that's coincidence. Verify the second test fails for the right reason.
- "ignores client-supplied tier in formData" — fails because current code reads `formData.get("tier") = "enterprise"` → `TIER_LIMITS["enterprise"] = Infinity` → `1 >= Infinity` is false → proceeds past the cap → calls `supabase.from("pharmacies").insert(...)` which is mocked to return undefined → returns `{ error: "Failed to create pharmacy." }`. So the failure reason is "expected error 'Your plan allows...', received 'Failed to create pharmacy.'". **This is the bug, demonstrated.**
- "defaults to basic when profile tier is missing" — fails same as first.

If any test passes immediately, stop and rewrite it — TDD requires watching the test fail for the right reason.

- [ ] **Step 3: Implement the fix in `src/lib/pharmacy-actions.ts`**

Replace lines 64–80 of `addPharmacy` (the auth check + formData tier read + count). The new shape:

```typescript
export async function addPharmacy(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier")
    .eq("id", user.id)
    .single()

  const tier = profile?.subscription_tier ?? "basic"
  const limit = TIER_LIMITS[tier] ?? 1

  const { count } = await supabase
    .from("pharmacy_members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("role", "owner")
    .eq("is_active", true)

  if ((count ?? 0) >= limit) {
    return { error: `Your plan allows ${limit} pharmacies. Upgrade to add more.` }
  }

  // ...rest of function unchanged (pharmacies insert, members insert, etc.)
```

Leave everything from line 82 onward (the `name`/`address`/`city` formData reads, the pharmacies insert, the pharmacy_members insert, the profiles update, the logAuditEvent call, the revalidatePath, the redirect) exactly as-is.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cdst-app && npm test -- src/__tests__/pharmacy-actions.test.ts
```
Expected: 3 tests PASS. If any fail, fix the implementation (not the test) and re-run.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
cd cdst-app && npm test
```
Expected: all green. If anything else broke, fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pharmacy-actions.ts src/__tests__/pharmacy-actions.test.ts
git commit -m "fix(authz): read plan tier from profiles, not formData (audit #1)"
```

---

## Task 3: TDD — `getAuditLog` authz scoping

**Files:**
- Modify: `src/__tests__/audit-actions.test.ts` (extend `getAuditLog` describe block)
- Modify: `src/lib/audit-actions.ts:37-46` (`getAuditLog` function)

- [ ] **Step 1: Extend the failing tests**

In `src/__tests__/audit-actions.test.ts`, replace the existing `getAuditLog` describe block (lines 36–52) with:

```typescript
describe("getAuditLog", () => {
  function mockAuditSupabase(opts: {
    userId?: string | null
    pharmacyId?: string | null
    isPlatformAdmin?: boolean
  }) {
    const userId = opts.userId === undefined ? "u-1" : opts.userId

    const profilesSingle = vi.fn().mockResolvedValue({
      data: opts.userId === null ? null : {
        pharmacy_id: opts.pharmacyId ?? "pharm-A",
        is_platform_admin: opts.isPlatformAdmin ?? false,
      },
      error: null,
    })

    const auditRange = vi.fn().mockResolvedValue({ data: [], error: null })
    const auditEq = vi.fn().mockReturnValue({ range: auditRange })

    const auditSelect = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        range: auditRange,
        eq: auditEq,
      }),
    })
    const auditFrom = vi.fn().mockReturnValue({ select: auditSelect })

    const profilesSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ single: profilesSingle }),
    })
    const profilesFrom = vi.fn().mockReturnValue({ select: profilesSelect })

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: userId === null ? null : { id: userId } },
        }),
      },
      schema: vi.fn((schema: string) => {
        if (schema === "audit") return { from: auditFrom }
        return { from: profilesFrom }
      }),
    }

    vi.mocked(createClient).mockResolvedValue(supabase as any)

    return { supabase, auditRange, auditEq }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns [] when no authenticated user", async () => {
    mockAuditSupabase({ userId: null })
    const result = await getAuditLog(50, 0)
    expect(result).toEqual([])
  })

  it("returns [] when profile lookup fails", async () => {
    mockAuditSupabase({ userId: "u-1" })
    // profile is null → expect []
    const result = await getAuditLog(50, 0)
    expect(result).toEqual([])
  })

  it("filters by caller's pharmacy_id for non-admin", async () => {
    const { auditEq } = mockAuditSupabase({
      userId: "u-1",
      pharmacyId: "pharm-A",
      isPlatformAdmin: false,
    })
    await getAuditLog(50, 0)
    expect(auditEq).toHaveBeenCalledWith("pharmacy_id", "pharm-A")
  })

  it("does not filter for platform admin", async () => {
    const { auditEq } = mockAuditSupabase({
      userId: "admin-1",
      pharmacyId: "pharm-A",
      isPlatformAdmin: true,
    })
    await getAuditLog(50, 0)
    expect(auditEq).not.toHaveBeenCalled()
  })

  it("preserves original query shape (range + order)", async () => {
    const { auditRange } = mockAuditSupabase({
      userId: "admin-1",
      isPlatformAdmin: true,
    })
    await getAuditLog(25, 50)
    expect(auditRange).toHaveBeenCalledWith(50, 74)
  })
})
```

Also remove the old top-level `describe("getAuditLog"` test ("queries audit.log with correct params") — it asserts behavior we're changing.

Add `beforeEach` import if not present (already imported in the file's existing `vi` import — verify).

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd cdst-app && npm test -- src/__tests__/audit-actions.test.ts
```
Expected: new tests FAIL:
- "returns [] when no authenticated user" — current code doesn't check user; returns `[]` from the query result anyway. May pass coincidentally. If it passes, that's fine — the test still documents correct behavior; move on to the failing ones.
- "filters by caller's pharmacy_id for non-admin" — FAILS because current code never calls `.eq("pharmacy_id", ...)` on the audit query. **This is the bug, demonstrated.**
- "does not filter for platform admin" — same root cause; passes or fails depending on mock shape.
- "preserves original query shape" — should pass against current code (good — proves we didn't break pagination).

At least one of the filter tests must fail for the right reason. If all pass, the test is wrong — rewrite.

- [ ] **Step 3: Implement the fix in `src/lib/audit-actions.ts`**

Replace `getAuditLog` (lines 37–46) with:

```typescript
export async function getAuditLog(limit = 100, offset = 0) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase
    .from("profiles")
    .select("pharmacy_id, is_platform_admin")
    .eq("id", user.id)
    .single()

  if (!profile) return []

  let query = supabase
    .schema("audit")
    .from("log")
    .select("id, event_type, actor_id, pharmacy_id, resource_type, resource_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (!profile.is_platform_admin) {
    query = query.eq("pharmacy_id", profile.pharmacy_id)
  }

  const { data } = await query
  return data ?? []
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd cdst-app && npm test -- src/__tests__/audit-actions.test.ts
```
Expected: all `getAuditLog` tests PASS. `logAuditEvent` tests still pass (unchanged).

- [ ] **Step 5: Run full suite**

```bash
cd cdst-app && npm test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audit-actions.ts src/__tests__/audit-actions.test.ts
git commit -m "fix(authz): scope getAuditLog to caller's pharmacy (audit #2)"
```

---

## Task 4: Fix login cookie `secure: false`

**Agreed TDD exception:** config-style fix (delete manual override, let library set attributes). Verified by response inspection in Task 6.

**Files:**
- Modify: `src/app/api/auth/login/route.ts:14-26`

- [ ] **Step 1: Replace the manual cookie copy block**

In `src/app/api/auth/login/route.ts`, replace lines 14–26 (the `cookieResponse` fetch + `forEach` block) with:

```typescript
  const cookieResponse = getResponseWithCookies()
  if (!cookieResponse) {
    return NextResponse.json({ success: true })
  }

  const response = NextResponse.json({ success: true })
  cookieResponse.cookies.getAll().forEach((c) => {
    response.cookies.set(c.name, c.value, c)
  })
  return response
```

Key change: drop `{ path: "/", sameSite: "lax", httpOnly: true, secure: false }` and pass `c` (the full ResponseCookie descriptor populated by `@supabase/ssr`) as the options argument. `c` already carries the correct `Secure`/`SameSite`/`HttpOnly` attributes for the environment.

The final file should look like:

```typescript
import { createRouteHandlerClient } from "@/lib/supabase/route-handler"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const { email, password } = await request.json()
  const { supabase, getResponseWithCookies } = await createRouteHandlerClient()

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const cookieResponse = getResponseWithCookies()
  if (!cookieResponse) {
    return NextResponse.json({ success: true })
  }

  const response = NextResponse.json({ success: true })
  cookieResponse.cookies.getAll().forEach((c) => {
    response.cookies.set(c.name, c.value, c)
  })
  return response
}
```

- [ ] **Step 2: Run typecheck + lint**

```bash
cd cdst-app && npx tsc --noEmit && npm run lint
```
Expected: no errors. `c` is assignable to the `ResponseCookie` options partial that `cookies.Set` accepts — no `as any` needed.

- [ ] **Step 3: Run full test suite (regression guard)**

```bash
cd cdst-app && npm test
```
Expected: all green. (No tests cover this route directly; this step guards against accidental import breakage.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/login/route.ts
git commit -m "fix(security): drop secure:false override on login cookie (audit #3)"
```

---

## Task 5: Fix cookie spread bug in signup & logout routes

**Files:**
- Modify: `src/app/api/auth/signup/route.ts:35-39`
- Modify: `src/app/api/auth/logout/route.ts:12-16`

- [ ] **Step 1: Fix signup route**

In `src/app/api/auth/signup/route.ts`, replace lines 35–39:
```typescript
  if (cookieResponse) {
    cookieResponse.cookies.getAll().forEach((c) => {
      response.cookies.set(c.name, c.value, c as any)
    })
  }
```
with:
```typescript
  if (cookieResponse) {
    cookieResponse.cookies.getAll().forEach((c) => {
      response.cookies.set(c.name, c.value, c)
    })
  }
```
Only change: drop `as any`. `c` is already a valid options object; the cast was masking a type mismatch that doesn't actually exist.

- [ ] **Step 2: Fix logout route**

In `src/app/api/auth/logout/route.ts`, replace lines 12–16 with the same correction — drop `as any`:
```typescript
  if (cookieResponse) {
    cookieResponse.cookies.getAll().forEach((c) => {
      response.cookies.set(c.name, c.value, c)
    })
  }
```

- [ ] **Step 3: Run typecheck + lint + tests**

```bash
cd cdst-app && npx tsc --noEmit && npm run lint && npm test
```
Expected: clean. All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/signup/route.ts src/app/api/auth/logout/route.ts
git commit -m "fix(security): correct cookie option spread in signup/logout (audit #4)"
```

---

## Task 6: Final verification

**Files:** none modified.

- [ ] **Step 1: Full local verification**

```bash
cd cdst-app && npm test && npm run lint && npx tsc --noEmit && npm run build
```
Expected: every command exits 0. The `build` step catches server-action / route-handler typing issues the standalone `tsc` may miss.

- [ ] **Step 2: Manual cookie verification (Fixes 3 & 4)**

Start the production build:
```bash
cd cdst-app && NODE_ENV=production npm start
```
In another terminal:
```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_TEST_USER@example.com","password":"YOUR_TEST_PW"}'
```
Inspect `Set-Cookie` headers in the response. Confirm every `sb-*` cookie carries: `Secure; HttpOnly; SameSite=Lax` (or `Strict`).

Repeat for `/api/auth/logout` (POST, no body) — confirm cookie flags on the cleared-session cookies.

Repeat for `/api/auth/signup` if you have a throwaway email — otherwise rely on typecheck + the login/logout verification.

If any cookie is missing `Secure` in production mode, the fix is incomplete — return to Task 4 or 5.

- [ ] **Step 3: Manual tier-bypass verification (Fix 1)**

With the app running, log in as a `basic`-tier user who already owns one pharmacy. From devtools:
```js
await fetch('/settings/pharmacy', {
  method: 'POST',
  body: new URLSearchParams({
    name: 'Bypass', address: '1 X', city: 'X',
    province: 'Ontario', postalCode: 'X', phone: 'X',
    tier: 'enterprise',
  }),
})
```
Expected response: `{ error: "Your plan allows 1 pharmacies. Upgrade to add more." }`. The `tier=enterprise` is ignored.

- [ ] **Step 4: Manual audit-log authz verification (Fix 2)**

Log in as a non-admin pharmacist in pharmacy A. From devtools, hit whatever UI surfaces the audit log (or call the server action via the team/admin page). Confirm only pharmacy A's events appear. Log in as a platform admin and confirm events from multiple pharmacies appear.

If no UI surfaces `getAuditLog` yet, this step is N/A — the unit tests in Task 3 cover the behavior. Note that in the verification summary.

- [ ] **Step 5: Verify advisors one more time**

Call MCP `supabase_get_advisors` with type `security`. Expect empty `lints`.

- [ ] **Step 6: Final commit + push**

If any documentation or comments changed during verification, commit them. Then:
```bash
git push
```

---

## Self-Review Notes

- **Spec coverage:** Each of the four Critical findings maps to exactly one task (1→Task 2, 2→Task 3, 3→Task 4, 4→Task 5). Task 1 covers the migration prerequisite called out in the spec's "Files Changed". Task 6 covers the manual verification the spec requires for Fixes 3 & 4.
- **TDD:** Tasks 2 & 3 follow red-green strictly. Tasks 4 & 5 are the agreed config-style exception, with verification moved to Task 6.
- **Type consistency:** `profile.subscription_tier` (snake_case, from DB) is read in `addPharmacy` and matches the migration's column name. `profile.pharmacy_id` / `profile.is_platform_admin` in `getAuditLog` match the existing `Profile` type and `auth-guards.ts` usage.
- **No placeholders:** Every step has runnable code or a runnable command.
