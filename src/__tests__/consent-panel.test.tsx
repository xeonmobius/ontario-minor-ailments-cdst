import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ReactNode } from "react"
import { render, cleanup, fireEvent } from "@testing-library/react"
import type { ConsentCapture } from "@/types"

// Hoist the stub so the next/dynamic mock (which is hoisted above imports) can
// reference it. The stub renders nothing by default; the signature-path tests
// override its implementation to render clickable Sign/Clear buttons.
const { SignaturePadStub } = vi.hoisted(() => ({
  SignaturePadStub: vi.fn<(props: { onChange: (d: string | null) => void }) => ReactNode>(),
}))

vi.mock("next/dynamic", () => ({ default: () => SignaturePadStub }))

import { ConsentPanel } from "@/components/consent/consent-panel"
import { CONSENT_STATEMENT_VERSION } from "@/lib/consent/statements"

interface PanelOpts {
  encounterType?: string
  pharmacyName?: string
  ailmentName?: string
}

function renderPanel(onChange: (c: ConsentCapture | null) => void, opts: PanelOpts = {}) {
  return render(
    <ConsentPanel
      ailmentName={opts.ailmentName ?? "UTI"}
      pharmacyName={opts.pharmacyName ?? "Rexall"}
      encounterType={opts.encounterType ?? "Virtual"}
      value={null}
      onChange={onChange}
    />,
  )
}

function check(container: HTMLElement, id: string) {
  const el = container.querySelector(`#${id}`) as HTMLElement
  fireEvent.click(el)
}

function type(container: HTMLElement, id: string, value: string) {
  const el = container.querySelector(`#${id}`) as HTMLInputElement
  fireEvent.change(el, { target: { value } })
}

describe("ConsentPanel", () => {
  beforeEach(() => {
    SignaturePadStub.mockReset()
    SignaturePadStub.mockImplementation(() => null)
  })
  afterEach(cleanup)

  it("emits null until both required consents + signer name + capture are present (verbal path)", () => {
    const onChange = vi.fn()
    const { container } = renderPanel(onChange)
    // Initial mount: not valid → null
    expect(onChange).toHaveBeenLastCalledWith(null)

    check(container, "consent-consent_to_assess")
    expect(onChange).toHaveBeenLastCalledWith(null)

    check(container, "consent-consent_to_record")
    expect(onChange).toHaveBeenLastCalledWith(null)

    type(container, "consent-signer-name", "Jane Doe")
    expect(onChange).toHaveBeenLastCalledWith(null)

    // Verbal attestation completes the verbal capture
    check(container, "consent-verbal-attest")
    const last = onChange.mock.calls.at(-1)?.[0] as ConsentCapture | null
    expect(last).not.toBeNull()
    expect(last!.consentToAssess).toBe(true)
    expect(last!.consentToRecord).toBe(true)
    expect(last!.captureMethod).toBe("verbal_attested")
    expect(last!.signatureDataUrl).toBeNull()
    expect(last!.signerName).toBe("Jane Doe")
    expect(last!.statementVersion).toBe(CONSENT_STATEMENT_VERSION)
  })

  it("defaults an In-Person encounter to signature capture and requires a stroke", () => {
    // Stub the pad as two clickable buttons: Sign emits a PNG data URL, Clear nulls it.
    SignaturePadStub.mockImplementation(
      ({ onChange }: { onChange: (d: string | null) => void }) => (
        <>
          <button data-testid="stub-sig" type="button" onClick={() => onChange("data:image/png;base64,iVBOR==")}>Sign</button>
          <button data-testid="stub-clear" type="button" onClick={() => onChange(null)}>Clear</button>
        </>
      ),
    )
    const onChange = vi.fn()
    const { container, getByTestId } = renderPanel(onChange, { encounterType: "In-Person" })
    check(container, "consent-consent_to_assess")
    check(container, "consent-consent_to_record")
    type(container, "consent-signer-name", "Jane Doe")
    // No signature yet → still invalid
    expect(onChange).toHaveBeenLastCalledWith(null)

    // The signature pad (stubbed) is rendered for In-Person default
    expect(SignaturePadStub).toHaveBeenCalled()
    fireEvent.click(getByTestId("stub-sig"))
    const last = onChange.mock.calls.at(-1)?.[0] as ConsentCapture | null
    expect(last).not.toBeNull()
    expect(last!.captureMethod).toBe("signature")
    expect(last!.signatureDataUrl).toBe("data:image/png;base64,iVBOR==")
  })

  it("clearing the signature reverts to invalid", () => {
    SignaturePadStub.mockImplementation(
      ({ onChange }: { onChange: (d: string | null) => void }) => (
        <>
          <button data-testid="stub-sig" type="button" onClick={() => onChange("data:image/png;base64,iVBOR==")}>Sign</button>
          <button data-testid="stub-clear" type="button" onClick={() => onChange(null)}>Clear</button>
        </>
      ),
    )
    const onChange = vi.fn()
    const { container, getByTestId } = renderPanel(onChange, { encounterType: "In-Person" })
    check(container, "consent-consent_to_assess")
    check(container, "consent-consent_to_record")
    type(container, "consent-signer-name", "Jane Doe")
    fireEvent.click(getByTestId("stub-sig"))
    fireEvent.click(getByTestId("stub-clear"))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it("shows the SDM attestation clause only when the signer is not the patient", () => {
    const onChange = vi.fn()
    const { container, rerender } = renderPanel(onChange, { encounterType: "Virtual" })
    expect(container.textContent).not.toMatch(/Health Care Consent Act/)

    check(container, "consent-rel-parent")
    // Re-read after the state update flushed
    rerender(
      <ConsentPanel
        ailmentName="UTI"
        pharmacyName="Rexall"
        encounterType="Virtual"
        value={null}
        onChange={onChange}
      />,
    )
    expect(container.textContent).toMatch(/Health Care Consent Act/)
  })
})
