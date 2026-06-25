"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  AbandonmentReason,
  Ailment,
  NonPrescribeReason,
  PatientInfo,
  PharmacyDefaults,
  SelectedRx,
} from "@/types"
import { WizardNav, StepIndicator } from "./wizard-nav"
import { StepPatient } from "./step-patient"
import { StepRedFlags } from "./step-redflags"
import { StepRx } from "./step-rx"
import { StepGenerate } from "./step-generate"
import { ReferralPdf } from "./referral-pdf"
import { NonPrescribePdf } from "./non-prescribe-pdf"
import { AbandonDialog } from "./abandon-dialog"
import { downloadPdf } from "@/lib/pdf-helpers"
import { reserveTxId } from "@/lib/prescription-actions"
import { saveAssessment } from "@/lib/phi/assessment-store"
import {
  NON_PRESCRIBE_REASONS,
  REASON_TAXONOMY_VERSION,
  computeReasonTaxonomyHash,
  getReasonOption,
} from "@/lib/non-prescribe/reasons"
import { Button } from "@/components/ui/button"

const defaultPatient: PatientInfo = {
  name: "",
  dob: "",
  sex: "",
  ohip: "",
  address: "",
  city: "",
  postalCode: "",
  phone: "",
  allergies: "NKDA",
  currentMeds: "",
  doctorName: "",
  doctorLicense: "",
  doctorPhone: "",
  doctorFax: "",
  doctorAddress: "",
  encounterType: "",
  pregnant: false,
  breastfeeding: false,
}

interface WizardContainerProps {
  ailment: Ailment
  pharmacy: PharmacyDefaults | null
}

