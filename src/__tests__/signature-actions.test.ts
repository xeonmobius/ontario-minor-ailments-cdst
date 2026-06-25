import { describe, it, expect, vi, beforeEach } from "vitest"

const requireAuth = vi.fn()
const isPhiEnabled = vi.fn()
const getCurrentSignature = vi.fn()
const upsertSignature = vi.fn()
const stampAssessmentSignature = vi.fn()
const logAuditEvent = vi.fn()

vi.mock("@/lib/auth-guards", () => ({ requireAuth: () => requireAuth() }))
vi.mock("@/lib/phi/db", () => ({ isPhiEnabled: () => isPhiEnabled() }))
vi.mock("@/lib/signature-store", () => ({
  getCurrentSignature: (...args: unknown[]) => getCurrentSignature(...args),
  upsertSignature: (...args: unknown[]) => upsertSignature(...args),
  stampAssessmentSignature: (...args: unknown[]) => stampAssessmentSignature(...args),
}))
vi.mock("@/lib/audit-actions", () => ({ logAuditEvent: (...args: unknown[]) => logAuditEvent(...args) }))

import {
  getSignatureAction,
  enrollSignatureAction,
  applySignatureAction,
} from "@/lib/signature-actions"

const PNG = "data:image/png;base64,iVBORw0KGgo="

describe("getSignatureAction", () => {
  beforeEach(() => {
    requireAuth.mockReset()
    isPhiEnabled.mockReset()
    getCurrentSignature.mockReset()
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: "pharm-1" })
  })

  it("returns null without a store call when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    expect(await getSignatureAction()).toBeNull()
    expect(getCurrentSignature).not.toHaveBeenCalled()
  })

  it("returns null when the profile has no pharmacy", async () => {
    isPhiEnabled.mockReturnValue(true)
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: null })
    expect(await getSignatureAction()).toBeNull()
    expect(getCurrentSignature).not.toHaveBeenCalled()
  })

  it("delegates to the store scoped by the JWT pharmacist id + pharmacy id", async () => {
    isPhiEnabled.mockReturnValue(true)
    getCurrentSignature.mockResolvedValue({ id: "sig-1", signatureDataUrl: PNG })
    expect(await getSignatureAction()).toEqual({ id: "sig-1", signatureDataUrl: PNG })
    expect(getCurrentSignature).toHaveBeenCalledWith("u1", "pharm-1")
  })
})

describe("enrollSignatureAction", () => {
  beforeEach(() => {
    requireAuth.mockReset()
    isPhiEnabled.mockReset()
    upsertSignature.mockReset()
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: "pharm-1" })
  })

  it("returns ok without writing when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await enrollSignatureAction({ signatureDataUrl: PNG, saveAsCredential: true })
    expect(res).toEqual({ ok: true })
    expect(upsertSignature).not.toHaveBeenCalled()
  })

  it("returns ok without writing when saveAsCredential is false (one-off in-session stroke)", async () => {
    isPhiEnabled.mockReturnValue(true)
    const res = await enrollSignatureAction({ signatureDataUrl: PNG, saveAsCredential: false })
    expect(res).toEqual({ ok: true })
    expect(upsertSignature).not.toHaveBeenCalled()
  })

  it("server-side re-validates the payload: missing, non-PNG, and >200KB all throw", async () => {
    isPhiEnabled.mockReturnValue(true)
    await expect(
      enrollSignatureAction({ signatureDataUrl: "", saveAsCredential: true }),
    ).rejects.toThrow(/PNG data URL/)
    await expect(
      enrollSignatureAction({ signatureDataUrl: "data:image/jpeg;base64,AAA=", saveAsCredential: true }),
    ).rejects.toThrow(/PNG data URL/)
    // base64 decodes to ~3/4 its char length; push past 200KB of BYTES.
    const huge = "data:image/png;base64," + "A".repeat(300 * 1024)
    await expect(
      enrollSignatureAction({ signatureDataUrl: huge, saveAsCredential: true }),
    ).rejects.toThrow(/too large/)
    expect(upsertSignature).not.toHaveBeenCalled()
  })

  it("persists via the store with the versioned attestation version + hash when valid", async () => {
    isPhiEnabled.mockReturnValue(true)
    upsertSignature.mockResolvedValue({ id: "sig-1" })
    const res = await enrollSignatureAction({ signatureDataUrl: PNG, saveAsCredential: true })
    expect(res).toEqual({ ok: true })
    expect(upsertSignature).toHaveBeenCalledTimes(1)
    const args = upsertSignature.mock.calls[0][0]
    expect(args.pharmacistId).toBe("u1")
    expect(args.pharmacyId).toBe("pharm-1")
    expect(args.attestationVersion).toBe("pharmacist-esig-v1")
    expect(args.attestationHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("applySignatureAction", () => {
  beforeEach(() => {
    requireAuth.mockReset()
    isPhiEnabled.mockReset()
    getCurrentSignature.mockReset()
    stampAssessmentSignature.mockReset()
    logAuditEvent.mockReset()
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: "pharm-1" })
  })

  it("returns nulls without a store call when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await applySignatureAction({ assessmentTxId: "tx-1" })
    expect(res).toEqual({ signedAt: null, signatureId: null })
    expect(getCurrentSignature).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it("bails nulls when the pharmacist is not enrolled", async () => {
    isPhiEnabled.mockReturnValue(true)
    getCurrentSignature.mockResolvedValue(null)
    const res = await applySignatureAction({ assessmentTxId: "tx-1" })
    expect(res).toEqual({ signedAt: null, signatureId: null })
    expect(stampAssessmentSignature).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it("stamps the assessment (write-once) and emits a non-PHI signature.applied audit", async () => {
    isPhiEnabled.mockReturnValue(true)
    getCurrentSignature.mockResolvedValue({
      id: "sig-9",
      pharmacistId: "u1",
      signatureDataUrl: PNG,
      attestationVersion: "pharmacist-esig-v1",
    })
    stampAssessmentSignature.mockResolvedValue({ signedAt: "2026-06-24T12:00:00.000Z" })
    const res = await applySignatureAction({ assessmentTxId: "tx-1" })
    expect(res).toEqual({ signedAt: "2026-06-24T12:00:00.000Z", signatureId: "sig-9" })
    expect(stampAssessmentSignature).toHaveBeenCalledWith(
      expect.objectContaining({ txId: "tx-1", pharmacyId: "pharm-1", signatureId: "sig-9" }),
    )
    expect(logAuditEvent).toHaveBeenCalledTimes(1)
    const [event, metadata] = logAuditEvent.mock.calls[0]
    expect(event).toBe("signature.applied")
    expect(Object.keys(metadata).sort()).toEqual(["attestation_version", "signature_id"])
    // PHI-leak guard: no stroke bytes, no patient, no ailment, no document_type
    // identifying content beyond the opaque credential id + version string.
    const blob = JSON.stringify(metadata)
    expect(blob).not.toContain("iVBOR")
    expect(blob).not.toContain("png")
    expect(blob).not.toContain("prescription")
    expect(blob).not.toContain("patient")
  })
})
