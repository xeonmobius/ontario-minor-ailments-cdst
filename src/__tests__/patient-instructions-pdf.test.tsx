import { describe, it, expect, vi, afterEach } from "vitest"
import type { ReactNode } from "react"
import { render, cleanup } from "@testing-library/react"
import type { Ailment, PharmacyDefaults, SelectedRx } from "@/types"
import {
  getFrDirections,
  getPatientInstructions,
  PATIENT_INSTRUCTIONS_HASH,
  PATIENT_INSTRUCTIONS_VERSION,
  SAFETY_NET_EN,
  SAFETY_NET_FR,
  SIG_FALLBACK_NOTE_FR,
} from "@/lib/i18n/patient-instructions"

vi.mock("@react-pdf/renderer", () => ({
  Document: ({ children }: { children: ReactNode }) => (
    <div data-testid="doc">{children}</div>
  ),
  Page: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: <T,>(s: T): T => s },
}))

import { PatientInstructionsPdf } from "@/components/patient-instructions-pdf"

const utiFixture: Ailment = {
  id: "18",
  name: "Urinary Tract Infection (Uncomplicated)",
  slug: "uti",
  symptoms: [],
  redFlags: [],
  rxOptions: [{ drug: "Nitrofurantoin 100 mg", dose: "1 cap BID × 5 days", notes: "" }],
  nonRx: [
    "Increase fluid intake",
    "Void after intercourse",
    "Proper wiping (front to back)",
    "Avoid spermicides if recurrent",
    "Cotton underwear",
  ],
  followUp:
    "Advise patient to return if no improvement in 48–72h Refer if symptoms worsen or systemic symptoms develop",
}

const pharmFixture: PharmacyDefaults = {
  pharmacyName: "Rexall Gatineau",
  address: "1 Rue",
  city: "Gatineau",
  province: "QC",
  postalCode: "J8X 1A1",
  phone: "819-555-0100",
  fax: "819-555-0101",
  pharmacistName: "Dr Test",
  provincialLicense: "L1",
  registrationNumber: "R1",
}

// Canonical case: pharmacist's sig still equals the regimen's seed dose →
// resolveFrDirections returns the human-authored FR block.
const nitroCanonical: SelectedRx = {
  drug: "Nitrofurantoin 100 mg",
  dose: "1 cap BID × 5 days",
  sig: "1 cap BID × 5 days",
  notes: "",
  quantity: "10 capsules",
  refills: "0",
  duration: "5 days",
}

// Fallback case: pharmacist edited the sig away from the seed → the FR handout
// must show the EN sig verbatim + the "ask your pharmacist" note, never an MT.
const nitroEdited: SelectedRx = {
  ...nitroCanonical,
  sig: "Half dose for renal impairment",
}

const checkedNonRx = ["Increase fluid intake", "Cotton underwear"]

