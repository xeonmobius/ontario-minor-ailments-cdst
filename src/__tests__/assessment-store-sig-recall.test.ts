import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const query = vi.fn()
const isPhiEnabled = vi.fn()

vi.mock("@/lib/phi/db", () => ({
  query: (...args: unknown[]) => query(...args),
  isPhiEnabled: () => isPhiEnabled(),
}))
vi.mock("@/lib/phi/identity", () => ({
  patientHash: (name: string, dob: string) => `hash-${name}-${dob}`,
  generateRecordId: () => "id",
}))

import { getLastUsedSig } from "@/lib/phi/assessment-store"

describe("getLastUsedSig", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  afterEach(() => {
    process.env = { ...process.env }
  })

  it("returns null without querying when PHI persistence is off", async () => {
    isPhiEnabled.mockReturnValue(false)
    const result = await getLastUsedSig({
      pharmacyId: "pharm-1",
      patientName: "Jane Doe",
      patientDob: "1990-01-01",
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
    })
    expect(result).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it("issues a pharmacy-scoped, latest-prescribed lookup and maps the row", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([
      {
        selected_rx: {
          drug: "Nitrofurantoin 100 mg",
          sig: "Take 1 cap BID",
          quantity: "10 capsules",
          refills: "0",
          duration: "5 days",
        },
        created_at: "2026-01-15T12:00:00.000Z",
      },
    ])
    const result = await getLastUsedSig({
      pharmacyId: "pharm-1",
      patientName: "Jane Doe",
      patientDob: "1990-01-01",
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
    })
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("pharmacy_id = $1")
    expect(sql).toContain("patient_hash = $2")
    expect(sql).toContain("ailment_id = $3")
    expect(sql).toContain("outcome = 'prescribed'")
    expect(sql).toContain("selected_rx->>'drug' = $4")
    expect(sql).toContain("ORDER BY created_at DESC")
    expect(sql).toContain("LIMIT 1")
    expect(params).toEqual([
      "pharm-1",
      "hash-Jane Doe-1990-01-01",
      "18",
      "Nitrofurantoin 100 mg",
    ])
    expect(result).toEqual({
      drug: "Nitrofurantoin 100 mg",
      sig: "Take 1 cap BID",
      quantity: "10 capsules",
      refills: "0",
      duration: "5 days",
      prescribedAt: "2026-01-15T12:00:00.000Z",
    })
  })

  it("returns null when no prior assessment matches", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([])
    const result = await getLastUsedSig({
      pharmacyId: "pharm-1",
      patientName: "Jane Doe",
      patientDob: "1990-01-01",
      ailmentId: "18",
      drug: "Nitrofurantoin 100 mg",
    })
    expect(result).toBeNull()
  })
})
