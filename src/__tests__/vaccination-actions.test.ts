import { describe, it, expect, vi, beforeEach } from "vitest"

const requireAuth = vi.fn()
const isPhiEnabled = vi.fn()
const saveVaccination = vi.fn()
const logAuditEvent = vi.fn()

vi.mock("@/lib/auth-guards", () => ({ requireAuth: () => requireAuth() }))
vi.mock("@/lib/phi/db", () => ({ isPhiEnabled: () => isPhiEnabled() }))
vi.mock("@/lib/phi/vaccination-store", () => ({
  saveVaccination: (...args: unknown[]) => saveVaccination(...args),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: (...args: unknown[]) => logAuditEvent(...args),
}))

import { saveVaccinationAction } from "@/lib/vaccination-actions"
import type {
  PatientInfo,
  VaccinationAdministration,
} from "@/types"
import { VACCINES } from "@/lib/vaccines/catalog"

const patient: PatientInfo = {
  name: "Jane Doe",
  dob: "1990-01-01",
  sex: "Female",
  address: "",
  city: "",
  postalCode: "",
  phone: "",
  doctorName: "",
  doctorPhone: "",
  doctorFax: "",
  doctorAddress: "",
  encounterType: "In-Person",
}

const admin: VaccinationAdministration = {
  vaccineId: "influenza",
  vaccineName: "Influenza (inactivated)",
  lotNumber: "FLU123",
  expiryDate: "2027-01-01",
  manufacturer: "Fluzone",
  doseNumber: 1,
  seriesTotal: 1,
  route: "IM",
  site: "left_deltoid",
  doseVolume: "0.5 mL",
  administrationNotes: "",
}

describe("saveVaccinationAction", () => {
  beforeEach(() => {
    requireAuth.mockReset()
    isPhiEnabled.mockReset()
    saveVaccination.mockReset()
    logAuditEvent.mockReset()
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: "pharm-1" })
  })

  it("returns null and writes nothing when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await saveVaccinationAction({
      patient,
      vaccinationClientId: "client-1",
      vaccineId: "influenza",
      vaccineName: "Influenza (inactivated)",
      outcome: "administered",
      administration: admin,
      contraindicationsChecked: [],
    })
    expect(res).toEqual({ vaccinationId: null })
    expect(saveVaccination).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it("returns null without a store call when the profile has no pharmacy", async () => {
    isPhiEnabled.mockReturnValue(true)
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: null })
    const res = await saveVaccinationAction({
      patient,
      vaccinationClientId: "client-1",
      vaccineId: "influenza",
      vaccineName: "Influenza (inactivated)",
      outcome: "administered",
      administration: admin,
      contraindicationsChecked: [],
    })
    expect(res).toEqual({ vaccinationId: null })
    expect(saveVaccination).not.toHaveBeenCalled()
  })

  it("server-side re-validation rejects administered without lot/expiry (never trusts client)", async () => {
    isPhiEnabled.mockReturnValue(true)
    await expect(
      saveVaccinationAction({
        patient,
        vaccinationClientId: "client-1",
        vaccineId: "influenza",
        vaccineName: "Influenza (inactivated)",
        outcome: "administered",
        administration: { ...admin, lotNumber: "" },
        contraindicationsChecked: [],
      }),
    ).rejects.toThrow(/Lot number is required/)
    expect(saveVaccination).not.toHaveBeenCalled()
  })

  it("persists, then emits a non-PHI vaccination.administered audit with only {vaccination_id}", async () => {
    isPhiEnabled.mockReturnValue(true)
    saveVaccination.mockResolvedValue({ vaccinationId: "v-9" })
    const res = await saveVaccinationAction({
      patient,
      vaccinationClientId: "client-1",
      vaccineId: "influenza",
      vaccineName: "Influenza (inactivated)",
      outcome: "administered",
      administration: admin,
      contraindicationsChecked: [],
      consentId: "c-1",
    })
    expect(res).toEqual({ vaccinationId: "v-9" })
    expect(saveVaccination).toHaveBeenCalledTimes(1)

    // The store input carries the catalog hash + clinical columns.
    const storeArgs = saveVaccination.mock.calls[0][0]
    expect(storeArgs.vaccineId).toBe("influenza")
    expect(storeArgs.protocolVersion).toMatch(/^[0-9a-f]{64}$/)
    expect(storeArgs.consentId).toBe("c-1")

    expect(logAuditEvent).toHaveBeenCalledTimes(1)
    const [event, metadata] = logAuditEvent.mock.calls[0]
    expect(event).toBe("vaccination.administered")
    expect(Object.keys(metadata)).toEqual(["vaccination_id"])
    // PHI-leak guard: no vaccine_id, lot_number, dose, site, route, or patient
    // data on the Supabase event.
    const blob = JSON.stringify(metadata)
    expect(blob).not.toContain("influenza")
    expect(blob).not.toContain("FLU123")
    expect(blob).not.toContain("Jane Doe")
    expect(blob).not.toContain("1990-01-01")
    expect(blob).not.toContain("vaccine_id")
    expect(blob).not.toContain("lot_number")
  })

  it("computes the protocol_version from the real catalog hash", async () => {
    isPhiEnabled.mockReturnValue(true)
    saveVaccination.mockResolvedValue({ vaccinationId: "v-9" })
    await saveVaccinationAction({
      patient,
      vaccinationClientId: "client-1",
      vaccineId: "influenza",
      vaccineName: "Influenza (inactivated)",
      outcome: "administered",
      administration: admin,
      contraindicationsChecked: [],
    })
    const storeArgs = saveVaccination.mock.calls[0][0]
    // Recompute from the imported catalog the same way the action does.
    const { computeCatalogHash } = await import("@/lib/vaccines/catalog")
    expect(storeArgs.protocolVersion).toBe(computeCatalogHash(VACCINES))
  })
})
