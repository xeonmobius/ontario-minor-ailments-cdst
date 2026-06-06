# Auth & User Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase Auth with 3-role user accounts (owner, pharmacist, platform_admin), pharmacy orgs, email invites, and subscription-ready schema.

**Architecture:** Supabase Auth for authentication, `@supabase/ssr` for cookie-based sessions in Next.js App Router. Proxy-based session refresh. Single `profiles` table with role column, `pharmacies` table as tenant boundary, `invitations` table for email invite flow. RLS policies gate all access.

**Tech Stack:** Next.js 16, Supabase Auth, `@supabase/ssr`, `@supabase/supabase-js`, TypeScript, shadcn/ui

---

## File Structure

### New Files

```
cdst-app/
├── src/lib/supabase/
│   ├── client.ts              # Browser client for client components
│   ├── server.ts              # Server client for server components/actions
│   └── proxy.ts               # Session refresh + auth guard
├── src/middleware.ts           # → renamed to proxy.ts at project root (Next.js 16 pattern)
├── proxy.ts                   # Entry point for proxy, calls updateSession
├── src/app/login/page.tsx     # Login page
├── src/app/signup/page.tsx    # Owner signup page
├── src/app/invite/[token]/page.tsx  # Pharmacist invite acceptance
├── src/app/settings/
│   ├── profile/page.tsx       # Edit name, license, province
│   ├── pharmacy/page.tsx      # Edit pharmacy details (owner only)
│   └── team/page.tsx          # Invite/manage pharmacists (owner only)
├── src/components/
│   ├── auth-form.tsx          # Shared login/signup form component
│   └── user-nav.tsx           # Avatar dropdown in header
├── src/lib/auth-actions.ts    # Server actions for signup, login, logout, invite
├── src/lib/auth-guards.ts     # Helper functions for role checks
```

### Modified Files

```
cdst-app/
├── src/app/layout.tsx                      # Wrap with auth context
├── src/app/page.tsx                        # Use Supabase pharmacy data, add user-nav
├── src/app/assess/[ailment]/page.tsx       # Auth guard
├── src/components/pharmacy-settings.tsx    → REMOVED (replaced by /settings/pharmacy)
├── src/lib/pharmacy-storage.ts             → REMOVED (replaced by Supabase)
├── src/types/index.ts                      # Update PharmacyDefaults, add auth types
├── package.json                            # Add @supabase/supabase-js, @supabase/ssr
├── .env.local                              # Supabase URL + publishable key
```

---

## Task 1: Install Supabase Dependencies

**Files:**
- Modify: `cdst-app/package.json`

- [ ] **Step 1: Install packages**

```bash
cd cdst-app && npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Verify install**

Run: `cd cdst-app && node -e "require('@supabase/supabase-js'); require('@supabase/ssr'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add package.json package-lock.json && git commit -m "chore: add @supabase/supabase-js and @supabase/ssr"
```

---

## Task 2: Environment Variables

**Files:**
- Create: `cdst-app/.env.local`
- Modify: `cdst-app/.gitignore` (ensure .env.local is ignored)

- [ ] **Step 1: Create .env.local with placeholder values**

```bash
cat > cdst-app/.env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
EOF
```

- [ ] **Step 2: Verify .env.local is in .gitignore**

Run: `cd cdst-app && grep -q ".env.local" .gitignore && echo "OK" || echo ".env.local missing"`
Expected: `OK`

If missing, add `.env.local` to `.gitignore`.

- [ ] **Step 3: Commit (gitignore only, never .env.local)**

If `.gitignore` was updated:

```bash
cd cdst-app && git add .gitignore && git commit -m "chore: ensure .env.local is gitignored"
```

---

## Task 3: Supabase Client Utilities

**Files:**
- Create: `cdst-app/src/lib/supabase/client.ts`
- Create: `cdst-app/src/lib/supabase/server.ts`
- Create: `cdst-app/src/lib/supabase/proxy.ts`
- Create: `cdst-app/proxy.ts`

- [ ] **Step 1: Create browser client**

`cdst-app/src/lib/supabase/client.ts`:

```typescript
import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
```

- [ ] **Step 2: Create server client**

`cdst-app/src/lib/supabase/server.ts`:

```typescript
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet, _headers) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll called from Server Component — middleware handles refresh
          }
        },
      },
    },
  )
}
```

- [ ] **Step 3: Create proxy (session refresh + auth guard)**

`cdst-app/src/lib/supabase/proxy.ts`:

```typescript
import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          )
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  const user = data?.claims

  const publicPaths = ["/login", "/signup", "/auth"]
  const isPublic = publicPaths.some((p) =>
    request.nextUrl.pathname.startsWith(p),
  )
  const isInvite = request.nextUrl.pathname.startsWith("/invite/")

  if (!user && !isPublic && !isInvite) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && isPublic && !isInvite) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

