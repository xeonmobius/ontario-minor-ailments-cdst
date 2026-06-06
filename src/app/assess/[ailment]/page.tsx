import { notFound } from "next/navigation"
import { getAilmentBySlug } from "@/lib/ailments"
import { WizardContainer } from "@/components/wizard/wizard-container"
import { BackButton } from "@/components/back-button"
import { requireAuth } from "@/lib/auth-guards"

export default async function AssessPage({
  params,
}: {
  params: Promise<{ ailment: string }>
}) {
  await requireAuth()
  const { ailment: slug } = await params
  const ailment = getAilmentBySlug(slug)

  if (!ailment) {
    notFound()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-3">
          <BackButton />
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
        <WizardContainer ailment={ailment} />
      </main>
    </div>
  )
}
