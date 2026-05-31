"use client"

import { Ailment, PatientInfo, SelectedRx } from "@/types"
import { getPharmacyDefaults } from "@/lib/pharmacy-storage"
import { downloadPdf } from "@/lib/pdf-helpers"
import { CombinedPdf } from "@/components/combined-pdf"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface StepGenerateProps {
  ailment: Ailment
  patient: PatientInfo
  selectedRx: SelectedRx
  assessmentNotes: string
  symptomsChecked: string[]
  nonRxChecked: string[]
}

export function StepGenerate({ ailment, patient, selectedRx, assessmentNotes, symptomsChecked, nonRxChecked }: StepGenerateProps) {
  const dateOfAssessment = new Date().toLocaleDateString("en-CA")

  async function handleDownload() {
    const pharmacy = getPharmacyDefaults()
    const doc = <CombinedPdf
      ailment={ailment}
      patient={patient}
      selectedRx={selectedRx}
      assessmentNotes={assessmentNotes}
      dateOfAssessment={dateOfAssessment}
      pharmacy={pharmacy}
      symptomsChecked={symptomsChecked}
      nonRxChecked={nonRxChecked}
    />
    await downloadPdf(doc, `prescription-${patient.name.replace(/\s+/g, "-").toLowerCase()}.pdf`)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Assessment Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="font-semibold">Patient:</span> {patient.name}</div>
            <div><span className="font-semibold">DOB:</span> {patient.dob}</div>
            <div><span className="font-semibold">Ailment:</span> {ailment.name}</div>
            <div><span className="font-semibold">Drug:</span> {selectedRx.drug}</div>
            <div><span className="font-semibold">Dose:</span> {selectedRx.dose}</div>
            <div><span className="font-semibold">Directions:</span> {selectedRx.sig}</div>
            <div><span className="font-semibold">Date:</span> {dateOfAssessment}</div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex flex-col gap-3">
        <Button onClick={handleDownload}>
          Download Prescription + Doctor Notification PDF
        </Button>
        <p className="text-xs text-muted-foreground">
          Combined single-page document with full clinical documentation, prescription, physician notification, and signature lines. Print, sign, and fax to the physician.
        </p>
      </div>
    </div>
  )
}
