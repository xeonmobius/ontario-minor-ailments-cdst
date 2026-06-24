# Evidence Citations per Protocol Step — Implementation Plan

**Date:** 2026-06-24
**Roadmap item:** #9 (NEXT tier)
**Spec:** `docs/superpowers/specs/2026-06-24-evidence-citations-design.md`

---

## Goal

Add a read-only evidence-provenance layer to the existing minor-ailments wizard and its PDFs: a versioned/hashed `src/lib/clinical/citations.ts` module holding per-ailment citations keyed to the four protocol steps (regulatory authority + primary guideline + per-step basis), collapsible `<CitationPanel>` affordances inline on the red-flags and Rx steps, and a `<ReferencesSection>` bibliography rendered onto both generated PDFs (`combined-pdf.tsx`, `referral-pdf.tsx`). The feature is **non-PHI reference content + public-URL link-outs + client-rendered PDF text only** — no new data store, no server surface, no automated gating, no `PHI_PERSIST_ENABLED` dependency. It ships **live in Phase 1**.

The plan is ordered so each step is independently verifiable (typecheck/test/lint-green before moving on). Because the feature is additive reference UI that hides itself for un-curated ailments, **no feature flag is required**; if a pharmacy wants it off, the cleanest kill-switch is commenting out the four render sites, but no flag is recommended for NOW (YAGNI).

---

## Sequenced Steps

### Task 1 — Types for the citation content model

**Modify** `src/types/index.ts` (after the `Ailment` interface at `types/index.ts:7-16`, before `PatientInfo` at `:18`):

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

These five types are the canonical home; the content module and the PDF/panel components import them.

