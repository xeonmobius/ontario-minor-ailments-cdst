import { createRouteHandlerClient } from "@/lib/supabase/route-handler"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const { email, password } = await request.json()
  const { supabase, getResponseWithCookies } = await createRouteHandlerClient()

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const cookieResponse = getResponseWithCookies()
  const response = NextResponse.json({ success: true })

  if (cookieResponse) {
    cookieResponse.cookies.getAll().forEach((c) => {
      response.cookies.set(c.name, c.value, {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
        secure: false,
      })
    })
  }

  return response
}