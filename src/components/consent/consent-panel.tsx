"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { CaptureMethod, ConsentCapture, SignerRelationship } from "@/types"
import {
  CONSENT_STATEMENT_VERSION,
  MINOR_AILMENTS_CONSENT_STATEMENTS,
  SDM_ATTESTATION,
  renderStatement,
} from "@/lib/consent/statements"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// signature_pad touches window/document; load the canvas client-only.
const SignaturePad = dynamic(
  () => import("@/components/consent/signature-pad").then((m) => m.SignaturePad),
  { ssr: false },
)

interface ConsentPanelProps {
  ailmentName: string
  pharmacyName: string
  encounterType: string
  value: ConsentCapture | null
  onChange: (c: ConsentCapture | null) => void
}

interface ConsentDraft {
  consentToAssess: boolean
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
  // default to verbal attestation (the pharmacist may still switch to signature
  // if the patient is physically present at the counter for a virtual consult).
  return encounterType === "In-Person" ? "signature" : "verbal_attested"
}

export function ConsentPanel({ ailmentName, pharmacyName, encounterType, value, onChange }: ConsentPanelProps) {
  const [draft, setDraft] = useState<ConsentDraft>(() => ({
    consentToAssess: value?.consentToAssess ?? false,
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
      draft.consentToAssess &&
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
      consentToAssess: draft.consentToAssess,
      consentToRecord: draft.consentToRecord,
      consentToFollowup: draft.consentToFollowup,
      statementVersion: CONSENT_STATEMENT_VERSION,
      signerName: draft.signerName.trim(),
      signerRelationship: draft.signerRelationship,
      signatureDataUrl: draft.captureMethod === "signature" ? draft.signatureDataUrl : null,
      captureMethod: draft.captureMethod,
      capturedAt: new Date().toISOString(),
    })
  }, [isValid, draft, onChange])

  function patch(p: Partial<ConsentDraft>) {
    setDraft((d) => ({ ...d, ...p }))
  }

  const showSignature = draft.captureMethod === "signature"
  const showSdm = draft.signerRelationship !== "self"

  return (
    <section
      aria-label="Patient consent"
      className="flex flex-col gap-4 rounded-lg border border-input bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Patient Consent</h3>
        <p className="text-xs text-muted-foreground">
          Capture consent before producing the document. Required consents are marked with *.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {MINOR_AILMENTS_CONSENT_STATEMENTS.map((s) => {
          const id = `consent-${s.key}`
          const checked =
            s.key === "consent_to_assess"
              ? draft.consentToAssess
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
                    if (s.key === "consent_to_assess") patch({ consentToAssess: on })
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
                {renderStatement(s.body, { pharmacyName, ailmentName })}
              </p>
            </div>
          )
        })}
      </div>

      {showSdm && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-foreground dark:bg-amber-950/30">
          {SDM_ATTESTATION}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="consent-signer-name">
            Printed name of signer {showSdm ? "(parent / guardian / SDM)" : "(patient)"} *
          </Label>
          <Input
            id="consent-signer-name"
            value={draft.signerName}
            onChange={(e) => patch({ signerName: e.target.value })}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Signer relationship</Label>
          <div className="flex flex-wrap gap-3 pt-1">
            {RELATIONSHIP_OPTIONS.map((opt) => {
              const id = `consent-rel-${opt.value}`
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
              id="consent-verbal-attest"
              checked={draft.verbalAttested}
              onCheckedChange={(v) => patch({ verbalAttested: v === true })}
            />
            <Label htmlFor="consent-verbal-attest" className="text-sm font-medium leading-snug">
              I confirm I obtained the patient/SDM&apos;s verbal consent to assess, prescribe, and record their health information.
            </Label>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {isValid
          ? "Consent captured — the document is ready to produce."
          : "Both required consents, a printed name, and a signature (or verbal attestation) are needed before the document can be produced."}
      </p>
    </section>
  )
}
