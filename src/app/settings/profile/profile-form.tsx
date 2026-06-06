"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { logAuditEvent } from "@/lib/audit-actions"

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
}) {
  const [fullName, setFullName] = useState(defaults?.full_name ?? "")
  const [provincialLicense, setProvincialLicense] = useState(defaults?.provincial_license ?? "")
  const [province, setProvince] = useState(defaults?.province ?? "Ontario")
  const [registrationNumber, setRegistrationNumber] = useState(defaults?.registration_number ?? "")
  const [saved, setSaved] = useState(false)
  const [email, setEmail] = useState(currentEmail)
  const [currentPassword, setCurrentPassword] = useState("")
  const [emailStatus, setEmailStatus] = useState<{ success?: boolean; error?: string } | null>(null)
  const router = useRouter()

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
      .eq("id", userId)
    await logAuditEvent("profile.updated", { changed: ["full_name", "provincial_license", "province", "registration_number"].filter(f => {
      const orig: Record<string, string> = { full_name: defaults?.full_name ?? "", provincial_license: defaults?.provincial_license ?? "", province: defaults?.province ?? "Ontario", registration_number: defaults?.registration_number ?? "" }
      const curr: Record<string, string> = { full_name: fullName, provincial_license: provincialLicense, province, registration_number: registrationNumber }
      return orig[f] !== curr[f]
    }).join(",") }, "profile", userId)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

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
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.back()}>Back</Button>
        <Button onClick={handleSave}>{saved ? "Saved" : "Save"}</Button>
      </div>
      <Separator />
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
    </div>
  )
}
