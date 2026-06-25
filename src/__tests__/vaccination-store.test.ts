import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
const isPhiEnabled = vi.fn()

vi.mock("@/lib/phi/db", () => ({
  query: (...args: unknown[]) => query(...args),
  isPhiEnabled: () => isPhiEnabled(),
}))
vi.mock("@/lib/phi/identity", () => ({
  patientHash: (name: string, dob: string) => `hash-${name}-${dob}`,
  generateRecordId: () => "vacc-id-1",
}))
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: async () => ({ id: "u1", pharmacyId: "pharm-1" }),
}))

import { saveVaccination, getVaccinationsByLot } from "@/lib/phi/vaccination-store"
import type {
  PatientInfo,
  VaccinationAdministration,
} from "@/types"

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
  administrationNotes: "tolerated well",
}

const baseInput = {
  patient,
  vaccinationClientId: "client-1",
  vaccineId: "influenza",
  vaccineName: "Influenza (inactivated)",
  outcome: "administered" as const,
  administration: admin,
  contraindicationsChecked: [],
  protocolVersion: "abc123",
}

describe("saveVaccination", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  it("is a no-op (returns null, no query) when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await saveVaccination(baseInput)
    expect(res).toEqual({ vaccinationId: null })
    expect(query).not.toHaveBeenCalled()
  })

  it("writes a pharmacy-scoped row and returns the id when flag on", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([])
    const res = await saveVaccination(baseInput)
    expect(res).toEqual({ vaccinationId: "vacc-id-1" })
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("INSERT INTO phi.vaccinations")
    expect(sql).toContain("pharmacy_id")
    expect(params).toContain("pharm-1")
    expect(params).toContain("hash-Jane Doe-1990-01-01")
    expect(params).toContain("FLU123")
    // Clinical columns (lot, route, site) travel as $-parameters.
    expect(params).toContain("IM")
    expect(params).toContain("left_deltoid")
  })

  it("CI scoping discipline: every FROM/INTO vaccination query text contains pharmacy_id", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([])
    await saveVaccination(baseInput)
    await getVaccinationsByLot({ lotNumber: "FLU123" })
    for (const call of query.mock.calls) {
      const sql = String(call[0])
      expect(sql).toContain("pharmacy_id")
    }
  })

  it("re-validates administered requires lot/expiry/dose (defence-in-depth)", async () => {
    isPhiEnabled.mockReturnValue(true)
    await expect(
      saveVaccination({ ...baseInput, administration: { ...admin, lotNumber: "" } }),
    ).rejects.toThrow(/Lot number is required/)
    await expect(
      saveVaccination({ ...baseInput, administration: { ...admin, expiryDate: "" } }),
    ).rejects.toThrow(/Expiry date is required/)
    expect(query).not.toHaveBeenCalled()
  })

  it("re-validates the outcome/route/site enums", async () => {
    isPhiEnabled.mockReturnValue(true)
    await expect(
      saveVaccination({ ...baseInput, outcome: "nope" as never }),
    ).rejects.toThrow(/Invalid vaccination outcome/)
    await expect(
      saveVaccination({
        ...baseInput,
        administration: { ...admin, route: "PATCH" as never },
      }),
    ).rejects.toThrow(/Invalid route/)
    expect(query).not.toHaveBeenCalled()
  })
})

describe("getVaccinationsByLot", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  it("scopes the lot-recall query by pharmacy_id", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([{ id: "v1", lot_number: "FLU123" }])
    const res = await getVaccinationsByLot({ lotNumber: "FLU123" })
    expect(res.data?.[0]?.id).toBe("v1")
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("FROM phi.vaccinations")
    expect(sql).toContain("WHERE pharmacy_id = $1 AND lot_number = $2")
    expect(params).toEqual(["pharm-1", "FLU123"])
  })
})
