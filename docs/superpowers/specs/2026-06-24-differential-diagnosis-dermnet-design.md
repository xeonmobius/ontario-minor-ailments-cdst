# Differential Diagnosis + DermNet Clinical Images — Design

**Date:** 2026-06-24
**Roadmap item:** #6 (NEXT tier) — "Differential diagnosis + DermNet clinical images"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST's clinical flow today is **diagnosis-anchored, not differential**: the pharmacist commits to a single ailment *before* the wizard opens. The dashboard (`src/app/page.tsx:60`) renders `<AilmentGrid/>`, each `<AilmentCard>` is a `<Link href={`/assess/${ailment.slug}`}>` (`src/components/ailment-card.tsx:23`), and `WizardContainer` (`src/components/wizard/wizard-container.tsx:40`) receives a single fixed `ailment: Ailment` prop. From the first step onward the question the tool answers is *"given THIS ailment, screen red flags and pick an Rx"* — never *"could this be a different (or mimic) condition?"* `step-redflags.tsx:94-125` confirms a flat `ailment.symptoms` checklist per ailment; there is no cross-ailment reasoning, no "consider also X," and no visual reference to confirm a morphological diagnosis. The `Ailment` type (`src/types/index.ts:7-16`) carries `symptoms`, `redFlags`, `rxOptions`, `nonRx`, `followUp` — and nothing resembling `differentials` or `images`. A `rg` for `differential|dermnet|<img|next/image|differential diagnosis` across `src/` returns zero true positives (the only `_next/image` match is the middleware exclude pattern at `src/proxy.ts:10`).

