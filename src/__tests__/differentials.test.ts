import { describe, it, expect } from "vitest"
import {
  DIFFERENTIALS,
  DIFFERENTIALS_VERSION,
  DIFFERENTIALS_HASH,
  computeDifferentialsHash,
} from "@/lib/clinical/differentials"

const AILMENT_SLUGS = [
  "acne", "allergic-rhinitis", "aphthous-ulcers", "candidal-stomatitis",
  "conjunctivitis", "dermatitis", "dysmenorrhea", "gerd", "hemorrhoids",
  "herpes-labialis", "impetigo", "insect-bites-urticaria", "musculoskeletal",
  "nausea-vomiting", "nvp", "pinworms", "tick-bites-lyme", "uti", "vvc",
]

const SKIN_SLUGS = [
  "acne", "candidal-stomatitis", "conjunctivitis", "dermatitis",
  "herpes-labialis", "impetigo", "insect-bites-urticaria", "tick-bites-lyme",
  "hemorrhoids",
]

const VALID_DISPOSITIONS = ["treat_in_tool", "refer", "otc_only"]

describe("differentials module", () => {
  it("covers all 19 ailment slugs", () => {
    expect(Object.keys(DIFFERENTIALS).length).toBe(19)
    for (const slug of AILMENT_SLUGS) {
      expect(DIFFERENTIALS[slug]).toBeDefined()
    }
  })

  it("every differential has a valid disposition and non-empty fields", () => {
    for (const entry of Object.values(DIFFERENTIALS)) {
      expect(entry.differentials.length).toBeGreaterThan(0)
      for (const d of entry.differentials) {
        expect(VALID_DISPOSITIONS).toContain(d.disposition)
        expect(d.name.length).toBeGreaterThan(0)
        expect(d.distinguishingFeatures.length).toBeGreaterThan(0)
      }
    }
  })

  it("every dermnetLinks url is a literal dermnetnz.org constant with no interpolation", () => {
    for (const entry of Object.values(DIFFERENTIALS)) {
      for (const l of entry.dermnetLinks) {
        expect(l.url).toMatch(/^https:\/\/dermnetnz\.org\/topics\//)
        expect(l.url).not.toMatch(/\$\{|\?/) // no template tokens or query strings -> PHI-leak guard
        expect(l.label.length).toBeGreaterThan(0)
        expect(l.topic.length).toBeGreaterThan(0)
      }
    }
  })

  it("dermnetLinks exist ONLY on the nine dermatological slugs", () => {
    for (const [slug, entry] of Object.entries(DIFFERENTIALS)) {
      if (SKIN_SLUGS.includes(slug)) {
        expect(entry.dermnetLinks.length).toBeGreaterThan(0)
      } else {
        expect(entry.dermnetLinks).toEqual([])
      }
    }
  })

  it("exposes a stable, versioned hash", () => {
    expect(DIFFERENTIALS_VERSION).toMatch(/^differentials-v\d+$/)
    const h1 = computeDifferentialsHash(DIFFERENTIALS)
    const h2 = computeDifferentialsHash(DIFFERENTIALS)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
    expect(DIFFERENTIALS_HASH).toBe(h1)
  })

  it("hash changes when a differential disposition changes", () => {
    const base = computeDifferentialsHash(DIFFERENTIALS)
    const modified: typeof DIFFERENTIALS = {
      ...DIFFERENTIALS,
      impetigo: {
        ...DIFFERENTIALS.impetigo,
        differentials: DIFFERENTIALS.impetigo.differentials.map((d, i) =>
          i === 0 ? { ...d, disposition: "refer" as const } : d,
        ),
      },
    }
    expect(computeDifferentialsHash(modified)).not.toBe(base)
  })
})
