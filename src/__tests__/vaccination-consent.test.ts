import { describe, it, expect } from "vitest"
import {
  VACCINATION_CONSENT_VERSION,
  VACCINATION_CONSENT_STATEMENTS,
  VACCINATION_CONSENT_HASH,
  computeVaccinationStatementHash,
  renderVaccinationStatement,
} from "@/lib/vaccines/consent-statements"
import { WITHHOLD_REASONS, getWithholdReasonOption } from "@/lib/vaccines/withhold-reasons"

describe("vaccination consent statements", () => {
  it("exposes a version + deterministic 64-char hex hash", () => {
    expect(VACCINATION_CONSENT_VERSION).toBe("vaccination-v1")
    expect(VACCINATION_CONSENT_HASH).toMatch(/^[0-9a-f]{64}$/)
    expect(computeVaccinationStatementHash()).toBe(VACCINATION_CONSENT_HASH)
  })

  it("has exactly the three statements with the required vaccination + record gates", () => {
    const keys = VACCINATION_CONSENT_STATEMENTS.map((s) => s.key)
    expect(keys).toEqual(["consent_to_vaccinate", "consent_to_record", "consent_to_followup"])
    const vax = VACCINATION_CONSENT_STATEMENTS.find((s) => s.key === "consent_to_vaccinate")
    const rec = VACCINATION_CONSENT_STATEMENTS.find((s) => s.key === "consent_to_record")
    expect(vax?.required).toBe(true)
    expect(rec?.required).toBe(true)
  })

  it("renders the {{vaccineName}} placeholder and blanks unknown tokens", () => {
    const body = VACCINATION_CONSENT_STATEMENTS[0].body
    const rendered = renderVaccinationStatement(body, { vaccineName: "Influenza" })
    expect(rendered).toContain("Influenza")
    expect(rendered).not.toContain("{{vaccineName}}")
  })
})

describe("withhold reasons", () => {
  it("referred_to_physician is the only referral-producing reason", () => {
    const referrals = WITHHOLD_REASONS.filter((r) => r.producesReferral)
    expect(referrals.map((r) => r.value)).toEqual(["referred_to_physician"])
  })

  it("includes all seven WithholdReason values", () => {
    const values = WITHHOLD_REASONS.map((r) => r.value)
    expect(values).toContain("contraindication_present")
    expect(values).toContain("patient_declined")
    expect(values).toContain("acute_illness_today")
    expect(values).toContain("pregnancy_live_vaccine")
    expect(values).toContain("out_of_stock")
    expect(values).toContain("referred_to_physician")
    expect(values).toContain("other")
    expect(new Set(values).size).toBe(values.length)
  })

  it("getWithholdReasonOption resolves and returns undefined for null", () => {
    expect(getWithholdReasonOption("patient_declined")?.label).toBeTruthy()
    expect(getWithholdReasonOption(null)).toBeUndefined()
  })
})
