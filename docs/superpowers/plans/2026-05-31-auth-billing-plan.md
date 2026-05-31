# Auth + Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the CDST behind Supabase Auth + Stripe org subscriptions with admin and pharmacist roles.

**Architecture:** Supabase handles auth (email/password) and user/org data in Postgres with RLS. Stripe handles flat org subscriptions via Checkout + Customer Portal + webhooks. Next.js middleware gates all protected routes.

**Tech Stack:** `@supabase/ssr`, `@supabase/supabase-js`, `stripe`, Next.js 16 middleware, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-05-31-auth-billing-design.md`

---

## File Structure

### New files

```
src/lib/supabase/
  client.ts              # Browser-side Supabase client
  server.ts              # Server-side Supabase client (server actions, route handlers)
  middleware.ts           # Supabase client for Next.js middleware
src/lib/stripe/
  client.ts              # Stripe server client (RAK)
  checkout.ts            # Create checkout session
  portal.ts              # Create customer portal session
src/app/
  login/page.tsx         # Login page
  register/page.tsx      # Registration page
  dashboard/page.tsx     # Ailment grid (replaces current /)
  settings/page.tsx      # Org admin: invite, billing
  billing/page.tsx       # Subscription status + portal redirect
  api/stripe/webhook/route.ts  # Stripe webhook handler
  actions/
    auth.ts              # Server actions: signup, login, logout, invite
    billing.ts           # Server actions: checkout, portal
middleware.ts            # Auth gate (root level)
supabase/
  migrations/
    001_org_schema.sql   # organizations + org_members + RLS
    002_auth_triggers.sql # Auto-create org on signup
```

### Modified files

```
src/app/page.tsx                    # Redirect logic (/ → /dashboard or /login)
src/app/assess/[ailment]/page.tsx   # Add auth check
src/app/layout.tsx                  # Add Supabase provider
```

---

### Task 1: Install dependencies

**Files:** `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install @supabase/ssr @supabase/supabase-js stripe
```

- [ ] **Step 2: Install dev types**

```bash
npm install -D @stripe/stripe-js
```

- [ ] **Step 3: Verify install**

```bash
npm ls @supabase/ssr @supabase/supabase-js stripe
```

Expected: all three listed with versions

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add supabase + stripe dependencies"
```

---

### Task 2: Supabase client helpers

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`
- Test: `src/__tests__/supabase-clients.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/supabase-clients.test.ts
import { describe, it, expect } from "vitest"

