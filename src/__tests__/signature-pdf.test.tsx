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

const PHARMACY = {
  pharmacyName: "Rexall",
  address: "1 Main",
  city: "Toronto",
  province: "ON",
  postalCode: "M1M1M1",
  phone: "4165551234",
  fax: "4165551235",
  pharmacistName: "Dr. Pat",
  provincialLicense: "12345",
  registrationNumber: "REG1",
}

describe("CombinedPdf pharmacist signature", () => {
  afterEach(cleanup)

  it("renders the pharmacist stroke image + attestation line when a signature is supplied", () => {
    const { container } = render(
      <CombinedPdf
        ailment={ailment}
        patient={patient}
        selectedRx={selectedRx}
        assessmentNotes=""
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
        symptomsChecked={[]}
        nonRxChecked={[]}
        txId="tx-1"
        pharmacistSignatureDataUrl="data:image/png;base64,iVBOR=="
        pharmacistSignedAt="2026-06-24T12:00:00.000Z"
        pharmacistAttestationVersion="pharmacist-esig-v1"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Electronically signed by Dr. Pat")
    expect(text).toContain("Reg #12345")
    expect(text).toContain("pharmacist-esig-v1")
    // At least one image is rendered (the pharmacist stroke).
    expect(container.querySelectorAll('[data-testid="pdf-image"]').length).toBeGreaterThan(0)
  })

  it("falls back to the blank signature line and omits the attestation when no signature", () => {
    const { container } = render(
      <CombinedPdf
        ailment={ailment}
        patient={patient}
        selectedRx={selectedRx}
        assessmentNotes=""
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
        symptomsChecked={[]}
        nonRxChecked={[]}
        txId="tx-1"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).not.toContain("Electronically signed by")
    expect(container.querySelectorAll('[data-testid="pdf-image"]').length).toBe(0)
  })
})

describe("ReferralPdf pharmacist signature", () => {
  afterEach(cleanup)

  it("renders the pharmacist stroke image + attestation line when a signature is supplied", () => {
    const { container } = render(
      <ReferralPdf
        ailment={ailment}
        patient={patient}
        redFlagsChecked={["Fever"]}
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
        pharmacistSignatureDataUrl="data:image/png;base64,iVBOR=="
        pharmacistSignedAt="2026-06-24T12:00:00.000Z"
        pharmacistAttestationVersion="pharmacist-esig-v1"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Electronically signed by Dr. Pat")
    expect(text).toContain("pharmacist-esig-v1")
    expect(container.querySelectorAll('[data-testid="pdf-image"]').length).toBeGreaterThan(0)
  })

  it("falls back to the blank signature line and omits the attestation when no signature", () => {
    const { container } = render(
      <ReferralPdf
        ailment={ailment}
        patient={patient}
        redFlagsChecked={["Fever"]}
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
      />,
    )
    const text = container.textContent ?? ""
    expect(text).not.toContain("Electronically signed by")
    expect(container.querySelectorAll('[data-testid="pdf-image"]').length).toBe(0)
  })
})
