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
