import { pdf } from "@react-pdf/renderer"
import type { ReactElement } from "react"
import type { DocumentProps } from "@react-pdf/renderer"

export async function downloadPdf(document: ReactElement<DocumentProps>, filename: string) {
  const blob = await pdf(document).toBlob()
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
