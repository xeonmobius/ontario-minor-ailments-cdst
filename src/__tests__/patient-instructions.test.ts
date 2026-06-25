import { describe, it, expect } from "vitest"
import {
  PATIENT_INSTRUCTIONS_FR,
  PATIENT_INSTRUCTIONS_HASH,
  PATIENT_INSTRUCTIONS_VERSION,
  computePatientInstructionsHash,
  getFrDirections,
  getPatientInstructions,
  SAFETY_NET_EN,
  SAFETY_NET_FR,
  SIG_FALLBACK_NOTE_FR,
} from "@/lib/i18n/patient-instructions"
import { ailments, getAilmentBySlug } from "@/lib/ailments"

describe("patient-instructions FR corpus", () => {
  it("exposes a versioned module (version + hash shape)", () => {
    expect(PATIENT_INSTRUCTIONS_VERSION).toMatch(/^patient-instructions-fr-v\d+$/)
    expect(PATIENT_INSTRUCTIONS_HASH).toMatch(/^[0-9a-f]{64}$/)
  })

  it("has a deterministic hash that bumps when any FR string changes", () => {
    const baseline = computePatientInstructionsHash()
    expect(computePatientInstructionsHash()).toBe(baseline)
    expect(PATIENT_INSTRUCTIONS_HASH).toBe(baseline)

    const original = PATIENT_INSTRUCTIONS_FR.uti.followUpFr
    PATIENT_INSTRUCTIONS_FR.uti.followUpFr = "MODIFIÉ pour le test de hachage."
    const mutated = computePatientInstructionsHash()
    expect(mutated).not.toBe(baseline)
    PATIENT_INSTRUCTIONS_FR.uti.followUpFr = original
    expect(computePatientInstructionsHash()).toBe(baseline)
  })

  it("curates all 19 ailments (slug validity + no typo'd slugs)", () => {
    const curated = Object.keys(PATIENT_INSTRUCTIONS_FR)
    expect(curated).toHaveLength(19)
    for (const slug of curated) {
      expect(getAilmentBySlug(slug), `slug ${slug} must exist in data/ailments.json`).toBeDefined()
    }
    // Every real ailment slug is curated (no silent omissions).
    for (const a of ailments) {
      expect(PATIENT_INSTRUCTIONS_FR[a.slug], `missing FR corpus for ${a.slug}`).toBeDefined()
    }
  })

  it("keeps nonRxFr positionally aligned to ailment.nonRx (length invariant)", () => {
    for (const [slug, entry] of Object.entries(PATIENT_INSTRUCTIONS_FR)) {
      const ailment = getAilmentBySlug(slug)!
      expect(
        entry.nonRxFr.length,
        `${slug}: nonRxFr length ${entry.nonRxFr.length} must equal nonRx length ${ailment.nonRx.length}`,
      ).toBe(ailment.nonRx.length)
    }
  })

  it("keys every directionsByDrug entry to a real (slug, drug) pair (key-coverage invariant)", () => {
    for (const [slug, entry] of Object.entries(PATIENT_INSTRUCTIONS_FR)) {
      const ailment = getAilmentBySlug(slug)!
      const realDrugs = new Set(ailment.rxOptions.map((r) => r.drug))
      for (const drug of Object.keys(entry.directionsByDrug)) {
        expect(
          realDrugs.has(drug),
          `${slug}: directionsByDrug key "${drug}" is not a real drug string in data/ailments.json`,
        ).toBe(true)
      }
    }
  })

  it("covers every regimen with a directionsByDrug entry (dermatitis duplicate aside)", () => {
    let regimens = 0
    let uniqueKeys = 0
    for (const a of ailments) {
      regimens += a.rxOptions.length
      uniqueKeys += Object.keys(PATIENT_INSTRUCTIONS_FR[a.slug].directionsByDrug).length
    }
    // 80 regimens across 19 ailments; dermatitis's duplicate drug string
    // collapses two regimens into one key → 79 unique keys expected.
    expect(regimens).toBe(80)
    expect(uniqueKeys).toBe(79)
  })

  it("every curated entry has non-empty followUpFr + at least one nonRxFr item", () => {
    for (const [slug, entry] of Object.entries(PATIENT_INSTRUCTIONS_FR)) {
      expect(entry.followUpFr.length, `${slug} followUpFr`).toBeGreaterThan(0)
      expect(entry.nonRxFr.length, `${slug} nonRxFr`).toBeGreaterThan(0)
      for (const d of Object.values(entry.directionsByDrug)) {
        expect(d.fr.length).toBeGreaterThan(0)
      }
    }
  })

  it("getPatientInstructions returns undefined for EN (source of truth is data/) and unknown slugs", () => {
    expect(getPatientInstructions("uti", "en")).toBeUndefined()
    expect(getPatientInstructions("nonexistent-slug", "fr")).toBeUndefined()
    expect(getPatientInstructions("uti", "fr")).toBeDefined()
  })

  it("getFrDirections returns undefined on a miss and the FR string on a hit", () => {
    expect(getFrDirections("uti", "Nitrofurantoin 100 mg")).toMatch(/2 fois par jour/)
    expect(getFrDirections("uti", "Nonexistent Drug")).toBeUndefined()
    expect(getFrDirections("nonexistent-slug", "anything")).toBeUndefined()
  })

  it("ships the universal safety-net + fallback note in both languages", () => {
    expect(SAFETY_NET_EN.length).toBeGreaterThan(0)
    expect(SAFETY_NET_FR.length).toBeGreaterThan(0)
    // The FR fallback note must point the patient to the pharmacist (spec §4.3).
    expect(SIG_FALLBACK_NOTE_FR).toMatch(/pharmacien/i)
  })
})
