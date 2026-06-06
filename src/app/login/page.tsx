"use client"

import { useState, useActionState } from "react"
import Link from "next/link"
import { login } from "@/lib/auth-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Ontario Minor Ailments CDST
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
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          <div className="text-right">
            <Link href="/forgot-password" className="text-sm text-primary underline underline-offset-4">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
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