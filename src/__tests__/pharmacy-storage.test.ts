import { describe, it, expect, beforeEach } from "vitest"
import { getPharmacyDefaults, savePharmacyDefaults } from "../lib/pharmacy-storage"
import { PharmacyDefaults } from "@/types"

const KEY = "cdst-pharmacy-defaults"

const mockDefaults: PharmacyDefaults = {
  pharmacyName: "Shoppers Drug Mart",
  address: "123 Main St",
  city: "Toronto",
  province: "Ontario",
  postalCode: "M5A 1A1",
  phone: "416-555-0100",
  fax: "416-555-0101",
  pharmacistName: "Jane Smith",
  ocpLicense: "12345",
  registrationNumber: "A-1234",
}

describe("pharmacy-storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("savePharmacyDefaults stores to localStorage", () => {
    savePharmacyDefaults(mockDefaults)
    const raw = localStorage.getItem(KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual(mockDefaults)
  })

  it("getPharmacyDefaults retrieves from localStorage", () => {
    localStorage.setItem(KEY, JSON.stringify(mockDefaults))
    const result = getPharmacyDefaults()
    expect(result).toEqual(mockDefaults)
  })

  it("getPharmacyDefaults returns null when empty", () => {
    const result = getPharmacyDefaults()
    expect(result).toBeNull()
  })

  it("getPharmacyDefaults returns null on server (no window)", () => {
    const originalWindow = globalThis.window
    // @ts-expect-error simulating SSR
    delete globalThis.window
    const result = getPharmacyDefaults()
    expect(result).toBeNull()
    globalThis.window = originalWindow
  })
})
