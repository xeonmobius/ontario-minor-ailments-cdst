import Link from "next/link"
import { VACCINES } from "@/lib/vaccines/catalog"
import { UserNav } from "@/components/user-nav"
import { PharmacyBadge } from "@/components/pharmacy-badge"
import { BackButton } from "@/components/back-button"
import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import type { PharmacyMember } from "@/types"

export default async function VaccinatePickerPage() {
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

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">Vaccinations</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pharmacist injecting-agent authority — Ontario
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PharmacyBadge pharmacyName={pharmacyName} pharmacyId={profile.pharmacyId} memberships={memberships} />
            <UserNav profile={profile} />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {VACCINES.map((v) => (
            <Link
              key={v.vaccineId}
              href={`/vaccinate/${v.vaccineId}`}
              className="group flex flex-col gap-2 rounded-lg border border-input bg-card p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold leading-tight group-hover:text-primary">
                  {v.name}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {v.defaultRoute} · {v.doseVolume}
                </span>
                {v.seriesTotal > 1 && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {v.seriesTotal}-dose series
                  </span>
                )}
                {v.fundedOntario && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    Funded
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </main>
      <footer className="border-t mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-muted-foreground">
          Vaccination Administration — Ontario pharmacist injecting-agent authority
        </div>
      </footer>
    </div>
  )
}
