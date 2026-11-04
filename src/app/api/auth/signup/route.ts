import { createRouteHandlerClient } from "@/lib/supabase/route-handler"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const body = await request.json()
  const { email, password, fullName, pharmacyName, address, city, postalCode, phone, fax } = body

  const { supabase, getResponseWithCookies } = await createRouteHandlerClient()

  const { error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: "owner",
        pharmacy_name: pharmacyName,
        address,
        city,
        province: "Ontario",
        postal_code: postalCode,
        phone,
        fax: fax ?? null,
      },
    },
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const cookieResponse = getResponseWithCookies()
  if (!cookieResponse) {
    return NextResponse.json({ success: true })
  }

  const response = NextResponse.json({ success: true })
  cookieResponse.cookies.getAll().forEach((c) => {
    response.cookies.set(c.name, c.value, c)
  })
  return response
}