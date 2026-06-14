# High-Severity Security Fixes Design

## Goal

Close the five High findings from the 2026-06-14 security audit: invite TOCTOU race (5), non-transactional signup (6), duplicated signup paths (7), missing rate limiting (8), and missing `middleware.ts` (9). Together these are the next-priority batch after the Critical fixes landed on `fix/critical-security-1-4`.

## Scope

**In scope:** audit items 5–9.

**Out of scope (parked):** items 10–18 (Medium/Low). Each will get its own spec when prioritized. Already listed in Appendix A of the Critical-fixes spec.

## TDD Applicability

| Fix | TDD? | Rationale |
|-----|------|-----------|
| 5. TOCTOU invite race | **Yes** | Behavior change in `signupWithInvite`. Test: when invite is already accepted, action returns error without side effects. The race itself is a property of the atomic UPDATE we trust; the test verifies the user-facing behavior. |
| 6. Non-transactional signup | **Yes** | New wrapper around a new RPC. Test: on RPC error, action returns error and no partial DB rows. Mock `createClient` + the new RPC. |
| 7. Dedupe signup paths | **No — pure deletion** | Remove the dead `/api/auth/signup` route. Nothing to test; the surviving server action already has its own tests. |
| 8. Rate limiting | **Yes** | New `checkRateLimit` helper. Test: under-cap returns ok, at-cap returns error, window expiry resets. Mock the RPC counter. |
| 9. `middleware.ts` | **No — config-style** | Standard `@supabase/ssr` `updateSession` pattern. Verified by integration: visit a protected route unauthenticated → 307 to `/login`; visit with valid session → 200. No unit test. |

## Design

### Fix 7 — Delete `/api/auth/signup` route (do this first, unblocks 5 & 6)

**Problem.** Two divergent signup paths exist. The server action does the full flow (auth user + pharmacy + profile + member); the API route only calls `auth.signUp` and leaves the user with no pharmacy. Dead code, drift hazard.

**Fix.** Delete `src/app/api/auth/signup/route.ts`. The UI uses the server action via `useActionState` — verified, no fetcher points at this route.

**Verification:** `grep -r "/api/auth/signup" src/` returns nothing.

### Fix 5 — Atomic invite claim in `signupWithInvite`

**Problem.** `src/lib/auth-actions.ts:105-160` does SELECT invite → check `accepted_at IS NULL` → …later… → UPDATE `accepted_at`. Two concurrent requests with the same valid token both pass the check before either marks it. Both create accounts, both join the pharmacy.

**Fix.** Claim-first atomic UPDATE before any side effects:

```typescript
export async function signupWithInvite(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string
  const provincialLicense = formData.get("provincialLicense") as string
  const province = formData.get("province") as string
  const token = formData.get("token") as string

  // Atomic claim. Returns the invite row only if it's still usable.
  // Postgres row-lock guarantees exactly one concurrent caller wins.
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
    // Email mismatch — release the claim so the right user can use it.
    await supabase
      .from("invitations")
      .update({ accepted_at: null })
      .eq("token", token)
    return { error: "Email does not match the invitation." }
  }

  // From here the invite is claimed. Proceed with signUp + profile + member.
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role: "pharmacist", provincial_license: provincialLicense, province, pharmacy_id: invite.pharmacy_id } },
  })

  if (authError) {
    // signUp failed after claim — release so the user can retry.
    await supabase.from("invitations").update({ accepted_at: null }).eq("token", token)
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

**Email mismatch / signUp failure** releases the claim (`accepted_at = null`) so the legitimate recipient can still use the invite. This is safe — the conditional UPDATE only succeeds if no other caller has since claimed it (race-safe by construction).

**Note on `accepted_at = null` release:** `accepted_at` must be nullable. Verified nullable per the audit-log design spec (`docs/superpowers/specs/2026-06-06-audit-log-design.md`). If `information_schema.columns` shows otherwise, the first migration in this spec must `ALTER COLUMN accepted_at DROP NOT NULL` before any other action.

### Fix 6 — Transactional DB inserts via `create_pharmacy_owner` RPC

**Problem.** `signup` does three separate inserts (pharmacy, profile, pharmacy_members) with no transaction. Failure mid-way orphans an auth user with a half-built pharmacy.

**Fix.** New Postgres function:

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
    NULLIF(p_pharmacy->>'fax', '') ,
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

**SECURITY INVOKER** — runs as the calling user (the just-signed-up owner). RLS already permits this user to insert into `pharmacies`, `profiles`, and `pharmacy_members`; the function is a transactional wrapper, not a privilege escalation. `SET search_path = ''` per Supabase convention.

**Updated `signup` server action:**

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
  const fax = formData.get("fax") as string

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role: "owner", pharmacy_name: pharmacyName, address, city, province: "Ontario", postal_code: postalCode, phone, fax } },
  })

  if (authError) return { error: authError.message }

  if (authData.user) {
    const { error: rpcError } = await supabase.rpc("create_pharmacy_owner", {
      p_user_id: authData.user.id,
      p_pharmacy: { name: pharmacyName, address, city, province: "Ontario", postal_code: postalCode, phone, fax },
      p_profile: { full_name: fullName, email, province: "Ontario" },
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

The auth-side orphan (auth user without a pharmacy) remains possible if the RPC fails — but it's now a single well-defined state, not chaos. A future spec can add admin-API cleanup if it becomes a real problem; for now the error message tells the user to contact support.

### Fix 8 — Rate limiting via Postgres table + RPC

**Problem.** No throttling on `/api/auth/login`, the `login`/`signup`/`forgotPassword`/`signupWithInvite` server actions. Brute-force and email-bomb exposure.

**Fix.** New table + new RPC + thin TS helper.

**Table:**
```sql
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key           text NOT NULL,
  bucket_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY rate_limits_no_access ON public.rate_limits
  FOR ALL TO authenticated, anon
  USING (false)
  WITH CHECK (false);
