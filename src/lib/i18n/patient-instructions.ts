import { createHash } from "crypto"

// Versioned FR patient-instruction corpus. The eighth content-governance module
// (joining differentials, citations, sig-defaults, ...). Ships live in Phase 1
// as non-PHI static reference content bundled into the client — no BAA, no DB.
// See docs/superpowers/specs/2026-06-24-multilingual-patient-instructions-design.md.
export const PATIENT_INSTRUCTIONS_VERSION = "patient-instructions-fr-v1"

// Extensible LATER to "es" | "zh" | "tl" | "ar" | "pa" for ON equity without
// restructuring (FR-first per roadmap #24; QC market entry is #15).
export type Language = "en" | "fr"

export interface RegimenDirections {
  // Human-authored canonical FR directions for this regimen. The pharmacist
  // accepts this for the FR handout, or the handout falls back to the EN sig
  // the pharmacist typed. NEVER machine-translated (spec §4.3).
  fr: string
}

export interface AilmentPatientInstructions {
  // FR translation of ailment.followUp (the "when to return" sentence).
  followUpFr: string
  // FR translations of ailment.nonRx (self-care counselling items),
  // POSITIONALLY ALIGNED to the EN array in data/ailments.json:
  // nonRxFr[i] is the translation of ailment.nonRx[i]. A CI guard asserts
  // nonRxFr.length === ailment.nonRx.length for every curated slug.
  nonRxFr: string[]
  // Canonical FR directions per regimen, keyed by the EXACT drug string from
  // data/ailments.json (same keying discipline as #12's SIG_DEFAULTS). A
  // rephrase orphans the entry silently — the key-coverage test catches it.
  directionsByDrug: Record<string, RegimenDirections>
}

// Universal safety-net sentence (spec §7.7). The one net-new clinical string
// vs. translating existing followUp/nonRx; generic enough to be safe across
// all 19 ailments. Pre-authored in both languages; reviewed once.
export const SAFETY_NET_EN =
  "See a doctor or call 811 if you have a fever, your symptoms get worse, or they do not improve."
// REVIEW: bilingual pharmacist sign-off on FR wording before launch.
export const SAFETY_NET_FR =
  "Consultez un médecin ou appelez le 811 si vous avez de la fièvre, si vos symptômes s'aggravent ou s'ils ne s'améliorent pas."

// The one-line FR note shown on the FR handout when the pharmacist's typed sig
// diverges from the regimen default and no canonical FR block applies (spec
// §4.3 fallback path). Patient-safe: directions stay verbatim EN, not an MT.
export const SIG_FALLBACK_NOTE_FR =
  "Demandez à votre pharmacien de vous expliquer les directives en français."

