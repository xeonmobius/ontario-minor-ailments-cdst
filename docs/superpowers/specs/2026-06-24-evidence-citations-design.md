# Evidence Citations per Protocol Step — Design

**Date:** 2026-06-24
**Roadmap item:** #9 (NEXT tier) — "Evidence citations per protocol step"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST issues **clinical recommendations at every protocol step**, and **not one of them is traceable to an evidence source**. The wizard screens red flags (`src/components/wizard/step-redflags.tsx:56-82`, the `ailment.redFlags` checklist sourced from `data/ailments.json`), recommends first-line and alternative therapies with specific drugs, doses, and advisory notes (`step-rx.tsx:39-62` rendering `ailment.rxOptions` — e.g. `"Nitrofurantoin 100 mg", "1 cap BID × 5 days", "First-line; avoid if CrCl <30"` at `data/ailments.json:879-882`), counsels non-pharmacologic self-care (`step-rx.tsx:110-139`, `ailment.nonRx`), and sets a reassessment interval (`step-rx.tsx:141-144`, `ailment.followUp`). Each of these is a defensible clinical *assertion*: *why* is "Nodules, cysts, or scarring" a red flag that blocks prescribing for acne (`data/ailments.json:13`)? *Why* is nitrofurantoin 100 mg BID × 5 days first-line for uncomplicated cystitis, and *why* the CrCl <30 caveat? *Why* is a fluconazole 150 mg single oral dose contraindicated in pregnancy for vulvovaginal candidiasis (`data/ailments.json:933`)? Today the tool asserts these with no citation, no guideline reference, and no source attribution — a pharmacist cannot answer the question, and neither can a college inspector, a peer assessor, or a defence lawyer reviewing the record. The `Ailment` type (`src/types/index.ts:7-16`) carries `symptoms`, `redFlags`, `rxOptions`, `nonRx`, `followUp` — and nothing resembling `citations`, `evidence`, or `references`. A `rg` for `citation|guideline|evidence|pubmed|\bdoi\b|references` across `src/` returns **zero matches**.

