# Multilingual Patient Instructions (FR-first) — Design

**Date:** 2026-06-24
**Roadmap item:** #24 (NEXT tier) — "Multilingual patient instructions (FR-first) — Opens QC entry + ON equity. PharmAssess excludes QC entirely."
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST produces exactly one document per consult today: the **Combined Prescription PDF** (`src/components/combined-pdf.tsx`), a medico-legal record authored *for the pharmacist, the physician (faxed), and the college auditor*. It is English-only, clinical in register, and structurally not a patient handout. The **only** patient-education strings the system carries are two fields sourced from `data/ailments.json` and rendered onto that clinical PDF:

- `ailment.followUp` (`src/types/index.ts:15`) — a single sentence telling the patient when to return (e.g. UTI `"Reassess in 48–72 hours..."`, acne `"Reassess in 6–8 weeks..."`). Printed at `combined-pdf.tsx:237` and shown to the pharmacist at `step-rx.tsx:143`.
- `ailment.nonRx` (`src/types/index.ts:14`) — the self-care / counselling checklist (e.g. `"Gentle cleansing 2×/day"`, `"Sunscreen daily"`). Printed at `combined-pdf.tsx:287-299` and surfaced as a checkbox list at `step-rx.tsx:113-139`.

A `rg` for `i18n|locale|translate|translation|next-intl|react-intl|french|français|langue|getTranslation` across `src/` returns **zero** matches — no internationalisation library, no translation map, no language switcher, no FR content anywhere. `package.json` carries no `next-intl`, `react-intl`, `i18next`, or any localisation dependency. Every UI string is a hard-coded English literal (`"Select Prescription"` at `step-rx.tsx:37`, `"Download Prescription + Doctor Notification PDF"` at `step-generate.tsx:76`, `"Ontario Minor Ailment Assessment — O. Reg. 256/24"` at `wizard-container.tsx:110`). The date is hard-locked to English Canada: `new Date().toLocaleDateString("en-CA")` at `step-generate.tsx:23` and `wizard-container.tsx:90`.

Roadmap item #24 is "Multilingual patient instructions (**FR-first**)". The competitive wedge is explicit in the roadmap: **PharmAssess excludes Québec entirely**, and Ontario has a large Francophone population (especially Eastern and Northern Ontario) for whom a French patient handout is an equity and service-quality differentiator, not a nicety. The roadmap scores this feature **Clinical/Market** — its job is to give the pharmacist something to *hand the patient* in the patient's preferred language, not to translate the pharmacist's own workspace.

This feature therefore produces a **second, separate document**: a **bilingual Patient Instructions handout** generated alongside the Combined Prescription PDF, carrying the follow-up advice, the self-care counselling items, and a canonical "how to use your medication" directions block — authored once in Canadian French, versioned and hashed, and printable in EN, FR, or both (two pages). The pharmacist's clinical workspace (the wizard, the Combined Prescription PDF, the Referral PDF) stays English for NOW — full pharmacist-UI i18n is a LATER, QC-market-readiness effort (roadmap #15) and is explicitly out of scope here because Ontario pharmacists work in English and FR-first is about the *patient artefact*, not the *clinician UI*.

**The goal of this feature** is that a Francophone patient leaves an Ontario minor-ailments consult with a readable, clinically-accurate French instruction sheet for their ailment and regimen — produced in the same 3-minute counter window, with zero new infrastructure (no fly.io, no BAA, no translator API, no new dependency), shipping **live in Phase 1** as non-PHI static reference content bundled into the client, exactly as #6 (differentials), #9 (citations), #22 (vaccine catalog inventory ledger), and #12 (smart-sig defaults) do.

