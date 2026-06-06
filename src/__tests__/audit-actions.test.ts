import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(),
}))

import { logAuditEvent, getAuditLog } from "@/lib/audit-actions"
import { createClient } from "@/lib/supabase/server"

describe("logAuditEvent", () => {
  it("calls supabase rpc log_event with correct params", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: "test-id", error: null })
    vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as any)

    await logAuditEvent("auth.login", { method: "password" })

    expect(mockRpc).toHaveBeenCalledWith("log_event", {
      p_event_type: "auth.login",
      p_resource_type: null,
      p_resource_id: null,
      p_metadata: { method: "password" },
    })
  })

  it("does not throw when rpc rejects", async () => {
    const mockRpc = vi.fn().mockRejectedValue(new Error("network fail"))
    vi.mocked(createClient).mockResolvedValue({ rpc: mockRpc } as any)

    await expect(logAuditEvent("auth.login")).resolves.toBeUndefined()
  })
})

describe("getAuditLog", () => {
  it("queries audit.log with correct params", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          range: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    })
    vi.mocked(createClient).mockResolvedValue({ schema: vi.fn().mockReturnValue({ from: mockFrom }) } as any)

    const result = await getAuditLog(50, 0)

    expect(mockFrom).toHaveBeenCalledWith("log")
    expect(result).toEqual([])
  })
})
