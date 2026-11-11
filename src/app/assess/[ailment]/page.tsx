import { notFound } from "next/navigation"
import { getAilmentBySlug } from "@/lib/ailments"
import { WizardContainer } from "@/components/wizard/wizard-container"
import { PageShell } from "@/components/page-shell"
import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { getSignatureAction } from "@/lib/signature-actions"
import type { PharmacyDefaults } from "@/types"

export default async function AssessPage({
  params,
}: {
  params: Promise<{ ailment: string }>
}) {
  const profile = await requireAuth()
  const { ailment: slug } = await params
  const ailment = getAilmentBySlug(slug)

  if (!ailment) {
    notFound()
  }

  const supabase = await createClient()

  // Pharmacy row and signature credential are independent — fetch in
  // parallel (each is a network round trip to Supabase).
  const [{ data: pharmacy }, enrolledSignature] = await Promise.all([
    supabase
      .from("pharmacies")
      .select("name, address, city, province, postal_code, phone, fax, accreditation_number")
      .eq("id", profile.pharmacyId)
      .single(),
    getSignatureAction(),
  ])

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
      <WizardContainer ailment={ailment} pharmacy={pharmacyDefaults} enrolledSignature={enrolledSignature} />
    </PageShell>
  )
}
