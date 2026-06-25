"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type {
  ConsentCapture,
  PatientInfo,
  PharmacyDefaults,
  VaccinationAdministration,
  VaccinationOutcome,
  WithholdReason,
} from "@/types"
import type { VaccineProduct } from "@/lib/vaccines/catalog"
import { VACCINES, computeCatalogHash } from "@/lib/vaccines/catalog"
import { getWithholdReasonOption } from "@/lib/vaccines/withhold-reasons"
import { StepPatient } from "@/components/wizard/step-patient"
import { VaccinationConsentPanel } from "./vaccination-consent-panel"
import { InventoryPicker, AdministrationForm } from "./inventory-picker"
import { WithholdPanel } from "./withhold-panel"
import { VaccinationRecordPdf } from "./vaccination-record-pdf"
import { downloadPdf } from "@/lib/pdf-helpers"
import { saveVaccinationAction } from "@/lib/vaccination-actions"
import { saveConsentAction } from "@/lib/consent-actions"
import { decrementInventory } from "@/lib/vaccine-inventory"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

const STEP_LABELS = ["Patient", "Contraindication Screen", "Administration", "Consent + Record"]

const defaultPatient: PatientInfo = {
  name: "",
  dob: "",
  sex: "",
  address: "",
  city: "",
  postalCode: "",
  phone: "",
  doctorName: "",
  doctorPhone: "",
  doctorFax: "",
  doctorAddress: "",
  encounterType: "",
}

interface VaccinationWizardProps {
  vaccine: VaccineProduct
  pharmacy: PharmacyDefaults | null
}

