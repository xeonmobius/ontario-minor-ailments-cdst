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
  redirect: vi.fn(),
}))

import { signupWithInvite } from "@/lib/auth-actions"
import { createClient } from "@/lib/supabase/server"

// Invitations are no longer directly readable (RLS lockdown, critical fix 3):
// the action must go through the validate_invitation / accept_invitation
// SECURITY DEFINER RPCs. The pharmacy_members insert must also precede the
// profiles upsert, because the profiles privilege guard (critical fix 2)
// only allows pharmacy_id when an active membership already exists.

const VALID_INVITE: {
  pharmacy_id: string
  email: string
  expires_at: string
  accepted_at: string | null
} = {
  pharmacy_id: "ph-invite-1",
  email: "newdoc@pharmacy.ca",
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
  accepted_at: null,
}

function mockSupabase(opts: {
  validateData?: typeof VALID_INVITE | null
  validateError?: string | null
  signUpUser?: string | null
  acceptData?: string | null
}) {
  const calls: string[] = []

  const supabase = {
    rpc: vi.fn((fn: string, params: Record<string, unknown>) => {
      if (fn === "validate_invitation") {
        return {
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: opts.validateError ? null : (opts.validateData ?? null),
              error: opts.validateError
                ? { message: opts.validateError }
                : null,
            }),
          ),
        }
      }
      if (fn === "accept_invitation") {
        calls.push(`accept:${params.p_token}:${params.p_email}`)
        return Promise.resolve({ data: opts.acceptData ?? "accepted", error: null })
      }
      throw new Error(`unexpected rpc ${fn}`)
    }),
    from: vi.fn((table: string) => {
      calls.push(`from:${table}`)
      if (table === "pharmacy_members") {
        return {
          insert: vi.fn(() => {
            calls.push("insert:pharmacy_members")
            return Promise.resolve({ error: null })
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        }
      }
      if (table === "profiles") {
        return {
          upsert: vi.fn(() => {
            calls.push("upsert:profiles")
            return Promise.resolve({ error: null })
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
        }
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
      }
    }),
    auth: {
      signUp: vi.fn().mockResolvedValue({
        data: { user: opts.signUpUser === null ? null : { id: "u-new" } },
        error: null,
      }),
    },
  }
  vi.mocked(createClient).mockResolvedValue(supabase as never)
  return { supabase, calls }
}

function buildForm(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.set("email", "newdoc@pharmacy.ca")
  fd.set("password", "correct-horse-1")
  fd.set("fullName", "New Doc")
  fd.set("provincialLicense", "123456")
  fd.set("province", "Ontario")
  fd.set("token", "tok_abc123")
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

describe("signupWithInvite — RPC-based acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("validates the token through validate_invitation, not the table", async () => {
    const { supabase, calls } = mockSupabase({ validateData: VALID_INVITE })

    const result = await signupWithInvite(buildForm())

    expect(result).toEqual({ success: true })
    expect(supabase.rpc).toHaveBeenCalledWith("validate_invitation", {
      p_token: "tok_abc123",
    })
    expect(calls.some((c) => c.startsWith("from:invitations"))).toBe(false)
  })

  it("rejects an unknown token", async () => {
    mockSupabase({ validateData: null })

    const result = await signupWithInvite(buildForm())

    expect(result).toEqual({ error: "Invalid or expired invitation." })
  })

  it("rejects a used invitation", async () => {
    mockSupabase({
      validateData: { ...VALID_INVITE, accepted_at: new Date().toISOString() },
    })

    const result = await signupWithInvite(buildForm())

    expect(result).toEqual({ error: "This invitation has already been used." })
  })

  it("rejects an expired invitation", async () => {
    mockSupabase({
      validateData: {
        ...VALID_INVITE,
        expires_at: new Date(Date.now() - 86400_000).toISOString(),
      },
    })

    const result = await signupWithInvite(buildForm())

    expect(result).toEqual({ error: "This invitation has expired." })
  })

  it("rejects an email mismatch before creating any account", async () => {
    mockSupabase({ validateData: VALID_INVITE })

    const result = await signupWithInvite(
      buildForm({ email: "other@pharmacy.ca" }),
    )

    expect(result).toEqual({ error: "Email does not match the invitation." })
  })

  it("accepts through accept_invitation, membership before profile", async () => {
    const { supabase, calls } = mockSupabase({ validateData: VALID_INVITE })

    await signupWithInvite(buildForm())

    expect(calls.indexOf("insert:pharmacy_members")).toBeGreaterThan(-1)
    expect(calls.indexOf("upsert:profiles")).toBeGreaterThan(
      calls.indexOf("insert:pharmacy_members"),
    )
    expect(supabase.rpc).toHaveBeenCalledWith("accept_invitation", {
      p_token: "tok_abc123",
      p_email: "newdoc@pharmacy.ca",
    })
  })
})