**Out of scope** (per roadmap §3 and the feature's own discipline):
- **Pharmacist-UI i18n** (translating every label, button, step title, the wizard chrome). That is a separate, much larger effort tied to Québec market entry (#15). #24 produces the *patient handout* only.
- **Machine translation at generation time** (calling a translation API on the fly). The sig + ailment context is PHI/clinical; on-the-fly MT is non-deterministic, BAA-gated, and — most importantly — a mistranslated dose instruction ("take one tablet twice daily" → a wrong frequency) is a **sentinel patient-safety event**. Clinical content must be human-authored, human-reviewed, and version-pinned, the exact governance argument #6/#9/#22/#7-template make against AI for deterministic clinical content. #24's FR corpus is therefore pre-authored, not generated.
- **Translating the pharmacist-edited `selectedRx.sig`** (the free-text directions the pharmacist types at `step-rx.tsx:71-77`). The sig is the legal Rx; auto-translating the pharmacist's typed English into French would be unsafe MT over medico-legal text. Instead, #24 ships a **canonical FR directions block per regimen** (human-authored, matching the smart-sig module #12 keys), which the pharmacist either accepts or leaves at the EN default — the handout never silently MTs the pharmacist's wording. See §4.3 and Open Question §7.1.
- **Clinical-safety validation** (allergy / interaction / pregnancy gating of the translated content) — PMS-owned, out of scope per roadmap §3, exactly as #6/#9/#12 respect.
- **Full QC regulatory compliance** (Bill 96 French-language service requirements for the *software*, OPAQ/Ordre des pharmaciens du Québec alignment, provincial formulary). #24 claims ON-Francophone-equity + future-QC-readiness, not "QC-certified". QC market entry is #15.

---

## 2. Current State (what exists in code)

### 2.1 The two patient-facing strings, and their single render surface

The CDST's entire patient-education surface is two fields on the `Ailment` type (`src/types/index.ts:7-16`):

```ts
export interface Ailment {
  id: string
  name: string
  slug: string
  symptoms: string[]
  redFlags: string[]
  rxOptions: RxOption[]
  nonRx: string[]        // ← patient counselling items (self-care)
  followUp: string       // ← patient follow-up advice (when to return)
}
```

Both are sourced from `data/ailments.json` (loaded by `src/lib/ailments.ts:1-4` via `import ailmentsData from "../../data/ailments.json"`) and rendered in exactly two places each:

| Field | On-screen (pharmacist view) | On PDF (the record) |
|---|---|---|
| `ailment.followUp` | `step-rx.tsx:143` (`<p>{ailment.followUp}</p>`) | `combined-pdf.tsx:237` (`Follow-up: {ailment.followUp}`) |
| `ailment.nonRx` | `step-rx.tsx:113-139` (checkbox list, `ailment.nonRx.map(item => ...)`) | `combined-pdf.tsx:287-299` (checked items only, via `filterCheckedItems` at `combined-pdf.tsx:183`) |

There is **no separate patient document**. The Combined Prescription PDF (`src/components/combined-pdf.tsx`, 325 lines) bundles the prescription table (`:268-284`), the patient demographics block (`:217-229`), the assessment summary (`:230-238`), the family-physician fax block (`:241-250`), the symptoms list (`:254-264`), the non-Rx advice (`:287-299`), the assessment notes (`:301-306`), the pharmacist signature line (`:309-315`), and the PHIPA footer (`:317-321`) onto a single Letter page. It is a **clinician-facing medico-legal record**, dense (fontSize 7.5, Helvetica, multi-column), faxed to the physician. It is not a patient handout, and layering a language toggle onto it would conflate two distinct document purposes.

The `rxOptions[].notes` field (`src/types/index.ts:4`, e.g. acne `"First-line; bleaches fabric"`, UTI nitrofurantoin `"Avoid if CrCl <30"`) is **pharmacist-facing clinical advisory**, never patient-facing — it is rendered only at `step-rx.tsx:55-57` to guide the pharmacist's regimen choice, and is deliberately **not** printed on the Combined PDF. It is out of scope for patient translation.

### 2.2 The third patient-facing string is the sig — and it is pharmacist-authored free text

`selectedRx.sig` (`src/types/index.ts:53`, part of `SelectedRx extends RxOption`) is the "Directions (Sig)" the patient follows (e.g. `"1 cap BID × 5 days"`). Unlike `followUp` and `nonRx`, it is **not** sourced from `data/ailments.json` as a final value — it is seeded from `rx.dose` and then **fully pharmacist-editable** in a free-text `<Input>` at `step-rx.tsx:71-77`:

```tsx
<Input id="sig" aria-label="Directions" value={selectedRx.sig}
  onChange={(e) => handleFieldChange("sig", e.target.value)} />
```

The seed is set in exactly one place, `handleSelectRx` at `wizard-container.tsx:70-78`, which hardcodes `sig: rx.dose` (the regimen's frequency string). Feature #12 (smart-sig-auto-suggest) will later upgrade this seed to a curated default; #24 layers a *parallel FR directions block* on top, keyed the same way #12 keys its defaults, so the two features compose. The sig is printed verbatim on the Combined PDF at `combined-pdf.tsx:280` (`{selectedRx.sig}`). Because the pharmacist can type anything, the sig **cannot be auto-translated safely** — see §4.3 and Open Question §7.1.

### 2.3 Zero i18n infrastructure

A `rg` for `i18n|locale|translate|translation|next-intl|react-intl|i18next|french|français` across `src/` and `package.json` returns **zero** true positives (only CSS `transform: translateY` false-positives in `globals.css`, `dialog.tsx`, `button.tsx`, `ailment-card.tsx`). There is:

- No locale state anywhere (no `useState<'en'|'fr'>`, no cookie, no `Accept-Language` read, no per-pharmacy language preference column).
- No localisation library in `package.json` (dependencies are: `@base-ui/react`, `@react-pdf/renderer`, `@supabase/ssr`, `@supabase/supabase-js`, `class-variance-authority`, `clsx`, `gray-matter`, `lucide-react`, `next`, `react`, `react-dom`, `shadcn`, `tailwind-merge`, `tw-animate-css`).
- No FR content anywhere. The string `"O. Reg. 256/24"` appears as a hard-coded English literal at `wizard-container.tsx:110`, `combined-pdf.tsx:321`, `referral-pdf.tsx:234`. The PHIPA footer text is hard-coded English at `combined-pdf.tsx:319` and `referral-pdf.tsx:232`. The date formatter is hard-locked to `"en-CA"` at `step-generate.tsx:23` and `wizard-container.tsx:90`.

### 2.4 The wizard is ailment-anchored; the regimen is known by step 2

`assess/[ailment]/page.tsx:9-16` resolves one fixed `ailment` from the route param and passes it as a single prop to `<WizardContainer ailment={ailment}>` (`page.tsx:53`). The wizard always knows `ailment.slug` from mount. The selected regimen (`selectedRx.drug`) is known by the time the pharmacist reaches step 3 (`step-generate.tsx`), because step 2 (`step-rx.tsx:39-62`) requires a regimen selection to advance (`wizard-container.tsx:57-58`: `canNext` for step 2 requires `selectedRx !== null`). So **by the time the pharmacist reaches the generate step, both join keys needed to resolve the FR corpus — `ailment.slug` and `selectedRx.drug` — are already in component state**. The translation lookup is a pure in-memory map read, no async, no server round-trip, no PHI.

### 2.5 The 19 ailments and 80 regimens that need an FR corpus

`data/ailments.json` carries 19 ailments (slugs confirmed by `rg '"slug":'`: `acne`, `allergic-rhinitis`, `aphthous-ulcers`, `candidal-stomatitis`, `conjunctivitis`, `dermatitis`, `dysmenorrhea`, `gerd`, `hemorrhoids`, `herpes-labialis`, `impetigo`, `insect-bites-urticaria`, `musculoskeletal`, `nausea-vomiting`, `nvp`, `pinworms`, `tick-bites-lyme`, `uti`, `vvc`) and, per the #12 spec's census, **80 Rx options total**. Each ailment has 1 follow-up string and 3–8 non-Rx counselling strings. The FR corpus therefore covers **19 follow-up strings + ~90 non-Rx strings + up to 80 canonical FR directions blocks** — roughly 190 strings, all short, all clinical-counselling register, all human-authored.

### 2.6 The content-governance precedent this feature joins

The codebase has no `src/lib/clinical/` directory today (the modules #3/#4/#6/#9/#10/#12/#22 specify are planned, not yet implemented — this is a docs-only run). But the **precedent** is now firmly established across seven prior specs: curated clinical/governance content needing a reproducible content hash lives in a **versioned TS module under `src/lib/`** (never `data/`, which the gnhf constraint forbids editing and which has no build-pinned hash), carrying a `*_VERSION` constant and a `compute*Hash()` function over `node:crypto`. #24's FR corpus is the eighth such module. See §4.1.

### 2.7 PDF generation is 100% client-side

`downloadPdf` at `src/lib/pdf-helpers.ts:5` uses `pdf(document).toBlob()` — the server never sees document bytes. This is the property #1 (e-fax), #3 (consent signature baked into PDF), #7 (SOAP note), and #11 (pharmacist e-signature) all rely on. #24 reuses it: the Patient Instructions handout is rendered client-side from the in-memory FR corpus + the wizard's selected regimen, so **no PHI and no translation content crosses to the server**. The only server touch is the existing `pdf.generated` audit event (already declared at `audit-actions.ts:17` but with no call site today — #2 §6 wires it).

---

## 3. Approach (options + recommendation)

### Option A — Versioned FR corpus module + separate Patient Instructions PDF + language toggle on the generate step (RECOMMENDED)

A new `src/lib/i18n/patient-instructions.ts` module (versioned + hashed, the eighth content-governance module) carrying the FR translations for `followUp` and `nonRx` for all 19 ailments, plus a canonical FR `sig` (directions) block per regimen keyed identically to #12's smart-sig keys (`${ailmentSlug}::${drug}`). A new `src/components/patient-instructions-pdf.tsx` @react-pdf/renderer document — a **patient handout**, not a clinical record — rendered in EN, FR, or both (two pages) based on a language toggle added to `step-generate.tsx`. The toggle fires `downloadPdf` a second time (or produces a two-page doc) alongside the existing Combined Prescription download.

**Ships LIVE in Phase 1 with no database, no BAA, no flag, no new dependency.** The entire feature is non-PHI static reference content (ailment slug + translated text) bundled into the client, plus a client-rendered PDF — the same "non-PHI ships live immediately" property #6/#9/#22/#12 established. The FR corpus is human-authored Canadian French, reviewed by a bilingual pharmacist/translator (a soft gate, not a code gate). The pharmacist's typed `selectedRx.sig` is **never auto-translated**; the handout carries the canonical FR directions block which the pharmacist accepts or the handout falls back to the EN sig (see §4.3).

### Option B — Full app i18n via `next-intl` (translate the entire pharmacist UI + content)

Adopt `next-intl` (or `react-intl`), introduce a locale router, translate every hard-coded UI string (wizard labels, step titles, buttons, the Combined PDF, the Referral PDF, emails), persist a per-pharmacy locale preference on Supabase, and render the whole app in EN or FR.

**Rejected.** It is a 5–10× larger effort than the patient-handout scope roadmap #24 actually names; it conflates *patient instructions* (the roadmap ask) with *clinician workspace localisation* (a QC-market-readiness project, #15); it adds a non-trivial dependency and a locale-routing layer the current single-locale app has no need for; and Ontario pharmacists work in English regardless of patient language, so FR-pharmacist-UI delivers no counter-speed or equity value in the NOW/NEXT horizon. The patient artefact is the wedge; the clinician UI is LATER.

### Option C — On-the-fly machine translation (call a translation API at generation time)

Call a translation provider (DeepL, Azure Translator, Google Translate) at PDF-generation time to translate the EN `followUp`/`nonRx`/`sig` into the patient's language on demand. Avoids pre-authoring a corpus; supports any language instantly.

**Rejected.** Three independent fatal flaws: (i) **patient safety** — a mistranslated dose frequency or follow-up window is a sentinel event, and MT over clinical text is not reviewable per-occurrence; (ii) **PHI/BAA** — the sig + ailment context is PHI/clinical, so the translation call is a PHI disclosure requiring a signed BAA + zero-retention terms with the translator (the same gate #7's LLM hits), blocking the feature behind procurement; (iii) **non-determinism** — the same consult yields different wording on re-download, destroying the audit-defensibility and reproducibility that #2's `protocol_version` / #3's `statement_hash` / #9's `CITATIONS_VERSION` exist to guarantee. Pre-authored, versioned, hashed human translation is the only defensible choice for clinical content — the identical argument every prior content-governance spec made.

### Recommendation

**Option A.** It is the faithful, minimal implementation of roadmap #24: it produces a French patient instruction artefact (the wedge — PharmAssess excludes QC, ON has Francophones), it makes the correct content-governance choice (versioned hashed `src/lib/i18n/` module, the eighth in the precedent chain), it makes the correct document choice (a *separate patient handout*, not a language toggle on the medico-legal Combined PDF), it makes the correct translation choice (human-authored canonical FR, never MT over the pharmacist's typed sig — patient-safety first), and — uniquely among translation designs — it **ships live in Phase 1 with zero infrastructure dependency** (no fly.io, no BAA, no translator API, no new package), because the entire feature is static reference content + a client-rendered PDF. It also forwards cleanly to the ON-equity LATER languages (Mandarin, Punjabi, Tagalog, Arabic, Spanish) without restructuring: the `Language` type and module shape are designed to extend, not to re-architect.

---

## 4. Components & Data Model

### 4.1 The FR corpus module (`src/lib/i18n/patient-instructions.ts`, new)

The "patient-instruction translation" analog to #3's `statements.ts`, #4's `reasons.ts`, #6's `differentials.ts`, #9's `citations.ts`, #22's `catalog.ts`, #10's `prom.ts`, #12's `sig-defaults.ts`. Per the content-governance precedent, it is a **versioned, hashed TS module under `src/lib/i18n/`** (a new directory; `i18n/` chosen over `clinical/` because the content is a *translation map* over clinical strings, not clinical authorship — and it leaves room for future pharmacist-UI i18n strings under the same namespace). The version + hash pin the exact FR corpus in effect at build time, reproducible from git, feeding #26 (governance) and #14 (outcomes reproducibility).

```ts
// src/lib/i18n/patient-instructions.ts
import { createHash } from "node:crypto"

export const PATIENT_INSTRUCTIONS_VERSION = "patient-instructions-fr-v1"

export type Language = "en" | "fr"
// Extensible LATER to "es" | "zh" | "tl" | "ar" | "pa" for ON equity without restructuring.

export interface RegimenDirections {
  /** Human-authored canonical FR directions for this regimen.
   *  The pharmacist accepts this for the FR handout, or the handout
   *  falls back to the EN sig the pharmacist typed. NEVER MT'd. */
  fr: string
}

export interface AilmentPatientInstructions {
  /** FR translation of ailment.followUp (the "when to return" sentence). */
  followUpFr: string
  /** FR translations of ailment.nonRx (self-care counselling items),
   *  POSITIONALLY ALIGNED to the EN array in data/ailments.json:
   *  nonRxFr[i] is the translation of ailment.nonRx[i].
   *  Missing entries fall back to the EN string (graceful degradation). */
  nonRxFr: string[]
  /** Canonical FR directions per regimen, keyed by exact drug string
   *  (same keying discipline as #12's SIG_DEFAULTS). */
  directionsByDrug: Record<string, RegimenDirections>
}

// Keyed by ailment slug. Phase 1 ships the high-prevalence ailments fully
// translated and backfills the rest; un-curated ailments return undefined
// from getPatientInstructions() and the handout falls back to EN-only.
export const PATIENT_INSTRUCTIONS_FR: Record<string, AilmentPatientInstructions> = {
  "uti": {
    followUpFr: "Réévaluer dans les 48 à 72 heures; consulter un médecin en l'absence d'amélioration ou en cas de symptômes systémiques.",
    nonRxFr: [
      "Boire beaucoup d'eau",
      "Uriner dès que l'envie se fait sentir",
      "Miction post-coïtale pour les femmes à risque",
    ],
    directionsByDrug: {
      "Nitrofurantoin 100 mg": { fr: "1 capsule 2 fois par jour pendant 5 jours" },
      "Fosfomycin 3 g":        { fr: "Dose unique" },
      // ...remaining UTI regimens
    },
  },
  "acne": { /* ... */ },
  // ...remaining 17 ailments
}

export function getPatientInstructions(
  slug: string,
  language: Language,
): AilmentPatientInstructions | undefined {
  if (language === "en") return undefined // EN is the source of truth in data/ailments.json
  return PATIENT_INSTRUCTIONS_FR[slug]
}

export function getFrDirections(slug: string, drug: string): string | undefined {
  return PATIENT_INSTRUCTIONS_FR[slug]?.directionsByDrug?.[drug]?.fr
}

export function computePatientInstructionsHash(): string {
  return createHash("sha256")
    .update(PATIENT_INSTRUCTIONS_VERSION)
    .update(JSON.stringify(PATIENT_INSTRUCTIONS_FR))
    .digest("hex")
}
```

**Keying discipline (reuses #12's lesson).** `directionsByDrug` is keyed on the **exact** `data/ailments.json` drug string (e.g. `"Nitrofurantoin 100 mg"`, `"Benzoyl peroxide 2.5–5%"`). This is the same fragility #9 (citations) and #12 (smart-sig) identified: a data rephrase orphans the FR entry silently. The mitigation is identical and now-standard: (i) `getFrDirections` returns `undefined` on a miss and the handout falls back to the EN sig (graceful degradation, never worse than today); (ii) a CI-guard unit test asserts every `directionsByDrug` key resolves to a real `(slug, drug)` pair in `data/ailments.json` so drift is caught at test time, mirroring #12's 80-key coverage invariant.

**Positional alignment of `nonRxFr`.** The FR self-care array is positionally aligned to the EN `ailment.nonRx` array (`nonRxFr[i]` translates `ailment.nonRx[i]`), not keyed by string. This avoids the exact-string-key fragility for the checklist (the EN string can be rephrased in `data/` without orphaning the translation, as long as the array order is preserved), and it composes cleanly with the existing `filterCheckedItems(all, checked)` helper at `src/lib/pdf-filter.ts:1` (the same index arithmetic the wizard already uses to track `nonRxChecked`). A CI test asserts `nonRxFr.length === ailment.nonRx.length` for every curated slug.

### 4.2 The Patient Instructions PDF (`src/components/patient-instructions-pdf.tsx`, new)

A new @react-pdf/renderer document, structurally distinct from the Combined Prescription PDF. It is a **patient handout**: larger type (fontSize 10–11 vs the Combined PDF's 7.5), patient-friendly register, no PHIPA-clinical footer, no prescriber signature line, nofax-to-physician block. It carries:

- A title block: ailment name (FR) + pharmacy name + date (locale-formatted).
- A "Your medication" section: the drug name + the directions (the canonical FR block from §4.1 if available and accepted, else the EN `selectedRx.sig` verbatim — never an MT).
- A "How to care for yourself" section: the checked `nonRx` items in FR (positionally resolved from `nonRxFr`), each with a checkmark.
- A "When to come back" section: the `followUp` sentence in FR.
- A "When to seek help" section: a short universal safety-net sentence (fever, worsening, no improvement → see a physician or call 811 / 911), pre-authored in FR — the one piece of net-new clinical content (vs. translating existing strings), and it is generic enough to be safe across all 19 ailments.
- A patient-friendly footer: pharmacy name + phone + "Questions? Ask your pharmacist" in FR. **No PHIPA footer** (this is patient education, not a record; the Combined PDF remains the legal record). **No patient name** by default (PHI minimisation — the handout is a generic education sheet the pharmacist hands over; see Open Question §7.10).

```tsx
// src/components/patient-instructions-pdf.tsx (shape)
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer"
import { Ailment, PharmacyDefaults, SelectedRx } from "@/types"
import { getPatientInstructions, getFrDirections, Language } from "@/lib/i18n/patient-instructions"

interface PatientInstructionsPdfProps {
  ailment: Ailment
  selectedRx: SelectedRx
  nonRxChecked: string[]
  pharmacy: PharmacyDefaults | null
  language: Language            // "fr" for the FR page; "en" for the EN page; "both" = two-page doc
  dateOfAssessment: string      // locale-formatted upstream (fr-CA or en-CA)
}

export function PatientInstructionsPdf(props: PatientInstructionsPdfProps) {
  const fr = getPatientInstructions(props.ailment.slug, "fr")
  const frDirections = getFrDirections(props.ailment.slug, props.selectedRx.drug)
  // ... render patient-friendly handout in props.language
  // EN page renders from ailment.followUp / ailment.nonRx / selectedRx.sig (source of truth)
  // FR page renders from fr.followUpFr / fr.nonRxFr[i] / frDirections ?? selectedRx.sig (fallback)
}
```

**Two-page "both" mode.** When the pharmacist selects "Both languages", the `<Document>` contains two `<Page>` nodes — an EN page and an FR page — so a single downloaded PDF carries both, printable double-sided. This is the equity-optimal default for ON pharmacies with mixed Francophone/Anglophone populations.

### 4.3 The sig-translation rule (patient-safety invariant)

This is the most important clinical-safety decision in the spec, stated as a hard rule:

> **The Patient Instructions handout NEVER machine-translates the pharmacist's typed `selectedRx.sig`.** The FR directions on the handout are EITHER (a) the canonical human-authored FR block for that regimen (`getFrDirections(slug, drug)`), if one exists and the pharmacist has not opted to show the EN sig, OR (b) the pharmacist's EN `selectedRx.sig` **verbatim, untranslated**, with a one-line FR note pointing the patient to ask the pharmacist if they need the directions in French.

The canonical FR block is pre-authored, human-reviewed, and version-pinned — so a Francophone patient reading "1 capsule 2 fois par jour pendant 5 jours" is reading reviewed clinical content, not model output. If the pharmacist has *edited* the sig away from the regimen default (e.g. halved the dose for renal impairment), the canonical FR block no longer matches, and the handout must show the **edited EN sig verbatim** rather than a misleading canonical FR block. The toggle on the generate step makes this explicit: "Show French directions (standard regimen)" with a visible diff against the pharmacist's current sig. See Open Question §7.1.

This rule is enforced structurally (no MT call site exists) and verified by a CI grep: `rg -n "translate|mt|deepl|google.*translate" src/components/patient-instructions-pdf.tsx` must return nothing. The handout's data flow is: `selectedRx.sig` (EN, pharmacist-owned) → render verbatim; `frDirections` (FR, pre-authored) → render as an alternative block. There is no third path.

### 4.4 The language toggle on the generate step (`step-generate.tsx`, modified)

`step-generate.tsx:53-83` today renders an "Assessment Summary" card and a single "Download Prescription + Doctor Notification PDF" button (`:75-77`). #24 adds a second card: "Patient Handout", with a three-way segmented control (`EN` / `FR` / `Both`) defaulting to `EN`, and a "Download Patient Instructions" button. The button constructs a `PatientInstructionsPdf` and calls the existing `downloadPdf` (`src/lib/pdf-helpers.ts:5`) a second time — the two downloads (clinical record + patient handout) are independent, so the pharmacist can hand the patient the FR sheet without re-downloading the clinical PDF.

The locale-formatted date is computed once: `new Date().toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA")`, replacing the hard-coded `"en-CA"` at `step-generate.tsx:23` for the handout only (the Combined PDF's date stays `en-CA` — it is an English clinician record for NOW). The `pdf.generated` audit event (`audit-actions.ts:17`, currently with no call site) is emitted with metadata `{ tx_id, document_type: "patient_instructions", language }` when #2's persistence layer is live; in Phase 1 (no #2) the audit emit is a no-op stub, identical to every other feature's stub-behind-`PHI_PERSIST_ENABLED` pattern. `tx_id`, `document_type`, and `language` are all non-PHI; the handout's patient content stays client-side.

### 4.5 Types (additions to `src/types/index.ts`)

```ts
// No change to Ailment, RxOption, SelectedRx, PatientInfo, PharmacyDefaults, AssessmentData.
// The feature adds NO persisted fields and NO new column on #2's assessment table:
// the language chosen for one handout is a transient render choice, not a clinical
// attribute of the encounter. (See Open Question §7.5 for per-pharmacy default language.)
```

`Language` is exported from `src/lib/i18n/patient-instructions.ts` (§4.1), not `src/types/`, because it is a property of the translation module, not a domain entity. If a future feature (e.g. per-pharmacy locale preference on Supabase) needs it broadly, it can be promoted to `src/types/` then — YAGNI for NOW.

### 4.6 Data / DB changes

**None.** This is the defining infrastructure-lightness property of Option A:

- **No fly.io migration.** The FR corpus is static reference content in the client bundle; the handout is rendered client-side; no PHI is persisted by this feature (the patient handout is a transient artefact, like the Combined PDF is today pre-#2). The handout does not write to #2's `assessment` table — the *clinical record* (Combined PDF + #2 row) is unchanged; the handout is a patient-facing derivative.
- **No Supabase table.** No per-pharmacy language preference in NOW (per-consult toggle only — Open Question §7.5). The `pdf.generated` audit event reuses the existing `audit.log` / `log_event` RPC; only its `metadata` gains two non-PHI keys (`document_type`, `language`), validated by the same `log_event` CHECK that #2 §4.5 tightens.
- **No new EventType.** `pdf.generated` already exists in the union at `audit-actions.ts:17`. #24 reuses it rather than introducing `patient_instructions.generated` — the audit question is "was a PDF produced for this consult?", not "which PDF?", and the `document_type` metadata distinguishes them. (See Open Question §7.9 for whether a distinct event is preferable for inspector clarity.)
- **No new dependency.** The FR corpus uses `node:crypto` (already used by #2's identity_hash, #6/#9/#10/#12's content hashes). The PDF uses `@react-pdf/renderer` (already in `package.json`). The toggle uses existing `lucide-react` icons + shadcn primitives. Zero new packages — respecting the user's "never install packages globally / UV only / YAGNI" stance and matching #6/#9/#12's no-dependency discipline.

---

## 5. Security / PHIPA-PIPEDA Posture

### 5.1 The entire feature is non-PHI reference content + a client-rendered PDF

| Data element | Classification | Store / flow |
|---|---|---|
| FR translation strings (`followUpFr`, `nonRxFr`, `directionsByDrug.fr`) | **Non-PHI** (reference content, identical for every patient with that ailment — like a drug monograph) | Static TS module in the client bundle. Never sent to server, never persisted. |
| `ailment.slug`, `selectedRx.drug` (the lookup keys) | **Non-PHI** (used as map keys in the client; the ailment context is already in the wizard's client state) | Client-only map read. Not transmitted by the lookup. |
| Patient name, DOB, demographics, the sig, the checked non-Rx items | **PHI** (clinical + identifying) | Stay client-side in the wizard (`wizard-container.tsx:42-47`), rendered into the handout PDF by `@react-pdf/renderer` in-browser (`pdf-helpers.ts:5`). Never sent to a translation service. Never persisted by #24. |
| `pdf.generated` audit metadata `{ tx_id, document_type, language }` | **Non-PHI** (tx_id is non-identifying per `prescription-tx-id-design.md`; document_type and language are non-identifying categories) | Supabase `audit.log`, same as every other `pdf.generated` emission. No ailment, no patient key, no sig text. |
| The handout PDF bytes | **PHI** (if it carries patient name — which by default it does NOT, see §4.2 and Open Question §7.10) | Client-side Blob → browser download, exactly as the Combined PDF is today. No server round-trip. |

**No BAA is required for this feature.** This is the single most important compliance property: because translation is pre-authored static content (not on-the-fly MT) and the handout is rendered client-side (no PHI leaves the browser), there is **no third-party PHI processor** introduced. Contrast with #7 (LLM prompt is PHI → BAA mandatory), #2/#3 (PHI stored → fly.io BAA mandatory), #10 (SMS/email body carries no PHI → no BAA, but a carrier relationship). #24 joins #6/#9/#22/#12 in the "non-PHI ships live in Phase 1, no BAA, no flag" family.

### 5.2 Regulatory mapping

- **PHIPA:** the handout is patient education, not a record — the Combined Prescription PDF remains the legal custodian record (and #2's fly.io row remains the persisted truth). #24 adds no new PHI store and no new disclosure. The translated strings are reference content, not patient information. No PHIPA exposure introduced.
- **PIPEDA:** no personal information is transmitted to any third party (no translator API, no analytics on language choice in Phase 1). The `pdf.generated` audit event is internal. Principle 4.5 (purpose limitation: patient education) satisfied.
- **French Language Services Act (Ontario):** #24 advances FLSA alignment for designated bilingual areas of Eastern/Northern Ontario by giving Francophone patients a clinically-accurate French instruction sheet — a service-equity gain within the existing ON regulatory frame, no new compliance burden.
- **Bill 96 / Québec (forward look):** a *patient handout* in French is necessary-but-not-sufficient for QC market entry — the *software* must also offer a French pharmacist UI and align with OPAQ requirements (roadmap #15). #24 produces the patient artefact and explicitly does **not** claim QC-certified status; it claims "FR patient instructions for ON Francophones + future-QC-readiness". This is the correct sequencing: patient value first, full market entry LATER.
- **Patient safety (the overriding constraint):** the §4.3 sig-translation rule (never MT the typed sig; canonical FR only; verbatim-EN fallback) is the medico-legal safeguard. A mistranslated dose is a sentinel event; pre-authored reviewed content is the control. No clinician-facing safety validation (allergy/interaction/pregnancy) is introduced or duplicated — the PMS owns that boundary per roadmap §3.

### 5.3 The "no PHI in the audit log" discipline

The `pdf.generated` metadata is strictly `{ tx_id, document_type: "patient_instructions", language }`. It must **not** carry the ailment slug, the regimen, the sig, or any patient key — ailment and regimen are clinical/PHI-adjacent per #2 §5.1's stance, and the language choice alone could re-identify a Francophone patient in a tiny pharmacy. A CI grep (`rg -n "ailment|drug|sig|name" src/lib/i18n/` over the audit-emit call site) verifies the metadata object contains only the three permitted keys. This mirrors #6's and #9's literal-URL/no-interpolation PHI-leak guards and #10's body-PHI guard.

---

## 6. Edge Cases

1. **Ailment not yet translated (Phase 1 incremental shipping).** `getPatientInstructions(slug, "fr")` returns `undefined`. The handout's language toggle disables the `FR` and `Both` options for that ailment with a tooltip "French version coming soon", and only `EN` is offered. The consult is unaffected — the pharmacist hands the EN sheet. Graceful degradation; never blocks the encounter.
2. **Regimen has no canonical FR directions.** `getFrDirections(slug, drug)` returns `undefined` (a new regimen added to `data/ailments.json` without a corresponding FR entry, or a data rephrase orphans the key). The FR handout shows the pharmacist's EN `selectedRx.sig` **verbatim, untranslated**, with the FR note "Demandez à votre pharmacien de vous expliquer les directives en français." Patient-safe; the CI key-coverage test catches the gap at build time.
3. **Pharmacist edits the sig away from the regimen default.** The pharmacist halves a dose for renal impairment at `step-rx.tsx:71-77`. The canonical FR block no longer matches the edited sig. The handout detects the divergence (compare `selectedRx.sig` to the EN reconstruction of the canonical block) and **forces the EN sig verbatim** on the FR page with the divergence note — never silently shows a standard-dose FR block for a modified-dose prescription. This is the §4.3 invariant made operational.
4. **Pharmacist types a non-English sig (e.g. already in French).** The sig is free text; if the pharmacist types French, it renders verbatim (the §4.3 rule treats it as "the pharmacist-owned directions" and does not touch it). No harm; no double-translation (there is no translation path).
5. **"Both" language selection.** The `<Document>` emits two `<Page>`s (EN then FR). Printable double-sided. The download is a single PDF named `patient-instructions-${date}-${txId}.pdf`. If the ailment lacks FR (case 1), the "Both" option is disabled; the pharmacist cannot accidentally produce a half-translated doc.
6. **Re-download / idempotency.** The handout is a pure function of `(ailment, selectedRx, nonRxChecked, language, date)`; re-downloading produces byte-identical output for the same inputs. No `assessmentId` is consumed (unlike the Combined PDF's `reserveTxId` at `step-generate.tsx:30`). The pharmacist can re-print the handout freely.
7. **Date formatting under FR.** `new Date().toLocaleDateString("fr-CA")` produces `"2026-06-24"` (same ISO order as `en-CA`, just locale-labelled) — visually identical to the EN date. No ambiguity, no re-formatting risk. (If a future locale produces a different order, the handout's date is purely informational, not a clinical field.)
8. **Accented characters / encoding.** @react-pdf/renderer's default `Helvetica` font covers Latin-1 (French accents é/è/ê/ç/à/î/ô work out of the box). No font embedding needed for FR. A LATER expansion to Mandarin/Arabic/Punjabi will require embedding a CJK/calligraphic font (a known @react-pdf/renderer task) — out of scope for FR-first, and the `Language` type anticipates it.
9. **No patient name on the handout (PHI minimisation default).** The default handout carries pharmacy name + date + ailment + directions, NOT the patient's name (see §4.2). Rationale: the pharmacist hands the sheet to the patient in person; the patient knows their own name; embedding it creates a PHI-laden loose paper for no clinical benefit. Open Question §7.10 leaves this configurable if a pharmacy wants named handouts.
10. **The `pdf.generated` audit event has no call site today.** #2 §6 wires `pdf.generated { tx_id }` as a side-effect of the Combined PDF download. #24 reuses the same event with widened metadata `{ tx_id, document_type, language }`. In Phase 1 (no #2), the audit emit is a no-op stub; the handout still downloads (audit is observability, not a gate). If #2 is live, both downloads emit (Combined PDF emits `{ tx_id, document_type: "prescription" }`, handout emits `{ tx_id, document_type: "patient_instructions", language }`).
11. **Accessibility (AODA AA).** The on-screen segmented control must be keyboard-navigable and screen-reader-labelled (existing shadcn primitives satisfy this). The *PDF* accessibility (tagged PDF, reading order) is limited by @react-pdf/renderer's current support — flagged as a soft gate (Open Question §7.6); the on-screen wizard remains the accessible surface for blind pharmacists, the handout is a visual patient artefact.
12. **Future language expansion (Mandarin, Punjabi, Tagalog, Arabic, Spanish).** The `Language` type (`"en" | "fr"`) is designed to extend to `"zh" | "pa" | "tl" | "ar" | "es"` without restructuring: add a `PATIENT_INSTRUCTIONS_ZH` map, extend `getPatientInstructions(language)`, add a locale string. The handout's per-page render is language-parametric. The only rework is RTL layout for Arabic (a @react-pdf/renderer flex-direction task, LATER). ON has large Mandarin/Punjabi/Tagalog populations — the FR-first sequencing is a roadmap decision, not an architectural limitation.

---

## 7. Open Questions

1. **The sig on the FR handout — canonical block, verbatim EN, or both?** §4.3 recommends: show the canonical FR block when it matches the current sig; show the EN sig verbatim + an "ask your pharmacist" note when the sig has been edited. Alternative: show *both* (EN sig + canonical FR block side-by-side) always, so the patient sees the pharmacist's actual instruction and the standard FR directions. Recommend the divergence-aware single-source rule (cleaner, less confusing); needs pharmacist/translator review.
2. **Who authors and reviews the FR corpus?** ~190 short clinical-counselling strings. Needs a bilingual pharmacist (or a certified medical translator) + a second pharmacist reviewer, and a per-string review log feeding #26 (governance). Confirm the review workflow and whether the `PATIENT_INSTRUCTIONS_VERSION` bumps on every corpus edit (recommend yes — every edit changes the hash and must be reviewable).
3. **Phase-1 launch scope — all 19 ailments, or incremental?** Recommend incremental: ship the high-prevalence ailments first (UTI, acne, allergic-rhinitis, dermatitis, GERD, dysmenorrhea, conjunctivitis — the bulk of consults) and backfill the remaining 12 behind the same graceful-degradation toggle. Confirm the launch set and the backfill cadence.
4. **QC-readiness claim.** Does #24 market as "FR patient instructions" (ON equity) or "QC-ready" (market entry)? Recommend the former — QC requires French pharmacist UI (#15) and OPAQ alignment, which #24 does not deliver. The patient handout is necessary for QC but not sufficient. Confirm messaging.
5. **Per-pharmacy default language preference.** A Supabase `pharmacies.default_handout_language` column (non-PHI) would let a Gatineau pharmacy default the toggle to `FR`/`Both` and a Toronto pharmacy default to `EN`. Recommend deferring to a LATER increment (YAGNI — the per-consult toggle is one click; a default is optimisation). Confirm.
6. **PDF accessibility (tagged PDF / AODA for the handout itself).** @react-pdf/renderer's tagged-PDF support is limited. The patient handout is a visual artefact handed to a sighted patient (or read aloud by the pharmacist); the on-screen wizard remains the accessible surface. Confirm that AODA-AA applies to the web toggle (satisfied by shadcn primitives) and not to the generated PDF for NOW.
7. **Should the FR corpus cover the universal safety-net sentence ("seek help if fever/worsening")?** §4.2 introduces one net-new clinical string (vs. translating existing `followUp`/`nonRx`). Recommend yes — every patient handout needs a safety-net, and a single generic FR sentence reviewed once is safe across all 19 ailments. Confirm the wording with a pharmacist.
8. **Drug-name translation (INN vs. brand).** Canadian French sometimes uses different names (acetaminophen → paracétamol). Recommend keeping the generic INN exactly as in `data/ailments.json` (the product box label is the source of truth; the pharmacist confirms the product at handover), translating only the *directions*, not the drug name. Confirm.
9. **Distinct audit event for the handout?** §4.6 reuses `pdf.generated` with `document_type` metadata. Alternative: a new `patient_instructions.generated` event for inspector clarity ("we can see exactly when a French handout was produced"). Recommend reusing `pdf.generated` (one event per PDF, distinguished by metadata — matches the discipline of one `assessment.saved` per assessment from #2/#4); confirm with the privacy officer.
10. **Patient name on the handout?** §4.2/Open Question: default OFF (PHI minimisation); make it a per-download checkbox if a pharmacy wants named handouts. Confirm the default. If ON, the handout PDF bytes become PHI (patient name) — still client-rendered, still no server round-trip, but the file-at-rest classification changes; document in the data-flow map.
11. **Source-of-truth for the EN handout.** The EN page of the handout renders `ailment.followUp` / `ailment.nonRx` / `selectedRx.sig` directly from `data/ailments.json` + wizard state (no EN copy in the i18n module — EN is the source). Confirm this avoids a drift risk where the EN handout disagrees with `data/ailments.json` (it does — single source of truth). The FR corpus is the *only* translated content; EN is never duplicated.

---

## 8. Files Touched (summary)

**New files (4):**
- `src/lib/i18n/patient-instructions.ts` — versioned + hashed FR corpus module (`PATIENT_INSTRUCTIONS_VERSION`, `PATIENT_INSTRUCTIONS_FR`, `getPatientInstructions`, `getFrDirections`, `computePatientInstructionsHash`, `Language` type).
- `src/components/patient-instructions-pdf.tsx` — the @react-pdf/renderer patient handout document (EN/FR/Both).
- `src/__tests__/patient-instructions.test.ts` — module unit tests (hash determinism, positional-alignment invariant, key-coverage invariant over all 19 slugs, graceful-undefined behaviour).
- `src/__tests__/patient-instructions-pdf.test.tsx` — component tests (EN/FR/Both render, sig-translation §4.3 invariant, no-PHI-in-audit-metadata grep, fallback when untranslated, rel/date formatting).

**Modified files (2):**
- `src/components/wizard/step-generate.tsx` — add the "Patient Handout" card + `Language` segmented control + `downloadPdf(PatientInstructionsPdf)` path; locale-formatted date for the handout only; `pdf.generated` audit emit (no-op stub in Phase 1).
- `src/__tests__/combined-pdf-txid.test.tsx` (or a sibling wizard test) — add an assertion that the handout download co-exists with the Combined PDF download without consuming a second tx id (the handout is not a prescription).

**Not touched (explicitly):**
- `src/components/combined-pdf.tsx` — the medico-legal record stays EN, single-page, unchanged. The handout is a separate document.
- `src/components/wizard/referral-pdf.tsx` — a referral produces no prescription; a patient handout for a referred patient is a LATER increment (a "what to do while you wait for your physician" sheet). Out of scope for #24 v1.
- `src/components/wizard/wizard-container.tsx`, `step-rx.tsx`, `step-redflags.tsx`, `step-patient.tsx` — the pharmacist workspace stays EN; no wizard state changes (language is a generate-step render choice, not wizard state).
- `src/lib/ailments.ts`, `data/ailments.json` — the gnhf constraint forbids editing `data/`; EN remains the source of truth there. The FR corpus is additive in `src/lib/i18n/`.
- `src/lib/audit-actions.ts` — no new `EventType` (reuses `pdf.generated` at `:17`); the metadata widening is validated by #2's `log_event` CHECK, not by a union change here.
- `package.json` — no new dependency (reuses `@react-pdf/renderer`, `node:crypto`, shadcn primitives, `lucide-react`).
- Any fly.io / Supabase migration — **none**. The feature adds no table, no column, no RPC.
