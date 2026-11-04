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

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some(
    (p) => path === p || path.startsWith(p + "/"),
  )
  const isSubscriptionExempt =
    SUBSCRIPTION_EXEMPT_PREFIXES.some((p) => path.startsWith(p)) ||
    SUBSCRIPTION_EXEMPT_PATHS.some((p) => path === p || path.startsWith(p + "/"))

  if (!user && !isPublic && !isSubscriptionExempt) {
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
  if (user && !isPublic && !isSubscriptionExempt) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("pharmacy_id, pharmacies(subscription_tier)")
      .eq("id", user.id)
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
