import { CustomerPortal } from "@polar-sh/nextjs"
import { createClient } from "@/lib/supabase/server"
import { polarEnvironment } from "@/lib/polar/config"

// Polar-hosted billing management (cancel, update card, invoices) for the
// owner of the subscription. The customer is re-derived from the Polar
// customer's external_id (= the Supabase user id stamped at checkout) — no
// Polar ids live in our DB. An empty id makes the adapter return 400, which
// is exactly the behavior we want for anonymous callers.
export const GET = CustomerPortal({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  environment: polarEnvironment(),
  getExternalCustomerId: async () => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id ?? ""
  },
})
