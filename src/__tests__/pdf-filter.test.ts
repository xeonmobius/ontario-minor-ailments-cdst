import { describe, it, expect } from "vitest"
import { filterCheckedItems } from "@/lib/pdf-filter"

describe("filterCheckedItems", () => {
  it("returns only checked items from the full list", () => {
    const all = ["Fever", "Cough", "Headache", "Nausea"]
    const checked = ["Fever", "Headache"]
    expect(filterCheckedItems(all, checked)).toEqual(["Fever", "Headache"])
  })

  it("returns empty array when nothing checked", () => {
    const all = ["Fever", "Cough"]
    const checked: string[] = []
    expect(filterCheckedItems(all, checked)).toEqual([])
  })

  it("preserves order of the full list, not checked order", () => {
    const all = ["A", "B", "C", "D"]
    const checked = ["D", "B"]
    expect(filterCheckedItems(all, checked)).toEqual(["B", "D"])
  })

  it("ignores checked items not in full list", () => {
    const all = ["A", "B"]
    const checked = ["A", "Z"]
    expect(filterCheckedItems(all, checked)).toEqual(["A"])
  })
})
