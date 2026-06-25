"use client"

import { Ailment, NonPrescribeReason } from "@/types"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NON_PRESCRIBE_REASONS, getReasonOption } from "@/lib/non-prescribe/reasons"

interface NonPrescribePanelProps {
  ailment: Ailment
  value: NonPrescribeReason | null
  onReasonChange: (r: NonPrescribeReason | null) => void
  rationale: string
  onRationaleChange: (s: string) => void
  nonRxChecked: string[]
  onNonRxChange: (items: string[]) => void
  showNonRxAdvice?: boolean
}

export function NonPrescribePanel({
  ailment,
  value,
  onReasonChange,
  rationale,
  onRationaleChange,
  nonRxChecked,
  onNonRxChange,
  showNonRxAdvice = true,
}: NonPrescribePanelProps) {
  const selectedOption = getReasonOption(value)
  const rationaleRequired = value === "other"

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
        <h3 className="text-lg font-semibold mb-1">Do Not Prescribe</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Record a structured reason and produce a non-prescribe documentation PDF.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {NON_PRESCRIBE_REASONS.map((option) => {
            const isSelected = value === option.value
            return (
              <Card
                key={option.value}
                className={cn(
                  "cursor-pointer transition-all duration-150",
                  isSelected ? "ring-2 ring-primary" : "hover:border-muted-foreground/50",
                )}
                onClick={() => onReasonChange(option.value)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">{option.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{option.guidance}</p>
                  {option.requiresReferralContext && isSelected && (
                    <p className="text-xs text-primary mt-2">
                      This will produce a referral document for the patient&apos;s family physician.
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {selectedOption && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="non-prescribe-rationale">
            Clinical rationale{rationaleRequired ? " *" : ""}
          </Label>
          <Textarea
            id="non-prescribe-rationale"
            aria-label="Clinical rationale"
            placeholder="Document the clinical reasoning for not prescribing..."
            value={rationale}
            onChange={(e) => onRationaleChange(e.target.value)}
            required={rationaleRequired}
          />
          {rationaleRequired && (
            <p className="text-xs text-muted-foreground">
              A rationale is required when &quot;Other&quot; is selected.
            </p>
          )}
        </div>
      )}

      {showNonRxAdvice && (
        <div>
          <h3 className="text-base font-semibold mb-2">Non-Rx Advice</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Check each self-care item discussed with the patient.
          </p>
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
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => handleToggleNonRx(item)}
                    className="mt-0.5 pointer-events-none"
                  />
                  <span className="text-sm leading-snug">{item}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
