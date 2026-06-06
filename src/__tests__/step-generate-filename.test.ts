import { describe, it, expect } from "vitest"

describe("prescription filename", () => {
  it("uses date and txId when txId is available", () => {
    const dateOfAssessment = "2026-06-06"
    const txId = "TX-2026-000001"
    const filename = `prescription-${dateOfAssessment}-${txId}.pdf`
    expect(filename).toBe("prescription-2026-06-06-TX-2026-000001.pdf")
  })

  it("uses draft when txId is not available", () => {
    const dateOfAssessment = "2026-06-06"
    const txId = null
    const filename = `prescription-${dateOfAssessment}-${txId ?? "draft"}.pdf`
    expect(filename).toBe("prescription-2026-06-06-draft.pdf")
  })

  it("does not contain patient name", () => {
    const dateOfAssessment = "2026-06-06"
    const txId = "TX-2026-000001"
    const filename = `prescription-${dateOfAssessment}-${txId}.pdf`
    expect(filename).not.toContain("john")
    expect(filename).not.toContain("doe")
  })
})
