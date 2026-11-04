import { describe, it, expect, vi, beforeEach } from "vitest"

// The pay-to-use gate lives in the auth middleware: an authenticated user
// whose pharmacy is not tier 'pro' gets redirected to the billing page, and
// the exemption list (billing/profile/pharmacy/password settings, invites,
// api) stays reachable so lockout is always fixable. Fails closed.

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}))

import { createServerClient } from "@supabase/ssr"
import { updateSession } from "@/lib/supabase/proxy"

function makeRequest(path: string) {
  // NextUrl is a URL subclass with a clone(); a plain URL + clone matches it.
  const nextUrl = new URL(`https://cdst.test${path}`)
  ;(nextUrl as URL & { clone: () => URL }).clone = () =>
    new URL(`https://cdst.test${path}`)
  const cookies: { name: string; value: string }[] = [
    { name: "sb-token", value: "t" },
  ]
  return {
    nextUrl,
    cookies: {
      getAll: () => cookies,
      set: vi.fn(),
    },
  } as never
}

function mockSupabase(opts: { user: unknown; tier?: string }) {
  const fake = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: opts.user } }),
    },
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`)
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _id: string) {
              return {
                single() {
                  return Promise.resolve({
                    data: opts.user
                      ? {
                          pharmacy_id: "ph_1",
                          pharmacies: { subscription_tier: opts.tier ?? "basic" },
                        }
                      : null,
                    error: null,
                  })
                },
              }
            },
          }
        },
      }
    },
  }
  vi.mocked(createServerClient).mockReturnValue(fake as never)
}

beforeEach(() => {
  vi.mocked(createServerClient).mockReset()
})

function locationOf(response: Response): string | null {
  return response.headers.get("location")
}

describe("subscription gate in updateSession", () => {
  it("a pro pharmacy passes through to clinical routes", async () => {
    mockSupabase({ user: { id: "u1" }, tier: "pro" })
    const response = await updateSession(makeRequest("/assess/acne"))
    expect(locationOf(response)).toBeNull()
  })

  it("a basic (unsubscribed) pharmacy is redirected to the billing page", async () => {
    mockSupabase({ user: { id: "u1" }, tier: "basic" })
    const response = await updateSession(makeRequest("/dashboard"))
    expect(locationOf(response)).toBe("https://cdst.test/settings/billing")
  })

  it("an unreadable tier fails closed to the billing page", async () => {
    mockSupabase({ user: { id: "u1" }, tier: undefined })
    const response = await updateSession(makeRequest("/assess/uti"))
    expect(locationOf(response)).toBe("https://cdst.test/settings/billing")
  })

  it("the billing page itself stays reachable when locked out", async () => {
    mockSupabase({ user: { id: "u1" }, tier: "basic" })
    const response = await updateSession(makeRequest("/settings/billing"))
    expect(locationOf(response)).toBeNull()
  })

  it("profile and pharmacy settings stay reachable when locked out", async () => {
    mockSupabase({ user: { id: "u1" }, tier: "basic" })
    expect(locationOf(await updateSession(makeRequest("/settings/profile")))).toBeNull()
    expect(locationOf(await updateSession(makeRequest("/settings/pharmacy")))).toBeNull()
  })

  it("api routes stay reachable (webhooks, checkout, portal)", async () => {
    mockSupabase({ user: { id: "u1" }, tier: "basic" })
    expect(locationOf(await updateSession(makeRequest("/api/polar/checkout")))).toBeNull()
    expect(locationOf(await updateSession(makeRequest("/api/webhooks/polar")))).toBeNull()
  })

  it("invite acceptance stays reachable when locked out", async () => {
    mockSupabase({ user: { id: "u1" }, tier: "basic" })
    const response = await updateSession(
      makeRequest("/invite/some-token/accept"),
    )
    expect(locationOf(response)).toBeNull()
  })

  it("team settings require pro", async () => {
    mockSupabase({ user: { id: "u1" }, tier: "basic" })
    const response = await updateSession(makeRequest("/settings/team"))
    expect(locationOf(response)).toBe("https://cdst.test/settings/billing")
  })

  it("unauthenticated users still land on login (existing behavior)", async () => {
    mockSupabase({ user: null })
    const response = await updateSession(makeRequest("/dashboard"))
    expect(locationOf(response)).toBe("https://cdst.test/login")
  })

  it("unauthenticated users reach public pages untouched", async () => {
    mockSupabase({ user: null })
    expect(locationOf(await updateSession(makeRequest("/login")))).toBeNull()
    expect(locationOf(await updateSession(makeRequest("/signup")))).toBeNull()
  })
})
