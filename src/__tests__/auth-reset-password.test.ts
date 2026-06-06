import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { resetPassword } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"

describe("resetPassword", () => {
  it("returns error when passwords do not match", async () => {
    const formData = new FormData()
    formData.set("password", "newpass123")
    formData.set("confirmPassword", "different456")

    const result = await resetPassword(null, formData)

    expect(result).toEqual({ error: "Passwords do not match" })
  })

  it("returns error when password is too short", async () => {
    const formData = new FormData()
    formData.set("password", "short")
    formData.set("confirmPassword", "short")

    const result = await resetPassword(null, formData)

    expect(result).toEqual({ error: "Password must be at least 8 characters" })
  })

  it("updates password and logs audit event on success", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await resetPassword(null, formData)

    expect(mockUpdate).toHaveBeenCalledWith({ password: "newpassword123" })
    expect(result).toEqual({ success: true })
    expect(logAuditEvent).toHaveBeenCalledWith("auth.password_change", { method: "reset_link" })
  })

  it("returns error when updateUser fails", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ data: null, error: { message: "Token expired" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await resetPassword(null, formData)

    expect(result).toEqual({ error: "Token expired" })
  })
})
