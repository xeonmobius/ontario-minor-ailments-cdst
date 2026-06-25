import type { WithholdReason } from "@/types"

// Structured reasons when a vaccine is withheld or referred (mirrors #4's
// NON_PRESCRIBE_REASONS shape). `referred_to_physician` produces the `referred`
// outcome; the rest produce `withheld`.

export interface WithholdReasonOption {
  value: WithholdReason
  label: string
  guidance: string | null
  producesReferral: boolean
}

export const WITHHOLD_REASONS: WithholdReasonOption[] = [
  {
    value: "contraindication_present",
    label: "Contraindication identified during screening",
    guidance: "Do not administer. Document the contraindication and advise the patient.",
    producesReferral: false,
  },
  {
    value: "patient_declined",
    label: "Patient (or SDM) declined the vaccine",
    guidance: null,
    producesReferral: false,
  },
  {
    value: "acute_illness_today",
    label: "Moderate or severe acute illness today",
    guidance: "Advise returning once the acute illness has resolved.",
    producesReferral: false,
  },
  {
    value: "pregnancy_live_vaccine",
    label: "Pregnancy — live-vaccine deferral",
    guidance: "Defer until after pregnancy. Offer a non-live alternative if appropriate.",
    producesReferral: false,
  },
  {
    value: "out_of_stock",
    label: "Vaccine out of stock",
    guidance: "Add the patient to the recall/wait list and contact when stock arrives.",
    producesReferral: false,
  },
  {
    value: "referred_to_physician",
    label: "Referred to physician",
    guidance: "Refer for physician assessment before administration.",
    producesReferral: true,
  },
  {
    value: "other",
    label: "Other (rationale required)",
    guidance: "Document the clinical rationale.",
    producesReferral: false,
  },
]

export function getWithholdReasonOption(
  value: WithholdReason | null,
): WithholdReasonOption | undefined {
  if (!value) return undefined
  return WITHHOLD_REASONS.find((r) => r.value === value)
}
