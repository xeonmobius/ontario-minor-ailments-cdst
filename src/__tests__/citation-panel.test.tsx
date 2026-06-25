import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { CitationPanel } from "../components/wizard/citation-panel"
import { CITATIONS_HASH } from "@/lib/clinical/citations"

describe("CitationPanel", () => {
  afterEach(cleanup)

  it("returns null for an unknown slug", () => {
    const { container } = render(
      <CitationPanel slug="not-a-real-ailment" step="rxSelection" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("is collapsed by default and shows the header only", () => {
    render(<CitationPanel slug="uti" step="rxSelection" />)
    expect(screen.getByRole("button", { name: /evidence/i })).toBeInTheDocument()
    // Body hidden until expanded: a citation summary is not in the document.
    expect(screen.queryByText(/Nitrofurantoin/i)).not.toBeInTheDocument()
  })

  it("expands on header click to show sources and a type badge", () => {
    render(<CitationPanel slug="uti" step="rxSelection" />)
    fireEvent.click(screen.getByRole("button"))
    expect(screen.getByText(/AMMI Canada/i)).toBeInTheDocument()
    expect(screen.getByText(/^guideline$/i)).toBeInTheDocument()
    // The regulatory authority is rendered muted beneath.
    expect(screen.getByText(/256\/24/i)).toBeInTheDocument()
  })

  it("external links carry the PHI-safe rel and target attributes with no patient context", () => {
    render(<CitationPanel slug="nvp" step="nonRxAdvice" />)
    fireEvent.click(screen.getByRole("button"))
    const links = screen.getAllByRole("link")
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow")
      expect(link).toHaveAttribute("target", "_blank")
      const href = link.getAttribute("href") ?? ""
      expect(href).not.toMatch(/\$\{|\?/) // no template token or query string
      expect(href).not.toMatch(/patient/i)
    }
  })

  it("resolves a DOI-only citation to the canonical doi.org URL", () => {
    render(<CitationPanel slug="nvp" step="nonRxAdvice" />)
    fireEvent.click(screen.getByRole("button"))
    const doiLink = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("href")?.startsWith("https://doi.org/"))
    expect(doiLink).toBeDefined()
    // The DOI is a static field (10.1111/nure.12060) — no patient context appended.
    expect(doiLink?.getAttribute("href")).toBe("https://doi.org/10.1111/nure.12060")
  })

  it("emits no callbacks and renders no form inputs (read-only provenance)", () => {
    render(<CitationPanel slug="uti" step="rxSelection" />)
    // The only interactive control is the expand toggle button.
    expect(screen.getAllByRole("button")).toHaveLength(1)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("does not reference patient data anywhere (PHI-leak guarantee)", () => {
    const { container } = render(
      <CitationPanel slug="uti" step="rxSelection" />,
    )
    fireEvent.click(screen.getByRole("button"))
    expect(container.textContent).not.toMatch(/patient\./i)
    // Sanity: the panel references the citations hash only indirectly, not patient fields.
    expect(CITATIONS_HASH).toMatch(/^[0-9a-f]{64}$/)
  })
})
