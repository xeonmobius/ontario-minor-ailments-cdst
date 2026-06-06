import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn(),
}))

import { forgotPassword } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"

describe("forgotPassword", () => {
  it("calls resetPasswordForEmail with correct redirectTo", async () => {
    const mockReset = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { resetPasswordForEmail: mockReset } } as any)

    const formData = new FormData()
    formData.set("email", "test@example.com")

    const result = await forgotPassword(null, formData)

    expect(mockReset).toHaveBeenCalledWith("test@example.com", {
      redirectTo: expect.stringContaining("/reset-password"),
    })
    expect(result).toEqual({ success: true })
  })

  it("returns success even when email not found (prevents enumeration)", async () => {
    const mockReset = vi.fn().mockResolvedValue({ data: {}, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { resetPasswordForEmail: mockReset } } as any)

    const formData = new FormData()
    formData.set("email", "nonexistent@example.com")

    const result = await forgotPassword(null, formData)

    expect(result).toEqual({ success: true })
  })
})
