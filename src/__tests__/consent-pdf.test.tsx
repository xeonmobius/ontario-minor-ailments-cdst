import { describe, it, expect, vi, afterEach } from "vitest"
import type { ReactNode } from "react"
import { render, cleanup } from "@testing-library/react"

vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Page: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Image: ({ src }: { src?: string }) => <span data-testid="pdf-image" data-src={src} />,
  StyleSheet: { create: <T,>(s: T): T => s },
}))

import { CombinedPdf } from "@/components/combined-pdf"
import { ReferralPdf } from "@/components/wizard/referral-pdf"
import type { Ailment, PatientInfo, SelectedRx } from "@/types"

const ailment: Ailment = {
  id: "18",
  name: "Uncomplicated UTI",
  slug: "uti",
  symptoms: ["Dysuria"],
  redFlags: ["Fever"],
  rxOptions: [{ drug: "Nitrofurantoin", dose: "100 mg", notes: "" }],
  nonRx: [],
  followUp: "Return if no improvement in 48h",
}

const patient: PatientInfo = {
  name: "Jane Doe",
  dob: "1990-01-01",
  sex: "Female",
  address: "",
  city: "",
  postalCode: "",
  phone: "",
  doctorName: "",
  doctorPhone: "",
  doctorFax: "",
  doctorAddress: "",
  encounterType: "In-Person",
}

const selectedRx: SelectedRx = {
  drug: "Nitrofurantoin",
  dose: "100 mg",
  notes: "",
  sig: "Take 1 cap BID",
  quantity: "10",
  refills: "0",
  duration: "5 days",
}

describe("CombinedPdf consent block", () => {
  afterEach(cleanup)

  it("renders the patient/SDM signature image + attestation when consent is supplied", () => {
    const { container } = render(
      <CombinedPdf
        ailment={ailment}
        patient={patient}
        selectedRx={selectedRx}
        assessmentNotes=""
        dateOfAssessment="2026-06-23"
        pharmacy={null}
        symptomsChecked={[]}
        nonRxChecked={[]}
        txId="tx-1"
        consentSignatureDataUrl="data:image/png;base64,iVBOR=="
        consentSignerName="Jane Doe"
        consentSignerRelationship="self"
        consentCaptureMethod="signature"
        consentStatementVersion="minor-ailments-v1"
        consentCapturedAt="2026-06-23T12:00:00.000Z"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Patient / SDM Signature")
    expect(text).toContain("consent captured in-person")
    expect(text).toContain("minor-ailments-v1")
    expect(text).toContain("Signer: Jane Doe")
    expect(container.querySelectorAll('[data-testid="pdf-image"]').length).toBeGreaterThan(0)
  })

  it("falls back to a blank signature line and omits the attestation when no consent", () => {
    const { container } = render(
      <CombinedPdf
        ailment={ailment}
        patient={patient}
        selectedRx={selectedRx}
        assessmentNotes=""
        dateOfAssessment="2026-06-23"
        pharmacy={null}
        symptomsChecked={[]}
        nonRxChecked={[]}
        txId="tx-1"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Patient / SDM Signature")
    expect(text).not.toContain("consent captured")
    expect(container.querySelectorAll('[data-testid="pdf-image"]').length).toBe(0)
  })
})

describe("ReferralPdf consent block", () => {
  afterEach(cleanup)

  it("renders verbal attestation on the referral footer", () => {
    const { container } = render(
      <ReferralPdf
        ailment={ailment}
        patient={patient}
        redFlagsChecked={["Fever"]}
        dateOfAssessment="2026-06-23"
        pharmacy={null}
        consentSignatureDataUrl={null}
        consentSignerName="John Doe"
        consentSignerRelationship="parent"
        consentCaptureMethod="verbal_attested"
        consentStatementVersion="minor-ailments-v1"
        consentCapturedAt="2026-06-23T12:00:00.000Z"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("consent captured verbally")
    expect(text).toContain("(parent)")
    expect(text).toContain("minor-ailments-v1")
  })
})
