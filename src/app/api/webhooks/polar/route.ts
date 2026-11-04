import { Webhooks } from "@polar-sh/nextjs"
import { createAdminClient } from "@/lib/supabase/admin"
import { syncSubscription } from "@/lib/polar/sync-subscription"

// Signature verification (webhook-id / webhook-timestamp / webhook-signature
// headers → 403 on mismatch) is the adapter's job. /api/* is exempt from the
// auth middleware, so this secret is the route's only authz — keep it that
// way. Unknown signed event types are acknowledged (200) and ignored; a
// throwing handler makes Polar retry, which syncSubscription avoids by
// reporting failed tier writes instead of throwing.
export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onPayload: async (payload) => {
    await syncSubscription(
      createAdminClient(),
      payload.type,
      payload.data as { product_id?: string; metadata?: Record<string, string> | null; customer?: { external_id?: string | null } | null },
    )
  },
})