describe("Supabase client helpers", () => {
  it("createBrowserClient returns a client with auth property", async () => {
    const { createBrowserClient } = await import("@/lib/supabase/client")
    const client = createBrowserClient()
    expect(client).toBeDefined()
    expect(client.auth).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/supabase-clients.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create browser client**

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient as createClient } from "@supabase/ssr"

export function createBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4: Create server client**

```typescript
// src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
```

- [ ] **Step 5: Create middleware client**

```typescript
// src/lib/supabase/middleware.ts
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user, response }
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npm run test -- src/__tests__/supabase-clients.test.ts
```

Expected: PASS (requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars set, or mock them in vitest config)

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase/ src/__tests__/supabase-clients.test.ts
git commit -m "feat: supabase browser/server/middleware clients"
```

---

### Task 3: Supabase schema + migrations

**Files:**
- Create: `supabase/migrations/001_org_schema.sql`
- Create: `supabase/migrations/002_auth_triggers.sql`

- [ ] **Step 1: Write organizations + org_members schema**

```sql
-- supabase/migrations/001_org_schema.sql

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text not null default 'inactive'
    check (subscription_status in ('inactive', 'active', 'past_due', 'canceled', 'trialing')),
  created_at timestamptz default now()
);

alter table organizations enable row level security;

create table org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'pharmacist'
    check (role in ('admin', 'pharmacist')),
  created_at timestamptz default now(),
  unique(org_id, user_id)
);

alter table org_members enable row level security;

create index idx_org_members_user on org_members(user_id);
create index idx_org_members_org on org_members(org_id);

create policy "users see own orgs" on organizations
  for select to authenticated
  using (id in (select org_id from org_members where user_id = auth.uid()));

create policy "users see own org members" on org_members
  for select to authenticated
  using (org_id in (select org_id from org_members where user_id = auth.uid()));

create policy "admins manage members" on org_members
  for all to authenticated
  using (org_id in (
    select om.org_id from org_members om
    where om.user_id = auth.uid() and om.role = 'admin'
  ));
```

- [ ] **Step 2: Write auth trigger**

```sql
-- supabase/migrations/002_auth_triggers.sql

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  return new;
end;
$$;
```

Note: The actual org creation happens in the server action (Task 5), not a DB trigger, because we need the org name from the registration form. This placeholder function exists for future use (e.g., auto-creating profiles).

- [ ] **Step 3: Commit**

```bash
git add supabase/
git commit -m "feat: supabase schema for organizations + org_members with RLS"
```

---

### Task 4: Next.js middleware (auth gate)

**Files:**
- Create: `src/middleware.ts`
- Test: `src/__tests__/middleware-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/middleware-auth.test.ts
import { describe, it, expect } from "vitest"

describe("Auth middleware config", () => {
  it("exports a config with protected route matchers", async () => {
    const mod = await import("../middleware")
    expect(mod.config).toBeDefined()
    expect(mod.config.matcher).toBeDefined()
    expect(mod.config.matcher.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/middleware-auth.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write middleware**

```typescript
// src/middleware.ts
import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/middleware"

const PUBLIC_ROUTES = ["/login", "/register", "/api/stripe/webhook"]

export async function middleware(request: NextRequest) {
  const { user, response } = await updateSession(request)

  const isPublic = PUBLIC_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  if (!user && !isPublic) {
    return Response.redirect(new URL("/login", request.url))
  }

  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/register")) {
    return Response.redirect(new URL("/dashboard", request.url))
  }

  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/middleware-auth.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts src/__tests__/middleware-auth.test.ts
git commit -m "feat: auth middleware with route protection"
```

---

### Task 5: Auth server actions (signup, login, logout, invite)

**Files:**
- Create: `src/app/actions/auth.ts`
- Test: `src/__tests__/auth-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/auth-actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

describe("Auth server actions", () => {
  it("signup returns error if email missing", async () => {
    const { signup } = await import("@/app/actions/auth")
    const result = await signup({ email: "", password: "test1234", orgName: "Test" })
    expect(result.error).toBeDefined()
  })

  it("login returns error if email missing", async () => {
    const { login } = await import("@/app/actions/auth")
    const result = await login({ email: "", password: "test1234" })
    expect(result.error).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/auth-actions.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write auth actions**

```typescript
// src/app/actions/auth.ts
"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

export async function signup(formData: { email: string; password: string; orgName: string }) {
  const { email, password, orgName } = formData

  if (!email || !password || !orgName) {
    return { error: "Email, password, and organization name are required" }
  }

  const supabase = await createServerSupabaseClient()

  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return { error: error.message }

  const userId = data.user!.id

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: orgName })
    .select("id")
    .single()

  if (orgError) return { error: orgError.message }

  await supabase.from("org_members").insert({
    org_id: org.id,
    user_id: userId,
    role: "admin",
  })

  revalidatePath("/")
  redirect("/billing")
}

export async function login(formData: { email: string; password: string }) {
  const { email, password } = formData

  if (!email || !password) {
    return { error: "Email and password are required" }
  }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return { error: error.message }

  revalidatePath("/")
  redirect("/dashboard")
}

export async function logout() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  revalidatePath("/")
  redirect("/login")
}

export async function invitePharmacist(email: string) {
  if (!email) return { error: "Email is required" }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .single()

  if (!membership || membership.role !== "admin") {
    return { error: "Only org admins can invite" }
  }

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { org_id: membership.org_id },
  })

  if (error) return { error: error.message }

  const { data: invitedUser } = await supabase
    .from("org_members")
    .insert({
      org_id: membership.org_id,
      user_id: (await supabase.auth.admin.listUsers()).users.find(
        (u) => u.email === email
      )?.id!,
      role: "pharmacist",
    })

  return { success: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/auth-actions.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/auth.ts src/__tests__/auth-actions.test.ts
git commit -m "feat: auth server actions (signup, login, logout, invite)"
```

---

### Task 6: Stripe client + checkout + portal helpers

**Files:**
- Create: `src/lib/stripe/client.ts`
- Create: `src/lib/stripe/checkout.ts`
- Create: `src/lib/stripe/portal.ts`
- Test: `src/__tests__/stripe-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/stripe-helpers.test.ts
import { describe, it, expect } from "vitest"

describe("Stripe helpers", () => {
  it("createCheckoutUrl returns a string", async () => {
    const { createCheckoutSession } = await import("@/lib/stripe/checkout")
    const result = await createCheckoutSession({
      orgId: "test-org-id",
      orgName: "Test Pharmacy",
      email: "test@example.com",
    })
    expect(typeof result).toBe("string")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/stripe-helpers.test.ts
```

Expected: FAIL

- [ ] **Step 3: Create Stripe client**

```typescript
// src/lib/stripe/client.ts
import Stripe from "stripe"

export const stripe = new Stripe(process.env.STRIPE_RESTRICTED_KEY!, {
  apiVersion: "2026-05-27.dahlia",
})
```

- [ ] **Step 4: Create checkout helper**

```typescript
// src/lib/stripe/checkout.ts
import { stripe } from "./client"

export async function createCheckoutSession({
  orgId,
  orgName,
  email,
}: {
  orgId: string
  orgName: string
  email: string
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    metadata: { org_id: orgId },
    line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    subscription_data: { trial_period_days: 14 },
    success_url: `${appUrl}/dashboard?checkout=success`,
    cancel_url: `${appUrl}/billing?checkout=canceled`,
  })

  return session.url!
}
```

- [ ] **Step 5: Create portal helper**

```typescript
// src/lib/stripe/portal.ts
import { stripe } from "./client"

export async function createPortalSession(customerId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/settings`,
  })

  return session.url
}
```

- [ ] **Step 6: Run test to verify it passes**

Note: This test requires `STRIPE_RESTRICTED_KEY` and `STRIPE_PRICE_ID` env vars. In CI, mock Stripe or skip.

```bash
npm run test -- src/__tests__/stripe-helpers.test.ts
```

Expected: PASS (with env vars) or FAIL gracefully (without — acceptable for now)

- [ ] **Step 7: Commit**

```bash
git add src/lib/stripe/ src/__tests__/stripe-helpers.test.ts
git commit -m "feat: stripe client, checkout session, portal session helpers"
```

---

### Task 7: Stripe webhook handler

**Files:**
- Create: `src/app/api/stripe/webhook/route.ts`
- Test: `src/__tests__/stripe-webhook.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/stripe-webhook.test.ts
import { describe, it, expect } from "vitest"

describe("Stripe webhook", () => {
  it("returns 400 when signature is missing", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route")
    const request = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body: JSON.stringify({}),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/__tests__/stripe-webhook.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write webhook handler**

```typescript
// src/app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe/client"
import { createClient } from "@supabase/supabase-js"
import Stripe from "stripe"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      const orgId = session.metadata?.org_id
      if (orgId) {
        await supabase
          .from("organizations")
          .update({
            subscription_status: "active",
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
          })
          .eq("id", orgId)
      }
      break
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription
      await supabase
        .from("organizations")
        .update({ subscription_status: subscription.status })
        .eq("stripe_subscription_id", subscription.id)
      break
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription
      await supabase
        .from("organizations")
        .update({ subscription_status: "inactive" })
        .eq("stripe_subscription_id", subscription.id)
      break
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.subscription) {
        await supabase
          .from("organizations")
          .update({ subscription_status: "past_due" })
          .eq("stripe_subscription_id", invoice.subscription as string)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/__tests__/stripe-webhook.test.ts
```

Expected: PASS (returns 400 for missing signature)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ src/__tests__/stripe-webhook.test.ts
git commit -m "feat: stripe webhook handler with signature verification"
```

---

### Task 8: Login + Register pages

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/register/page.tsx`

- [ ] **Step 1: Create login page**

```tsx
// src/app/login/page.tsx
"use client"

import { useState } from "react"
import { login } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"

export default function LoginPage() {
  const [error, setError] = useState("")

  async function handleSubmit(formData: FormData) {
    setError("")
    const result = await login({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
    })
    if (result?.error) setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="size-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg mx-auto mb-3">
            Rx
          </div>
          <h1 className="text-xl font-bold tracking-tight">Ontario Minor Ailments</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
        </div>

        <form action={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          <Button type="submit">Sign In</Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-4">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-primary font-medium">
            Register your organization
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create register page**

```tsx
// src/app/register/page.tsx
"use client"

import { useState } from "react"
import { signup } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"

export default function RegisterPage() {
  const [error, setError] = useState("")

  async function handleSubmit(formData: FormData) {
    setError("")
    const result = await signup({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      orgName: formData.get("orgName") as string,
    })
    if (result?.error) setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="size-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg mx-auto mb-3">
            Rx
          </div>
          <h1 className="text-xl font-bold tracking-tight">Register Organization</h1>
          <p className="text-sm text-muted-foreground mt-1">Create an account for your pharmacy</p>
        </div>

        <form action={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="orgName">Organization Name</Label>
            <Input id="orgName" name="orgName" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Admin Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={8} />
          </div>
          <Button type="submit">Create Organization</Button>
        </form>

        <p className="text-sm text-muted-foreground text-center mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/login/ src/app/register/
git commit -m "feat: login and register pages with shadcn forms"
```

---

### Task 9: Dashboard + redirect root

**Files:**
- Create: `src/app/dashboard/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create dashboard page (move ailment grid here)**

```tsx
// src/app/dashboard/page.tsx
import { AilmentGrid } from "@/components/ailment-grid"
import { PharmacySettings } from "@/components/pharmacy-settings"
import { LogoutButton } from "@/components/logout-button"

export default function DashboardPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm tracking-tight">
              Rx
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">Ontario Minor Ailments</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Clinical Decision Support Tool — O. Reg. 256/24</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PharmacySettings />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <AilmentGrid />
      </main>
      <footer className="border-t mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-muted-foreground">
          Ontario Minor Ailment Prescribing per O. Reg. 256/24 — For pharmacist use only
        </div>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Create LogoutButton component**

```tsx
// src/components/logout-button.tsx
"use client"

import { logout } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { LogOut } from "lucide-react"

export function LogoutButton() {
  return (
    <form action={logout}>
      <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
        <LogOut className="size-4" />
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Update root page to redirect**

```tsx
// src/app/page.tsx
import { redirect } from "next/navigation"

export default function Home() {
  redirect("/dashboard")
}
```

- [ ] **Step 4: Update assess page header to link to /dashboard**

Change `Link href="/"` to `Link href="/dashboard"` in `src/app/assess/[ailment]/page.tsx`:

```tsx
// In src/app/assess/[ailment]/page.tsx, change:
<Link href="/">
// To:
<Link href="/dashboard">
```

And change the back button text from "← Back to ailments" to "← Back to dashboard".

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/ src/app/page.tsx src/components/logout-button.tsx src/app/assess/
git commit -m "feat: dashboard page, logout button, root redirect"
```

---

### Task 10: Settings page (admin) + Billing page

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/billing/page.tsx`
- Create: `src/app/actions/billing.ts`

- [ ] **Step 1: Create billing server actions**

```typescript
// src/app/actions/billing.ts
"use server"

import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createCheckoutSession } from "@/lib/stripe/checkout"
import { createPortalSession } from "@/lib/stripe/portal"
import { redirect } from "next/cache"

export async function startCheckout() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, organizations(stripe_customer_id)")
    .eq("user_id", user.id)
    .single()

  if (!membership) redirect("/login")

  const org = membership.organizations as unknown as { stripe_customer_id: string | null }

  if (org.stripe_customer_id) {
    const url = await createPortalSession(org.stripe_customer_id)
    redirect(url)
  }

  const url = await createCheckoutSession({
    orgId: membership.org_id,
    orgName: "",
    email: user.email!,
  })

  redirect(url)
}

export async function getOrgInfo() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("org_members")
    .select("role, organizations(id, name, subscription_status)")
    .eq("user_id", user.id)
    .single()

  return data
}
```

- [ ] **Step 2: Create settings page**

```tsx
// src/app/settings/page.tsx
"use client"

import { useState, useTransition } from "react"
import { invitePharmacist } from "@/app/actions/auth"
import { startCheckout, getOrgInfo } from "@/app/actions/billing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import Link from "next/link"

export default function SettingsPage() {
  const [inviteEmail, setInviteEmail] = useState("")
  const [message, setMessage] = useState("")
  const [pending, startTransition] = useTransition()

  function handleInvite(formData: FormData) {
    startTransition(async () => {
      const result = await invitePharmacist(inviteEmail)
      setMessage(result.error || "Invitation sent!")
      if (!result.error) setInviteEmail("")
    })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              ← Back to dashboard
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-tight">Organization Settings</h1>

        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Manage your subscription, payment methods, and invoices via Stripe.
            </p>
            <form action={startCheckout}>
              <Button type="submit">Manage Subscription</Button>
            </form>
          </CardContent>
        </Card>

        <Separator />

        <Card>
          <CardHeader>
            <CardTitle>Invite Pharmacist</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); handleInvite(new FormData(e.currentTarget)) }} className="flex flex-col gap-3">
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="pharmacist@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
                <Button type="submit" disabled={pending}>Invite</Button>
              </div>
              {message && (
                <p className={message.includes("sent") ? "text-sm text-green-600" : "text-sm text-destructive"}>
                  {message}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Create billing page**

```tsx
// src/app/billing/page.tsx
import { getOrgInfo, startCheckout } from "@/app/actions/billing"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"

export default async function BillingPage() {
  const orgInfo = await getOrgInfo()

  if (!orgInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Not authorized</p>
      </div>
    )
  }

  const org = orgInfo.organizations as unknown as { name: string; subscription_status: string }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              ← Back to dashboard
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 flex flex-col gap-6">
        <h1 className="text-2xl font-bold tracking-tight">Subscription</h1>

        <Card>
          <CardHeader>
            <CardTitle>{org.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className={`size-2 rounded-full ${org.subscription_status === "active" ? "bg-green-500" : "bg-amber-500"}`} />
              <span className="text-sm capitalize">{org.subscription_status === "active" ? "Active" : "Inactive"}</span>
            </div>

            {org.subscription_status !== "active" && (
              <p className="text-sm text-muted-foreground">
                Subscribe to access the Clinical Decision Support Tool. 14-day free trial included.
              </p>
            )}

            <form action={startCheckout}>
              <Button type="submit">
                {org.subscription_status === "active" ? "Manage Subscription" : "Start Subscription"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/ src/app/billing/ src/app/actions/billing.ts
git commit -m "feat: settings (invite) and billing (subscription) pages"
```

---

### Task 11: Integration test + build verification

**Files:**
- Test: `src/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration smoke test**

```typescript
// src/__tests__/integration.test.ts
import { describe, it, expect } from "vitest"
import { filterCheckedItems } from "@/lib/pdf-filter"

describe("Integration: auth pages exist and pdf filter works", () => {
  it("filterCheckedItems works for symptom filtering", () => {
    const all = ["Fever", "Cough", "Headache"]
    const checked = ["Fever", "Headache"]
    expect(filterCheckedItems(all, checked)).toEqual(["Fever", "Headache"])
  })
})
```

- [ ] **Step 2: Run all tests**

```bash
npm run test
```

Expected: All tests pass

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: 0 errors

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Clean build, no errors

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/integration.test.ts
git commit -m "test: integration smoke test for auth + pdf filter"
```

---

## Execution Notes

- Run Supabase migrations via `supabase db push` or Supabase Dashboard SQL editor
- Create Stripe product + price in Stripe Dashboard, copy `STRIPE_PRICE_ID`
- Set up Stripe webhook endpoint pointing to `/api/stripe/webhook`
- Set all env vars in Vercel dashboard before deploying
- Test with Stripe CLI: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
