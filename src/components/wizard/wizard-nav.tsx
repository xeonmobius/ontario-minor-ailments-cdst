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
    <div className="space-y-6">
      <div className="flex items-center">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-initial">
            <div className="flex items-center gap-2">
              <div
                className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-xs font-semibold transition-colors ${
                  i === step
                    ? "bg-primary text-primary-foreground"
                    : i < step
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span
                className={`text-xs font-medium hidden sm:inline ${
                  i === step ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={`flex-1 h-px mx-3 ${
                  i < step ? "bg-primary/30" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between pt-2">
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