- [ ] **Step 4: Create proxy entry point at project root**

`cdst-app/proxy.ts`:

```typescript
import { type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors in the new supabase files.

- [ ] **Step 6: Commit**

```bash
cd cdst-app && git add src/lib/supabase/ proxy.ts && git commit -m "feat: add Supabase client utilities and auth proxy"
```

---

## Task 4: Update Types

**Files:**
- Modify: `cdst-app/src/types/index.ts`

- [ ] **Step 1: Add auth types, update PharmacyDefaults**

Replace `cdst-app/src/types/index.ts` with:

```typescript
export interface RxOption {
  drug: string
  dose: string
  notes: string
}

export interface Ailment {
  id: string
  name: string
  slug: string
  symptoms: string[]
  redFlags: string[]
  rxOptions: RxOption[]
  nonRx: string[]
  followUp: string
}

export interface PatientInfo {
  name: string
  dob: string
  sex: string
  ohip: string
  address: string
  city: string
  postalCode: string
  phone: string
  allergies: string
  currentMeds: string
}

export interface PharmacyDefaults {
  pharmacyName: string
  address: string
  city: string
  province: string
  postalCode: string
  phone: string
  fax: string
  pharmacistName: string
  provincialLicense: string
  registrationNumber: string
}

export interface SelectedRx extends RxOption {
  sig: string
  quantity: string
  refills: string
  duration: string
}

export interface AssessmentData {
  ailment: Ailment
  patient: PatientInfo
  redFlagsChecked: string[]
  hasRedFlag: boolean
  assessmentNotes: string
  selectedRx: SelectedRx | null
  dateOfAssessment: string
}

export type UserRole = "owner" | "pharmacist" | "platform_admin"

export interface Profile {
  id: string
  pharmacyId: string | null
  role: UserRole
  fullName: string
  email: string
  province: string | null
  provincialLicense: string | null
  registrationNumber: string | null
  createdAt: string
}

export interface Pharmacy {
  id: string
  name: string
  address: string
  city: string
  province: string
  postalCode: string
  phone: string
  fax: string
  subscriptionStatus: string
  subscriptionTier: string
  seats: number
  createdAt: string
}

export interface Invitation {
  id: string
  pharmacyId: string
  email: string
  role: UserRole
  token: string
  acceptedAt: string | null
  expiresAt: string
  createdAt: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/types/index.ts && git commit -m "feat: add auth types (Profile, Pharmacy, Invitation, UserRole)"
```

---

## Task 5: Server Actions for Auth

**Files:**
- Create: `cdst-app/src/lib/auth-actions.ts`

- [ ] **Step 1: Create auth server actions**

`cdst-app/src/lib/auth-actions.ts`:

```typescript
"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export async function login(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/", "layout")
  redirect("/")
}

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string

  const pharmacyData = {
    name: formData.get("pharmacyName") as string,
    address: formData.get("address") as string,
    city: formData.get("city") as string,
    province: "Ontario",
    postal_code: formData.get("postalCode") as string,
    phone: formData.get("phone") as string,
    fax: formData.get("fax") as string,
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role: "owner" },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  if (authData.user) {
    const { error: pharmacyError } = await supabase
      .from("pharmacies")
      .insert({
        ...pharmacyData,
        created_by: authData.user.id,
      })
      .select("id")
      .single()

    if (pharmacyError) {
      return { error: pharmacyError.message }
    }
  }

  revalidatePath("/", "layout")
  redirect("/")
}