This is exactly the gap the competitive research names: *"Evidence citations per protocol step — Clinical edge. Trust + liability shield"* (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §5, NEXT tier, row #9). The roadmap §3 records that the tool is *already* medico-legally asserting regimen, duration, and referral thresholds without provenance; §6.3 lists "audit trail" and "accountability" as required PHIPA controls. A CDST that prescribes but cannot point to its sources is, for a regulated pharmacist, a trust gap and a liability gap. The only place a source *is* named today is the regulatory authority itself — "Ontario Minor Ailment Assessment — O. Reg. 256/24" in the wizard header (`wizard-container.tsx:110`) and "O. Reg. 256/24 under the Pharmacy Act" in the PDF footer (`combined-pdf.tsx:321`, `referral-pdf.tsx:232`) — and even that is hard-coded decorative text, not a structured, version-pinned citation the document can reproduce on demand.

**The goal of this feature** is to add an **evidence-provenance layer** to the existing wizard and its documents — not a new workflow. It comprises: (a) a **versioned, hashed clinical module** (`src/lib/clinical/citations.ts`) holding, per ailment slug, a set of structured citations keyed to the **protocol steps** where the tool makes recommendations (regulatory authority, primary clinical guideline, and a per-step basis for red-flag screening, Rx selection, non-Rx advice, and follow-up); (b) **collapsible `<CitationPanel>`** affordances rendered inline on the two decision steps (`step-redflags.tsx` and `step-rx.tsx`) so the pharmacist can see *"why"* at the moment of the recommendation, expanding on demand (collapsed by default to preserve counter speed); and (c) a **"References" section rendered onto both generated PDFs** (`combined-pdf.tsx` and `referral-pdf.tsx`) so the *printed medico-legal record carries its evidence basis* — this is the durable liability-shield artefact, and it is the feature's headline value. The entire layer is **pure decision support and provenance**: it performs no automated gating, adds no allergy/interaction/pregnancy check (roadmap §3 keeps those PMS-owned), and introduces no new PHI.

**Out of scope** (per roadmap §3, §6, and YAGNI for the NEXT tier): **per-item citation of every individual checkbox, Rx note, and non-Rx bullet** (curation explosion — ~19 ailments × ~6 red flags × ~6 Rx × ~6 non-Rx yields thousands of citation edges with diminishing returns; many red flags share a single guideline, and brittle string-keying against `data/ailments.json` we cannot edit would silently break on any data edit — see §3 Option B); an **AI literature-search engine** that auto-retrieves citations at query time (that is #7-adjacent LLM territory and would introduce a third-party dependency + PHI-adjacent disclosure risk inconsistent with the "pure reference" posture); **live link-checking / DOI resolution as a runtime service** (a CI-time link-check is a soft LATER); **paywalled full-text retrieval** (the tool links to the public landing page / abstract / regulator page, exactly as a clinical bibliography does); **structured persistence of "citations consulted"** as a first-class PHI field (the versioned hash is the auditability hook; a per-consult "which sources the pharmacist opened" analytics field is a #13/#14 concern, deferred).

---

## 2. Current State (what exists in code)

### 2.1 Clinical recommendations are emitted at four protocol steps with zero provenance

The wizard (`wizard-container.tsx:40`) walks four steps. The clinical *assertions* the tool makes cluster into four protocol steps:

| Protocol step | Where it renders | The assertion (uncited today) |
|---|---|---|
| **Red-flag screening** | `step-redflags.tsx:56-82` (`ailment.redFlags`) | "These findings require referral; the patient cannot be prescribed for." E.g. UTI red flags at `data/ailments.json:867-876`. |
| **Rx selection** | `step-rx.tsx:39-62` (`ailment.rxOptions`) | "This drug, at this dose, is first-line / alternative, with this caveat." E.g. `"Nitrofurantoin 100 mg", "1 cap BID × 5 days", "First-line; avoid if CrCl <30"` (`data/ailments.json:879-882`); `"Fluconazole 150 mg", "Single oral dose", "First-line; NOT in pregnancy"` (`data/ailments.json:931-934`). |
| **Non-Rx advice** | `step-rx.tsx:110-139` (`ailment.nonRx`) | "These self-care measures should be discussed/counselled." E.g. UTI non-Rx at `data/ailments.json:899-905`. |
| **Follow-up** | `step-rx.tsx:141-144` (`ailment.followUp`) | "Reassess in this interval; refer if these criteria." E.g. UTI: "return if no improvement in 48–72h" (`data/ailments.json:906`). |

The `Ailment` type (`types/index.ts:7-16`) and `RxOption` (`types/index.ts:1-5`) have no field for any of: a source, a guideline, a citation, a strength-of-recommendation grade, or a content-version. The `AssessmentData` type (`types/index.ts:59-67`) likewise carries no provenance. The recommendation is presented as bare authority.

### 2.2 The one existing "source" is hard-coded decorative text, not a citation

The regulatory authority to prescribe minor ailments in Ontario — **O. Reg. 256/24 under the Pharmacy Act** — appears in three places, all as hand-typed string literals: the wizard header subtitle (`wizard-container.tsx:110`), the combined PDF footer (`combined-pdf.tsx:321`), and the referral PDF footer (`referral-pdf.tsx:232`). There is no structured `Citation` object, no canonical URL (the regulation is published at `ontario.ca` / `e-Laws`), and no way to reproduce "which version of the regulation governed this assessment." This decorative string is the seed #9 elevates to a first-class, versioned, citable reference applied to all 19 ailments.

### 2.3 The PDFs are text-only with a free footer area, but no references section

`<CombinedPdf>` (`src/components/combined-pdf.tsx`) renders a single `LETTER` page of `<Text>`/`<View>` nodes from `@react-pdf/renderer` (`combined-pdf.tsx:3-9`). The layout ends with a `<View style={styles.signatureSection}>` (`:309-315`), a `<View style={styles.footerDivider}>` (`:317`), a PHIPA box (`:318-320`), and a centred footer line (`:321`). There is **no references / sources section** — the printed document asserts a regimen and a referral threshold and cites nothing. `<ReferralPdf>` (`src/components/wizard/referral-pdf.tsx`) has the identical structure (signature section at `referral-pdf.tsx:222-228`, PHIPA box at `:231-233`, footer at `:234`) and the identical gap. Both PDFs are generated fully client-side via `downloadPdf(doc)` → `pdf(document).toBlob()` (`src/lib/pdf-helpers.ts`), so a references section is a client-rendered `<View>` of `<Text>` lines — no server round-trip, no new dependency.

### 2.4 No external-link primitive, no citation content, no link-out discipline

A `rg` for `citation|guideline|evidence|pubmed|\bdoi\b|references` across `src/` returns **zero matches** (confirmed). There is no `<a target="_blank">` external-link primitive in the UI kit, and — relevant as precedent — feature #6 (differentials + DermNet) introduced the **link-out discipline** this feature will reuse verbatim: literal public-URL constants in a versioned `src/lib/clinical/` module, manual-click-only (no auto-`window.open`), and `rel="noopener noreferrer nofollow"` on every external anchor (`2026-06-24-differential-diagnosis-dermnet-design.md` §5.2). #6's Open Question §7.9 *explicitly deferred* differential citations to #9: *"let #9 retrofit citations across the whole content surface uniformly — avoids a partial-citation state."* #9 is therefore the **unified citation layer** #6 anticipated; it is not a parallel system.

### 2.5 The content-governance precedent (where clinical modules live)

Every prior feature that introduced curated clinical/governance content placed it in a **versioned, hashed TS module under `src/lib/`**, not in `data/ailments.json`: #3's `src/lib/consent/statements.ts`, #4's `src/lib/.../reasons.ts`, #22's `src/lib/vaccines/catalog.ts`, and #6's `src/lib/clinical/differentials.ts` all follow the rule *"clinical content needing a reproducible content hash is a TS module under `src/lib/`"* — driven both by the reproducible-hash requirement (feeding `protocol_version` on persisted rows and #26 governance) and by the gnhf constraint forbidding edits to `data/`. The citations module is exactly this class of content (a source list whose exact contents must be pinned by a build-reproducible hash for audit defensibility).

### 2.6 No PHI implications in the provenance layer

The citations module, the source URLs/DOIs, and the per-step `summary` text are **general clinical reference content** — they describe guidelines, studies, and regulations, not patients. They carry no patient data and therefore implicate neither fly.io nor the BAA gate. The feature deliberately adds **no new structured PHI field**; the only PHI-adjacent element remains the pharmacist's free-text `assessmentNotes` (already captured at `step-redflags.tsx:129-136`, already rendered on the PDF at `combined-pdf.tsx:301-306`, already routed to #2's fly.io `assessment` row per `persist-assessments-flyio-design.md` §4.3 — unchanged). The feature therefore ships **live in Phase 1 with no `PHI_PERSIST_ENABLED` dependency** — the same "non-PHI ships live immediately" property #6 differentials and #22 inventory enjoy.

---

## 3. Approach (options + recommendation)

The design hinges on five decisions: (a) where the citation content lives (`data/ailments.json` vs. a new `src/lib/` module); (b) the **granularity** of attachment — per-ailment, per-protocol-step, or per-individual-checkbox; (c) where citations surface in the UI (wizard only, PDF only, or both); (d) how external sources are linked (literal public deep-link vs. a self-hosted citation proxy vs. paywall-bypass); (e) whether "citations consulted" persists as structured data. Options are evaluated against roadmap §3 (PMS-owned clinical-safety boundary), §6.4 (PHI partitioning rule), §4 (counter-speed wedge), and the established #3/#4/#6/#22 content-governance precedent.

### Option A — Versioned `src/lib/clinical/citations.ts` module, section-level citations **per protocol step** + universal regulatory anchor + inline collapsible `<CitationPanel>` on the decision steps + a "References" section on both PDFs (RECOMMENDED)

A new versioned module `src/lib/clinical/citations.ts` exports `CITATIONS_VERSION` ("citations-v1"), a `computeCitationsHash(...)` function (sha256 over the slug→citation tuples, feeding `protocol_version` on the PDF references footer and #26 governance — identical discipline to #6's `computeDifferentialsHash`), and a `CITATIONS: Record<string, AilmentCitations>` keyed by ailment slug. Each `AilmentCitations` carries: (1) `regulatory` — the universal authority (O. Reg. 256/24) applied per-ailment so the per-document footer reproduces it without a global side-channel; (2) `primary` — the authoritative clinical guideline(s) for the ailment (e.g. AMMI Canada / IDSA guidance for UTI and Lyme post-exposure prophylaxis, SOGC guidance for dysmenorrhea and NVP, national acne/VVC guidance); (3) `byStep` — an optional `Partial<Record<ProtocolStep, Citation[]>>` giving a **per-protocol-step** basis (`redFlagScreening`, `rxSelection`, `nonRxAdvice`, `followUp`) where a step has a distinct evidence basis. The `summary` field on each `Citation` is where recommendation-specific provenance lives (e.g. an `rxSelection` citation whose `summary` reads *"Nitrofurantoin 100 mg BID × 5 days is first-line for uncomplicated cystitis; avoid if CrCl <30 mL/min"*), so a recommendation's "why" is captured **without** brittle per-string keying against `data/ailments.json`.

Two presentation surfaces, both client-rendered:

- **Inline in the wizard:** a `"use client"` `<CitationPanel step="redFlagScreening" slug={ailment.slug} />` rendered (collapsed by default) inside the red-flag block of `step-redflags.tsx`, and a `<CitationPanel step="rxSelection" slug={ailment.slug} />` plus a `followUp`/`nonRxAdvice` panel rendered in `step-rx.tsx`. Expanding reveals the citation list (source, year, a small `type` badge — guideline/study/regulatory/monograph/systematic-review — and an external "open source" link using the #6 link-out discipline). The panels emit **no** callbacks: they do not modify `redFlagsChecked`, `selectedRx`, or `canNext`. They are read-only provenance — decision support, not a gate.
- **On both PDFs:** a `<ReferencesSection citations={uniqueCitationsForSlug} version={CITATIONS_VERSION} hash={CITATIONS_HASH} />` rendered above the PHIPA footer in `combined-pdf.tsx` (between the signature section at `:309` and the footer divider at `:317`) and in `referral-pdf.tsx` (between `:228` and `:230`). The section lists the ailment's unique citations (regulatory + primary + the relevant step bases) as a compact numbered bibliography of `<Text>` (source, year, type, URL-or-DOI), pinned with `Citations v1 · <hash8>`. This is the **durable liability-shield artefact**: the printed medico-legal record names its sources.

- **Pros:** Faithful to the roadmap's exact wording — "citations **per protocol step**" maps 1:1 to the `byStep` basis, and the regulatory anchor satisfies the "trust" axis while the PDF bibliography satisfies the "liability shield" axis. Reuses the now-established content-governance precedent (#3/#4/#6/#22: versioned hashed `src/lib/` module) at zero governance novelty and reuses #6's link-out discipline verbatim. **Ships live in Phase 1** with no fly.io/BAA/`PHI_PERSIST_ENABLED` dependency — the entire feature is non-PHI reference content + public-URL link-outs. Section-level attachment (not per-checkbox) is **robust to `data/ailments.json` edits**: citations key on the slug + protocol step, never on the exact red-flag/Rx-note strings we cannot control, so a data-layer rephrase cannot silently orphan a citation. Collapsed-default protects counter speed (roadmap §4): a confident prescriber's flow has zero extra clicks; the citations are one expand away when the pharmacist (or a trainee — #20 academy) wants the "why." Sibling-friendly: the citation `summary` text and the versioned hash are the exact inputs #7 (AI-drafted notes) can quote as provenance and #14 (outcomes research) / #26 (governance) consume; the `regulatory` citation closes the provenance gap #6's Open Question §7.9 explicitly parked for #9.
- **Cons:** The PDF references section adds height to an already dense single-page combined document (`combined-pdf.tsx` is a single `LETTER` page). Mitigated: the section is compact (one `<Text>` line per citation, 5–6 pt), conditionally rendered only when citations exist, and the citation set per ailment is bounded (~3–6). Curating the citation set per ailment is clinical/governance content requiring pharmacist + ideally literature-review sign-off (mitigated by the versioned-hash discipline identical to #3/#4/#6/#22; flagged as a soft gate in rollout). The external "open source" link depends on the publisher's URL stability (mitigated: the *source name + year + DOI* render in the PDF bibliography regardless of link liveness; a DOI is more stable than a URL and is preferred where available; a CI link-check is a soft LATER, §7).

### Option B — Per-item citation of every checkbox, Rx note, and non-Rx bullet

Attach a citation to each individual `ailment.redFlags[i]`, `ailment.rxOptions[i].notes`, `ailment.nonRx[i]`, and `ailment.followUp` string.

- **Pros:** Maximally granular "why this exact line"; strong answer to a line-by-line audit.
- **Cons:** **Curation explosion** — ~19 ailments × (~6 red flags + ~6 Rx options + ~6 non-Rx items + follow-up) ≈ 700+ individual citation edges, most of low marginal value because a single guideline underwrites a whole step's checklist. Worse, it requires **brittle string-keying** against `data/ailments.json` (a citation keyed on `"First-line; avoid if CrCl <30"` orphans silently the moment a data edit rephrases the note) — and the gnhf constraint forbids editing `data/`, so we cannot co-locate a stable key. Per-item granularity is the textbook YAGNI failure: it multiplies content-governance burden (#26) and string-drift breakage for an audit depth no Canadian college currently requires. The section-level `summary` in Option A captures recommendation-specific provenance *without* the brittleness.
- **Rejected.**

### Option C — Single ailment-level "primary source" only (no per-step granularity)

One citation per ailment — a single "source for this protocol" — surfaced as a footer line only.

- **Pros:** Minimal effort; trivially robust.
- **Cons:** **Fails the liability-shield goal at the level where liability actually attaches.** A college inspector asking *"why is fluconazole contraindicated in pregnancy for this VVC assessment?"* is not answered by "see the SOGC guideline (general)" — the recommendation-specific "why" lives at the *protocol step*, not the ailment. This is the exact granularity the roadmap names ("per **protocol step**"), and Option C discards it. It also produces a printed bibliography too thin to function as a real shield.
- **Rejected** for NOW; Option A is the minimal design that actually satisfies the roadmap's stated edge ("trust + liability shield" at the recommendation level).

### Recommendation

**Option A.** It is the faithful, minimal implementation of roadmap #9: it adds evidence provenance where it is missing (at each clinical-decision step) and on the document that carries medico-legal weight (both PDFs), it makes the correct content-governance choice (versioned hashed `src/lib/` module, matching #3/#4/#6/#22), it makes the correct attachment choice (section-level per protocol step — robust to data edits, no brittle string-keying), it makes the correct delivery choice for sources (literal public deep-links with the #6 link-out discipline — zero PHI transmission, zero proxy infra), it respects the PMS-owned safety boundary (pure provenance, no automated gating), and — uniquely among citation designs — it **ships live in Phase 1 with no infrastructure dependency** (no fly.io, no BAA, no Supabase table), because the entire feature is static reference content, public-URL link-outs, and client-rendered PDF text.

---

## 4. Components & Data Model

### 4.1 Citation content module (`src/lib/clinical/citations.ts`, new)

The "provenance content" analog to #6's `differentials.ts`, #4's `reasons.ts`, #22's `catalog.ts`. Per the content-governance precedent, it is a versioned, hashed TS module under `src/lib/` (not `data/`), so the exact citation set in effect is pinned by a `protocol_version` hash reproducible from the build.

```ts
import { createHash } from "node:crypto"
import type { AilmentCitations, Citation, ProtocolStep } from "@/types"

export const CITATIONS_VERSION = "citations-v1"

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
  id: string                         // stable cite key, e.g. "on-o-reg-256-24", "ammi-uti-cystitis"
  source: string                     // human label, e.g. "AMMI Canada. Uncomplicated UTI in Adults. 2024."
  type: CitationType
  year?: number
  url?: string                       // public deep-link (e-Laws, journal, PubMed, regulator), LITERAL constant
  doi?: string                       // preferred over url where available (more stable)
  summary?: string                   // one-line "what this source supports / the recommendation it backs"
}

export interface AilmentCitations {
  regulatory: Citation[]             // O. Reg. 256/24 authority — applied per-ailment for the per-document footer
  primary: Citation[]                // authoritative clinical guideline(s) for the ailment
  byStep?: Partial<Record<ProtocolStep, Citation[]>>  // per-protocol-step basis (optional where a step shares `primary`)
}

// Keyed by ailment slug. Populated for all 19 (regulatory + at least one primary).
export const CITATIONS: Record<string, AilmentCitations> = {
  "uti": {
    regulatory: [
      { id: "on-o-reg-256-24", source: "O. Reg. 256/24 under the Pharmacy Act (Ontario Minor Ailments)",
        type: "regulatory", year: 2024, url: "https://www.ontario.ca/laws/regulation/240256",
        summary: "Authority for Ontario pharmacists to prescribe for uncomplicated UTI as a designated minor ailment." },
    ],
    primary: [
      { id: "ammi-uti-cystitis", source: "AMMI Canada. Management of Uncomplicated UTI in Adults.",
        type: "guideline", year: 2024, doi: "10.14799/...", // DOI completed at clinical-review (Task 3)
        summary: "Nitrofurantoin 100 mg BID × 5 days first-line for uncomplicated cystitis; avoid if CrCl <30 mL/min." },
    ],
    byStep: {
      redFlagScreening: [
        { id: "ammi-uti-cystisis-redflags", source: "AMMI Canada. Management of Uncomplicated UTI in Adults.",
          type: "guideline", year: 2024,
          summary: "Pyelonephritis features (fever, flank pain, rigors), male sex, pregnancy, age <12, immunocompromise, and catheter/abnormal tract mandate referral, not pharmacist prescribing." },
      ],
      followUp: [
        { id: "ammi-uti-followup", source: "AMMI Canada. Management of Uncomplicated UTI in Adults.",
          type: "guideline", year: 2024,
          summary: "Reassess at 48–72 h; refer if no improvement or systemic symptoms develop." },
      ],
    },
  },
  "vvc": {
    regulatory: [{ id: "on-o-reg-256-24", source: "O. Reg. 256/24 under the Pharmacy Act (Ontario Minor Ailments)",
      type: "regulatory", year: 2024, url: "https://www.ontario.ca/laws/regulation/240256",
      summary: "Authority to prescribe for vulvovaginal candidiasis as a designated minor ailment." }],
    primary: [
      { id: "sogc-vvc", source: "SOGC. Vulvovaginal Candidiasis.", type: "guideline", year: 2024,
        summary: "Fluconazole 150 mg single oral dose first-line; NOT in pregnancy — use topical azole (clotrimazole)." },
    ],
    byStep: {
      rxSelection: [{ id: "sogc-vvc", source: "SOGC. Vulvovaginal Candidiasis.", type: "guideline", year: 2024,
        summary: "Fluconazole is first-line in non-pregnant patients; topical azoles (clotrimazole) are first-line in pregnancy." }],
    },
  },
  // … remaining 17 ailments populated in the plan (Task 3). Every entry carries the
  // regulatory anchor; primary + byStep are populated per the clinical-review content task.
  // Ailments with no curated primary yet carry regulatory-only and the panel/PDF render
  // just the regulatory citation (graceful degrade — §6).
}

export function computeCitationsHash(entries: Record<string, AilmentCitations>): string {
  // sha256 over a stable serialization of (slug, citation.id, type) tuples across
  // regulatory + primary + every byStep list. Pins the exact citation set in effect ->
  // protocol_version on the PDF references footer + #26 governance.
  const tuples = Object.keys(entries)
    .sort()
    .flatMap(slug => {
      const a = entries[slug]
      const ids: string[] = []
      a.regulatory.forEach(c => ids.push(`${slug}|regulatory|${c.id}|${c.type}`))
      a.primary.forEach(c => ids.push(`${slug}|primary|${c.id}|${c.type}`))
      if (a.byStep) {
        ;(Object.keys(a.byStep) as ProtocolStep[]).sort().forEach(step => {
          a.byStep![step]!.forEach(c => ids.push(`${slug}|${step}|${c.id}|${c.type}`))
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
  for (const c of [...a.regulatory, ...a.primary, ...(a.byStep ? flatSteps(a.byStep) : [])]) {
    if (!seen.has(c.id)) { seen.add(c.id); out.push(c) }
  }
  return out
}

function flatSteps(byStep: NonNullable<AilmentCitations["byStep"]>): Citation[] {
  return (Object.values(byStep) as Citation[][]).flat()
}
```

`CITATIONS_VERSION` + the hash are the governance pin: a later clinical edit (adding a source, correcting a DOI) produces a new version, and any artefact that cites the set (the printed PDF footer today; a future #14 outcomes study) references the hash — matching #2's `protocol_version`, #3's `statement_hash`, #6's differentials hash, #22's catalog hash. The regulatory anchor (`on-o-reg-256-24`) is reproduced per-ailment so a single-ailment PDF footer is self-contained with no global side-channel.

### 4.2 Type additions (`src/types/index.ts`, modified)

New types placed after the `Ailment` interface (`types/index.ts:7-16`):

```ts
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
```

(The module re-exports/imports these from `src/lib/clinical/citations.ts`; `types/index.ts` is the canonical type home per the existing convention where `Ailment`/`RxOption`/`PatientInfo` all live, `types/index.ts:1-118`.)

### 4.3 The `<CitationPanel>` component (`src/components/wizard/citation-panel.tsx`, new)

A `"use client"` component, a peer of the recommendation blocks in `step-redflags.tsx` and `step-rx.tsx`. It is **collapsible** (default collapsed to preserve counter speed; the pharmacist expands when they want the "why") and **absent when an ailment has no citation for the requested step** (graceful hide — §6).

```tsx
"use client"
import { useState } from "react"
import { CITATIONS } from "@/lib/clinical/citations"
import type { ProtocolStep } from "@/types"
import { cn } from "@/lib/utils"

export function CitationPanel({ slug, step }: { slug: string; step: ProtocolStep }) {
  const [open, setOpen] = useState(false)
  const entry = CITATIONS[slug]
  const stepCitations = entry?.byStep?.[step] ?? []
  // Always include regulatory + primary so the panel is useful even when byStep is absent,
  // but dedupe by id.
  const list = dedupe([...(entry?.primary ?? []), ...stepCitations])
  if (list.length === 0 && (entry?.regulatory ?? []).length === 0) return null
  return (
    <div className="rounded-md border">
      <button onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between p-2 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {/* book/file-text icon */}
          Evidence {list.length > 0 && <span>({list.length})</span>}
        </span>
        <span className="text-[11px]">{open ? "Hide" : "Show sources"}</span>
      </button>
      {open && (
        <div className="border-t px-2 pb-2 flex flex-col gap-1.5">
          {list.map(c => <CitationRow key={c.id} c={c} />)}
          {(entry?.regulatory ?? []).map(c => <CitationRow key={c.id} c={c} muted />)}
        </div>
      )}
    </div>
  )
}

function CitationRow({ c, muted }: { c: Citation; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <TypeBadge type={c.type} />
        <span className={cn("text-xs", muted && "text-muted-foreground")}>{c.source}{c.year ? ` (${c.year})` : ""}</span>
        {c.url && (
          <a href={c.url} target="_blank" rel="noopener noreferrer nofollow"
             className="text-[11px] text-primary hover:underline">{/* external-link icon */}source</a>
        )}
        {c.doi && !c.url && (
          <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noopener noreferrer nofollow"
             className="text-[11px] text-primary hover:underline">doi</a>
        )}
      </span>
      {c.summary && <span className="text-[11px] text-muted-foreground pl-1">{c.summary}</span>}
    </div>
  )
}
```

A tiny `<TypeBadge type>` renders a neutral lowercase chip (`guideline` / `study` / `systematic-review` / `regulatory` / `monograph`) so the pharmacist sees the evidence grade at a glance. The external links use `target="_blank" rel="noopener noreferrer nofollow"` — `noopener` prevents tab-nabbing, `noreferrer` suppresses the `Referer` header (so the publisher does not learn the pharmacy's app URL), `nofollow` signals an informational reference (not an endorsement). Where a `doi` is present and `url` is not, the link is the canonical `https://doi.org/{doi}` resolver (a literal template over a static `doi` field — still no patient context; the DOI is a public identifier of the *source*, not the patient).

**Crucially, the panel emits no callbacks upward.** It does not modify `redFlagsChecked`, `selectedRx`, `assessmentNotes`, or `canNext`. It is read-only provenance — the pharmacist's accountability aid, not a gate. This is the feature's respect for the PMS-owned clinical-safety boundary (roadmap §3).

### 4.4 Wiring into the decision steps (`step-redflags.tsx` + `step-rx.tsx`, modified)

- **`step-redflags.tsx`:** render `<CitationPanel slug={ailment.slug} step="redFlagScreening" />` as the **last child of the red-flags block** (after the checklist at `step-redflags.tsx:55-83`, before/above the `hasRedFlag` alert at `:85`). `ailment` is already in scope (`step-redflags.tsx:2`), so no prop drilling. This places "why these are red flags" next to the red-flag screen itself.
- **`step-rx.tsx`:** render `<CitationPanel slug={ailment.slug} step="rxSelection" />` immediately under the Rx-options grid (`step-rx.tsx:36-63`), and a compact `<CitationPanel slug={ailment.slug} step="followUp" />` beside the Follow-up paragraph (`step-rx.tsx:141-144`). Optionally a `step="nonRxAdvice"` panel under the non-Rx block (`:110-139`).

No change to `WizardContainer` (`wizard-container.tsx`), no change to the `canNext` gate (`wizard-container.tsx:52-59`), no change to the assessment data model (`types/index.ts:59-67`). The feature is read-only render additions scoped to the two decision-step components.

### 4.5 The `<ReferencesSection>` on the PDFs (`combined-pdf.tsx` + `referral-pdf.tsx`, modified)

This is the **liability-shield artefact** and the feature's headline value. A shared client component renders the ailment's unique citation set as a compact numbered bibliography pinned with the citations version + hash.

```tsx
// src/components/wizard/pdf-references.tsx  ("use client", @react-pdf/renderer nodes)
import { Text, View, StyleSheet } from "@react-pdf/renderer"
import { getCitations, CITATIONS_VERSION, CITATIONS_HASH } from "@/lib/clinical/citations"

const styles = StyleSheet.create({
  refsLabel: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#1a6b6b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 1, marginTop: 3 },
  refItem: { flexDirection: "row", marginBottom: 0.5 },
  refNum: { width: 10, fontSize: 6, fontFamily: "Helvetica-Bold", color: "#555555" },
  refText: { fontSize: 6, color: "#555555", flex: 1 },
})

export function ReferencesSection({ slug }: { slug: string }) {
  const citations = getCitations(slug)
  if (citations.length === 0) return null
  const hash8 = CITATIONS_HASH.slice(0, 8)
  return (
    <View>
      <Text style={styles.refsLabel}>References ({CITATIONS_VERSION} · {hash8})</Text>
      {citations.map((c, i) => (
        <View key={c.id} style={styles.refItem} wrap={false}>
          <Text style={styles.refNum}>{i + 1}.</Text>
          <Text style={styles.refText}>
            {c.source}{c.year ? ` (${c.year})` : ""}{c.doi ? ` · doi:${c.doi}` : c.url ? ` · ${c.url}` : ""} [{c.type}]
          </Text>
        </View>
      ))}
    </View>
  )
}
```

- **`combined-pdf.tsx`:** render `<ReferencesSection slug={ailment.slug} />` between the signature section (`combined-pdf.tsx:309-315`) and the footer divider (`:317`). `ailment` is already a prop (`combined-pdf.tsx:159/171`).
- **`referral-pdf.tsx`:** render the same `<ReferencesSection slug={ailment.slug} />` between the signature section (`referral-pdf.tsx:222-228`) and the footer divider (`:230`). `ailment` is already a prop (`referral-pdf.tsx` props).

The bibliography is printed text (`<Text>`), so it is durable on a printed/faxed document regardless of link liveness; the `version · hash8` line lets a future auditor (or #26 governance) pin the exact citation set in effect for that document — the medico-legal "we followed the v1 protocol, sources attached" record. URLs are printed as plain text (PDF `<Text>` is not a hyperlink in print); the DOI is preferred where available because it is a stable resolvable identifier.

### 4.6 (Optional, deferred) persistence surface

For NOW the feature is **reference-only**: the versioned hash pins the citation set for auditability, but the assessment row does **not** store a `citations_consulted` array. Whether to persist "which sources the pharmacist opened" (for #14 outcomes adoption analysis, or #26 governance drift detection) is an explicit Open Question (§7) — deferred to keep the NOW increment minimal and to avoid minting a new PHI-adjacent field before the analytics use case is scoped. The `CITATIONS_VERSION` + hash are sufficient today: any persisted assessment implicitly references the version active at build time, recoverable from git history + the printed PDF footer.

---

## 5. Security / PHIPA-PIPEDA Posture

This feature adds **no PHI** to the system and introduces **no new data store**. Its entire data surface is general clinical reference content (the citations module) plus public-URL link-outs (e-Laws, journal sites, PubMed, regulator pages). It therefore inherits all controls established by #2/#3/#6 and reuses #6's link-out discipline verbatim.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| The `citations.ts` module (source names, years, types, summaries, DOIs, URLs) | **Non-PHI** — general clinical/legal reference, describes guidelines and regulations, not patients | Static TS module in the bundle; **not in any database.** Never fly.io, never Supabase. |
| The printed PDF "References" section (the bibliography text + `version · hash`) | **Non-PHI** provenance, but it is rendered *onto* a PHI document (the prescription/referral). The references themselves describe sources, not the patient. | Client-rendered PDF bytes (the PDF as a whole is PHI under #2's partitioning; the references block is non-PHI content embedded in a PHI artefact). |
| The pharmacist's interaction with the `<CitationPanel>` (expanded/collapsed, which source opened) | **Non-PHI** ephemeral client state | React `useState` only; never sent to a server, never logged. |
| The pharmacist's free-text `assessmentNotes` (unchanged) | PHI (clinical reasoning about a specific patient) | **fly.io** `assessment` via #2 — **unchanged.** The feature adds no new PHI field. |
| Any data transmitted to a publisher on an "open source" click | **None.** The link is a manual `<a target="_blank">` to a public page (e-Laws, journal, PubMed); no patient name, DOB, symptom, drug, or pharmacy identifier is appended to the URL or sent in a request body. | n/a |

**Rule of thumb (roadmap §6.4):** the citations module and the source URLs describe *guidelines and laws*, not a patient — they are non-PHI and live in the static bundle. The only PHI the feature touches (the pharmacist's notes, and the PDF document the references are printed onto) was already PHI before this feature and was already routed to fly.io by #2 / generated client-side by the existing PDF path.

### 5.2 The link-out discipline (reused verbatim from #6)

The feature's only externally-observable behaviour is opening a public source page in a new tab. Three controls keep this PHI-safe and consent-safe (identical to #6's DermNet discipline, `2026-06-24-differential-diagnosis-dermnet-design.md` §5.2):

1. **No patient context in the URL.** Citation `url` values are static strings from the module; the `doi` link is `https://doi.org/{doi}` over a static `doi` field. The code never constructs `?q={symptom}` or appends `patient.name`/`dob`/`drug`. A CI `rg` rule (in the plan) asserts every `url` is a literal constant with no template interpolation and no query string, and that no `patient.` reference appears in the panel component — so no patient data can ever leak into the outbound request.
2. **Manual click only.** The panel never auto-opens a link (no `window.open` on render, no redirect). The pharmacist's explicit click is the only trigger, and the click carries only the static URL/DOI — the patient's identity never leaves the page.
3. **`rel="noopener noreferrer nofollow"`** on every external anchor: `noopener` prevents the new tab from script-accessing the CDST tab (tab-nabbing), `noreferrer` suppresses the `Referer` header (so the publisher does not even see the pharmacy's app URL), and `nofollow` documents that the link is a clinical reference, not a paid endorsement.

### 5.3 Regulatory mapping

- **PHIPA:** the feature creates no new PHI collection, use, or disclosure. The reference module is general clinical/legal information (s. 2 exclusion territory — not "identifying information" about an individual). The link-out is a disclosure of *nothing* (no patient data is transmitted). The printed references section is non-PHI content embedded in an already-PHI document — it does not change the document's PHI classification.
- **PIPEDA:** no commercial handling of personal information is added. The source click is the pharmacist accessing a public website; no customer/patient information is transferred to a third party, so PIPEDA's transfer/accountability provisions (Principle 4.1.3) are not triggered.
- **No BAA implication:** because no PHI is added, the fly.io-BAA gate (roadmap §6.2, open question §7.1/#2) does not gate this feature. It ships live in Phase 1 independently of fly.io provisioning — the same property #6 differentials and #22 inventory exploit.
- **Clinical-safety boundary (roadmap §3):** citations are provenance labels, not automated decisions. The feature performs **no** allergy, interaction, pregnancy, or severity automation — those remain PMS-owned. A `summary` reading "fluconazole is contraindicated in pregnancy" is *information* that contextualises an already-captured advisory note (`data/ailments.json:933`); it does not add a new gate. The CDST does not auto-exclude an Rx because a citation exists. This is identical in spirit to how `ailment.redFlags` is a pharmacist-worked checklist today (`step-redflags.tsx:56-82`), not a data-layer hard block.
- **Liability shield, not liability transfer:** the references section documents *what sources the protocol was built from*. It does not assert that the sources guarantee correctness, and the pharmacist remains the author of record for every decision (matching #7's "pharmacist is always the author of record" discipline). A citation is accountability aid, not a malpractice defence on its own — but its absence today is a gap a regulator would flag, which is exactly the roadmap's "liability shield" rationale.

### 5.4 Application security

- **No new server surface:** the feature is entirely client-rendered from a static module. No new API route, no new server action, no new database query — nothing to authorize, nothing to inject, nothing to RLS.
- **No new dependencies:** the type badge and icons are inline SVG or `lucide-react` (already a dependency, `package.json:21`); the external links use plain `<a>`; the PDF references use existing `@react-pdf/renderer` (`Text`/`View`, `package.json:15`) already imported by both PDFs. `node:crypto` is a Node built-in (the hash), not a new package.
- **Content integrity:** the citations module is part of the signed build bundle; a tampered citation set requires a code deploy, which is review-gated — stronger than a runtime DB read. `computeCitationsHash` lets a future auditor (or #26 governance) verify the exact citation set in effect for any past consultation by matching the `version · hash8` printed on the document.

---

## 6. Edge Cases

- **Ailment has no citations defined:** `CITATIONS[slug]` is undefined → `<CitationPanel>` returns `null` (guard) and the PDF `<ReferencesSection>` returns `null` → both PDFs and both steps render exactly as today. Zero regression for ailments not yet curated. (For v1 all 19 carry at least the regulatory anchor, so this is a forward-compatibility path.)
- **Ailment has only the regulatory citation (no curated primary):** the panel renders the regulatory source alone (the `regulatory` list is always shown, §4.3); the PDF prints a one-line bibliography (the O. Reg. 256/24 authority). This is a graceful degrade — the medico-legal minimum (the authority to prescribe) is always present even before clinical content is curated.
- **`byStep` absent for a requested step:** `<CitationPanel step="rxSelection">` falls back to showing `primary` alone (§4.3 dedupes primary + step). The panel is useful with `primary` only; `byStep` enriches it where a step has a distinct evidence basis. No empty-panel render.
- **Source URL 404s / publisher restructures:** the *source name + year + DOI* render in the PDF bibliography regardless of link liveness (printed `<Text>` is durable; the DOI resolves even if the journal's page URL changes). In the wizard, the link opens a 404 the pharmacist closes — no patient-facing error. The plan includes an optional CI link-checker task (soft, non-blocking) and URLs/DOIs are versioned in the module so a correction is a single PR + version bump.
- **DOI present and URL present:** the panel prefers the explicit `url` (typically the free landing page); the PDF prints the DOI (the stable resolver). Where only a DOI exists, the panel synthesises `https://doi.org/{doi}` (a literal template over a static identifier of the *source* — no patient context).
- **Paywalled source:** the tool links to the public landing page / abstract / regulator page (e-Laws is free; PubMed/PMC abstracts are free; most society guidelines have a free summary). The tool does not bypass paywalls and does not retrieve full text — it behaves exactly as a clinical bibliography does. If the best source is paywalled with no free abstract, the `source` + `year` render on the PDF without a link (still a valid citation).
- **Poor connectivity / offline at the counter:** the entire in-tool *provenance value that does not require a click* renders from the local bundle — the source names, years, type badges, and summaries. Only the outbound "open source" link requires connectivity. The PDF bibliography (the liability-shield artefact) is fully offline: it is printed text. The feature degrades gracefully to text-only provenance — a key resilience property for a tool used at a busy pharmacy counter.
- **Collapsible-default preserves counter speed:** roadmap §4's wedge is counter speed. A citation panel that forces the pharmacist to scroll past a bibliography every consult would slow the confident prescriber. The panel is **collapsed by default** — one click reveals it only when the pharmacist (or a trainee — #20 academy) wants the "why." A confident "I know this regimen" consult is zero extra clicks.
- **PDF pagination pressure:** the combined PDF is a single dense `LETTER` page (`combined-pdf.tsx`). Adding 4–6 reference lines could, in the worst case, push content to a second page. Mitigations: the references block is compact (6 pt `<Text>`, one line per citation), conditionally rendered only when citations exist, and the per-ailment set is bounded (~3–6). The `wrap={false}` on each ref item prevents an ugly mid-item page break. If a particular ailment's citation set is large, the bibliography is the first place to trim (the `byStep` lists are optional).
- **Citation string drift vs. data:** because citations attach to the *slug + protocol step* (not to specific red-flag/Rx-note strings in `data/ailments.json`), a data-layer rephrase of a note (e.g. `"First-line; avoid if CrCl <30"` → `"First-line; renal caution"`) **cannot** orphan a citation. The recommendation-specific "why" lives in the citation `summary`, not in a key. This is the robustness argument that rejects Option B (§3).
- **Governance change to the citation set:** because the module is versioned (`CITATIONS_VERSION` + hash), a later clinical edit (adding a source, correcting a DOI) produces a new version and a new `hash8` printed on subsequently-generated PDFs. Past printed documents retain their old `hash8` (they are immutable artefacts) — the auditor matches the printed hash to git history to recover the exact citation set in effect at consult time. No migration, no backfill.
- **Red flag already present (the `hasRedFlag` branch):** the red-flag-screening `<CitationPanel>` renders inside the red-flags block (always visible on step 1) so "why this is a red flag" is available even when a red flag is checked and the patient is being referred — arguably *most* useful then, because the referral decision is the highest-liability one. The `rxSelection` panel on step 2 is only reached when no red flag is checked (the wizard cannot advance otherwise, `wizard-container.tsx:55-56`), so the two panels never contradict each other.
- **Multilingual (#24 interaction):** the citation `source`/`summary` are pharmacist-facing EN content. For #24's FR patient instructions, the *patient-facing* summary may need FR translation, but the *evidence source* (a guideline's title) stays in its original language (a French-Canadian pharmacist reading "SOGC. Vulvovaginal Candidiasis." is standard). Flagged as an Open Question; no NOW conflict since #24 is a separate later feature.
- **Reconciliation with #6 (differentials):** #6's Open Question §7.9 explicitly deferred differential citations to #9. #9 does **not** retroactively cite #6's `distinguishingFeatures` (those are curated mimic-descriptions, not regimen assertions — a different evidence class). If a reviewer wants differentials cited too, that is an additive `byStep`-style field on the differentials module in a later increment; #9's mandate is the four CDST protocol steps (red-flag / Rx / non-Rx / follow-up), which is where regimen liability attaches.

---

## 7. Open Questions

1. **Citation curation ownership.** Who owns sourcing the `primary` + `byStep` citations per ailment? Options: (a) the pharmacy's clinical lead, (b) a contracted clinical pharmacist / literature-reviewer, (c) an existing open dataset (e.g., an open-access minor-ailments protocol set). Recommend (b) or (c) for v1 with (a) sign-off — the content is clinical/governance and must be reviewed before launch (soft gate), exactly as #3's `statements.ts` / #4's `reasons.ts` / #6's `differentials.ts` require pharmacist review. Confirm a budget/owner.
2. **Source-selection policy.** When multiple sources support a recommendation (e.g. AMMI Canada, IDSA, and a provincial guidance for UTI), which does the tool cite? Recommend: one `primary` per ailment (the most authoritative Canadian source) + optional `byStep` additions where a step has a distinct basis, capping the per-ailment set at ~6 to protect PDF pagination. Confirm the "one Canadian primary first" rule.
3. **DOI completeness at launch.** DOIs are preferred (stable) but not every guideline has one (regulation pages use URLs; some society PDFs have none). Should v1 ship with `url`-only where no DOI exists (acceptable), or block on DOI for every citation (slower curation, higher quality)? Recommend: ship `url`-or-`doi` (whichever the source offers); make DOI a "nice-to-have," not a gate.
4. **Should "citations consulted" persist?** For NOW the feature is reference-only (the versioned hash is the auditability hook). Should a structured `citations_consulted: string[]` (the citation `id`s the pharmacist opened) be added to #2's `assessment` JSONB for #14 (outcomes — "which sources do high-prescriber pharmacists check?") and #26 (governance drift)? Trade-off: a new non-PHI-but-PHI-adjacent field vs. analytics value. Recommend deferring until #14 is scoped; the printed `hash8` covers the medico-legal record for NOW.
5. **Strength-of-recommendation grading (SORT / GRADE).** Should each citation carry a `grade` (e.g. SORT A/B/C, or GRADE high/moderate/low)? This would strengthen the "trust" axis (the pharmacist sees not just *that* a source supports it but *how strongly*). Recommend: defer to a later increment — adding a grade field to `Citation` is trivial, but curating grades per source is real work and no Canadian college currently requires it for a minor-ailments CDST. Flag as a #26 governance enhancement.
6. **Inline wizard panel vs. a dedicated "Evidence" drawer.** The design places collapsible panels on the decision steps. An alternative is a single right-side "Evidence" drawer the pharmacist opens once per consult. Recommend inline-on-step for NOW (the "why" lives next to the recommendation it supports; a drawer adds a navigation step). Revisit if pharmacists report panel clutter.
7. **PDF references on the combined single page vs. a dedicated references page.** The design keeps references inline on the existing single page (`combined-pdf.tsx`). For ailments with large citation sets, should the references spill to a dedicated page 2? Recommend inline-with-`wrap={false}` for NOW (most sets are ≤6); add a page-2 spill rule only if a real ailment exceeds the budget.
8. **Live link/DOI checking in CI.** Should the plan include a CI task that HEAD-checks every `url`/DOI and fails the build on a 404? Recommend: soft, non-blocking, optional task (a `scripts/` one-liner run manually pre-release). A blocking CI check would couple the build to publisher uptime — undesirable.
9. **Should the regulatory citation deep-link to the specific section of O. Reg. 256/24 listing the ailment?** e-Laws supports section anchors. Deep-linking to the ailment's specific schedule entry is more precise but more brittle (regulation renumbering). Recommend: link to the regulation root (`https://www.ontario.ca/laws/regulation/240256`) for v1 stability; add per-ailment section anchors as a LATER refinement.
10. **Reconciliation with #26 (clinical content governance).** The versioned hash feeds #26, but #26 will introduce authors/reviewers/changelog per protocol. Should the citations module already carry an `authors`/`reviewedAt` field to pre-empt #26? Recommend: no — keep `Citation` minimal for NOW (the hash + version is the governance hook); let #26 add the author/reviewer metadata uniformly across all clinical modules (statements, reasons, differentials, catalog, citations).

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/clinical/citations.ts` — versioned citation module (`CITATIONS`, `CITATIONS_VERSION`, `computeCitationsHash`, `CITATIONS_HASH`, `getCitations`), populated for all 19 ailments (regulatory anchor on all 19; `primary` + `byStep` curated per the clinical-review content task).
- `src/components/wizard/citation-panel.tsx` — the collapsible read-only `<CitationPanel slug step>` (renders inline on the red-flags and Rx steps; no callbacks, no gating).
- `src/components/wizard/pdf-references.tsx` — the `<ReferencesSection slug>` @react-pdf/renderer bibliography printed on both PDFs (source, year, type, DOI/URL, `version · hash8`).
- `src/__tests__/citations.test.ts` — module shape, hash stability/determinism, slug coverage (19), every `url`/DOI is a literal constant with no interpolation/query (PHI-leak guard), `getCitations` dedup correctness.
- `src/__tests__/citation-panel.test.tsx` — hide-when-empty, collapsed/expanded, type badge, external-link `rel`/`target`, no patient-context URL, no-callback contract.
- `src/__tests__/pdf-references.test.tsx` — hide-when-empty, bibliography renders source/year/DOI, `version · hash8` present, no PHI interpolation.

**Modified:**
- `src/types/index.ts` — add `CitationType`, `ProtocolStep`, `Citation`, `AilmentCitations` (after `Ailment` at `types/index.ts:7-16`).
- `src/components/wizard/step-redflags.tsx` — import + render `<CitationPanel slug={ailment.slug} step="redFlagScreening" />` after the red-flags checklist (`step-redflags.tsx:55-83`).
- `src/components/wizard/step-rx.tsx` — import + render `<CitationPanel slug={ailment.slug} step="rxSelection" />` under the Rx grid (`step-rx.tsx:36-63`) and `step="followUp"` beside the follow-up paragraph (`:141-144`).
- `src/components/combined-pdf.tsx` — render `<ReferencesSection slug={ailment.slug} />` between the signature section (`:309-315`) and the footer divider (`:317`).
- `src/components/wizard/referral-pdf.tsx` — render `<ReferencesSection slug={ailment.slug} />` between the signature section (`:222-228`) and the footer divider (`:230`).
- `src/__tests__/step-redflags.test.tsx`, `src/__tests__/step-rx.test.tsx` — add panel-presence assertions (additive, no behaviour change).

**Not touched (deliberately):** `data/ailments.json` (governance constraint + content-hash precedent); `wizard-container.tsx` (no state/gate change); the `AssessmentData` type (`types/index.ts:59-67`); any fly.io or Supabase schema (no new data store); any server action / API route (entirely client-rendered).

**Environment / dependencies:** none new. No `PHI_PERSIST_ENABLED` dependency (ships live in Phase 1). No `pg`, no new `@react-pdf` change, no citation SDK — inline SVG/`lucide-react` + plain `<a>` + existing `@react-pdf/renderer` `Text`/`View` + `node:crypto` (built-in) only.
