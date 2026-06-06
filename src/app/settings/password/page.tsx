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
