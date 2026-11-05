import { requireAuth } from "@/lib/auth-guards"
import { getSignatureAction } from "@/lib/signature-actions"
import { PageShell } from "@/components/page-shell"
import { SignatureForm } from "./signature-form"

export default async function SignatureSettingsPage() {
  const profile = await requireAuth()
  const enrolled = await getSignatureAction()

  return (
    <PageShell title="My Signature">
      <SignatureForm
        enrolled={enrolled}
        pharmacistName={profile.fullName ?? ""}
        license={profile.provincialLicense ?? null}
      />
    </PageShell>
  )
}
