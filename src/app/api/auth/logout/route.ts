import { createRouteHandlerClient } from "@/lib/supabase/route-handler"
import { NextResponse } from "next/server"

export async function POST() {
  const { supabase, getResponseWithCookies } = await createRouteHandlerClient()

  await supabase.auth.signOut()

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