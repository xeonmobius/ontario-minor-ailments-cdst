import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { StepRx } from "../components/wizard/step-rx"
import { Ailment, RecalledSig, SelectedRx } from "@/types"

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
  nonRx: ["Gentle cleanser"],
  followUp: "2-4 weeks",
}

const acneSelected: SelectedRx = {
  drug: "Benzoyl peroxide 5%",
  dose: "Apply BID",
  notes: "First-line",
  sig: "Apply twice daily",
  quantity: "60 g",
  refills: "2",
  duration: "8–12 weeks",
}

const recalledSame: RecalledSig = {
  drug: "Benzoyl peroxide 5%",
  sig: "Apply twice daily",
  quantity: "60 g",
  refills: "2",
  duration: "8–12 weeks",
  prescribedAt: "2026-01-15T12:00:00.000Z",
}

const recalledDifferent: RecalledSig = {
  drug: "Adapalene 0.1%",
  sig: "Apply at bedtime",
  quantity: "30 g",
  refills: "2",
  duration: "8–12 weeks",
  prescribedAt: "2026-01-15T12:00:00.000Z",
}

describe("StepRx recall hint", () => {
  afterEach(cleanup)

  it("renders no hint when recalled is null (Phase 1 / first visit)", () => {
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={acneSelected}
        recalled={null}
        onSelect={vi.fn()}
        onSelectedRxChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )
    expect(screen.queryByTestId("recall-hint-same")).not.toBeInTheDocument()
    expect(screen.queryByTestId("recall-hint-different")).not.toBeInTheDocument()
  })

  it("shows the same-drug pre-fill hint when the recalled drug matches the selection", () => {
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={acneSelected}
        recalled={recalledSame}
        onSelect={vi.fn()}
        onSelectedRxChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )
    const hint = screen.getByTestId("recall-hint-same")
    expect(hint.textContent).toMatch(/Last used for this patient/)
    expect(screen.queryByTestId("recall-hint-different")).not.toBeInTheDocument()
  })

  it("shows a different-drug hint with a Switch affordance that re-selects the recalled regimen", () => {
    const onSelect = vi.fn()
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={acneSelected}
        recalled={recalledDifferent}
        onSelect={onSelect}
        onSelectedRxChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )
    const hint = screen.getByTestId("recall-hint-different")
    expect(hint.textContent).toMatch(/Previously prescribed Adapalene 0\.1%/)
    const switchBtn = screen.getByRole("button", { name: /Switch to Adapalene 0\.1%/i })
    fireEvent.click(switchBtn)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ drug: "Adapalene 0.1%" }),
    )
  })

  it("hides the Switch affordance when the recalled regimen is no longer in ailment.rxOptions", () => {
    render(
      <StepRx
        ailment={mockAilment}
        selectedRx={acneSelected}
        recalled={{ ...recalledDifferent, drug: "Discontinued Drug" }}
        onSelect={vi.fn()}
        onSelectedRxChange={vi.fn()}
        nonRxChecked={[]}
        onNonRxChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId("recall-hint-different").textContent).toMatch(/Discontinued Drug/)
    expect(screen.queryByRole("button", { name: /Switch to/i })).not.toBeInTheDocument()
  })
})
