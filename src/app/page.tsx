import { AilmentGrid } from "@/components/ailment-grid"
import { PharmacySettings } from "@/components/pharmacy-settings"

export default function Home() {
  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Ontario Minor Ailments</h1>
          <p className="text-sm text-muted-foreground">Clinical Decision Support Tool — O. Reg. 256/24</p>
        </div>
        <PharmacySettings />
      </div>
      <AilmentGrid />
    </main>
  )
}