export async function signupWithInvite(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string
  const provincialLicense = formData.get("provincialLicense") as string
  const province = formData.get("province") as string
  const token = formData.get("token") as string

  const { data: invite, error: inviteError } = await supabase
    .from("invitations")
    .select("pharmacy_id, email, expires_at, accepted_at")
    .eq("token", token)
    .single()

  if (inviteError || !invite) {
    return { error: "Invalid or expired invitation." }
  }

  if (invite.accepted_at) {
    return { error: "This invitation has already been used." }
  }

  if (new Date(invite.expires_at) < new Date()) {
    return { error: "This invitation has expired." }
  }

  if (invite.email.toLowerCase() !== email.toLowerCase()) {
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
        invite_token: token,
      },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  revalidatePath("/", "layout")
  redirect("/")
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}

export async function createInvitation(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const { data: profile } = await supabase
    .from("profiles")
    .select("pharmacy_id, role")
    .eq("id", (await supabase.auth.getUser()).data.user?.id)
    .single()

  if (!profile || profile.role !== "owner") {
    return { error: "Only owners can invite pharmacists." }
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from("invitations").insert({
    pharmacy_id: profile.pharmacy_id,
    email,
    role: "pharmacist",
    token,
    expires_at: expiresAt,
    created_by: (await supabase.auth.getUser()).data.user?.id,
  })

  if (error) {
    return { error: error.message }
  }

  revalidatePath("/settings/team")
  return { success: true }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/lib/auth-actions.ts && git commit -m "feat: add auth server actions (login, signup, invite, logout)"
```

---

## Task 6: Auth Guard Helpers

**Files:**
- Create: `cdst-app/src/lib/auth-guards.ts`

- [ ] **Step 1: Create auth guard utilities**

`cdst-app/src/lib/auth-guards.ts`:

```typescript
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import type { Profile, UserRole } from "@/types"

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from("profiles")
    .select("id, pharmacy_id, role, full_name, email, province, provincial_license, registration_number, created_at")
    .eq("id", user.id)
    .single()

  if (!data) return null

  return {
    id: data.id,
    pharmacyId: data.pharmacy_id,
    role: data.role as UserRole,
    fullName: data.full_name,
    email: data.email,
    province: data.province,
    provincialLicense: data.provincial_license,
    registrationNumber: data.registration_number,
    createdAt: data.created_at,
  }
}

export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) redirect("/login")
  return profile
}

export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const profile = await requireAuth()
  if (!roles.includes(profile.role)) redirect("/")
  return profile
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/lib/auth-guards.ts && git commit -m "feat: add auth guard helpers (requireAuth, requireRole)"
```

---

## Task 7: Login Page

**Files:**
- Create: `cdst-app/src/app/login/page.tsx`

- [ ] **Step 1: Create login page**

`cdst-app/src/app/login/page.tsx`:

```typescript
"use client"

import { useState } from "react"
import Link from "next/link"
import { login } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    const result = await login(formData)
    if (result?.error) setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Ontario Minor Ailments CDST
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify page renders**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/app/login/ && git commit -m "feat: add login page"
```

---

## Task 8: Owner Signup Page

**Files:**
- Create: `cdst-app/src/app/signup/page.tsx`

- [ ] **Step 1: Create signup page**

`cdst-app/src/app/signup/page.tsx`:

```typescript
"use client"

import { useState } from "react"
import Link from "next/link"
import { signup } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    const result = await signup(formData)
    if (result?.error) setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
          <p className="text-sm text-muted-foreground">
            Register your pharmacy
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={6} />
          </div>

          <hr className="my-4" />
          <p className="text-sm font-medium text-muted-foreground">Pharmacy Details</p>

          <div className="space-y-2">
            <Label htmlFor="pharmacyName">Pharmacy Name</Label>
            <Input id="pharmacyName" name="pharmacyName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input id="address" name="address" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="postalCode">Postal Code</Label>
              <Input id="postalCode" name="postalCode" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fax">Fax</Label>
              <Input id="fax" name="fax" type="tel" />
            </div>
          </div>

          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/app/signup/ && git commit -m "feat: add owner signup page with pharmacy details"
