"use server"

import { query, isPhiEnabled } from "./phi/db"
import { patientHash, generateRecordId } from "./phi/identity"
import { requireAuth } from "@/lib/auth-guards"
import type { CaptureMethod, SignerRelationship } from "@/types"

// All fly.io `consent` access funnels through this module (roadmap #3). PHI:
// the signer identity and the stroke image (signature_png) live here on fly.io
// only — never Supabase. pharmacyId is derived from the verified JWT and is
// present in every query's WHERE/VALUES so cross-pharmacy access is structurally
// impossible. No UPDATE/DELETE path is offered (the consent is immutable; the
// HCCA/PHIPA withdrawal lifecycle is out of scope for this tier).

export interface SaveConsentInput {
  pharmacistId: string
  pharmacyId: string
  patientName: string
  patientDob: string
  assessmentTxId?: string
  vaccinationId?: string
  statementVersion: string
  statementHash: string
  consentToAssess: boolean
  consentToRecord: boolean
  consentToFollowup: boolean
  signerName: string
  signerRelationship: SignerRelationship
  captureMethod: CaptureMethod
  signaturePng: Buffer | null
  ipAddress: string | null
  // Vaccination variant (roadmap #22). Defaults to minor_ailments for existing
  // callers; consentToVaccinate is set only when consentType='vaccination'.
  consentType?: "minor_ailments" | "vaccination"
  consentToVaccinate?: boolean
}

// Phase-1 (PHI_PERSIST_ENABLED off) returns null without a DB call — the
// captured signature is baked onto the PDF client-side, so the printed document
// is the durable legal artefact. Lights up automatically once fly.io is live.
export async function saveConsent(input: SaveConsentInput): Promise<{ consentId: string | null }> {
  if (!isPhiEnabled()) return { consentId: null }

  // Defence-in-depth: never trust client booleans for a legal artefact.
  const isVaccination = input.consentType === "vaccination"
  const primaryConsent = isVaccination ? input.consentToVaccinate : input.consentToAssess
  if (!primaryConsent || !input.consentToRecord) {
    throw new Error("Required consents missing.")
  }
  if (!input.signerName.trim()) {
    throw new Error("Signer name is required.")
  }
  if (input.captureMethod === "signature" && !input.signaturePng) {
    throw new Error("Signature is required for capture_method=signature.")
  }

  const id = generateRecordId()
  const pid = patientHash(input.patientName, input.patientDob)

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO phi.consents (
        id, patient_hash, pharmacy_id, pharmacist_id, assessment_tx_id, vaccination_id,
        statement_version, statement_hash,
        consent_to_assess, consent_to_record, consent_to_followup,
        consent_type, consent_to_vaccinate,
        signer_name, signer_relationship, capture_method,
        signature_png, ip_address, captured_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8,
        $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18, NOW(), NOW()
      )
      RETURNING id`,
      [
        id,
        pid,
        input.pharmacyId,
        input.pharmacistId,
        input.assessmentTxId ?? null,
        input.vaccinationId ?? null,
        input.statementVersion,
        input.statementHash,
        input.consentToAssess,
        input.consentToRecord,
        input.consentToFollowup,
        input.consentType ?? "minor_ailments",
        input.consentToVaccinate ?? null,
        input.signerName.trim(),
        input.signerRelationship,
        input.captureMethod,
        input.signaturePng,
        input.ipAddress,
      ],
    )
    return { consentId: rows[0]?.id ?? null }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(`Failed to persist consent: ${message}`)
  }
}

// Read a consent by id, scoped to the caller's pharmacy. Returns null when PHI
// is off or the row belongs to another pharmacy (app-layer scoping).
export async function getConsentById(
  id: string,
): Promise<{ data?: Record<string, unknown>; error?: string }> {
  if (!isPhiEnabled()) return { error: "PHI persistence is not enabled" }

  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    return { error: "No pharmacy associated with this account." }
  }

  try {
    const rows = await query(
      `SELECT id, patient_hash, pharmacy_id, statement_version, statement_hash,
              consent_to_assess, consent_to_record, consent_to_followup,
              signer_relationship, capture_method, captured_at
         FROM phi.consents
        WHERE id = $1 AND pharmacy_id = $2`,
      [id, profile.pharmacyId],
    )
    if (rows.length === 0) return { error: "Not found" }
    return { data: rows[0] }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { error: message }
  }
}
