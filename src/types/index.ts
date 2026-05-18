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
  ohip: string
  address: string
  city: string
  postalCode: string
  phone: string
  allergies: string
  currentMeds: string
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
  ocpLicense: string
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
