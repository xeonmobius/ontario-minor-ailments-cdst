"use server"

import { query, isPhiEnabled } from "./db"
import { patientHash, generateRecordId } from "./identity"
import { requireAuth } from "@/lib/auth-guards"
import type {
  AdministrationRoute,
  AdministrationSite,
  PatientInfo,
  VaccinationAdministration,
  VaccinationOutcome,
  WithholdReason,
} from "@/types"

// All fly.io `vaccination` access funnels through this module (roadmap #22). PHI:
// the administered-vaccine record (vaccine, lot, expiry, site, route, dose) lives
// here on fly.io only — never Supabase. pharmacyId is derived from the verified
// JWT and is present in every query's WHERE/VALUES so cross-pharmacy access is
// structurally impossible. No UPDATE/DELETE path (immutability inherited from #2).

export interface SaveVaccinationInput {
  patient: PatientInfo
  vaccinationClientId: string
  vaccineId: string
  vaccineName: string
  outcome: VaccinationOutcome
  administration: VaccinationAdministration | null
  withholdReason?: WithholdReason
  withholdNote?: string
  contraindicationsChecked: string[]
  consentId?: string
  protocolVersion?: string
}

const VALID_OUTCOMES: VaccinationOutcome[] = ["administered", "withheld", "referred"]
const VALID_ROUTES: AdministrationRoute[] = ["IM", "SC", "ID", "intranasal", "oral"]
const VALID_SITES: AdministrationSite[] = [
  "left_deltoid", "right_deltoid", "left_vastus_lateralis", "right_vastus_lateralis",
  "left_arm", "right_arm", "nasal", "oral", "other",
]
const VALID_WITHHOLD_REASONS: WithholdReason[] = [
  "contraindication_present", "patient_declined", "acute_illness_today",
  "pregnancy_live_vaccine", "out_of_stock", "referred_to_physician", "other",
]

// Phase-1 (PHI_PERSIST_ENABLED off) returns null without a DB call — the VAR PDF
// is the durable legal artefact. Lights up automatically once fly.io is live.
export async function saveVaccination(
  input: SaveVaccinationInput,
): Promise<{ vaccinationId: string | null }> {
  if (!isPhiEnabled()) return { vaccinationId: null }

  // Defence-in-depth: never trust client values for a legal artefact.
  if (!VALID_OUTCOMES.includes(input.outcome)) {
    throw new Error("Invalid vaccination outcome.")
  }
  if (input.outcome === "administered") {
    if (!input.administration) throw new Error("Administration details required for administered outcome.")
    if (!input.administration.lotNumber.trim()) throw new Error("Lot number is required.")
    if (!input.administration.expiryDate.trim()) throw new Error("Expiry date is required.")
    if (!input.administration.doseNumber || input.administration.doseNumber < 1) {
      throw new Error("Dose number is required.")
    }
    if (!VALID_ROUTES.includes(input.administration.route)) throw new Error("Invalid route.")
    if (!VALID_SITES.includes(input.administration.site)) throw new Error("Invalid site.")
  }
  if (input.withholdReason && !VALID_WITHHOLD_REASONS.includes(input.withholdReason)) {
    throw new Error("Invalid withhold reason.")
  }

  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    throw new Error("No pharmacy associated with this account.")
  }

  const id = generateRecordId()
  const pid = patientHash(input.patient.name, input.patient.dob)
  const admin = input.outcome === "administered" ? input.administration : null

  try {
    await query(
      `INSERT INTO phi.vaccinations (
        id, patient_hash, pharmacy_id, pharmacist_id, vaccination_client_id,
        vaccine_id, vaccine_name, outcome,
        dose_number, series_total, lot_number, expiry_date, manufacturer,
        route, site, dose_volume,
        withhold_reason, contraindications_checked, administration_notes,
        consent_id, protocol_version, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16,
        $17, $18, $19,
        $20, $21, NOW()
      )`,
      [
        id,
        pid,
        profile.pharmacyId,
        profile.id,
        input.vaccinationClientId,
        input.vaccineId,
        input.vaccineName,
        input.outcome,
        admin?.doseNumber ?? null,
        admin?.seriesTotal ?? null,
        admin?.lotNumber ?? null,
        admin?.expiryDate ?? null,
        admin?.manufacturer ?? null,
        admin?.route ?? null,
        admin?.site ?? null,
        admin?.doseVolume ?? null,
        input.withholdReason ?? null,
        input.contraindicationsChecked,
        input.outcome === "administered"
          ? (admin?.administrationNotes ?? "")
          : (input.withholdNote ?? ""),
        input.consentId ?? null,
        input.protocolVersion ?? null,
      ],
    )
    return { vaccinationId: id }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    throw new Error(`Failed to persist vaccination: ${message}`)
  }
}

// Lot-recall query path: every administration of a lot scoped to pharmacy_id.
export async function getVaccinationsByLot({
  lotNumber,
}: {
  lotNumber: string
}): Promise<{ data?: Record<string, unknown>[]; error?: string }> {
  if (!isPhiEnabled()) return { error: "PHI persistence is not enabled" }

  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    return { error: "No pharmacy associated with this account." }
  }

  try {
    const rows = await query(
      `SELECT id, patient_hash, vaccine_name, dose_number, lot_number, expiry_date, created_at
         FROM phi.vaccinations
        WHERE pharmacy_id = $1 AND lot_number = $2
        ORDER BY created_at DESC`,
      [profile.pharmacyId, lotNumber],
    )
    return { data: rows }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return { error: message }
  }
}
