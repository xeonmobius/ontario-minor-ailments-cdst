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

export interface PatientInfo {
  name: string
  dob: string
  sex: string
  ohip: string
  address: string
  city: string
  postalCode: string
  phone: string
  allergies: string
  currentMeds: string
  doctorName: string
  doctorLicense: string
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

export interface AssessmentData {
  ailment: Ailment
  patient: PatientInfo
  redFlagsChecked: string[]
  hasRedFlag: boolean
  assessmentNotes: string
  selectedRx: SelectedRx | null
  dateOfAssessment: string
}

export type UserRole = "owner" | "pharmacist" | "platform_admin"

export interface Profile {
  id: string
  pharmacyId: string | null
  role: UserRole
  fullName: string
  email: string
  province: string | null
  provincialLicense: string | null
  registrationNumber: string | null
  createdAt: string
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
  role: UserRole
  token: string
  acceptedAt: string | null
  expiresAt: string
  createdAt: string
}
