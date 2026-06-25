"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import type { CaptureMethod, ConsentCapture, SignerRelationship } from "@/types"
import {
  VACCINATION_CONSENT_VERSION,
  VACCINATION_CONSENT_STATEMENTS,
  renderVaccinationStatement,
} from "@/lib/vaccines/consent-statements"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// signature_pad touches window/document; load the canvas client-only.
const SignaturePad = dynamic(
  () => import("@/components/consent/signature-pad").then((m) => m.SignaturePad),
  { ssr: false },
)

interface VaccinationConsentPanelProps {
  vaccineName: string
  encounterType: string
  value: ConsentCapture | null
  onChange: (c: ConsentCapture | null) => void
}

interface ConsentDraft {
  consentToVaccinate: boolean
  consentToRecord: boolean
  consentToFollowup: boolean
  signerName: string
  signerRelationship: SignerRelationship
  captureMethod: CaptureMethod
  signatureDataUrl: string | null
  verbalAttested: boolean
}

const RELATIONSHIP_OPTIONS: Array<{ value: SignerRelationship; label: string }> = [
  { value: "self", label: "Self (patient)" },
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Guardian" },
  { value: "sdm", label: "Substitute decision-maker" },
]

function defaultCaptureMethod(encounterType: string): CaptureMethod {
  // A tablet signature is only physically possible in person; virtual/phone
  // default to verbal attestation.
  return encounterType === "In-Person" ? "signature" : "verbal_attested"
}

// Vaccination variant of #3's ConsentPanel. Emits a ConsentCapture with
// consentType="vaccination" so the same persistence path (consent row) carries
// the vaccination discriminator. consentToVaccinate is also mirrored onto
// consentToAssess so shared validity/storage invariants stay satisfied.
export function VaccinationConsentPanel({
  vaccineName,
  encounterType,
  value,
  onChange,
}: VaccinationConsentPanelProps) {
  const [draft, setDraft] = useState<ConsentDraft>(() => ({
    consentToVaccinate: value?.consentToVaccinate ?? false,
    consentToRecord: value?.consentToRecord ?? false,
    consentToFollowup: value?.consentToFollowup ?? false,
    signerName: value?.signerName ?? "",
    signerRelationship: value?.signerRelationship ?? "self",
    captureMethod: value?.captureMethod ?? defaultCaptureMethod(encounterType),
    signatureDataUrl: value?.signatureDataUrl ?? null,
    verbalAttested: value?.captureMethod === "verbal_attested" ? true : false,
  }))

  const isValid = useMemo(() => {
    return (
      draft.consentToVaccinate &&
      draft.consentToRecord &&
      draft.signerName.trim().length > 0 &&
      (draft.captureMethod === "verbal_attested"
        ? draft.verbalAttested
        : !!draft.signatureDataUrl)
    )
  }, [draft])

  useEffect(() => {
    if (!isValid) {
      onChange(null)
      return
    }
    onChange({
      consentToAssess: draft.consentToVaccinate,
      consentToRecord: draft.consentToRecord,
      consentToFollowup: draft.consentToFollowup,
      statementVersion: VACCINATION_CONSENT_VERSION,
      signerName: draft.signerName.trim(),
      signerRelationship: draft.signerRelationship,
      signatureDataUrl: draft.captureMethod === "signature" ? draft.signatureDataUrl : null,
      captureMethod: draft.captureMethod,
      capturedAt: new Date().toISOString(),
      consentType: "vaccination",
      consentToVaccinate: draft.consentToVaccinate,
    })
  }, [isValid, draft, onChange])

  function patch(p: Partial<ConsentDraft>) {
    setDraft((d) => ({ ...d, ...p }))
  }

  const showSignature = draft.captureMethod === "signature"
  const showSdm = draft.signerRelationship !== "self"

  return (
    <section
      aria-label="Vaccination consent"
      className="flex flex-col gap-4 rounded-lg border border-input bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Vaccination Consent</h3>
        <p className="text-xs text-muted-foreground">
          Capture informed consent before administering the vaccine. Required consents are marked with *.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {VACCINATION_CONSENT_STATEMENTS.map((s) => {
          const id = `vax-consent-${s.key}`
          const checked =
            s.key === "consent_to_vaccinate"
              ? draft.consentToVaccinate
              : s.key === "consent_to_record"
                ? draft.consentToRecord
                : draft.consentToFollowup
          return (
            <div key={s.key} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(v) => {
                    const on = v === true
                    if (s.key === "consent_to_vaccinate") patch({ consentToVaccinate: on })
                    else if (s.key === "consent_to_record") patch({ consentToRecord: on })
                    else patch({ consentToFollowup: on })
                  }}
                />
                <Label htmlFor={id} className="text-sm font-medium leading-snug">
                  {s.label}
                  {s.required ? " *" : ""}
                </Label>
              </div>
              <p className="ml-6 text-xs text-muted-foreground">
                {renderVaccinationStatement(s.body, { vaccineName })}
              </p>
            </div>
          )
        })}
      </div>

      {showSdm && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-foreground dark:bg-amber-950/30">
          I confirm that I am the parent, guardian, or substitute decision-maker of the above-named patient and that I am legally authorized to give this consent under the Health Care Consent Act, 1996.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="vax-consent-signer-name">
            Printed name of signer {showSdm ? "(parent / guardian / SDM)" : "(patient)"} *
          </Label>
          <Input
            id="vax-consent-signer-name"
            value={draft.signerName}
            onChange={(e) => patch({ signerName: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Signer relationship</Label>
          <div className="flex flex-wrap gap-3 pt-1">
            {RELATIONSHIP_OPTIONS.map((opt) => {
              const id = `vax-consent-rel-${opt.value}`
              return (
                <div key={opt.value} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={draft.signerRelationship === opt.value}
                    onCheckedChange={() => patch({ signerRelationship: opt.value })}
                  />
                  <Label htmlFor={id} className="cursor-pointer text-sm">{opt.label}</Label>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {showSignature ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="self-start text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => patch({ captureMethod: "verbal_attested", signatureDataUrl: null })}
          >
            Capture verbal consent instead
          </button>
          <SignaturePad
            ariaLabel="Patient or SDM signature"
            onChange={(url) => patch({ signatureDataUrl: url })}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="self-start text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => patch({ captureMethod: "signature" })}
          >
            Capture signature instead
          </button>
          <div className="flex items-start gap-2">
            <Checkbox
              id="vax-consent-verbal-attest"
              checked={draft.verbalAttested}
              onCheckedChange={(v) => patch({ verbalAttested: v === true })}
            />
            <Label htmlFor="vax-consent-verbal-attest" className="text-sm font-medium leading-snug">
              I confirm I obtained the patient/SDM&apos;s verbal consent to administer this vaccine and to record their health information.
            </Label>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {isValid
          ? "Consent captured — the record is ready to produce."
          : "Both required consents, a printed name, and a signature (or verbal attestation) are needed before the record can be produced."}
      </p>
    </section>
  )
}
