import { Ailment } from "@/types"
import { GridTileLink } from "@/components/grid-tile-link"
import {
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"

const AILMENT_ICONS: Record<string, string> = {
  acne: "01", "allergic-rhinitis": "02", "aphthous-ulcers": "03",
  "candidal-stomatitis": "04", conjunctivitis: "05", dermatitis: "06",
  dysmenorrhea: "07", gerd: "08", hemorrhoids: "09", "herpes-labialis": "10",
  impetigo: "11", "insect-bites-urticaria": "12", musculoskeletal: "13",
  "nausea-vomiting": "14", nvp: "15", pinworms: "16",
  "tick-bites-lyme": "17", uti: "18", vvc: "19",
}

export function AilmentCard({ ailment }: { ailment: Ailment }) {
  const num = AILMENT_ICONS[ailment.slug] || "·"
  return (
    <GridTileLink href={`/assess/${ailment.slug}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold tabular-nums text-primary">
            {num}
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold leading-snug transition-colors group-hover:text-primary">
              {ailment.name}
            </CardTitle>
            <CardDescription className="mt-1 text-xs line-clamp-2">
              {ailment.rxOptions.length} Rx option{ailment.rxOptions.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
    </GridTileLink>
  )
}
