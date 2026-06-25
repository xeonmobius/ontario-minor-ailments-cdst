import { createHash } from "crypto"
import type { NonPrescribeReason } from "@/types"

export const REASON_TAXONOMY_VERSION = "non-prescribe-v1"

export interface NonPrescribeReasonOption {
  value: NonPrescribeReason
  label: string
  guidance: string
  requiresReferralContext: boolean
}

export const NON_PRESCRIBE_REASONS: NonPrescribeReasonOption[] = [
  {
    value: "patient_declined",
    label: "Patient declined prescription",
    guidance: "Patient opted for self-care only after counselling.",
    requiresReferralContext: false,
  },
  {
    value: "otc_sufficient",
    label: "OTC / self-care sufficient",
    guidance: "Condition is mild and appropriate for non-prescription management.",
    requiresReferralContext: false,
  },
  {
    value: "clinical_judgment",
    label: "Clinical judgment — not appropriate to prescribe",
    guidance: "Document the clinical reasoning below.",
    requiresReferralContext: false,
  },
  {
    value: "already_treating",
    label: "Already treating with another agent",
    guidance: "Patient is already on therapy for this ailment.",
    requiresReferralContext: false,
  },
  {
    value: "referred_to_physician",
    label: "Referred to family physician (non-red-flag)",
    guidance: "No red flags identified, but physician review is warranted.",
    requiresReferralContext: true,
  },
  {
    value: "referred_elsewhere",
    label: "Referred elsewhere (e.g. walk-in, specialist)",
    guidance: "Document where the patient was directed.",
    requiresReferralContext: false,
  },
  {
    value: "other",
    label: "Other (rationale required)",
    guidance: "A free-text rationale is required for this option.",
    requiresReferralContext: false,
  },
]

export function computeReasonTaxonomyHash(
  reasons: NonPrescribeReasonOption[] = NON_PRESCRIBE_REASONS,
): string {
  const payload = reasons.map((r) => ({ value: r.value, label: r.label }))
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

export function getReasonOption(
  value: NonPrescribeReason | null,
): NonPrescribeReasonOption | undefined {
  if (!value) return undefined
  return NON_PRESCRIBE_REASONS.find((r) => r.value === value)
}
