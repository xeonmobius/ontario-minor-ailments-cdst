import Link from "next/link"
import { VACCINES } from "@/lib/vaccines/catalog"
import { AppShell } from "@/components/app-shell"
import { GridTileLink } from "@/components/grid-tile-link"
import { BackButton } from "@/components/back-button"
import { loadPharmacyContext } from "@/lib/pharmacy-context"

export default async function VaccinatePickerPage() {
  const { profile, pharmacyName, memberships } = await loadPharmacyContext()

  return (
    <AppShell
      title="Vaccinations"
      subtitle="Pharmacist injecting-agent authority — Ontario"
      leading={<BackButton />}
      footer="Vaccination Administration — Ontario pharmacist injecting-agent authority"
      profile={profile}
      pharmacyName={pharmacyName}
      memberships={memberships}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {VACCINES.map((v) => (
          <GridTileLink key={v.vaccineId} href={`/vaccinate/${v.vaccineId}`}>
            <div className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold leading-tight transition-colors group-hover:text-primary">
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
            </div>
          </GridTileLink>
        ))}
      </div>
    </AppShell>
  )
}
