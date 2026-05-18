import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { AilmentGrid } from "../components/ailment-grid"

vi.mock("../lib/ailments", () => ({
  ailments: [
    {
      id: "01",
      name: "Acne (Mild)",
      slug: "acne",
      symptoms: ["Comedones", "Papules", "Pustules", "Oily skin"],
      redFlags: ["Nodules"],
      rxOptions: [],
      nonRx: [],
      followUp: "",
    },
    {
      id: "02",
      name: "Allergic Rhinitis",
      slug: "allergic-rhinitis",
      symptoms: ["Sneezing", "Runny nose", "Itchy eyes"],
      redFlags: [],
      rxOptions: [],
      nonRx: [],
      followUp: "",
    },
    {
      id: "03",
      name: "Conjunctivitis",
      slug: "conjunctivitis",
      symptoms: ["Red eye", "Discharge"],
      redFlags: [],
      rxOptions: [],
      nonRx: [],
      followUp: "",
    },
  ],
}))

describe("AilmentGrid", () => {
  afterEach(cleanup)

  it("renders an ailment card for each ailment", () => {
    render(<AilmentGrid />)
    expect(screen.getByText("Acne (Mild)")).toBeInTheDocument()
    expect(screen.getByText("Allergic Rhinitis")).toBeInTheDocument()
    expect(screen.getByText("Conjunctivitis")).toBeInTheDocument()
  })

  it("each card links to correct /assess/[slug] path", () => {
    render(<AilmentGrid />)
    expect(screen.getByRole("link", { name: /acne.*mild/i })).toHaveAttribute("href", "/assess/acne")
    expect(screen.getByRole("link", { name: /allergic rhinitis/i })).toHaveAttribute("href", "/assess/allergic-rhinitis")
    expect(screen.getByRole("link", { name: /conjunctivitis/i })).toHaveAttribute("href", "/assess/conjunctivitis")
  })

  it("shows first 3 symptoms as description", () => {
    render(<AilmentGrid />)
    expect(screen.getByText("Comedones, Papules, Pustules")).toBeInTheDocument()
  })
})
