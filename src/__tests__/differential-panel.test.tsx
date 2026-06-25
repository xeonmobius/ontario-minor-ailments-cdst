import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react"
import { DifferentialPanel } from "../components/wizard/differential-panel"

describe("DifferentialPanel", () => {
  afterEach(cleanup)

  it("returns null for an unknown slug", () => {
    const { container } = render(<DifferentialPanel slug="not-a-real-ailment" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("is collapsed by default and shows the header", () => {
    render(<DifferentialPanel slug="impetigo" />)
    expect(screen.getByText(/differentials to consider/i)).toBeInTheDocument()
    expect(screen.queryByText("Herpes simplex (cold sore/fever blister)")).not.toBeInTheDocument()
    expect(screen.queryByText(/refer if suspected/i)).not.toBeInTheDocument()
  })

  it("expands to show differentials and the refer tag on header click", () => {
    render(<DifferentialPanel slug="impetigo" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText("Herpes simplex (cold sore/fever blister)")).toBeInTheDocument()
    expect(screen.getAllByText(/refer if suspected/i).length).toBeGreaterThan(0)
  })

  it("hides the clinical-images row for non-dermatological ailments", () => {
    render(<DifferentialPanel slug="dysmenorrhea" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText(/endometriosis/i)).toBeInTheDocument()
    expect(screen.queryByText(/clinical images/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("shows clinical-image links for dermatological ailments", () => {
    render(<DifferentialPanel slug="impetigo" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText(/clinical images/i)).toBeInTheDocument()
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0)
  })

  it("external links carry the PHI-safe rel and target attributes", () => {
    render(<DifferentialPanel slug="impetigo" />)
    fireEvent.click(screen.getByRole("button"))
    const links = screen.getAllByRole("link")
    for (const link of links) {
      expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow")
      expect(link).toHaveAttribute("target", "_blank")
      const href = link.getAttribute("href") ?? ""
      expect(href).toMatch(/^https:\/\/dermnetnz\.org\/topics\//)
      expect(href).not.toMatch(/\$\{|\?/) // no patient-context interpolation or query string
    }
  })

  it("shows the referral hint in the header when a refer disposition exists", () => {
    render(<DifferentialPanel slug="impetigo" />)
    const header = screen.getByRole("button")
    expect(within(header).getByText(/some require referral/i)).toBeInTheDocument()
  })
})
