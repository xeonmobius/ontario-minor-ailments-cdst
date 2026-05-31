"use client"

import { ailments } from "@/lib/ailments"
import { AilmentCard } from "@/components/ailment-card"

export function AilmentGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {ailments.map((a) => (
        <AilmentCard key={a.id} ailment={a} />
      ))}
    </div>
  )
}
