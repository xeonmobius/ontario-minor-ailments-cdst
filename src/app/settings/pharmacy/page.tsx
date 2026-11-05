import { requireRole } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { PageShell } from "@/components/page-shell"
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
    return (
      <PageShell title="Pharmacy Settings">
        <p>Pharmacy not found.</p>
      </PageShell>
    )
  }

  return (
    <PageShell title="Pharmacy Settings">
      <PharmacyForm pharmacy={pharmacy} />
    </PageShell>
  )
}
