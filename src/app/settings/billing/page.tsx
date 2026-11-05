import { requireAuth } from "@/lib/auth-guards"
import { createClient } from "@/lib/supabase/server"
import { PageShell } from "@/components/page-shell"
import { Card, CardContent } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const metadata = { title: "Billing — CDST" }

const PRICE_LINE = "CAD $25/month — flat, unlimited pharmacists, cancel anytime."

function TierBadge({ tier, status }: { tier: string; status: string }) {
  const isPro = tier === "pro"
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
        isPro ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {isPro ? "Pro" : "No subscription"}
      {isPro && status !== "active" ? ` (${status})` : ""}
    </span>
  )
}

export default async function BillingPage() {
  const profile = await requireAuth()
  const supabase = await createClient()

  const { data: pharmacy } = profile.pharmacyId
    ? await supabase
        .from("pharmacies")
        .select("name, subscription_tier, subscription_status")
        .eq("id", profile.pharmacyId)
        .single()
    : { data: null }

  if (!pharmacy) {
    return (
      <PageShell title="Billing">
        <p>No active pharmacy. Create one under Pharmacy settings first.</p>
      </PageShell>
    )
  }

  const isOwner = profile.activeRole === "owner"
  const isPro = pharmacy.subscription_tier === "pro"

  return (
    <PageShell title="Billing" mainClassName="space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Subscription for</p>
              <p className="font-semibold">{pharmacy.name}</p>
            </div>
            <TierBadge
              tier={pharmacy.subscription_tier}
              status={pharmacy.subscription_status}
            />
          </div>

          {!isPro && (
            <p className="text-sm text-muted-foreground">
              {PRICE_LINE} Until this pharmacy subscribes, its team cannot use the
              clinical tool. Your data is safe and unlocks the moment the
              subscription starts.
            </p>
          )}
          {isPro && (
            <p className="text-sm text-muted-foreground">{PRICE_LINE}</p>
          )}

          {isOwner ? (
            isPro ? (
              <a
                href="/api/polar/portal"
                className={cn(buttonVariants({ size: "lg" }))}
              >
                Manage subscription
              </a>
            ) : (
              <a
                href={`/api/polar/checkout?pharmacy=${encodeURIComponent(profile.pharmacyId ?? "")}`}
                className={cn(buttonVariants({ size: "lg" }))}
              >
                Upgrade to Pro
              </a>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Billing is managed by the pharmacy owner.
            </p>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
