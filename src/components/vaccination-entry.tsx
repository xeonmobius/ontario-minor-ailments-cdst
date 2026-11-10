import { Syringe } from "lucide-react"
import { GridTileLink } from "@/components/grid-tile-link"

// Dashboard entry to the vaccination workflow (roadmap #22). A first-class
// surface alongside <AilmentGrid/> so vaccination is a parallel clinical path.
export function VaccinationEntry() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Vaccinations</h2>
      </div>
      <GridTileLink href="/vaccinate" className="flex-row items-center gap-4 p-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Syringe className="size-5" />
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold leading-tight transition-colors group-hover:text-primary">
            Administer a vaccine
          </span>
          <span className="text-xs text-muted-foreground">
            Contraindication screen, lot/expiry capture, consent &amp; record — influenza, COVID-19,
            shingles, Tdap and more.
          </span>
        </div>
        <span className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
          Start →
        </span>
      </GridTileLink>
    </section>
  )
}
