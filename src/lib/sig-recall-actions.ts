"use server"

import { requireAuth } from "@/lib/auth-guards"
import { getLastUsedSig } from "@/lib/phi/assessment-store"
import type { PatientIdentity, RecalledSig } from "@/types"

// Phase-2 per-patient "last-used Rx" recall. Reads #2's phi.assessments store
// (read-only). A flag-guarded no-op until PHI persistence is live: returns null
// with no database call when PHI_PERSIST_ENABLED !== "true", so the wizard
// proceeds on smart-sig defaults only and never blocks a consult.
//
// The patient identity travels only inside this Server Action POST body and is
// hashed server-side via patientHash (PHI_IDENTITY_SALT, never client-exposed).
export async function getRecalledSigAction({
  ailmentId,
  drug,
  patient,
}: {
  ailmentId: string
  drug: string
  patient: PatientIdentity
}): Promise<RecalledSig | null> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return null
  if (process.env.PHI_PERSIST_ENABLED !== "true") return null
  if (!patient.name || !patient.dob) return null
  return getLastUsedSig({
    pharmacyId: profile.pharmacyId,
    patientName: patient.name,
    patientDob: patient.dob,
    ailmentId,
    drug,
  })
}
