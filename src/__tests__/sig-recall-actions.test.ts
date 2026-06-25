import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const getLastUsedSig = vi.fn()
const requireAuth = vi.fn()

vi.mock("@/lib/phi/assessment-store", () => ({
  getLastUsedSig: (...args: unknown[]) => getLastUsedSig(...args),
}))
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: () => requireAuth(),
}))

import { getRecalledSigAction } from "@/lib/sig-recall-actions"

const originalEnv = { ...process.env }

describe("getRecalledSigAction", () => {
  beforeEach(() => {
    getLastUsedSig.mockReset()
    requireAuth.mockReset()
    requireAuth.mockResolvedValue({
      id: "u1",
      pharmacyId: "pharm-1",
      isPlatformAdmin: false,
    })
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("returns null and skips the store when PHI persistence is off (Phase 1)", async () => {
    delete process.env.PHI_PERSIST_ENABLED
    const result = await getRecalledSigAction({
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
      patient: { name: "Jane Doe", dob: "1990-01-01" },
    })
    expect(result).toBeNull()
    expect(getLastUsedSig).not.toHaveBeenCalled()
  })

  it("returns null when identity is incomplete", async () => {
    process.env.PHI_PERSIST_ENABLED = "true"
    const result = await getRecalledSigAction({
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
      patient: { name: "", dob: "1990-01-01" },
    })
    expect(result).toBeNull()
    expect(getLastUsedSig).not.toHaveBeenCalled()
  })

  it("returns null without calling the store when the profile has no pharmacy", async () => {
    process.env.PHI_PERSIST_ENABLED = "true"
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: null })
    const result = await getRecalledSigAction({
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
      patient: { name: "Jane Doe", dob: "1990-01-01" },
    })
    expect(result).toBeNull()
    expect(getLastUsedSig).not.toHaveBeenCalled()
  })

  it("delegates to the store with the resolved pharmacy when flag on and identity complete", async () => {
    process.env.PHI_PERSIST_ENABLED = "true"
    getLastUsedSig.mockResolvedValue({
      drug: "Nitrofurantoin 100 mg",
      sig: "Take 1 cap BID",
      quantity: "10 capsules",
      refills: "0",
      duration: "5 days",
      prescribedAt: "2026-01-01T00:00:00.000Z",
    })
    const result = await getRecalledSigAction({
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
      patient: { name: "Jane Doe", dob: "1990-01-01" },
    })
    expect(result).not.toBeNull()
    expect(getLastUsedSig).toHaveBeenCalledTimes(1)
    expect(getLastUsedSig).toHaveBeenCalledWith({
      pharmacyId: "pharm-1",
      patientName: "Jane Doe",
      patientDob: "1990-01-01",
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
    })
  })
})
