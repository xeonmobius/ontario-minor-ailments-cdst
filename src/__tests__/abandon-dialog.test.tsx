import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { AbandonDialog } from "../components/wizard/abandon-dialog"

function renderDialog(props: Partial<React.ComponentProps<typeof AbandonDialog>> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <AbandonDialog
      open={true}
      hasPatientIdentity={false}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />,
  )
  return { onCancel, onConfirm }
}

describe("AbandonDialog", () => {
  afterEach(cleanup)

  it("shows the will-not-be-saved banner when no patient identity", () => {
    renderDialog({ hasPatientIdentity: false })
    expect(screen.getByText(/will not be saved/i)).toBeInTheDocument()
  })

  it("shows the partial-record-saved banner when patient identity exists", () => {
    renderDialog({ hasPatientIdentity: true })
    expect(screen.getByText(/partial assessment record will be saved/i)).toBeInTheDocument()
  })

  it("disables confirm until a reason is selected", () => {
    renderDialog()
    expect(screen.getByRole("button", { name: /confirm — exit assessment/i })).toBeDisabled()
  })

  it("confirms with the selected reason and note", () => {
    const { onConfirm } = renderDialog()
    fireEvent.click(screen.getByText(/patient left before completion/i))
    fireEvent.change(screen.getByLabelText(/abandonment note/i), {
      target: { value: "left abruptly" },
    })
    const confirm = screen.getByRole("button", { name: /confirm — exit assessment/i })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith("patient_left", "left abruptly")
  })

  it("calls onCancel when the cancel button is clicked", () => {
    const { onCancel } = renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
