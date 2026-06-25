import { createHash } from "crypto"

import type { AdministrationRoute, AdministrationSite } from "@/types"

// Versioned vaccine catalog (roadmap #22). The "data source" analog to
// data/ailments.json for the vaccination workflow. Clinical/legal content that
// must change only via a deploy lives in code (not data/), pinned by a content
// hash (protocol_version) so a later catalog edit cannot retroactively change
// what a past administration meant — mirroring the protocol_version discipline
// of #2/#3/#6. The exact Ontario-authorized product list (incl. the six
// July-2026 additions) is a clinical/legal review gate (design §7.3); the
// routine set is seeded now.

export const VACCINE_CATALOG_VERSION = "vaccines-v1"

export interface Contraindication {
  id: string
  label: string
  guidance: string | null
  severity: "withhold" | "caution"
}

export interface VaccineProduct {
  vaccineId: string
  name: string
  defaultRoute: AdministrationRoute
  defaultSite: AdministrationSite
  doseVolume: string
  seriesTotal: number
  fundedOntario: boolean
  reportable: boolean
  manufacturerExamples: string[]
  contraindications: Contraindication[]
  patientEducation: string[]
}

// A shared, generic contraindication set applicable to most inactivated
// vaccines. Individual products override/extend as clinically required. These
// are pharmacist-worked checklist items (NOT automated allergy/interaction
// logic — that is PMS-owned per roadmap §3).
const SEVERE_ALLERGIC_REACTION: Contraindication = {
  id: "severe_allergic_reaction",
  label: "Severe allergic reaction (anaphylaxis) to a previous dose or a component of this vaccine",
  guidance: "Do not administer. Refer to physician.",
  severity: "withhold",
}

const GBS_CAUTION: Contraindication = {
  id: "guillain_barre_six_weeks",
  label: "History of Guillain-Barré syndrome within 6 weeks of a previous vaccine dose",
  guidance: "Use clinical judgment; consider referral.",
  severity: "caution",
}

const PREGNANCY_LIVE_CAUTION: Contraindication = {
  id: "pregnancy_live_vaccine",
  label: "Pregnant or possibly pregnant (live-vaccine caution)",
  guidance: "Confirm gestational status and vaccine type before proceeding.",
  severity: "caution",
}

const MODERATE_ACUTE_ILLNESS: Contraindication = {
  id: "moderate_acute_illness",
  label: "Moderate or severe acute illness (with or without fever) today",
  guidance: "Consider deferring until acute illness resolves.",
  severity: "caution",
}

function standardInactivatedContraindications(): Contraindication[] {
  return [
    { ...SEVERE_ALLERGIC_REACTION },
    { ...GBS_CAUTION },
    { ...MODERATE_ACUTE_ILLNESS },
  ]
}

