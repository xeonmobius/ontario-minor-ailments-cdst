"use client"

import { Ailment, NonPrescribeReason, RecalledSig, SelectedRx } from "@/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { NonPrescribePanel } from "./non-prescribe-panel"
import { CitationPanel } from "./citation-panel"

function formatRecallDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-CA")
}

interface StepRxProps {
  ailment: Ailment
  selectedRx: SelectedRx | null
  recalled?: RecalledSig | null
  onSelect: (rx: Ailment["rxOptions"][number]) => void
  onSelectedRxChange: (rx: SelectedRx) => void
  nonRxChecked: string[]
  onNonRxChange: (items: string[]) => void
  nonPrescribeReason?: NonPrescribeReason | null
  onNonPrescribeReasonChange?: (r: NonPrescribeReason | null) => void
  nonPrescribeRationale?: string
  onNonPrescribeRationaleChange?: (s: string) => void
}

export function StepRx({
  ailment,
  selectedRx,
  recalled,
  onSelect,
  onSelectedRxChange,
  nonRxChecked,
  onNonRxChange,
  nonPrescribeReason,
  onNonPrescribeReasonChange,
  nonPrescribeRationale,
  onNonPrescribeRationaleChange,
}: StepRxProps) {
  function handleFieldChange(field: keyof SelectedRx, value: string) {
    if (!selectedRx) return
    onSelectedRxChange({ ...selectedRx, [field]: value })
  }

  function handleToggleNonRx(item: string) {
    if (nonRxChecked.includes(item)) {
      onNonRxChange(nonRxChecked.filter((i) => i !== item))
    } else {
      onNonRxChange([...nonRxChecked, item])
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold mb-3">Select Prescription</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ailment.rxOptions.map((rx) => {
            const isSelected = selectedRx?.drug === rx.drug
            return (
              <Card
                key={rx.drug}
                className={cn(
                  "cursor-pointer transition-all duration-150",
                  isSelected ? "ring-2 ring-primary" : "hover:border-muted-foreground/50"
                )}
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
        <CitationPanel slug={ailment.slug} step="rxSelection" />
      </div>

      {selectedRx && (
        <div className="flex flex-col gap-4">
          <Separator />
          {recalled && recalled.drug === selectedRx.drug && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground" data-testid="recall-hint-same">
              Last used for this patient on {formatRecallDate(recalled.prescribedAt)}: values pre-filled — review and edit.
            </div>
          )}
          {recalled && recalled.drug !== selectedRx.drug && (
            <div className="flex flex-col gap-2 rounded-md border border-muted-foreground/20 bg-muted/40 p-3 text-sm" data-testid="recall-hint-different">
              <span className="text-muted-foreground">
                Previously prescribed <span className="font-medium text-foreground">{recalled.drug}</span> ({recalled.sig}) on {formatRecallDate(recalled.prescribedAt)}.
              </span>
              {(() => {
                const regimen = ailment.rxOptions.find((r) => r.drug === recalled.drug)
                if (!regimen) return null
                return (
                  <Button size="sm" variant="outline" className="w-fit" onClick={() => onSelect(regimen)}>
                    Switch to {recalled.drug}
                  </Button>
                )
              })()}
            </div>
          )}
          <h3 className="text-lg font-semibold">Prescription Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sig">Directions (Sig)</Label>
              <Input
                id="sig"
                aria-label="Directions"
                value={selectedRx.sig}
                onChange={(e) => handleFieldChange("sig", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                aria-label="Quantity"
                value={selectedRx.quantity}
                onChange={(e) => handleFieldChange("quantity", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="refills">Refills</Label>
              <Input
                id="refills"
                aria-label="Refills"
                value={selectedRx.refills}
                onChange={(e) => handleFieldChange("refills", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
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
        <h3 className="text-base font-semibold mb-2">Non-Rx Advice</h3>
        <p className="text-xs text-muted-foreground mb-4">Check each item discussed with the patient.</p>
        <div className="flex flex-col gap-2">
          {ailment.nonRx.map((item) => {
            const isChecked = nonRxChecked.includes(item)
            return (
              <div
                key={item}
                onClick={() => handleToggleNonRx(item)}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors duration-150",
                  isChecked
                    ? "border-primary/30 bg-primary/5"
                    : "border-border hover:bg-accent/50"
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => handleToggleNonRx(item)}
                  className="mt-0.5 pointer-events-none"
                />
                <span className="text-sm leading-snug">
                  {item}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-2">Follow-up</h3>
        <p className="text-sm text-muted-foreground">{ailment.followUp}</p>
        <div className="mt-3">
          <CitationPanel slug={ailment.slug} step="followUp" />
        </div>
      </div>

      {onNonPrescribeReasonChange && onNonPrescribeRationaleChange && (
        <>
          <Separator />
          <NonPrescribePanel
            ailment={ailment}
            value={nonPrescribeReason ?? null}
            onReasonChange={onNonPrescribeReasonChange}
            rationale={nonPrescribeRationale ?? ""}
            onRationaleChange={onNonPrescribeRationaleChange}
            nonRxChecked={nonRxChecked}
            onNonRxChange={onNonRxChange}
            showNonRxAdvice={false}
          />
        </>
      )}
    </div>
  )
}
