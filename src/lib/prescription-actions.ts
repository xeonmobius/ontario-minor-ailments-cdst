"use server"

import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/auth-guards"

export async function reserveTxId() {
  const profile = await requireAuth()
  if (!profile.pharmacyId) {
    return { error: "No pharmacy associated with this account." }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc("next_prescription_tx", {
    p_pharmacy_id: profile.pharmacyId,
    p_pharmacist_id: profile.id,
  })

  if (error || !data) {
    return { error: error?.message ?? "Failed to reserve tx ID." }
  }

  return { txId: data as string }
}
