import { createHash } from "crypto"

// Versioned pharmacist e-signature attestation (roadmap #11). The attestation
// is the per-act medico-legal binding that distinguishes "I enrolled a
// signature" from "I authorized *this* document at *this* time." It is legal
// content that must change only via a deploy, so it lives in code (not data/)
// and is pinned by a content hash. The persisted assessment row records
// attestation_version so a later edit cannot retroactively change what a past
// signing meant (mirrors the protocol_version discipline of #2/#3/#6).

export const PHARMACIST_ATTESTATION_VERSION = "pharmacist-esig-v1"

export const PHARMACIST_ATTESTATION =
  "I confirm that I am the pharmacist named above, hold Ontario College of Pharmacists registration #{{license}}, and am authorizing this {{documentType}} under Ontario Regulation 256/24 (Designated Minor Ailments) under the Pharmacy Act, in my capacity as the prescribing pharmacist."

// Replace {{license}} / {{documentType}} placeholders. A missing license renders
// as a blank rule rather than the literal mustache so the document never shows
// raw template tokens.
export function renderAttestation(
  license: string | null,
  documentType: "prescription" | "referral",
): string {
  return PHARMACIST_ATTESTATION.replace("{{license}}", license?.trim() || "__________").replace(
    "{{documentType}}",
    documentType,
  )
}

// Deterministic sha256 over the canonical (un-interpolated) attestation
// template; reproducible from the build.
export function computeAttestationHash(): string {
  return createHash("sha256").update(PHARMACIST_ATTESTATION).digest("hex")
}

export const PHARMACIST_ATTESTATION_HASH = computeAttestationHash()
