import { notFound } from "next/navigation"
import { getAilmentBySlug } from "@/lib/ailments"
import { WizardContainer } from "@/components/wizard/wizard-container"
import { BackButton } from "@/components/back-button"
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

  // Pharmacist e-signature credential (roadmap #11). Phase-1 no-op stub returns
  // null; the panel then offers a one-time inline capture. The pharmacist
  // identity is already bound to the authenticated profile (§2.2).
  const enrolledSignature = await getSignatureAction()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <BackButton />
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <WizardContainer ailment={ailment} pharmacy={pharmacyDefaults} enrolledSignature={enrolledSignature} />
      </main>
    </div>
  )
}
