"use client"

import { useEffect, useState } from "react"
import type { WithholdReason } from "@/types"
import { WITHHOLD_REASONS } from "@/lib/vaccines/withhold-reasons"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface WithholdPanelProps {
  value: WithholdReason | null
  note: string
  onReasonChange: (reason: WithholdReason) => void
  onNoteChange: (note: string) => void
}

// Rendered at step 2 when a withhold-severity contraindication was checked.
// Defaults to `contraindication_present`. `referred_to_physician` produces the
// `referred` outcome; the rest produce `withheld`. Mirrors #4's reason radio UX.
export function WithholdPanel({ value, note, onReasonChange, onNoteChange }: WithholdPanelProps) {
  const [reason, setReason] = useState<WithholdReason>(value ?? "contraindication_present")

  useEffect(() => {
    onReasonChange(reason)
    // onReasonChange is a stable wizard setter; fire once per reason change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reason])

  const requiresRationale = reason === "other"
  const rationaleValid = reason !== "other" || note.trim().length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {WITHHOLD_REASONS.map((opt) => {
          const id = `withhold-${opt.value}`
          const checked = reason === opt.value
          return (
            <div key={opt.value} className="flex flex-col gap-1">
              <div className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={() => setReason(opt.value)}
                />
                <Label htmlFor={id} className="cursor-pointer text-sm font-medium leading-snug">
                  {opt.label}
                  {opt.producesReferral ? " (referral)" : ""}
                </Label>
              </div>
              {opt.guidance && (
                <p className="ml-6 text-xs text-muted-foreground">{opt.guidance}</p>
              )}
            </div>
          )
        })}
      </div>

      {requiresRationale && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="withhold-rationale">Clinical rationale *</Label>
          <Textarea
            id="withhold-rationale"
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            rows={3}
          />
          {!rationaleValid && (
            <p className="text-xs text-destructive">A rationale is required for &quot;Other&quot;.</p>
          )}
        </div>
      )}
    </div>
  )
}
