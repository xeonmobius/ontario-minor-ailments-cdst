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

import { VaccinationRecordPdf } from "@/components/vaccination/vaccination-record-pdf"
import { getVaccineByVaccineId } from "@/lib/vaccines/catalog"
import type {
  PatientInfo,
  VaccinationAdministration,
} from "@/types"

const vaccine = getVaccineByVaccineId("influenza")!

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

const admin: VaccinationAdministration = {
  vaccineId: "influenza",
  vaccineName: "Influenza (inactivated)",
  lotNumber: "FLU123",
  expiryDate: "2027-01-01",
  manufacturer: "Fluzone",
  doseNumber: 1,
  seriesTotal: 1,
  route: "IM",
  site: "left_deltoid",
  doseVolume: "0.5 mL",
  administrationNotes: "",
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

describe("VaccinationRecordPdf", () => {
  afterEach(cleanup)

  it("renders the administered variant with title, lot/expiry/site/route, and the COVaxON reminder", () => {
    const { container } = render(
      <VaccinationRecordPdf
        vaccine={vaccine}
        patient={patient}
        outcome="administered"
        administration={admin}
        contraindicationsChecked={[]}
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
        protocolVersion="abcdef1234567890"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("VACCINATION ADMINISTRATION RECORD")
    expect(text).toContain("FLU123")
    expect(text).toContain("2027-01-01")
    expect(text).toContain("Intramuscular (IM)")
    expect(text).toContain("Left deltoid")
    expect(text).toContain("1 of 1")
    expect(text).toContain("COVaxON")
    expect(text).toContain("Patient Education Provided")
  })

  it("renders the consent patient signature image when supplied", () => {
    const { container } = render(
      <VaccinationRecordPdf
        vaccine={vaccine}
        patient={patient}
        outcome="administered"
        administration={admin}
        contraindicationsChecked={[]}
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
        consentSignatureDataUrl="data:image/png;base64,iVBOR=="
        consentSignerName="Jane Doe"
        consentCaptureMethod="signature"
        consentStatementVersion="vaccination-v1"
      />,
    )
    const images = container.querySelectorAll('[data-testid="pdf-image"]')
    expect(images.length).toBe(1)
    expect(images[0].getAttribute("data-src")).toContain("iVBOR")
    const text = container.textContent ?? ""
    expect(text).toContain("statement version vaccination-v1")
  })

  it("renders the withhold/refer variant with the NOT ADMINISTERED title + reason", () => {
    const { container } = render(
      <VaccinationRecordPdf
        vaccine={vaccine}
        patient={patient}
        outcome="withheld"
        administration={null}
        withholdReason="patient_declined"
        withholdNote="Patient opted to defer."
        contraindicationsChecked={["Severe allergic reaction"]}
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("VACCINATION NOT ADMINISTERED — RECORD")
    expect(text).toContain("Patient (or SDM) declined the vaccine")
    expect(text).toContain("Patient opted to defer.")
    expect(text).toContain("Not administered")
  })

  it("shows the next-dose follow-up for a multi-dose series when dose_number < series_total", () => {
    const multi = getVaccineByVaccineId("shingles-rzv")!
    const { container } = render(
      <VaccinationRecordPdf
        vaccine={multi}
        patient={patient}
        outcome="administered"
        administration={{
          ...admin,
          vaccineId: "shingles-rzv",
          vaccineName: multi.name,
          doseNumber: 1,
          seriesTotal: 2,
        }}
        contraindicationsChecked={[]}
        dateOfAssessment="2026-06-24"
        pharmacy={PHARMACY}
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain("Dose 2 of 2")
    expect(text).toContain("contact patient to schedule")
  })
})
