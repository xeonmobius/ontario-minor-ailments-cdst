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
