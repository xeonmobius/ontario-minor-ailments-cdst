import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { syncSubscription } from "@/lib/polar/sync-subscription"

// The webhook sync is the only path Polar events take into the DB. It runs on
// the service-role admin client (the pharmacies.subscription_tier trigger
// rejects any other role). These tests mock that client and assert the
// decision logic: which events flip the tier, how the pharmacy is resolved,
// and what is safely ignored.

type TierWrite = { table: string; tier: string; pharmacyId: string }

function mockAdmin(opts: {
  ownedPharmacyId?: string | null
  profileFound?: boolean
  updateError?: string | null
}) {
  const writes: TierWrite[] = []
  const supabase = {
    from(table: string) {
      if (table === "pharmacies") {
        return {
          update(data: { subscription_tier: string }) {
            return {
              eq(_col: string, pharmacyId: string) {
                writes.push({
                  table,
                  tier: data.subscription_tier,
                  pharmacyId,
                })
                return Promise.resolve({ error: opts.updateError ?? null })
              },
            }
          },
        }
      }
      if (table === "profiles") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, id: string) {
                return {
                  single() {
                    return Promise.resolve({
                      data: opts.profileFound === false ? null : { id },
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      }
      if (table === "pharmacy_members") {
        return {
          select(_cols: string) {
            const chain = {
              eq: () => chain,
              order: () => chain,
              limit: () => chain,
              maybeSingle() {
                return Promise.resolve({
                  data: opts.ownedPharmacyId
                    ? { pharmacy_id: opts.ownedPharmacyId }
                    : null,
                  error: null,
                })
              },
            }
            return chain
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { supabase: supabase as never, writes }
}

function payload(overrides: Partial<Parameters<typeof syncSubscription>[2]> = {}) {
  return {
    product_id: "prod_pro_123",
    metadata: { pharmacy_id: "ph_1" } as Record<string, string> | null,
    customer: { external_id: null } as { external_id?: string | null } | null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv("POLAR_PRODUCT_PRO_ID", "prod_pro_123")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("syncSubscription", () => {
  it("subscription.active with matching product and pharmacy metadata sets pro", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_1" })
    const result = await syncSubscription(supabase, "subscription.active", payload())
    expect(result).toBe("pro")
    expect(writes).toEqual([
      { table: "pharmacies", tier: "pro", pharmacyId: "ph_1" },
    ])
  })

  it("subscription.updated with matching product upgrades to pro", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_1" })
    const result = await syncSubscription(supabase, "subscription.updated", payload())
    expect(result).toBe("pro")
    expect(writes[0]?.tier).toBe("pro")
  })

  it("subscription.revoked flips the pharmacy back to basic", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_1" })
    const result = await syncSubscription(supabase, "subscription.revoked", payload())
    expect(result).toBe("basic")
    expect(writes).toEqual([
      { table: "pharmacies", tier: "basic", pharmacyId: "ph_1" },
    ])
  })

  it("subscription.canceled is a no-op (access runs until period end)", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_1" })
    const result = await syncSubscription(supabase, "subscription.canceled", payload())
    expect(result).toBe("noop")
    expect(writes).toEqual([])
  })

  it("past_due is a no-op", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_1" })
    const result = await syncSubscription(supabase, "subscription.past_due", payload())
    expect(result).toBe("noop")
    expect(writes).toEqual([])
  })

  it("an event for an unknown product never touches the tier", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_1" })
    const result = await syncSubscription(
      supabase,
      "subscription.active",
      payload({ product_id: "prod_enterprise_later" }),
    )
    expect(result).toBe("noop")
    expect(writes).toEqual([])
  })

  it("resolves the pharmacy from customer external_id when metadata is missing", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_owned" })
    const result = await syncSubscription(
      supabase,
      "subscription.active",
      payload({
        metadata: null,
        customer: { external_id: "user-owner-1" },
      }),
    )
    expect(result).toBe("pro")
    expect(writes).toEqual([
      { table: "pharmacies", tier: "pro", pharmacyId: "ph_owned" },
    ])
  })

  it("external_id that owns no pharmacy is a no-op", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: null })
    const result = await syncSubscription(
      supabase,
      "subscription.active",
      payload({
        metadata: null,
        customer: { external_id: "user-owner-1" },
      }),
    )
    expect(result).toBe("noop")
    expect(writes).toEqual([])
  })

  it("no metadata and no external_id is a no-op", async () => {
    const { supabase, writes } = mockAdmin({ ownedPharmacyId: "ph_1" })
    const result = await syncSubscription(
      supabase,
      "subscription.active",
      payload({ metadata: null, customer: null }),
    )
    expect(result).toBe("noop")
    expect(writes).toEqual([])
  })

  it("a failed tier write is reported, not thrown", async () => {
    const { supabase } = mockAdmin({
      ownedPharmacyId: "ph_1",
      updateError: "subscription_tier can only be changed by service_role",
    })
    const result = await syncSubscription(supabase, "subscription.active", payload())
    expect(result).toBe("noop")
  })
})
