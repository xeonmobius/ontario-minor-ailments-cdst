"use client"

import Link from "next/link"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const STEP_LABELS = ["Patient Info", "Red Flags + Symptoms", "Select Rx", "Generate PDFs"]

export function StepIndicator({ step }: { step: number }) {
  return (
    <div className="flex items-center">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center flex-1 last:flex-initial">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "inline-flex items-center justify-center size-7 rounded-full text-xs font-semibold transition-colors duration-200",
                i === step && "bg-primary text-primary-foreground",
                i < step && "bg-primary/20 text-primary",
                i > step && "bg-muted text-muted-foreground"
              )}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span
              className={cn(
                "text-xs font-medium hidden sm:inline transition-colors duration-200",
                i === step ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </div>
          {i < STEP_LABELS.length - 1 && (
            <div
              className={cn(
                "flex-1 h-px mx-3 transition-colors duration-200",
                i < step ? "bg-primary/30" : "bg-border"
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}

interface WizardNavProps {
  step: number
  canNext: boolean
  onBack: () => void
  onNext: () => void
  hasRedFlags?: boolean
  onReferral?: () => void
}

export function WizardNav({ step, canNext, onBack, onNext, hasRedFlags, onReferral }: WizardNavProps) {
  const isFinished = step === 3

  return (
    <div className="flex justify-between pt-2">
      {isFinished ? (
        <Link href="/">
          <Button variant="outline">Start New Assessment</Button>
        </Link>
      ) : (
        <Button variant="outline" onClick={onBack} disabled={step === 0}>
          Back
        </Button>
      )}
      {isFinished ? null : hasRedFlags && onReferral ? (
        <Button variant="destructive" onClick={onReferral}>
          Generate Referral
        </Button>
      ) : (
        <Button onClick={onNext} disabled={!canNext}>
          Next
        </Button>
      )}
    </div>
  )
}
