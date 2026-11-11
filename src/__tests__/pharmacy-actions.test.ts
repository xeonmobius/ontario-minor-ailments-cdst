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
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

// Under per-pharmacy pay-to-use billing (ADR 0001), creating a pharmacy is
// free and unlimited; the SUBSCRIPTION is what unlocks usage. New pharmacies
// must therefore start locked (subscription_status 'inactive', tier 'basic')
// so the middleware paywall actually fires — the old per-user tier cap is
// gone, and these tests pin that contract.

function mockSupabase(opts: { unauth?: boolean; insertError?: string | null }) {
  const userId = opts.unauth ? null : "u-1"

  const insertSingle = vi.fn(() =>
    Promise.resolve({
      data: opts.insertError ? null : { id: "ph_new" },
      error: opts.insertError ? { message: opts.insertError } : null,
    }),
  )
  const pharmaciesInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: insertSingle }),
  })

  const from = vi.fn((table: string) => {
    if (table === "pharmacies") {
      return { insert: pharmaciesInsert }
    }
    // pharmacy_members insert + profiles update follow the pharmacy insert.
    return {
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    }
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
  return { supabase, pharmaciesInsert }
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

describe("addPharmacy — pay-to-use defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates the pharmacy with no per-user tier cap", async () => {
    const { supabase } = mockSupabase({})

    await addPharmacy(null, buildForm())

    expect(supabase.from).toHaveBeenCalledWith("pharmacies")
    expect(redirect).toHaveBeenCalledWith("/")
  })

  it("starts new pharmacies locked: status inactive, tier basic", async () => {
    const { pharmaciesInsert } = mockSupabase({})

    await addPharmacy(null, buildForm())

    const payload = pharmaciesInsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.subscription_status).toBe("inactive")
    expect(payload.subscription_tier).toBe("basic")
  })

  it("ignores client-supplied tier in formData", async () => {
    const { pharmaciesInsert } = mockSupabase({})

    await addPharmacy(null, buildForm({ tier: "enterprise" }))

    const payload = pharmaciesInsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.subscription_tier).toBe("basic")
  })

  it("surfaces a failure to create the pharmacy row", async () => {
    mockSupabase({ insertError: "Failed to create pharmacy." })

    const result = await addPharmacy(null, buildForm())

    expect(result).toHaveProperty("error")
  })

  it("rejects unauthenticated callers", async () => {
    mockSupabase({ unauth: true })

    const result = await addPharmacy(null, buildForm())

    expect(result).toEqual({ error: "Not authenticated" })
  })
})
