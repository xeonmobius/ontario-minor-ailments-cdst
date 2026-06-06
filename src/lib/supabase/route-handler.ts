import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

export async function createRouteHandlerClient() {
  const cookieStore = await cookies()
  let responseToMutate: NextResponse | null = null

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet, _headers) {
          if (!responseToMutate) {
            responseToMutate = new NextResponse()
          }
          cookiesToSet.forEach(({ name, value, options }) => {
            responseToMutate!.cookies.set(name, value, options)
          })
        },
      },
    },
  )

  return { supabase, getResponseWithCookies: () => responseToMutate }
}
