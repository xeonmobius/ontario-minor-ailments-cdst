import { describe, it, expect } from "vitest"
import { parseAilments, parseAilmentFile } from "../lib/parse-ailments"
import path from "path"

const CARDS_DIR = path.resolve(__dirname, "../../../Ontario-Minor-Ailments-Cards")

describe("parseAilments", () => {
  it("parses all 19 ailment cards", () => {
    const ailments = parseAilments(CARDS_DIR)
    expect(ailments).toHaveLength(19)
  })

  it("parses acne card (01-acne.md) with all fields", () => {
    const ailments = parseAilments(CARDS_DIR)
    const acne = ailments.find(a => a.slug === "acne")
    expect(acne).toBeDefined()
    expect(acne!.id).toBe("01")
    expect(acne!.name).toBe("Acne (Mild)")
    expect(acne!.symptoms).toContain("Comedones (blackheads/whiteheads)")
    expect(acne!.symptoms).toContain("Few papules and pustules")
    expect(acne!.symptoms.length).toBeGreaterThanOrEqual(3)
    expect(acne!.redFlags.length).toBeGreaterThanOrEqual(5)
    expect(acne!.rxOptions.length).toBeGreaterThanOrEqual(5)
    expect(acne!.nonRx.length).toBeGreaterThanOrEqual(3)
    expect(acne!.followUp.length).toBeGreaterThan(0)
  })

  it("strips bold markers from drug names in Rx table", () => {
    const ailments = parseAilments(CARDS_DIR)
    for (const ailment of ailments) {
      for (const rx of ailment.rxOptions) {
        expect(rx.drug).not.toContain("**")
        expect(rx.drug.length).toBeGreaterThan(0)
        expect(rx.dose.length).toBeGreaterThan(0)
      }
    }
  })

  it("generates slug from filename correctly", () => {
    const ailments = parseAilments(CARDS_DIR)
    const slugs = ailments.map(a => a.slug)
    expect(slugs).toContain("acne")
    expect(slugs).toContain("allergic-rhinitis")
    expect(slugs).toContain("tick-bites-lyme")
    expect(slugs).toContain("nausea-vomiting")
    expect(slugs).toContain("musculoskeletal")
  })

  it("generates id from filename number prefix", () => {
    const ailments = parseAilments(CARDS_DIR)
    const acne = ailments.find(a => a.slug === "acne")
    expect(acne!.id).toBe("01")
    const vvc = ailments.find(a => a.slug === "vvc")
    expect(vvc!.id).toBe("19")
  })

  it("parses dermatitis with sub-conditions into flat arrays", () => {
    const ailments = parseAilments(CARDS_DIR)
    const derm = ailments.find(a => a.slug === "dermatitis")
    expect(derm).toBeDefined()
    expect(derm!.name).toBe("Dermatitis (Atopic, Contact, Diaper)")
    expect(derm!.symptoms.length).toBeGreaterThanOrEqual(5)
    expect(derm!.redFlags.length).toBeGreaterThanOrEqual(8)
    expect(derm!.rxOptions.length).toBeGreaterThanOrEqual(8)
    expect(derm!.nonRx.length).toBeGreaterThanOrEqual(4)
    expect(derm!.followUp.length).toBeGreaterThan(0)
  })

  it("every ailment has required non-empty fields", () => {
    const ailments = parseAilments(CARDS_DIR)
    for (const a of ailments) {
      expect(a.id, `${a.name}: id`).toBeTruthy()
      expect(a.name, `${a.name}: name`).toBeTruthy()
      expect(a.slug, `${a.name}: slug`).toBeTruthy()
      expect(a.symptoms.length, `${a.name}: symptoms`).toBeGreaterThan(0)
      expect(a.redFlags.length, `${a.name}: redFlags`).toBeGreaterThan(0)
      expect(a.rxOptions.length, `${a.name}: rxOptions`).toBeGreaterThan(0)
      expect(a.nonRx.length, `${a.name}: nonRx`).toBeGreaterThan(0)
      expect(a.followUp.length, `${a.name}: followUp`).toBeGreaterThan(0)
    }
  })

  it("ailments are sorted by id", () => {
    const ailments = parseAilments(CARDS_DIR)
    const ids = ailments.map(a => a.id)
    const sorted = [...ids].sort()
    expect(ids).toEqual(sorted)
  })
})

