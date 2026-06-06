import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import type { Profile, UserRole } from "@/types"

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from("profiles")
    .select("id, pharmacy_id, role, full_name, email, province, provincial_license, registration_number, created_at")
    .eq("id", user.id)
    .single()

  if (!data) return null

  return {
    id: data.id,
    pharmacyId: data.pharmacy_id,
    role: data.role as UserRole,
    fullName: data.full_name,
    email: data.email,
    province: data.province,
    provincialLicense: data.provincial_license,
    registrationNumber: data.registration_number,
    createdAt: data.created_at,
  }
}

export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) redirect("/login")
  return profile
}

export async function requireRole(...roles: UserRole[]): Promise<Profile> {
  const profile = await requireAuth()
  if (!roles.includes(profile.role)) redirect("/")
  return profile
}
