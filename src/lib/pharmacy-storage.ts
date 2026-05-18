import { PharmacyDefaults } from "@/types"

const KEY = "cdst-pharmacy-defaults"

export function getPharmacyDefaults(): PharmacyDefaults | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(KEY)
  return raw ? JSON.parse(raw) : null
}

export function savePharmacyDefaults(data: PharmacyDefaults): void {
  localStorage.setItem(KEY, JSON.stringify(data))
}
