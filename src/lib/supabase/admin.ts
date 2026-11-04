import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Service-role client for trusted server-only contexts: the Polar webhook
 * sync is the only caller. No cookies — webhooks have no session. The DB
 * trigger on pharmacies.subscription_tier rejects anything but service_role,
 * so billing tier writes MUST go through this client.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
