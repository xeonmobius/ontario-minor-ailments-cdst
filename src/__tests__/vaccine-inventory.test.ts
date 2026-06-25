import { describe, it, expect, vi, beforeEach } from "vitest"

const createClient = vi.fn()
const requireAuth = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))
vi.mock("@/lib/auth-guards", () => ({
  requireAuth: (...args: unknown[]) => requireAuth(...args),
}))

import {
  getVaccineInventory,
  addInventoryLot,
  decrementInventory,
} from "@/lib/vaccine-inventory"

// An explicit builder for the from(table).select(cols).eq().eq().order() chain
// used by getVaccineInventory. `from` returns {select}; select returns {eq};
// the two .eq calls return the next link; order resolves to {data, error}.
function selectChain(rows: unknown[]) {
  const final = { data: rows, error: null }
  const order = vi.fn(() => final)
  const eq2 = vi.fn(() => ({ order }))
  const eq1 = vi.fn(() => ({ eq: eq2 }))
  const select = vi.fn(() => ({ eq: eq1 }))
  const from = vi.fn(() => ({ select }))
  return { from, _select: select, _eq1: eq1, _eq2: eq2, _order: order }
}

describe("vaccine-inventory (Supabase, non-PHI)", () => {
  beforeEach(() => {
    createClient.mockReset()
    requireAuth.mockReset()
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: "pharm-1" })
  })

  it("getVaccineInventory scopes the query to the caller's pharmacyId + vaccineId", async () => {
    const c = selectChain([
      {
        id: "lot-1",
        vaccine_id: "influenza",
        lot_number: "FLU123",
        expiry_date: "2027-01-01",
        manufacturer: "Fluzone",
        doses_received: 100,
        doses_on_hand: 50,
        doses_wasted: 0,
      },
    ])
    createClient.mockResolvedValue({ from: c.from })
    const rows = await getVaccineInventory("influenza")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: "lot-1",
      vaccineId: "influenza",
      lotNumber: "FLU123",
      dosesOnHand: 50,
    })
    expect(c.from).toHaveBeenCalledWith("vaccine_inventory")
    expect(c._select).toHaveBeenCalledWith("id, vaccine_id, lot_number, expiry_date, manufacturer, doses_received, doses_on_hand, doses_wasted")
    // The first .eq filters pharmacy_id from the verified session (RLS + app-layer).
    expect(c._eq1).toHaveBeenCalledWith("pharmacy_id", "pharm-1")
    expect(c._eq2).toHaveBeenCalledWith("vaccine_id", "influenza")
  })

  it("getVaccineInventory returns [] (graceful) when the table is absent or the query errors", async () => {
    const final = { data: null, error: { message: "table missing" } }
    const order = vi.fn(() => final)
    const eq2 = vi.fn(() => ({ order }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const select = vi.fn(() => ({ eq: eq1 }))
    const from = vi.fn(() => ({ select }))
    createClient.mockResolvedValue({ from })
    const rows = await getVaccineInventory("influenza")
    expect(rows).toEqual([])
  })

  it("getVaccineInventory returns [] when the pharmacist has no pharmacy", async () => {
    requireAuth.mockResolvedValue({ id: "u1", pharmacyId: null })
    const rows = await getVaccineInventory("influenza")
    expect(rows).toEqual([])
    expect(createClient).not.toHaveBeenCalled()
  })

  it("decrementInventory calls the decrement RPC with the lot id + pharmacyId", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 49, error: null })
    createClient.mockResolvedValue({ rpc })
    const res = await decrementInventory("lot-1")
    expect(rpc).toHaveBeenCalledWith("decrement_vaccine_inventory", {
      p_lot_uuid: "lot-1",
      p_pharmacy_id: "pharm-1",
    })
    expect(res).toEqual({ remaining: 49 })
  })

  it("decrementInventory is graceful (returns null) on error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "out of stock" } })
    createClient.mockResolvedValue({ rpc })
    const res = await decrementInventory("lot-1")
    expect(res).toEqual({ remaining: null })
  })

  it("addInventoryLot inserts with the caller's pharmacyId and initial doses_on_hand = doses_received", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "lot-new" },
      error: null,
    })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    const from = vi.fn(() => ({ insert }))
    createClient.mockResolvedValue({ from })
    const res = await addInventoryLot({
      vaccineId: "influenza",
      lotNumber: "FLU999",
      expiryDate: "2027-06-01",
      dosesReceived: 200,
    })
    expect(res).toEqual({ lotId: "lot-new" })
    expect(insert).toHaveBeenCalledWith({
      pharmacy_id: "pharm-1",
      vaccine_id: "influenza",
      lot_number: "FLU999",
      expiry_date: "2027-06-01",
      manufacturer: null,
      doses_received: 200,
      doses_on_hand: 200,
      doses_wasted: 0,
    })
  })
})
