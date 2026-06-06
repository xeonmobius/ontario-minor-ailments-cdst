import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: vi.fn(),
}))

import { reserveTxId } from "@/lib/prescription-actions"
import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"

describe("reserveTxId", () => {
  it("returns error when user has no pharmacy", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "user-1", pharmacyId: null } as any)
    const result = await reserveTxId()
    expect(result.error).toBe("No pharmacy associated with this account.")
  })

  it("returns txId on success", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "user-1", pharmacyId: "pharm-1" } as any)
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: "TX-2026-000001", error: null }),
    } as any)
    const result = await reserveTxId()
    expect(result.txId).toBe("TX-2026-000001")
  })

  it("returns error when rpc fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ id: "user-1", pharmacyId: "pharm-1" } as any)
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "RPC failed" } }),
    } as any)
    const result = await reserveTxId()
    expect(result.error).toBe("RPC failed")
  })
})