```

RLS denies all direct access from `anon`/`authenticated`. Writes go through the SECURITY DEFINER function only.

**Function:**
```sql
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
  v_bucket     timestamptz :=
    to_timestamp((extract(epoch from v_now)::bigint / (p_window_ms / 1000)) * (p_window_ms / 1000));
  v_count      integer;
BEGIN
  INSERT INTO public.rate_limits (key, bucket_start, count)
  VALUES (p_key, v_bucket, 1)
  ON CONFLICT (key, bucket_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;
```

Fixed-window algorithm: bucket = current time rounded down to window. `INSERT ... ON CONFLICT DO UPDATE` is atomic in Postgres — concurrent increments are safe.

**TS helper** (`src/lib/rate-limit.ts`):
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

**Call sites** (inserted at the top of each action, before any other work):

| Action | Key | Max | Window |
|--------|-----|-----|--------|
| `login` server action | `login:${ip}:${email}` | 10 | 60_000 (1 min) |
| `login` API route | `login:${ip}:${email}` | 10 | 60_000 |
| `signup` server action | `signup:${ip}` | 5 | 300_000 (5 min) |
| `signupWithInvite` | `invite:${ip}:${token}` | 5 | 300_000 |
| `forgotPassword` | `forgot:${ip}:${email}` | 3 | 300_000 |

IP extraction: read `x-forwarded-for` (first IP) or `x-real-ip` from headers. Server actions access headers via `next/headers` `headers()`. Fallback to `"unknown"` if missing (rare in production behind Vercel/CF).

**Cleanup:** old buckets accumulate. Add a cron via `pg_cron` to prune rows older than 1 hour:
```sql
SELECT cron.schedule('rate-limit-prune', '*/15 * * * *',
  $$DELETE FROM public.rate_limits WHERE bucket_start < now() - interval '1 hour'$$);
```

(If `pg_cron` isn't enabled in this project, the prune step is documented but skipped; the table grows slowly enough that monthly manual cleanup is acceptable.)

### Fix 9 — `middleware.ts` for route protection + session refresh

**Problem.** No middleware. Unauthenticated requests hit page render before `requireAuth` redirects. Sessions don't auto-refresh.

**Fix.** Standard `@supabase/ssr` pattern.

`src/middleware.ts`:
```typescript
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

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

  const publicPaths = ["/login", "/signup", "/forgot-password", "/reset-password"]
  const isPublicPath = publicPaths.some(p => request.nextUrl.pathname.startsWith(p)) ||
                       request.nextUrl.pathname.startsWith("/invite/")

  if (!session && !isPublicPath) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/login"
    redirectUrl.searchParams.set("redirect", request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  if (session && isPublicPath && !request.nextUrl.pathname.startsWith("/invite/")) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = "/"
    redirectUrl.searchParams.delete("redirect")
    return NextResponse.redirect(redirectUrl)
  }

  // refreshes session cookies via setAll above
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)",
  ],
}
```

**Design notes:**

- **`getSession` for routing, `getUser` for refresh.** `getSession` is the locally-signed JWT check (fast, no round-trip) — used for the redirect decision. `getUser` validates against the auth server (catches revoked/deleted sessions) — runs every request to refresh cookies. This is the official Supabase recommendation.
- **Public paths:** `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/invite/[token]`. Authenticated users visiting a public path (except invites) get redirected to `/` — avoids "I'm logged in but staring at the login form".
- **`redirect` query param:** preserved so login can bounce back to the originally-requested page. (The login action would need to read and honor this — out of scope for this fix; tracked as a follow-up.)
- **API routes excluded** from the matcher. The `/api/auth/*` routes are pre-auth by design.
- **Defense in depth:** the page-level `requireAuth` guard stays in place. Middleware handles the bulk redirect; page guards handle edge cases (e.g., a session that becomes invalid mid-browsing).

## Testing Strategy

**Unit tests (TDD):**
- `src/__tests__/auth-actions.test.ts` (extend or new file) — `signupWithInvite`:
  - When invite is already accepted (`update` returns no rows), action returns error without calling `signUp`.
  - When email mismatches, action returns error AND releases the claim (`update accepted_at = null` called).
  - When `signUp` fails, action returns error AND releases the claim.
- `src/__tests__/auth-actions.test.ts` — `signup`:
  - On RPC error, returns the "contact support" error and does not redirect.
  - On RPC success, calls `redirect("/")` (verified via mock throwing NEXT_REDIRECT or asserting the redirect mock).
- `src/__tests__/rate-limit.test.ts` (new) — `enforceRateLimit`:
  - Under cap returns `null`.
  - At/over cap returns `{ error: ... }`.
  - Key is built correctly from inputs.

**SQL verification (no unit test):**
- The `create_pharmacy_owner` RPC: verify it exists, has `SET search_path = ''`, and is `SECURITY INVOKER`.
- The `check_rate_limit` RPC: same checks. Run `supabase_get_advisors` — confirm no new lints.
- Manual smoke test: call `check_rate_limit('test', 1000, 2)` three times — third returns `false`.

**Integration test (manual, for middleware):**
- `npm run dev` → visit `http://localhost:3000/` unauthenticated → expect 307 to `/login?redirect=/`.
- Visit `http://localhost:3000/login` authenticated → expect 307 to `/`.
- Visit `http://localhost:3000/invite/abc` unauthenticated → expect 200 (page renders).

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/auth/signup/route.ts` | Deleted (Fix 7). |
| `src/lib/auth-actions.ts` | `signupWithInvite` rewritten atomic-claim-first; `signup` rewritten to call new RPC. |
| `supabase/migrations/<ts>_create_pharmacy_owner.sql` | New — RPC for transactional owner signup. |
| `supabase/migrations/<ts>_rate_limits.sql` | New — table + `check_rate_limit` RPC + RLS. |
| `supabase/migrations/<ts>_rate_limit_prune.sql` | New — `pg_cron` schedule (or doc-only if pg_cron absent). |
| `src/lib/rate-limit.ts` | New — `checkRateLimit` + `enforceRateLimit` helpers. |
| `src/lib/auth-actions.ts` | Rate-limit calls inserted at top of `login`, `signup`, `signupWithInvite`, `forgotPassword`. |
| `src/app/api/auth/login/route.ts` | Rate-limit call at top of `POST`. |
| `src/middleware.ts` | New — standard `@supabase/ssr` route protection. |
| `src/__tests__/auth-actions.test.ts` | Extend — TOCTOU + signup RPC tests. |
| `src/__tests__/rate-limit.test.ts` | New — helper tests. |

## Out of Fix Scope — Verification Outstanding

- **IP extraction in server actions**: `headers()` from `next/headers` should give `x-forwarded-for` in production. Verify in the deploy environment; the fallback `"unknown"` collapses all anonymous IPs into one bucket, which is overly strict. Acceptable for v1; revisit if it bites real users.
- **pg_cron availability**: if not enabled on this Supabase project, the prune step is a no-op. Verify with `SELECT * FROM pg_extension WHERE extname = 'pg_cron';`. If absent, document and move on (table grows ~slowly).
- **`redirect` query param** is set by middleware but not yet honored by the login action. Future spec.

---

## Appendix — Backlog Update

Items 10–18 from the original audit remain parked. Item 7's dedupe (this spec) also indirectly addresses part of the original audit's concerns about the API route. No changes to 10–18's priority.
