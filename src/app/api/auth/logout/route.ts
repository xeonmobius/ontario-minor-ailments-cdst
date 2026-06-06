import { createRouteHandlerClient } from "@/lib/supabase/route-handler"
import { NextResponse } from "next/server"

export async function POST() {
  const { supabase, getResponseWithCookies } = await createRouteHandlerClient()

  await supabase.auth.signOut()

  const cookieResponse = getResponseWithCookies()
  const response = NextResponse.json({ success: true })

  if (cookieResponse) {
    cookieResponse.cookies.getAll().forEach((c) => {
      response.cookies.set(c.name, c.value, c as any)
    })
  }

  return response
}