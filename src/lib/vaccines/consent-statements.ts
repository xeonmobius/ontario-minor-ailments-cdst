import { createHash } from "crypto"

// Vaccination-specific informed consent statement set (roadmap #22, extends #3).
// Vaccination consent is a distinct legal basis from minor-ailments consent — it
// is informed consent to the vaccine (risks, benefits, alternatives) plus PHIPA
// record consent, captured via the same mechanism #3 established. Versioned +
// hashed so a later edit cannot retroactively change what a past consent meant.

export const VACCINATION_CONSENT_VERSION = "vaccination-v1"

export interface VaccinationConsentStatement {
  key: "consent_to_vaccinate" | "consent_to_record" | "consent_to_followup"
  label: string
  body: string
  required: boolean
}

export const VACCINATION_CONSENT_STATEMENTS: VaccinationConsentStatement[] = [
  {
    key: "consent_to_vaccinate",
    label: "Consent to vaccination",
    required: true,
    body: "I consent to receive the {{vaccineName}} vaccine, including its risks and benefits as explained to me by the pharmacist, and to the pharmacist administering it under the Ontario pharmacist injecting-agent authority.",
  },
  {
    key: "consent_to_record",
    label: "Consent to record my health information (PHIPA)",
    required: true,
    body: "I consent to the pharmacy collecting, using, and retaining my personal health information for the purpose of this vaccination and my immunization record, in accordance with the Personal Health Information Protection Act, 2004 (PHIPA).",
  },
  {
    key: "consent_to_followup",
    label: "Optional: contact me for follow-up",
    required: false,
    body: "I agree the pharmacy may contact me to remind me of subsequent doses in this series and to follow up. Optional; refusing will not affect my care.",
  },
]

// Replace {{vaccineName}} placeholders. Unknown tokens are left untouched; an
// empty value renders as a blank rather than the literal placeholder.
export function renderVaccinationStatement(
  body: string,
  vars: { vaccineName?: string },
): string {
  return body.replace(/\{\{vaccineName\}\}/g, vars.vaccineName ?? "")
}

// Deterministic sha256 over the exact statement text. Canonicalises each
// statement as `key|required|body` so the hash is reproducible from the build.
export function computeVaccinationStatementHash(
  statements: VaccinationConsentStatement[] = VACCINATION_CONSENT_STATEMENTS,
): string {
  const tuples = statements.map((s) => `${s.key}|${s.required}|${s.body}`).join("\n")
  return createHash("sha256").update(tuples).digest("hex")
}

export const VACCINATION_CONSENT_HASH = computeVaccinationStatementHash(VACCINATION_CONSENT_STATEMENTS)