describe("parseAilmentFile (unit)", () => {
  it("parses a simple card from raw content", () => {
    const md = `# Test Ailment

> Ontario Minor Ailment | O. Reg. 256/24

## Symptoms
- Symptom one
- Symptom two

## 🚩 RED FLAGS → REFER
- Red flag one
- Red flag two

## 💊 Rx Options

| Drug | Dose | Notes |
|------|------|-------|
| **DrugA 100mg** | Take daily | First-line |
| **DrugB 50mg** | Take BID | Second-line |

## 🩹 Non-Rx
- Non-rx one
- Non-rx two

## ⏱ Follow-up
- Reassess in 1 week
`

    const result = parseAilmentFile(md, "99-test-ailment", "99", "test-ailment")
    expect(result.name).toBe("Test Ailment")
    expect(result.id).toBe("99")
    expect(result.slug).toBe("test-ailment")
    expect(result.symptoms).toEqual(["Symptom one", "Symptom two"])
    expect(result.redFlags).toEqual(["Red flag one", "Red flag two"])
    expect(result.rxOptions).toEqual([
      { drug: "DrugA 100mg", dose: "Take daily", notes: "First-line" },
      { drug: "DrugB 50mg", dose: "Take BID", notes: "Second-line" },
    ])
    expect(result.nonRx).toEqual(["Non-rx one", "Non-rx two"])
    expect(result.followUp).toBe("Reassess in 1 week")
  })

  it("combines sub-conditions for dermatitis-like structure", () => {
    const md = `# Dermatitis (Multi)

> Ontario Minor Ailment | O. Reg. 256/24

---

## Sub One

### Symptoms
- Symptom A1
- Symptom A2

### 🚩 RED FLAGS → REFER
- Flag A1

### 💊 Rx Options

| Drug | Dose | Notes |
|------|------|-------|
| **DrugA** | Apply BID | Notes A |

---

## Sub Two

### Symptoms
- Symptom B1

### 🚩 RED FLAGS → REFER
- Flag B1
- Flag B2

### 💊 Rx Options

| Drug | Dose | Notes |
|------|------|-------|
| **DrugB** | Apply QID | Notes B |

---

## 🩹 Non-Rx (All)
- NonRx item

## ⏱ Follow-up
- Reassess in 3 days
`

    const result = parseAilmentFile(md, "06-dermatitis", "06", "dermatitis")
    expect(result.symptoms).toEqual(["Symptom A1", "Symptom A2", "Symptom B1"])
    expect(result.redFlags).toEqual(["Flag A1", "Flag B1", "Flag B2"])
    expect(result.rxOptions).toEqual([
      { drug: "DrugA", dose: "Apply BID", notes: "Notes A" },
      { drug: "DrugB", dose: "Apply QID", notes: "Notes B" },
    ])
  })

  it("strips bold markers from table cells", () => {
    const md = `# Test

> Ontario Minor Ailment | O. Reg. 256/24

## Symptoms
- S1

## 🚩 RED FLAGS → REFER
- F1

## 💊 Rx Options

| Drug | Dose | Notes |
|------|------|-------|
| **Bold Drug** | **Bold Dose** | **Bold Note** |

## 🩹 Non-Rx
- NR1

## ⏱ Follow-up
- FU
`
    const result = parseAilmentFile(md, "01-test", "01", "test")
    expect(result.rxOptions[0]).toEqual({
      drug: "Bold Drug",
      dose: "Bold Dose",
      notes: "Bold Note",
    })
  })
})
