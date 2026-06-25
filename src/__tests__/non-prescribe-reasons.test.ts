import { describe, it, expect } from "vitest"
import {
  NON_PRESCRIBE_REASONS,
  REASON_TAXONOMY_VERSION,
  computeReasonTaxonomyHash,
  getReasonOption,
} from "@/lib/non-prescribe/reasons"
import { ABANDONMENT_REASONS } from "@/lib/non-prescribe/abandonment-reasons"

describe("non-prescribe reasons taxonomy", () => {
  it("exposes a stable taxonomy version", () => {
    expect(REASON_TAXONOMY_VERSION).toBe("non-prescribe-v1")
  })

  it("contains the seven design options", () => {
    const values = NON_PRESCRIBE_REASONS.map((r) => r.value)
    expect(values).toEqual([
      "patient_declined",
      "otc_sufficient",
      "clinical_judgment",
      "already_treating",
      "referred_to_physician",
      "referred_elsewhere",
      "other",
    ])
  })

  it("only marks referred_to_physician as requiring referral context", () => {
    const requiring = NON_PRESCRIBE_REASONS.filter((r) => r.requiresReferralContext)
    expect(requiring.map((r) => r.value)).toEqual(["referred_to_physician"])
  })

  it("produces a deterministic 64-char hex hash", () => {
    const hash = computeReasonTaxonomyHash()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(computeReasonTaxonomyHash()).toBe(hash)
  })

  it("resolves an option by value", () => {
    expect(getReasonOption("patient_declined")?.label).toMatch(/declined/i)
    expect(getReasonOption(null)).toBeUndefined()
  })
})

describe("abandonment reasons", () => {
  it("contains the five design options", () => {
    const values = ABANDONMENT_REASONS.map((r) => r.value)
    expect(values).toEqual(["patient_left", "patient_deferred", "lost_to_followup", "duplicate", "other"])
  })
})
