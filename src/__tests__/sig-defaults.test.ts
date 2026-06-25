import { describe, it, expect } from "vitest"
import {
  SIG_DEFAULTS,
  SIG_DEFAULTS_VERSION,
  SIG_DEFAULTS_HASH,
  getSigDefault,
  sigDefaultKey,
  computeSigDefaultsHash,
} from "@/lib/clinical/sig-defaults"
import { ailments } from "@/lib/ailments"

describe("smart-sig defaults module", () => {
  it("exposes a stable, versioned identifier", () => {
    expect(SIG_DEFAULTS_VERSION).toMatch(/^sig-defaults-v\d+$/)
  })

  it("returns a populated SigDefault on a hit and null on a miss", () => {
    const hit = getSigDefault("uti", "Nitrofurantoin 100 mg")
    expect(hit).not.toBeNull()
    expect(hit!.sig.length).toBeGreaterThan(0)
    expect(hit!.quantity.length).toBeGreaterThan(0)
    expect(hit!.duration.length).toBeGreaterThan(0)
    expect(getSigDefault("uti", "Does Not Exist")).toBeNull()
    expect(getSigDefault("not-a-slug", "anything")).toBeNull()
  })

  it("curates every real regimen across all 19 ailments (coverage invariant)", () => {
    const expectedKeys = new Set<string>()
    for (const ailment of ailments) {
      for (const rx of ailment.rxOptions) {
        expectedKeys.add(sigDefaultKey(ailment.slug, rx.drug))
      }
    }
    const curatedKeys = new Set(Object.keys(SIG_DEFAULTS))
    // Every real regimen has a curated default.
    for (const key of expectedKeys) {
      expect(curatedKeys.has(key), `missing curated default for ${key}`).toBe(true)
    }
    // No orphaned keys (drift guard): every curated key maps to a real regimen.
    for (const key of curatedKeys) {
      expect(expectedKeys.has(key), `orphaned key with no matching regimen: ${key}`).toBe(true)
    }
    expect(curatedKeys.size).toBe(expectedKeys.size)
  })

  it("replaces every placeholder value with clinically meaningful content", () => {
    for (const [key, value] of Object.entries(SIG_DEFAULTS)) {
      expect(value.sig.length, `${key} sig empty`).toBeGreaterThan(0)
      // quantity must not be the bare meaningless "1" placeholder.
      expect(value.quantity, `${key} quantity placeholder`).not.toBe("1")
      expect(value.quantity.length, `${key} quantity empty`).toBeGreaterThan(0)
      // duration must not be the blank "" placeholder.
      expect(value.duration, `${key} duration placeholder`).not.toBe("")
    }
  })

  it("exposes a deterministic 64-char sha256 hash", () => {
    expect(SIG_DEFAULTS_HASH).toMatch(/^[0-9a-f]{64}$/)
    expect(computeSigDefaultsHash()).toBe(SIG_DEFAULTS_HASH)
    expect(computeSigDefaultsHash()).toBe(computeSigDefaultsHash())
  })

  it("hash changes when a curated default changes", () => {
    const base = computeSigDefaultsHash(SIG_DEFAULTS)
    const modified = { ...SIG_DEFAULTS }
    const key = sigDefaultKey("uti", "Nitrofurantoin 100 mg")
    modified[key] = { ...modified[key], duration: "7 days" }
    expect(computeSigDefaultsHash(modified)).not.toBe(base)
  })
})
