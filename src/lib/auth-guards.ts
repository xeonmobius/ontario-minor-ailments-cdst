import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import type { Profile, PharmacyMemberRole } from "@/types"

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from("profiles")
    .select("id, pharmacy_id, is_platform_admin, full_name, email, province, provincial_license, created_at")
    .eq("id", user.id)
    .single()

  if (!data) return null

  let activeRole: PharmacyMemberRole | null = null
  if (data.pharmacy_id) {
    const { data: membership } = await supabase
      .from("pharmacy_members")
      .select("role")
      .eq("user_id", data.id)
      .eq("pharmacy_id", data.pharmacy_id)
      .eq("is_active", true)
      .single()
    activeRole = membership?.role as PharmacyMemberRole ?? null
  }

  return {
    id: data.id,
    pharmacyId: data.pharmacy_id,
    activeRole,
    isPlatformAdmin: data.is_platform_admin,
    fullName: data.full_name,
    email: data.email,
    province: data.province,
    provincialLicense: data.provincial_license,
    createdAt: data.created_at,
  }
}

export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile()
  if (!profile) redirect("/login")
  return profile
}

export async function requireRole(...roles: PharmacyMemberRole[]): Promise<Profile> {
  const profile = await requireAuth()
  if (profile.isPlatformAdmin) return profile
  if (!profile.activeRole || !roles.includes(profile.activeRole)) redirect("/")
  return profile
}

export async function requirePlatformAdmin(): Promise<Profile> {
  const profile = await requireAuth()
  if (!profile.isPlatformAdmin) redirect("/")
  return profile
}
