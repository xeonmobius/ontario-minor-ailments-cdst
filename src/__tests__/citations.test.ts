import { describe, it, expect } from "vitest"
import {
  CITATIONS,
  CITATIONS_VERSION,
  CITATIONS_HASH,
  computeCitationsHash,
  getCitations,
} from "@/lib/clinical/citations"

const AILMENT_SLUGS = [
  "acne", "allergic-rhinitis", "aphthous-ulcers", "candidal-stomatitis",
  "conjunctivitis", "dermatitis", "dysmenorrhea", "gerd", "hemorrhoids",
  "herpes-labialis", "impetigo", "insect-bites-urticaria", "musculoskeletal",
  "nausea-vomiting", "nvp", "pinworms", "tick-bites-lyme", "uti", "vvc",
]

const VALID_TYPES = [
  "guideline",
  "study",
  "systematic-review",
  "regulatory",
  "monograph",
]

const VALID_STEPS = ["redFlagScreening", "rxSelection", "nonRxAdvice", "followUp"]

describe("citations module", () => {
  it("covers all 19 ailment slugs", () => {
    expect(Object.keys(CITATIONS).length).toBe(19)
    for (const slug of AILMENT_SLUGS) {
      expect(CITATIONS[slug]).toBeDefined()
    }
  })

  it("every ailment carries at least one regulatory citation", () => {
    for (const entry of Object.values(CITATIONS)) {
      expect(entry.regulatory.length).toBeGreaterThan(0)
    }
  })

  it("every citation has a valid type and a non-empty source", () => {
    for (const entry of Object.values(CITATIONS)) {
      const all = [...entry.regulatory, ...entry.primary]
      if (entry.byStep) {
        for (const step of Object.keys(entry.byStep) as (keyof typeof entry.byStep)[]) {
          all.push(...(entry.byStep[step] ?? []))
        }
      }
      for (const c of all) {
        expect(VALID_TYPES).toContain(c.type)
        expect(c.source.length).toBeGreaterThan(0)
        expect(c.id.length).toBeGreaterThan(0)
      }
    }
  })

  it("every byStep key is a valid protocol step", () => {
    for (const entry of Object.values(CITATIONS)) {
      if (!entry.byStep) continue
      for (const step of Object.keys(entry.byStep)) {
        expect(VALID_STEPS).toContain(step)
      }
    }
  })

  it("every url and doi is a literal constant with no interpolation/query (PHI-leak guard)", () => {
    for (const entry of Object.values(CITATIONS)) {
      const all = [...entry.regulatory, ...entry.primary]
      if (entry.byStep) {
        for (const list of Object.values(entry.byStep)) all.push(...(list ?? []))
      }
      for (const c of all) {
        if (c.url) {
          expect(c.url).toMatch(/^https?:\/\//)
          expect(c.url).not.toMatch(/\$\{|\?/) // no template token, no query string
        }
        if (c.doi) {
          expect(c.doi).not.toMatch(/\$\{|\?/)
        }
      }
    }
  })

  it("exposes a deterministic, versioned hash", () => {
    expect(CITATIONS_VERSION).toMatch(/^citations-v\d+$/)
    const h1 = computeCitationsHash(CITATIONS)
    const h2 = computeCitationsHash(CITATIONS)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
    expect(CITATIONS_HASH).toBe(h1)
  })

  it("hash changes when a citation type changes (governance sensitivity)", () => {
    const base = computeCitationsHash(CITATIONS)
    const modified: typeof CITATIONS = {
      ...CITATIONS,
      pinworms: {
        ...CITATIONS.pinworms,
        primary: CITATIONS.pinworms.primary.map((c) =>
          c.id === "canadian-pinworms"
            ? { ...c, type: "monograph" as const }
            : c,
        ),
      },
    }
    expect(computeCitationsHash(modified)).not.toBe(base)
  })

  it("getCitations dedupes by id across regulatory + primary + steps and includes regulatory", () => {
    const all = getCitations("uti")
    const ids = all.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length) // no dupes
    expect(all.some((c) => c.id === "on-o-reg-256-24")).toBe(true) // regulatory present
  })

  it("getCitations returns [] for an unknown slug", () => {
    expect(getCitations("not-a-real-ailment")).toEqual([])
  })
})
