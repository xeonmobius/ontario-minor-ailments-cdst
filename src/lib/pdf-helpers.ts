import { pdf } from "@react-pdf/renderer"
import type { ReactElement } from "react"
import type { DocumentProps } from "@react-pdf/renderer"

export async function downloadPdf(document: ReactElement<DocumentProps>, filename: string) {
  const blob = await pdf(document).toBlob()
  console.log("PDF blob generated:", blob.size, "bytes, type:", blob.type)
  const url = URL.createObjectURL(blob)
  const a = window.document.createElement("a")
  a.href = url
  a.download = filename
  window.document.body.appendChild(a)
  a.click()
  window.document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
