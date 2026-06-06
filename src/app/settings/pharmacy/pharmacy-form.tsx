"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function PharmacyForm({
  pharmacy,
}: {
  pharmacy: {
    id: string
    name: string
    address: string
    city: string
    province: string
    postal_code: string
    phone: string
    fax: string
  }
}) {
  const [name, setName] = useState(pharmacy.name)
  const [address, setAddress] = useState(pharmacy.address)
  const [city, setCity] = useState(pharmacy.city)
  const [postalCode, setPostalCode] = useState(pharmacy.postal_code)
  const [phone, setPhone] = useState(pharmacy.phone)
  const [fax, setFax] = useState(pharmacy.fax)
  const [saved, setSaved] = useState(false)
  const router = useRouter()

  async function handleSave() {
    const supabase = createClient()
    await supabase
      .from("pharmacies")
      .update({
        name,
        address,
        city,
        postal_code: postalCode,
        phone,
        fax,
      })
      .eq("id", pharmacy.id)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="name">Pharmacy Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="postalCode">Postal Code</Label>
          <Input id="postalCode" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="province">Province</Label>
        <Input id="province" value={pharmacy.province} disabled />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fax">Fax</Label>
          <Input id="fax" value={fax} onChange={(e) => setFax(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.back()}>Back</Button>
        <Button onClick={handleSave}>{saved ? "Saved" : "Save"}</Button>
      </div>
    </div>
  )
}
