import { describe, it, expect, vi, beforeEach } from "vitest"

const requireAuth = vi.fn()
const isPhiEnabled = vi.fn()
const saveConsent = vi.fn()
const logAuditEvent = vi.fn()

vi.mock("@/lib/auth-guards", () => ({ requireAuth: () => requireAuth() }))
vi.mock("@/lib/phi/db", () => ({ isPhiEnabled: () => isPhiEnabled() }))
vi.mock("@/lib/consent-store", () => ({ saveConsent: (...args: unknown[]) => saveConsent(...args) }))
vi.mock("@/lib/audit-actions", () => ({ logAuditEvent: (...args: unknown[]) => logAuditEvent(...args) }))
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => (k === "x-forwarded-for" ? "1.2.3.4" : null) }),
}))

import { saveConsentAction } from "@/lib/consent-actions"
import { CONSENT_STATEMENT_VERSION } from "@/lib/consent/statements"
import type { ConsentCapture } from "@/types"

function validConsent(overrides: Partial<ConsentCapture> = {}): ConsentCapture {
  return {
    consentToAssess: true,
    consentToRecord: true,
    consentToFollowup: false,
    statementVersion: CONSENT_STATEMENT_VERSION,
    signerName: "Jane Doe",
    signerRelationship: "self",
    signatureDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    captureMethod: "signature",
    capturedAt: "2026-06-23T00:00:00.000Z",
    ...overrides,
  }
}

describe("saveConsentAction", () => {
  beforeEach(() => {
    requireAuth.mockReset()
    isPhiEnabled.mockReset()
    saveConsent.mockReset()
    logAuditEvent.mockReset()
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: "pharm-1" })
  })

  it("returns null and writes nothing when PHI persistence is off (Phase 1)", async () => {
    isPhiEnabled.mockReturnValue(false)
    const res = await saveConsentAction({ consent: validConsent(), patient: { name: "Jane Doe", dob: "1990-01-01" } })
    expect(res).toEqual({ consentId: null })
    expect(saveConsent).not.toHaveBeenCalled()
    expect(logAuditEvent).not.toHaveBeenCalled()
  })

  it("returns null without a store call when the profile has no pharmacy", async () => {
    isPhiEnabled.mockReturnValue(true)
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: null })
    const res = await saveConsentAction({ consent: validConsent(), patient: { name: "Jane Doe", dob: "1990-01-01" } })
    expect(res).toEqual({ consentId: null })
    expect(saveConsent).not.toHaveBeenCalled()
  })

  it("throws on server-side re-validation of required consents (never trusts client booleans)", async () => {
    isPhiEnabled.mockReturnValue(true)
    await expect(
      saveConsentAction({ consent: validConsent({ consentToRecord: false }), patient: { name: "Jane Doe", dob: "1990-01-01" } }),
    ).rejects.toThrow(/Required consents missing/)
    await expect(
      saveConsentAction({ consent: validConsent({ signerName: "" }), patient: { name: "Jane Doe", dob: "1990-01-01" } }),
    ).rejects.toThrow(/Signer name is required/)
    await expect(
      saveConsentAction({ consent: validConsent({ captureMethod: "signature", signatureDataUrl: null }), patient: { name: "Jane Doe", dob: "1990-01-01" } }),
    ).rejects.toThrow(/Signature is required/)
    await expect(
      saveConsentAction({ consent: validConsent({ statementVersion: "stale-v0" }), patient: { name: "Jane Doe", dob: "1990-01-01" } }),
    ).rejects.toThrow(/statement version mismatch/)
    expect(saveConsent).not.toHaveBeenCalled()
  })

  it("persists, then emits a non-PHI consent.captured audit with only {consent_id, statement_version, capture_method}", async () => {
    isPhiEnabled.mockReturnValue(true)
    saveConsent.mockResolvedValue({ consentId: "c-9" })
    const res = await saveConsentAction({
      consent: validConsent(),
      patient: { name: "Jane Doe", dob: "1990-01-01" },
      assessmentTxId: "tx-1",
    })
    expect(res).toEqual({ consentId: "c-9" })
    expect(saveConsent).toHaveBeenCalledTimes(1)
    const storeArgs = saveConsent.mock.calls[0][0]
    // Signature decoded to a Buffer for bytea storage
    expect(Buffer.isBuffer(storeArgs.signaturePng)).toBe(true)
    expect(storeArgs.pharmacyId).toBe("pharm-1")
    expect(storeArgs.pharmacistId).toBe("u1")
    expect(storeArgs.assessmentTxId).toBe("tx-1")
    expect(logAuditEvent).toHaveBeenCalledTimes(1)
    const [event, metadata] = logAuditEvent.mock.calls[0]
    expect(event).toBe("consent.captured")
    expect(Object.keys(metadata).sort()).toEqual(["capture_method", "consent_id", "statement_version"])
    // PHI-leak guard: no patient name, dob, signer key, or signature bytes on
    // the Supabase event (capture_method's value "signature" is non-identifying
    // and is expected).
    const blob = JSON.stringify(metadata)
    expect(blob).not.toContain("Jane Doe")
    expect(blob).not.toContain("1990-01-01")
    expect(blob).not.toContain("signer")
    expect(blob).not.toContain("iVBOR")
  })

  it("rejects an oversized signature payload (>200KB decoded) before the fly.io write", async () => {
    isPhiEnabled.mockReturnValue(true)
    // base64 decodes to ~3/4 its char length, so push past 200KB of BYTES.
    const huge = "data:image/png;base64," + "A".repeat(300 * 1024)
    await expect(
      saveConsentAction({ consent: validConsent({ signatureDataUrl: huge }), patient: { name: "Jane Doe", dob: "1990-01-01" } }),
    ).rejects.toThrow(/Signature payload too large/)
    expect(saveConsent).not.toHaveBeenCalled()
  })
})