export const VACCINES: VaccineProduct[] = [
  {
    vaccineId: "influenza",
    name: "Influenza (inactivated)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 1,
    fundedOntario: true,
    reportable: true,
    manufacturerExamples: ["Fluzone", "Fluviral", "Afluria"],
    contraindications: standardInactivatedContraindications(),
    patientEducation: [
      "Remain in the pharmacy for 15 minutes after vaccination to monitor for rare allergic reactions.",
      "Mild soreness, low-grade fever, or achiness for 1–2 days is common and benign.",
      "Seek immediate care for difficulty breathing, throat tightness, or widespread hives.",
    ],
  },
  {
    vaccineId: "covid19-mrna",
    name: "COVID-19 (mRNA)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.3 mL",
    seriesTotal: 1,
    fundedOntario: true,
    reportable: true,
    manufacturerExamples: ["Comirnaty", "Spikevax"],
    contraindications: standardInactivatedContraindications(),
    patientEducation: [
      "Remain in the pharmacy for 15 minutes after vaccination.",
      "Local arm soreness and transient fatigue or headache are common.",
      "Seek care for chest pain, shortness of breath, or palpitations within a week.",
    ],
  },
  {
    vaccineId: "pneumococcal-ppsv23",
    name: "Pneumococcal (PPSV23)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 1,
    fundedOntario: true,
    reportable: false,
    manufacturerExamples: ["Pneumovax 23"],
    contraindications: standardInactivatedContraindications(),
    patientEducation: [
      "Mild local reaction at the injection site is common.",
      "This vaccine protects against invasive pneumococcal disease.",
    ],
  },
  {
    vaccineId: "shingles-rzv",
    name: "Shingles (recombinant zoster, RZV)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 2,
    fundedOntario: true,
    reportable: false,
    manufacturerExamples: ["Shingrix"],
    contraindications: standardInactivatedContraindications(),
    patientEducation: [
      "This is a two-dose series; the second dose is due 2–6 months after the first.",
      "Local soreness and transient fatigue are common.",
      "Return for dose 2 to complete the series.",
    ],
  },
  {
    vaccineId: "tdap",
    name: "Tetanus, diphtheria, pertussis (Tdap)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 1,
    fundedOntario: true,
    reportable: false,
    manufacturerExamples: ["Adacel", "Boostrix"],
    contraindications: [
      { ...SEVERE_ALLERGIC_REACTION },
      {
        id: "encephalopathy_prior_pertussis",
        label: "History of encephalopathy within 7 days of a prior pertussis-containing vaccine",
        guidance: "Do not administer pertussis-containing vaccine. Refer to physician.",
        severity: "withhold",
      },
      { ...GBS_CAUTION },
      { ...MODERATE_ACUTE_ILLNESS },
    ],
    patientEducation: [
      "Mild soreness and low-grade fever are common for 1–2 days.",
      "A booster is recommended every 10 years.",
    ],
  },
  {
    vaccineId: "hepatitis-b",
    name: "Hepatitis B (recombinant)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "1.0 mL",
    seriesTotal: 3,
    fundedOntario: true,
    reportable: false,
    manufacturerExamples: ["Engerix-B", "Recombivax HB"],
    contraindications: standardInactivatedContraindications(),
    patientEducation: [
      "This is a three-dose series at 0, 1, and 6 months.",
      "Return for the next dose as scheduled to complete the series.",
    ],
  },
  {
    vaccineId: "hpv9",
    name: "HPV (9-valent)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 2,
    fundedOntario: true,
    reportable: false,
    manufacturerExamples: ["Gardasil 9"],
    contraindications: [
      { ...SEVERE_ALLERGIC_REACTION },
      {
        id: "pregnancy_hpv",
        label: "Pregnant (HPV vaccination is deferred until after delivery)",
        guidance: "Defer until after pregnancy.",
        severity: "caution",
      },
      { ...MODERATE_ACUTE_ILLNESS },
    ],
    patientEducation: [
      "Two doses are needed (6–12 months apart) for those starting before age 15.",
      "Fainting shortly after vaccination can occur; sit for 15 minutes.",
    ],
  },
  {
    vaccineId: "meningococcal-quadrivalent",
    name: "Meningococcal (quadrivalent conjugate)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 1,
    fundedOntario: true,
    reportable: false,
    manufacturerExamples: ["Menactra", "Menveo"],
    contraindications: standardInactivatedContraindications(),
    patientEducation: [
      "Protects against four strains of meningococcal bacteria.",
      "Mild local soreness is common.",
    ],
  },
  {
    vaccineId: "rsv",
    name: "RSV (recombinant prefusion F)",
    defaultRoute: "IM",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 1,
    fundedOntario: false,
    reportable: false,
    manufacturerExamples: ["Arexvy", "Abrysvo"],
    contraindications: standardInactivatedContraindications(),
    patientEducation: [
      "A single dose provides protection against lower respiratory tract disease.",
      "Mild local or systemic symptoms for 1–2 days are common.",
    ],
  },
  {
    vaccineId: "mmr",
    name: "Measles, Mumps, Rubella (MMR, live)",
    defaultRoute: "SC",
    defaultSite: "left_deltoid",
    doseVolume: "0.5 mL",
    seriesTotal: 2,
    fundedOntario: true,
    reportable: false,
    manufacturerExamples: ["MMR-II", "Priorix"],
    contraindications: [
      { ...SEVERE_ALLERGIC_REACTION },
      { ...PREGNANCY_LIVE_CAUTION },
      {
        id: "severely_immunocompromised_live",
        label: "Severely immunocompromised (live vaccine is contraindicated)",
        guidance: "Do not administer. Refer to physician.",
        severity: "withhold",
      },
      { ...MODERATE_ACUTE_ILLNESS },
    ],
    patientEducation: [
      "This is a LIVE vaccine — confirm pregnancy and immune status before administration.",
      "A mild fever or rash 5–12 days later is common and benign.",
    ],
  },
]

export function getVaccineByVaccineId(vaccineId: string): VaccineProduct | undefined {
  return VACCINES.find((v) => v.vaccineId === vaccineId)
}

// Deterministic sha256 over stable (vaccineId, name, seriesTotal, contraindication
// ids) tuples. Field order is pinned and independent of object key insertion
// order so the hash is reproducible from the build. Feeds protocol_version on the
// persisted vaccination row and the #26 governance feed.
export function computeCatalogHash(vaccines: VaccineProduct[] = VACCINES): string {
  const tuples = vaccines
    .map((v) => `${v.vaccineId}|${v.name}|${v.seriesTotal}|${v.contraindications.map((c) => c.id).join(",")}`)
    .sort()
    .join("\n")
  return createHash("sha256").update(tuples).digest("hex")
}

export const VACCINE_CATALOG_HASH = computeCatalogHash(VACCINES)
