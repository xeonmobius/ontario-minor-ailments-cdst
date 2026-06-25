import { describe, it, expect, vi, beforeEach } from "vitest"

const query = vi.fn()
const isPhiEnabled = vi.fn()

vi.mock("@/lib/phi/db", () => ({
  query: (...args: unknown[]) => query(...args),
  isPhiEnabled: () => isPhiEnabled(),
}))
vi.mock("@/lib/phi/identity", () => ({
  generateRecordId: () => "sig-id-1",
}))
vi.mock("@/lib/auth-guards", () => ({ requireAuth: async () => ({ id: "u1", pharmacyId: "pharm-1" }) }))

import {
  getCurrentSignature,
  upsertSignature,
  stampAssessmentSignature,
} from "@/lib/signature-store"

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo="

describe("getCurrentSignature", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  it("is a no-op (returns null, no query) when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await getCurrentSignature("u1", "pharm-1")
    expect(res).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it("returns a PharmacistSignature with a decoded data URL, scoped by pharmacist_id + pharmacy_id", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([
      {
        id: "sig-id-1",
        pharmacist_id: "u1",
        signature_png: Buffer.from("iVBORw0KGgo=", "base64"),
        attestation_version: "pharmacist-esig-v1",
        enrolled_at: "2026-06-24T00:00:00.000Z",
      },
    ])
    const res = await getCurrentSignature("u1", "pharm-1")
    expect(res).not.toBeNull()
    expect(res!.id).toBe("sig-id-1")
    expect(res!.signatureDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(res!.attestationVersion).toBe("pharmacist-esig-v1")
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("FROM phi.pharmacist_signature")
    expect(sql).toContain("WHERE pharmacist_id = $1 AND pharmacy_id = $2")
    expect(params).toEqual(["u1", "pharm-1"])
  })

  it("returns null when no row exists", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([])
    expect(await getCurrentSignature("u1", "pharm-1")).toBeNull()
  })
})

describe("upsertSignature", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  it("is a no-op (returns null) when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await upsertSignature({
      pharmacistId: "u1",
      pharmacyId: "pharm-1",
      signatureDataUrl: PNG_DATA_URL,
      attestationVersion: "pharmacist-esig-v1",
      attestationHash: "abc",
    })
    expect(res).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it("issues an INSERT ... ON CONFLICT (pharmacist_id) DO UPDATE with the bytea as a parameter", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([{ id: "sig-id-1" }])
    const res = await upsertSignature({
      pharmacistId: "u1",
      pharmacyId: "pharm-1",
      signatureDataUrl: PNG_DATA_URL,
      attestationVersion: "pharmacist-esig-v1",
      attestationHash: "abc",
    })
    expect(res).toEqual({ id: "sig-id-1" })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("INSERT INTO phi.pharmacist_signature")
    expect(sql).toContain("ON CONFLICT (pharmacist_id) DO UPDATE")
    // The stroke travels as a $-parameter (bytea), never interpolated into SQL.
    expect(params.some((p: unknown) => Buffer.isBuffer(p))).toBe(true)
    expect(params).toContain("u1")
    expect(params).toContain("pharm-1")
  })

  it("rejects a non-PNG data URL before any write", async () => {
    isPhiEnabled.mockReturnValue(true)
    await expect(
      upsertSignature({
        pharmacistId: "u1",
        pharmacyId: "pharm-1",
        signatureDataUrl: "data:image/jpeg;base64,AAA=",
        attestationVersion: "pharmacist-esig-v1",
        attestationHash: "abc",
      }),
    ).rejects.toThrow(/PNG data URL/)
    expect(query).not.toHaveBeenCalled()
  })

  it("every FROM/INTO pharmacist_signature query text contains pharmacist_id (CI scoping guard)", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([
      {
        id: "sig-id-1",
        pharmacist_id: "u1",
        signature_png: Buffer.from("iVBORw0KGgo=", "base64"),
        attestation_version: "pharmacist-esig-v1",
        enrolled_at: "2026-06-24T00:00:00.000Z",
      },
    ])
    await getCurrentSignature("u1", "pharm-1")
    query.mockResolvedValue([{ id: "sig-id-1" }])
    await upsertSignature({
      pharmacistId: "u1",
      pharmacyId: "pharm-1",
      signatureDataUrl: PNG_DATA_URL,
      attestationVersion: "pharmacist-esig-v1",
      attestationHash: "abc",
    })
    for (const [sql] of query.mock.calls) {
      expect(sql.toLowerCase()).toContain("pharmacist_id")
    }
  })
})

describe("stampAssessmentSignature", () => {
  beforeEach(() => {
    query.mockReset()
    isPhiEnabled.mockReset()
  })

  it("is a no-op (returns null) when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await stampAssessmentSignature({
      txId: "tx-1",
      pharmacyId: "pharm-1",
      signatureId: "sig-id-1",
      attestationVersion: "pharmacist-esig-v1",
    })
    expect(res).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it("issues a write-once UPDATE scoped by tx_id + pharmacy_id + signed_at IS NULL", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([{ signed_at: "2026-06-24T12:00:00.000Z" }])
    const res = await stampAssessmentSignature({
      txId: "tx-1",
      pharmacyId: "pharm-1",
      signatureId: "sig-id-1",
      attestationVersion: "pharmacist-esig-v1",
    })
    expect(res).toEqual({ signedAt: "2026-06-24T12:00:00.000Z" })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain("UPDATE phi.assessments")
    expect(sql).toContain("SET pharmacist_signature_id = $1")
    expect(sql).toContain("WHERE tx_id = $3 AND pharmacy_id = $4 AND signed_at IS NULL")
    expect(params).toContain("sig-id-1")
    expect(params).toContain("tx-1")
    expect(params).toContain("pharm-1")
  })

  it("returns null when the row was already signed (write-once no-op)", async () => {
    isPhiEnabled.mockReturnValue(true)
    query.mockResolvedValue([])
    const res = await stampAssessmentSignature({
      txId: "tx-1",
      pharmacyId: "pharm-1",
      signatureId: "sig-id-1",
      attestationVersion: "pharmacist-esig-v1",
    })
    expect(res).toBeNull()
  })
})
