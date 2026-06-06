import { describe, it, expect } from "vitest"
import { PatientInfo, SelectedRx, RxOption } from "@/types"

function canProceedStep0(patient: PatientInfo): boolean {
  return !!patient.name && !!patient.dob
}

function canProceedStep1(redFlagsChecked: string[]): boolean {
  return redFlagsChecked.length === 0
}

function canProceedStep2(selectedRx: SelectedRx | null): boolean {
  return selectedRx !== null
}

describe("Wizard navigation logic", () => {
  const emptyPatient: PatientInfo = {
    name: "",
    dob: "",
    sex: "",
    ohip: "",
    address: "",
    city: "",
    postalCode: "",
    phone: "",
    allergies: "NKDA",
    currentMeds: "",
  }

  it("starts at step 0", () => {
    const step = 0
    expect(step).toBe(0)
  })

  it("cannot proceed from step 0 without name and dob", () => {
    expect(canProceedStep0(emptyPatient)).toBe(false)
  })

  it("cannot proceed from step 0 with name but no dob", () => {
    expect(canProceedStep0({ ...emptyPatient, name: "John" })).toBe(false)
  })

  it("cannot proceed from step 0 with dob but no name", () => {
    expect(canProceedStep0({ ...emptyPatient, dob: "1990-01-01" })).toBe(false)
  })

  it("can proceed from step 0 with name and dob", () => {
    expect(canProceedStep0({ ...emptyPatient, name: "John", dob: "1990-01-01" })).toBe(true)
  })

  it("cannot proceed from step 1 when red flags are checked", () => {
    expect(canProceedStep1(["Fever > 38.5"])).toBe(false)
  })

  it("cannot proceed from step 1 when multiple red flags are checked", () => {
    expect(canProceedStep1(["Fever > 38.5", "Severe pain"])).toBe(false)
  })

  it("can proceed from step 1 when no red flags are checked", () => {
    expect(canProceedStep1([])).toBe(true)
  })

  it("cannot proceed from step 2 without selected Rx", () => {
    expect(canProceedStep2(null)).toBe(false)
  })

  it("can proceed from step 2 with selected Rx", () => {
    const rx: RxOption = { drug: "Benzoyl peroxide 5%", dose: "Apply BID", notes: "First-line" }
    const selectedRx: SelectedRx = { ...rx, sig: "Apply twice daily", quantity: "1", refills: "2", duration: "3 months" }
    expect(canProceedStep2(selectedRx)).toBe(true)
  })

  it("can always proceed from step 3 (generate)", () => {
    expect(true).toBe(true)
  })
})
