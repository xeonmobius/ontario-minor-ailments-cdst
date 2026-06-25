import { describe, it, expect } from "vitest"
import {
  CONSENT_STATEMENT_VERSION,
  CONSENT_STATEMENTS_HASH,
  MINOR_AILMENTS_CONSENT_STATEMENTS,
  SDM_ATTESTATION,
  computeStatementHash,
  renderStatement,
} from "@/lib/consent/statements"

describe("consent statements", () => {
  it("exposes exactly the three required statement keys with stable versioning", () => {
    expect(CONSENT_STATEMENT_VERSION).toBe("minor-ailments-v1")
    const keys = MINOR_AILMENTS_CONSENT_STATEMENTS.map((s) => s.key)
    expect(keys).toEqual(["consent_to_assess", "consent_to_record", "consent_to_followup"])
  })

  it("marks assess + record as required and followup as optional", () => {
    const byKey = Object.fromEntries(MINOR_AILMENTS_CONSENT_STATEMENTS.map((s) => [s.key, s]))
    expect(byKey.consent_to_assess.required).toBe(true)
    expect(byKey.consent_to_record.required).toBe(true)
    expect(byKey.consent_to_followup.required).toBe(false)
  })

  it("references O. Reg. 256/24 in the treatment-consent and PHIPA in the record-consent", () => {
    const text = MINOR_AILMENTS_CONSENT_STATEMENTS.map((s) => s.body).join("\n")
    expect(text).toMatch(/256\/24/)
    expect(text).toMatch(/PHIPA/)
  })

  it("interpolates pharmacy + ailment placeholders and blanks unknowns", () => {
    const out = renderStatement(
      "{{pharmacyName}} assessing me for {{ailmentName}}",
      { pharmacyName: "Rexall", ailmentName: "UTI" },
    )
    expect(out).toBe("Rexall assessing me for UTI")
    const blank = renderStatement("{{pharmacyName}} x", {})
    expect(blank).toBe(" x")
  })

  it("computes a deterministic, content-sensitive hash", () => {
    expect(CONSENT_STATEMENTS_HASH).toBe(computeStatementHash(MINOR_AILMENTS_CONSENT_STATEMENTS))
    const tampered = [{ ...MINOR_AILMENTS_CONSENT_STATEMENTS[0], body: "changed text" }, ...MINOR_AILMENTS_CONSENT_STATEMENTS.slice(1)]
    expect(computeStatementHash(tampered)).not.toBe(CONSENT_STATEMENTS_HASH)
  })

  it("is hash-stable regardless of object key insertion order (canonical field order)", () => {
    const reordered = MINOR_AILMENTS_CONSENT_STATEMENTS.map((s) => ({
      body: s.body,
      required: s.required,
      key: s.key,
      label: s.label,
    }))
    expect(computeStatementHash(reordered)).toBe(CONSENT_STATEMENTS_HASH)
  })

  it("carries the HCCA substitute-decision-maker attestation clause", () => {
    expect(SDM_ATTESTATION).toMatch(/Health Care Consent Act/)
    expect(SDM_ATTESTATION).toMatch(/substitute decision-maker/i)
  })
})
