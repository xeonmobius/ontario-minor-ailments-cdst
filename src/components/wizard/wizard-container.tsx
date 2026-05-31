"use client"

import { useState } from "react"
import { Ailment, PatientInfo, SelectedRx } from "@/types"
import { WizardNav, StepIndicator } from "./wizard-nav"
import { StepPatient } from "./step-patient"
import { StepRedFlags } from "./step-redflags"
import { StepRx } from "./step-rx"
import { StepGenerate } from "./step-generate"

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
}

interface WizardContainerProps {
  ailment: Ailment
}

export function WizardContainer({ ailment }: WizardContainerProps) {
  const [step, setStep] = useState(0)
  const [patient, setPatient] = useState<PatientInfo>(defaultPatient)
  const [redFlagsChecked, setRedFlagsChecked] = useState<string[]>([])
  const [symptomsChecked, setSymptomsChecked] = useState<string[]>([])
  const [assessmentNotes, setAssessmentNotes] = useState("")
  const [selectedRx, setSelectedRx] = useState<SelectedRx | null>(null)
  const [nonRxChecked, setNonRxChecked] = useState<string[]>([])

  const canNext =
    step === 0
      ? !!(patient.name && patient.dob)
      : step === 1
        ? redFlagsChecked.length === 0
        : step === 2
          ? selectedRx !== null
          : true

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
  }

  function handleSelectedRxChange(rx: SelectedRx) {
    setSelectedRx(rx)
  }

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
            />
          )}
          {step === 3 && selectedRx && (
            <StepGenerate
              ailment={ailment}
              patient={patient}
              selectedRx={selectedRx}
              assessmentNotes={assessmentNotes}
              symptomsChecked={symptomsChecked}
              nonRxChecked={nonRxChecked}
            />
          )}
        </div>
      </div>

      <WizardNav step={step} canNext={canNext} onBack={handleBack} onNext={handleNext} />
    </div>
  )
}
