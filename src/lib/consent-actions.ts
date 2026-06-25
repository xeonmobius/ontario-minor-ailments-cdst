"use server"

import { headers } from "next/headers"
import { requireAuth } from "@/lib/auth-guards"
import { isPhiEnabled } from "@/lib/phi/db"
import { saveConsent } from "@/lib/consent-store"
import { logAuditEvent } from "@/lib/audit-actions"
import {
  computeStatementHash,
  CONSENT_STATEMENT_VERSION,
  MINOR_AILMENTS_CONSENT_STATEMENTS,
} from "@/lib/consent/statements"
import type { ConsentCapture, PatientIdentity } from "@/types"

export interface SaveConsentPayload {
  consent: ConsentCapture
  patient: PatientIdentity
  assessmentTxId?: string
}

// Phase-1 no-op stub: returns { consentId: null } without a DB call or audit
// when PHI persistence is off (or the pharmacist has no pharmacy). The captured
// signature is baked onto the PDF client-side, so the document is produced as
// the durable legal artefact regardless. Fail-closed: a persistence error in
// Phase 2 surfaces and blocks the caller's download path.
export async function saveConsentAction(
  payload: SaveConsentPayload,
): Promise<{ consentId: string | null }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { consentId: null }

  if (!isPhiEnabled()) return { consentId: null }

  const { consent, patient, assessmentTxId } = payload

  // Server-side re-validation (never trust client booleans for a legal artefact).
  if (!consent.consentToAssess || !consent.consentToRecord) {
    throw new Error("Required consents missing.")
  }
  if (!consent.signerName.trim()) {
    throw new Error("Signer name is required.")
  }
  if (consent.captureMethod === "signature" && !consent.signatureDataUrl) {
    throw new Error("Signature is required for capture_method=signature.")
  }
  if (consent.statementVersion !== CONSENT_STATEMENT_VERSION) {
    throw new Error("Consent statement version mismatch.")
  }

  // Decode the data URL to a Buffer for bytea storage. PHI: fly.io only.
  const signaturePng =
    consent.captureMethod === "signature" && consent.signatureDataUrl
      ? Buffer.from(consent.signatureDataUrl.split(",")[1] ?? "", "base64")
      : null
  if (signaturePng && signaturePng.length > 200 * 1024) {
    throw new Error("Signature payload too large.")
  }

  const h = await headers()
  const forwarded = h.get("x-forwarded-for")
  const ipAddress = forwarded?.split(",")[0]?.trim() ?? null

  const statementHash = computeStatementHash(MINOR_AILMENTS_CONSENT_STATEMENTS)

  const { consentId } = await saveConsent({
    pharmacistId: profile.id,
    pharmacyId: profile.pharmacyId,
    patientName: patient.name,
    patientDob: patient.dob,
    assessmentTxId,
    statementVersion: consent.statementVersion,
    statementHash,
    consentToAssess: consent.consentToAssess,
    consentToRecord: consent.consentToRecord,
    consentToFollowup: consent.consentToFollowup,
    signerName: consent.signerName,
    signerRelationship: consent.signerRelationship,
    captureMethod: consent.captureMethod,
    signaturePng,
    ipAddress,
  })

  if (consentId) {
    // Non-PHI audit only: strictly { consent_id, statement_version,
    // capture_method }. No signature, no signer name, no patient data.
    await logAuditEvent("consent.captured", {
      consent_id: consentId,
      statement_version: consent.statementVersion,
      capture_method: consent.captureMethod,
    })
  }

  return { consentId }
}
