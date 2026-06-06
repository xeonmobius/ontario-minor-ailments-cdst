# Email Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow logged-in users to change their email from profile settings with password verification.

**Architecture:** New `changeEmail` server action re-authenticates with current password, then calls `supabase.auth.updateUser({ email })`. New `auth.email_change` audit event type added to DB enum and TS union. Profile form gets an email field + password field for verification.

**Tech Stack:** Next.js 16, Supabase Auth, vitest

---

### Task 1: Add `auth.email_change` to DB enum + audit type

**Files:**
- Database migration via Supabase MCP
- Modify: `src/lib/audit-actions.ts`

- [ ] **Step 1: Apply migration**

Name: `add_email_change_audit_event`

```sql
ALTER TYPE audit.event_type ADD VALUE 'auth.email_change';
```

- [ ] **Step 2: Update EventType union in audit-actions.ts**

In `src/lib/audit-actions.ts`, add `"auth.email_change"` to the `EventType` union type.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit-actions.ts
git commit -m "feat: add auth.email_change event type"
```

---

### Task 2: Add `changeEmail` server action + test

**Files:**
- Modify: `src/lib/auth-actions.ts`
- Test: `src/__tests__/auth-change-email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/auth-change-email.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { changeEmail } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"

describe("changeEmail", () => {
  it("returns error when current password is wrong", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "old@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: { message: "Invalid login credentials" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn } } as any)

    const formData = new FormData()
    formData.set("email", "new@example.com")
    formData.set("currentPassword", "wrongpass")

    const result = await changeEmail(null, formData)

    expect(result).toEqual({ error: "Current password is incorrect" })
  })

  it("returns error when email is same as current", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "same@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn } } as any)

    const formData = new FormData()
    formData.set("email", "same@example.com")
    formData.set("currentPassword", "correctpass")

    const result = await changeEmail(null, formData)

    expect(result).toEqual({ error: "New email is the same as current email" })
  })

  it("updates email and logs audit on success", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "old@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockResolvedValue({ data: { user: { email: "new@example.com" } }, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn, updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("email", "new@example.com")
    formData.set("currentPassword", "correctpass")

    const result = await changeEmail(null, formData)

    expect(mockSignIn).toHaveBeenCalledWith({ email: "old@example.com", password: "correctpass" })
    expect(mockUpdate).toHaveBeenCalledWith({ email: "new@example.com" })
    expect(result).toEqual({ success: true })
    expect(logAuditEvent).toHaveBeenCalledWith("auth.email_change", { old_email: "old@example.com", new_email: "new@example.com" })
  })

  it("returns error when updateUser fails", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "old@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockResolvedValue({ data: null, error: { message: "Email already registered" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn, updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("email", "taken@example.com")
    formData.set("currentPassword", "correctpass")

    const result = await changeEmail(null, formData)

    expect(result).toEqual({ error: "Email already registered" })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/auth-change-email.test.ts`
Expected: FAIL — `changeEmail` is not exported

- [ ] **Step 3: Write implementation**

Add to end of `src/lib/auth-actions.ts` (after `changePassword`):

```typescript
export async function changeEmail(_prev: any, formData: FormData) {
  const email = formData.get("email") as string
  const currentPassword = formData.get("currentPassword") as string

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user?.email) {
    return { error: "Not authenticated" }
  }

  if (email === userData.user.email) {
    return { error: "New email is the same as current email" }
  }

  const { error: reAuthError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  })

  if (reAuthError) {
    return { error: "Current password is incorrect" }
  }

  const { error } = await supabase.auth.updateUser({ email })

  if (error) {
    return { error: error.message }
  }

  await logAuditEvent("auth.email_change", { old_email: userData.user.email, new_email: email })
  return { success: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/auth-change-email.test.ts`
Expected: PASS (4)

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth-actions.ts src/__tests__/auth-change-email.test.ts
git commit -m "feat: add changeEmail server action with tests"
```

---

### Task 3: Add email change to profile settings form

**Files:**
- Modify: `src/app/settings/profile/profile-form.tsx`

- [ ] **Step 1: Add email field and password verification to profile form**

The profile form currently at `src/app/settings/profile/profile-form.tsx` needs:

1. Accept a new `email` prop (current email from the user's auth data)
2. Add `email` state + `currentPassword` state
3. Add email input (pre-filled with current email, disabled=false) and a current password field
4. Split into two save actions: profile fields save (existing) and email change (new)

The cleanest approach is to add a separate section for email change below the existing profile fields:

Add state variables:
```typescript
const [email, setEmail] = useState(currentEmail)
const [currentPassword, setCurrentPassword] = useState("")
const [emailStatus, setEmailStatus] = useState<{ success?: boolean; error?: string } | null>(null)
```

Add a new `handleEmailChange` function:
```typescript
async function handleEmailChange() {
  const supabase = createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user?.email) return

  if (email === userData.user.email) {
    setEmailStatus({ error: "New email is the same as current email" })
    return
  }

  const { error: reAuthError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  })

  if (reAuthError) {
    setEmailStatus({ error: "Current password is incorrect" })
    return
  }

  const { error } = await supabase.auth.updateUser({ email })
  if (error) {
    setEmailStatus({ error: error.message })
    return
  }

  await logAuditEvent("auth.email_change", { old_email: userData.user.email, new_email: email })
  setEmailStatus({ success: true })
  setCurrentPassword("")
}
```

Update the component props to accept `currentEmail`:
```typescript
export function ProfileForm({
  defaults,
  userId,
  currentEmail,
}: {
  defaults: {
    full_name: string | null
    provincial_license: string | null
    province: string | null
    registration_number: string | null
  } | null
  userId: string
  currentEmail: string
})
```

Add after the existing Save button div (before the closing `</div>` of the form container):

```tsx
<hr className="my-4" />
<p className="text-sm font-medium text-muted-foreground">Change Email</p>
{emailStatus?.error && (
  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
    {emailStatus.error}
  </div>
)}
{emailStatus?.success && (
  <div className="rounded-md bg-green-100 p-3 text-sm text-green-800">
    Email updated successfully.
  </div>
)}
<div className="space-y-2">
  <Label htmlFor="email">Email</Label>
  <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
</div>
<div className="space-y-2">
  <Label htmlFor="currentPasswordForEmail">Current Password</Label>
  <Input id="currentPasswordForEmail" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
</div>
<Button variant="outline" onClick={handleEmailChange}>Update Email</Button>
```

- [ ] **Step 2: Update the profile page to pass currentEmail**

Read `src/app/settings/profile/page.tsx` and add the current user's email as a prop to `ProfileForm`. The email can be obtained from the Supabase auth session or from the profile data.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/profile/profile-form.tsx src/app/settings/profile/page.tsx
git commit -m "feat: add email change to profile settings"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Push**

```bash
git push
```
