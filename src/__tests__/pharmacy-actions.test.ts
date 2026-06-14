import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))
vi.mock("@/lib/audit-actions", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    return undefined
  }),
}))

import { addPharmacy } from "@/lib/pharmacy-actions"
import { createClient } from "@/lib/supabase/server"

function mockSupabase(opts: {
  userId?: string | null
  subscriptionTier?: string | null
  ownerCount?: number
}) {
  const userId = opts.userId ?? "u-1"
  const profilesSingle = vi.fn(() => {
    if (opts.subscriptionTier === undefined) {
      return Promise.resolve({ data: null, error: null })
    }
    return Promise.resolve({
      data: { subscription_tier: opts.subscriptionTier },
      error: null,
    })
  })

  const membersChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((key: string, _value: unknown) => {
      if (key === "is_active") {
        return Promise.resolve({ count: opts.ownerCount ?? 0, error: null })
      }
      return membersChain
    }),
  }

  const pharmaciesInsertSingle = vi.fn().mockResolvedValue({
    data: null,
    error: { message: "Failed to create pharmacy." },
  })

  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: profilesSingle }),
        }),
      }
    }
    if (table === "pharmacy_members") {
      return membersChain
    }
    if (table === "pharmacies") {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({ single: pharmaciesInsertSingle }),
        }),
      }
    }
    return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() }
  })

  const supabase = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: userId === null ? null : { id: userId } } }),
    },
    from,
  }

  vi.mocked(createClient).mockResolvedValue(supabase as any)
  return supabase
}

function buildForm(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("name", "Shoppers")
  fd.set("address", "1 Main")
  fd.set("city", "Toronto")
  fd.set("province", "Ontario")
  fd.set("postalCode", "M5V1A1")
  fd.set("phone", "4165551234")
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

describe("addPharmacy — tier enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("caps basic-tier user at 1 owned pharmacy", async () => {
    mockSupabase({ subscriptionTier: "basic", ownerCount: 1 })

    const result = await addPharmacy(undefined, buildForm())

    expect(result).toEqual({
      error: "Your plan allows 1 pharmacies. Upgrade to add more.",
    })
  })

  it("ignores client-supplied tier in formData", async () => {
    mockSupabase({ subscriptionTier: "basic", ownerCount: 1 })

    const result = await addPharmacy(undefined, buildForm({ tier: "enterprise" }))

    expect(result).toEqual({
      error: "Your plan allows 1 pharmacies. Upgrade to add more.",
    })
  })

  it("defaults to basic when profile row is missing", async () => {
    mockSupabase({ subscriptionTier: undefined, ownerCount: 1 })

    const result = await addPharmacy(undefined, buildForm())

    expect(result).toEqual({
      error: "Your plan allows 1 pharmacies. Upgrade to add more.",
    })
  })

  it("defaults to basic when profile tier is null", async () => {
    mockSupabase({ subscriptionTier: null, ownerCount: 1 })

    const result = await addPharmacy(undefined, buildForm())

    expect(result).toEqual({
      error: "Your plan allows 1 pharmacies. Upgrade to add more.",
    })
  })
})
