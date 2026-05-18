"use client"

import { Ailment, SelectedRx } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

interface StepRxProps {
  ailment: Ailment
  selectedRx: SelectedRx | null
  onSelect: (rx: Ailment["rxOptions"][number]) => void
  onSelectedRxChange: (rx: SelectedRx) => void
}

export function StepRx({ ailment, selectedRx, onSelect, onSelectedRxChange }: StepRxProps) {
  function handleFieldChange(field: keyof SelectedRx, value: string) {
    if (!selectedRx) return
    onSelectedRxChange({ ...selectedRx, [field]: value })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-3">Select Prescription</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ailment.rxOptions.map((rx) => {
            const isSelected = selectedRx?.drug === rx.drug
            return (
              <Card
                key={rx.drug}
                className={`cursor-pointer transition-all ${
                  isSelected ? "ring-2 ring-primary" : "hover:border-muted-foreground/50"
                }`}
                onClick={() => onSelect(rx)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">{rx.drug}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{rx.dose}</p>
                  {rx.notes && (
                    <p className="text-xs text-muted-foreground mt-1">{rx.notes}</p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {selectedRx && (
        <div className="space-y-4">
          <Separator />
          <h3 className="text-lg font-semibold">Prescription Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sig">Directions (Sig)</Label>
              <Input
                id="sig"
                aria-label="Directions"
                value={selectedRx.sig}
                onChange={(e) => handleFieldChange("sig", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                aria-label="Quantity"
                value={selectedRx.quantity}
                onChange={(e) => handleFieldChange("quantity", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="refills">Refills</Label>
              <Input
                id="refills"
                aria-label="Refills"
                value={selectedRx.refills}
                onChange={(e) => handleFieldChange("refills", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration</Label>
              <Input
                id="duration"
                aria-label="Duration"
                value={selectedRx.duration}
                onChange={(e) => handleFieldChange("duration", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold mb-2">Non-Rx Advice</h3>
        <ul className="list-disc list-inside space-y-1">
          {ailment.nonRx.map((item) => (
            <li key={item} className="text-sm text-muted-foreground">
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Follow-up</h3>
        <p className="text-sm text-muted-foreground">{ailment.followUp}</p>
      </div>
    </div>
  )
}
