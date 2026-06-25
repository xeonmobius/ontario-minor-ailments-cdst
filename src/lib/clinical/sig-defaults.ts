import { createHash } from "crypto"
import type { SigDefault } from "@/types"

export const SIG_DEFAULTS_VERSION = "sig-defaults-v1"

const KEY_SEPARATOR = "::"

export function sigDefaultKey(ailmentSlug: string, drug: string): string {
  return `${ailmentSlug}${KEY_SEPARATOR}${drug}`
}

// Keyed by `${ailmentSlug}::${drug}` — the EXACT drug string from data/ailments.json.
// Curated from each regimen's `dose` + standard Ontario dispensing practice. Every
// value is a pharmacist-editable free-text starting point (mirroring SelectedRx),
// never a validated sig. Every entry MUST be clinically reviewed before launch.
//
// Note: dermatitis lists two regimens whose drug string is identical
// ("Hydrocortisone 0.5–1%"), so there are 80 regimens across 19 ailments but 79
// unique keys here; both regimens resolve to the same sensible default.
export const SIG_DEFAULTS: Readonly<Record<string, SigDefault>> = {
  // ── acne (topicals → tube sizes; 8–12 week reassess cycle) ──────────────────
  "acne::Benzoyl peroxide 2.5–5%": {
    sig: "Apply a thin layer to affected areas twice daily after washing",
    quantity: "60 g",
    refills: "2",
    duration: "8–12 weeks",
  },
  "acne::Adapalene 0.1%": {
    sig: "Apply a thin layer to affected areas at bedtime",
    quantity: "30 g",
    refills: "2",
    duration: "8–12 weeks",
  },
  "acne::Tretinoin 0.025%": {
    sig: "Apply a thin layer to affected areas at bedtime",
    quantity: "30 g",
    refills: "2",
    duration: "8–12 weeks",
  },
  "acne::Clindamycin 1%": {
    sig: "Apply a thin layer to affected areas twice daily (use with benzoyl peroxide)",
    quantity: "30 g",
    refills: "1",
    duration: "8–12 weeks",
  },
  "acne::Azelaic acid 15%": {
    sig: "Apply a thin layer to affected areas twice daily",
    quantity: "30 g",
    refills: "2",
    duration: "8–12 weeks",
  },
  "acne::Salicylic acid 0.5–2%": {
    sig: "Apply to affected areas once or twice daily",
    quantity: "120 mL",
    refills: "2",
    duration: "8–12 weeks",
  },
  "acne::Dapsone 5%": {
    sig: "Apply a thin layer to affected areas twice daily",
    quantity: "30 g",
    refills: "2",
    duration: "8–12 weeks",
  },
  // ── allergic-rhinitis ───────────────────────────────────────────────────────
  "allergic-rhinitis::Fluticasone nasal": {
    sig: "Spray 1–2 times into each nostril once daily",
    quantity: "120 sprays",
    refills: "2",
    duration: "30 days",
  },
  "allergic-rhinitis::Mometasone nasal": {
    sig: "Spray 2 times into each nostril once daily",
    quantity: "140 sprays",
    refills: "2",
    duration: "30 days",
  },
  "allergic-rhinitis::Cetirizine 10 mg": {
    sig: "Take 1 tablet by mouth once daily",
    quantity: "30 tablets",
    refills: "2",
    duration: "30 days",
  },
  "allergic-rhinitis::Loratadine 10 mg": {
    sig: "Take 1 tablet by mouth once daily",
    quantity: "30 tablets",
    refills: "2",
    duration: "30 days",
  },
  "allergic-rhinitis::Fexofenadine 180 mg": {
    sig: "Take 1 tablet by mouth once daily",
    quantity: "30 tablets",
    refills: "2",
    duration: "30 days",
  },
  "allergic-rhinitis::Desloratadine 5 mg": {
    sig: "Take 1 tablet by mouth once daily",
    quantity: "30 tablets",
    refills: "2",
    duration: "30 days",
  },
  "allergic-rhinitis::Bilastine 20 mg": {
    sig: "Take 1 tablet by mouth once daily on an empty stomach",
    quantity: "30 tablets",
    refills: "2",
    duration: "30 days",
  },
  // ── aphthous-ulcers ─────────────────────────────────────────────────────────
  "aphthous-ulcers::Triamcinolone dental paste": {
    sig: "Apply a thin film to the ulcer 2–4 times daily after meals",
    quantity: "5 g",
    refills: "1",
    duration: "7–14 days",
  },
  // ── candidal-stomatitis ─────────────────────────────────────────────────────
  "candidal-stomatitis::Nystatin oral suspension": {
    sig: "Swish 1 mL (100,000 units) around the mouth and swallow, four times daily",
    quantity: "60 mL",
    refills: "0",
    duration: "7–14 days",
  },
  // ── conjunctivitis ──────────────────────────────────────────────────────────
  "conjunctivitis::Polymyxin B/Gramicidin drops": {
    sig: "Instill 1–2 drops into the affected eye(s) four times daily",
    quantity: "10 mL",
    refills: "0",
    duration: "5–7 days",
  },
  "conjunctivitis::Polymyxin B/Trimethoprim drops": {
    sig: "Instill 1–2 drops into the affected eye(s) four times daily",
    quantity: "10 mL",
    refills: "0",
    duration: "5–7 days",
  },
  "conjunctivitis::Erythromycin ointment": {
    sig: "Apply a small ribbon to the affected eye(s) four times daily",
    quantity: "3.5 g",
    refills: "0",
    duration: "5–7 days",
  },
  "conjunctivitis::Fusidic acid drops": {
    sig: "Instill 1 drop into the affected eye(s) twice daily",
    quantity: "5 g",
    refills: "0",
    duration: "7 days",
  },
  "conjunctivitis::Ketotifen drops": {
    sig: "Instill 1 drop into the affected eye(s) twice daily",
    quantity: "5 mL",
    refills: "1",
    duration: "14 days",
  },
  "conjunctivitis::Olopatadine drops": {
    sig: "Instill 1 drop into the affected eye(s) twice daily",
    quantity: "5 mL",
    refills: "1",
    duration: "14 days",
  },
  // ── dermatitis ──────────────────────────────────────────────────────────────
  "dermatitis::Hydrocortisone 0.5–1%": {
    sig: "Apply a thin layer to the affected area twice daily",
    quantity: "30 g",
    refills: "1",
    duration: "7–14 days",
  },
  "dermatitis::Desonide 0.05%": {
    sig: "Apply a thin layer to the affected area twice daily",
    quantity: "30 g",
    refills: "1",
    duration: "7–14 days",
  },
  "dermatitis::Betamethasone valerate 0.1%": {
    sig: "Apply a thin layer to the affected area twice daily (max 2 weeks)",
    quantity: "30 g",
    refills: "1",
    duration: "14 days",
  },
  "dermatitis::Triamcinolone 0.1%": {
    sig: "Apply a thin layer to the affected area twice daily",
    quantity: "30 g",
    refills: "1",
    duration: "7–14 days",
  },
  "dermatitis::Clobetasone 0.05%": {
    sig: "Apply a thin layer to the affected area twice daily",
    quantity: "30 g",
    refills: "1",
    duration: "7–14 days",
  },
  "dermatitis::Clotrimazole 1% cream": {
    sig: "Apply to the affected area three times daily",
    quantity: "30 g",
    refills: "1",
    duration: "7–14 days",
  },
  "dermatitis::Miconazole 2% cream": {
    sig: "Apply to the affected area twice daily",
    quantity: "30 g",
    refills: "1",
    duration: "7–14 days",
  },
  "dermatitis::Nystatin cream/powder": {
    sig: "Apply to the affected area four times daily",
    quantity: "30 g",
    refills: "1",
    duration: "7–14 days",
  },
  // ── dysmenorrhea (PRN, ceiling-dose encoded in sig) ─────────────────────────
  "dysmenorrhea::Ibuprofen 400 mg": {
    sig: "Take 1 tablet by mouth every 6–8 hours as needed (max 1200 mg/day)",
    quantity: "40 tablets",
    refills: "1",
    duration: "3 cycles",
  },
  "dysmenorrhea::Naproxen sodium 220 mg": {
    sig: "Take 1–2 tablets initially, then 1 tablet every 8–12 hours as needed (max 660 mg/day)",
    quantity: "40 tablets",
    refills: "1",
    duration: "3 cycles",
  },
  // ── gerd ────────────────────────────────────────────────────────────────────
  "gerd::Calcium carbonate": {
    sig: "Chew 500–1000 mg as needed for heartburn",
    quantity: "100 tablets",
    refills: "1",
    duration: "14 days",
  },
  "gerd::Famotidine 20 mg": {
    sig: "Take 1–2 tablets by mouth once daily or twice daily",
    quantity: "30 tablets",
    refills: "1",
    duration: "14 days",
  },
  "gerd::Omeprazole 20 mg": {
    sig: "Take 1 capsule by mouth once daily before breakfast",
    quantity: "14 capsules",
    refills: "1",
    duration: "14 days",
  },
  "gerd::Pantoprazole 20 mg": {
    sig: "Take 1 tablet by mouth once daily before breakfast",
    quantity: "14 tablets",
    refills: "1",
    duration: "14 days",
  },
  "gerd::Esomeprazole 20 mg": {
    sig: "Take 1 capsule by mouth once daily",
    quantity: "14 capsules",
    refills: "1",
    duration: "14 days",
  },
  // ── hemorrhoids ─────────────────────────────────────────────────────────────
  "hemorrhoids::Hydrocortisone cream/suppository": {
    sig: "Apply or insert twice daily (max 7 days)",
    quantity: "30 g",
    refills: "0",
    duration: "7 days",
  },
  "hemorrhoids::Pramoxine cream": {
    sig: "Apply to the affected area up to four times daily as needed",
    quantity: "30 g",
    refills: "1",
    duration: "7 days",
  },
  "hemorrhoids::Phenylephrine ointment": {
    sig: "Apply to the affected area up to four times daily",
    quantity: "30 g",
    refills: "1",
    duration: "7 days",
  },
  "hemorrhoids::Zinc oxide paste": {
    sig: "Apply to the affected area as needed",
    quantity: "30 g",
    refills: "1",
    duration: "7 days",
  },
  "hemorrhoids::Witch hazel pads": {
    sig: "Apply to the affected area as needed",
    quantity: "100 pads",
    refills: "1",
    duration: "7 days",
  },
  // ── herpes-labialis (start at prodrome) ─────────────────────────────────────
  "herpes-labialis::Acyclovir cream 5%": {
    sig: "Apply to the lesion five times daily for 4 days (start at prodrome)",
    quantity: "2 g",
    refills: "1",
    duration: "4 days",
  },
  "herpes-labialis::Docosanol 10% cream": {
    sig: "Apply to the lesion five times daily until healed",
    quantity: "2 g",
    refills: "1",
    duration: "Until healed",
  },
  "herpes-labialis::Acyclovir 400 mg": {
    sig: "Take 1 tablet by mouth three times daily for 5 days",
    quantity: "15 tablets",
    refills: "0",
    duration: "5 days",
  },
  "herpes-labialis::Valacyclovir 2 g": {
    sig: "Take 2 g by mouth twice daily for 1 day",
    quantity: "4 tablets",
    refills: "0",
    duration: "1 day",
  },
  "herpes-labialis::Famciclovir 1500 mg": {
    sig: "Take 1500 mg by mouth as a single dose",
    quantity: "3 tablets",
    refills: "0",
    duration: "1 day",
  },
  // ── impetigo ────────────────────────────────────────────────────────────────
  "impetigo::Mupirocin 2% ointment": {
    sig: "Apply to the affected area three times daily",
    quantity: "15 g",
    refills: "0",
    duration: "5–7 days",
  },
  "impetigo::Fusidic acid 2% cream": {
    sig: "Apply to the affected area three times daily",
    quantity: "15 g",
    refills: "0",
    duration: "5–7 days",
  },
  "impetigo::Ozenoxacin 1% cream": {
    sig: "Apply to the affected area twice daily",
    quantity: "15 g",
    refills: "0",
    duration: "5 days",
  },
  // ── insect-bites-urticaria ──────────────────────────────────────────────────
  "insect-bites-urticaria::Cetirizine 10 mg": {
    sig: "Take 1 tablet by mouth once daily",
    quantity: "14 tablets",
    refills: "1",
    duration: "7–14 days",
  },
  "insect-bites-urticaria::Loratadine 10 mg": {
    sig: "Take 1 tablet by mouth once daily",
    quantity: "14 tablets",
    refills: "1",
    duration: "7–14 days",
  },
  "insect-bites-urticaria::Diphenhydramine 25–50 mg": {
    sig: "Take 25–50 mg by mouth every 6–8 hours as needed",
    quantity: "20 tablets",
    refills: "1",
    duration: "7 days",
  },
  "insect-bites-urticaria::Hydrocortisone 1% cream": {
    sig: "Apply to the affected area twice daily",
    quantity: "30 g",
    refills: "1",
    duration: "7 days",
  },
  "insect-bites-urticaria::Calamine lotion": {
    sig: "Apply to the affected area as needed",
    quantity: "120 mL",
    refills: "1",
    duration: "7 days",
  },
  // ── musculoskeletal (PRN) ───────────────────────────────────────────────────
  "musculoskeletal::Ibuprofen 400 mg": {
    sig: "Take 1 tablet by mouth every 6–8 hours as needed (max 1200 mg/day)",
    quantity: "40 tablets",
    refills: "1",
    duration: "7–14 days",
  },
  "musculoskeletal::Naproxen sodium 220 mg": {
    sig: "Take 1–2 tablets initially, then 1 tablet every 8–12 hours as needed (max 660 mg/day)",
    quantity: "40 tablets",
    refills: "1",
    duration: "7–14 days",
  },
  "musculoskeletal::Diclofenac gel 1%": {
    sig: "Apply to the affected area four times daily",
    quantity: "50 g",
    refills: "1",
    duration: "7–14 days",
  },
  "musculoskeletal::Acetaminophen 500 mg": {
    sig: "Take 1–2 tablets by mouth every 6 hours as needed (max 3000–4000 mg/day)",
    quantity: "60 tablets",
    refills: "1",
    duration: "7–14 days",
  },
  // ── nausea-vomiting (PRN) ───────────────────────────────────────────────────
  "nausea-vomiting::Dimenhydrinate 50 mg": {
    sig: "Take 1–2 tablets by mouth every 4–6 hours as needed (max 400 mg/day)",
    quantity: "20 tablets",
    refills: "1",
    duration: "2–3 days",
  },
  "nausea-vomiting::Diphenhydramine 25–50 mg": {
    sig: "Take 25–50 mg by mouth every 6–8 hours as needed",
    quantity: "20 tablets",
    refills: "1",
    duration: "2–3 days",
  },
  "nausea-vomiting::Promethazine 12.5–25 mg": {
    sig: "Take 12.5–25 mg by mouth every 4–6 hours as needed",
    quantity: "12 tablets",
    refills: "1",
    duration: "2–3 days",
  },
  // ── nvp (nausea & vomiting of pregnancy) ────────────────────────────────────
  "nvp::Pyridoxine (B6) 25 mg": {
    sig: "Take 1 tablet by mouth three times daily",
    quantity: "30 tablets",
    refills: "1",
    duration: "14 days",
  },
  "nvp::Doxylamine 10 mg + Pyridoxine 10 mg": {
    sig: "Take 1–2 tablets at bedtime; may add 1 tablet in the morning or afternoon as needed",
    quantity: "40 tablets",
    refills: "1",
    duration: "14 days",
  },
  "nvp::Dimenhydrinate 50 mg": {
    sig: "Take 50 mg by mouth every 6–8 hours as needed",
    quantity: "20 tablets",
    refills: "1",
    duration: "14 days",
  },
  "nvp::Diphenhydramine 25–50 mg": {
    sig: "Take 25–50 mg by mouth every 6–8 hours as needed",
    quantity: "20 tablets",
    refills: "1",
    duration: "14 days",
  },
  // ── pinworms (two-dose schedule) ────────────────────────────────────────────
  "pinworms::Mebendazole 100 mg": {
    sig: "Take 1 tablet as a single dose; repeat in 2 weeks",
    quantity: "2 tablets",
    refills: "0",
    duration: "1 day (repeat at week 2)",
  },
  "pinworms::Pyrantel pamoate": {
    sig: "Take 11 mg/kg (max 1 g) as a single dose; repeat in 2 weeks",
    quantity: "1 bottle",
    refills: "0",
    duration: "1 day (repeat at week 2)",
  },
  // ── tick-bites-lyme (single-dose prophylaxis) ───────────────────────────────
  "tick-bites-lyme::Doxycycline": {
    sig: "Take 200 mg by mouth as a single dose (children 4 mg/kg, max 200 mg)",
    quantity: "2 tablets",
    refills: "0",
    duration: "1 day",
  },
  // ── uti ─────────────────────────────────────────────────────────────────────
  "uti::Nitrofurantoin 100 mg": {
    sig: "Take 1 capsule by mouth twice daily with food",
    quantity: "10 capsules",
    refills: "0",
    duration: "5 days",
  },
  "uti::TMP-SMX (160/800 mg)": {
    sig: "Take 1 tablet by mouth twice daily",
    quantity: "6 tablets",
    refills: "0",
    duration: "3 days",
  },
  "uti::Trimethoprim 100 mg": {
    sig: "Take 1 tablet by mouth twice daily",
    quantity: "6 tablets",
    refills: "0",
    duration: "3 days",
  },
  "uti::Fosfomycin 3 g": {
    sig: "Take 1 sachet (3 g) by mouth as a single dose on an empty stomach",
    quantity: "1 sachet",
    refills: "0",
    duration: "1 day",
  },
  // ── vvc (vulvovaginal candidiasis) ──────────────────────────────────────────
  "vvc::Fluconazole 150 mg": {
    sig: "Take 1 tablet by mouth as a single dose",
    quantity: "1 tablet",
    refills: "0",
    duration: "1 day",
  },
  "vvc::Clotrimazole 1% cream": {
    sig: "Insert 5 g intravaginally daily at bedtime",
    quantity: "45 g",
    refills: "0",
    duration: "7–14 days",
  },
  "vvc::Clotrimazole 2% cream": {
    sig: "Insert 5 g intravaginally daily at bedtime",
    quantity: "21 g",
    refills: "0",
    duration: "3 days",
  },
  "vvc::Miconazole 2% cream": {
    sig: "Insert 5 g intravaginally daily at bedtime",
    quantity: "45 g",
    refills: "0",
    duration: "7 days",
  },
  "vvc::Miconazole 100 mg suppository": {
    sig: "Insert 1 suppository intravaginally daily at bedtime",
    quantity: "7 suppositories",
    refills: "0",
    duration: "7 days",
  },
  "vvc::Terconazole 0.4% cream": {
    sig: "Insert 5 g intravaginally daily at bedtime",
    quantity: "45 g",
    refills: "0",
    duration: "7 days",
  },
}

// Returns the curated default for an exact (ailment, drug) pair, or null when
// un-curated. null → the caller falls through to today's generic pre-fill.
export function getSigDefault(ailmentSlug: string, drug: string): SigDefault | null {
  return SIG_DEFAULTS[sigDefaultKey(ailmentSlug, drug)] ?? null
}

// sha256 over SIG_DEFAULTS_VERSION + key-sorted canonical JSON. Reproducible from
// the build; feeds governance and outcomes reproducibility.
export function computeSigDefaultsHash(
  entries: Readonly<Record<string, SigDefault>> = SIG_DEFAULTS,
): string {
  const sorted = Object.keys(entries)
    .sort()
    .reduce<Record<string, SigDefault>>((acc, k) => {
      acc[k] = entries[k]
      return acc
    }, {})
  return createHash("sha256")
    .update(SIG_DEFAULTS_VERSION)
    .update(JSON.stringify(sorted))
    .digest("hex")
}

export const SIG_DEFAULTS_HASH = computeSigDefaultsHash(SIG_DEFAULTS)
