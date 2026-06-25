"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import type { PharmacistSignature, PharmacistSigningState, SignatureDocumentType } from "@/types"
import {
  PHARMACIST_ATTESTATION_VERSION,
  renderAttestation,
} from "@/lib/signature/attestation"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { enrollSignatureAction } from "@/lib/signature-actions"

// signature_pad touches window/document; load the canvas client-only. Reuses
// #3's purpose-agnostic pad — the signer identity is determined by context,
// not by the component.
const SignaturePad = dynamic(
  () => import("@/components/consent/signature-pad").then((m) => m.SignaturePad),
  { ssr: false },
)

interface PharmacistSignaturePanelProps {
  enrolled: PharmacistSignature | null
  pharmacistName: string
  license: string | null
  documentType: SignatureDocumentType
  value: PharmacistSigningState | null
  onChange: (v: PharmacistSigningState | null) => void
}

interface SigningDraft {
  attested: boolean
  // When unenrolled, the inline-captured stroke; when enrolled, null (the
  // enrolled stroke is the source of truth until re-capture is requested).
  inlineDataUrl: string | null
  saveAsCredential: boolean
  // When true, an enrolled pharmacist has asked to re-capture inline.
  recapture: boolean
}

export function PharmacistSignaturePanel({
  enrolled,
  pharmacistName,
  license,
  documentType,
  value,
  onChange,
}: PharmacistSignaturePanelProps) {
  const [draft, setDraft] = useState<SigningDraft>(() => ({
    attested: value?.attested ?? false,
    inlineDataUrl: value?.signatureDataUrl && !enrolled ? value.signatureDataUrl : null,
    saveAsCredential: value?.saveAsCredential ?? true,
    recapture: false,
  }))

  // The active stroke: enrolled credential (unless re-capturing) or the inline
  // capture for an unenrolled / re-capturing pharmacist.
  const activeDataUrl =
    enrolled && !draft.recapture ? enrolled.signatureDataUrl : draft.inlineDataUrl

  const isValid = useMemo(() => {
    return draft.attested && !!activeDataUrl
  }, [draft.attested, activeDataUrl])

  useEffect(() => {
    if (!isValid) {
      onChange(null)
      return
    }
    onChange({
      attested: true,
      signatureDataUrl: activeDataUrl,
      attestationVersion: PHARMACIST_ATTESTATION_VERSION,
      // The attestation moment; the persisted signed_at (Phase 2, from
      // applySignatureAction) is authoritative on the assessment row.
      signedAt: new Date().toISOString(),
      saveAsCredential: draft.saveAsCredential,
    })
  }, [isValid, activeDataUrl, draft.saveAsCredential, onChange])

  function patch(p: Partial<SigningDraft>) {
    setDraft((d) => ({ ...d, ...p }))
  }

  // Progressive inline enrollment: when an unenrolled pharmacist captures a
  // stroke and opts to save, enroll it as their reusable credential (Phase 2
  // persists; Phase 1 stub returns ok without writing). Fire-and-forget — the
  // document is produced from React state regardless of the write outcome.
  useEffect(() => {
    if (!isValid || !draft.saveAsCredential) return
    if (enrolled && !draft.recapture) return // already enrolled, no change
    if (!draft.inlineDataUrl) return
    enrollSignatureAction({
      signatureDataUrl: draft.inlineDataUrl,
      saveAsCredential: true,
    }).catch(() => {
      // A persistence failure does not block the in-session document.
    })
    // Run once per captured stroke, not on every valid emit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.inlineDataUrl, draft.saveAsCredential])

  const attestationText = renderAttestation(license, documentType)

  return (
    <section
      aria-label="Pharmacist signature"
      className="flex flex-col gap-4 rounded-lg border border-input bg-card p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Pharmacist Signature</h3>
        <p className="text-xs text-muted-foreground">
          {enrolled && !draft.recapture
            ? "Your enrolled signature will be applied. Confirm the attestation to authorize this document."
            : "Sign once to apply your signature to this document."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{pharmacistName || "—"}</span>
          <span>·</span>
          <span>Lic #{license || "__________"}</span>
          <span>·</span>
          <span className="capitalize">{documentType}</span>
        </div>

        {enrolled && !draft.recapture ? (
          <div className="flex flex-col gap-2">
            <img
              src={enrolled.signatureDataUrl}
              alt="Enrolled signature preview"
              className="h-16 w-auto max-w-full rounded-md border border-input bg-background object-contain"
            />
            <button
              type="button"
              className="self-start text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => patch({ recapture: true, inlineDataUrl: null })}
            >
              Re-capture signature instead
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <SignaturePad
              ariaLabel="Pharmacist signature"
              onChange={(url) => patch({ inlineDataUrl: url })}
            />
            <div className="flex items-start gap-2">
              <Checkbox
                id="pharmacist-save-credential"
                checked={draft.saveAsCredential}
                onCheckedChange={(v) => patch({ saveAsCredential: v === true })}
              />
              <Label htmlFor="pharmacist-save-credential" className="text-xs font-medium leading-snug">
                Save as my signature for future prescriptions (recommended)
              </Label>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id="pharmacist-attest"
          checked={draft.attested}
          onCheckedChange={(v) => patch({ attested: v === true })}
        />
        <Label htmlFor="pharmacist-attest" className="text-xs font-medium leading-snug">
          {attestationText}
        </Label>
      </div>

      <p className="text-xs text-muted-foreground">
        {isValid
          ? "Signature captured and attested — the document is ready to produce."
          : "A signature and the attestation are required before the document can be produced."}
      </p>
    </section>
  )
}
