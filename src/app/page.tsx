import { AilmentGrid } from "@/components/ailment-grid"
import { VaccinationEntry } from "@/components/vaccination-entry"
import { AppShell } from "@/components/app-shell"
import { loadPharmacyContext } from "@/lib/pharmacy-context"

export default async function Home() {
  const { profile, pharmacyName, memberships } = await loadPharmacyContext()

  return (
    <AppShell
      title="Ontario Minor Ailments"
      subtitle="Clinical Decision Support Tool"
      leading={
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold tracking-tight text-primary-foreground">
          Rx
        </div>
      }
      footer="Ontario Minor Ailment Prescribing — For pharmacist use only"
      profile={profile}
      pharmacyName={pharmacyName}
      memberships={memberships}
    >
      <AilmentGrid />
      <div className="mt-8">
        <VaccinationEntry />
      </div>
    </AppShell>
  )
}
