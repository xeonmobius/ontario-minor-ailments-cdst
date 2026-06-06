"use client"

import { Ailment } from "@/types"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

interface StepRedFlagsProps {
  ailment: Ailment
  redFlagsChecked: string[]
  onRedFlagChange: (flags: string[]) => void
  symptomsChecked: string[]
  onSymptomChange: (symptoms: string[]) => void
  assessmentNotes: string
  onNotesChange: (notes: string) => void
}

export function StepRedFlags({
  ailment,
  redFlagsChecked,
  onRedFlagChange,
  symptomsChecked,
  onSymptomChange,
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

  function handleToggleSymptom(symptom: string) {
    if (symptomsChecked.includes(symptom)) {
      onSymptomChange(symptomsChecked.filter((s) => s !== symptom))
    } else {
      onSymptomChange([...symptomsChecked, symptom])
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-destructive text-lg">⚠</span>
          <h3 className="text-base font-semibold">Red Flags — Screen for Referral</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">Check each red flag present. If ANY is checked, the patient must be referred.</p>
        <div className="flex flex-col gap-2">
          {ailment.redFlags.map((flag) => {
            const isChecked = redFlagsChecked.includes(flag)
            return (
              <div
                key={flag}
                onClick={() => handleToggle(flag)}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors duration-150",
                  isChecked
                    ? "border-destructive/50 bg-destructive/5"
                    : "border-border hover:bg-destructive/5"
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => handleToggle(flag)}
                  className={cn(
                    "mt-0.5 pointer-events-none data-checked:border-destructive data-checked:bg-destructive data-checked:text-white",
                  )}
                />
                <span className="text-sm leading-snug">
                  {flag}
                </span>
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
            <p className="text-xs text-muted-foreground mb-4">Check each symptom the patient is presenting with.</p>
            <div className="flex flex-col gap-2">
              {ailment.symptoms.map((symptom) => {
                const isChecked = symptomsChecked.includes(symptom)
                return (
              <div
                key={symptom}
                onClick={() => handleToggleSymptom(symptom)}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors duration-150",
                  isChecked
                    ? "border-primary/30 bg-primary/5"
                    : "border-border hover:bg-accent/50"
                )}
              >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => handleToggleSymptom(symptom)}
                      className="mt-0.5 pointer-events-none"
                    />
                    <span className="text-sm leading-snug">
                      {symptom}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
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
