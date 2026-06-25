import { createHash } from "crypto"

// Versioned consent statement set (roadmap #3). Consent text is legal content
// that must change only via a deploy, so it lives in code (not data/) and is
// pinned by a content hash. The persisted consent row records statement_version
// + statement_hash so a later edit to this file cannot retroactively change
// what a past consent meant (mirrors the protocol_version discipline of #2/#6).

export const CONSENT_STATEMENT_VERSION = "minor-ailments-v1"

export type ConsentStatementKey =
  | "consent_to_assess"
  | "consent_to_record"
  | "consent_to_followup"

export interface ConsentStatement {
  key: ConsentStatementKey
  label: string
  body: string
  required: boolean
}

export const MINOR_AILMENTS_CONSENT_STATEMENTS: ConsentStatement[] = [
  {
    key: "consent_to_assess",
    label: "Consent to assess and prescribe",
    required: true,
    body: "I consent to the pharmacist at {{pharmacyName}} assessing me for {{ailmentName}} and, if clinically appropriate, prescribing a treatment under Ontario Regulation 256/24 (Designated Minor Ailments) under the Pharmacy Act.",
  },
  {
    key: "consent_to_record",
    label: "Consent to record my health information (PHIPA)",
    required: true,
    body: "I consent to the pharmacy collecting, using, and retaining my personal health information for the purpose of this minor ailment assessment and my pharmacy record, in accordance with the Personal Health Information Protection Act, 2004 (PHIPA).",
  },
  {
    key: "consent_to_followup",
    label: "Optional: contact me for follow-up",
    required: false,
    body: "I agree that the pharmacy may contact me (by text message or email) to follow up on the outcome of this assessment. I understand this is optional and refusing will not affect my care.",
  },
]

// Appended to the rendered statement text when the signer is a substitute
// decision-maker (HCCA, 1996). Not part of the hashed corpus below — it is a
// constant clause, not a per-statement field.
export const SDM_ATTESTATION =
  "I confirm that I am the parent, guardian, or substitute decision-maker of the above-named patient and that I am legally authorized to give this consent under the Health Care Consent Act, 1996."

// Replace {{pharmacyName}} / {{ailmentName}} placeholders. Unknown tokens are
// left untouched; an empty value renders as a blank rather than the literal
// placeholder so the document never shows raw mustaches.
export function renderStatement(
  body: string,
  vars: { pharmacyName?: string; ailmentName?: string },
): string {
  return body
    .replace(/\{\{pharmacyName\}\}/g, vars.pharmacyName ?? "")
    .replace(/\{\{ailmentName\}\}/g, vars.ailmentName ?? "")
}

// Deterministic sha256 over the exact statement text. Canonicalises each
// statement as `key|required|body` (field order pinned, independent of object
// key insertion order) so the hash is reproducible from the build.
export function computeStatementHash(
  statements: ConsentStatement[] = MINOR_AILMENTS_CONSENT_STATEMENTS,
): string {
  const tuples = statements.map((s) => `${s.key}|${s.required}|${s.body}`).join("\n")
  return createHash("sha256").update(tuples).digest("hex")
}

export const CONSENT_STATEMENTS_HASH = computeStatementHash(MINOR_AILMENTS_CONSENT_STATEMENTS)
