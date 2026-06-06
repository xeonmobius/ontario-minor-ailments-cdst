"use client"

import { PatientInfo } from "@/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"

interface StepPatientProps {
  patient: PatientInfo
  onChange: (patient: PatientInfo) => void
}

export function StepPatient({ patient, onChange }: StepPatientProps) {
  function handleChange(field: keyof PatientInfo, value: string) {
    onChange({ ...patient, [field]: value })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Patient Name *</Label>
          <Input
            id="name"
            value={patient.name}
            onChange={(e) => handleChange("name", e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dob">Date of Birth *</Label>
          <Input
            id="dob"
            type="date"
            value={patient.dob}
            onChange={(e) => handleChange("dob", e.target.value)}
            max={new Date().toISOString().split("T")[0]}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Sex *</Label>
          <div className="flex gap-4 pt-2">
            {["Male", "Female", "Other"].map((option) => {
              const id = `sex-${option.toLowerCase()}`
              return (
                <div key={option} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={patient.sex === option}
                    onCheckedChange={() => handleChange("sex", patient.sex === option ? "" : option)}
                  />
                  <Label htmlFor={id} className="text-sm cursor-pointer">{option}</Label>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ohip">OHIP Number</Label>
          <Input
            id="ohip"
            value={patient.ohip}
            onChange={(e) => handleChange("ohip", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={patient.phone}
            onChange={(e) => handleChange("phone", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="address">Address</Label>
          <Input
            id="address"
            value={patient.address}
            onChange={(e) => handleChange("address", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={patient.city}
            onChange={(e) => handleChange("city", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="postalCode">Postal Code</Label>
          <Input
            id="postalCode"
            value={patient.postalCode}
            onChange={(e) => handleChange("postalCode", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="allergies">Allergies</Label>
          <Input
            id="allergies"
            value={patient.allergies}
            onChange={(e) => handleChange("allergies", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <Label htmlFor="currentMeds">Current Medications</Label>
          <Textarea
            id="currentMeds"
            value={patient.currentMeds}
            onChange={(e) => handleChange("currentMeds", e.target.value)}
            aria-label="Current medications"
          />
        </div>
      </div>

      <Separator />

      <p className="text-sm font-medium text-muted-foreground">Family Physician (optional)</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="doctorName">Doctor Name</Label>
          <Input
            id="doctorName"
            value={patient.doctorName}
            onChange={(e) => handleChange("doctorName", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doctorLicense">License #</Label>
          <Input
            id="doctorLicense"
            value={patient.doctorLicense}
            onChange={(e) => handleChange("doctorLicense", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doctorPhone">Phone</Label>
          <Input
            id="doctorPhone"
            value={patient.doctorPhone}
            onChange={(e) => handleChange("doctorPhone", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doctorFax">Fax</Label>
          <Input
            id="doctorFax"
            value={patient.doctorFax}
            onChange={(e) => handleChange("doctorFax", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2 md:col-span-2">
          <Label htmlFor="doctorAddress">Address</Label>
          <Input
            id="doctorAddress"
            value={patient.doctorAddress}
            onChange={(e) => handleChange("doctorAddress", e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
