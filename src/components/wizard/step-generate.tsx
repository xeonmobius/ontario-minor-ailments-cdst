"use client"

import { useState } from "react"
import { Ailment, ConsentCapture, PatientInfo, PharmacistSignature, PharmacistSigningState, PharmacyDefaults, SelectedRx } from "@/types"
import { downloadPdf } from "@/lib/pdf-helpers"
import { CombinedPdf } from "@/components/combined-pdf"
import { PatientInstructionsPdf } from "@/components/patient-instructions-pdf"
import { ConsentPanel } from "@/components/consent/consent-panel"
import { PharmacistSignaturePanel } from "@/components/signature/pharmacist-signature-panel"
import { reserveTxId } from "@/lib/prescription-actions"
import { saveAssessment } from "@/lib/phi/assessment-store"
import { saveConsentAction } from "@/lib/consent-actions"
import { applySignatureAction } from "@/lib/signature-actions"
import { getPatientInstructions, type Language } from "@/lib/i18n/patient-instructions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface StepGenerateProps {
  ailment: Ailment
  patient: PatientInfo
  selectedRx: SelectedRx
  assessmentNotes: string
  symptomsChecked: string[]
  nonRxChecked: string[]
  pharmacy?: PharmacyDefaults | null
  consent: ConsentCapture | null
  onConsentChange: (c: ConsentCapture | null) => void
  enrolledSignature: PharmacistSignature | null
  signing: PharmacistSigningState | null
  onSigningChange: (s: PharmacistSigningState | null) => void
}

export function StepGenerate({ ailment, patient, selectedRx, assessmentNotes, symptomsChecked, nonRxChecked, pharmacy, consent, onConsentChange, enrolledSignature, signing, onSigningChange }: StepGenerateProps) {
  const dateOfAssessment = new Date().toLocaleDateString("en-CA")
  const [txId, setTxId] = useState<string | null>(null)
  const [handoutLanguage, setHandoutLanguage] = useState<Language | "both">("en")
  // FR/Both are offered only for ailments with a curated FR corpus (spec §6
  // case 1). Graceful degradation: an un-curated ailment falls back to EN.
  const frAvailable = getPatientInstructions(ailment.slug, "fr") !== undefined
  const handoutDate = new Date().toLocaleDateString(
    handoutLanguage === "fr" ? "fr-CA" : "en-CA",
  )

  async function handleDownload() {
    if (!consent || !signing) return
    try {
      let resolvedTxId = txId
      if (!resolvedTxId) {
        const result = await reserveTxId()
        if (result.error) return
        resolvedTxId = result.txId ?? null
        setTxId(resolvedTxId)
      }
      // Consent authorises the act of recording, so it is captured first
      // (fail-closed: a persistence error here blocks the document). Phase 1
      // no-op stub returns null; the signature is baked onto the PDF regardless.
      const consentRes = await saveConsentAction({
        consent,
        patient: { name: patient.name, dob: patient.dob },
        assessmentTxId: resolvedTxId ?? undefined,
      })
      // Pharmacist e-signature per-act binding (roadmap #11). Phase-1 no-op
      // stub returns nulls; the stroke renders on the PDF from React state.
      const sigRes = resolvedTxId
        ? await applySignatureAction({ assessmentTxId: resolvedTxId })
        : { signedAt: null, signatureId: null }
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
        consentSignatureDataUrl={consent.signatureDataUrl}
        consentSignerName={consent.signerName}
        consentSignerRelationship={consent.signerRelationship}
        consentCaptureMethod={consent.captureMethod}
        consentStatementVersion={consent.statementVersion}
        consentCapturedAt={consent.capturedAt}
        pharmacistSignatureDataUrl={signing.signatureDataUrl}
        pharmacistSignedAt={(sigRes.signedAt ?? signing.signedAt) ?? undefined}
        pharmacistAttestationVersion={signing.attestationVersion}
      />
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
          consentId: consentRes.consentId ?? undefined,
          pharmacistSignatureId: sigRes.signatureId ?? undefined,
          signedAt: sigRes.signedAt ?? undefined,
          signingAttestationVersion: sigRes.signatureId ? signing.attestationVersion : undefined,
        })
      }
    } catch (err) {
      console.error("PDF download failed:", err)
    }
  }

  async function handleDownloadHandout() {
    try {
      const doc = <PatientInstructionsPdf
        ailment={ailment}
        selectedRx={selectedRx}
        nonRxChecked={nonRxChecked}
        pharmacy={pharmacy ?? null}
        language={handoutLanguage}
        dateOfAssessment={handoutDate}
      />
      // The handout is a patient education sheet, not a prescription: it does
      // NOT consume a tx id and does NOT write to the PHI store (spec §6 case 6).
      await downloadPdf(doc, `patient-instructions-${handoutDate}.pdf`)
    } catch (err) {
      console.error("Handout download failed:", err)
    }
  }

  const languageOptions: Array<{ value: Language | "both"; label: string; disabled: boolean }> = [
    { value: "en", label: "EN", disabled: false },
    { value: "fr", label: "FR", disabled: !frAvailable },
    { value: "both", label: "Both", disabled: !frAvailable },
  ]

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

      <ConsentPanel
        ailmentName={ailment.name}
        pharmacyName={pharmacy?.pharmacyName ?? ""}
        encounterType={patient.encounterType}
        value={consent}
        onChange={onConsentChange}
      />

      <PharmacistSignaturePanel
        enrolled={enrolledSignature}
        pharmacistName={pharmacy?.pharmacistName ?? ""}
        license={pharmacy?.provincialLicense ?? null}
        documentType="prescription"
        value={signing}
        onChange={onSigningChange}
      />

      <div className="flex flex-col gap-3">
        <Button onClick={handleDownload} disabled={!consent || !signing}>
          Download Prescription + Doctor Notification PDF
        </Button>
        <p className="text-xs text-muted-foreground">
          {consent && signing
            ? "Combined single-page document with full clinical documentation, prescription, physician notification, and your applied signature. Print and fax to the physician."
            : "Capture patient consent and your signature above before producing the document."}
        </p>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Patient Handout</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Bilingual patient-instruction sheet for this ailment (self-care, follow-up, safety-net). Separate from the clinical record above; safe to hand to the patient.
          </p>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Language</span>
            <div role="group" aria-label="Patient handout language" className="flex gap-1">
              {languageOptions.map((opt) => {
                const active = handoutLanguage === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    disabled={opt.disabled}
                    title={opt.disabled ? "French version coming soon" : undefined}
                    onClick={() => setHandoutLanguage(opt.value)}
                    className={cn(
                      "h-8 rounded-lg border px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-muted hover:text-foreground",
                      opt.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
          <Button variant="outline" onClick={handleDownloadHandout}>
            Download Patient Instructions
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
