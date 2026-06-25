"use server"

import { requireAuth } from "@/lib/auth-guards"
import { isPhiEnabled } from "@/lib/phi/db"
import { saveVaccination } from "@/lib/phi/vaccination-store"
import { logAuditEvent } from "@/lib/audit-actions"
import { computeCatalogHash, VACCINES } from "@/lib/vaccines/catalog"
import type {
  PatientInfo,
  VaccinationAdministration,
  VaccinationOutcome,
  WithholdReason,
} from "@/types"

export interface SaveVaccinationPayload {
  patient: PatientInfo
  vaccinationClientId: string
  vaccineId: string
  vaccineName: string
  outcome: VaccinationOutcome
  administration: VaccinationAdministration | null
  withholdReason?: WithholdReason
  withholdNote?: string
  contraindicationsChecked: string[]
  consentId?: string | null
}

// Phase-1 no-op stub: returns { vaccinationId: null } without a DB call or audit
// when PHI persistence is off (or the pharmacist has no pharmacy). The VAR PDF
// is produced client-side as the durable legal artefact. Lights up with the
// PHI_PERSIST_ENABLED flag (Phase 2) and no further code change.
export async function saveVaccinationAction(
  payload: SaveVaccinationPayload,
): Promise<{ vaccinationId: string | null }> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return { vaccinationId: null }

  if (!isPhiEnabled()) return { vaccinationId: null }

  // Defence-in-depth re-validation (design §5.3): the client UI constrains these,
  // but the server never trusts client input for a legal artefact.
  if (payload.outcome === "administered") {
    const a = payload.administration
    if (!a || !a.lotNumber.trim()) throw new Error("Lot number is required.")
    if (!a.expiryDate.trim()) throw new Error("Expiry date is required.")
    if (!a.doseNumber || a.doseNumber < 1) throw new Error("Dose number is required.")
  }

  const { vaccinationId } = await saveVaccination({
    patient: payload.patient,
    vaccinationClientId: payload.vaccinationClientId,
    vaccineId: payload.vaccineId,
    vaccineName: payload.vaccineName,
    outcome: payload.outcome,
    administration: payload.administration,
    withholdReason: payload.withholdReason,
    withholdNote: payload.withholdNote,
    contraindicationsChecked: payload.contraindicationsChecked,
    consentId: payload.consentId ?? undefined,
    protocolVersion: computeCatalogHash(VACCINES),
  })

  if (vaccinationId) {
    // Non-PHI audit only: strictly { vaccination_id }. No vaccine_id, no
    // lot_number, no patient data — the metadata PHI-leak guard enforces this.
    await logAuditEvent("vaccination.administered", {
      vaccination_id: vaccinationId,
    })
  }

  return { vaccinationId }
}
