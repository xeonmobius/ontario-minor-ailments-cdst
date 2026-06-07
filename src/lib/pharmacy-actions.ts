"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"
import type { PharmacyMember } from "@/types"

const TIER_LIMITS: Record<string, number> = {
  basic: 1,
  pro: 5,
  enterprise: Infinity,
}

export async function getUserPharmacies(): Promise<PharmacyMember[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("pharmacy_members")
    .select("id, user_id, pharmacy_id, role, is_active, created_at, pharmacies(name)")
    .eq("user_id", user.id)
    .eq("is_active", true)

  return (data ?? []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    pharmacyId: row.pharmacy_id,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    pharmacyName: row.pharmacies?.name,
  }))
}

export async function switchPharmacy(pharmacyId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: membership } = await supabase
    .from("pharmacy_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("pharmacy_id", pharmacyId)
    .eq("is_active", true)
    .single()

  if (!membership) {
    return { error: "You are not a member of this pharmacy." }
  }

  await supabase
    .from("profiles")
    .update({ pharmacy_id: pharmacyId })
    .eq("id", user.id)

  await logAuditEvent("pharmacy.switched", { pharmacy_id: pharmacyId })
  revalidatePath("/", "layout")
  redirect("/")
}

export async function addPharmacy(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { count } = await supabase
    .from("pharmacy_members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("role", "owner")
    .eq("is_active", true)

  const tier = (formData.get("tier") as string) || "basic"
  const limit = TIER_LIMITS[tier] ?? 1
  if ((count ?? 0) >= limit) {
    return { error: `Your plan allows ${limit} pharmacies. Upgrade to add more.` }
  }

  const name = formData.get("name") as string
  const address = formData.get("address") as string
  const city = formData.get("city") as string
  const province = formData.get("province") as string
  const postalCode = formData.get("postalCode") as string
  const phone = formData.get("phone") as string
  const fax = (formData.get("fax") as string) || null
  const accreditationNumber = (formData.get("accreditationNumber") as string) || null

  const { data: newPharmacy, error } = await supabase
    .from("pharmacies")
    .insert({
      name,
      address,
      city,
      province,
      postal_code: postalCode,
      phone,
      fax,
      accreditation_number: accreditationNumber,
      created_by: user.id,
      subscription_status: "active",
      subscription_tier: "basic",
      seats: 5,
    })
    .select("id")
    .single()

  if (error || !newPharmacy) {
    return { error: error?.message || "Failed to create pharmacy." }
  }

  await supabase.from("pharmacy_members").insert({
    user_id: user.id,
    pharmacy_id: newPharmacy.id,
    role: "owner",
  })

  await supabase
    .from("profiles")
    .update({ pharmacy_id: newPharmacy.id })
    .eq("id", user.id)

  await logAuditEvent("pharmacy.created", { pharmacy_id: newPharmacy.id, pharmacy_name: name })
  revalidatePath("/", "layout")
  redirect("/")
}

export async function leavePharmacy(pharmacyId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: "Not authenticated" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("pharmacy_id")
    .eq("id", user.id)
    .single()

  await supabase
    .from("pharmacy_members")
    .update({ is_active: false })
    .eq("user_id", user.id)
    .eq("pharmacy_id", pharmacyId)

  if (profile?.pharmacy_id === pharmacyId) {
    const { data: remaining } = await supabase
      .from("pharmacy_members")
      .select("pharmacy_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .single()

    await supabase
      .from("profiles")
      .update({ pharmacy_id: remaining?.pharmacy_id ?? null })
      .eq("id", user.id)
  }

  await logAuditEvent("pharmacy.left", { pharmacy_id: pharmacyId })
  revalidatePath("/", "layout")
  redirect("/")
}