export function VaccinationWizard({ vaccine, pharmacy }: VaccinationWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [patient, setPatient] = useState<PatientInfo>(defaultPatient)
  const [contraindicationsChecked, setContraindicationsChecked] = useState<string[]>([])
  const [admin, setAdmin] = useState<VaccinationAdministration | null>(null)
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null)
  const [withholdReason, setWithholdReason] = useState<WithholdReason | null>(null)
  const [withholdNote, setWithholdNote] = useState("")
  const [consent, setConsent] = useState<ConsentCapture | null>(null)
  const [vaccinationClientId] = useState(() => crypto.randomUUID())
  const [generating, setGenerating] = useState(false)

  // A withhold-severity contraindication routes step 2 to the WithholdPanel.
  const hasWithholdContraindication = useMemo(
    () =>
      contraindicationsChecked.some((id) =>
        vaccine.contraindications.some((c) => c.id === id && c.severity === "withhold"),
      ),
    [contraindicationsChecked, vaccine.contraindications],
  )

  // Resolve checked ids → display labels for the VAR PDF + persistence summary.
  const contraindicationLabels = useMemo(
    () =>
      contraindicationsChecked
        .map((id) => vaccine.contraindications.find((c) => c.id === id)?.label ?? id)
        .filter(Boolean),
    [contraindicationsChecked, vaccine.contraindications],
  )

  const isVirtual = patient.encounterType !== "" && patient.encounterType !== "In-Person"

  const outcome: VaccinationOutcome =
    withholdReason === "referred_to_physician"
      ? "referred"
      : hasWithholdContraindication || withholdReason
        ? "withheld"
        : "administered"

  const adminComplete = !!admin && admin.lotNumber.trim() !== "" && admin.expiryDate.trim() !== ""
  const withholdComplete =
    withholdReason !== null && (withholdReason !== "other" || withholdNote.trim().length > 0)
  const decisionComplete = hasWithholdContraindication ? withholdComplete : adminComplete

  const canNext =
    step === 0
      ? !!(patient.name && patient.dob && patient.encounterType) && !isVirtual
      : step === 1
        ? true
        : step === 2
          ? decisionComplete
          : true

  function handleBack() {
    setStep((s) => Math.max(0, s - 1))
  }
  function handleNext() {
    if (!canNext) return
    setStep((s) => Math.min(3, s + 1))
  }

  function toggleContraindication(id: string) {
    setContraindicationsChecked((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function handleGenerate() {
    if (!consent || !decisionComplete) return
    setGenerating(true)
    const dateOfAssessment = new Date().toLocaleDateString("en-CA")
    const reasonOpt = withholdReason ? getWithholdReasonOption(withholdReason) : undefined
    try {
      // 1. Consent (vaccination variant) — Phase-1 no-op stub returns null.
      const consentRes = await saveConsentAction({
        consent,
        patient: { name: patient.name, dob: patient.dob },
        vaccinationId: vaccinationClientId,
        consentType: "vaccination",
      })

      // 2. Administration/withhold record — fail-closed persistence (Phase-1 stub).
      await saveVaccinationAction({
        patient,
        vaccinationClientId,
        vaccineId: vaccine.vaccineId,
        vaccineName: vaccine.name,
        outcome,
        administration: outcome === "administered" ? admin : null,
        withholdReason: outcome !== "administered" ? withholdReason ?? undefined : undefined,
        withholdNote: outcome !== "administered" ? withholdNote : undefined,
        contraindicationsChecked: contraindicationLabels,
        consentId: consentRes.consentId,
      })

      // 3. Inventory decrement (non-PHI; only when a real lot was selected and administered).
      if (selectedLotId && admin && outcome === "administered") {
        try {
          await decrementInventory(selectedLotId)
        } catch (err) {
          console.error("Inventory decrement failed (reconcilable from ledger):", err)
        }
      }

      // 4. Document — produced client-side as the durable legal artefact.
      const doc = (
        <VaccinationRecordPdf
          vaccine={vaccine}
          patient={patient}
          outcome={outcome}
          administration={outcome === "administered" ? admin : null}
          withholdReason={outcome !== "administered" ? withholdReason ?? undefined : undefined}
          withholdNote={outcome !== "administered" ? withholdNote || reasonOpt?.label : undefined}
          contraindicationsChecked={contraindicationLabels}
          consentSignatureDataUrl={consent.signatureDataUrl}
          consentSignerName={consent.signerName}
          consentSignerRelationship={consent.signerRelationship}
          consentCaptureMethod={consent.captureMethod}
          consentStatementVersion={consent.statementVersion}
          consentCapturedAt={consent.capturedAt}
          dateOfAssessment={dateOfAssessment}
          pharmacy={pharmacy}
          protocolVersion={computeCatalogHash(VACCINES)}
        />
      )
      await downloadPdf(doc, `vaccination-${vaccine.vaccineId}-${dateOfAssessment}.pdf`)
    } catch (err) {
      console.error("Vaccination record failed:", err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center size-6 rounded bg-primary/10 text-primary text-xs font-bold">
            {vaccine.vaccineId.slice(0, 2).toUpperCase()}
          </span>
          <h2 className="text-xl font-bold tracking-tight">{vaccine.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground pl-8">
          Vaccination Administration — Ontario pharmacist injecting-agent authority
        </p>
      </div>

      <StepIndicator step={step} labels={STEP_LABELS} />

      <div className="bg-card border rounded-lg p-6">
        <div key={step} className="motion-safe:animate-in flex flex-col gap-6">
          {step === 0 && (
            <>
              <StepPatient patient={patient} onChange={setPatient} />
              {isVirtual && (
                <p className="rounded-md bg-amber-50 p-3 text-sm text-foreground dark:bg-amber-950/30">
                  Vaccines can only be administered in person. Switch the encounter to
                  &ldquo;In-Person&rdquo; to continue, or exit.
                </p>
              )}
            </>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Contraindication Screen</h3>
                <p className="text-xs text-muted-foreground">
                  A pharmacist-worked checklist. Confirm against the patient&apos;s record in your
                  PMS — this tool performs no automated allergy/interaction/pregnancy lookup.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {vaccine.contraindications.map((c) => {
                  const id = `contra-${c.id}`
                  const checked = contraindicationsChecked.includes(c.id)
                  return (
                    <div key={c.id} className="flex flex-col gap-1">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={() => toggleContraindication(c.id)}
                        />
                        <Label htmlFor={id} className="text-sm font-medium leading-snug">
                          {c.label}
                          <span
                            className={`ml-2 text-xs ${c.severity === "withhold" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}
                          >
                            {c.severity === "withhold" ? "Withhold" : "Caution"}
                          </span>
                        </Label>
                      </div>
                      {c.guidance && checked && (
                        <p className="ml-6 text-xs text-muted-foreground">{c.guidance}</p>
                      )}
                    </div>
                  )
                })}
              </div>
              {hasWithholdContraindication && (
                <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  A withhold contraindication is checked — the vaccine will not be administered.
                  Continue to document the withhold or referral.
                </p>
              )}
            </div>
          )}

          {step === 2 && !hasWithholdContraindication && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Administration Details</h3>
                <p className="text-xs text-muted-foreground">
                  Select a lot from inventory or enter one manually, then confirm the dose.
                </p>
              </div>
              <InventoryPicker
                vaccine={vaccine}
                administration={admin}
                selectedLotId={selectedLotId}
                onSelectedLotIdChange={setSelectedLotId}
                onAdministrationChange={setAdmin}
              />
              {admin && (
                <AdministrationForm
                  vaccine={vaccine}
                  administration={admin}
                  onAdministrationChange={setAdmin}
                />
              )}
            </div>
          )}

          {step === 2 && hasWithholdContraindication && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Document Withhold / Referral</h3>
                <p className="text-xs text-muted-foreground">
                  Select the reason the vaccine was not administered.
                </p>
              </div>
              <WithholdPanel
                value={withholdReason}
                note={withholdNote}
                onReasonChange={setWithholdReason}
                onNoteChange={setWithholdNote}
              />
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-6">
              <div className="bg-card border rounded-lg p-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="font-semibold">Patient:</span> {patient.name}</div>
                  <div><span className="font-semibold">DOB:</span> {patient.dob}</div>
                  <div><span className="font-semibold">Vaccine:</span> {vaccine.name}</div>
                  <div><span className="font-semibold">Outcome:</span> {outcome}</div>
                  {outcome === "administered" && admin && (
                    <>
                      <div><span className="font-semibold">Lot:</span> {admin.lotNumber}</div>
                      <div><span className="font-semibold">Dose:</span> {admin.doseNumber} of {admin.seriesTotal}</div>
                    </>
                  )}
                  {outcome !== "administered" && withholdReason && (
                    <div className="col-span-2">
                      <span className="font-semibold">Reason:</span>{" "}
                      {getWithholdReasonOption(withholdReason)?.label ?? withholdReason}
                    </div>
                  )}
                </div>
              </div>
              <VaccinationConsentPanel
                vaccineName={vaccine.name}
                encounterType={patient.encounterType}
                value={consent}
                onChange={setConsent}
              />
              <Button onClick={handleGenerate} disabled={!consent || !decisionComplete || generating}>
                {generating ? "Generating…" : "Download Vaccination Record PDF"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Print and retain this record. It is the durable legal artefact for this vaccination;
                report the administration to COVaxON / your local public health unit.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between pt-2">
        {step === 0 ? (
          <Button variant="outline" onClick={() => router.push("/vaccinate")}>
            Back
          </Button>
        ) : step === 3 ? (
          <Button variant="outline" onClick={() => router.push("/vaccinate")}>
            Done
          </Button>
        ) : (
          <Button variant="outline" onClick={handleBack} disabled={step === 0}>
            Back
          </Button>
        )}
        {step < 3 && (
          <Button onClick={handleNext} disabled={!canNext}>
            Next
          </Button>
        )}
      </div>
    </div>
  )
}

function StepIndicator({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="flex items-center">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center flex-1 last:flex-initial">
          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center justify-center size-7 rounded-full text-xs font-semibold transition-colors duration-200 ${
                i === step
                  ? "bg-primary text-primary-foreground"
                  : i < step
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span
              className={`text-xs font-medium hidden sm:inline transition-colors duration-200 ${
                i === step ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </div>
          {i < labels.length - 1 && (
            <div
              className={`flex-1 h-px mx-3 transition-colors duration-200 ${
                i < step ? "bg-primary/30" : "bg-border"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
