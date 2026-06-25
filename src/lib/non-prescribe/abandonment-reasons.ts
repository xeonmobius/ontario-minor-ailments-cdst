import type { AbandonmentReason } from "@/types"

export interface AbandonmentReasonOption {
  value: AbandonmentReason
  label: string
}

export const ABANDONMENT_REASONS: AbandonmentReasonOption[] = [
  { value: "patient_left", label: "Patient left before completion" },
  { value: "patient_deferred", label: "Patient deferred / will return" },
  { value: "lost_to_followup", label: "Lost to follow-up" },
  { value: "duplicate", label: "Duplicate assessment" },
  { value: "other", label: "Other" },
]
