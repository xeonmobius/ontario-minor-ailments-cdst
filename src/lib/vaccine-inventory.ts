"use server"

import { createClient } from "@/lib/supabase/server"
import { requireAuth } from "@/lib/auth-guards"

// Non-PHI per-pharmacy vaccine lot ledger (roadmap #22). Lives on Supabase with
// RLS by pharmacy_id — stock describes the pharmacy, not a patient, so it stays
// out of the fly.io PHI store (roadmap §6.4). Ships live in Phase 1 independent
// of the fly.io/BAA gate. A lot number alone is a manufacturer code; it becomes
// PHI only when joined to a patient via the fly.io vaccination row.
//
// NOTE: the `vaccine_inventory` table + RLS policies + `decrement_vaccine_inventory`
// RPC are applied as a Supabase migration at deploy time (design §4.6). Until
// that migration is applied, these reads return [] / the RPC no-ops gracefully,
// and the inventory-picker falls back to manual lot entry.

export interface InventoryLot {
  id: string
  vaccineId: string
  lotNumber: string
  expiryDate: string
  manufacturer: string | null
  dosesReceived: number
  dosesOnHand: number
  dosesWasted: number
}

function mapRow(row: Record<string, unknown>): InventoryLot {
  return {
    id: String(row.id),
    vaccineId: String(row.vaccine_id),
    lotNumber: String(row.lot_number),
    expiryDate: String(row.expiry_date),
    manufacturer: (row.manufacturer as string | null) ?? null,
    dosesReceived: Number(row.doses_received ?? 0),
    dosesOnHand: Number(row.doses_on_hand ?? 0),
    dosesWasted: Number(row.doses_wasted ?? 0),
  }
}

// List the pharmacy's lots for a vaccine, soonest-expiry first. Scoped to the
// caller's pharmacy by RLS (and the app-layer WHERE). Empty when the table is
// absent or the pharmacy has no lots.
export async function getVaccineInventory(vaccineId: string): Promise<InventoryLot[]> {
  try {
    const profile = await requireAuth()
    if (!profile.pharmacyId) return []

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("vaccine_inventory")
      .select("id, vaccine_id, lot_number, expiry_date, manufacturer, doses_received, doses_on_hand, doses_wasted")
      .eq("pharmacy_id", profile.pharmacyId)
      .eq("vaccine_id", vaccineId)
      .order("expiry_date", { ascending: true })

    if (error || !data) return []
    return data.map((row) => mapRow(row as Record<string, unknown>))
  } catch {
    return []
  }
}

export interface AddInventoryLotInput {
  vaccineId: string
  lotNumber: string
  expiryDate: string
  manufacturer?: string
  dosesReceived: number
}

// Add a lot to the ledger (RLS insert policy). Returns the lot id, or null when
// persistence is unavailable. Exposed so the ledger is populate-able; a full
// inventory-management UI is LATER.
export async function addInventoryLot(
  input: AddInventoryLotInput,
): Promise<{ lotId: string | null }> {
  try {
    const profile = await requireAuth()
    if (!profile.pharmacyId) return { lotId: null }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("vaccine_inventory")
      .insert({
        pharmacy_id: profile.pharmacyId,
        vaccine_id: input.vaccineId,
        lot_number: input.lotNumber,
        expiry_date: input.expiryDate,
        manufacturer: input.manufacturer ?? null,
        doses_received: input.dosesReceived,
        doses_on_hand: input.dosesReceived,
        doses_wasted: 0,
      })
      .select("id")
      .single()

    if (error || !data) return { lotId: null }
    return { lotId: String(data.id) }
  } catch {
    return { lotId: null }
  }
}

// Atomically decrement doses_on_hand by 1 via the SECURITY DEFINER RPC (never
// drops below 0; re-checks pharmacy_id). Best-effort after the fly.io
// administration row is written — a missed decrement is reconcilable from the
// append-only vaccination ledger (design §6).
export async function decrementInventory(
  lotId: string,
): Promise<{ remaining: number | null }> {
  try {
    const profile = await requireAuth()
    if (!profile.pharmacyId) return { remaining: null }

    const supabase = await createClient()
    const { data, error } = await supabase.rpc("decrement_vaccine_inventory", {
      p_lot_uuid: lotId,
      p_pharmacy_id: profile.pharmacyId,
    })

    if (error) return { remaining: null }
    return { remaining: typeof data === "number" ? data : null }
  } catch {
    return { remaining: null }
  }
}
