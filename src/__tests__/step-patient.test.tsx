import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { StepPatient } from "../components/wizard/step-patient"
import { PatientInfo } from "@/types"

const basePatient: PatientInfo = {
  name: "",
  dob: "",
  sex: "",
  address: "",
  city: "",
  postalCode: "",
  phone: "",
  doctorName: "",
  doctorPhone: "",
  doctorFax: "",
  doctorAddress: "",
  encounterType: "",
}

describe("StepPatient", () => {
  afterEach(cleanup)

  it("renders all retained form fields", () => {
    const onChange = vi.fn()
    render(<StepPatient patient={basePatient} onChange={onChange} />)

    expect(screen.getByLabelText(/patient name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/date of birth/i)).toBeInTheDocument()
    expect(screen.getAllByLabelText(/^phone$/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByLabelText(/^address$/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText(/city/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/postal code/i)).toBeInTheDocument()
  })

  it("does not render PMS-owned fields (allergies, meds, OHIP, license, pregnancy)", () => {
    const onChange = vi.fn()
    render(<StepPatient patient={basePatient} onChange={onChange} />)

    expect(screen.queryByLabelText(/ohip/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/allergies/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/current medications/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/license/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/pregnant/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/breastfeeding/i)).not.toBeInTheDocument()
  })

  it("still renders the Sex selector", () => {
    const onChange = vi.fn()
    render(<StepPatient patient={basePatient} onChange={onChange} />)

    expect(screen.getAllByLabelText(/^male$/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByLabelText(/^female$/i).length).toBeGreaterThanOrEqual(1)
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
