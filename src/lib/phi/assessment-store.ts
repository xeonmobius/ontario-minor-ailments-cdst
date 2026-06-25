"use server"

import { query, isPhiEnabled } from "./db"
import { patientHash, generateRecordId } from "./identity"
import { requireAuth } from "@/lib/auth-guards"
import type {
  AbandonmentReason,
  AssessmentOutcome,
  NonPrescribeReason,
  PatientInfo,
  SelectedRx,
} from "@/types"

export interface SaveAssessmentInput {
  patient: PatientInfo
  ailmentId: string
  ailmentName: string
  txId: string
  redFlagsChecked: string[]
  hasRedFlag: boolean
  symptomsChecked: string[]
  assessmentNotes: string
  selectedRx: SelectedRx | null
  nonRxChecked: string[]
  isReferral: boolean
  outcome?: AssessmentOutcome
  nonPrescribeReason?: NonPrescribeReason
  nonPrescribeRationale?: string
  abandonmentReason?: AbandonmentReason
  reasonTaxonomyVersion?: string
  reasonTaxonomyHash?: string
}

const VALID_NON_PRESCRIBE_REASONS: NonPrescribeReason[] = [
  "patient_declined",
  "otc_sufficient",
  "clinical_judgment",
  "already_treating",
  "referred_to_physician",
  "referred_elsewhere",
  "other",
]

export async function saveAssessment(input: SaveAssessmentInput): Promise<{ id?: string; error?: string }> {
  if (!isPhiEnabled()) {
    return { error: "PHI persistence is not enabled" }
  }

  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    return { error: "No pharmacy associated with this account." }
  }

  if (input.outcome === "not_prescribed") {
    if (!input.nonPrescribeReason || !VALID_NON_PRESCRIBE_REASONS.includes(input.nonPrescribeReason)) {
      return { error: "not_prescribed outcome requires a valid nonPrescribeReason." }
    }
    if (input.nonPrescribeReason === "other" && !input.nonPrescribeRationale?.trim()) {
      return { error: 'nonPrescribeReason "other" requires a rationale.' }
    }
  }

  const id = generateRecordId()
  const pid = patientHash(input.patient.name, input.patient.dob)
  const outcome: AssessmentOutcome =
    input.outcome ?? (input.isReferral ? "referred" : "prescribed")

  try {
    await query(
      `INSERT INTO phi.assessments (
        id, patient_hash, patient_name, patient_dob, patient_sex, patient_ohip,
        ailment_id, ailment_name, tx_id,
        red_flags_checked, has_red_flag, symptoms_checked, assessment_notes,
        selected_rx, non_rx_checked, is_referral,
        pharmacist_id, pharmacy_id,
        outcome, non_prescribe_reason, non_prescribe_rationale,
        abandonment_reason, reason_taxonomy_version, reason_taxonomy_hash,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16,
        $17, $18,
        $19, $20, $21,
        $22, $23, $24,
        NOW()
      )`,
      [
        id,
        pid,
        input.patient.name,
        input.patient.dob,
        input.patient.sex,
        input.patient.ohip,
        input.ailmentId,
        input.ailmentName,
        input.txId,
        input.redFlagsChecked,
        input.hasRedFlag,
        input.symptomsChecked,
        input.assessmentNotes,
        input.selectedRx,
        input.nonRxChecked,
        input.isReferral,
        profile.id,
        profile.pharmacyId,
        outcome,
        input.nonPrescribeReason ?? null,
        input.nonPrescribeRationale ?? null,
        input.abandonmentReason ?? null,
        input.reasonTaxonomyVersion ?? null,
        input.reasonTaxonomyHash ?? null,
      ],
    )
    return { id }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { error: message }
  }
}

export async function getAssessmentsByPharmacy(
  limit = 50,
  offset = 0,
): Promise<{ data?: Record<string, unknown>[]; error?: string }> {
  if (!isPhiEnabled()) {
    return { error: "PHI persistence is not enabled" }
  }

  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    return { error: "No pharmacy associated with this account." }
  }

  try {
    const rows = await query(
      `SELECT id, patient_hash, ailment_name, tx_id, has_red_flag, is_referral, pharmacist_id, created_at
       FROM phi.assessments
       WHERE pharmacy_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [profile.pharmacyId, limit, offset],
    )
    return { data: rows }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { error: message }
  }
}

export async function getAssessmentById(id: string): Promise<{ data?: Record<string, unknown>; error?: string }> {
  if (!isPhiEnabled()) {
    return { error: "PHI persistence is not enabled" }
  }

  try {
    const rows = await query(
      `SELECT * FROM phi.assessments WHERE id = $1`,
      [id],
    )
    if (rows.length === 0) return { error: "Not found" }
    return { data: rows[0] }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { error: message }
  }
}
