import { Ailment } from "@/types"
import Link from "next/link"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

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
    <Link href={`/assess/${ailment.slug}`} className="group">
      <Card className={cn(
        "h-full transition-all duration-200 hover:shadow-md hover:border-primary/30",
        "hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring"
      )}>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <span className="flex-shrink-0 inline-flex items-center justify-center size-8 rounded-md bg-primary/10 text-primary text-xs font-bold tabular-nums">
              {num}
            </span>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-sm font-semibold leading-snug group-hover:text-primary transition-colors">
                {ailment.name}
              </CardTitle>
              <CardDescription className="text-xs mt-1 line-clamp-2">
                {ailment.rxOptions.length} Rx option{ailment.rxOptions.length !== 1 ? "s" : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  )
}
