import { notFound } from "next/navigation"
import Link from "next/link"
import { getAilmentBySlug } from "@/lib/ailments"
import { WizardContainer } from "@/components/wizard/wizard-container"

export default async function AssessPage({
  params,
}: {
  params: Promise<{ ailment: string }>
}) {
  const { ailment: slug } = await params
  const ailment = getAilmentBySlug(slug)

  if (!ailment) {
    notFound()
  }

  return (
    <main className="min-h-screen p-6 max-w-3xl mx-auto">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block"
      >
        &larr; Back to ailments
      </Link>
      <WizardContainer ailment={ailment} />
    </main>
  )
}
