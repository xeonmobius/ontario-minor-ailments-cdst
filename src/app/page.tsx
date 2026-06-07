import { AilmentGrid } from "@/components/ailment-grid"
import { UserNav } from "@/components/user-nav"
import { PharmacyBadge } from "@/components/pharmacy-badge"
import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import type { PharmacyMember } from "@/types"

export default async function Home() {
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

    memberships = (memberData ?? []).map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      pharmacyId: row.pharmacy_id,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
      pharmacyName: row.pharmacies?.name,
    }))
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm tracking-tight">
              Rx
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">Ontario Minor Ailments</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Clinical Decision Support Tool — O. Reg. 256/24</p>
            </div>
          </div>
          <UserNav profile={profile} />
          <PharmacyBadge pharmacyName={pharmacyName} pharmacyId={profile.pharmacyId} memberships={memberships} />
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <AilmentGrid />
      </main>
      <footer className="border-t mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-muted-foreground">
          Ontario Minor Ailment Prescribing per O. Reg. 256/24 — For pharmacist use only
        </div>
      </footer>
    </div>
  )
}
