import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { PageShell } from "@/components/page-shell"
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
    <PageShell title="Profile Settings">
      <ProfileForm defaults={data} userId={profile.id} currentEmail={profile.email ?? ""} />
    </PageShell>
  )
}
