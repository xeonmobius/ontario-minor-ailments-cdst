import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createPolar, type Environment } from "@polar-sh/sdk/2026-10"
import { polarEnvironment, polarSiteUrl } from "@/lib/polar/config"

// Server-side checkout creation. Everything identifying (who pays, which
// pharmacy) comes from the session, never the query string — the only client
// input is an optional pharmacy id, which must be one the caller OWNS.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const accessToken = process.env.POLAR_ACCESS_TOKEN
  const productId = process.env.POLAR_PRODUCT_PRO_ID
  if (!accessToken || !productId) {
    return NextResponse.json(
      { error: "Billing is not configured (missing POLAR_ACCESS_TOKEN or POLAR_PRODUCT_PRO_ID)." },
      { status: 503 },
    )
  }

  const requested = new URL(request.url).searchParams.get("pharmacy")
  let pharmacyId = requested
  if (pharmacyId) {
    const { data: membership } = await supabase
      .from("pharmacy_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("pharmacy_id", pharmacyId)
      .eq("role", "owner")
      .eq("is_active", true)
      .maybeSingle()
    if (!membership) {
      return NextResponse.json(
        { error: "Only the pharmacy owner can start its subscription." },
        { status: 403 },
      )
    }
  } else {
    const { data: profile } = await supabase
      .from("profiles")
      .select("pharmacy_id")
      .eq("id", user.id)
      .single()
    pharmacyId = profile?.pharmacy_id
  }

  if (!pharmacyId) {
    return NextResponse.json({ error: "No active pharmacy." }, { status: 400 })
  }

  try {
    const polar = createPolar({
      accessToken,
      environment: polarEnvironment() as Environment,
    })
    const checkout = await polar.checkouts.create({
      products: [productId],
      success_url: `${polarSiteUrl()}/settings/billing`,
      external_customer_id: user.id,
      customer_email: user.email,
      metadata: { pharmacy_id: pharmacyId },
    })
    return NextResponse.redirect(checkout.url, { status: 303 })
  } catch (error) {
    console.error("polar checkout create failed:", error)
    return NextResponse.json(
      { error: "Could not start checkout. Try again." },
      { status: 502 },
    )
  }
}
