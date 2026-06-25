"use server"

import { query, isPhiEnabled } from "./phi/db"
import { generateRecordId } from "./phi/identity"
import type { PharmacistSignature } from "@/types"

// All fly.io `pharmacist_signature` access funnels through this module (roadmap
// #11). PHI: the stroke image (signature_png) identifies the pharmacist and
// lives here on fly.io only — never Supabase. pharmacist_id + pharmacy_id
// (derived from the verified JWT in the calling server action) scope every
// query so cross-pharmacist access is structurally impossible. Unlike #3's
// immutable consent rows, this credential is UPSERTABLE: re-enrollment
// overwrites the stroke (one current credential per pharmacist).

export interface UpsertSignatureInput {
  pharmacistId: string
  pharmacyId: string
  signatureDataUrl: string
  attestationVersion: string
  attestationHash: string
}

// Read the pharmacist's current enrolled credential, scoped to the caller.
// Decodes the stored bytea back to a PNG data URL for client-side PDF render.
// Returns null when PHI persistence is off (Phase 1) or no row exists.
export async function getCurrentSignature(
  pharmacistId: string,
  pharmacyId: string,
): Promise<PharmacistSignature | null> {
  if (!isPhiEnabled()) return null

  try {
    const rows = await query<{
      id: string
      pharmacist_id: string
      signature_png: Buffer
      attestation_version: string
      enrolled_at: string
    }>(
      `SELECT id, pharmacist_id, signature_png, attestation_version, enrolled_at
         FROM phi.pharmacist_signature
        WHERE pharmacist_id = $1 AND pharmacy_id = $2`,
      [pharmacistId, pharmacyId],
    )
    if (rows.length === 0) return null
    const row = rows[0]
    return {
      id: row.id,
      pharmacistId: row.pharmacist_id,
      signatureDataUrl: `data:image/png;base64,${row.signature_png.toString("base64")}`,
      enrolledAt: row.enrolled_at,
      attestationVersion: row.attestation_version,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(`Failed to read pharmacist signature: ${message}`)
  }
}

// Upsert the enrolled credential. ON CONFLICT (pharmacist_id) overwrites the
// stroke + enrolled_at on re-enrollment. No-op (returns null) when PHI
// persistence is off (Phase 1) — the client keeps the stroke in React state.
export async function upsertSignature(
  input: UpsertSignatureInput,
): Promise<{ id: string } | null> {
  if (!isPhiEnabled()) return null

  // Defence-in-depth: the data URL must be a PNG (the action also re-validates).
  if (!input.signatureDataUrl.startsWith("data:image/png")) {
    throw new Error("Signature must be a PNG data URL.")
  }
  const png = Buffer.from(input.signatureDataUrl.split(",")[1] ?? "", "base64")

  const id = generateRecordId()
  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO phi.pharmacist_signature (
         id, pharmacist_id, pharmacy_id, signature_png,
         attestation_version, attestation_hash, enrolled_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (pharmacist_id) DO UPDATE SET
         signature_png = EXCLUDED.signature_png,
         attestation_version = EXCLUDED.attestation_version,
         attestation_hash = EXCLUDED.attestation_hash,
         pharmacy_id = EXCLUDED.pharmacy_id,
         enrolled_at = NOW()
       RETURNING id`,
      [id, input.pharmacistId, input.pharmacyId, png, input.attestationVersion, input.attestationHash],
    )
    return rows[0] ? { id: rows[0].id } : null
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(`Failed to persist pharmacist signature: ${message}`)
  }
}

// Per-act binding: stamp the assessment row with the credential id + signed_at
// + attestation version. Write-once — WHERE signed_at IS NULL prevents a
// re-download from re-stamping (idempotency from #2). No-op (returns null) when
// PHI persistence is off. Returns the persisted signed_at for the audit trail.
export async function stampAssessmentSignature({
  txId,
  pharmacyId,
  signatureId,
  attestationVersion,
}: {
  txId: string
  pharmacyId: string
  signatureId: string
  attestationVersion: string
}): Promise<{ signedAt: string } | null> {
  if (!isPhiEnabled()) return null

  try {
    const rows = await query<{ signed_at: string }>(
      `UPDATE phi.assessments
          SET pharmacist_signature_id = $1,
              signed_at = NOW(),
              signing_attestation_version = $2
        WHERE tx_id = $3 AND pharmacy_id = $4 AND signed_at IS NULL
        RETURNING signed_at`,
      [signatureId, attestationVersion, txId, pharmacyId],
    )
    return rows[0] ? { signedAt: rows[0].signed_at } : null
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(`Failed to stamp assessment signature: ${message}`)
  }
}
