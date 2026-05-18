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
        <h3 className="text-lg font-semibold mb-3">Red Flags</h3>
        <div className="space-y-3">
          {ailment.redFlags.map((flag) => (
            <div key={flag} className="flex items-center space-x-2">
              <Checkbox
                id={`rf-${flag}`}
                checked={redFlagsChecked.includes(flag)}
                onCheckedChange={() => handleToggle(flag)}
              />
              <Label htmlFor={`rf-${flag}`}>{flag}</Label>
            </div>
          ))}
        </div>
      </div>

      {hasRedFlag && (
        <Alert variant="destructive">
          <AlertTitle>Cannot Prescribe</AlertTitle>
          <AlertDescription>
            Red flag detected — refer to PCP (Primary Care Provider).
          </AlertDescription>
        </Alert>
      )}

      {!hasRedFlag && (
        <>
          <div>
            <h3 className="text-lg font-semibold mb-3">Symptoms</h3>
            <div className="flex flex-wrap gap-2">
              {ailment.symptoms.map((symptom) => (
                <Badge key={symptom} variant="secondary">
                  {symptom}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assessment-notes">Assessment Notes</Label>
            <Textarea
              id="assessment-notes"
              aria-label="Assessment notes"
              value={assessmentNotes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Additional assessment notes..."
            />
          </div>
        </>
      )}
    </div>
  )
}
