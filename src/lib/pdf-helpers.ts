import { pdf } from "@react-pdf/renderer"
import { ReactElement } from "react"

export async function downloadPdf(document: ReactElement, filename: string) {
  const blob = await pdf(document).toBlob()
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
