import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
const isPhiEnabled = vi.fn()

vi.mock("@/lib/phi/db", () => ({
  query: (...args: unknown[]) => query(...args),
  isPhiEnabled: () => isPhiEnabled(),
}))
vi.mock("@/lib/phi/identity", () => ({
  patientHash: (name: string, dob: string) => `hash-${name}-${dob}`,
  generateRecordId: () => "consent-id-1",
}))
vi.mock("@/lib/auth-guards", () => ({ requireAuth: async () => ({ id: "u1", pharmacyId: "pharm-1" }) }))

import { saveConsent, getConsentById } from "@/lib/consent-store"

const baseInput = {
  pharmacistId: "u1",
  pharmacyId: "pharm-1",
  patientName: "Jane Doe",
  patientDob: "1990-01-01",
  statementVersion: "minor-ailments-v1",
  statementHash: "abc",
  consentToAssess: true,
  consentToRecord: true,
  consentToFollowup: false,
  signerName: "Jane Doe",
  signerRelationship: "self" as const,
  captureMethod: "signature" as const,
  signaturePng: Buffer.from("png"),
  ipAddress: "1.2.3.4",
}

describe("saveConsent", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  it("is a no-op (returns null, no query) when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await saveConsent(baseInput)
    expect(res).toEqual({ consentId: null })
    expect(query).not.toHaveBeenCalled()
  })

  it("writes a pharmacy-scoped row and returns the consent id when flag on", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([{ id: "consent-id-1" }])
    const res = await saveConsent(baseInput)
    expect(res).toEqual({ consentId: "consent-id-1" })
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("INSERT INTO phi.consents")
    expect(sql).toContain("pharmacy_id")
    // signature_png column + its bytea value travels as a $-parameter, never
    // interpolated into the SQL text
    expect(sql).toMatch(/\$14/)
    expect(params).toContain("pharm-1")
    expect(params).toContain("hash-Jane Doe-1990-01-01")
    expect(params).toContain("consent-id-1")
    // Buffer travels as a parameter (bytea), not in the SQL text
    expect(params).toContain(baseInput.signaturePng)
  })

  it("re-validates required consents server-side (defence-in-depth)", async () => {
    isPhiEnabled.mockReturnValue(true)
    await expect(
      saveConsent({ ...baseInput, consentToRecord: false }),
    ).rejects.toThrow(/Required consents missing/)
    await expect(
      saveConsent({ ...baseInput, signerName: "  " }),
    ).rejects.toThrow(/Signer name is required/)
    await expect(
      saveConsent({ ...baseInput, captureMethod: "signature", signaturePng: null }),
    ).rejects.toThrow(/Signature is required/)
    expect(query).not.toHaveBeenCalled()
  })
})

describe("getConsentById", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  it("scopes the lookup by the caller's pharmacy_id", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([{ id: "c1", pharmacy_id: "pharm-1" }])
    const res = await getConsentById("c1")
    expect(res.data?.id).toBe("c1")
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("FROM phi.consents")
    expect(sql).toContain("WHERE id = $1 AND pharmacy_id = $2")
    expect(params).toEqual(["c1", "pharm-1"])
  })

  it("returns Not found when a cross-pharmacy row does not exist under the caller", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([])
    const res = await getConsentById("c1")
    expect(res.error).toBe("Not found")
  })
})
