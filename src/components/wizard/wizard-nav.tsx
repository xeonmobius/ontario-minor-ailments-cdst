"use client"

import { Button } from "@/components/ui/button"

const STEP_LABELS = ["Patient Info", "Red Flags + Symptoms", "Select Rx", "Generate PDFs"]

interface WizardNavProps {
  step: number
  canNext: boolean
  onBack: () => void
  onNext: () => void
}

export function WizardNav({ step, canNext, onBack, onNext }: WizardNavProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            className={`flex-1 text-center text-xs py-2 rounded ${
              i === step
                ? "bg-primary text-primary-foreground font-semibold"
                : i < step
                  ? "bg-muted text-muted-foreground"
                  : "bg-muted/50 text-muted-foreground"
            }`}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={step === 0}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!canNext}>
          {step === 3 ? "Finish" : "Next"}
        </Button>
      </div>
    </div>
  )
}
