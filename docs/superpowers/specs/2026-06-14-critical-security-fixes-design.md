# Critical Security Fixes Design

## Goal

Close the four Critical findings from the 2026-06-14 security audit: tier-limit bypass, unscoped audit-log read, hardcoded insecure session cookie flag, and broken cookie-option spreading on signup/logout. Together these are the only findings rated Critical — direct exploit or direct misconfig with small, contained diffs.

## Scope

**In scope:** audit items 1–4 (Critical).

**Out of scope (parked as backlog — see Appendix A):** items 5–18 (High/Medium/Low). Each will get its own spec when prioritized.

## TDD Applicability

The user asked to evaluate TDD per fix. Assessment:

| Fix | TDD? | Rationale |
|-----|------|-----------|
| 1. Tier bypass | **Yes** | Behavior change in a server action. Existing test pattern (`__tests__/audit-actions.test.ts`) mocks `createClient` — same pattern applies to `pharmacy-actions.test.ts` (new file). Test the contract: server ignores client-sent `tier`, reads `profiles.subscription_tier`, enforces correct limit. |
| 2. getAuditLog authz | **Yes** | Behavior change in a server action. Extend `__tests__/audit-actions.test.ts`: caller in pharmacy A only sees rows with `pharmacy_id = A`; platform admin sees unfiltered. Mock `auth.getUser()` + `profiles` select. |
| 3. Cookie secure flag | **Config-style, no unit test** | Fix removes a manual override and lets `@supabase/ssr` set correct attributes. The "behavior" lives in the library, not our code. Per TDD skill's exception clause for config, no failing test first. Manual verification: hit `/api/auth/login` over HTTP in `NODE_ENV=production` and confirm `Secure` attribute on `sb-*` cookies. |
| 4. Cookie spread bug | **Config-style, no unit test** | Same fix as #3 — delete the manual `c as any` spread, let the library attach cookies via `getResponseWithCookies()`. Same exception rationale. |

Net: TDD on fixes 1 and 2. Fixes 3 and 4 are deletions of broken manual code; verified by response inspection, not unit test.

## Design

### Fix 1 — Tier-limit bypass in `addPharmacy`

**Problem.** `src/lib/pharmacy-actions.ts:76` reads the plan tier from `formData`:
```ts
const tier = (formData.get("tier") as string) || "basic"
```
A client POSTing `tier=enterprise` bypasses the seat cap and gets unlimited pharmacies.

**Source of truth (decided with user).** Add a `subscription_tier` column to `profiles`. Default `'basic'`. The profile row is the per-user plan owner. This sets up cleanly for future billing integration.

**Migration.**
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'basic';

-- Backfill not needed: DEFAULT covers existing rows.
-- Future billing writes here via service-role / admin API only.

-- RLS: users can SELECT their own tier; cannot UPDATE it.
CREATE POLICY profiles_read_own_tier ON public.profiles
  FOR SELECT TO authenticated
  USING ((select auth.uid()) = id);

-- If a profiles_update_own policy already exists, ensure its
-- WITH CHECK clause does NOT include subscription_tier in the
-- allowed set. (Verify during impl — DB was unreachable in audit.)
```

**Code change.** Replace the formData read with a profile lookup:
```ts
export async function addPharmacy(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_tier")
    .eq("id", user.id)
    .single()

  const tier: string = profile?.subscription_tier ?? "basic"
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
  // ...rest unchanged
}
```

`TIER_LIMITS` and the rest of the function are unchanged. The `tier` field is removed from the form (no `<input name="tier">` exists in the current pharmacy-add form, so no UI change needed — confirmed via grep).

### Fix 2 — Unscoped `getAuditLog`

**Problem.** `src/lib/audit-actions.ts:37` runs:
```ts
.from("log").select(...).order(...).range(...)
```
No caller identity check, no `pharmacy_id` filter. RLS on `audit.log` (per the 2026-06-06 audit-log spec) *should* restrict rows server-side, but:
- We could not verify RLS deployment (Postgres timed out during audit).
- Relying solely on RLS is not defense-in-depth.
- The action currently doesn't even confirm the caller is authenticated.

**Fix.** Make the access model explicit at the app layer:
```ts
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

