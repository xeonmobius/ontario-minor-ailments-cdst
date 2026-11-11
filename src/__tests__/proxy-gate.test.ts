import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}))

import { createServerClient } from "@supabase/ssr"
import { updateSession } from "@/lib/supabase/proxy"

// The pay-to-use gate lives in the auth middleware: an authenticated user
// whose pharmacy is not tier 'pro' gets redirected to the billing page, and
// the exemption list (billing/profile/pharmacy/password settings, invites,
// api) stays reachable so lockout is always fixable. Fails closed.
// The user id is decoded from the session JWT cookie locally (no GoTrue
// round trip), so tests drive authentication via a forged-shaped JWT cookie.

function makeJwt(sub: string | null): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url")
  const payload = sub
    ? { sub, exp: Math.floor(Date.now() / 1000) + 3600 }
    : { exp: Math.floor(Date.now() / 1000) - 10 }
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`
}

function makeRequest(path: string, sub: string | null) {
  // NextUrl is a URL subclass with a clone(); a plain URL + clone matches it.
  const nextUrl = new URL(`https://cdst.test${path}`)
  ;(nextUrl as URL & { clone: () => URL }).clone = () =>
    new URL(`https://cdst.test${path}`)
  const cookies = sub
    ? [{ name: "sb-hawlgrpgnfsqjqhhgmfi-auth-token", value: makeJwt(sub) }]
    : []
  return {
    nextUrl,
    cookies: {
      getAll: () => cookies,
      set: vi.fn(),
    },
  } as never
}

function mockSupabase(opts: { tier?: string }) {
  const fake = {
    from(table: string) {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`)
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _id: string) {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      pharmacy_id: "ph_1",
                      pharmacies: { subscription_tier: opts.tier ?? "basic" },
                    },
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
    mockSupabase({ tier: "pro" })
    const response = await updateSession(makeRequest("/assess/acne", "u1"))
    expect(locationOf(response)).toBeNull()
  })

  it("a basic (unsubscribed) pharmacy is redirected to the billing page", async () => {
    mockSupabase({ tier: "basic" })
    const response = await updateSession(makeRequest("/dashboard", "u1"))
    expect(locationOf(response)).toBe("https://cdst.test/settings/billing")
  })

  it("an unreadable tier fails closed to the billing page", async () => {
    mockSupabase({ tier: undefined })
    const response = await updateSession(makeRequest("/assess/uti", "u1"))
    expect(locationOf(response)).toBe("https://cdst.test/settings/billing")
  })

  it("an expired session token is treated as unauthenticated", async () => {
    mockSupabase({ tier: "basic" })
    const response = await updateSession(makeRequest("/dashboard", null))
    expect(locationOf(response)).toBe("https://cdst.test/login")
  })

  it("the billing page itself stays reachable when locked out", async () => {
    mockSupabase({ tier: "basic" })
    const response = await updateSession(makeRequest("/settings/billing", "u1"))
    expect(locationOf(response)).toBeNull()
  })

  it("profile and pharmacy settings stay reachable when locked out", async () => {
    mockSupabase({ tier: "basic" })
    expect(locationOf(await updateSession(makeRequest("/settings/profile", "u1")))).toBeNull()
    expect(locationOf(await updateSession(makeRequest("/settings/pharmacy", "u1")))).toBeNull()
  })

  it("api routes stay reachable (webhooks, checkout, portal)", async () => {
    mockSupabase({ tier: "basic" })
    expect(locationOf(await updateSession(makeRequest("/api/polar/checkout", "u1")))).toBeNull()
    expect(locationOf(await updateSession(makeRequest("/api/webhooks/polar", "u1")))).toBeNull()
  })

  it("invite acceptance stays reachable when locked out", async () => {
    mockSupabase({ tier: "basic" })
    const response = await updateSession(
      makeRequest("/invite/some-token/accept", "u1"),
    )
    expect(locationOf(response)).toBeNull()
  })

  it("team settings require pro", async () => {
    mockSupabase({ tier: "basic" })
    const response = await updateSession(makeRequest("/settings/team", "u1"))
    expect(locationOf(response)).toBe("https://cdst.test/settings/billing")
  })

  it("unauthenticated users still land on login (existing behavior)", async () => {
    mockSupabase({ tier: "basic" })
    const response = await updateSession(makeRequest("/dashboard", null))
    expect(locationOf(response)).toBe("https://cdst.test/login")
  })

  it("unauthenticated users reach public pages untouched", async () => {
    mockSupabase({ tier: "basic" })
    expect(locationOf(await updateSession(makeRequest("/login", null)))).toBeNull()
    expect(locationOf(await updateSession(makeRequest("/signup", null)))).toBeNull()
  })
})
