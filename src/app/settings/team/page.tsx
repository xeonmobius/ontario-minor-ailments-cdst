import { requireRole } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { BackButton } from "@/components/back-button"
import { InviteForm } from "./invite-form"
import { TeamList } from "./team-list"

export default async function TeamPage() {
  const profile = await requireRole("owner")
  const supabase = await createClient()

  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("pharmacy_id", profile.pharmacyId)

  const { data: invitations } = await supabase
    .from("invitations")
    .select("id, email, created_at, expires_at, accepted_at")
    .eq("pharmacy_id", profile.pharmacyId)
    .is("accepted_at", null)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <BackButton />
          <h1 className="text-lg font-bold tracking-tight">Manage Team</h1>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 space-y-8">
        <InviteForm />
        <TeamList members={members ?? []} invitations={invitations ?? []} />
      </main>
    </div>
  )
}
