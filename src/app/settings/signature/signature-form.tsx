"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import type { PharmacistSignature } from "@/types"
import {
  PHARMACIST_ATTESTATION_VERSION,
  renderAttestation,
} from "@/lib/signature/attestation"
import { enrollSignatureAction } from "@/lib/signature-actions"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

// signature_pad touches window/document; load the canvas client-only.
const SignaturePad = dynamic(
  () => import("@/components/consent/signature-pad").then((m) => m.SignaturePad),
  { ssr: false },
)

interface SignatureFormProps {
  enrolled: PharmacistSignature | null
  pharmacistName: string
  license: string | null
}

export function SignatureForm({ enrolled, pharmacistName, license }: SignatureFormProps) {
  const [stroke, setStroke] = useState<string | null>(null)
  const [attested, setAttested] = useState(false)
  const [recapture, setRecapture] = useState(!enrolled)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")

  async function handleEnroll() {
    if (!stroke || !attested) return
    setStatus("saving")
    try {
      await enrollSignatureAction({ signatureDataUrl: stroke, saveAsCredential: true })
      setStatus("saved")
      setRecapture(false)
    } catch {
      setStatus("error")
    }
  }

  const canEnroll = !!stroke && attested

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pharmacist e-Signature</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Enroll your signature once to apply it to every prescription and referral you authorize. Your identity
          ({pharmacistName || "—"}, Lic #{license || "__________"}) is bound to your authenticated account; the
          signature is the captured stroke applied on top of it.
        </p>

        {enrolled && !recapture ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>Enrolled (attestation {enrolled.attestationVersion})</span>
            </div>
            <img
              src={enrolled.signatureDataUrl}
              alt="Current signature"
              className="h-20 w-auto max-w-full rounded-md border border-input bg-background object-contain"
            />
            <Button variant="outline" onClick={() => { setRecapture(true); setStroke(null); setAttested(false); setStatus("idle") }}>
              Re-enroll signature
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <SignaturePad ariaLabel="Pharmacist signature" onChange={setStroke} />
            <div className="flex items-start gap-2">
              <Checkbox
                id="settings-attest"
                checked={attested}
                onCheckedChange={(v) => setAttested(v === true)}
              />
              <Label htmlFor="settings-attest" className="text-xs font-medium leading-snug">
                {renderAttestation(license, "prescription")}
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleEnroll} disabled={!canEnroll || status === "saving"}>
                {status === "saving" ? "Saving…" : enrolled ? "Update signature" : "Enroll signature"}
              </Button>
              {enrolled && (
                <Button variant="ghost" onClick={() => { setRecapture(false); setStroke(null); setAttested(false); setStatus("idle") }}>
                  Cancel
                </Button>
              )}
            </div>
            {status === "saved" && (
              <p className="text-xs text-emerald-600">
                Signature enrolled. It will apply to your next prescription and referral.
              </p>
            )}
            {status === "error" && (
              <p className="text-xs text-destructive">
                Could not save the signature. Try again, or continue with an in-session capture at the consult.
              </p>
            )}
            {status === "idle" && (
              <p className="text-xs text-muted-foreground">
                Attestation version {PHARMACIST_ATTESTATION_VERSION}. Persistence activates with PHI storage
                (Phase 2); until then the enrolled signature is captured in-session.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
