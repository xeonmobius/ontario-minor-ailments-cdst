"use client"

import { Ailment, PatientInfo, SelectedRx } from "@/types"
import { getPharmacyDefaults } from "@/lib/pharmacy-storage"
import { downloadPdf } from "@/lib/pdf-helpers"
import { PrescriptionPdf } from "@/components/prescription-pdf"
import { NotificationPdf } from "@/components/notification-pdf"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface StepGenerateProps {
  ailment: Ailment
  patient: PatientInfo
  selectedRx: SelectedRx
  assessmentNotes: string
}

export function StepGenerate({ ailment, patient, selectedRx, assessmentNotes }: StepGenerateProps) {
  const dateOfAssessment = new Date().toLocaleDateString("en-CA")

  async function handleDownloadPrescription() {
    const doc = <PrescriptionPdf
      ailment={ailment}
      patient={patient}
      selectedRx={selectedRx}
      assessmentNotes={assessmentNotes}
      dateOfAssessment={dateOfAssessment}
    />
    await downloadPdf(doc, `prescription-${patient.name.replace(/\s+/g, "-").toLowerCase()}.pdf`)
  }

  async function handleDownloadNotification() {
    const pharmacy = getPharmacyDefaults()
    const doc = <NotificationPdf
      ailment={ailment}
      patient={patient}
      selectedRx={selectedRx}
      assessmentNotes={assessmentNotes}
      dateOfAssessment={dateOfAssessment}
      pharmacy={pharmacy}
    />
    await downloadPdf(doc, `notification-${patient.name.replace(/\s+/g, "-").toLowerCase()}.pdf`)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Assessment Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
        <Button onClick={handleDownloadPrescription}>
          Download Prescription PDF
        </Button>
        <Button variant="outline" onClick={handleDownloadNotification}>
          Download Doctor Notification PDF
        </Button>
      </div>
    </div>
  )
}
