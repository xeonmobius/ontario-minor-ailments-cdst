"use client"

import { useState } from "react"
import { AbandonmentReason } from "@/types"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ABANDONMENT_REASONS } from "@/lib/non-prescribe/abandonment-reasons"

interface AbandonDialogProps {
  open: boolean
  hasPatientIdentity: boolean
  onConfirm: (reason: AbandonmentReason, note: string) => void
  onCancel: () => void
}

export function AbandonDialog({ open, hasPatientIdentity, onConfirm, onCancel }: AbandonDialogProps) {
  const [reason, setReason] = useState<AbandonmentReason | null>(null)
  const [note, setNote] = useState("")

  function reset() {
    setReason(null)
    setNote("")
  }

  function handleCancel() {
    reset()
    onCancel()
  }

  function handleConfirm() {
    if (!reason) return
    const finalReason = reason
    const finalNote = note
    reset()
    onConfirm(finalReason, finalNote)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assessment Not Completed</DialogTitle>
          <DialogDescription>
            Select a reason and exit this assessment. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {ABANDONMENT_REASONS.map((option) => {
            const isSelected = reason === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setReason(option.value)}
                className={cn(
                  "flex items-center gap-3 rounded-md border p-3 text-left text-sm transition-colors duration-150",
                  isSelected
                    ? "border-primary ring-1 ring-primary bg-primary/5"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full border",
                    isSelected ? "border-primary" : "border-muted-foreground/40",
                  )}
                >
                  {isSelected && <span className="size-2 rounded-full bg-primary" />}
                </span>
                {option.label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="abandon-note">Add a note (optional)</Label>
          <Textarea
            id="abandon-note"
            aria-label="Abandonment note"
            placeholder="Optional context..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            hasPatientIdentity
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-muted bg-muted/50 text-muted-foreground",
          )}
        >
          {hasPatientIdentity
            ? "A partial assessment record will be saved with outcome = abandoned."
            : "No patient name/DOB recorded — this assessment will not be saved."}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason}
            onClick={handleConfirm}
          >
            Confirm — Exit Assessment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
