"use client"

import { useActionState } from "react"
import { changePassword } from "@/lib/auth-actions"
import { PageShell } from "@/components/page-shell"
import { ErrorBanner } from "@/components/error-banner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ActionState } from "@/lib/action-state"

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(changePassword, null)
  const success = (state as ActionState | null)?.success

  if (success) {
    return (
      <PageShell title="Change password" mainClassName="max-w-md space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">Password updated</h2>
        <p className="text-sm text-muted-foreground">Your password has been changed successfully.</p>
      </PageShell>
    )
  }

  return (
    <PageShell title="Change password" mainClassName="max-w-md space-y-6">
      {(state as ActionState | null)?.error && <ErrorBanner>{(state as ActionState).error}</ErrorBanner>}

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
    </PageShell>
  )
}
