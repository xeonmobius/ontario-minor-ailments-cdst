import { notFound } from "next/navigation"
import { getVaccineByVaccineId } from "@/lib/vaccines/catalog"
import { VaccinationWizard } from "@/components/vaccination/vaccination-wizard"
import { PageShell } from "@/components/page-shell"
import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import type { PharmacyDefaults } from "@/types"

export default async function VaccinateWizardPage({
  params,
}: {
  params: Promise<{ vaccine: string }>
}) {
  const profile = await requireAuth()
  const { vaccine: vaccineId } = await params
  const vaccine = getVaccineByVaccineId(vaccineId)

  if (!vaccine) {
    notFound()
  }

  const supabase = await createClient()

  const { data: pharmacy } = await supabase
    .from("pharmacies")
    .select("name, address, city, province, postal_code, phone, fax, accreditation_number")
    .eq("id", profile.pharmacyId)
    .single()

  const pharmacyDefaults: PharmacyDefaults | null = pharmacy
    ? {
        pharmacyName: pharmacy.name,
        address: pharmacy.address,
        city: pharmacy.city,
        province: pharmacy.province,
        postalCode: pharmacy.postal_code,
        phone: pharmacy.phone,
        fax: pharmacy.fax ?? "",
        pharmacistName: profile.fullName ?? "",
        provincialLicense: profile.provincialLicense ?? "",
        registrationNumber: pharmacy.accreditation_number ?? "",
      }
    : null

  return (
    <PageShell>
      <VaccinationWizard vaccine={vaccine} pharmacy={pharmacyDefaults} />
    </PageShell>
  )
}
