import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { StepRx } from "../components/wizard/step-rx"
import { Ailment, SelectedRx } from "@/types"

const mockAilment: Ailment = {
  id: "01",
  name: "Acne (Mild)",
  slug: "acne",
  symptoms: ["Comedones"],
  redFlags: [],
  rxOptions: [
    { drug: "Benzoyl peroxide 5%", dose: "Apply BID", notes: "First-line" },
    { drug: "Adapalene 0.1%", dose: "Apply QHS", notes: "Least irritating retinoid" },
  ],
  nonRx: ["Gentle cleanser", "Moisturizer"],
  followUp: "2-4 weeks",
}

describe("StepRx", () => {
  afterEach(cleanup)

  it("renders all Rx options as clickable cards", () => {
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={null}
        onSelect={vi.fn()}
        onSelectedRxChange={vi.fn()}
      />
    )

    expect(screen.getByText(/benzoyl peroxide/i)).toBeInTheDocument()
    expect(screen.getByText(/adapalene/i)).toBeInTheDocument()
  })

  it("shows detail fields when an Rx is selected", () => {
    const selectedRx: SelectedRx = {
      drug: "Benzoyl peroxide 5%",
      dose: "Apply BID",
      notes: "First-line",
      sig: "Apply twice daily to affected areas",
      quantity: "1",
      refills: "2",
      duration: "3 months",
    }

    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={selectedRx}
        onSelect={vi.fn()}
        onSelectedRxChange={vi.fn()}
      />
    )

    expect(screen.getByLabelText(/directions/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/refills/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument()
  })

  it("shows non-Rx advice", () => {
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={null}
        onSelect={vi.fn()}
        onSelectedRxChange={vi.fn()}
      />
    )

    expect(screen.getByText("Gentle cleanser")).toBeInTheDocument()
    expect(screen.getByText("Moisturizer")).toBeInTheDocument()
  })

  it("shows follow-up text", () => {
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={null}
        onSelect={vi.fn()}
        onSelectedRxChange={vi.fn()}
      />
    )

    expect(screen.getByText(/2-4 weeks/i)).toBeInTheDocument()
  })

  it("calls onSelect when an Rx card is clicked", () => {
    const onSelect = vi.fn()
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={null}
        onSelect={onSelect}
        onSelectedRxChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText(/benzoyl peroxide/i))
    expect(onSelect).toHaveBeenCalled()
  })
})
