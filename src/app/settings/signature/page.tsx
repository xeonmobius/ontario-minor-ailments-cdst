import { requireAuth } from "@/lib/auth-guards"
import { BackButton } from "@/components/back-button"
import { getSignatureAction } from "@/lib/signature-actions"
import { SignatureForm } from "./signature-form"

export default async function SignatureSettingsPage() {
  const profile = await requireAuth()
  const enrolled = await getSignatureAction()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <BackButton />
          <h1 className="text-lg font-bold tracking-tight">My Signature</h1>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <SignatureForm
          enrolled={enrolled}
          pharmacistName={profile.fullName ?? ""}
          license={profile.provincialLicense ?? null}
        />
      </main>
    </div>
  )
}
