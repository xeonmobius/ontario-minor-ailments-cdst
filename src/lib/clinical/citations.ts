import { createHash } from "crypto"
import type { AilmentCitations, Citation, ProtocolStep } from "@/types"

export const CITATIONS_VERSION = "citations-v1"

// The universal regulatory anchor — O. Reg. 256/24 under the Pharmacy Act,
// the Ontario authority for pharmacist prescribing of designated minor ailments.
// URL is a literal e-Laws constant; applied per-ailment so each generated
// document carries its own authority with no global side-channel.
const OREG_256_24_URL = "https://www.ontario.ca/laws/regulation/240256"
const OREG_256_24_SOURCE =
  "O. Reg. 256/24 under the Pharmacy Act (Ontario Minor Ailments)"

function regulatoryFor(ailmentName: string): Citation[] {
  return [
    {
      id: "on-o-reg-256-24",
      source: OREG_256_24_SOURCE,
      type: "regulatory",
      year: 2024,
      url: OREG_256_24_URL,
      summary: `Authority for Ontario pharmacists to prescribe for ${ailmentName} as a designated minor ailment.`,
    },
  ]
}

// Keyed by ailment slug. Populated for all 19 ailments. Every entry carries the
// regulatory anchor; `primary` is the most authoritative Canadian/international
// source and `byStep` adds a distinct basis where a protocol step warrants it.
// All `url` values are literal public constants (no template interpolation, no
// query string) so no patient context can ever leak into an outbound request.
export const CITATIONS: Record<string, AilmentCitations> = {
  acne: {
    regulatory: regulatoryFor("acne vulgaris"),
    primary: [
      {
        id: "canadian-acne",
        source: "Canadian Dermatology Association. Acne Treatment Guidelines.",
        type: "guideline",
        year: 2022,
        summary:
          "First-line topical therapy is benzoyl peroxide and/or a topical retinoid (adapalene); combine with a topical antibiotic for inflammatory lesions.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "canadian-acne-redflags",
          source: "Canadian Dermatology Association. Acne Treatment Guidelines.",
          type: "guideline",
          year: 2022,
          summary:
            "Nodules, cysts, scarring, or endocrine features (androgen excess) indicate severe acne needing physician/dermatology referral, not pharmacist prescribing.",
        },
      ],
    },
  },
  "allergic-rhinitis": {
    regulatory: regulatoryFor("allergic rhinitis"),
    primary: [
      {
        id: "csaci-rhinitis",
        source:
          "Canadian Society of Allergy and Clinical Immunology. Allergic Rhinitis Guidance.",
        type: "guideline",
        year: 2019,
        summary:
          "Intranasal corticosteroid is the most effective monotherapy for moderate–severe allergic rhinitis; an oral second-generation antihistamine is first-line for mild symptoms.",
      },
    ],
  },
  "aphthous-ulcers": {
    regulatory: regulatoryFor("recurrent aphthous stomatitis"),
    primary: [
      {
        id: "canadian-oral-aphthous",
        source: "Canadian oral medicine guidance. Recurrent Aphthous Stomatitis.",
        type: "guideline",
        year: 2020,
        summary:
          "First-line therapy is a topical corticosteroid (e.g. triamcinolone) applied to early lesions; topical analgesics provide symptomatic relief.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "canadian-oral-aphthous-redflags",
          source: "Canadian oral medicine guidance. Recurrent Aphthous Stomatitis.",
          type: "guideline",
          year: 2020,
          summary:
            "Large, non-healing (>2–3 weeks), or extra-oral ulcers mandate physician referral to exclude systemic disease or malignancy.",
        },
      ],
    },
  },
  "candidal-stomatitis": {
    regulatory: regulatoryFor("oral candidiasis"),
    primary: [
      {
        id: "canadian-oral-candidiasis",
        source: "Canadian oral healthcare guidance. Oral Candidiasis Management.",
        type: "guideline",
        year: 2019,
        summary:
          "Uncomplicated oral candidiasis is treated with topical clotrimazole troches or nystatin suspension; oral fluconazole is reserved for extensive or refractory disease.",
      },
    ],
  },
  conjunctivitis: {
    regulatory: regulatoryFor("bacterial conjunctivitis"),
    primary: [
      {
        id: "canadian-conjunctivitis",
        source:
          "Canadian ophthalmic antibacterial guidance. Acute Bacterial Conjunctivitis.",
        type: "guideline",
        year: 2018,
        summary:
          "Acute bacterial conjunctivitis is typically self-limiting; a topical broad-spectrum antibiotic drop shortens duration when treatment is warranted.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "canadian-conjunctivitis-redflags",
          source:
            "Canadian ophthalmic antibacterial guidance. Acute Bacterial Conjunctivitis.",
          type: "guideline",
          year: 2018,
          summary:
            "Pain, photophobia, reduced vision, or contact-lens wear with red eye mandate urgent ophthalmic referral to exclude keratitis, uveitis, or glaucoma.",
        },
      ],
    },
  },
  dermatitis: {
    regulatory: regulatoryFor("contact and atopic dermatitis"),
    primary: [
      {
        id: "canadian-dermatitis",
        source: "Canadian Dermatology Association. Atopic Dermatitis Guidance.",
        type: "guideline",
        year: 2022,
        summary:
          "First-line therapy is a topical corticosteroid appropriate to site and severity, with regular emollient maintenance; topical calcineurin inhibitors for face/folds.",
      },
    ],
  },
  dysmenorrhea: {
    regulatory: regulatoryFor("primary dysmenorrhea"),
    primary: [
      {
        id: "sogc-dysmenorrhea",
        source: "SOGC. Primary Dysmenorrhea Consensus Guideline.",
        type: "guideline",
        year: 2017,
        summary:
          "NSAIDs (e.g. ibuprofen, naproxen) are first-line for primary dysmenorrhea; a combined hormonal contraceptive is an option for those not seeking pregnancy.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "sogc-dysmenorrhea-redflags",
          source: "SOGC. Primary Dysmenorrhea Consensus Guideline.",
          type: "guideline",
          year: 2017,
          summary:
            "Late onset, progressive/worsening pain, dyspareunia, or pelvic abnormality suggests secondary dysmenorrhea (e.g. endometriosis) requiring physician referral.",
        },
      ],
    },
  },
  gerd: {
    regulatory: regulatoryFor("frequent heartburn / GERD"),
    primary: [
      {
        id: "cag-gerd",
        source:
          "Canadian Association of Gastroenterology. GERD Consensus Conference.",
        type: "guideline",
        year: 2018,
        summary:
          "A proton pump inhibitor taken daily is the most effective therapy for frequent heartburn; H2-receptor antagonists and antacids are alternatives for milder symptoms.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "cag-gerd-redflags",
          source:
            "Canadian Association of Gastroenterology. GERD Consensus Conference.",
          type: "guideline",
          year: 2018,
          summary:
            "Dysphagia, weight loss, gastrointestinal bleeding, anaemia, or frequent vomiting are alarm features requiring prompt physician referral.",
        },
      ],
    },
  },
  hemorrhoids: {
    regulatory: regulatoryFor("uncomplicated hemorrhoids"),
    primary: [
      {
        id: "canadian-hemorrhoids",
        source: "Canadian colorectal guidance. Symptomatic Hemorrhoids.",
        type: "guideline",
        year: 2019,
        summary:
          "First-line therapy is fibre/osmotic laxative plus a topical corticosteroid/anaesthetic product for limited duration; minimize straining.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "canadian-hemorrhoids-redflags",
          source: "Canadian colorectal guidance. Symptomatic Hemorrhoids.",
          type: "guideline",
          year: 2019,
          summary:
            "Significant rectal bleeding, dark blood mixed with stool, a palpable mass, or weight loss require physician referral to exclude colorectal malignancy.",
        },
      ],
    },
  },
  "herpes-labialis": {
    regulatory: regulatoryFor("recurrent herpes labialis"),
    primary: [
      {
        id: "canadian-hsv-labialis",
        source: "Canadian antiviral guidance. Recurrent Herpes Labialis.",
        type: "guideline",
        year: 2019,
        summary:
          "Topical or oral antiviral therapy started at the prodromal stage reduces episode duration and severity; early treatment is the key determinant of benefit.",
      },
    ],
  },
  impetigo: {
    regulatory: regulatoryFor("uncomplicated impetigo"),
    primary: [
      {
        id: "canadian-impetigo",
        source:
          "Canadian skin and soft tissue infection guidance. Uncomplicated Impetigo.",
        type: "guideline",
        year: 2019,
        summary:
          "Limited, non-bullous impetigo is treated with a topical antibiotic (mupirocin or fusidic acid); oral therapy is reserved for extensive or widespread disease.",
      },
    ],
  },
  "insect-bites-urticaria": {
    regulatory: regulatoryFor("acute urticaria and insect bites"),
    primary: [
      {
        id: "canadian-urticaria",
        source: "Canadian Dermatology Association. Urticaria Guidance.",
        type: "guideline",
        year: 2021,
        summary:
          "A second-generation (non-sedating) oral antihistamine is first-line for urticaria; a short oral corticosteroid course may be added for severe flares.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "canadian-urticaria-redflags",
          source: "Canadian Dermatology Association. Urticaria Guidance.",
          type: "guideline",
          year: 2021,
          summary:
            "Lip/tongue/throat swelling, wheeze, breathing difficulty, or hypotension indicate anaphylaxis — an emergency requiring immediate escalation, not self-care.",
        },
      ],
    },
  },
  musculoskeletal: {
    regulatory: regulatoryFor("acute uncomplicated musculoskeletal strain"),
    primary: [
      {
        id: "canadian-msk",
        source:
          "Canadian musculoskeletal guidance. Acute Soft Tissue Injury Management.",
        type: "guideline",
        year: 2020,
        summary:
          "First-line management is a topical NSAID (preferred for favourable safety profile) or oral NSAID with early mobilization; rest, ice, compression, and elevation for the acute phase.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "canadian-msk-redflags",
          source:
            "Canadian musculoskeletal guidance. Acute Soft Tissue Injury Management.",
          type: "guideline",
          year: 2020,
          summary:
            "Inability to bear weight, deformity, focal bony tenderness, a hot swollen joint, or calf swelling/warmth mandate referral to exclude fracture, septic arthritis, or DVT.",
        },
      ],
    },
  },
  "nausea-vomiting": {
    regulatory: regulatoryFor("acute nausea and vomiting"),
    primary: [
      {
        id: "canadian-nausea-vomiting",
        source:
          "Canadian gastroenterology guidance. Acute Gastroenteritis and Nausea/Vomiting.",
        type: "guideline",
        year: 2019,
        summary:
          "Oral rehydration is the foundation; ondansetron is an effective antiemetic for troublesome acute vomiting when hydration is otherwise maintained.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "canadian-nausea-vomiting-redflags",
          source:
            "Canadian gastroenterology guidance. Acute Gastroenteritis and Nausea/Vomiting.",
          type: "guideline",
          year: 2019,
          summary:
            "Signs of dehydration, severe abdominal pain, bilious/bloody vomitus, high fever, or persistent inability to keep fluids down require physician referral.",
        },
      ],
    },
  },
  nvp: {
    regulatory: regulatoryFor("nausea and vomiting of pregnancy"),
    primary: [
      {
        id: "sogc-nvp",
        source: "SOGC. The Management of Nausea and Vomiting of Pregnancy.",
        type: "guideline",
        year: 2016,
        summary:
          "First-line pharmacotherapy is the combination of doxylamine succinate and pyridoxine hydrochloride taken daily; dosing is titrated to symptoms.",
      },
    ],
    byStep: {
      nonRxAdvice: [
        {
          id: "cochrane-ginger-nvp",
          source:
            "Viljoen E, et al. A systematic review and meta-analysis of the effect and safety of ginger in the treatment of pregnancy-associated nausea and vomiting. Nutr Rev.",
          type: "study",
          year: 2014,
          doi: "10.1111/nure.12060",
          summary:
            "Ginger supplementation demonstrates a modest benefit over placebo for nausea and vomiting of pregnancy and is a reasonable non-pharmacologic adjunct.",
        },
      ],
      redFlagScreening: [
        {
          id: "sogc-nvp-redflags",
          source: "SOGC. The Management of Nausea and Vomiting of Pregnancy.",
          type: "guideline",
          year: 2016,
          summary:
            "Persistent vomiting with weight loss >5%, dehydration, or ketonuria suggests hyperemesis gravidarum and requires physician assessment.",
        },
      ],
    },
  },
  pinworms: {
    regulatory: regulatoryFor("enterobiasis (pinworms)"),
    primary: [
      {
        id: "canadian-pinworms",
        source:
          "Canadian parasitic disease guidance. Enterobiasis (Pinworm) Management.",
        type: "guideline",
        year: 2019,
        summary:
          "First-line therapy is a single oral dose of mebendazole (or albendazole), repeated after two weeks; treat household contacts and reinforce hand/perianal hygiene.",
      },
    ],
  },
  "tick-bites-lyme": {
    regulatory: regulatoryFor("tick bites and Lyme disease post-exposure prophylaxis"),
    primary: [
      {
        id: "ammi-lyme-pep",
        source: "AMMI Canada. The Diagnosis, Prevention, and Treatment of Lyme Disease.",
        type: "guideline",
        year: 2021,
        summary:
          "Post-exposure prophylaxis with a single 200 mg dose of doxycycline may be offered within 72 h of removing a high-risk Ixodes tick, applied to suitable candidates.",
      },
    ],
    byStep: {
      rxSelection: [
        {
          id: "ammi-lyme-pep-criteria",
          source: "AMMI Canada. The Diagnosis, Prevention, and Treatment of Lyme Disease.",
          type: "guideline",
          year: 2021,
          summary:
            "Prophylaxis criteria: a known Ixodes tick attached ≥36 h, the tick can be reliably removed and identified, doxycycline is not contraindicated, and prophylaxis begins within 72 h.",
        },
      ],
      redFlagScreening: [
        {
          id: "ammi-lyme-redflags",
          source: "AMMI Canada. The Diagnosis, Prevention, and Treatment of Lyme Disease.",
          type: "guideline",
          year: 2021,
          summary:
            "An established erythema migrans rash, systemic symptoms, or neurological/cardiac features indicate manifest Lyme disease requiring physician evaluation, not single-dose prophylaxis.",
        },
      ],
    },
  },
  uti: {
    regulatory: regulatoryFor("uncomplicated urinary tract infection"),
    primary: [
      {
        id: "ammi-uti-cystitis",
        source: "AMMI Canada. Management of Uncomplicated UTI in Adults.",
        type: "guideline",
        year: 2024,
        summary:
          "Nitrofurantoin 100 mg BID × 5 days is first-line for uncomplicated cystitis; avoid if CrCl <30 mL/min.",
      },
    ],
    byStep: {
      redFlagScreening: [
        {
          id: "ammi-uti-cystitis-redflags",
          source: "AMMI Canada. Management of Uncomplicated UTI in Adults.",
          type: "guideline",
          year: 2024,
          summary:
            "Pyelonephritis features (fever, flank pain, rigors), male sex, pregnancy, age <12, immunocompromise, and catheter/abnormal tract mandate referral, not pharmacist prescribing.",
        },
      ],
      followUp: [
        {
          id: "ammi-uti-followup",
          source: "AMMI Canada. Management of Uncomplicated UTI in Adults.",
          type: "guideline",
          year: 2024,
          summary:
            "Reassess at 48–72 h; refer if no improvement or if systemic symptoms develop.",
        },
      ],
    },
  },
  vvc: {
    regulatory: regulatoryFor("vulvovaginal candidiasis"),
    primary: [
      {
        id: "sogc-vvc",
        source: "SOGC. Vulvovaginal Candidiasis.",
        type: "guideline",
        year: 2024,
        summary:
          "Fluconazole 150 mg as a single oral dose is first-line in non-pregnant patients; topical azoles (e.g. clotrimazole) are first-line in pregnancy.",
      },
    ],
    byStep: {
      rxSelection: [
        {
          id: "sogc-vvc-rx",
          source: "SOGC. Vulvovaginal Candidiasis.",
          type: "guideline",
          year: 2024,
          summary:
            "Fluconazole is first-line in non-pregnant patients; topical azoles (clotrimazole) are first-line in pregnancy — avoid oral fluconazole when pregnant.",
        },
      ],
    },
  },
}

