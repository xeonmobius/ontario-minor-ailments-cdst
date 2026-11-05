import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/auth-guards"
import type { PharmacyMember } from "@/types"

/**
 * Shared loader for AppShell surfaces: the active profile plus the session
 * user's active pharmacy memberships (drives the PharmacyBadge switcher).
 */
export async function loadPharmacyContext(): Promise<{
  profile: Awaited<ReturnType<typeof requireAuth>>
  pharmacyName: string | null
  memberships: PharmacyMember[]
}> {
  const profile = await requireAuth()
  const supabase = await createClient()

  let pharmacyName: string | null = null
  let memberships: PharmacyMember[] = []

  if (profile.pharmacyId) {
    const { data: pharm } = await supabase
      .from("pharmacies")
      .select("name")
      .eq("id", profile.pharmacyId)
      .single()
    pharmacyName = pharm?.name ?? null

    const { data: memberData } = await supabase
      .from("pharmacy_members")
      .select("id, user_id, pharmacy_id, role, is_active, created_at, pharmacies(name)")
      .eq("user_id", profile.id)
      .eq("is_active", true)

    memberships = (memberData ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      userId: String(row.user_id),
      pharmacyId: String(row.pharmacy_id),
      role: row.role as PharmacyMember["role"],
      isActive: Boolean(row.is_active),
      createdAt: String(row.created_at),
      pharmacyName: (row.pharmacies as { name?: string } | null)?.name,
    }))
  }

  return { profile, pharmacyName, memberships }
}
