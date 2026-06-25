"use client"

import { useState } from "react"
import { Ailment, PatientInfo, PharmacyDefaults, SelectedRx } from "@/types"
import { downloadPdf } from "@/lib/pdf-helpers"
import { CombinedPdf } from "@/components/combined-pdf"
import { reserveTxId } from "@/lib/prescription-actions"
import { saveAssessment } from "@/lib/phi/assessment-store"
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
  pharmacy?: PharmacyDefaults | null
}

export function StepGenerate({ ailment, patient, selectedRx, assessmentNotes, symptomsChecked, nonRxChecked, pharmacy }: StepGenerateProps) {
  const dateOfAssessment = new Date().toLocaleDateString("en-CA")
  const [txId, setTxId] = useState<string | null>(null)

  async function handleDownload() {
    try {
      let resolvedTxId = txId
      if (!resolvedTxId) {
        const result = await reserveTxId()
        if (result.error) return
        resolvedTxId = result.txId ?? null
        setTxId(resolvedTxId)
      }
      const doc = <CombinedPdf
        ailment={ailment}
        patient={patient}
        selectedRx={selectedRx}
        assessmentNotes={assessmentNotes}
        dateOfAssessment={dateOfAssessment}
        pharmacy={pharmacy ?? null}
        symptomsChecked={symptomsChecked}
        nonRxChecked={nonRxChecked}
        txId={resolvedTxId ?? undefined}
      />
      console.log("PDF patient data:", JSON.stringify({ doctorName: patient.doctorName, doctorLicense: patient.doctorLicense, doctorPhone: patient.doctorPhone, doctorFax: patient.doctorFax, doctorAddress: patient.doctorAddress }))
      await downloadPdf(doc, `prescription-${dateOfAssessment}-${resolvedTxId ?? "draft"}.pdf`)
      if (resolvedTxId) {
        await saveAssessment({
          patient,
          ailmentId: ailment.id,
          ailmentName: ailment.name,
          txId: resolvedTxId,
          redFlagsChecked: [],
          hasRedFlag: false,
          symptomsChecked,
          assessmentNotes,
          selectedRx,
          nonRxChecked,
          isReferral: false,
        })
      }
    } catch (err) {
      console.error("PDF download failed:", err)
    }
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