**Verify:** `npx tsc --noEmit` is green (the types compile and don't collide with existing names — confirmed unique via the read of `types/index.ts:1-118`).

---

### Task 2 — The versioned citation content module

**Create** `src/lib/clinical/citations.ts`:

```ts
import { createHash } from "node:crypto"
import type { AilmentCitations, Citation, ProtocolStep } from "@/types"

export const CITATIONS_VERSION = "citations-v1"

export const CITATIONS: Record<string, AilmentCitations> = {
  // Populated per Task 3. See spec §4.1 for the uti/vvc exemplars.
}

export function computeCitationsHash(entries: Record<string, AilmentCitations>): string {
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

export function getCitations(slug: string): Citation[] {
  const a = CITATIONS[slug]
  if (!a) return []
  const seen = new Set<string>()
  const out: Citation[] = []
  const all: Citation[] = [...a.regulatory, ...a.primary]
  if (a.byStep) {
    ;(Object.keys(a.byStep) as ProtocolStep[]).forEach(step => {
      all.push(...(a.byStep![step] ?? []))
    })
  }
  for (const c of all) {
    if (!seen.has(c.id)) { seen.add(c.id); out.push(c) }
  }
  return out
}
```

> **Note on the hash primitive:** the sibling features (#3 `statements.ts`, #4 `reasons.ts`, #6 `differentials.ts`, #22 `catalog.ts`) each define a synchronous `compute*Hash` over `node:crypto`. This task follows the same shape for parity. `node:crypto` is a Node built-in (no `npm install`), usable in the module-evaluated-at-build path; confirm with a vitest unit test that the hash is deterministic across two runs in Task 6. The synchronous form is preferred for the build-time governance use case (#26) and for printing a stable `hash8` on the PDF footer.

**Verify:** `npx tsc --noEmit` green; the file imports only `@/types` and `node:crypto`.

---

### Task 3 — Populate the citation content (all 19 ailments: regulatory on all 19; primary + byStep curated)

Continue editing `src/lib/clinical/citations.ts`, filling `CITATIONS` for each of the 19 slugs in `data/ailments.json` (slug list confirmed at `src/components/ailment-card.tsx:11-18`). Four content rules:

- **`regulatory`** on **all 19** — the universal `on-o-reg-256-24` citation (O. Reg. 256/24, `https://www.ontario.ca/laws/regulation/240256`), with the `summary` tailored per ailment ("Authority to prescribe for {ailment} as a designated minor ailment."). This guarantees the PDF bibliography is never empty (the medico-legal minimum — the authority to prescribe — is always present).
- **`primary`** — the most authoritative **Canadian** source for the ailment, e.g.:
  - `uti` → AMMI Canada / IDSA uncomplicated cystitis guidance (nitrofurantoin first-line, CrCl caveat).
  - `vvc` → SOGC vulvovaginal candidiasis (fluconazole first-line, NOT in pregnancy).
  - `dysmenorrhea` → SOGC primary dysmenorrhea (NSAIDs first-line).
  - `nvp` (nausea & vomiting of pregnancy) → SOGC/ACOG NVP guidance (doxylamine-pyridoxine first-line; ginger evidence).
  - `tick-bites-lyme` → AMMI Canada / IDSA Lyme post-exposure prophylaxis (doxycycline 200 mg single dose; the 36 h/72 h criteria at `data/ailments.json:827-831`).
  - `acne` → Canadian acne management guidance (BPO/adapalene first-line).
  - Use the spec's `uti` and `vvc` entries (spec §4.1) verbatim as the exemplars; the remaining 17 follow the same `Citation` shape.
- **`byStep`** — optional, populate where a protocol step has a **distinct** evidence basis from `primary` (e.g. UTI `redFlagScreening` basis for the pyelonephritis/male/pregnancy referral criteria; UTI `followUp` basis for the 48–72 h reassessment). Where a step's basis is adequately covered by `primary`'s `summary`, omit `byStep[step]` — the panel falls back to `primary` (§4.3).
- **Every `url` must be a literal constant** — no template interpolation, no `${...}` (this is the PHI-leak guard: Task 6 asserts it). DOIs are plain strings (`"10.14799/..."`); the `https://doi.org/{doi}` resolver is constructed only inside `citation-panel.tsx` over a static `doi` field.

**Verify:** `npx tsc --noEmit` green; `rg -n '"slug"' data/ailments.json | wc -l` confirms 19 slugs, and `Object.keys(CITATIONS).length` should equal 19 (asserted in Task 6); every `CITATIONS[slug].regulatory` is non-empty (asserted in Task 6).

---

### Task 4 — The `<CitationPanel>` component

**Create** `src/components/wizard/citation-panel.tsx` (`"use client"`), implementing the spec §4.3 contract:

- Props: `{ slug: string; step: ProtocolStep }`.
- Behaviour: look up `CITATIONS[slug]`; the panel's list is `dedupe([...primary, ...(byStep[step] ?? [])])`; the `regulatory` list is always shown beneath (muted). `return null` if both the list and `regulatory` are empty (graceful hide — §6).
- State: `useState(false)` for `open` (collapsed by default).
- Render: a collapsible `<button>` header ("Evidence" + count badge, no amber accent — citations are informational, not a warning), and when open: the `<CitationRow>` list with a `<TypeBadge type>` chip per item (guideline/study/systematic-review/regulatory/monograph), the source+year, an external link (`url`, or `https://doi.org/{doi}` when only a DOI), and the optional `summary`.
- **Emits no callbacks** (pure render; no `onChange`, no effect on `redFlagsChecked`/`selectedRx`/`canNext`).
- Links: `target="_blank" rel="noopener noreferrer nofollow"` (the #6 link-out discipline — noopener prevents tab-nabbing, noreferrer suppresses Referer, nofollow marks it a reference not an endorsement).
- Icons/badge: use `lucide-react` (already a dependency, `package.json:21`) — `ExternalLink` for the source link, `FileText`/`BookOpen` for the header; the `<TypeBadge>` is a styled lowercase `<span>` (no icon needed). Do **not** add a new icon dependency.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; manual render in isolation (covered by Task 7 tests).

---

### Task 5 — The `<ReferencesSection>` PDF component

**Create** `src/components/wizard/pdf-references.tsx` (`"use client"`, `@react-pdf/renderer` nodes), implementing the spec §4.5 contract:

- Props: `{ slug: string }`.
- Behaviour: `const citations = getCitations(slug)`; `return null` if empty.
- Render: a "References (citations-v1 · {hash8})" label + a numbered list of `<Text>` rows (source, year, `doi:{doi}` or `url`, `[type]`), each wrapped in `<View wrap={false}>` to prevent an ugly mid-item page break. Use 6 pt text to protect the single-page PDF layout.
- **No external-link node** — PDF `<Text>` is printed text (not a clickable hyperlink in print), which is exactly what a printed bibliography should be; the URL/DOI is printed as a resolvable string.
- The `CITATIONS_VERSION` + `CITATIONS_HASH` are imported from `@/lib/clinical/citations`.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green.

---

### Task 6 — Content-module unit tests

**Create** `src/__tests__/citations.test.ts` (vitest, mirroring the style at `src/__tests__/step-redflags.test.tsx:1-2`):

```ts
import { describe, it, expect } from "vitest"
import { CITATIONS, CITATIONS_VERSION, computeCitationsHash, getCitations } from "../lib/clinical/citations"

describe("citations module", () => {
  it("covers all 19 ailment slugs", () => {
    expect(Object.keys(CITATIONS).length).toBe(19)
  })

  it("every ailment has the regulatory anchor", () => {
    for (const entry of Object.values(CITATIONS)) {
      expect(entry.regulatory.length).toBeGreaterThan(0)
    }
  })

  it("every citation has a valid type and non-empty source", () => {
    const valid = ["guideline", "study", "systematic-review", "regulatory", "monograph"]
    for (const entry of Object.values(CITATIONS)) {
      for (const c of [...entry.regulatory, ...entry.primary]) {
        expect(valid).toContain(c.type)
        expect(c.source.length).toBeGreaterThan(0)
      }
    }
  })

  it("every url is a literal constant with no interpolation/query (PHI-leak guard)", () => {
    for (const entry of Object.values(CITATIONS)) {
      const all = [...entry.regulatory, ...entry.primary]
      if (entry.byStep) for (const list of Object.values(entry.byStep)) all.push(...(list ?? []))
      for (const c of all) {
        if (c.url) {
          expect(c.url).toMatch(/^https?:\/\//)
          expect(c.url).not.toMatch(/\$\{|\?/) // no template token, no query string -> no patient context
        }
        if (c.doi) expect(c.doi).not.toMatch(/\$\{|\?/)
      }
    }
  })

  it("hash is deterministic and versioned", () => {
    expect(CITATIONS_VERSION).toMatch(/^citations-v\d+$/)
    const h1 = computeCitationsHash(CITATIONS)
    const h2 = computeCitationsHash(CITATIONS)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
  })

  it("getCitations dedupes by id across regulatory + primary + steps", () => {
    const all = getCitations("uti")
    const ids = all.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length) // no dupes
    expect(all.some(c => c.id === "on-o-reg-256-24")).toBe(true) // regulatory present
  })
})
```

**Verify:** `npm test -- citations` passes all six assertions.

---

### Task 7 — Component unit tests

**Create** `src/__tests__/citation-panel.test.tsx` (vitest + @testing-library/react, mirroring `src/__tests__/step-redflags.test.tsx` patterns):

- **`returns null for an unknown slug`** — render `<CitationPanel slug="not-a-real-ailment" step="rxSelection" />`, assert no "Evidence" header in the document.
- **`is collapsed by default`** — render with `slug="uti"`, assert the "Evidence" header is present but no `summary` text (e.g. "Nitrofurantoin") is in the document (collapsed body hidden).
- **`expands to show citations on header click`** — `fireEvent.click` the header, assert a source appears and the `<TypeBadge>` "guideline" chip is present; assert the regulatory source (O. Reg. 256/24) renders muted beneath.
- **`external links carry the PHI-safe rel attributes`** — expand, query all `role="link"` (or anchors), assert each has `rel="noopener noreferrer nofollow"` and `target="_blank"`, and that no `href` contains a query string or template token; assert a DOI-only citation's href is `https://doi.org/{doi}` with no appended patient context.
- **`emits no callbacks and does not affect canNext`** — assert the component interface has no `onChange`-style prop (static type assertion); rendering alongside a spy-free parent changes nothing.

**Create** `src/__tests__/pdf-references.test.tsx`:

- **`returns null for an unknown slug`** — render `<ReferencesSection slug="not-real" />`, assert no "References" text.
- **`renders a numbered bibliography with version + hash8`** — render `slug="uti"`, assert "References (citations-v1 · " appears, assert the regulatory source renders, assert each row carries a `[guideline]`/`[regulatory]` type tag, assert `doi:` or a URL is printed where present.
- **`prints the hash8 prefix of CITATIONS_HASH`** — assert the rendered hash8 equals `CITATIONS_HASH.slice(0, 8)`.

**Verify:** `npm test -- citation-panel pdf-references` passes; `npm test` (full suite) is green.

---

### Task 8 — Update the existing step tests for the new rendered children

**Modify** `src/__tests__/step-redflags.test.tsx` (the existing suite already renders `<StepRedFlags>`):

- Existing tests (red-flag toggle, symptom toggle, notes) must remain green — the panel is an additive, no-callback render after the red-flags checklist.
- Add one assertion: when rendered with an ailment slug that has citations, the "Evidence" header is present (collapsed). (The red-flag-screening panel renders in the red-flags block for both the `hasRedFlag` and `!hasRedFlag` branches, so it should be present in both — confirm against the render site chosen in Task 10.)

**Modify** `src/__tests__/step-rx.test.tsx`:

- Existing tests must remain green.
- Add one assertion: the `rxSelection` "Evidence" header is present (collapsed) when the ailment has citations.

**Verify:** `npm test -- step-redflags step-rx` green.

---

### Task 9 — Wire the panel into the red-flags step

**Modify** `src/components/wizard/step-redflags.tsx`:

1. Add imports: `import { CitationPanel } from "./citation-panel"` (after the existing local import at `step-redflags.tsx:8`).
2. Render `<CitationPanel slug={ailment.slug} step="redFlagScreening" />` as the **last child of the red-flags `<div>`** (the block at `step-redflags.tsx:49-83`, after the checklist map at `:81` and before the closing `</div>` at `:83`). This places "why these are red flags" next to the screen itself, and is visible whether or not a red flag is checked (the highest-liability decision is the referral, so the citation is most useful when a red flag *is* present).
3. No other change: `ailment` is already in scope (`step-redflags.tsx:2`); `WizardContainer`, the `canNext` gate, the `StepRedFlagsProps` interface, and the PDF are all untouched.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; `npm run build` succeeds.

---

### Task 10 — Wire the panel into the Rx step

**Modify** `src/components/wizard/step-rx.tsx`:

1. Add import: `import { CitationPanel } from "./citation-panel"`.
2. Render `<CitationPanel slug={ailment.slug} step="rxSelection" />` immediately **after the Rx-options grid** (after the closing `</div>` of the grid block at `step-rx.tsx:63`), so "why this is first-line / alternative" sits under the regimen choice.
3. Render `<CitationPanel slug={ailment.slug} step="followUp" />` beside (or beneath) the Follow-up paragraph (`step-rx.tsx:141-144`), so "why this reassessment interval" is co-located with the interval. (Optional: a `step="nonRxAdvice"` panel beneath the non-Rx block at `:110-139` — include if non-Rx has a distinct basis for any ailment; otherwise omit to limit panel count.)
4. No other change: `ailment` is already in scope (`step-rx.tsx:2`); `WizardContainer`, `canNext`, `StepRxProps`, and the PDF wiring are untouched.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; `npm run build` succeeds. Manual: navigate `/assess/uti` → reach step 1 → confirm the red-flag "Evidence" panel renders collapsed; advance to step 2 → confirm the Rx-selection and follow-up "Evidence" panels render collapsed; expand each → confirm sources + type badges + external links; navigate `/assess/<an-uncurated-slug>` (if any) → confirm no panels (graceful hide). (For v1 all 19 are curated with at least the regulatory anchor, so this is a forward-compatibility check.)

---

### Task 11 — Render the references section on both PDFs

**Modify** `src/components/combined-pdf.tsx`:

1. Add import: `import { ReferencesSection } from "./wizard/pdf-references"` (note: the PDF component lives in `src/components/wizard/`; `combined-pdf.tsx` is in `src/components/` — adjust the relative path).
2. Render `<ReferencesSection slug={ailment.slug} />` **between the signature section** (`combined-pdf.tsx:309-315`) **and the footer divider** (`combined-pdf.tsx:317`). `ailment` is already a prop (`combined-pdf.tsx:159/171`).

**Modify** `src/components/wizard/referral-pdf.tsx`:

1. Add import: `import { ReferencesSection } from "./pdf-references"`.
2. Render `<ReferencesSection slug={ailment.slug} />` **between the signature section** (`referral-pdf.tsx:222-228`) **and the footer divider** (`referral-pdf.tsx:230`). `ailment` is already a prop.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; `npm run build` succeeds. Manual: generate a UTI prescription PDF and a UTI referral PDF → confirm the "References (citations-v1 · …)" bibliography prints above the PHIPA footer on both, with the O. Reg. 256/24 + AMMI sources listed and the hash8 present. Confirm the combined PDF still fits a single `LETTER` page (if a particular ailment overflows, trim its `byStep` lists per spec §7.7).

---

### Task 12 — Whole-repo guard + final verification

Run the full verification suite (no new code this step — confirmation only):

- **Typecheck:** `npx tsc --noEmit` — green.
- **Lint:** `npm run lint` — green.
- **Tests:** `npm test` — all suites green (existing + the three new + the two modified step tests).
- **Build:** `npm run build` — succeeds (the new client module and components bundle; no server-only code introduced).
- **Guard greps** (paste-ready for CI / a `scripts/` check — but do NOT add a script this iteration, just run them):
  - `rg -n "ontario\.ca|doi\.org|pubmed" src/` — every match is in `src/lib/clinical/citations.ts`, `citation-panel.tsx`, `pdf-references.tsx`, or their tests (no stray patient-context URL construction).
  - `rg -n 'href=\{' src/components/wizard/citation-panel.tsx` — every external `href` is a literal from the module or `https://doi.org/{doi}` over a static `doi` (no interpolation of patient data).
  - `rg -n "patient\." src/components/wizard/citation-panel.tsx src/components/wizard/pdf-references.tsx` — **zero matches** (neither the panel nor the references touch patient data; the PHI-leak guarantee).
  - `rg -n "citation|evidence" src/components/combined-pdf.tsx src/components/wizard/referral-pdf.tsx` — exactly the one `<ReferencesSection>` render site per PDF (no stray provenance emission).

**Verify:** all four commands exit 0; the four greps match expectations.

---

## Files to Create / Modify (real paths)

**Create:**
- `src/lib/clinical/citations.ts` — versioned citation module (all 19 ailments; regulatory anchor on all 19; `primary` + `byStep` curated); `CITATIONS_VERSION`, `computeCitationsHash`, `CITATIONS_HASH`, `getCitations`.
- `src/components/wizard/citation-panel.tsx` — collapsible read-only `<CitationPanel slug step>`.
- `src/components/wizard/pdf-references.tsx` — `<ReferencesSection slug>` @react-pdf/renderer bibliography.
- `src/__tests__/citations.test.ts` — module shape, hash determinism, slug coverage, regulatory-on-all-19, PHI-leak URL/DOI guard, dedup.
- `src/__tests__/citation-panel.test.tsx` — hide-when-empty, collapsed/expanded, type badge, link `rel`/`target`, DOI resolver href, no-callback contract.
- `src/__tests__/pdf-references.test.tsx` — hide-when-empty, bibliography renders source/year/DOI/type, `version · hash8` present and equals `CITATIONS_HASH.slice(0,8)`.

**Modify:**
- `src/types/index.ts` — add `CitationType`, `ProtocolStep`, `Citation`, `AilmentCitations` (after `Ailment` at `types/index.ts:7-16`).
- `src/components/wizard/step-redflags.tsx` — import + render `<CitationPanel slug={ailment.slug} step="redFlagScreening" />` after the red-flags checklist (`step-redflags.tsx:49-83`).
- `src/components/wizard/step-rx.tsx` — import + render `<CitationPanel slug={ailment.slug} step="rxSelection" />` after the Rx grid (`step-rx.tsx:36-63`) and `step="followUp"` beside the follow-up paragraph (`:141-144`).
- `src/components/combined-pdf.tsx` — render `<ReferencesSection slug={ailment.slug} />` between the signature section (`:309-315`) and the footer divider (`:317`).
- `src/components/wizard/referral-pdf.tsx` — render `<ReferencesSection slug={ailment.slug} />` between the signature section (`:222-228`) and the footer divider (`:230`).
- `src/__tests__/step-redflags.test.tsx`, `src/__tests__/step-rx.test.tsx` — add panel-presence assertions (additive, no behaviour change).

**Not touched (deliberately, per spec §8):** `data/ailments.json` (governance constraint + content-hash precedent); `wizard-container.tsx` (no state/gate change); the `AssessmentData` type (`types/index.ts:59-67`); any fly.io or Supabase schema (no new data store); any server action / API route (entirely client-rendered); `package.json` (no new dependency — `lucide-react` already present, `@react-pdf/renderer` already present, `node:crypto` built-in).

---

## Data / DB Changes

**None.** This is the defining property of the feature: it adds **no database table, no migration, no server action, no API route, and no PHI**. The entire feature is static reference content (a TS module in the bundle), public-URL link-outs, and client-rendered PDF text. It does **not** depend on `PHI_PERSIST_ENABLED`, the fly.io/BAA gate, or any Supabase table — it ships live in Phase 1.

The one PHI-adjacent element (the PDF document the references are printed onto, and the pharmacist's free-text `assessmentNotes`) is **unchanged**: the PDF was already generated client-side (`pdf-helpers.ts`), and the notes were already captured (`step-redflags.tsx:129-136`), rendered on the PDF (`combined-pdf.tsx:301-306`), and routed to #2's fly.io `assessment` row. No new PHI field is minted (spec §4.6 / Open Question §7.4). The auditability hook for the citation set is the printed `CITATIONS_VERSION · hash8` on each generated document (recoverable from git history), **not** a persisted per-consult field.

---

## Tests

| Suite | Covers |
|---|---|
| `src/__tests__/citations.test.ts` (new) | 19-slug coverage; regulatory anchor on all 19; valid types + non-empty sources; every `url`/`doi` is a literal constant with no query/template (PHI-leak guard); hash deterministic + versioned; `getCitations` dedupes by id and includes regulatory. |
| `src/__tests__/citation-panel.test.tsx` (new) | Hide-when-empty; collapsed-by-default; expand-on-click; type badge present; external links carry `rel="noopener noreferrer nofollow"` + `target="_blank"` + no patient-context URL; DOI-only citation's href is `https://doi.org/{doi}`; no-callback/no-canNext-effect contract. |
| `src/__tests__/pdf-references.test.tsx` (new) | Hide-when-empty; numbered bibliography renders source/year/DOI/type; `version · hash8` present and equals `CITATIONS_HASH.slice(0,8)`; no PHI interpolation. |
| `src/__tests__/step-redflags.test.tsx` (modified) | Existing behaviour unchanged; red-flag "Evidence" panel header present (collapsed). |
| `src/__tests__/step-rx.test.tsx` (modified) | Existing behaviour unchanged; Rx-selection "Evidence" panel header present (collapsed). |

No integration/E2E test is required for NOW: the feature is client-rendered read-only panels + client-rendered PDF text with no server interaction. A staging smoke (generate a UTI prescription PDF → confirm "References (citations-v1 · …)" prints above the PHIPA footer with O. Reg. 256/24 + AMMI listed; `/assess/uti` → step 1 → expand red-flag Evidence → click AMMI source opens new tab) is a manual rollout check (below), not an automated test.

---

## Verification Commands

```bash
npx tsc --noEmit                              # typecheck (Tasks 1,2,3,4,5,9,10,11)
npm run lint                                  # eslint (Tasks 4,5,9,10,11)
npm test                                      # full vitest suite (Tasks 6,7,8)
npm test -- citations                         # module tests (Task 6)
npm test -- citation-panel                    # panel tests (Task 7)
npm test -- pdf-references                    # PDF references tests (Task 7)
npm test -- step-redflags step-rx             # integration with existing steps (Task 8)
npm run build                                 # production build (Tasks 9,10,11,12)

# Guard greps (Task 12) — informational, run locally:
rg -n "ontario\.ca|doi\.org|pubmed" src/                 # all matches in the module/components/tests
rg -n 'href=\{' src/components/wizard/citation-panel.tsx  # literal/DOI hrefs only
rg -n "patient\." src/components/wizard/citation-panel.tsx src/components/wizard/pdf-references.tsx   # expect ZERO
rg -n "ReferencesSection" src/components/combined-pdf.tsx src/components/wizard/referral-pdf.tsx       # exactly one render site each
```

---

## Rollout Notes

- **No feature flag is required.** The feature is additive reference UI that hides itself for un-curated ailments (`<CitationPanel>` and `<ReferencesSection>` return `null` when no citations exist). It cannot change any existing prescribe/refer outcome, does not touch the `canNext` gate, and adds no data. Shipping it directly is safe. If a pharmacy wants it off, the cleanest kill-switch is commenting out the four render sites (`step-redflags.tsx`, `step-rx.tsx` ×2, `combined-pdf.tsx`, `referral-pdf.tsx`) — but no flag is recommended for NOW (YAGNI).
- **No infrastructure dependency.** Unlike the NOW-tier PHI features (#1–#4, #22's PHI writes), this feature does **not** wait on fly.io provisioning or the BAA (roadmap §7 open questions #1/#2). It ships live in Phase 1 — the same property #6 differentials and #22 inventory enjoy.
- **Soft gate — clinical review of the citation content.** The `CITATIONS` entries (spec §4.1, populated in Task 3) are clinical/governance assertions (which guideline underwrites which recommendation, which DOI). Like #3's `statements.ts`, #4's `reasons.ts`, #6's `differentials.ts`, and #22's `catalog.ts`, this content **must be reviewed by a practising pharmacist and ideally a literature-reviewer** before launch (spec Open Question §7.1). The versioned `CITATIONS_VERSION` + `computeCitationsHash` discipline means any post-launch correction (adding a source, correcting a DOI) is a versioned PR — no migration, no data backfill. The `hash8` printed on subsequently-generated PDFs updates automatically. Flag the review as a launch prerequisite, not a code blocker.
- **Soft gate — source selection.** Confirm the "one Canadian primary first" rule (spec §7.2) and the DOI-vs-URL preference (§7.3 — ship whichever the source offers, DOI preferred for stability) with the clinical reviewer before launch.
- **PDF pagination watch.** The combined PDF is a single dense `LETTER` page. The references block adds ~4–6 lines at 6 pt. If the clinical-review content task (Task 3) produces a large `byStep` set for a particular ailment that overflows the page, trim that ailment's `byStep` lists (the `primary` + `regulatory` are the medico-legal floor) rather than spilling to page 2 (spec §7.7). A manual generate-and-check per ailment during the review task is the guard.
- **Phased value, not phased rollout.** Because there is no data dependency, there is no "Phase 1 dark / Phase 2 live" split. The whole feature is live immediately on merge. The *optional* future enhancements (strength-of-recommendation grading, "citations consulted" persistence, a live CI link-checker, per-ailment e-Laws section anchors, an Evidence drawer) are explicitly LATER (spec §1 Out of scope, §3, §7) and do not gate this increment.
- **No new env vars. No new dependencies** (`lucide-react` present at `package.json:21`; `@react-pdf/renderer` present at `package.json:15`; `node:crypto` is a Node built-in). No CI changes required beyond running the existing `npm test` / `npm run lint` / `npm run build`.
- **Closes #6's parked Open Question §7.9.** #6 deferred differential citations to #9; #9 establishes the unified citation module (`src/lib/clinical/citations.ts`) keyed by ailment slug + protocol step. If a reviewer later wants #6's differentials cited too, it is an additive `byStep`-style field on the differentials module reusing this same module's `Citation` type — no parallel system (spec §6 reconciliation edge case).
