import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { BackButton } from "@/components/back-button"
import { ProfileForm } from "./profile-form"

export default async function ProfileSettingsPage() {
  const profile = await requireAuth()
  const supabase = await createClient()

  const { data } = await supabase
    .from("profiles")
    .select("full_name, provincial_license, province, registration_number")
    .eq("id", profile.id)
    .single()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <BackButton />
          <h1 className="text-lg font-bold tracking-tight">Profile Settings</h1>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <ProfileForm defaults={data} userId={profile.id} />
      </main>
    </div>
  )
}