describe("PatientInstructionsPdf", () => {
  afterEach(cleanup)

  it("renders the EN handout from data/ (followUp + checked nonRx + sig verbatim + EN safety-net)", () => {
    const { container } = render(
      <PatientInstructionsPdf
        ailment={utiFixture}
        selectedRx={nitroCanonical}
        nonRxChecked={checkedNonRx}
        pharmacy={pharmFixture}
        language="en"
        dateOfAssessment="2026-06-24"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain(utiFixture.followUp)
    expect(text).toContain("Increase fluid intake")
    expect(text).toContain("Cotton underwear")
    expect(text).toContain("1 cap BID × 5 days")
    expect(text).toContain(SAFETY_NET_EN)
  })

  it("renders the FR handout (followUpFr + resolved nonRxFr + canonical FR directions + FR safety-net)", () => {
    const { container } = render(
      <PatientInstructionsPdf
        ailment={utiFixture}
        selectedRx={nitroCanonical}
        nonRxChecked={checkedNonRx}
        pharmacy={pharmFixture}
        language="fr"
        dateOfAssessment="2026-06-24"
      />,
    )
    const text = container.textContent ?? ""
    const fr = getPatientInstructions("uti", "fr")!
    expect(text).toContain(fr.followUpFr)
    // Positionally-resolved FR self-care items for the two checked EN strings.
    expect(text).toContain(fr.nonRxFr[0])
    expect(text).toContain(fr.nonRxFr[4])
    expect(text).toContain(getFrDirections("uti", "Nitrofurantoin 100 mg")!)
    expect(text).toContain(SAFETY_NET_FR)
  })

  it("renders both EN and FR pages when language='both'", () => {
    const { container } = render(
      <PatientInstructionsPdf
        ailment={utiFixture}
        selectedRx={nitroCanonical}
        nonRxChecked={checkedNonRx}
        pharmacy={pharmFixture}
        language="both"
        dateOfAssessment="2026-06-24"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain(SAFETY_NET_EN)
    expect(text).toContain(SAFETY_NET_FR)
  })

  // ── Sig-translation invariant (spec §4.3): the patient-safety tests ─────────
  it("canonical case: FR page shows the canonical FR block (no EN sig, no fallback note) when sig === dose", () => {
    const { container } = render(
      <PatientInstructionsPdf
        ailment={utiFixture}
        selectedRx={nitroCanonical}
        nonRxChecked={[]}
        pharmacy={pharmFixture}
        language="fr"
        dateOfAssessment="2026-06-24"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain(getFrDirections("uti", "Nitrofurantoin 100 mg")!)
    expect(text).not.toContain(SIG_FALLBACK_NOTE_FR)
    expect(text).not.toContain(nitroCanonical.sig)
  })

  it("fallback case: FR page shows the EN sig verbatim + the pharmacist note when the sig was edited", () => {
    const { container } = render(
      <PatientInstructionsPdf
        ailment={utiFixture}
        selectedRx={nitroEdited}
        nonRxChecked={[]}
        pharmacy={pharmFixture}
        language="fr"
        dateOfAssessment="2026-06-24"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain(nitroEdited.sig)
    expect(text).toContain(SIG_FALLBACK_NOTE_FR)
    // It must NOT show the standard-dose FR block for an edited-dose Rx.
    expect(text).not.toContain(getFrDirections("uti", "Nitrofurantoin 100 mg")!)
  })

  it("falls back gracefully when FR is requested for an un-curated ailment (no crash)", () => {
    const uncurated: Ailment = {
      ...utiFixture,
      slug: "not-a-real-slug",
      followUp: "EN-only follow up",
    }
    expect(() =>
      render(
        <PatientInstructionsPdf
          ailment={uncurated}
          selectedRx={nitroCanonical}
          nonRxChecked={[]}
          pharmacy={pharmFixture}
          language="fr"
          dateOfAssessment="2026-06-24"
        />,
      ),
    ).not.toThrow()
  })

  it("does not embed the patient name by default (PHI minimisation)", () => {
    const { container } = render(
      <PatientInstructionsPdf
        ailment={utiFixture}
        selectedRx={nitroCanonical}
        nonRxChecked={[]}
        pharmacy={pharmFixture}
        language="en"
        dateOfAssessment="2026-06-24"
      />,
    )
    expect(container.textContent ?? "").not.toMatch(/patient\.name/i)
  })

  it("pins the rendered handout with version + hash8 corpus tag", () => {
    const { container } = render(
      <PatientInstructionsPdf
        ailment={utiFixture}
        selectedRx={nitroCanonical}
        nonRxChecked={[]}
        pharmacy={pharmFixture}
        language="en"
        dateOfAssessment="2026-06-24"
      />,
    )
    const text = container.textContent ?? ""
    expect(text).toContain(PATIENT_INSTRUCTIONS_VERSION)
    expect(text).toContain(PATIENT_INSTRUCTIONS_HASH.slice(0, 8))
    // Does not leak the full hash (only the 8-char prefix).
    expect(text).not.toContain(PATIENT_INSTRUCTIONS_HASH.slice(0, 12))
  })
})
