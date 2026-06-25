"use client"

import { useEffect, useState } from "react"
import type { VaccinationAdministration } from "@/types"
import type { VaccineProduct } from "@/lib/vaccines/catalog"
import { getVaccineInventory, type InventoryLot } from "@/lib/vaccine-inventory"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"

interface InventoryPickerProps {
  vaccine: VaccineProduct
  administration: VaccinationAdministration | null
  selectedLotId: string | null
  onSelectedLotIdChange: (id: string | null) => void
  onAdministrationChange: (admin: VaccinationAdministration) => void
}

// Lot selector populated from the non-PHI vaccine_inventory ledger (Supabase,
// RLS by pharmacy_id). Out-of-stock lots are disabled. If no inventory rows
// exist for the vaccine, a free-entry fallback lets the pharmacist type a
// lot/expiry manually (the decrement is then skipped — documented edge case).
export function InventoryPicker({
  vaccine,
  administration,
  selectedLotId,
  onSelectedLotIdChange,
  onAdministrationChange,
}: InventoryPickerProps) {
  const [lots, setLots] = useState<InventoryLot[]>([])
  const [loaded, setLoaded] = useState(false)
  const [manualMode, setManualMode] = useState(false)

  useEffect(() => {
    let cancelled = false
    getVaccineInventory(vaccine.vaccineId)
      .then((rows) => {
        if (!cancelled) {
          setLots(rows)
          setLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLots([])
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [vaccine.vaccineId])

  const hasLots = lots.length > 0
  const useManual = manualMode || (loaded && !hasLots)

  function baseAdmin(): VaccinationAdministration {
    return (
      administration ?? {
        vaccineId: vaccine.vaccineId,
        vaccineName: vaccine.name,
        lotNumber: "",
        expiryDate: "",
        manufacturer: "",
        doseNumber: 1,
        seriesTotal: vaccine.seriesTotal,
        route: vaccine.defaultRoute,
        site: vaccine.defaultSite,
        doseVolume: vaccine.doseVolume,
        administrationNotes: "",
      }
    )
  }

  function patch(p: Partial<VaccinationAdministration>) {
    onAdministrationChange({ ...baseAdmin(), ...p })
  }

  function selectLot(lot: InventoryLot) {
    onSelectedLotIdChange(lot.id)
    patch({ lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, manufacturer: lot.manufacturer ?? "" })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Lot / Inventory</Label>
          {loaded && !hasLots && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              No inventory lots on file — manual entry enabled.
            </span>
          )}
        </div>

        {hasLots && !manualMode && (
          <div className="flex flex-col gap-2">
            {lots.map((lot) => {
              const outOfStock = lot.dosesOnHand <= 0
              const selected = selectedLotId === lot.id
              return (
                <label
                  key={lot.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                    outOfStock
                      ? "cursor-not-allowed border-input bg-muted/40 opacity-60"
                      : selected
                        ? "cursor-pointer border-primary bg-primary/5"
                        : "cursor-pointer border-input hover:bg-accent"
                  }`}
                >
                  <Checkbox
                    checked={selected}
                    disabled={outOfStock}
                    onCheckedChange={() => !outOfStock && selectLot(lot)}
                  />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="font-medium">Lot {lot.lotNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      Exp {lot.expiryDate}{lot.manufacturer ? ` · ${lot.manufacturer}` : ""}
                    </span>
                    <span className={`text-xs ${outOfStock ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                      {outOfStock ? "No stock" : `${lot.dosesOnHand} on hand`}
                    </span>
                  </div>
                </label>
              )
            })}
            <button
              type="button"
              className="self-start text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setManualMode(true)
                onSelectedLotIdChange(null)
              }}
            >
              Enter lot manually instead
            </button>
          </div>
        )}

        {useManual && (
          <div className="flex flex-col gap-3 rounded-lg border border-input p-3">
            {(loaded && hasLots) && (
              <button
                type="button"
                className="self-start text-xs text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setManualMode(false)
                  onSelectedLotIdChange(null)
                }}
              >
                Select from inventory instead
              </button>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="lot-number">Lot number *</Label>
                <Input
                  id="lot-number"
                  value={administration?.lotNumber ?? ""}
                  onChange={(e) => patch({ lotNumber: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="lot-expiry">Expiry date *</Label>
                <Input
                  id="lot-expiry"
                  type="date"
                  value={administration?.expiryDate ?? ""}
                  onChange={(e) => patch({ expiryDate: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1 md:col-span-2">
                <Label htmlFor="lot-mfr">Manufacturer</Label>
                <Input
                  id="lot-mfr"
                  value={administration?.manufacturer ?? ""}
                  onChange={(e) => patch({ manufacturer: e.target.value })}
                  placeholder={vaccine.manufacturerExamples.join(", ")}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface AdministrationFormProps {
  vaccine: VaccineProduct
  administration: VaccinationAdministration
  onAdministrationChange: (admin: VaccinationAdministration) => void
}

// The dose/route/site/volume confirmation form rendered beneath the lot picker.
export function AdministrationForm({ vaccine, administration, onAdministrationChange }: AdministrationFormProps) {
  function patch(p: Partial<VaccinationAdministration>) {
    onAdministrationChange({ ...administration, ...p })
  }

  const doseOptions = Array.from({ length: vaccine.seriesTotal }, (_, i) => i + 1)

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="dose-number">Dose number</Label>
        {vaccine.seriesTotal > 1 ? (
          <select
            id="dose-number"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={administration.doseNumber}
            onChange={(e) => patch({ doseNumber: Number(e.target.value) })}
          >
            {doseOptions.map((d) => (
              <option key={d} value={d}>
                Dose {d} of {vaccine.seriesTotal}
              </option>
            ))}
          </select>
        ) : (
          <Input id="dose-number" value={`Dose 1 of 1`} readOnly />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="dose-volume">Dose volume</Label>
        <Input
          id="dose-volume"
          value={administration.doseVolume}
          onChange={(e) => patch({ doseVolume: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="route">Route</Label>
        <select
          id="route"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={administration.route}
          onChange={(e) => patch({ route: e.target.value as VaccinationAdministration["route"] })}
        >
          <option value="IM">Intramuscular (IM)</option>
          <option value="SC">Subcutaneous (SC)</option>
          <option value="ID">Intradermal (ID)</option>
          <option value="intranasal">Intranasal</option>
          <option value="oral">Oral</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="site">Anatomical site</Label>
        <select
          id="site"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={administration.site}
          onChange={(e) => patch({ site: e.target.value as VaccinationAdministration["site"] })}
        >
          <option value="left_deltoid">Left deltoid</option>
          <option value="right_deltoid">Right deltoid</option>
          <option value="left_vastus_lateralis">Left vastus lateralis</option>
          <option value="right_vastus_lateralis">Right vastus lateralis</option>
          <option value="left_arm">Left arm</option>
          <option value="right_arm">Right arm</option>
          <option value="nasal">Nasal</option>
          <option value="oral">Oral</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex flex-col gap-1 md:col-span-2">
        <Label htmlFor="admin-notes">Administration notes (optional)</Label>
        <Textarea
          id="admin-notes"
          value={administration.administrationNotes}
          onChange={(e) => patch({ administrationNotes: e.target.value })}
          rows={2}
        />
      </div>
    </div>
  )
}
