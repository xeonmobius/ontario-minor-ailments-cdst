export interface RxOption {
  drug: string
  dose: string
  notes: string
}

export interface Ailment {
  id: string
  name: string
  slug: string
  symptoms: string[]
  redFlags: string[]
  rxOptions: RxOption[]
  nonRx: string[]
  followUp: string
}

export type DifferentialDisposition = "treat_in_tool" | "refer" | "otc_only"

export interface Differential {
  name: string
  distinguishingFeatures: string
  disposition: DifferentialDisposition
}

export interface DermNetLink {
  label: string
  url: string
  topic: string
}

export interface DifferentialEntry {
  differentials: Differential[]
  dermnetLinks: DermNetLink[]
  clinicalPearls?: string[]
}

export type CitationType =
  | "guideline"
  | "study"
  | "systematic-review"
  | "regulatory"
  | "monograph"

export type ProtocolStep =
  | "redFlagScreening"
  | "rxSelection"
  | "nonRxAdvice"
  | "followUp"

export interface Citation {
  id: string
  source: string
  type: CitationType
  year?: number
  url?: string
  doi?: string
  summary?: string
}

export interface AilmentCitations {
  regulatory: Citation[]
  primary: Citation[]
  byStep?: Partial<Record<ProtocolStep, Citation[]>>
}

export interface PatientInfo {
  name: string
  dob: string
  sex: string
  address: string
  city: string
  postalCode: string
  phone: string
  doctorName: string
  doctorPhone: string
  doctorFax: string
  doctorAddress: string
  encounterType: string
}

export interface PharmacyDefaults {
  pharmacyName: string
  address: string
  city: string
  province: string
  postalCode: string
  phone: string
  fax: string
  pharmacistName: string
  provincialLicense: string
  registrationNumber: string
}

export interface SelectedRx extends RxOption {
  sig: string
  quantity: string
  refills: string
  duration: string
}

export interface SigDefault {
  sig: string
  quantity: string
  refills: string
  duration: string
}

export interface PatientIdentity {
  name: string
  dob: string
}

// Digital consent capture (roadmap #3). The patient/SDM authorisation captured
// at the counter immediately before the document is produced. The captured
// stroke signature (signatureDataUrl) is PHI baked onto the PDF client-side and,
// when fly.io is live, persisted via saveConsentAction — never to Supabase.
export type SignerRelationship = "self" | "parent" | "guardian" | "sdm"
export type CaptureMethod = "signature" | "verbal_attested"

export interface ConsentCapture {
  consentToAssess: boolean
  consentToRecord: boolean
  consentToFollowup: boolean
  statementVersion: string
  signerName: string
  signerRelationship: SignerRelationship
  signatureDataUrl: string | null
  captureMethod: CaptureMethod
  capturedAt: string
}

export interface RecalledSig {
  drug: string
  sig: string
  quantity: string
  refills: string
  duration: string
  prescribedAt: string
}

export interface AssessmentData {
  ailment: Ailment
  patient: PatientInfo
  redFlagsChecked: string[]
  hasRedFlag: boolean
  assessmentNotes: string
  selectedRx: SelectedRx | null
  dateOfAssessment: string
}

export type AssessmentOutcome = "prescribed" | "referred" | "not_prescribed" | "abandoned"

export type NonPrescribeReason =
  | "patient_declined"
  | "otc_sufficient"
  | "clinical_judgment"
  | "already_treating"
  | "referred_to_physician"
  | "referred_elsewhere"
  | "other"

export type AbandonmentReason =
  | "patient_left"
  | "patient_deferred"
  | "lost_to_followup"
  | "duplicate"
  | "other"

export type UserRole = "owner" | "pharmacist"
export type PharmacyMemberRole = "owner" | "pharmacist"

export interface Profile {
  id: string
  pharmacyId: string | null
  activeRole: PharmacyMemberRole | null
  isPlatformAdmin: boolean
  fullName: string
  email: string
  province: string | null
  provincialLicense: string | null
  createdAt: string
}

export interface PharmacyMember {
  id: string
  userId: string
  pharmacyId: string
  role: PharmacyMemberRole
  isActive: boolean
  createdAt: string
  pharmacyName?: string
}

export interface Pharmacy {
  id: string
  name: string
  address: string
  city: string
  province: string
  postalCode: string
  phone: string
  fax: string
  subscriptionStatus: string
  subscriptionTier: string
  seats: number
  createdAt: string
}

export interface Invitation {
  id: string
  pharmacyId: string
  email: string
  role: UserRole | "platform_admin"
  token: string
  acceptedAt: string | null
  expiresAt: string
  createdAt: string
}
