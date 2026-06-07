import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  const { pharmacyId } = await req.json()
  if (!pharmacyId) return NextResponse.json({ error: "Missing pharmacyId" }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: membership } = await supabase
    .from("pharmacy_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("pharmacy_id", pharmacyId)
    .eq("is_active", true)
    .single()

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this pharmacy" }, { status: 403 })
  }

  await supabase
    .from("profiles")
    .update({ pharmacy_id: pharmacyId })
    .eq("id", user.id)

  return NextResponse.json({ success: true })
}
