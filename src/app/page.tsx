import { AilmentGrid } from "@/components/ailment-grid"
import { UserNav } from "@/components/user-nav"
import { requireAuth } from "@/lib/auth-guards"

export default async function Home() {
  const profile = await requireAuth()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm tracking-tight">
              Rx
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight leading-none">Ontario Minor Ailments</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Clinical Decision Support Tool — O. Reg. 256/24</p>
            </div>
          </div>
          <UserNav profile={profile} />
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <AilmentGrid />
      </main>
      <footer className="border-t mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-muted-foreground">
          Ontario Minor Ailment Prescribing per O. Reg. 256/24 — For pharmacist use only
        </div>
      </footer>
    </div>
  )
}