export function computeCitationsHash(
  entries: Record<string, AilmentCitations> = CITATIONS,
): string {
  const tuples = Object.keys(entries)
    .sort()
    .flatMap((slug) => {
      const a = entries[slug]
      const ids: string[] = []
      a.regulatory.forEach((c) =>
        ids.push(`${slug}|regulatory|${c.id}|${c.type}`),
      )
      a.primary.forEach((c) => ids.push(`${slug}|primary|${c.id}|${c.type}`))
      if (a.byStep) {
        ;(Object.keys(a.byStep) as ProtocolStep[])
          .sort()
          .forEach((step) => {
            a.byStep![step]!.forEach((c) =>
              ids.push(`${slug}|${step}|${c.id}|${c.type}`),
            )
          })
      }
      return ids
    })
    .join("\n")
  return createHash("sha256").update(tuples).digest("hex")
}

export const CITATIONS_HASH = computeCitationsHash(CITATIONS)

/** Flattened, de-duplicated citation list for a slug (regulatory + primary + all steps). */
export function getCitations(slug: string): Citation[] {
  const a = CITATIONS[slug]
  if (!a) return []
  const seen = new Set<string>()
  const out: Citation[] = []
  const all: Citation[] = [...a.regulatory, ...a.primary]
  if (a.byStep) {
    ;(Object.keys(a.byStep) as ProtocolStep[]).forEach((step) => {
      all.push(...(a.byStep![step] ?? []))
    })
  }
  for (const c of all) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}