// Keyed by ailment slug. Every string is human-authored Canadian French.
// `directionsByDrug` keys are the EXACT drug strings in data/ailments.json.
// NOTE: dermatitis lists two regimens whose drug string is identical
// ("Hydrocortisone 0.5–1%"), so both resolve to one directionsByDrug entry —
// the same fragility #12 documented; the key-coverage test accounts for it.
export const PATIENT_INSTRUCTIONS_FR: Record<string, AilmentPatientInstructions> = {
  // ── acne ───────────────────────────────────────────────────────────────────
  acne: {
    // REVIEW: bilingual pharmacist
    followUpFr:
      "Réévaluer dans 6 à 8 semaines; une amélioration est attendue d'ici 2 à 3 mois. Consulter en l'absence d'amélioration ou en cas d'aggravation.",
    nonRxFr: [
      "Nettoyage doux 2 fois par jour",
      "Hydratant non comédogène",
      "Éviter de toucher/presser les lésions",
      "Écran solaire tous les jours",
      "Éviter les gommages/astringents agressifs",
    ],
    directionsByDrug: {
      "Benzoyl peroxide 2.5–5%": {
        fr: "Appliquer une mince couche sur les zones touchées 2 fois par jour",
      },
      "Adapalene 0.1%": {
        fr: "Appliquer une mince couche sur les zones touchées au coucher",
      },
      "Tretinoin 0.025%": {
        fr: "Appliquer une mince couche sur les zones touchées au coucher",
      },
      "Clindamycin 1%": {
        fr: "Appliquer une mince couche sur les zones touchées 2 fois par jour (à utiliser avec le peroxyde de benzoyle)",
      },
      "Azelaic acid 15%": {
        fr: "Appliquer une mince couche sur les zones touchées 2 fois par jour",
      },
      "Salicylic acid 0.5–2%": {
        fr: "Appliquer sur les zones touchées 1 à 2 fois par jour",
      },
      "Dapsone 5%": {
        fr: "Appliquer une mince couche sur les zones touchées 2 fois par jour",
      },
    },
  },
  // ── allergic-rhinitis ──────────────────────────────────────────────────────
  "allergic-rhinitis": {
    followUpFr:
      "Réévaluer dans 2 semaines. Consulter en l'absence d'amélioration ou si les symptômes s'aggravent.",
    nonRxFr: [
      "Éviter les allergènes (pollen, moisissures, acariens, animaux)",
      "Lavage nasal à l'eau salée",
      "Garder les fenêtres fermées lors des pics de pollen",
      "Prendre une douche après une exposition extérieure",
      "Filtres HEPA",
    ],
    directionsByDrug: {
      "Fluticasone nasal": {
        fr: "Pulvériser 1 à 2 fois dans chaque narine 1 fois par jour",
      },
      "Mometasone nasal": {
        fr: "Pulvériser 2 fois dans chaque narine 1 fois par jour",
      },
      "Cetirizine 10 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour",
      },
      "Loratadine 10 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour",
      },
      "Fexofenadine 180 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour",
      },
      "Desloratadine 5 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour",
      },
      "Bilastine 20 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour à jeun",
      },
    },
  },
  // ── aphthous-ulcers ────────────────────────────────────────────────────────
  "aphthous-ulcers": {
    followUpFr:
      "Amélioration attendue en 7 à 10 jours. Consulter en l'absence d'amélioration après 14 jours ou en cas de récidives fréquentes.",
    nonRxFr: [
      "Éviter les aliments épicés/acides/durs/croquants",
      "Dentifrice sans SLS (laurylsulfate de sodium)",
      "Bains de bouche à l'eau salée tiède",
      "Brosse à dents à poils souples",
    ],
    directionsByDrug: {
      "Triamcinolone dental paste": {
        fr: "Appliquer un fin film sur l'ulcère 2 à 4 fois par jour après les repas",
      },
    },
  },
  // ── candidal-stomatitis ────────────────────────────────────────────────────
  "candidal-stomatitis": {
    followUpFr:
      "Réévaluer dans 7 jours. Consulter en l'absence d'amélioration ou si des symptômes systémiques apparaissent.",
    nonRxFr: [
      "Rincer la bouche/se gargariser après l'utilisation de corticoïdes inhalés",
      "Utiliser une chambre d'inhalation pour les inhalateurs pressurisés",
      "Retirer et nettoyer les prothèses dentaires chaque soir",
      "Cessation du tabagisme",
      "Optimiser le contrôle de la glycémie",
    ],
    directionsByDrug: {
      "Nystatin oral suspension": {
        fr: "Faire circuler 1 mL (100 000 unités) dans la bouche et avaler, 4 fois par jour",
      },
    },
  },
  // ── conjunctivitis ─────────────────────────────────────────────────────────
  conjunctivitis: {
    followUpFr:
      "Bactérienne : réévaluer dans 48 h. Virale/allergique : réévaluer dans 3 jours. Consulter en l'absence d'amélioration ou en cas d'aggravation.",
    nonRxFr: [
      "Hygiène stricte des mains",
      "Éviter de toucher/frotter les yeux",
      "Compresses froides ou tièdes",
      "Jeter le maquillage contaminé",
      "Arrêter les lentilles de contact jusqu'à la guérison",
    ],
    directionsByDrug: {
      "Polymyxin B/Gramicidin drops": {
        fr: "Instiller 1 à 2 gouttes dans le ou les yeux touchés 4 fois par jour",
      },
      "Polymyxin B/Trimethoprim drops": {
        fr: "Instiller 1 à 2 gouttes dans le ou les yeux touchés 4 fois par jour",
      },
      "Erythromycin ointment": {
        fr: "Appliquer un petit cordon dans le ou les yeux touchés 4 fois par jour",
      },
      "Fusidic acid drops": {
        fr: "Instiller 1 goutte dans le ou les yeux touchés 2 fois par jour",
      },
      "Ketotifen drops": {
        fr: "Instiller 1 goutte dans le ou les yeux touchés 2 fois par jour",
      },
      "Olopatadine drops": {
        fr: "Instiller 1 goutte dans le ou les yeux touchés 2 fois par jour",
      },
    },
  },
  // ── dermatitis ─────────────────────────────────────────────────────────────
  dermatitis: {
    followUpFr:
      "Réévaluer dans 7 jours. Consulter en l'absence d'amélioration ou en cas de signes d'infection.",
    nonRxFr: [
      "Changer souvent la couche (aux 2 à 4 h)",
      "Séchage à l'air, nettoyage doux",
      "Crème barrière : oxyde de zinc 10 à 40 %",
      "Éviter les produits parfumés",
      "Hydratation régulière (dermatite atopique)",
      "Repérer et éviter les déclencheurs (contact)",
    ],
    directionsByDrug: {
      "Hydrocortisone 0.5–1%": {
        fr: "Appliquer une mince couche sur la zone touchée 2 fois par jour",
      },
      "Desonide 0.05%": {
        fr: "Appliquer une mince couche sur la zone touchée 2 fois par jour",
      },
      "Betamethasone valerate 0.1%": {
        fr: "Appliquer une mince couche sur la zone touchée 2 fois par jour (maximum 2 semaines)",
      },
      "Triamcinolone 0.1%": {
        fr: "Appliquer une mince couche sur la zone touchée 2 fois par jour",
      },
      "Clobetasone 0.05%": {
        fr: "Appliquer une mince couche sur la zone touchée 2 fois par jour",
      },
      "Clotrimazole 1% cream": {
        fr: "Appliquer sur la zone touchée 3 fois par jour",
      },
      "Miconazole 2% cream": {
        fr: "Appliquer sur la zone touchée 2 fois par jour",
      },
      "Nystatin cream/powder": {
        fr: "Appliquer sur la zone touchée 4 fois par jour",
      },
    },
  },
  // ── dysmenorrhea ───────────────────────────────────────────────────────────
  dysmenorrhea: {
    followUpFr:
      "Réévaluer après 3 cycles menstruels. Consulter en l'absence d'amélioration ou si les symptômes s'aggravent.",
    nonRxFr: [
      "Application de chaleur (coussin chauffant/bouillotte)",
      "Exercice régulier (yoga, étirements)",
      "Repos suffisant",
    ],
    directionsByDrug: {
      "Ibuprofen 400 mg": {
        fr: "Prendre 1 comprimé par voie orale aux 6 à 8 heures au besoin (maximum 1200 mg/jour)",
      },
      "Naproxen sodium 220 mg": {
        fr: "Prendre 1 à 2 comprimés initialement, puis 1 comprimé aux 8 à 12 heures au besoin (maximum 660 mg/jour)",
      },
    },
  },
  // ── gerd ───────────────────────────────────────────────────────────────────
  gerd: {
    followUpFr:
      "Réévaluer dans 2 semaines. Consulter en l'absence d'amélioration ou en cas de symptômes d'alarme.",
    nonRxFr: [
      "Perte de poids",
      "Surélever la tête du lit de 10 cm",
      "Éviter de manger 3 h avant de s'allonger",
      "Éviter les déclencheurs : aliments gras, chocolat, caféine, alcool, menthe",
      "Cessation du tabagisme",
      "Éviter les vêtements serrés",
    ],
    directionsByDrug: {
      "Calcium carbonate": {
        fr: "Mâcher 500 à 1000 mg au besoin pour les brûlures d'estomac",
      },
      "Famotidine 20 mg": {
        fr: "Prendre 1 à 2 comprimés par voie orale 1 fois par jour ou 2 fois par jour",
      },
      "Omeprazole 20 mg": {
        fr: "Prendre 1 capsule par voie orale 1 fois par jour avant le déjeuner",
      },
      "Pantoprazole 20 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour avant le déjeuner",
      },
      "Esomeprazole 20 mg": {
        fr: "Prendre 1 capsule par voie orale 1 fois par jour",
      },
    },
  },
  // ── hemorrhoids ────────────────────────────────────────────────────────────
  hemorrhoids: {
    followUpFr:
      "Réévaluer dans 7 jours. Consulter en l'absence d'amélioration ou en cas de signes d'alarme.",
    nonRxFr: [
      "Alimentation riche en fibres (25 à 38 g/jour)",
      "Apport suffisant en liquides (2 L/jour)",
      "Bains de siège 3 à 4 fois par jour",
      "Éviter de forcer et les longues séances aux toilettes (>5 min)",
      "Hygiène périanale douce",
    ],
    directionsByDrug: {
      "Hydrocortisone cream/suppository": {
        fr: "Appliquer ou insérer 2 fois par jour (maximum 7 jours)",
      },
      "Pramoxine cream": {
        fr: "Appliquer sur la zone touchée jusqu'à 4 fois par jour au besoin",
      },
      "Phenylephrine ointment": {
        fr: "Appliquer sur la zone touchée jusqu'à 4 fois par jour",
      },
      "Zinc oxide paste": {
        fr: "Appliquer sur la zone touchée au besoin",
      },
      "Witch hazel pads": {
        fr: "Appliquer sur la zone touchée au besoin",
      },
    },
  },
  // ── herpes-labialis ────────────────────────────────────────────────────────
  "herpes-labialis": {
    followUpFr:
      "Réévaluer dans 7 à 10 jours. Consulter en l'absence d'amélioration ou si les lésions sont près des yeux.",
    nonRxFr: [
      "Baume à lèvres FPS 30+ (le soleil est un déclencheur)",
      "Éviter de toucher/propager le virus",
      "Garder la lésion propre avec un savon doux et de l'eau",
      "Éviter de partager ustensiles, serviettes, cosmétiques",
      "Commencer le traitement au premier signe (prodrome)",
    ],
    directionsByDrug: {
      "Acyclovir cream 5%": {
        fr: "Appliquer sur la lésion 5 fois par jour pendant 4 jours (débuter au prodrome)",
      },
      "Docosanol 10% cream": {
        fr: "Appliquer sur la lésion 5 fois par jour jusqu'à la guérison",
      },
      "Acyclovir 400 mg": {
        fr: "Prendre 1 comprimé par voie orale 3 fois par jour pendant 5 jours",
      },
      "Valacyclovir 2 g": {
        fr: "Prendre 2 g par voie orale 2 fois par jour pendant 1 jour",
      },
      "Famciclovir 1500 mg": {
        fr: "Prendre 1500 mg par voie orale en dose unique",
      },
    },
  },
  // ── impetigo ───────────────────────────────────────────────────────────────
  impetigo: {
    followUpFr:
      "Réévaluer dans 5 à 7 jours. Consulter en l'absence d'amélioration ou si des symptômes systémiques apparaissent.",
    nonRxFr: [
      "Compresses tièdes pour retirer les croûtes",
      "Lavage doux au savon et à l'eau",
      "Garder les ongles courts",
      "Éviter de partager serviettes et linge",
      "Couvrir les lésions lâchement",
      "Hygiène stricte des mains",
    ],
    directionsByDrug: {
      "Mupirocin 2% ointment": {
        fr: "Appliquer sur la zone touchée 3 fois par jour",
      },
      "Fusidic acid 2% cream": {
        fr: "Appliquer sur la zone touchée 3 fois par jour",
      },
      "Ozenoxacin 1% cream": {
        fr: "Appliquer sur la zone touchée 2 fois par jour",
      },
    },
  },
  // ── insect-bites-urticaria ─────────────────────────────────────────────────
  "insect-bites-urticaria": {
    followUpFr:
      "Réévaluer dans 3 à 5 jours. Consulter en cas de signes d'infection ou d'absence d'amélioration.",
    nonRxFr: [
      "Retirer le dard d'abeille en grattant (sans presser)",
      "Laver au savon et à l'eau",
      "Compresse froide/poche de glace",
      "Éviter de gratter",
      "Utiliser un chasse-moustiques (DEET/icaridine)",
      "Porter des vêtements protecteurs",
    ],
    directionsByDrug: {
      "Cetirizine 10 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour",
      },
      "Loratadine 10 mg": {
        fr: "Prendre 1 comprimé par voie orale 1 fois par jour",
      },
      "Diphenhydramine 25–50 mg": {
        fr: "Prendre 25 à 50 mg par voie orale aux 6 à 8 heures au besoin",
      },
      "Hydrocortisone 1% cream": {
        fr: "Appliquer sur la zone touchée 2 fois par jour",
      },
      "Calamine lotion": {
        fr: "Appliquer sur la zone touchée au besoin",
      },
    },
  },
  // ── musculoskeletal ────────────────────────────────────────────────────────
  musculoskeletal: {
    followUpFr:
      "Réévaluer dans 1 à 2 semaines. Consulter en l'absence d'amélioration ou en cas de signes d'alarme.",
    nonRxFr: [
      "Rester actif (éviter le repos au lit)",
      "RICE pour les blessures aiguës : Repos, Glace, Compression, Élévation (premières 24 à 48 h)",
      "Chaleur pour la douleur musculaire",
      "Bonnes techniques de levage",
      "Retour progressif à l'activité",
    ],
    directionsByDrug: {
      "Ibuprofen 400 mg": {
        fr: "Prendre 1 comprimé par voie orale aux 6 à 8 heures au besoin (maximum 1200 mg/jour)",
      },
      "Naproxen sodium 220 mg": {
        fr: "Prendre 1 à 2 comprimés initialement, puis 1 comprimé aux 8 à 12 heures au besoin (maximum 660 mg/jour)",
      },
      "Diclofenac gel 1%": {
        fr: "Appliquer sur la zone touchée 4 fois par jour",
      },
      "Acetaminophen 500 mg": {
        fr: "Prendre 1 à 2 comprimés par voie orale aux 6 heures au besoin (maximum 3000 à 4000 mg/jour)",
      },
    },
  },
  // ── nausea-vomiting ────────────────────────────────────────────────────────
  "nausea-vomiting": {
    followUpFr:
      "Réévaluer dans 24 à 48 h. Consulter en l'absence d'amélioration ou en cas de signes d'alarme.",
    nonRxFr: [
      "Réhydratation orale (petites gorgées fréquentes)",
      "Éviter les repas gras ou copieux",
      "Repos",
      "Gingembre",
    ],
    directionsByDrug: {
      "Dimenhydrinate 50 mg": {
        fr: "Prendre 1 à 2 comprimés par voie orale aux 4 à 6 heures au besoin (maximum 400 mg/jour)",
      },
      "Diphenhydramine 25–50 mg": {
        fr: "Prendre 25 à 50 mg par voie orale aux 6 à 8 heures au besoin",
      },
      "Promethazine 12.5–25 mg": {
        fr: "Prendre 12,5 à 25 mg par voie orale aux 4 à 6 heures au besoin",
      },
    },
  },
  // ── nvp (nausea & vomiting of pregnancy) ───────────────────────────────────
  nvp: {
    followUpFr:
      "Réévaluer dans 1 semaine. Consulter en l'absence d'amélioration ou en cas de signes d'hyperemesis gravidarum.",
    nonRxFr: [
      "Petits repas fréquents et fades",
      "Biscuits salés avant de sortir du lit",
      "Séparer les solides et les liquides",
      "Éviter les déclencheurs et les odeurs fortes",
      "Bracelets d'acupression au point P6",
      "Gingembre",
    ],
    directionsByDrug: {
      "Pyridoxine (B6) 25 mg": {
        fr: "Prendre 1 comprimé par voie orale 3 fois par jour",
      },
      "Doxylamine 10 mg + Pyridoxine 10 mg": {
        fr: "Prendre 1 à 2 comprimés au coucher; possibilité d'ajouter 1 comprimé le matin ou l'après-midi au besoin",
      },
      "Dimenhydrinate 50 mg": {
        fr: "Prendre 50 mg par voie orale aux 6 à 8 heures au besoin",
      },
      "Diphenhydramine 25–50 mg": {
        fr: "Prendre 25 à 50 mg par voie orale aux 6 à 8 heures au besoin",
      },
    },
  },
  // ── pinworms ───────────────────────────────────────────────────────────────
  pinworms: {
    followUpFr:
      "Répéter la dose dans 2 semaines dans tous les cas. Consulter si les symptômes persistent après le deuxième traitement.",
    nonRxFr: [
      "**Traiter TOUS les membres du ménage simultanément**",
      "Douches matinales",
      "Se laver les mains et les ongles fréquemment",
      "Garder les ongles courts",
      "Laver la literie, les sous-vêtements et les serviettes à l'eau chaude tous les jours × 2 semaines",
      "Éviter de secouer le linge",
      "Passer l'aspirateur dans les chambres",
    ],
    directionsByDrug: {
      "Mebendazole 100 mg": {
        fr: "Prendre 1 comprimé en dose unique; répéter dans 2 semaines",
      },
      "Pyrantel pamoate": {
        fr: "Prendre 11 mg/kg (maximum 1 g) en dose unique; répéter dans 2 semaines",
      },
    },
  },
  // ── tick-bites-lyme ────────────────────────────────────────────────────────
  "tick-bites-lyme": {
    followUpFr:
      "Inviter le patient à surveiller les symptômes × 30 jours. Consulter immédiatement en cas d'érythème migrant ou de symptômes systémiques.",
    nonRxFr: [
      "Retrait adéquat de la tique : pince à bouts fins, saisir près de la peau, tirer droit vers le haut",
      "Nettoyer la région au savon et à l'eau",
      "Surveiller les symptômes × 30 jours",
      "Utiliser des chasse-moustiques (DEET/icaridine)",
      "Vérification quotidienne des tiques",
      "Soumettre une photo de la tique à eTick.ca pour la surveillance",
    ],
    directionsByDrug: {
      Doxycycline: {
        fr: "Prendre 200 mg par voie orale en dose unique (enfants : 4 mg/kg, maximum 200 mg)",
      },
    },
  },
  // ── uti ────────────────────────────────────────────────────────────────────
  uti: {
    followUpFr:
      "Inviter le patient à revenir en l'absence d'amélioration dans les 48 à 72 h. Consulter si les symptômes s'aggravent ou si des symptômes systémiques apparaissent.",
    nonRxFr: [
      "Augmenter l'apport de liquides",
      "Uriner après les rapports sexuels",
      "Essuyage adéquat (d'avant en arrière)",
      "Éviter les spermicides en cas de récidive",
      "Sous-vêtements de coton",
    ],
    directionsByDrug: {
      "Nitrofurantoin 100 mg": {
        fr: "Prendre 1 capsule par voie orale 2 fois par jour avec de la nourriture",
      },
      "TMP-SMX (160/800 mg)": {
        fr: "Prendre 1 comprimé par voie orale 2 fois par jour",
      },
      "Trimethoprim 100 mg": {
        fr: "Prendre 1 comprimé par voie orale 2 fois par jour",
      },
      "Fosfomycin 3 g": {
        fr: "Prendre 1 sachet (3 g) par voie orale en dose unique à jeun",
      },
    },
  },
  // ── vvc (vulvovaginal candidiasis) ─────────────────────────────────────────
  vvc: {
    followUpFr:
      "Réévaluer dans 7 jours. Consulter en l'absence d'amélioration ou en cas de signes d'alarme.",
    nonRxFr: [
      "Éviter les douches vaginales, les produits parfumés et les savons agressifs",
      "Porter des sous-vêtements de coton et des vêtements amples",
      "Garder la région au sec",
      "Éviter de porter longtemps un maillot de bain humide",
    ],
    directionsByDrug: {
      "Fluconazole 150 mg": {
        fr: "Prendre 1 comprimé par voie orale en dose unique",
      },
      "Clotrimazole 1% cream": {
        fr: "Insérer 5 g dans le vagin tous les jours au coucher",
      },
      "Clotrimazole 2% cream": {
        fr: "Insérer 5 g dans le vagin tous les jours au coucher",
      },
      "Miconazole 2% cream": {
        fr: "Insérer 5 g dans le vagin tous les jours au coucher",
      },
      "Miconazole 100 mg suppository": {
        fr: "Insérer 1 suppositoire dans le vagin tous les jours au coucher",
      },
      "Terconazole 0.4% cream": {
        fr: "Insérer 5 g dans le vagin tous les jours au coucher",
      },
    },
  },
}

