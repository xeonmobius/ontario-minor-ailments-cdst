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
