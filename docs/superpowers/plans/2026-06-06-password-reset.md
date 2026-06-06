# Password Reset & Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add forgot-password (email reset link) and change-password (settings page) flows.

**Architecture:** Supabase Auth handles email delivery and token validation. Three new server actions call Supabase Auth APIs. Three new pages. Navigation links added to login page and user nav.

**Tech Stack:** Next.js 16, Supabase Auth, vitest

---

### Task 1: Add `forgotPassword` server action + test

**Files:**
- Modify: `src/lib/auth-actions.ts`
- Test: `src/__tests__/auth-forgot-password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/auth-forgot-password.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { forgotPassword } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"

describe("forgotPassword", () => {
  it("calls resetPasswordForEmail with correct redirectTo", async () => {
    const mockReset = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { resetPasswordForEmail: mockReset } } as any)

    const formData = new FormData()
    formData.set("email", "test@example.com")

    const result = await forgotPassword(null, formData)

    expect(mockReset).toHaveBeenCalledWith("test@example.com", {
      redirectTo: expect.stringContaining("/reset-password"),
    })
    expect(result).toEqual({ success: true })
  })

  it("returns success even when email not found (prevents enumeration)", async () => {
    const mockReset = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { resetPasswordForEmail: mockReset } } as any)

    const formData = new FormData()
    formData.set("email", "nonexistent@example.com")

    const result = await forgotPassword(null, formData)

    expect(result).toEqual({ success: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/auth-forgot-password.test.ts`
Expected: FAIL — `forgotPassword` is not exported

- [ ] **Step 3: Write implementation**

In `src/lib/auth-actions.ts`, add this function at the end of the file (before the last closing if needed, or after `createInvitation`):

