import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { NonPrescribePanel } from "../components/wizard/non-prescribe-panel"
import { Ailment } from "@/types"

const mockAilment: Ailment = {
  id: "01",
  name: "Acne (Mild)",
  slug: "acne",
  symptoms: ["Comedones"],
  redFlags: [],
  rxOptions: [],
  nonRx: ["Gentle cleanser", "Moisturizer"],
  followUp: "2-4 weeks",
}

describe("NonPrescribePanel", () => {
  afterEach(cleanup)

  it("renders all reason options", () => {
    render(
      <NonPrescribePanel
        ailment={mockAilment}
        value={null}
        onReasonChange={vi.fn()}
        rationale=""
        onRationaleChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/patient declined prescription/i)).toBeInTheDocument()
    expect(screen.getByText(/otc \/ self-care sufficient/i)).toBeInTheDocument()
    expect(screen.getByText(/other \(rationale required\)/i)).toBeInTheDocument()
  })

  it("calls onReasonChange when a reason card is clicked", () => {
    const onReasonChange = vi.fn()
    render(
      <NonPrescribePanel
        ailment={mockAilment}
        value={null}
        onReasonChange={onReasonChange}
        rationale=""
        onRationaleChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/patient declined prescription/i))
    expect(onReasonChange).toHaveBeenCalledWith("patient_declined")
  })

  it("surfaces a referral note when referred_to_physician is selected", () => {
    render(
      <NonPrescribePanel
        ailment={mockAilment}
        value="referred_to_physician"
        onReasonChange={vi.fn()}
        rationale=""
        onRationaleChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/referral document for the patient/i)).toBeInTheDocument()
  })

  it("marks the rationale as required when other is selected", () => {
    render(
      <NonPrescribePanel
        ailment={mockAilment}
        value="other"
        onReasonChange={vi.fn()}
        rationale=""
        onRationaleChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/clinical rationale \*/i)).toBeInTheDocument()
  })

  it("toggles non-Rx advice items", () => {
    const onNonRxChange = vi.fn()
    render(
      <NonPrescribePanel
        ailment={mockAilment}
        value={null}
        onReasonChange={vi.fn()}
        rationale=""
        onRationaleChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={onNonRxChange}
      />,
    )

    fireEvent.click(screen.getByText("Gentle cleanser"))
    expect(onNonRxChange).toHaveBeenCalledWith(["Gentle cleanser"])
  })

  it("omits the non-Rx list when showNonRxAdvice is false", () => {
    render(
      <NonPrescribePanel
        ailment={mockAilment}
        value={null}
        onReasonChange={vi.fn()}
        rationale=""
        onRationaleChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
        showNonRxAdvice={false}
      />,
    )

    expect(screen.queryByText("Gentle cleanser")).not.toBeInTheDocument()
  })
})
