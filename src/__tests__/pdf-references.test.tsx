import { describe, it, expect, vi, afterEach } from "vitest"
import type { ReactNode } from "react"
import { render, cleanup } from "@testing-library/react"
import { CITATIONS_HASH, CITATIONS_VERSION } from "@/lib/clinical/citations"

vi.mock("@react-pdf/renderer", () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: <T,>(s: T): T => s },
}))

import { ReferencesSection } from "../components/wizard/pdf-references"

describe("ReferencesSection", () => {
  afterEach(cleanup)

  it("returns null for an unknown slug", () => {
    const { container } = render(<ReferencesSection slug="not-real" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders a numbered bibliography pinned with version + hash8", () => {
    const { container } = render(<ReferencesSection slug="uti" />)
    const text = container.textContent ?? ""
    const hash8 = CITATIONS_HASH.slice(0, 8)
    expect(text).toContain(`References (${CITATIONS_VERSION} · ${hash8})`)
    expect(text).toContain("AMMI Canada")
    expect(text).toContain("256/24")
    expect(text).toContain("[guideline]")
    expect(text).toContain("[regulatory]")
  })

  it("prints the hash8 prefix of CITATIONS_HASH", () => {
    const { container } = render(<ReferencesSection slug="uti" />)
    const text = container.textContent ?? ""
    expect(text).toContain(CITATIONS_HASH.slice(0, 8))
    // And it does NOT leak the full hash (only the 8-char prefix is printed).
    expect(text).not.toContain(CITATIONS_HASH.slice(0, 12))
  })

  it("prints a DOI where present and a URL where no DOI exists", () => {
    const { container } = render(
      <ReferencesSection slug="nvp" />,
    )
    const text = container.textContent ?? ""
    // The ginger citation carries a DOI; the regulatory citation carries a URL.
    expect(text).toContain("doi:10.1111/nure.12060")
    expect(text).toContain("ontario.ca/laws/regulation/240256")
  })

  it("carries no patient context (PHI-leak guarantee)", () => {
    const { container } = render(<ReferencesSection slug="uti" />)
    expect(container.textContent ?? "").not.toMatch(/patient\./i)
  })
})
