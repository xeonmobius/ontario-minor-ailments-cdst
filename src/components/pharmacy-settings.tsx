"use client"

import { useState, useEffect } from "react"
import { Settings } from "lucide-react"
import { PharmacyDefaults } from "@/types"
import { getPharmacyDefaults, savePharmacyDefaults } from "@/lib/pharmacy-storage"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const emptyDefaults: PharmacyDefaults = {
  pharmacyName: "",
  address: "",
  city: "",
  province: "Ontario",
  postalCode: "",
  phone: "",
  fax: "",
  pharmacistName: "",
  ocpLicense: "",
  registrationNumber: "",
}

export function PharmacySettings() {
  const [data, setData] = useState<PharmacyDefaults>(emptyDefaults)

  useEffect(() => {
    const saved = getPharmacyDefaults()
    if (saved) setData(saved)
  }, [])

  function handleChange(field: keyof PharmacyDefaults, value: string) {
    setData((prev) => ({ ...prev, [field]: value }))
  }

  function handleSave() {
    savePharmacyDefaults(data)
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="icon" aria-label="Pharmacy settings" />
        }
      >
        <Settings className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pharmacy Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {(
            [
              ["pharmacyName", "Pharmacy Name"],
              ["address", "Address"],
              ["city", "City"],
              ["postalCode", "Postal Code"],
              ["phone", "Phone"],
              ["fax", "Fax"],
              ["pharmacistName", "Pharmacist Name"],
              ["ocpLicense", "OCP License"],
              ["registrationNumber", "Registration Number"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="grid gap-1">
              <Label htmlFor={field}>{label}</Label>
              <Input
                id={field}
                value={data[field]}
                onChange={(e) => handleChange(field, e.target.value)}
              />
            </div>
          ))}
          <div className="grid gap-1">
            <Label htmlFor="province">Province</Label>
            <Input id="province" value={data.province} disabled />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <DialogClose render={<Button onClick={handleSave} />}>Save</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
