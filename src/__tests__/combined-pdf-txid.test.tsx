import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import type { Ailment, PatientInfo, SelectedRx } from "@/types"

vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: any) => <div data-testid="doc">{children}</div>,
  Page: ({ children }: any) => <div>{children}</div>,
  Text: ({ children }: any) => <span>{children}</span>,
  View: ({ children, style }: any) => <div>{children}</div>,
  StyleSheet: { create: (s: any) => s },
}))

import { CombinedPdf } from "@/components/combined-pdf"

const mockAilment: Ailment = {
  id: "test", name: "Test Ailment", slug: "test",
  symptoms: [], redFlags: [], rxOptions: [],
  nonRx: [], followUp: "1 week",
}

const mockPatient: PatientInfo = {
  name: "John Doe", dob: "1990-01-01", sex: "M",
  ohip: "", address: "", city: "", postalCode: "",
  phone: "", allergies: "None", currentMeds: "",
}

const mockRx: SelectedRx = {
  drug: "Amoxicillin", dose: "500mg", notes: "",
  sig: "Take 1 TID", quantity: "21", refills: "0", duration: "7 days",
}

describe("CombinedPdf txId", () => {
  it("renders tx ID when provided", () => {
    const { container } = render(
      <CombinedPdf
        ailment={mockAilment}
        patient={mockPatient}
        selectedRx={mockRx}
        assessmentNotes=""
        dateOfAssessment="2026-06-06"
        pharmacy={null}
        symptomsChecked={[]}
        nonRxChecked={[]}
        txId="TX-2026-000001"
      />
    )
    expect(container.textContent).toContain("Tx: TX-2026-000001")
  })

  it("does not render tx ID when not provided", () => {
    const { container } = render(
      <CombinedPdf
        ailment={mockAilment}
        patient={mockPatient}
        selectedRx={mockRx}
        assessmentNotes=""
        dateOfAssessment="2026-06-06"
        pharmacy={null}
        symptomsChecked={[]}
        nonRxChecked={[]}
      />
    )
    expect(container.textContent).not.toContain("Tx:")
  })
})
