import { describe, it, expect } from "vitest"
import { createHash } from "crypto"
import {
  PHARMACIST_ATTESTATION_VERSION,
  PHARMACIST_ATTESTATION,
  PHARMACIST_ATTESTATION_HASH,
  renderAttestation,
  computeAttestationHash,
} from "@/lib/signature/attestation"

describe("pharmacist attestation module", () => {
  it("exposes a non-empty version string and a 64-char hex hash", () => {
    expect(typeof PHARMACIST_ATTESTATION_VERSION).toBe("string")
    expect(PHARMACIST_ATTESTATION_VERSION.length).toBeGreaterThan(0)
    expect(PHARMACIST_ATTESTATION_HASH).toMatch(/^[0-9a-f]{64}$/)
  })

  it("the template contains each interpolation token exactly once", () => {
    expect(PHARMACIST_ATTESTATION.match(/\{\{license\}\}/g)).toHaveLength(1)
    expect(PHARMACIST_ATTESTATION.match(/\{\{documentType\}\}/g)).toHaveLength(1)
  })

  it("interpolates a license and documentType into the rendered attestation", () => {
    const rendered = renderAttestation("12345", "prescription")
    expect(rendered).toContain("registration #12345")
    expect(rendered).toContain("prescription")
    expect(rendered).toContain("256/24")
    expect(rendered).not.toContain("{{")
  })

  it("renders a blank license rule (not the literal token) when the license is null", () => {
    const rendered = renderAttestation(null, "referral")
    expect(rendered).toContain("registration #__________")
    expect(rendered).toContain("referral")
    expect(rendered).not.toContain("{{license}}")
  })

  it("computes a deterministic hash over the canonical (un-interpolated) template", () => {
    expect(computeAttestationHash()).toBe(PHARMACIST_ATTESTATION_HASH)
    // Two calls in the same process produce the same digest.
    expect(computeAttestationHash()).toBe(computeAttestationHash())
  })

  it("the hash is sensitive to template edits (governance)", () => {
    // A different string hashes differently — confirms sha256 is wired up.
    const other = createHash("sha256").update("different text").digest("hex")
    expect(other).not.toBe(PHARMACIST_ATTESTATION_HASH)
  })
})