```typescript
export async function forgotPassword(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/reset-password`,
  })

  return { success: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/auth-forgot-password.test.ts`
Expected: PASS (2)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-actions.ts src/__tests__/auth-forgot-password.test.ts
git commit -m "feat: add forgotPassword server action with tests"
```

---

### Task 2: Add `resetPassword` server action + test

**Files:**
- Modify: `src/lib/auth-actions.ts`
- Test: `src/__tests__/auth-reset-password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/auth-reset-password.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { resetPassword } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"

describe("resetPassword", () => {
  it("returns error when passwords do not match", async () => {
    const formData = new FormData()
    formData.set("password", "newpass123")
    formData.set("confirmPassword", "different456")

    const result = await resetPassword(null, formData)

    expect(result).toEqual({ error: "Passwords do not match" })
  })

  it("returns error when password is too short", async () => {
    const formData = new FormData()
    formData.set("password", "short")
    formData.set("confirmPassword", "short")

    const result = await resetPassword(null, formData)

    expect(result).toEqual({ error: "Password must be at least 8 characters" })
  })

  it("updates password and logs audit event on success", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await resetPassword(null, formData)

    expect(mockUpdate).toHaveBeenCalledWith({ password: "newpassword123" })
    expect(result).toEqual({ success: true })
    expect(logAuditEvent).toHaveBeenCalledWith("auth.password_change", { method: "reset_link" })
  })

  it("returns error when updateUser fails", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ data: null, error: { message: "Token expired" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await resetPassword(null, formData)

    expect(result).toEqual({ error: "Token expired" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/auth-reset-password.test.ts`
Expected: FAIL — `resetPassword` is not exported

- [ ] **Step 3: Write implementation**

In `src/lib/auth-actions.ts`, add after `forgotPassword`:

```typescript
export async function resetPassword(_prev: any, formData: FormData) {
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  await logAuditEvent("auth.password_change", { method: "reset_link" })
  return { success: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/auth-reset-password.test.ts`
Expected: PASS (4)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-actions.ts src/__tests__/auth-reset-password.test.ts
git commit -m "feat: add resetPassword server action with tests"
```

---

### Task 3: Add `changePassword` server action + test

**Files:**
- Modify: `src/lib/auth-actions.ts`
- Test: `src/__tests__/auth-change-password.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/auth-change-password.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { changePassword } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"

describe("changePassword", () => {
  it("returns error when current password is wrong", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "test@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: { message: "Invalid login credentials" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn } } as any)

    const formData = new FormData()
    formData.set("currentPassword", "wrongpass")
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await changePassword(null, formData)

    expect(result).toEqual({ error: "Current password is incorrect" })
  })

  it("returns error when new passwords do not match", async () => {
    const result = await changePassword(null, (() => {
      const fd = new FormData()
      fd.set("currentPassword", "oldpass")
      fd.set("password", "newpass123")
      fd.set("confirmPassword", "different456")
      return fd
    })())

    expect(result).toEqual({ error: "Passwords do not match" })
  })

  it("updates password and logs audit on success", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "test@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn, updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("currentPassword", "oldpassword")
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await changePassword(null, formData)

    expect(mockSignIn).toHaveBeenCalledWith({ email: "test@example.com", password: "oldpassword" })
    expect(mockUpdate).toHaveBeenCalledWith({ password: "newpassword123" })
    expect(result).toEqual({ success: true })
    expect(logAuditEvent).toHaveBeenCalledWith("auth.password_change", { method: "settings" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/auth-change-password.test.ts`
Expected: FAIL — `changePassword` is not exported

- [ ] **Step 3: Write implementation**

In `src/lib/auth-actions.ts`, add after `resetPassword`:

```typescript
export async function changePassword(_prev: any, formData: FormData) {
  const currentPassword = formData.get("currentPassword") as string
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user?.email) {
    return { error: "Not authenticated" }
  }

  const { error: reAuthError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  })

  if (reAuthError) {
    return { error: "Current password is incorrect" }
  }

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  await logAuditEvent("auth.password_change", { method: "settings" })
  return { success: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/auth-change-password.test.ts`
Expected: PASS (3)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-actions.ts src/__tests__/auth-change-password.test.ts
git commit -m "feat: add changePassword server action with tests"
```

---

### Task 4: Create `/forgot-password` page

**Files:**
- Create: `src/app/forgot-password/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/forgot-password/page.tsx`:

```tsx
"use client"

import { useActionState } from "react"
import Link from "next/link"
import { forgotPassword } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(forgotPassword, null)
  const sent = (state as any)?.success

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            If an account with that email exists, we&apos;ve sent a password reset link.
          </p>
          <Link href="/login" className="text-primary underline underline-offset-4 text-sm">
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Reset password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send a reset link
          </p>
        </div>

        {(state as any)?.error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {(state as any).error}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending..." : "Send reset link"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/forgot-password/page.tsx
git commit -m "feat: add forgot-password page"
```

---

### Task 5: Create `/reset-password` page

**Files:**
- Create: `src/app/reset-password/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/reset-password/page.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useActionState } from "react"
import Link from "next/link"
import { resetPassword } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(resetPassword, null)
  const [hasSession, setHasSession] = useState(false)
  const success = (state as any)?.success

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      setHasSession(true)
    }
  }, [])

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Password updated</h1>
          <p className="text-sm text-muted-foreground">
            Your password has been changed. Sign in with your new password.
          </p>
          <Link href="/login" className="text-primary underline underline-offset-4 text-sm">
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  if (!hasSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Invalid or expired link</h1>
          <p className="text-sm text-muted-foreground">
            This password reset link is invalid or has expired.
          </p>
          <Link href="/forgot-password" className="text-primary underline underline-offset-4 text-sm">
            Request a new link
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Set new password</h1>
        </div>

        {(state as any)?.error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {(state as any).error}
          </div>
        )}

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" required minLength={8} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Updating..." : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/reset-password/page.tsx
git commit -m "feat: add reset-password page"
```

---

### Task 6: Create `/settings/password` page

**Files:**
- Create: `src/app/settings/password/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/settings/password/page.tsx`:

```tsx
"use client"

import { useActionState } from "react"
import { changePassword } from "@/lib/auth-actions"
import { BackButton } from "@/components/back-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(changePassword, null)
  const success = (state as any)?.success

  if (success) {
    return (
      <div className="space-y-4 max-w-md">
        <BackButton />
        <h1 className="text-2xl font-bold tracking-tight">Password updated</h1>
        <p className="text-sm text-muted-foreground">Your password has been changed successfully.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-md">
      <BackButton />
      <h1 className="text-2xl font-bold tracking-tight">Change password</h1>

      {(state as any)?.error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {(state as any).error}
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input id="currentPassword" name="currentPassword" type="password" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" required minLength={8} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Updating..." : "Update password"}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/password/page.tsx
git commit -m "feat: add change password settings page"
```

---

### Task 7: Add navigation links

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/components/user-nav.tsx`

- [ ] **Step 1: Add "Forgot password?" link to login page**

In `src/app/login/page.tsx`, after the password input div (after line with `<Input id="password"...>`), add before the `<Button>`:

```tsx
<div className="text-right">
  <Link href="/forgot-password" className="text-sm text-primary underline underline-offset-4">
    Forgot password?
  </Link>
</div>
```

The import for `Link` is already present.

- [ ] **Step 2: Add "Change Password" link to user nav**

In `src/components/user-nav.tsx`:

Add import for `KeyRound` from lucide-react (alongside existing icons):
```typescript
import { LogOut, Settings, User, Users, KeyRound } from "lucide-react"
```

Add a new link after the "Profile Settings" link (inside `<nav>`, before the `{isOwner && ...}` block):

```tsx
<Link
  href="/settings/password"
  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
>
  <KeyRound className="size-4" />
  Change Password
</Link>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx src/components/user-nav.tsx
git commit -m "feat: add forgot password and change password nav links"
```

---

### Task 8: Configure Supabase redirect URL + final verification

- [ ] **Step 1: Verify redirect URL config**

Check Supabase dashboard Auth > URL Configuration > Redirect URLs includes:
- `http://localhost:3000/reset-password` (dev)
- `https://<production-domain>/reset-password` (prod)

If not already configured, add them.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Push**

```bash
git push
```
