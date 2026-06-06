import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { changeEmail } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"

describe("changeEmail", () => {
  it("returns error when current password is wrong", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "old@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: { message: "Invalid login credentials" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn } } as any)

    const formData = new FormData()
    formData.set("email", "new@example.com")
    formData.set("currentPassword", "wrongpass")

    const result = await changeEmail(null, formData)

    expect(result).toEqual({ error: "Current password is incorrect" })
  })

  it("returns error when email is same as current", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "same@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn } } as any)

    const formData = new FormData()
    formData.set("email", "same@example.com")
    formData.set("currentPassword", "correctpass")

    const result = await changeEmail(null, formData)

    expect(result).toEqual({ error: "New email is the same as current email" })
  })

  it("updates email and logs audit on success", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "old@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockResolvedValue({ data: { user: { email: "new@example.com" } }, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn, updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("email", "new@example.com")
    formData.set("currentPassword", "correctpass")

    const result = await changeEmail(null, formData)

    expect(mockSignIn).toHaveBeenCalledWith({ email: "old@example.com", password: "correctpass" })
    expect(mockUpdate).toHaveBeenCalledWith({ email: "new@example.com" })
    expect(result).toEqual({ success: true })
    expect(logAuditEvent).toHaveBeenCalledWith("auth.email_change", { old_email: "old@example.com", new_email: "new@example.com" })
  })

  it("returns error when updateUser fails", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { email: "old@example.com" } } })
    const mockSignIn = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockResolvedValue({ data: null, error: { message: "Email already registered" } })
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser, signInWithPassword: mockSignIn, updateUser: mockUpdate } } as any)

    const formData = new FormData()
    formData.set("email", "taken@example.com")
    formData.set("currentPassword", "correctpass")

    const result = await changeEmail(null, formData)

    expect(result).toEqual({ error: "Email already registered" })
  })
})