export function WizardContainer({ ailment, pharmacy }: WizardContainerProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [patient, setPatient] = useState<PatientInfo>(defaultPatient)
  const [redFlagsChecked, setRedFlagsChecked] = useState<string[]>([])
  const [symptomsChecked, setSymptomsChecked] = useState<string[]>([])
  const [assessmentNotes, setAssessmentNotes] = useState("")
  const [selectedRx, setSelectedRx] = useState<SelectedRx | null>(null)
  const [nonRxChecked, setNonRxChecked] = useState<string[]>([])
  const [isReferral, setIsReferral] = useState(false)

  const [nonPrescribeReason, setNonPrescribeReason] = useState<NonPrescribeReason | null>(null)
  const [nonPrescribeRationale, setNonPrescribeRationale] = useState("")
  const [abandonOpen, setAbandonOpen] = useState(false)

  const hasRedFlags = redFlagsChecked.length > 0
  const isNonPrescribe = nonPrescribeReason !== null

  const canNext =
    step === 0
      ? !!(patient.name && patient.dob)
      : step === 1
        ? redFlagsChecked.length === 0
        : step === 2
          ? selectedRx !== null || nonPrescribeReason !== null
          : true

  const rationaleValid =
    nonPrescribeReason !== "other" || nonPrescribeRationale.trim().length > 0
  const canDownloadNonPrescribe = !!nonPrescribeReason && rationaleValid

  function handleBack() {
    setStep((s) => Math.max(0, s - 1))
  }

  function handleNext() {
    if (!canNext) return
    setStep((s) => Math.min(3, s + 1))
  }

  function handleSelectRx(rx: Ailment["rxOptions"][number]) {
    setSelectedRx({
      ...rx,
      sig: rx.dose,
      quantity: "1",
      refills: "0",
      duration: "",
    })
    setNonPrescribeReason(null)
    setNonPrescribeRationale("")
  }

  function handleSelectedRxChange(rx: SelectedRx) {
    setSelectedRx(rx)
  }

  function handleNonPrescribeReasonChange(reason: NonPrescribeReason | null) {
    setNonPrescribeReason(reason)
    if (reason !== null) {
      setSelectedRx(null)
    }
  }

  function handleReferral() {
    setIsReferral(true)
    setStep(3)
  }

  async function handleDownloadReferral() {
    const dateOfAssessment = new Date().toLocaleDateString("en-CA")
    const result = await reserveTxId()
    const txId = result.txId ?? null
    const doc = <ReferralPdf
      ailment={ailment}
      patient={patient}
      redFlagsChecked={redFlagsChecked}
      dateOfAssessment={dateOfAssessment}
      pharmacy={pharmacy}
    />
    await downloadPdf(doc, `referral-${dateOfAssessment}${txId ? `-${txId}` : ""}.pdf`)
    if (txId) {
      await saveAssessment({
        patient,
        ailmentId: ailment.id,
        ailmentName: ailment.name,
        txId,
        redFlagsChecked,
        hasRedFlag: true,
        symptomsChecked,
        assessmentNotes,
        selectedRx: selectedRx,
        nonRxChecked,
        isReferral: true,
        outcome: "referred",
      })
    }
  }

  async function handleDownloadNonPrescribe() {
    if (!canDownloadNonPrescribe || !nonPrescribeReason) return
    const dateOfAssessment = new Date().toLocaleDateString("en-CA")
    const reasonOption = getReasonOption(nonPrescribeReason)
    const reasonLabel = reasonOption?.label ?? nonPrescribeReason

    try {
      if (nonPrescribeReason === "referred_to_physician") {
        const doc = (
          <ReferralPdf
            ailment={ailment}
            patient={patient}
            redFlagsChecked={[]}
            dateOfAssessment={dateOfAssessment}
            pharmacy={pharmacy}
            referralContext="non_red_flag"
            referralReason={nonPrescribeRationale}
          />
        )
        await downloadPdf(doc, `referral-${dateOfAssessment}.pdf`)
      } else {
        const doc = (
          <NonPrescribePdf
            ailment={ailment}
            patient={patient}
            reason={nonPrescribeReason}
            reasonLabel={reasonLabel}
            rationale={nonPrescribeRationale}
            nonRxChecked={nonRxChecked}
            assessmentNotes={assessmentNotes}
            dateOfAssessment={dateOfAssessment}
            pharmacy={pharmacy}
          />
        )
        await downloadPdf(doc, `non-prescribe-${dateOfAssessment}.pdf`)
      }

      const result = await reserveTxId()
      const txId = result.txId ?? ""
      await saveAssessment({
        patient,
        ailmentId: ailment.id,
        ailmentName: ailment.name,
        txId,
        redFlagsChecked,
        hasRedFlag: false,
        symptomsChecked,
        assessmentNotes,
        selectedRx: null,
        nonRxChecked,
        isReferral: false,
        outcome: "not_prescribed",
        nonPrescribeReason,
        nonPrescribeRationale: nonPrescribeRationale || undefined,
        reasonTaxonomyVersion: REASON_TAXONOMY_VERSION,
        reasonTaxonomyHash: computeReasonTaxonomyHash(NON_PRESCRIBE_REASONS),
      })
    } catch (err) {
      console.error("Non-prescribe document failed:", err)
    }
  }

  async function handleAbandon(reason: AbandonmentReason, note: string) {
    setAbandonOpen(false)
    if (patient.name && patient.dob) {
      try {
        await saveAssessment({
          patient,
          ailmentId: ailment.id,
          ailmentName: ailment.name,
          txId: "",
          redFlagsChecked,
          hasRedFlag: hasRedFlags,
          symptomsChecked,
          assessmentNotes: note,
          selectedRx: null,
          nonRxChecked,
          isReferral: false,
          outcome: "abandoned",
          abandonmentReason: reason,
        })
      } catch (err) {
        console.error("Abandoned-save failed:", err)
      }
    }
    router.push("/")
  }

  const reasonOption = getReasonOption(nonPrescribeReason)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center size-6 rounded bg-primary/10 text-primary text-xs font-bold">
            {ailment.id.split("-")[0]}
          </span>
          <h2 className="text-xl font-bold tracking-tight">{ailment.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground pl-8">Ontario Minor Ailment Assessment — O. Reg. 256/24</p>
      </div>

      <StepIndicator step={step} />

      <div className="bg-card border rounded-lg p-6">
        <div
          key={step}
          className="motion-safe:animate-in"
        >
          {step === 0 && <StepPatient patient={patient} onChange={setPatient} />}
          {step === 1 && (
            <StepRedFlags
              ailment={ailment}
              redFlagsChecked={redFlagsChecked}
              onRedFlagChange={setRedFlagsChecked}
              symptomsChecked={symptomsChecked}
              onSymptomChange={setSymptomsChecked}
              assessmentNotes={assessmentNotes}
              onNotesChange={setAssessmentNotes}
            />
          )}
          {step === 2 && (
            <StepRx
              ailment={ailment}
              selectedRx={selectedRx}
              onSelect={handleSelectRx}
              onSelectedRxChange={handleSelectedRxChange}
              nonRxChecked={nonRxChecked}
              onNonRxChange={setNonRxChecked}
              nonPrescribeReason={nonPrescribeReason}
              onNonPrescribeReasonChange={handleNonPrescribeReasonChange}
              nonPrescribeRationale={nonPrescribeRationale}
              onNonPrescribeRationaleChange={setNonPrescribeRationale}
            />
          )}
          {step === 3 && isReferral && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <span className="text-destructive text-lg">⚠</span>
                <h3 className="text-lg font-semibold">Referral Required</h3>
              </div>
              <p className="text-sm text-muted-foreground">Red flag(s) detected — this patient must be referred to their primary care physician.</p>
              <div className="bg-card border rounded-lg p-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="font-semibold">Patient:</span> {patient.name}</div>
                  <div><span className="font-semibold">DOB:</span> {patient.dob}</div>
                  <div><span className="font-semibold">Ailment:</span> {ailment.name}</div>
                  {patient.doctorName && <div><span className="font-semibold">Physician:</span> Dr. {patient.doctorName}</div>}
                </div>
                <div className="mt-3">
                  <span className="font-semibold text-sm">Red Flags:</span>
                  <ul className="mt-1 flex flex-col gap-1">
                    {redFlagsChecked.map((flag) => (
                      <li key={flag} className="text-sm text-destructive flex items-center gap-2">
                        <span>⚠</span> {flag}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <Button variant="destructive" onClick={handleDownloadReferral}>
                Download Referral PDF
              </Button>
              <p className="text-xs text-muted-foreground">Print, sign, and fax this referral to the patient&apos;s family physician.</p>
            </div>
          )}
          {step === 3 && isNonPrescribe && nonPrescribeReason && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">No Prescription Issued</h3>
              </div>
              <div className="bg-card border rounded-lg p-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="font-semibold">Patient:</span> {patient.name}</div>
                  <div><span className="font-semibold">DOB:</span> {patient.dob}</div>
                  <div><span className="font-semibold">Ailment:</span> {ailment.name}</div>
                  <div><span className="font-semibold">Reason:</span> {reasonOption?.label ?? nonPrescribeReason}</div>
                </div>
                {nonPrescribeRationale && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">Rationale:</span> {nonPrescribeRationale}
                  </p>
                )}
                {nonRxChecked.length > 0 && (
                  <div className="mt-3">
                    <span className="font-semibold text-sm">Self-care advice discussed:</span>
                    <ul className="mt-1 flex flex-col gap-1">
                      {nonRxChecked.map((item) => (
                        <li key={item} className="text-sm flex items-center gap-2">
                          <span>✓</span> {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <Button onClick={handleDownloadNonPrescribe} disabled={!canDownloadNonPrescribe}>
                Download Non-Prescribe Documentation PDF
              </Button>
              {!rationaleValid && (
                <p className="text-xs text-destructive">
                  A clinical rationale is required when &quot;Other&quot; is selected.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Print and retain this record. It is the durable legal artefact for this assessment.
              </p>
            </div>
          )}
          {step === 3 && !isReferral && !isNonPrescribe && selectedRx && (
            <StepGenerate
              ailment={ailment}
              patient={patient}
              selectedRx={selectedRx}
              assessmentNotes={assessmentNotes}
              symptomsChecked={symptomsChecked}
              nonRxChecked={nonRxChecked}
              pharmacy={pharmacy}
            />
          )}
        </div>
      </div>

      <WizardNav step={step} canNext={canNext} onBack={handleBack} onNext={handleNext} hasRedFlags={hasRedFlags && step === 1} onReferral={handleReferral} />

      <div className="flex justify-center pt-1">
        <Button variant="link" className="text-muted-foreground text-xs" onClick={() => setAbandonOpen(true)}>
          Assessment Not Completed
        </Button>
      </div>
      <AbandonDialog
        open={abandonOpen}
        hasPatientIdentity={!!(patient.name && patient.dob)}
        onCancel={() => setAbandonOpen(false)}
        onConfirm={handleAbandon}
      />
    </div>
  )
}
