import ailmentsData from "../../data/ailments.json"
import { Ailment } from "@/types"

export const ailments: Ailment[] = ailmentsData as Ailment[]

export function getAilmentBySlug(slug: string): Ailment | undefined {
  return ailments.find(a => a.slug === slug)
}
