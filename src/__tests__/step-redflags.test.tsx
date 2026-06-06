import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { StepPatient } from "../components/wizard/step-patient"
import { PatientInfo } from "@/types"

const basePatient: PatientInfo = {
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
  doctorName: "", doctorLicense: "", doctorPhone: "", doctorFax: "", doctorAddress: "",
}

describe("StepPatient", () => {
  afterEach(cleanup)

  it("renders all form fields", () => {
    const onChange = vi.fn()
    render(<StepPatient patient={basePatient} onChange={onChange} />)

    expect(screen.getByLabelText(/patient name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ohip/i)).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^phone$/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByLabelText(/^address$/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText(/city/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/postal code/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/allergies/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/current medications/i)).toBeInTheDocument()
  })

  it("shows NKDA as default allergies", () => {
    const onChange = vi.fn()
    render(<StepPatient patient={basePatient} onChange={onChange} />)
    expect(screen.getByLabelText(/allergies/i)).toHaveValue("NKDA")
  })

  it("calls onChange when name is typed", () => {
    const onChange = vi.fn()
    render(<StepPatient patient={basePatient} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/patient name/i), { target: { value: "Jane Doe" } })
    expect(onChange).toHaveBeenCalledWith({ ...basePatient, name: "Jane Doe" })
  })

  it("calls onChange when dob is set", () => {
    const onChange = vi.fn()
    render(<StepPatient patient={basePatient} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: "1990-01-01" } })
    expect(onChange).toHaveBeenCalledWith({ ...basePatient, dob: "1990-01-01" })
  })
})
