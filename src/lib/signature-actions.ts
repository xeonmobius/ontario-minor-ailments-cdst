"use server"

import { requireAuth } from "@/lib/auth-guards"
import { isPhiEnabled } from "@/lib/phi/db"
import { getCurrentSignature, upsertSignature, stampAssessmentSignature } from "@/lib/signature-store"
import { logAuditEvent } from "@/lib/audit-actions"
import {
  PHARMACIST_ATTESTATION_VERSION,
  PHARMACIST_ATTESTATION_HASH,
} from "@/lib/signature/attestation"
import type { PharmacistSignature } from "@/types"

// Read the calling pharmacist's enrolled credential. Phase-1 no-op (flag off)
// returns null → the panel shows the inline-capture path. In Phase 2 this
// returns the saved stroke so it auto-applies to the next document.
export async function getSignatureAction(): Promise<PharmacistSignature | null> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return null
  if (!isPhiEnabled()) return null
  return getCurrentSignature(profile.id, profile.pharmacyId)
}

// Enroll (or re-enroll) the calling pharmacist's signature credential. Phase-1
// no-op stub: returns { ok: true } without writing when the flag is off (the
// client keeps the stroke in React state for the session). Server-side
// re-validation rejects a missing/oversized/non-PNG payload before the write.
export async function enrollSignatureAction({
  signatureDataUrl,
  saveAsCredential,
}: {
  signatureDataUrl: string
  saveAsCredential: boolean
}): Promise<{ ok: boolean }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { ok: false }
  if (!isPhiEnabled()) return { ok: true }
  if (!saveAsCredential) return { ok: true }

  if (!signatureDataUrl || !signatureDataUrl.startsWith("data:image/png")) {
    throw new Error("Signature must be a PNG data URL.")
  }
  const decoded = Buffer.from(signatureDataUrl.split(",")[1] ?? "", "base64")
  // 200 KB cap rejects pathological inputs before the fly.io write (mirrors #3).
  if (decoded.length > 200 * 1024) {
    throw new Error("Signature payload too large.")
  }

  await upsertSignature({
    pharmacistId: profile.id,
    pharmacyId: profile.pharmacyId,
    signatureDataUrl,
    attestationVersion: PHARMACIST_ATTESTATION_VERSION,
    attestationHash: PHARMACIST_ATTESTATION_HASH,
  })
  return { ok: true }
}

// Per-act binding: stamp the assessment row with the enrolled credential +
// signed_at + attestation version, then emit the non-PHI signature.applied
// audit event. Phase-1 no-op stub returns nulls (the stroke still renders on
// the PDF client-side). Write-once: a re-download does not re-stamp. The
// document kind is derivable from the assessment row (is_referral / outcome),
// so it is not carried on the audit metadata (PHI-leak discipline).
export async function applySignatureAction({
  assessmentTxId,
}: {
  assessmentTxId?: string
}): Promise<{ signedAt: string | null; signatureId: string | null }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { signedAt: null, signatureId: null }
  if (!isPhiEnabled()) return { signedAt: null, signatureId: null }
  if (!assessmentTxId) return { signedAt: null, signatureId: null }

  // The pharmacist must be enrolled for the per-act binding to resolve.
  const current = await getCurrentSignature(profile.id, profile.pharmacyId)
  if (!current) return { signedAt: null, signatureId: null }

  const stamped = await stampAssessmentSignature({
    txId: assessmentTxId,
    pharmacyId: profile.pharmacyId,
    signatureId: current.id,
    attestationVersion: PHARMACIST_ATTESTATION_VERSION,
  })

  // Non-PHI audit only: strictly { signature_id, attestation_version }. No
  // stroke, no patient, no ailment, no document_type identifying content
  // beyond the opaque credential id + version string.
  await logAuditEvent("signature.applied", {
    signature_id: current.id,
    attestation_version: PHARMACIST_ATTESTATION_VERSION,
  })

  return {
    signedAt: stamped?.signedAt ?? null,
    signatureId: current.id,
  }
}