// Returns the FR instructions for a curated slug, or undefined for "en" (EN is
// the source of truth in data/ailments.json) and for any un-curated slug.
export function getPatientInstructions(
  slug: string,
  language: Language,
): AilmentPatientInstructions | undefined {
  if (language === "en") return undefined
  return PATIENT_INSTRUCTIONS_FR[slug]
}

export function getFrDirections(
  slug: string,
  drug: string,
): string | undefined {
  return PATIENT_INSTRUCTIONS_FR[slug]?.directionsByDrug?.[drug]?.fr
}

// sha256 over a key-sorted canonical tuple list (slug | followUpFr | nonRxFr |
// sorted directionsByDrug.fr). Reproducible from the build regardless of object
// key insertion order; matches the differentials/citations hash discipline.
export function computePatientInstructionsHash(
  entries: Readonly<Record<string, AilmentPatientInstructions>> = PATIENT_INSTRUCTIONS_FR,
): string {
  const tuples = Object.keys(entries)
    .sort()
    .flatMap((slug) => {
      const a = entries[slug]
      const dirTuples = Object.keys(a.directionsByDrug)
        .sort()
        .map((drug) => `${drug}=${a.directionsByDrug[drug].fr}`)
      return [
        `${slug}|followUp|${a.followUpFr}`,
        `${slug}|nonRx|${a.nonRxFr.join("§")}`,
        `${slug}|directions|${dirTuples.join("§")}`,
      ]
    })
    .join("\n")
  return createHash("sha256").update(tuples).digest("hex")
}

export const PATIENT_INSTRUCTIONS_HASH = computePatientInstructionsHash(
  PATIENT_INSTRUCTIONS_FR,
)
