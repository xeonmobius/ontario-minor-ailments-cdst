import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The single path Polar subscription events take into the database. Runs on
 * the service-role admin client — the pharmacies.subscription_tier trigger
 * rejects every other role. See docs/adr/0001-per-pharmacy-billing.md.
 *
 * Event mapping (the decided model):
 * - subscription.active / subscription.updated with a matching product → 'pro'.
 *   'updated' only ever upgrades: a mere update never strips a tier.
 * - subscription.revoked (cancellation reaching period end, or failed
 *   payment) → 'basic' — the hard lock. Data is intact; resubscribing
 *   restores.
 * - Everything else (canceled, uncanceled, past_due, cycled, paused, …) is a
 *   no-op: access runs until the paid-for period ends.
 * - Events for products other than POLAR_PRODUCT_PRO_ID never touch the tier
 *   (future products must not clobber pro rows).
 */

type PolarSubscriptionData = {
  product_id?: string
  metadata?: Record<string, string> | null
  customer?: { external_id?: string | null } | null
}

type SyncAdminClient = SupabaseClient

export type SyncResult = "pro" | "basic" | "noop"

async function resolvePharmacyId(
  admin: SyncAdminClient,
  data: PolarSubscriptionData,
): Promise<string | null> {
  const fromMetadata = data.metadata?.pharmacy_id
  if (fromMetadata) return fromMetadata

  // Fallback for checkouts where metadata was lost: the checkout stamped the
  // owner's Supabase user id as the Polar customer's external_id, so resolve
  // to their most recently created owned pharmacy.
  const externalId = data.customer?.external_id
  if (!externalId) return null

  const { data: membership } = await admin
    .from("pharmacy_members")
    .select("pharmacy_id")
    .eq("user_id", externalId)
    .eq("role", "owner")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return membership?.pharmacy_id ?? null
}

export async function syncSubscription(
  admin: SyncAdminClient,
  eventType: string,
  data: PolarSubscriptionData,
): Promise<SyncResult> {
  const productMatch =
    !!data.product_id && data.product_id === process.env.POLAR_PRODUCT_PRO_ID

  let tier: "pro" | "basic" | null = null
  // subscription.created is Polar's initial activation event (the checkout's
  // immediate aftermath); active/updated cover resume + plan changes. All
  // three upgrade; only revoked downgrades.
  if (productMatch && ["subscription.created", "subscription.active", "subscription.updated"].includes(eventType)) {
    tier = "pro"
  }
  if (eventType === "subscription.revoked") tier = "basic"

  if (!tier) return "noop"

  const pharmacyId = await resolvePharmacyId(admin, data)
  if (!pharmacyId) return "noop"

  const { error } = await admin
    .from("pharmacies")
    .update({ subscription_tier: tier })
    .eq("id", pharmacyId)

  if (error) {
    // Never throw out of a webhook handler — Polar retries on thrown errors,
    // and a rejected tier write is a permanent condition (wrong role), not a
    // transient delivery failure.
    console.error(`polar sync: tier write failed for ${pharmacyId}:`, error.message)
    return "noop"
  }

  return tier
}
