import { describe, it, expect } from "vitest"
import {
  VACCINE_CATALOG_VERSION,
  VACCINES,
  VACCINE_CATALOG_HASH,
  computeCatalogHash,
  getVaccineByVaccineId,
} from "@/lib/vaccines/catalog"

describe("vaccine catalog", () => {
  it("exposes a version + a deterministic 64-char hex hash", () => {
    expect(VACCINE_CATALOG_VERSION).toBe("vaccines-v1")
    expect(VACCINE_CATALOG_HASH).toMatch(/^[0-9a-f]{64}$/)
    expect(computeCatalogHash()).toBe(VACCINE_CATALOG_HASH)
  })

  it("hash is deterministic and order-independent (sorted tuples)", () => {
    const a = computeCatalogHash(VACCINES)
    const b = computeCatalogHash([...VACCINES].reverse())
    expect(a).toBe(b)
  })

  it("hash is sensitive to content (name change alters it)", () => {
    const original = computeCatalogHash(VACCINES)
    const mutated = [{ ...VACCINES[0], name: "Different Name" }, ...VACCINES.slice(1)]
    expect(computeCatalogHash(mutated)).not.toBe(original)
  })

  it("every vaccine has a stable id, name, route, site, volume, seriesTotal, and contraindications", () => {
    for (const v of VACCINES) {
      expect(v.vaccineId).toBeTruthy()
      expect(v.name).toBeTruthy()
      expect(v.defaultRoute).toBeTruthy()
      expect(v.defaultSite).toBeTruthy()
      expect(v.doseVolume).toBeTruthy()
      expect(v.seriesTotal).toBeGreaterThanOrEqual(1)
      expect(v.contraindications.length).toBeGreaterThan(0)
      expect(v.patientEducation.length).toBeGreaterThan(0)
      // Contraindication ids are unique within a vaccine (hash key stability).
      const ids = v.contraindications.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const c of v.contraindications) {
        expect(["withhold", "caution"]).toContain(c.severity)
      }
    }
  })

  it("vaccineIds are unique", () => {
    const ids = VACCINES.map((v) => v.vaccineId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("getVaccineByVaccineId resolves a known id and returns undefined for unknown", () => {
    expect(getVaccineByVaccineId("influenza")?.name).toBeTruthy()
    expect(getVaccineByVaccineId("does-not-exist")).toBeUndefined()
  })

  it("every vaccine includes the canonical severe-allergic-reaction withhold item", () => {
    for (const v of VACCINES) {
      const has = v.contraindications.some(
        (c) => c.id === "severe_allergic_reaction" && c.severity === "withhold",
      )
      expect(has).toBe(true)
    }
  })
})