This is exactly the gap the competitive research names: *"Differential diagnosis + DermNet clinical images — Clinical edge. PharmAssess has, MAPflow weak; boosts prescriber confidence"* (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §5, NEXT tier, row #6), and §2 of the same roadmap records that PharmAssess's stated strength includes *"DermNet clinical images."* For the conditions where this tool prescribes, visual mimicry is acute: at least nine of the nineteen ailments are dermatological or have a strong morphological component — `acne` (`data/ailments.json:5`), `candidal-stomatitis`, `conjunctivitis` (`:199`), `dermatitis` (`:258`), `herpes-labialis` (`:486`), `impetigo` (`:539`), `insect-bites-urticaria` (`:584`), `tick-bites-lyme` (`:818`), and `hemorrhoids` (`:431`) — and the `dermatitis` entry already encodes a hidden differential in prose ("Inguinal folds **spared** = irritant type" vs "Inguinal folds **involved + satellite pustules** = candidal type," `data/ailments.json:264-265`) without surfacing it as structured decision support. A pharmacist who selects *dermatitis* but is actually looking at candida intertrigo, or selects *impetigo* that is in fact herpes simplex, will sail through the red-flag screen (which only asks the *selected* ailment's red flags) and prescribe the wrong topical.

**The goal of this feature** is to add a **differential-reasoning + visual-reference layer** inside the existing wizard — not a new workflow. It comprises: (a) a **versioned, hashed clinical module** (`src/lib/clinical/differentials.ts`) holding, per ailment slug, a curated list of differential diagnoses (each with the distinguishing features that separate it from the presenting complaint and a `disposition` hint — treat-in-tool / refer / OTC-only) and a set of **DermNet NZ deep-links** for the visual/morphological ailments; (b) a **collapsible `<DifferentialPanel>`** rendered inline on the symptoms step (`step-redflags.tsx`, where presenting symptoms are already confirmed), so the pharmacist reasons through mimics *before* advancing to Rx selection; (c) a **clinical-image affordance** that opens the canonical DermNet NZ topic page in a new tab on a manual click (no patient context transmitted); and (d) the discipline that this is **pure decision support, not an automated gate** — the PMS-owned clinical-safety boundary (roadmap §3) applies: the feature never auto-excludes, auto-refers, or overrides the pharmacist, and it does not introduce a new automated allergy/interaction/pregnancy check.

**Out of scope** (per roadmap §3, §6, and YAGNI for the NEXT tier): **self-hosting a licensed image library** (requires copyright licensing, CDN storage, and content governance that belongs to roadmap #26 — the DermNet NZ deep-link delivers the clinical-image value at zero hosting/licensing cost for NOW); an **AI differential engine** (that is roadmap #7-adjacent "AI-drafted assessment notes" territory — the NOW feature is a *curated static* differential set reviewed by a pharmacist, exactly as #3's `statements.ts` / #4's `reasons.ts` / #22's `catalog.ts` are curated static clinical content); **automated exclusion/referral gating from a differential** (clinical-safety automation is PMS-owned per roadmap §3, identical to why allergy/interaction checking stays out — a `disposition: 'refer'` differential *surfaces* a refer tag but never auto-routes the wizard); **structured persistence of "differentials considered"** as a first-class field (the free-text `assessmentNotes` captured at `step-redflags.tsx:129-136` already carries the pharmacist's reasoning and routes to #2's fly.io `assessment` row — adding a structured array is a #14-outcomes-analytics concern, deferred); **replacing the diagnosis-anchored entry model** with a symptom-first triage engine (a pharmacist enters by ailment today per O. Reg. 256/24's ailment-list framing; a symptom-driven recommender is a much larger LATER redesign, not a NEXT-tier increment).

---

## 2. Current State (what exists in code)

### 2.1 Diagnosis is committed before the wizard opens

The entry surface is ailment-first and ailment-exclusive. `<AilmentGrid>` (`src/components/ailment-grid.tsx:6`) maps `ailments` (`src/lib/ailments.ts:4`, sourced from `data/ailments.json`) and renders one `<AilmentCard>` per slug; each card is a `<Link href={`/assess/${ailment.slug}`}>` (`ailment-card.tsx:23`). `getAilmentBySlug` (`ailments.ts:6`) resolves exactly one `Ailment`, and `AssessPage` (`src/app/assess/[ailment]/page.tsx:9-20`) hands that single object to `<WizardContainer ailment={ailment} .../>` (`page.tsx:53`). There is **no symptom-search surface, no cross-ailment comparison view, no "could this be…?" affordance** anywhere on the dashboard or in the wizard. The `AILMENT_ICONS` map (`ailment-card.tsx:11-18`) hardcodes the 19 slugs as static numeric badges — these are typographic glyphs, not clinical images.

### 2.2 The symptoms step is a flat per-ailment checklist with no differential context

`StepRedFlags` (`src/components/wizard/step-redflags.tsx:20`) receives one `ailment: Ailment` and renders, when no red flag is checked (`step-redflags.tsx:94`), a flat `ailment.symptoms.map(...)` checklist (`:100-124`) plus a free-text `<Textarea>` for `assessmentNotes` (`:127-137`). The component knows nothing about *other* ailments. A pharmacist working through `impetigo` (`data/ailments.json:539`) sees impetigo's symptoms and impetigo's red flags only; the tool never suggests that a honey-crusted plaque could also be herpes simplex, atopic dermatitis impetiginized, or contact dermatitis — even though distinguishing these changes both the Rx (acyclovir vs. mupirocin vs. topical steroid) and the disposition. The wizard's `canNext` gate at step 1 (`wizard-container.tsx:55-56`) is `redFlagsChecked.length === 0` — it advances on the *absence* of red flags, with no positive diagnostic-confirmation step in between.

### 2.3 The dermatological content already hides differentials in prose

The `dermatitis` entry (`data/ailments.json:258-335`) is the clearest case: its `symptoms` array (`:259-266`) embeds the irritant-vs-candidal diaper-dermatitis distinction as plain-string symptom lines ("Inguinal folds **spared** = irritant type" / "Inguinal folds **involved + satellite pustules** = candidal type"), and its `rxOptions` (`:279-324`) mix topical steroids (for irritant) and azoles/nystatin (for candidal) without any structured mapping of *which* Rx fits *which* differential. The pharmacist is expected to perform that resolution in their head from symptom-line prose. The `Ailment` interface (`types/index.ts:7-16`) has no field to hold this structure cleanly.

### 2.4 No images, no external clinical references, no link-out primitives

A `rg` for `differential|dermnet|<img|next/image|differential diagnosis` across `src/` returns zero true positives. The PDF is text-only (`<CombinedPdf>` at `src/components/combined-pdf.tsx` uses only `<Text>`/`<View>` from `@react-pdf/renderer`, `combined-pdf.tsx:3-9`; no `<Image>` import). The Next.js `next/image` optimizer is only *excluded* by the middleware matcher (`src/proxy.ts:10`), meaning no route currently emits an optimized image. There is no external-link `<a target="_blank">` primitive in the UI kit (`src/components/ui/`). DermNet NZ, Medscape, or any clinical-atlas integration does not exist.

### 2.5 The content-governance precedent (where clinical modules live)

Every prior feature that introduced curated clinical/governance content placed it in a **versioned, hashed TS module under `src/lib/`**, not in `data/ailments.json`: #3's `src/lib/consent/statements.ts` (`2026-06-23-digital-consent-capture-design.md` §4.2), #4's `src/lib/.../reasons.ts` (`2026-06-23-refusal-non-prescribe-docs-design.md` §4), and #22's `src/lib/vaccines/catalog.ts` (`2026-06-23-vaccination-workflow-design.md` §4.1) all follow the rule "clinical content needing a reproducible content hash is a TS module under `src/lib/`" — driven both by the reproducible-hash requirement (feeding `protocol_version` on persisted rows and #26 governance) and by the gnhf constraint forbidding edits to `data/`. The differentials + DermNet links are exactly this class of content.

### 2.6 No PHI implications in the reference layer

The differential module, the DermNet URLs, and the `disposition` tags are **general clinical reference content** — they describe ailments, not patients. They carry no patient data and therefore implicate neither fly.io nor the BAA gate. The only PHI-adjacent element is the pharmacist's free-text `assessmentNotes` (already captured, already routed to #2's fly.io `assessment` row per `persist-assessments-flyio-design.md` §4.3); the feature deliberately does *not* add a new structured PHI field, so it ships **live in Phase 1 with no `PHI_PERSIST_ENABLED` dependency** — the same "non-PHI ships live immediately" property #22's inventory ledger enjoys (`2026-06-23-vaccination-workflow-design.md` §2.5/§4.6).

---

## 3. Approach (options + recommendation)

The design hinges on five decisions: (a) where the differential + image-link content lives (`data/ailments.json` vs. a new `src/lib/` module); (b) when in the flow the differential is surfaced (dashboard / in-wizard / both); (c) how clinical images are delivered (self-hosted licensed library vs. DermNet NZ deep-link); (d) whether the differential does anything *automated* (pure reference vs. an exclusion gate); (e) whether "differentials considered" persists as structured data. Options are evaluated against roadmap §3 (the PMS-owned clinical-safety boundary), §6.4 (the PHI partitioning rule), §4 (the counter-speed wedge), and the established #3/#4/#22 content-governance precedent.

### Option A — Versioned `src/lib/clinical/differentials.ts` module + inline `<DifferentialPanel>` on the symptoms step + DermNet NZ deep-links + pure reference (no automated gating, no structured persistence) (RECOMMENDED)

A new versioned module `src/lib/clinical/differentials.ts` exports `DIFFERENTIALS_VERSION` ("differentials-v1"), a `computeDifferentialsHash(...)` function (sha256 over the slug→differential tuples, feeding `protocol_version` and #26 governance — identical discipline to #22's `computeCatalogHash`), and a `DIFFERENTIALS: Record<string, DifferentialEntry>` keyed by ailment slug. Each `DifferentialEntry` carries `differentials: Differential[]` (each with `name`, `distinguishingFeatures`, `disposition: 'treat_in_tool' | 'refer' | 'otc_only'`) and `dermnetLinks: DermNetLink[]` (each `label` + `url` + `topic`), populated for the ailments where differentials are clinically material (the nine dermatological/morphological ailments first, then the remainder). A new `"use client"` `<DifferentialPanel slug={ailment.slug}/>)` renders **inline on the symptoms step** (`step-redflags.tsx`, inside the `!hasRedFlag` block at `:94-139`), above or beside the presenting-symptoms checklist, as a collapsible "Differentials to consider" list plus a row of "Clinical images — DermNet NZ" external-link chips that open in a new tab. The panel performs **no** automated logic: it does not check allergies, does not exclude Rx options, and does not auto-route to referral — a `disposition: 'refer'` differential merely surfaces an amber "Refer if suspected" tag that the pharmacist acts on via the existing red-flag referral flow (`wizard-container.tsx:142-172`). "Differentials considered" is **not** persisted as a new structured field; the pharmacist documents reasoning in the existing `assessmentNotes` textarea.

- **Pros:** Faithful to the roadmap framing (a clinical-confidence booster, not a workflow change) and the cheapest path to "PharmAssess has, MAPflow weak." Reuses the now-established content-governance precedent (#3/#4/#22: versioned hashed `src/lib/` module) at zero governance novelty. **Ships live in Phase 1** with no fly.io/BAA dependency — the entire feature is non-PHI reference content + a public-URL link-out, so it needs neither `PHI_PERSIST_ENABLED` nor a Supabase table; it is the lowest-risk NEXT-tier feature. Deep-linking DermNet NZ delivers the clinical-image value with **zero copyright liability, zero hosting cost, and zero PHI transmission** (the URL is a public string; the click is manual and carries no patient context). Surfacing inline on the symptoms step is the single point in the flow where the pharmacist has just confirmed what's present — the natural moment to ask "or could this be a mimic?" — without adding a wizard step (preserving counter speed per roadmap §4). Pure-reference posture respects the PMS-owned safety boundary (no automated exclusion) and keeps the feature auditable: a differential is information, not a decision. Sibling-friendly: the `disposition` + `distinguishingFeatures` structure is the exact input #7 (AI-drafted notes) and #9 (evidence citations) will consume later, and the versioned hash feeds #26 governance and #14 outcomes research.
- **Cons:** Deep-linking means the image experience depends on DermNet NZ's continued URL stability and the pharmacy's connectivity (mitigated: the differential *text* renders locally and is the durable decision-support value; only the image is external; a CI link-check task is a soft LATER). Curating the differential set per ailment is clinical content requiring pharmacist review (mitigated by the versioned-hash discipline identical to #3/#4/#22; flagged as a soft gate in rollout). The `disposition: 'refer'` tag is advisory and a pharmacist could ignore it — but that is the intended design (the PMS and the pharmacist own clinical safety, not the CDST), matching how `ailment.redFlags` today is also a pharmacist-worked checklist, not an automated block at the data layer.

### Option B — Extend `data/ailments.json` with `differentials` + `dermnetUrl` fields per ailment

Add the content directly to the existing data file, parsed into extended `Ailment` fields.

- **Pros:** Single source of clinical content; no second lookup at render time.
- **Cons:** **Forbidden by the hard constraint** ("Do NOT create, modify, or delete any file under … `data/`"), and violates the reproducible-content-hash governance precedent: a JSON edit would not produce a deploy-pinned `protocol_version`, undermining #26 governance and the auditability #9 (evidence citations) will need. It also bloats `ailments.json` (already 969 lines) with non-prescribing reference content, mixing the Rx-decision data source with educational/reference material. Rejected on both the constraint and the architecture.
- **Rejected.**

### Option C — Self-hosted licensed clinical image library + AI differential engine

License a dermatology image set, host on a public CDN, and generate differentials via an LLM at query time.

- **Pros:** Fully controlled image experience; AI differentials can incorporate the patient's confirmed symptoms.
- **Cons:** Materially out of scope for the NEXT tier. Image licensing is a legal/content-governance programme (copyright clearance per image, attribution, takedown handling) that belongs to roadmap #26 (clinical content governance) and has a real cost — incompatible with the "pennies/consult" independent-pharmacy price wedge (roadmap §4). An AI differential engine is roadmap #7-adjacent ("AI-drafted assessment notes") and, more importantly, would blur the PMS-owned clinical-safety boundary (roadmap §3): an LLM-generated "this is probably X, prescribe Y" suggestion is exactly the kind of automated clinical reasoning the roadmap keeps out of the CDST. Both pieces are LATER. The curated static differential set + DermNet deep-link captures the *displayed* clinical-confidence value at a fraction of the cost and risk.
- **Rejected** for NOW; the deep-link + curated-module path is the YAGNI choice that still moves the needle on the roadmap's stated edge.

### Recommendation

**Option A.** It is the faithful, minimal implementation of roadmap #6: it adds differential reasoning and clinical images where they're missing (the diagnosis-confirmation moment), it makes the correct content-governance choice (versioned hashed `src/lib/` module, matching #3/#4/#22), it makes the correct delivery choice for clinical images (DermNet NZ deep-link — zero copyright/hosting/PHI cost), it respects the PMS-owned safety boundary (pure reference, no automated gating), and uniquely among the NEXT-tier features it **ships live in Phase 1 with no infrastructure dependency** (no fly.io, no BAA, no Supabase table) — the entire feature is static reference content plus a public-URL link-out.

---

## 4. Components & Data Model

### 4.1 Differential content module (`src/lib/clinical/differentials.ts`, new)

The "reference content" analog to #22's `catalog.ts` and #4's `reasons.ts`. Per the content-governance precedent, it is a versioned, hashed TS module under `src/lib/` (not `data/`), so the exact differential set in effect is pinned by a `protocol_version` hash reproducible from the build.

```ts
export const DIFFERENTIALS_VERSION = "differentials-v1"

export type DifferentialDisposition = "treat_in_tool" | "refer" | "otc_only"

export interface Differential {
  name: string                       // the mimic/alternative diagnosis, e.g. "Herpes simplex (cold sore)"
  distinguishingFeatures: string     // one-line "what separates this from the presenting complaint"
  disposition: DifferentialDisposition
  // treat_in_tool = the CDST can manage it (it is one of the 19 ailments) -> "Also assess as {name}"
  // refer          = out of scope / red-flag-adjacent -> "Refer if suspected"
  // otc_only       = self-care, no Rx -> "OTC / self-care"
}

export interface DermNetLink {
  label: string                      // e.g. "Impetigo — DermNet NZ"
  url: string                        // canonical DermNet NZ topic URL
  topic: string                      // short topic key for analytics/link-check
}

export interface DifferentialEntry {
  differentials: Differential[]
  dermnetLinks: DermNetLink[]        // empty for non-dermatological ailments (DermNet is skin-only)
  clinicalPearls?: string[]          // optional short "pearls" (e.g. "folds spared = irritant")
}

// Keyed by ailment slug. Populated for all 19; the nine dermatological/morphological
// ailments (acne, candidal-stomatitis, conjunctivitis, dermatitis, herpes-labialis,
// impetigo, insect-bites-urticaria, tick-bites-lyme, hemorrhoids) carry dermnetLinks.
export const DIFFERENTIALS: Record<string, DifferentialEntry> = {
  "impetigo": {
    differentials: [
      { name: "Herpes simplex (cold sore/fever blister)",
        distinguishingFeatures: "Grouped vesicles on erythematous base, prodromal tingling; not honey-crusted",
        disposition: "treat_in_tool" },
      { name: "Atopic dermatitis, impetiginized (secondarily infected)",
        distinguishingFeatures: "Underlying eczema history, dry/pruritic patches, less sharply demarcated",
        disposition: "treat_in_tool" },
      { name: "Contact dermatitis",
        distinguishingFeatures: "Geometric/linear pattern matching the contactant; pruritic, weeping",
        disposition: "treat_in_tool" },
      { name: "Cellulitis / erysipelas",
        distinguishingFeatures: "Spreading erythema with systemic fever, warmth, tenderness; unwell patient",
        disposition: "refer" },
    ],
    dermnetLinks: [
      { label: "Impetigo — DermNet NZ", url: "https://dermnetnz.org/topics/impetigo", topic: "impetigo" },
      { label: "Herpes simplex — DermNet NZ", url: "https://dermnetnz.org/topics/herpes-simplex-virus", topic: "hsv" },
    ],
  },
  "dermatitis": {
    differentials: [
      { name: "Irritant diaper dermatitis",
        distinguishingFeatures: "Folds SPARED; confluent erythrema over convex surfaces",
        disposition: "treat_in_tool" },
      { name: "Candidal diaper dermatitis",
        distinguishingFeatures: "Folds INVOLVED + satellite pustules; bright-red, beefy erythrema",
        disposition: "treat_in_tool" },
      { name: "Seborrhoeic dermatitis",
        distinguishingFeatures: "Greasy scale on scalp/face/folds; less pruritic than atopic",
        disposition: "treat_in_tool" },
      { name: "Allergic contact dermatitis",
        distinguishingFeatures: "Pattern matches contactant (e.g. wipe, dye); sharply demarcated, pruritic",
        disposition: "treat_in_tool" },
      { name: "Psoriasis (napkin or plaque)",
        distinguishingFeatures: "Well-demarcated, silvery scale; +/- family history; often elbows/knees",
        disposition: "refer" },
    ],
    clinicalPearls: ["Steroid for irritant/atopic; azole/nystatin ONLY if candidal features present."],
    dermnetLinks: [
      { label: "Irritant contact dermatitis — DermNet NZ", url: "https://dermnetnz.org/topics/irritant-contact-dermatitis", topic: "irritant-cd" },
      { label: "Candidal napkin dermatitis — DermNet NZ", url: "https://dermnetnz.org/topics/candidal-napkin-dermatitis", topic: "candidal-napkin" },
    ],
  },
  // … remaining 17 ailments populated in the plan; non-dermatological ailments (e.g. dysmenorrhea,
  // gerd, uti) carry differentials but NO dermnetLinks. Ailments with no material differential
  // carry an empty differentials:[] and the panel is hidden (§6).
}

export function computeDifferentialsHash(
  entries: Record<string, DifferentialEntry>
): string {
  // sha256 over a stable serialization of (slug, differential.name, disposition) tuples.
  // Pins the exact differential set in effect -> protocol_version on downstream artefacts + #26.
}
```

`DIFFERENTIALS_VERSION` + the hash are the governance pin: a later clinical edit produces a new version, and any persisted artefact that cites the differential set (e.g. a future #14 outcomes study) references the hash — matching #2's `protocol_version`, #3's `statement_hash`, #22's catalog hash.

### 4.2 Type additions (`src/types/index.ts`, modified)

New types placed after the `Ailment` interface (`types/index.ts:7-16`):

```ts
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
```

(The module re-exports these from `src/lib/clinical/differentials.ts`; `types/index.ts` is the canonical type home per the existing convention where `Ailment`/`RxOption`/`PatientInfo` all live there, `types/index.ts:1-118`.)

### 4.3 The `<DifferentialPanel>` component (`src/components/wizard/differential-panel.tsx`, new)

A `"use client"` component, structurally a peer of the presenting-symptoms block in `step-redflags.tsx:94-125`. It is **collapsible** (default collapsed to preserve counter speed; the pharmacist expands when they want to reason through mimics) and **absent when an ailment has no differential entry** (graceful hide — §6).

```tsx
"use client"
import { useState } from "react"
import { DIFFERENTIALS } from "@/lib/clinical/differentials"
import { cn } from "@/lib/utils"

export function DifferentialPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  const entry = DIFFERENTIALS[slug]
  if (!entry || (entry.differentials.length === 0 && entry.dermnetLinks.length === 0)) return null
  const hasRefer = entry.differentials.some(d => d.disposition === "refer")
  return (
    <div className="rounded-md border">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between p-3 text-sm font-medium">
        <span className="flex items-center gap-2">
          {/* stethoscope/compare icon */}
          Differentials to consider {hasRefer && <span className="text-amber-600">• some require referral</span>}
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t px-3 pb-3 flex flex-col gap-3">
          {entry.differentials.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {entry.differentials.map(d => (
                <li key={d.name} className="text-sm flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{d.name}</span>
                    <DisposalTag disposition={d.disposition} />
                  </span>
                  <span className="text-xs text-muted-foreground pl-1">{d.distinguishingFeatures}</span>
                </li>
              ))}
            </ul>
          )}
          {entry.clinicalPearls?.map(p => <p key={p} className="text-xs italic text-muted-foreground">• {p}</p>)}
          {entry.dermnetLinks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {entry.dermnetLinks.map(l => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow"
                   className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                  {/* external-link icon */} {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

A tiny `<DisposalTag disposition>` renders an amber "Refer if suspected" chip for `refer`, a neutral "Also assess" chip for `treat_in_tool`, and a "Self-care" chip for `otc_only`. The external-link chips use `target="_blank" rel="noopener noreferrer nofollow"` — `noopener` prevents tab-nabbing, `nofollow` signals the link carries no paid/endorsed relationship (DermNet NZ is a third-party public resource, not a partner).

**Crucially, the panel emits no callbacks upward.** It does not modify `redFlagsChecked`, does not change `canNext`, and does not alter `selectedRx`. It is read-only decision support — the pharmacist's reasoning tool, not a gate. This is the feature's respect for the PMS-owned clinical-safety boundary (roadmap §3).

### 4.4 Wiring into the symptoms step (`src/components/wizard/step-redflags.tsx`, modified)

The panel renders inside the existing `!hasRedFlag` block (`step-redflags.tsx:94-139`), positioned **above** the "Presenting Symptoms" heading at `:96` so the pharmacist sees "differentials to consider" before confirming symptoms — the diagnosis-confirmation moment. The change is additive and local: `StepRedFlags` already receives `ailment` (`step-redflags.tsx:2`), so it passes `ailment.slug` to the panel with no new prop drilling:

```tsx
// inside the !hasRedFlag fragment, step-redflags.tsx:94
<>
  <DifferentialPanel slug={ailment.slug} />
  <div>
    <h3 className="text-base font-semibold mb-3">Presenting Symptoms</h3>
    {/* …existing checklist… */}
  </div>
  {/* …existing assessmentNotes textarea… */}
</>
```

No change to `WizardContainer` (`wizard-container.tsx`), no change to the `canNext` gate (`wizard-container.tsx:52-59`), no change to the PDF (`combined-pdf.tsx`), no change to the assessment data model (`types/index.ts:59-67`). The feature is a read-only render addition scoped to one step component.

### 4.5 (Optional, deferred) PDF + persistence surface

For NOW the feature is **reference-only and ephemeral**: the panel's state does not persist and does not appear on the PDF. The pharmacist's differential reasoning flows into the existing free-text `assessmentNotes` (`step-redflags.tsx:129-136`), which already renders onto the PDF (`combined-pdf.tsx:301-306`) and persists to #2's fly.io `assessment` row (`persist-assessments-flyio-design.md` §4.3). Whether to add a structured "differentials considered" array (persisted on fly.io, rendered as a PDF section, queryable for #14 outcomes) is an explicit Open Question (§7) — deferred to keep the NOW increment minimal and to avoid minting a new PHI field before the outcomes-research use case (#14) is scoped.

---

## 5. Security / PHIPA-PIPEDA Posture

This feature adds **no PHI** to the system and introduces **no new data store**. Its entire data surface is general clinical reference content (the differential module) plus public-URL link-outs (DermNet NZ). It therefore inherits all controls established by #2/#3 and adds the link-out discipline below.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| The `differentials.ts` module (differential names, distinguishing features, disposition tags, clinical pearls) | **Non-PHI** — general clinical reference, describes ailments not patients | Static TS module in the bundle; **not in any database.** Never fly.io, never Supabase. |
| DermNet NZ URLs (`dermnetLinks[].url`) | **Non-PHI** — a public string; carries no patient data | Static TS module in the bundle. |
| The pharmacist's interaction with the panel (expanded/collapsed, which link hovered) | **Non-PHI** ephemeral client state | React `useState` only; never sent to a server, never logged. |
| The pharmacist's free-text `assessmentNotes` (where differential reasoning is documented) | PHI (clinical reasoning about a specific patient) | **fly.io** `assessment` via #2 — **unchanged.** The feature adds no new PHI field; it routes through the existing notes path. |
| Any data transmitted to DermNet NZ on a link click | **None.** The link is a manual `<a target="_blank">` to a public page; no patient name, DOB, symptom, or pharmacy identifier is appended to the URL or sent in a request body. | n/a |

**Rule of thumb (roadmap §6.4):** the differential module and the DermNet URLs describe *ailments and a public atlas*, not a patient — they are non-PHI and live in the static bundle. The only PHI the feature touches (the pharmacist's notes) was already PHI before this feature and already routed to fly.io by #2.

### 5.2 The link-out discipline (the one new control)

The feature's only externally-observable behaviour is opening a public dermatology atlas in a new tab. Three controls keep this PHI-safe and consent-safe:

1. **No patient context in the URL.** The DermNet links are static strings from the module — the code never constructs `?q={symptom}` or appends `patient.name`/`dob`. A `rg` CI rule (in the plan) asserts every `dermnetLinks[].url` is a literal `https://dermnetnz.org/...` constant with no template interpolation, so no patient data can ever leak into the outbound request.
2. **Manual click only.** The panel never auto-opens a link (no `window.open` on render, no redirect). The pharmacist's explicit click is the only trigger, and the click carries only the static URL — the patient's identity never leaves the page.
3. **`rel="noopener noreferrer nofollow"`** on every external anchor: `noopener` prevents the new tab from script-accessing the CDST tab (tab-nabbing), `noreferrer` suppresses the `Referer` header (so DermNet NZ does not even see the pharmacy's app URL), and `nofollow` documents that the link is a clinical reference, not a paid endorsement.

### 5.3 Regulatory mapping

- **PHIPA:** the feature creates no new PHI collection, use, or disclosure. The reference module is general clinical information (s. 2 exclusion territory — not "identifying information" about an individual). The link-out is a disclosure of *nothing* (no patient data is transmitted), so it is not a PHIPA "disclosure" at all.
- **PIPEDA:** no commercial handling of personal information is added. The DermNet click is the pharmacist accessing a public website; no customer/patient information is transferred to a third party, so PIPEDA's transfer/accountability provisions (Principle 4.1.3) are not triggered.
- **No BAA implication:** because no PHI is added, the fly.io-BAA gate (roadmap §6.2, open question §7.1/#2) does not gate this feature. It ships live in Phase 1 independently of fly.io provisioning — the same property #22's non-PHI inventory ledger exploits.
- **Clinical-safety boundary (roadmap §3):** the `disposition` tags are advisory labels, not automated decisions. The feature performs **no** allergy, interaction, pregnancy, or severity automation — those remain PMS-owned. A `disposition: 'refer'` differential is information the pharmacist acts on via the *existing*, pharmacist-triggered red-flag referral flow (`wizard-container.tsx:142-172`); the CDST does not auto-refer. This is identical in spirit to how `ailment.redFlags` is a pharmacist-worked checklist today (`step-redflags.tsx:56-82`), not a data-layer hard block.

### 5.4 Application security

- **No new server surface:** the feature is entirely client-rendered from a static module. There is no new API route, no new server action, no new database query — nothing to authorize, nothing to inject, nothing to RLS.
- **No new dependencies:** the icons are inline SVG (matching the existing `<span>` icon pattern at `ailment-card.tsx:30-32` / `wizard-container.tsx:145`); the external links use plain `<a>`. No image library, no CDN client, no analytics SDK.
- **Content integrity:** the differential module is part of the signed build bundle; a tampered differential set requires a code deploy, which is review-gated — stronger than a runtime DB read. The `computeDifferentialsHash` lets a future auditor (or #26 governance) verify the exact differential set in effect for any past consultation.

---

## 6. Edge Cases

- **Ailment has no differentials defined:** `DIFFERENTIALS[slug]` is undefined (or the entry has empty `differentials` + empty `dermnetLinks`) → `<DifferentialPanel>` returns `null` (`differential-panel.tsx` guard) and the symptoms step renders exactly as today. Zero regression for ailments not yet curated.
- **Non-dermatological ailment (e.g., dysmenorrhea, GERD, UTI):** the entry carries `differentials` (dysmenorrhea has endometriosis/PID/fibroids; GERD has cardiac/malignancy; UTI has vaginitis/STI/interstitial cystitis) but **empty `dermnetLinks`** — DermNet NZ is a skin atlas. The panel shows the differential list but hides the "Clinical images" row. No broken image links for non-skin ailments.
- **Pharmacist ignores a `disposition: 'refer'` differential:** this is **by design**, not a defect. The CDST does not own clinical-safety gating (roadmap §3); the differential is information. The pharmacist remains responsible, exactly as they are for ticking (or not ticking) a red flag in `step-redflags.tsx:56-82` today. The amber "Refer if suspected" tag is the strongest nudge the tool makes; documenting the reasoning in `assessmentNotes` is the pharmacist's medico-legal record.
- **DermNet NZ restructures and a URL 404s:** the differential *text* (the durable decision-support value) still renders locally; only the external image is unavailable. The plan includes an optional CI link-checker task (soft, non-blocking) and the URLs are versioned in the module so a correction is a single PR + version bump. No patient-facing error — the link simply opens a 404 page, which the pharmacist closes.
- **Poor connectivity / offline at the counter:** the entire in-tool value (differential list, distinguishing features, disposition tags, clinical pearls) renders from the local bundle with no network call. Only the DermNet image link requires connectivity. The feature degrades gracefully to text-only decision support — a key resilience property for a tool used at a busy pharmacy counter.
- **Patient privacy on the open tab:** the pharmacist clicks "Impetigo — DermNet NZ" in front of/with the patient. The DermNet page is a general public medical article; no patient information is on the screen or in the URL. The CDST tab retains the patient's data (as it always has); the new tab shows only the public atlas. `noreferrer` ensures DermNet NZ does not learn the pharmacy's identity from the visit.
- **Collapsible-default preserves counter speed:** roadmap §4's wedge is counter speed. A differential panel that forces the pharmacist to scroll past nine mimics every consult would slow the confident prescriber. The panel is **collapsed by default** — one click reveals it only when the pharmacist wants to reason through a differential. A confident "this is clearly impetigo" consult is zero extra clicks.
- **Differential that overlaps an existing ailment in the tool (e.g., impetigo ↔ herpes-labialis):** `disposition: 'treat_in_tool'` renders as "Also assess as {name}" — a nudge that the mimic is itself one of the 19 ailments and the pharmacist could exit and restart the wizard under that ailment. The feature does **not** auto-switch the wizard (no wizard-state mutation); the pharmacist manually backs out via the existing `Back` button (`wizard-container.tsx:61-63`) and the dashboard.
- **Differential governance change:** because the module is versioned (`DIFFERENTIALS_VERSION` + hash), a later clinical edit (adding a mimic, correcting a feature) produces a new version. Any *persisted* artefact that cited the differential set would pin the old hash — but for NOW nothing persists the hash (reference-only), so a version bump is a clean PR with no migration. The hash discipline is in place for when #14/#26 need it.
- **Red flag already present (the `hasRedFlag` branch):** the panel renders only inside the `!hasRedFlag` block (`step-redflags.tsx:94`). If a red flag is already checked, the patient is being referred regardless (`wizard-container.tsx:142-172`), and differentials are moot — the panel is correctly hidden, matching today's behaviour where the symptoms checklist itself is hidden in the red-flag branch (`step-redflags.tsx:85-92`).
- **Multilingual (#24 interaction):** DermNet NZ is English-language. For #24's FR patient instructions, the clinical-image link stays EN (it is a pharmacist reference, not patient-facing), but the differential *names/features* are pharmacist-facing content that #24 may later localize. Flagged as an Open Question; no NOW conflict since #24 is a separate later feature.

---

## 7. Open Questions

1. **DermNet NZ deep-linking terms.** Is deep-linking to `dermnetnz.org` topic pages from a commercial clinical tool permitted under DermNet NZ's terms of use? Linking to public pages is generally permitted (and is how PharmAssess surfaces "DermNet clinical images" per roadmap §2), but confirm against DermNet NZ's current terms. Fallback if disallowed: link to a generic DermNet NZ search or to an equivalent open atlas (e.g., Primary Care Dermatology Society). The URL is a single field per entry, so a swap is mechanical.
2. **Self-hosted licensed images — when?** The deep-link delivers NOW value at zero cost, but a self-hosted, properly-licensed image set (so the image renders inline in the panel rather than opening a new tab) is a better UX. Confirm this is correctly scoped to #26 (clinical content governance) / a dedicated content-licensing workstream rather than folded into #6. Recommend: keep #6 deep-link-only; open a LATER ticket for licensed inline images.
3. **Should "differentials considered" persist as structured data?** For NOW the feature is reference-only (reasoning flows into free-text `assessmentNotes` → #2's fly.io `assessment`). Should a structured `differentials_considered: string[]` (the differential `name`s the pharmacist judged relevant) be added to #2's `assessment` JSONB and rendered as a PDF section? This would feed #14 (outcomes research — "which differentials were most often considered for condition X?") and #9 (evidence citations). Trade-off: a new PHI-adjacent field vs. analytics value. Recommend deferring until #14/#9 are scoped; the free-text path covers the medico-legal record for NOW.
4. **Where exactly to surface: symptoms step only, or also the dashboard card?** The design places the panel inline on the symptoms step (the diagnosis-confirmation moment). An alternative is a lightweight "common mimics" hint on the `<AilmentCard>` itself (dashboard), helping the pharmacist pick the *right* ailment before opening the wizard. Recommend symptoms-step-only for NOW (the dashboard hint risks cluttering the 19-card grid and the mimic list is most useful once symptoms are visible); revisit if pharmacists report mis-selecting ailments.
5. **Default collapsed vs. expanded.** The design defaults the panel **collapsed** to protect counter speed (§6). Confirm — some pharmacies may prefer expanded-by-default for a teaching/training context (#20 academy). Could be a per-pharmacy preference in settings; recommend collapsed default with no setting for NOW (YAGNI).
6. **Coverage scope for v1.** Should v1 populate `DIFFERENTIALS` for all 19 ailments, or only the nine dermatological/morphological ones (where mimics are most clinically acute and DermNet is relevant)? Recommend: populate differentials for all 19 (even non-dermatological ailments have mimics), but populate `dermnetLinks` only for the nine skin ailments. Confirm the non-dermatological differential lists (e.g., UTI ↔ vaginitis/STI) are clinically reviewed before launch.
7. **Disposition taxonomy sufficiency.** Is the three-value `treat_in_tool | refer | otc_only` disposition sufficient, or do reviewers want a fourth (e.g., `refer_if_red_flag` — "refer only if a specific feature appears")? The red-flag feature is already captured in `ailment.redFlags`, so a separate disposition may be redundant. Recommend three values for NOW; defer the fourth unless review identifies a gap.
8. **Should the differential `name` for a `treat_in_tool` mimic deep-link to that ailment's own wizard?** E.g., clicking "Herpes simplex" on the impetigo panel could deep-link to `/assess/herpes-labialis`. Nice-to-have for counter speed, but it introduces cross-wizard navigation that could lose the current patient's intake data (the `patient` state in `WizardContainer` is per-mount, `wizard-container.tsx:42`). Recommend NOT deep-linking for NOW (the "Also assess as {name}" text is the nudge; the pharmacist uses Back + dashboard), to avoid silently discarding intake.
9. **Reconciliation with #9 (evidence citations).** #9 will attach citations to protocol steps. The differentials' `distinguishingFeatures` are uncited clinical assertions in v1. Should v1 already carry a `citation` field per differential (which #9 then populates), or is that #9's job? Recommend leaving `distinguishingFeatures` uncited in #6 and letting #9 retrofit citations across the whole content surface (differentials, red flags, Rx notes) uniformly — avoids a partial-citation state.
10. **Analytics on panel usage.** Should the app record (non-PHI, on Supabase) how often a pharmacist *expands* the panel or *clicks* a DermNet link, to measure whether the feature is used? This would be a new non-PHI audit event (e.g., `differentials.viewed` with metadata `{ slug }`). Recommend deferring: the panel state is ephemeral client state by design (§5.1), and adding analytics is a #13 (analytics dashboard) concern. Confirm "no analytics for NOW" is acceptable.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/clinical/differentials.ts` — versioned differential + DermNet-link module (`DIFFERENTIALS`, `DIFFERENTIALS_VERSION`, `computeDifferentialsHash`), populated for all 19 ailments (dermnetLinks on the nine dermatological slugs).
- `src/components/wizard/differential-panel.tsx` — the collapsible read-only `<DifferentialPanel slug>` (renders inline on the symptoms step; no callbacks, no gating).
- `src/__tests__/differentials.test.ts` — module shape, hash stability, slug-coverage, every `dermnetLinks[].url` is a literal `https://dermnetnz.org/...` constant.
- `src/__tests__/differential-panel.test.tsx` — hide-when-empty, collapsed/expanded, external-link `rel` attributes, no patient-context URL interpolation.

**Modified:**
- `src/types/index.ts` — add `DifferentialDisposition`, `Differential`, `DermNetLink`, `DifferentialEntry` (after `Ailment` at `types/index.ts:7-16`).
- `src/components/wizard/step-redflags.tsx` — import and render `<DifferentialPanel slug={ailment.slug}/>` inside the `!hasRedFlag` block (`step-redflags.tsx:94`), above the "Presenting Symptoms" heading.

**Not touched (deliberately):** `data/ailments.json` (governance constraint + content-hash precedent); `wizard-container.tsx` (no state/gate change); `combined-pdf.tsx` / `referral-pdf.tsx` (reference-only, nothing persists to the PDF for NOW — §4.5); any fly.io or Supabase schema (no new data store); any server action / API route (entirely client-rendered).

**Environment / dependencies:** none new. No `PHI_PERSIST_ENABLED` dependency (ships live in Phase 1). No `pg`, no `@react-pdf` change, no image library — inline SVG + plain `<a target="_blank">` only.
