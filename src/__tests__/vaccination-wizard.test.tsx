import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const saveVaccinationAction = vi.fn()
const saveConsentAction = vi.fn()
const decrementInventory = vi.fn()
const getVaccineInventory = vi.fn()
const downloadPdf = vi.fn()
const push = vi.fn()

vi.mock("@/lib/vaccination-actions", () => ({
  saveVaccinationAction: (...a: unknown[]) => saveVaccinationAction(...a),
}))
vi.mock("@/lib/consent-actions", () => ({
  saveConsentAction: (...a: unknown[]) => saveConsentAction(...a),
}))
vi.mock("@/lib/vaccine-inventory", () => ({
  getVaccineInventory: (...a: unknown[]) => getVaccineInventory(...a),
  decrementInventory: (...a: unknown[]) => decrementInventory(...a),
}))
vi.mock("@/lib/pdf-helpers", () => ({
  downloadPdf: (...a: unknown[]) => downloadPdf(...a),
}))
vi.mock("@/components/vaccination/vaccination-record-pdf", () => ({
  VaccinationRecordPdf: () => <div data-testid="var-pdf" />,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

import { VaccinationWizard } from "@/components/vaccination/vaccination-wizard"
import { getVaccineByVaccineId } from "@/lib/vaccines/catalog"
import type { PharmacyDefaults } from "@/types"

const vaccine = getVaccineByVaccineId("influenza")!
const pharmacy: PharmacyDefaults = {
  pharmacyName: "Rexall",
  address: "1 Main",
  city: "Toronto",
  province: "ON",
  postalCode: "M1M1M1",
  phone: "4165551234",
  fax: "4165551235",
  pharmacistName: "Dr. Pat",
  provincialLicense: "12345",
  registrationNumber: "REG1",
}

function nextButton() {
  return screen.getByText("Next")
}

describe("VaccinationWizard gating", () => {
  beforeEach(() => {
    saveVaccinationAction.mockReset()
    saveConsentAction.mockReset()
    decrementInventory.mockReset()
    getVaccineInventory.mockReset()
    downloadPdf.mockReset()
    push.mockReset()
    getVaccineInventory.mockResolvedValue([])
  })
  afterEach(cleanup)

  it("disables Next at step 0 until name + dob + In-Person encounter are set", () => {
    render(<VaccinationWizard vaccine={vaccine} pharmacy={pharmacy} />)
    expect(nextButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText("Patient Name *"), { target: { value: "Jane Doe" } })
    fireEvent.change(screen.getByLabelText("Date of Birth *"), { target: { value: "1990-01-01" } })
    expect(nextButton()).toBeDisabled()

    // The encounter checkbox matches both the native input and the visual element
    // (iteration 5 learning); take the first match.
    fireEvent.click(screen.getAllByLabelText("In-Person")[0])
    expect(nextButton()).not.toBeDisabled()
  })

  it("shows the In-Person guard and blocks Next for a Virtual encounter", () => {
    render(<VaccinationWizard vaccine={vaccine} pharmacy={pharmacy} />)
    fireEvent.change(screen.getByLabelText("Patient Name *"), { target: { value: "Jane Doe" } })
    fireEvent.change(screen.getByLabelText("Date of Birth *"), { target: { value: "1990-01-01" } })
    fireEvent.click(screen.getAllByLabelText("Virtual")[0])

    expect(
      screen.getByText(/Vaccines can only be administered in person/),
    ).toBeInTheDocument()
    expect(nextButton()).toBeDisabled()
  })

  it("routes step 2 to the WithholdPanel when a withhold contraindication is checked", () => {
    render(<VaccinationWizard vaccine={vaccine} pharmacy={pharmacy} />)

    // Step 0 -> advance
    fireEvent.change(screen.getByLabelText("Patient Name *"), { target: { value: "Jane Doe" } })
    fireEvent.change(screen.getByLabelText("Date of Birth *"), { target: { value: "1990-01-01" } })
    fireEvent.click(screen.getAllByLabelText("In-Person")[0])
    fireEvent.click(nextButton())

    // Step 1 -> check the severe-allergic-reaction (withhold) item, then advance.
    // The label also appends a "Withhold" severity tag, so match partially.
    const withholdLabel = vaccine.contraindications.find(
      (c) => c.id === "severe_allergic_reaction",
    )!.label
    fireEvent.click(screen.getByText(withholdLabel, { exact: false }))
    fireEvent.click(nextButton())

    // Step 2 is the WithholdPanel.
    expect(screen.getByText("Document Withhold / Referral")).toBeInTheDocument()
    expect(screen.getByText("Patient (or SDM) declined the vaccine")).toBeInTheDocument()
  })

  it("shows the administration form (no contraindication) at step 2", () => {
    render(<VaccinationWizard vaccine={vaccine} pharmacy={pharmacy} />)

    fireEvent.change(screen.getByLabelText("Patient Name *"), { target: { value: "Jane Doe" } })
    fireEvent.change(screen.getByLabelText("Date of Birth *"), { target: { value: "1990-01-01" } })
    fireEvent.click(screen.getAllByLabelText("In-Person")[0])
    fireEvent.click(nextButton())

    // Step 1 -> check nothing, advance
    fireEvent.click(nextButton())

    // Step 2 is the administration details.
    expect(screen.getByText("Administration Details")).toBeInTheDocument()
  })
})
