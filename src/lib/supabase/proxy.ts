import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/forgot-password", "/reset-password"]

// Paths a non-pro pharmacy may still reach: billing itself (the paywall page),
// the settings a locked pharmacy needs to fix or learn about its account, and
// everything machine-facing. Team and signature settings require pro.
const SUBSCRIPTION_EXEMPT_PREFIXES = [
  "/invite/",
  "/api/",
]
const SUBSCRIPTION_EXEMPT_PATHS = [
  "/settings/billing",
  "/settings/profile",
  "/settings/pharmacy",
  "/settings/password",
]

/**
 * Decode the session JWT locally instead of calling supabase.auth.getUser().
 * getUser() makes a GoTrue network round trip on EVERY navigation; the sub
 * claim is already in the cookie. Signature validity is NOT checked here —
 * this value only steers redirects. Real auth is enforced downstream by
 * server components/actions calling supabase.auth.getUser(), which validates
 * against the auth server; a forged or expired token yields unusable data
 * there. This is a router, not an authorization boundary.
 */
function decodeSessionSub(request: NextRequest): string | null {
  const cookie = request.cookies
    .getAll()
    .find((c) => c.name.endsWith("-auth-token"))
    ?.value
  let jwt = cookie
  if (jwt?.startsWith("[")) {
    try {
      jwt = JSON.parse(jwt)[0]
    } catch {
      return null
    }
  }
  if (!jwt || typeof jwt !== "string") return null
  const payload = jwt.split(".")[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const claims = JSON.parse(atob(base64)) as { sub?: string; exp?: number }
    if (!claims.sub) return null
    if (claims.exp && claims.exp * 1000 < Date.now()) return null
    return claims.sub
  } catch {
    return null
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Still needed so @supabase/ssr can write refreshed session cookies.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          )
        },
      },
    },
  )

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(p + "/"),
  )
  const isSubscriptionExempt =
    SUBSCRIPTION_EXEMPT_PREFIXES.some((p) => path.startsWith(p)) ||
    SUBSCRIPTION_EXEMPT_PATHS.some((p) => path === p || path.startsWith(p + "/"))

  const needsUser = !isPublic && !isSubscriptionExempt
  let userId = needsUser ? decodeSessionSub(request) : null

  // Fallback: a missing/expired access token may still have a valid refresh
  // token. getUser() performs the refresh and rewrites the session cookies
  // (via the setAll above) — the old pre-fast-path behavior. Only the rare
  // expired/chunked-cookie case pays this round trip.
  if (needsUser && !userId) {
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }

  if (!userId && needsUser) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    const redirectResponse = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value)
    })
    return redirectResponse
  }

  // Pay-to-use gate: a pharmacy without an active subscription (tier 'pro')
  // cannot use the tool. Fails closed — an unreadable tier locks the route;
  // billing/settings/api paths stay reachable so the situation is fixable.
  if (userId && needsUser) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("pharmacy_id, pharmacies(subscription_tier)")
      .eq("id", userId)
      .single()

    const tier = (
      profile as { pharmacies?: { subscription_tier?: string } | null } | null
    )?.pharmacies?.subscription_tier

    if (tier !== "pro") {
      const url = request.nextUrl.clone()
      url.pathname = "/settings/billing"
      const redirectResponse = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value)
      })
      return redirectResponse
    }
  }

  return supabaseResponse
}
