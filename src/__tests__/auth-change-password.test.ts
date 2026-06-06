import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { changePassword } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"

describe("changePassword", () => {
  it("returns error when current password is wrong", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "test@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: { message: "Invalid login credentials" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn } } as any)

    const formData = new FormData()
    formData.set("currentPassword", "wrongpass")
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await changePassword(null, formData)

    expect(result).toEqual({ error: "Current password is incorrect" })
  })

  it("returns error when new passwords do not match", async () => {
    const result = await changePassword(null, (() => {
      const fd = new FormData()
      fd.set("currentPassword", "oldpass")
      fd.set("password", "newpass123")
      fd.set("confirmPassword", "different456")
      return fd
    })())

    expect(result).toEqual({ error: "Passwords do not match" })
  })

  it("updates password and logs audit on success", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "test@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn, updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("currentPassword", "oldpassword")
    formData.set("password", "newpassword123")
    formData.set("confirmPassword", "newpassword123")

    const result = await changePassword(null, formData)

    expect(mockSignIn).toHaveBeenCalledWith({ email: "test@example.com", password: "oldpassword" })
    expect(mockUpdate).toHaveBeenCalledWith({ password: "newpassword123" })
    expect(result).toEqual({ success: true })
    expect(logAuditEvent).toHaveBeenCalledWith("auth.password_change", { method: "settings" })
  })
})
