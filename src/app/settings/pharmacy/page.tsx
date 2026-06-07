import { requireRole } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { BackButton } from "@/components/back-button"
import { PharmacyForm } from "./pharmacy-form"

export default async function PharmacySettingsPage() {
  const profile = await requireRole("owner")
  const supabase = await createClient()

  const { data: pharmacy } = await supabase
    .from("pharmacies")
    .select("id, name, address, city, province, postal_code, phone, fax, accreditation_number")
    .eq("id", profile.pharmacyId)
    .single()

  if (!pharmacy) {
    return <p className="p-6">Pharmacy not found.</p>
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <BackButton />
          <h1 className="text-lg font-bold tracking-tight">Pharmacy Settings</h1>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <PharmacyForm pharmacy={pharmacy} />
      </main>
    </div>
  )
}