Platform admin sees all rows (matches the audit-log spec's "Platform admin: Can read all pharmacies' audit entries"). Authenticated non-admins see only their pharmacy's rows. Unauthenticated callers get `[]`.

### Fix 3 — Hardcoded `secure: false` on login cookie

**Problem.** `src/app/api/auth/login/route.ts:23` manually copies cookies with `secure: false`, overriding `@supabase/ssr`'s correct defaults. Session cookie transits over plain HTTP.

**Fix.** Delete the manual copy loop. `@supabase/ssr`'s `createRouteHandlerClient` already mutates `responseToMutate` via `setAll` with proper attributes — but the route currently builds a *separate* `NextResponse.json` and copies cookies onto it. Replace with: build JSON on the cookie-bearing response directly.

```ts
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

  // Carry the auth cookies on the JSON response. Attributes (Secure,
  // SameSite, HttpOnly) were already set correctly by @supabase/ssr.
  const response = NextResponse.json({ success: true })
  cookieResponse.cookies.getAll().forEach((c) => {
    response.cookies.set(c.name, c.value, c)
  })
  return response
}
```

The `c` passed as options is a `ResponseCookie`-shaped object (name/value/path/sameSite/httpOnly/secure/etc.) — `@supabase/ssr` populated it correctly. Spreading it as options preserves every attribute. (This is the *correct* form of the spread that signup/logout get wrong — see Fix 4.)

### Fix 4 — Cookie spread bug in signup & logout

**Problem.** `src/app/api/auth/signup/route.ts:37` and `src/app/api/auth/logout/route.ts:14`:
```ts
response.cookies.set(c.name, c.value, c as any)
```
`c` here is a Next.js cookie descriptor with shape `{ name, value, ...partial-options }`. The cast to `any` hides that some attributes are present but the resulting options object is malformed — `secure`, `sameSite`, `httpOnly` may be dropped or mis-typed, producing inconsistent cookie behavior across deployments.

**Fix.** Use the same pattern as the corrected login route (Fix 3): pass `c` directly without `as any`. TypeScript will accept it because `c` matches the `ResponseCookie` options shape after `name`/`value` are destructured out by `set`.

Apply identically to:
- `src/app/api/auth/signup/route.ts` (cookie copy block)
- `src/app/api/auth/logout/route.ts` (cookie copy block)

No behavioral change beyond correctly propagating cookie attributes.

## Testing Strategy

**Unit tests (TDD, written first):**
- `src/__tests__/pharmacy-actions.test.ts` (new) — `addPharmacy`:
  - Returns limit error when `profiles.subscription_tier === 'basic'` and user already owns 1 pharmacy.
  - Returns limit error when tier is unknown (defaults to basic).
  - Ignores `formData.get("tier")` entirely (tier=enterprise in form, profile=basic → still capped).
  - Procedes when under cap.
- `src/__tests__/audit-actions.test.ts` (extend `getAuditLog` block):
  - Returns `[]` when no authenticated user.
  - Filters by caller's `pharmacy_id` for non-admin.
  - Skips filter for `is_platform_admin === true`.

Both use the existing mock-`createClient` pattern.

**Manual verification (Fixes 3 & 4):**
- `cd cdst-app && NODE_ENV=production npm run build && npm start`
- Hit `POST /api/auth/login` with valid creds over plain HTTP against `localhost`.
- Inspect `Set-Cookie` headers: `sb-...` cookies carry `Secure; HttpOnly; SameSite=Lax`.
- Repeat for `/api/auth/signup` and `/api/auth/logout`.

**Verification of Fix 1's migration:**
- `supabase db advisors` returns clean after migration.
- Manual `\d public.profiles` shows `subscription_tier` column with default `basic`.
- Existing profiles can be selected with their tier.

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_profiles_subscription_tier.sql` | New migration: add column, RLS guard. |
| `src/lib/pharmacy-actions.ts` | `addPharmacy`: read tier from `profiles`, not `formData`. |
| `src/lib/audit-actions.ts` | `getAuditLog`: add auth + pharmacy scoping. |
| `src/app/api/auth/login/route.ts` | Drop `secure: false`; preserve cookie attrs via correct spread. |
| `src/app/api/auth/signup/route.ts` | Replace `c as any` with correct spread. |
| `src/app/api/auth/logout/route.ts` | Replace `c as any` with correct spread. |
| `src/__tests__/pharmacy-actions.test.ts` | New — TDD coverage for `addPharmacy` tier logic. |
| `src/__tests__/audit-actions.test.ts` | Extend `getAuditLog` tests for authz. |

## Out of Fix Scope — Verification Outstanding

- **RLS bodies on `public.profiles`, `public.pharmacies`, `public.pharmacy_members`, `public.invitations`, `audit.log`**: Postgres timed out during audit; policy bodies not inspected. Run the SQL from the audit report and confirm ownership predicates + `WITH CHECK` clauses before or during implementation of Fix 1's migration (so the new column inherits correct policies).

---

## Appendix A — Backlog (Audit Items 5–18)

Captured here so they are not lost. Each becomes its own spec when prioritized.

### High

5. **`signupWithInvite` TOCTOU race** (`src/lib/auth-actions.ts:105-160`). Check-then-mark pattern. Fix: atomic conditional update `update({accepted_at: now}).eq("token",t).is("accepted_at",null)` + verify rowcount.
6. **Non-transactional signup** (`src/lib/auth-actions.ts:59-89`). Multi-step inserts with no transaction. Fix: wrap in Postgres RPC or compensating deletes.
7. **Duplex signup paths**. `signup` server action vs `/api/auth/signup` route. Dedupe — keep server action, delete route (or vice versa).
8. **No rate limiting** on login/signup/forgot-password/invite. Add Upstash Ratelimit or Supabase Edge Middleware.
9. **No `middleware.ts`**. Add `@supabase/ssr` `updateSession` middleware for route protection + JWT refresh.

### Medium

10. **`user_metadata` carries role + pharmacy_id** (`src/lib/auth-actions.ts:42-50, 132-138`). Move to `app_metadata` (admin API) or stop storing.
11. **`leavePharmacy` lets last owner leave** (`src/lib/pharmacy-actions.ts:130`). Block when leaver is last active owner.
12. **No team member removal action**. `team-list.tsx` renders but cannot revoke. Add `removeMember` + `changeRole` server actions (owner-gated).
13. **Verify RLS policy bodies** on `profiles`, `pharmacies`, `pharmacy_members`, `invitations`, `audit.log`. SQL in audit report. Needed to confirm client-side edits (`profile-form.tsx`, `pharmacy-form.tsx`) are actually scoped.
14. **No input validation**. Emails, names, postal codes. Add zod schemas at server-action boundaries.

### Low

15. **`.env.local` OK**. Publishable key + URL are safe to expose; gitignored. No action.
16. **Deps current**. Next 16.2.6, React 19.2.4, supabase-js 2.107, ssr 0.10.3. No action.
17. **`createInvitation` triple-calls `auth.getUser()`** (`src/lib/auth-actions.ts:181, 191, 209`). Cache once.
18. **Weak password policy**. Min 8 chars, no complexity, no breach check. Consider Supabase Auth CAPTCHA + Honeybadger integration.