```

---

## Task 9: Pharmacist Invite Page

**Files:**
- Create: `cdst-app/src/app/invite/[token]/page.tsx`

- [ ] **Step 1: Create invite acceptance page**

`cdst-app/src/app/invite/[token]/page.tsx`:

```typescript
"use client"

import { useState } from "react"
import Link from "next/link"
import { signupWithInvite } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    formData.set("token", token)
    const result = await signupWithInvite(formData)
    if (result?.error) setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Join your pharmacy</h1>
          <p className="text-sm text-muted-foreground">
            Create your pharmacist account
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={6} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provincialLicense">Provincial License</Label>
            <Input id="provincialLicense" name="provincialLicense" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="province">Province</Label>
            <Input id="province" name="province" defaultValue="Ontario" required />
          </div>
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-primary underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/app/invite/ && git commit -m "feat: add pharmacist invite acceptance page"
```

---

## Task 10: User Nav Component (Header Dropdown)

**Files:**
- Create: `cdst-app/src/components/user-nav.tsx`

- [ ] **Step 1: Create user nav dropdown**

`cdst-app/src/components/user-nav.tsx`:

```typescript
"use client"

import Link from "next/link"
import { LogOut, Settings, User, Users } from "lucide-react"
import { logout } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import type { Profile } from "@/types"

