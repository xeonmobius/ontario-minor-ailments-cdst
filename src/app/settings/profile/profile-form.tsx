"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ProfileForm({
  defaults,
  userId,
}: {
  defaults: {
    full_name: string | null
    provincial_license: string | null
    province: string | null
    registration_number: string | null
  } | null
  userId: string
}) {
  const [fullName, setFullName] = useState(defaults?.full_name ?? "")
  const [provincialLicense, setProvincialLicense] = useState(defaults?.provincial_license ?? "")
  const [province, setProvince] = useState(defaults?.province ?? "Ontario")
  const [registrationNumber, setRegistrationNumber] = useState(defaults?.registration_number ?? "")
  const [saved, setSaved] = useState(false)
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
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.back()}>Back</Button>
        <Button onClick={handleSave}>{saved ? "Saved" : "Save"}</Button>
      </div>
    </div>
  )
}
