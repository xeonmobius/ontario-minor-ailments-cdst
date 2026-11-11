import type { ReactElement } from "react"
import type { DocumentProps } from "@react-pdf/renderer"

// @react-pdf/renderer is ~1.2 MB of client JS. Importing it statically (as
// this module once did) dragged it into every page that renders a download
// button — a multi-second parse before first paint on the assess wizard.
// It is loaded on demand, at the moment a user actually downloads a PDF.
export async function downloadPdf(document: ReactElement<DocumentProps>, filename: string) {
  const { pdf } = await import("@react-pdf/renderer")
  const blob = await pdf(document).toBlob()
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement("a")
  a.href = url
  a.download = filename
  window.document.body.appendChild(a)
  a.click()
  window.document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