export function UserNav({ profile }: { profile: Profile }) {
  const isOwner = profile.role === "owner"

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground hidden sm:inline">
        {profile.fullName}
      </span>
      <Dialog>
        <DialogTrigger
          render={
            <Button variant="outline" size="icon" aria-label="User menu" />
          }
        >
          <User className="size-4" />
        </DialogTrigger>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{profile.fullName}</DialogTitle>
          </DialogHeader>
          <nav className="flex flex-col gap-1">
            <Link
              href="/settings/profile"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              <Settings className="size-4" />
              Profile Settings
            </Link>
            {isOwner && (
              <>
                <Link
                  href="/settings/pharmacy"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <Settings className="size-4" />
                  Pharmacy Settings
                </Link>
                <Link
                  href="/settings/team"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  <Users className="size-4" />
                  Manage Team
                </Link>
              </>
            )}
          </nav>
          <DialogFooter>
            <form action={logout}>
              <DialogClose render={<Button variant="outline" className="w-full" />}>
                <LogOut className="size-4 mr-2" />
                Sign out
              </DialogClose>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/components/user-nav.tsx && git commit -m "feat: add user nav dropdown component"
```

---

## Task 11: Update Home Page + Remove Old Components

**Files:**
- Modify: `cdst-app/src/app/page.tsx`
- Delete: `cdst-app/src/components/pharmacy-settings.tsx`
- Delete: `cdst-app/src/lib/pharmacy-storage.ts`

- [ ] **Step 1: Update home page to use Supabase auth**

Replace `cdst-app/src/app/page.tsx`:

```typescript
import { AilmentGrid } from "@/components/ailment-grid"
import { UserNav } from "@/components/user-nav"
import { requireAuth } from "@/lib/auth-guards"

export default async function Home() {
  const profile = await requireAuth()

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
          <UserNav profile={profile} />
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

- [ ] **Step 2: Remove old localStorage files**

```bash
rm cdst-app/src/components/pharmacy-settings.tsx cdst-app/src/lib/pharmacy-storage.ts
```

- [ ] **Step 3: Remove old tests that import deleted files**

Check if any test files import `pharmacy-storage` or `pharmacy-settings`:

Run: `cd cdst-app && grep -rl "pharmacy-storage\|pharmacy-settings" src/`

If found, update or remove those test files.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
cd cdst-app && git add -A && git commit -m "feat: update home page with auth, remove localStorage pharmacy settings"
```

---

## Task 12: Settings — Profile Page

**Files:**
- Create: `cdst-app/src/app/settings/profile/page.tsx`

- [ ] **Step 1: Create profile settings page**

`cdst-app/src/app/settings/profile/page.tsx`:

```typescript
import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { ProfileForm } from "./profile-form"

export default async function ProfileSettingsPage() {
  const profile = await requireAuth()
  const supabase = await createClient()

  const { data } = await supabase
    .from("profiles")
    .select("full_name, provincial_license, province, registration_number")
    .eq("id", profile.id)
    .single()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <h1 className="text-lg font-bold tracking-tight">Profile Settings</h1>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <ProfileForm defaults={data} />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create profile form client component**

`cdst-app/src/app/settings/profile/profile-form.tsx`:

```typescript
"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ProfileForm({
  defaults,
}: {
  defaults: {
    full_name: string | null
    provincial_license: string | null
    province: string | null
    registration_number: string | null
  } | null
}) {
  const [fullName, setFullName] = useState(defaults?.full_name ?? "")
  const [provincialLicense, setProvincialLicense] = useState(defaults?.provincial_license ?? "")
  const [province, setProvince] = useState(defaults?.province ?? "Ontario")
  const [registrationNumber, setRegistrationNumber] = useState(defaults?.registration_number ?? "")
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const supabase = createClient()
    await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        provincial_license: provincialLicense,
        province,
        registration_number: registrationNumber,
      })
      .eq("id", (await supabase.auth.getUser()).data.user!.id)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="fullName">Full Name</Label>
        <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="provincialLicense">Provincial License</Label>
        <Input id="provincialLicense" value={provincialLicense} onChange={(e) => setProvincialLicense(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="province">Province</Label>
        <Input id="province" value={province} onChange={(e) => setProvince(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="registrationNumber">Registration Number</Label>
        <Input id="registrationNumber" value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
      </div>
      <Button onClick={handleSave}>{saved ? "Saved" : "Save"}</Button>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
cd cdst-app && git add src/app/settings/profile/ && git commit -m "feat: add profile settings page"
```

---

## Task 13: Settings — Pharmacy Page (Owner Only)

**Files:**
- Create: `cdst-app/src/app/settings/pharmacy/page.tsx`

- [ ] **Step 1: Create pharmacy settings page**

`cdst-app/src/app/settings/pharmacy/page.tsx`:

```typescript
import { requireRole } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { PharmacyForm } from "./pharmacy-form"

export default async function PharmacySettingsPage() {
  const profile = await requireRole("owner")
  const supabase = await createClient()

  const { data: pharmacy } = await supabase
    .from("pharmacies")
    .select("id, name, address, city, province, postal_code, phone, fax")
    .eq("id", profile.pharmacyId)
    .single()

  if (!pharmacy) {
    return <p className="p-6">Pharmacy not found.</p>
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <h1 className="text-lg font-bold tracking-tight">Pharmacy Settings</h1>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <PharmacyForm pharmacy={pharmacy} />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create pharmacy form client component**

`cdst-app/src/app/settings/pharmacy/pharmacy-form.tsx`:

```typescript
"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function PharmacyForm({
  pharmacy,
}: {
  pharmacy: {
    id: string
    name: string
    address: string
    city: string
    province: string
    postal_code: string
    phone: string
    fax: string
  }
}) {
  const [name, setName] = useState(pharmacy.name)
  const [address, setAddress] = useState(pharmacy.address)
  const [city, setCity] = useState(pharmacy.city)
  const [postalCode, setPostalCode] = useState(pharmacy.postal_code)
  const [phone, setPhone] = useState(pharmacy.phone)
  const [fax, setFax] = useState(pharmacy.fax)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    const supabase = createClient()
    await supabase
      .from("pharmacies")
      .update({
        name,
        address,
        city,
        postal_code: postalCode,
        phone,
        fax,
      })
      .eq("id", pharmacy.id)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="name">Pharmacy Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalCode">Postal Code</Label>
          <Input id="postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="province">Province</Label>
        <Input id="province" value={pharmacy.province} disabled />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fax">Fax</Label>
          <Input id="fax" value={fax} onChange={(e) => setFax(e.target.value)} />
        </div>
      </div>
      <Button onClick={handleSave}>{saved ? "Saved" : "Save"}</Button>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
cd cdst-app && git add src/app/settings/pharmacy/ && git commit -m "feat: add pharmacy settings page (owner only)"
```

---

## Task 14: Settings — Team Page (Owner Only)

**Files:**
- Create: `cdst-app/src/app/settings/team/page.tsx`

- [ ] **Step 1: Create team management page**

`cdst-app/src/app/settings/team/page.tsx`:

```typescript
import { requireRole } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { InviteForm } from "./invite-form"
import { TeamList } from "./team-list"

export default async function TeamPage() {
  const profile = await requireRole("owner")
  const supabase = await createClient()

  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("pharmacy_id", profile.pharmacyId)

  const { data: invitations } = await supabase
    .from("invitations")
    .select("id, email, created_at, expires_at, accepted_at")
    .eq("pharmacy_id", profile.pharmacyId)
    .is("accepted_at", null)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <h1 className="text-lg font-bold tracking-tight">Manage Team</h1>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 space-y-8">
        <InviteForm />
        <TeamList members={members ?? []} invitations={invitations ?? []} />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Create invite form client component**

`cdst-app/src/app/settings/team/invite-form.tsx`:

```typescript
"use client"

import { useState } from "react"
import { createInvitation } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function InviteForm() {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setError(null)
    setMessage(null)
    const result = await createInvitation(formData)
    if (result?.error) {
      setError(result.error)
    } else {
      setMessage("Invitation created. Share the invite link with the pharmacist.")
      setEmail("")
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">Invite Pharmacist</h2>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      {message && (
        <div className="rounded-md bg-primary/10 p-3 text-sm text-primary">{message}</div>
      )}
      <form action={handleSubmit} className="flex gap-2 items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="email" className="sr-only">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="pharmacist@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <Button type="submit">Invite</Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Create team list component**

`cdst-app/src/app/settings/team/team-list.tsx`:

```typescript
export function TeamList({
  members,
  invitations,
}: {
  members: { id: string; full_name: string; email: string; role: string }[]
  invitations: { id: string; email: string; created_at: string; expires_at: string; accepted_at: string | null }[]
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-2">Team Members</h2>
        <div className="divide-y rounded-lg border">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{m.full_name}</p>
                <p className="text-xs text-muted-foreground">{m.email}</p>
              </div>
              <span className="text-xs bg-muted px-2 py-1 rounded capitalize">{m.role}</span>
            </div>
          ))}
          {members.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No members yet.</p>
          )}
        </div>
      </div>

      {invitations.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Pending Invitations</h2>
          <div className="divide-y rounded-lg border">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Pending</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 5: Commit**

```bash
cd cdst-app && git add src/app/settings/team/ && git commit -m "feat: add team management page with invite form"
```

---

## Task 15: Create Supabase Database Schema (Migrations)

This task runs against the Supabase project using the MCP tools. The Supabase MCP server must be configured and connected.

**Files:** None in codebase — runs as SQL migrations via Supabase MCP.

- [ ] **Step 1: Create `pharmacies` table**

Use `supabase_apply_migration`:

```sql
create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  city text not null,
  province text not null default 'Ontario',
  postal_code text not null,
  phone text not null,
  fax text,
  created_by uuid references auth.users(id) on delete set null,
  subscription_status text not null default 'active',
  subscription_tier text not null default 'free',
  seats int not null default 3,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

alter table public.pharmacies enable row level security;
```

- [ ] **Step 2: Create `profiles` table**

Use `supabase_apply_migration`:

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pharmacy_id uuid references public.pharmacies(id) on delete set null,
  role text not null default 'pharmacist',
  full_name text not null,
  email text not null,
  province text,
  provincial_license text,
  registration_number text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
```

- [ ] **Step 3: Create `invitations` table**

Use `supabase_apply_migration`:

```sql
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  email text not null,
  role text not null default 'pharmacist',
  token text not null unique,
  accepted_at timestamptz,
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;
```

- [ ] **Step 4: Create `handle_new_user` trigger function**

Use `supabase_apply_migration`:

```sql
create schema if not exists auth_helpers;

create or replace function auth_helpers.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  invite record;
  pharmacy_id uuid;
begin
  pharmacy_id := null;

  if new.raw_app_meta_data->>'role' = 'owner' then
    insert into public.profiles (id, pharmacy_id, role, full_name, email, province, provincial_license, registration_number)
    values (
      new.id,
      null,
      'owner',
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      new.email,
      new.raw_user_meta_data->>'province',
      new.raw_user_meta_data->>'provincial_license',
      new.raw_user_meta_data->>'registration_number'
    );

  elsif new.raw_user_meta_data->>'invite_token' is not null then
    select * into invite
    from public.invitations
    where token = new.raw_user_meta_data->>'invite_token'
      and accepted_at is null
      and expires_at > now()
    limit 1;

    if invite is not null then
      pharmacy_id := invite.pharmacy_id;

      update public.invitations
      set accepted_at = now()
      where id = invite.id;
    end if;

    insert into public.profiles (id, pharmacy_id, role, full_name, email, province, provincial_license, registration_number)
    values (
      new.id,
      pharmacy_id,
      coalesce(new.raw_user_meta_data->>'role', 'pharmacist'),
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      new.email,
      new.raw_user_meta_data->>'province',
      new.raw_user_meta_data->>'provincial_license',
      new.raw_user_meta_data->>'registration_number'
    );

  else
    insert into public.profiles (id, pharmacy_id, role, full_name, email)
    values (new.id, null, 'pharmacist', coalesce(new.raw_user_meta_data->>'full_name', ''), new.email);
  end if;

  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure auth_helpers.handle_new_user();
```

- [ ] **Step 5: Create RLS policies**

Use `supabase_apply_migration`:

```sql
-- pharmacies: owners read/write own, pharmacists read own, platform_admin read/write all
create policy "owners_manage_own_pharmacy" on public.pharmacies
  for all
  to authenticated
  using (
    id = (select pharmacy_id from public.profiles where id = auth.uid() and role = 'owner')
  )
  with check (
    id = (select pharmacy_id from public.profiles where id = auth.uid() and role = 'owner')
  );

create policy "pharmacists_read_own_pharmacy" on public.pharmacies
  for select
  to authenticated
  using (
    id = (select pharmacy_id from public.profiles where id = auth.uid())
  );

create policy "platform_admin_all_pharmacies" on public.pharmacies
  for all
  to authenticated
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'platform_admin')
  );

