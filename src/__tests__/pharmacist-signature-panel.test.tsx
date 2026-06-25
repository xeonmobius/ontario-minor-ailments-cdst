import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ReactNode } from "react"
import { render, cleanup, fireEvent } from "@testing-library/react"
import type { PharmacistSignature, PharmacistSigningState } from "@/types"

// Hoist the pad stub so the hoisted next/dynamic mock can reference it.
const { SignaturePadStub } = vi.hoisted(() => ({
  SignaturePadStub: vi.fn<(props: { onChange: (d: string | null) => void }) => ReactNode>(),
}))

vi.mock("next/dynamic", () => ({ default: () => SignaturePadStub }))
// The panel fires progressive inline enrollment; stub it to a no-op resolve.
vi.mock("@/lib/signature-actions", () => ({
  enrollSignatureAction: vi.fn().mockResolvedValue({ ok: true }),
}))

import { PharmacistSignaturePanel } from "@/components/signature/pharmacist-signature-panel"
import { PHARMACIST_ATTESTATION_VERSION } from "@/lib/signature/attestation"

const ENROLLED: PharmacistSignature = {
  id: "sig-1",
  pharmacistId: "u1",
  signatureDataUrl: "data:image/png;base64,eW5vbGljaw==",
  enrolledAt: "2026-06-24T00:00:00.000Z",
  attestationVersion: PHARMACIST_ATTESTATION_VERSION,
}

function check(container: HTMLElement, id: string) {
  const el = container.querySelector(`#${id}`) as HTMLElement
  fireEvent.click(el)
}

interface RenderOpts {
  enrolled?: PharmacistSignature | null
  license?: string | null
  documentType?: "prescription" | "referral"
}

function renderPanel(
  onChange: (s: PharmacistSigningState | null) => void,
  opts: RenderOpts = {},
) {
  return render(
    <PharmacistSignaturePanel
      enrolled={opts.enrolled ?? null}
      pharmacistName="Dr. Pat"
      license={opts.license ?? "12345"}
      documentType={opts.documentType ?? "prescription"}
      value={null}
      onChange={onChange}
    />,
  )
}

describe("PharmacistSignaturePanel", () => {
  beforeEach(() => {
    SignaturePadStub.mockReset()
    SignaturePadStub.mockImplementation(() => null)
  })
  afterEach(cleanup)

  it("enrolled mode: emits null until the attestation is checked, then emits a valid state with the enrolled stroke", () => {
    const onChange = vi.fn()
    const { container } = renderPanel(onChange, { enrolled: ENROLLED })
    expect(onChange).toHaveBeenLastCalledWith(null)

    check(container, "pharmacist-attest")
    const last = onChange.mock.calls.at(-1)?.[0] as PharmacistSigningState | null
    expect(last).not.toBeNull()
    expect(last!.attested).toBe(true)
    expect(last!.signatureDataUrl).toBe(ENROLLED.signatureDataUrl)
    expect(last!.attestationVersion).toBe(PHARMACIST_ATTESTATION_VERSION)
    expect(last!.signedAt).not.toBeNull()
  })

  it("renders the rendered attestation text containing the license and documentType", () => {
    const onChange = vi.fn()
    const { container } = renderPanel(onChange, { enrolled: ENROLLED, license: "777", documentType: "referral" })
    const text = container.textContent ?? ""
    expect(text).toContain("registration #777")
    expect(text).toContain("referral")
    expect(text).toContain("256/24")
  })

  it("unenrolled mode: emits null until a stroke is captured AND attested", () => {
    SignaturePadStub.mockImplementation(
      ({ onChange: emit }: { onChange: (d: string | null) => void }) => (
        <button data-testid="stub-sig" type="button" onClick={() => emit("data:image/png;base64,iVBOR==")}>
          Sign
        </button>
      ),
    )
    const onChange = vi.fn()
    const { container, getByTestId } = renderPanel(onChange, { enrolled: null })
    expect(onChange).toHaveBeenLastCalledWith(null)

    // Stroke alone is not enough.
    fireEvent.click(getByTestId("stub-sig"))
    expect(onChange).toHaveBeenLastCalledWith(null)

    // Attestation completes validity.
    check(container, "pharmacist-attest")
    const last = onChange.mock.calls.at(-1)?.[0] as PharmacistSigningState | null
    expect(last).not.toBeNull()
    expect(last!.signatureDataUrl).toBe("data:image/png;base64,iVBOR==")
    expect(last!.saveAsCredential).toBe(true) // defaults to saving
  })

  it("toggling the 'Save as my signature' checkbox off clears saveAsCredential in the emitted state", () => {
    SignaturePadStub.mockImplementation(
      ({ onChange: emit }: { onChange: (d: string | null) => void }) => (
        <button data-testid="stub-sig" type="button" onClick={() => emit("data:image/png;base64,iVBOR==")}>
          Sign
        </button>
      ),
    )
    const onChange = vi.fn()
    const { container, getByTestId } = renderPanel(onChange, { enrolled: null })
    fireEvent.click(getByTestId("stub-sig"))
    check(container, "pharmacist-save-credential") // uncheck (was checked by default)
    check(container, "pharmacist-attest")
    const last = onChange.mock.calls.at(-1)?.[0] as PharmacistSigningState | null
    expect(last).not.toBeNull()
    expect(last!.saveAsCredential).toBe(false)
  })

  it("an enrolled pharmacist can switch to re-capture mode, which clears the enrolled stroke until a new one is drawn", () => {
    const onChange = vi.fn()
    SignaturePadStub.mockImplementation(
      ({ onChange: emit }: { onChange: (d: string | null) => void }) => (
        <button data-testid="stub-sig" type="button" onClick={() => emit("data:image/png;base64,bmV3")}>
          Sign
        </button>
      ),
    )
    const { container, getByText, getByTestId } = renderPanel(onChange, { enrolled: ENROLLED })
    // Switch to re-capture.
    fireEvent.click(getByText(/Re-capture signature instead/))
    // Pad is now shown; no stroke yet → invalid even if attested.
    expect(onChange).toHaveBeenLastCalledWith(null)
    check(container, "pharmacist-attest")
    expect(onChange).toHaveBeenLastCalledWith(null)
    // Draw a new stroke → valid with the NEW stroke (not the enrolled one).
    fireEvent.click(getByTestId("stub-sig"))
    const last = onChange.mock.calls.at(-1)?.[0] as PharmacistSigningState | null
    expect(last).not.toBeNull()
    expect(last!.signatureDataUrl).toBe("data:image/png;base64,bmV3")
  })
})
