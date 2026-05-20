"use client"

import { Ailment } from "@/types"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface StepRedFlagsProps {
  ailment: Ailment
  redFlagsChecked: string[]
  onRedFlagChange: (flags: string[]) => void
  assessmentNotes: string
  onNotesChange: (notes: string) => void
}

export function StepRedFlags({
  ailment,
  redFlagsChecked,
  onRedFlagChange,
  assessmentNotes,
  onNotesChange,
}: StepRedFlagsProps) {
  const hasRedFlag = redFlagsChecked.length > 0

  function handleToggle(flag: string) {
    if (redFlagsChecked.includes(flag)) {
      onRedFlagChange(redFlagsChecked.filter((f) => f !== flag))
    } else {
      onRedFlagChange([...redFlagsChecked, flag])
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-destructive text-lg">⚠</span>
          <h3 className="text-base font-semibold">Red Flags — Screen for Referral</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Check each red flag present. If ANY is checked, the patient must be referred.</p>
        <div className="space-y-2">
          {ailment.redFlags.map((flag) => {
            const isChecked = redFlagsChecked.includes(flag)
            return (
              <div
                key={flag}
                className={`flex items-start gap-3 p-3 rounded-md border transition-colors cursor-pointer ${
                  isChecked
                    ? "border-destructive/50 bg-destructive/5"
                    : "border-border hover:bg-accent/50"
                }`}
                onClick={() => handleToggle(flag)}
              >
                <Checkbox
                  id={`rf-${flag}`}
                  checked={isChecked}
                  onCheckedChange={() => handleToggle(flag)}
                  className="mt-0.5"
                />
                <Label htmlFor={`rf-${flag}`} className="text-sm leading-snug cursor-pointer">
                  {flag}
                </Label>
              </div>
            )
          })}
        </div>
      </div>

      {hasRedFlag && (
        <Alert variant="destructive" className="border-destructive/50">
          <AlertTitle className="font-semibold">Cannot Prescribe</AlertTitle>
          <AlertDescription className="text-sm">
            Red flag(s) detected. This patient must be referred to their primary care physician. This assessment cannot proceed.
          </AlertDescription>
        </Alert>
      )}

      {!hasRedFlag && (
        <>
          <div>
            <h3 className="text-base font-semibold mb-3">Presenting Symptoms</h3>
            <div className="flex flex-wrap gap-1.5">
              {ailment.symptoms.map((symptom) => (
                <Badge key={symptom} variant="secondary" className="text-xs">
                  {symptom}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assessment-notes" className="text-sm font-medium">Assessment Notes</Label>
            <Textarea
              id="assessment-notes"
              aria-label="Assessment notes"
              value={assessmentNotes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Clinical observations..."
              rows={3}
            />
          </div>
        </>
      )}
    </div>
  )
}