-- profiles: users read own pharmacy, edit own row
create policy "users_read_own_pharmacy_profiles" on public.profiles
  for select
  to authenticated
  using (
    pharmacy_id = (select pharmacy_id from public.profiles where id = auth.uid())
    or id = auth.uid()
  );

create policy "users_update_own_profile" on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- invitations: owners CRUD own pharmacy
create policy "owners_manage_invitations" on public.invitations
  for all
  to authenticated
  using (
    pharmacy_id = (select pharmacy_id from public.profiles where id = auth.uid() and role = 'owner')
  )
  with check (
    pharmacy_id = (select pharmacy_id from public.profiles where id = auth.uid() and role = 'owner')
  );

create policy "anyone_accept_invite" on public.invitations
  for select
  to authenticated
  using (token is not null);
```

- [ ] **Step 6: Run advisors to check for security issues**

Use `supabase_get_advisors` with type `security`. Fix any issues found.

- [ ] **Step 7: Commit (migration applied via Supabase, note in project)**

```bash
cd cdst-app && git add -A && git commit -m "feat: Supabase schema — pharmacies, profiles, invitations, RLS, trigger"
```

---

## Task 16: Wire Up Signup to Create Pharmacy + Link Profile

This task is code in `auth-actions.ts` to complete the owner signup flow after the trigger creates the profile. The trigger creates the profile but the pharmacy needs to be created from the server action and the profile's `pharmacy_id` needs updating.

**Files:**
- Modify: `cdst-app/src/lib/auth-actions.ts`

- [ ] **Step 1: Update signup action to create pharmacy and link profile**

The `signup` function in `auth-actions.ts` already creates the pharmacy. Update it to also set `profiles.pharmacy_id` after creating the pharmacy:

Replace the `signup` function body in `cdst-app/src/lib/auth-actions.ts`:

```typescript
export async function signup(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string

  const pharmacyData = {
    name: formData.get("pharmacyName") as string,
    address: formData.get("address") as string,
    city: formData.get("city") as string,
    province: "Ontario",
    postal_code: formData.get("postalCode") as string,
    phone: formData.get("phone") as string,
    fax: (formData.get("fax") as string) || null,
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role: "owner" },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  if (authData.user) {
    const { data: pharmacy, error: pharmacyError } = await supabase
      .from("pharmacies")
      .insert({
        ...pharmacyData,
        created_by: authData.user.id,
      })
      .select("id")
      .single()

    if (pharmacyError) {
      return { error: pharmacyError.message }
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ pharmacy_id: pharmacy.id })
      .eq("id", authData.user.id)

    if (profileError) {
      return { error: profileError.message }
    }
  }

  revalidatePath("/", "layout")
  redirect("/")
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/lib/auth-actions.ts && git commit -m "fix: link pharmacy to profile on owner signup"
```

---

## Task 17: Update Assess Page with Auth Guard

**Files:**
- Modify: `cdst-app/src/app/assess/[ailment]/page.tsx`

- [ ] **Step 1: Add auth guard to assess page**

Replace `cdst-app/src/app/assess/[ailment]/page.tsx`:

```typescript
import { notFound } from "next/navigation"
import Link from "next/link"
import { getAilmentBySlug } from "@/lib/ailments"
import { WizardContainer } from "@/components/wizard/wizard-container"
import { Button } from "@/components/ui/button"
import { requireAuth } from "@/lib/auth-guards"

