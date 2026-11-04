import { describe, it, expect, vi, beforeEach } from "vitest"

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
  function mockAuditSupabase(opts: {
    userId?: string | null
    pharmacyId?: string | null
    isPlatformAdmin?: boolean
    profileData?: unknown
  }) {
    const userId = opts.userId === undefined ? "u-1" : opts.userId

    const profilesSingle = vi.fn().mockResolvedValue({
      data: opts.profileData !== undefined
        ? opts.profileData
        : (opts.userId === null ? null : {
            pharmacy_id: opts.pharmacyId ?? "pharm-A",
            is_platform_admin: opts.isPlatformAdmin ?? false,
          }),
      error: null,
    })

    const auditEq = vi.fn()
    const auditRange = vi.fn()
    const auditBuilder = {
      data: [],
      error: null,
      range: auditRange,
      eq: auditEq,
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    }
    auditRange.mockReturnValue(auditBuilder)
    auditEq.mockReturnValue(auditBuilder)

    const auditSelect = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue(auditBuilder),
    })
    const auditFrom = vi.fn().mockReturnValue({ select: auditSelect })

    const profilesSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ single: profilesSingle }),
    })
    const profilesFrom = vi.fn().mockReturnValue({ select: profilesSelect })

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: userId === null ? null : { id: userId } },
        }),
      },
      from: profilesFrom,
      schema: vi.fn((schema: string) => {
        if (schema === "audit") return { from: auditFrom }
        return { from: profilesFrom }
      }),
    }

    vi.mocked(createClient).mockResolvedValue(supabase as any)

    return { supabase, auditRange, auditEq }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns [] when no authenticated user", async () => {
    mockAuditSupabase({ userId: null })
    const result = await getAuditLog(50, 0)
    expect(result).toEqual([])
  })

  it("returns [] when profile lookup fails", async () => {
    mockAuditSupabase({ userId: "u-1", profileData: null })
    const result = await getAuditLog(50, 0)
    expect(result).toEqual([])
  })

  it("filters by caller's pharmacy_id for non-admin", async () => {
    const { auditEq } = mockAuditSupabase({
      userId: "u-1",
      pharmacyId: "pharm-A",
      isPlatformAdmin: false,
    })
    await getAuditLog(50, 0)
    expect(auditEq).toHaveBeenCalledWith("pharmacy_id", "pharm-A")
  })

  it("does not filter for platform admin", async () => {
    const { auditEq } = mockAuditSupabase({
      userId: "admin-1",
      pharmacyId: "pharm-A",
      isPlatformAdmin: true,
    })
    await getAuditLog(50, 0)
    expect(auditEq).not.toHaveBeenCalled()
  })

  it("preserves range and order on the audit query", async () => {
    const { auditRange } = mockAuditSupabase({
      userId: "admin-1",
      isPlatformAdmin: true,
    })
    await getAuditLog(25, 50)
    expect(auditRange).toHaveBeenCalledWith(50, 74)
  })
})