export default async function AssessPage({
  params,
}: {
  params: Promise<{ ailment: string }>
}) {
  await requireAuth()
  const { ailment: slug } = await params
  const ailment = getAilmentBySlug(slug)

  if (!ailment) {
    notFound()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              ← Back to ailments
            </Button>
          </Link>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <WizardContainer ailment={ailment} />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd cdst-app && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
cd cdst-app && git add src/app/assess/ && git commit -m "feat: add auth guard to assess page"
```

---

## Task 18: End-to-End Smoke Test

- [ ] **Step 1: Set real Supabase credentials in `.env.local`**

Replace placeholder values with actual Supabase project URL and publishable key.

- [ ] **Step 2: Start dev server**

Run: `cd cdst-app && npm run dev`

- [ ] **Step 3: Verify redirect to `/login`**

Visit `http://localhost:3000` — should redirect to `/login`.

- [ ] **Step 4: Test owner signup**

Visit `/signup`, fill in all fields, submit. Should redirect to `/` (dashboard). Check Supabase dashboard for new user, profile, and pharmacy row.

- [ ] **Step 5: Test login/logout**

Log out via user nav, then log back in. Verify session persistence.

- [ ] **Step 6: Test pharmacist invite**

As owner, go to `/settings/team`, invite a pharmacist. Check `invitations` table in Supabase. Copy the token from the table row, visit `/invite/{token}` with a different email. Verify profile created with correct `pharmacy_id`.

- [ ] **Step 7: Test RBAC**

As pharmacist, verify `/settings/pharmacy` and `/settings/team` redirect to `/`. As pharmacist, verify pharmacy settings are read-only (no edit button shown).

- [ ] **Step 8: Run full test suite**

Run: `cd cdst-app && npm test`

Expected: All tests pass (may need to update tests that reference deleted files).
