# Differential Diagnosis + DermNet Clinical Images — Implementation Plan

**Date:** 2026-06-24
**Roadmap item:** #6 (NEXT tier)
**Spec:** `docs/superpowers/specs/2026-06-24-differential-diagnosis-dermnet-design.md`

---

## Goal

Add a read-only differential-reasoning + DermNet-NZ clinical-image layer to the existing minor-ailments wizard, surfaced as a collapsible panel on the symptoms step (`step-redflags.tsx`), backed by a versioned/hashed TS content module under `src/lib/clinical/`. The feature is **non-PHI reference content + public-URL link-outs only** — no new data store, no server surface, no automated gating, no `PHI_PERSIST_ENABLED` dependency. It ships **live in Phase 1**.

The plan is ordered so each step is independently verifiable (typecheck/test/lint-green before moving on), and so that the feature can land behind a single render-toggle if desired (though no flag is required — it is additive reference UI that hides itself for un-curated ailments).

---

## Sequenced Steps

### Task 1 — Types for the differential content model

**Modify** `src/types/index.ts` (after the `Ailment` interface at `types/index.ts:7-16`, before `PatientInfo` at `:18`):

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

These four types are the canonical home; the content module re-exports/imports them.

**Verify:** `npx tsc --noEmit` is green (the types compile and don't collide with existing names — confirmed unique via the read of `types/index.ts:1-118`).

---

### Task 2 — The versioned differential content module

**Create** `src/lib/clinical/differentials.ts`:

```ts
import type { DifferentialEntry } from "@/types"

export const DIFFERENTIALS_VERSION = "differentials-v1"

export const DIFFERENTIALS: Record<string, DifferentialEntry> = {
  // Populated per Task 3. See spec §4.1 for the impetigo/dermatitis exemplars.
}

export function computeDifferentialsHash(entries: Record<string, DifferentialEntry>): string {
  // sha256 over a stable serialization of (slug, name, disposition) tuples.
  // Implementation: crypto.subtle is async; for a build-stable synchronous hash use the
  // node:crypto createHash already available in the toolchain (the existing lib uses none,
  // so add `import { createHash } from "node:crypto"` — node: built-in, no new dependency).
  const tuples = Object.keys(entries)
    .sort()
    .flatMap(slug =>
      entries[slug].differentials.map(d => `${slug}|${d.name}|${d.disposition}`)
    )
    .join("\n")
  return createHash("sha256").update(tuples).digest("hex")
}

export const DIFFERENTIALS_HASH = computeDifferentialsHash(DIFFERENTIALS)
```

> **Note on the hash primitive:** the sibling features (#3 `statements.ts`, #4 `reasons.ts`, #22 `catalog.ts`) each define a `compute*Hash`. This task follows the same shape. `node:crypto` is a Node built-in (no `npm install`), usable in the module-evaluated-at-build path; confirm with a `vitest` unit test that the hash is deterministic across two runs in Task 6. If the reviewer prefers `crypto.subtle` (web-standard, async) for client-bundle purity, the hash becomes an async export — acceptable but slightly less ergonomic at the call site; recommend the synchronous `node:crypto` form for parity with the build-time governance use case (#26).

**Verify:** `npx tsc --noEmit` green; the file imports only `@/types` and `node:crypto`.

---

### Task 3 — Populate the differential content (all 19 ailments, dermnetLinks on the 9 skin ailments)

Continue editing `src/lib/clinical/differentials.ts`, filling `DIFFERENTIALS` for each of the 19 slugs in `data/ailments.json` (slug list confirmed at `ailment-card.tsx:11-18`). Two content rules:

- **`differentials`** for **all 19** ailments (even non-dermatological ones have mimics): e.g., `uti` → { vaginitis, STI/urethritis, interstitial cystitis, pyelonephritis(disposition:`refer`) }; `dysmenorrhea` → { secondary dysmenorrhea/endometriosis, PID(disposition:`refer`), fibroids }; `gerd` → { cardiac chest pain(disposition:`refer`), PUD, biliary disease, malignancy(disposition:`refer`) }.
- **`dermnetLinks`** for **only the nine dermatological/morphological slugs**: `acne`, `candidal-stomatitis`, `conjunctivitis`, `dermatitis`, `herpes-labialis`, `impetigo`, `insect-bites-urticaria`, `tick-bites-lyme`, `hemorrhoids`. Each `url` is a literal `https://dermnetnz.org/topics/<topic>` constant. Non-skin ailments get `dermnetLinks: []`.
- Use the spec's `impetigo` and `dermatitis` entries (spec §4.1) verbatim as the exemplars; the remaining 17 follow the same `Differential`/`DermNetLink` shape.
- **Every `url` must be a literal constant** — no template interpolation, no `${...}` (this is the PHI-leak guard: Task 6 asserts it).

**Verify:** `npx tsc --noEmit` green; a quick `rg -n '"slug"' data/ailments.json | wc -l` confirms 19 slugs, and `Object.keys(DIFFERENTIALS).length` should equal 19 (asserted in Task 6).

---

### Task 4 — The `<DifferentialPanel>` component

**Create** `src/components/wizard/differential-panel.tsx` (`"use client"`), implementing the spec §4.3 contract:

- Props: `{ slug: string }`.
- Behaviour: look up `DIFFERENTIALS[slug]`; `return null` if absent or both lists empty (graceful hide).
- State: `useState(false)` for `open` (collapsed by default).
- Render: a collapsible `<button>` header ("Differentials to consider" + an amber "• some require referral" suffix when any `disposition === 'refer'`), and when open: the differentials list with a `<DispositionTag>` per item, optional `clinicalPearls`, and the `dermnetLinks` as `<a target="_blank" rel="noopener noreferrer nofollow">` chips.
- **Emits no callbacks** (pure render; no `onChange`, no effect on wizard state/gating).
- Icons: use `lucide-react` (already a dependency, `package.json:21`) — `ExternalLink` for link chips, `Stethoscope` or `GitCompare` for the header — matching how the rest of the app could adopt the icon library; if a given icon name is unavailable in the pinned `lucide-react@^1.16.0`, fall back to inline `<svg>` (the spec's resilient default). Do **not** add a new icon dependency.
- A small inline `<DispositionTag disposition>` helper: amber for `refer` ("Refer if suspected"), neutral for `treat_in_tool` ("Also assess"), muted for `otc_only` ("Self-care").

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; manual render in isolation (covered by Task 7 tests).

---

### Task 5 — Wire the panel into the symptoms step

**Modify** `src/components/wizard/step-redflags.tsx`:

1. Add the import: `import { DifferentialPanel } from "./differential-panel"` (after the existing local import at `step-redflags.tsx:8`).
2. Inside the `!hasRedFlag` fragment (the block starting at `step-redflags.tsx:94`), render `<DifferentialPanel slug={ailment.slug} />` as the **first child**, above the "Presenting Symptoms" `<div>` at `:96`. This places the differential at the diagnosis-confirmation moment, after red flags are cleared but before/alongside symptom confirmation.
3. No other change: `ailment` is already in scope (`step-redflags.tsx:2`), so no new prop drilling; `WizardContainer` (`wizard-container.tsx`), the `canNext` gate (`wizard-container.tsx:52-59`), the `StepRedFlagsProps` interface (`step-redflags.tsx:10-18`), and the PDF are all untouched.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; `npm run build` succeeds (the panel is client-only and statically importable). Manual: navigate `/assess/impetigo` → reach step 1 → confirm the panel renders collapsed above the symptoms; navigate `/assess/<an-uncurated-slug>` (if any) → confirm no panel (graceful hide). (For v1 all 19 are curated, so this is a forward-compatibility check.)

---

### Task 6 — Content-module unit tests

**Create** `src/__tests__/differentials.test.ts` (vitest, mirroring the style at `step-redflags.test.tsx:1-2`):

```ts
import { describe, it, expect } from "vitest"
import { DIFFERENTIALS, DIFFERENTIALS_VERSION, computeDifferentialsHash } from "../lib/clinical/differentials"

describe("differentials module", () => {
  it("covers all 19 ailment slugs", () => {
    expect(Object.keys(DIFFERENTIALS).length).toBe(19)
  })

  it("every differential has a valid disposition", () => {
    for (const entry of Object.values(DIFFERENTIALS)) {
      for (const d of entry.differentials) {
        expect(["treat_in_tool", "refer", "otc_only"]).toContain(d.disposition)
        expect(d.name.length).toBeGreaterThan(0)
        expect(d.distinguishingFeatures.length).toBeGreaterThan(0)
      }
    }
  })

  it("every dermnetLinks url is a literal dermnetnz.org constant with no interpolation", () => {
    for (const entry of Object.values(DIFFERENTIALS)) {
      for (const l of entry.dermnetLinks) {
        expect(l.url).toMatch(/^https:\/\/dermnetnz\.org\/topics\//)
        expect(l.url).not.toMatch(/\$\{|\?/) // no template, no query string -> PHI-leak guard
      }
    }
  })

  it("dermnetLinks exist ONLY on the nine dermatological slugs", () => {
    const skinSlugs = ["acne","candidal-stomatitis","conjunctivitis","dermatitis",
      "herpes-labialis","impetigo","insect-bites-urticaria","tick-bites-lyme","hemorrhoids"]
    for (const [slug, entry] of Object.entries(DIFFERENTIALS)) {
      if (skinSlugs.includes(slug)) expect(entry.dermnetLinks.length).toBeGreaterThan(0)
      else expect(entry.dermnetLinks).toEqual([])
    }
  })

  it("hash is deterministic and versioned", () => {
    expect(DIFFERENTIALS_VERSION).toMatch(/^differentials-v\d+$/)
    const h1 = computeDifferentialsHash(DIFFERENTIALS)
    const h2 = computeDifferentialsHash(DIFFERENTIALS)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
  })
})
```

**Verify:** `npm test -- differentials` passes all five assertions.

---

### Task 7 — Component unit tests

**Create** `src/__tests__/differential-panel.test.tsx` (vitest + @testing-library/react, mirroring `step-redflags.test.tsx` patterns):

- **`returns null for an unknown slug`** — render `<DifferentialPanel slug="not-a-real-ailment" />`, assert no "Differentials to consider" text in the document.
- **`is collapsed by default`** — render with `slug="impetigo"`, assert the header button is present but the differential `name` text ("Herpes simplex") is **not** in the document (collapsed body hidden).
- **`expands to show differentials on header click`** — `fireEvent.click` the header, assert "Herpes simplex" appears and the amber "Refer if suspected" tag appears for the `refer`-disposition differential (e.g., "Cellulitis / erysipelas").
- **`hides the clinical-images row for non-dermatological ailments`** — render with a non-skin slug (e.g., `dysmenorrhea`), expand, assert no "DermNet NZ" link is present while differentials are.
- **`external links carry the PHI-safe rel attributes`** — render `slug="impetigo"`, expand, query all `role="link"` (or anchors), assert each has `rel="noopener noreferrer nofollow"` and `target="_blank"`, and that no `href` contains a query string or template token.
- **`emits no callbacks and does not affect canNext`** — assert the component has no `onChange`-style prop in its interface (a static type assertion; behaviourally, rendering it alongside a spy-free parent changes nothing).

**Verify:** `npm test -- differential-panel` passes; `npm test` (full suite) is green.

---

### Task 8 — Update the existing step-redflags test for the new rendered child

**Modify** `src/__tests__/step-redflags.test.tsx` (the existing suite already renders `<StepRedFlags>`): add assertions that confirm the panel is integrated without breaking the existing red-flag/symptom behaviour:

- Existing tests (red-flag toggle, symptom toggle, notes) must remain green — the panel is an additive, no-callback render above the symptoms block.
- Add one assertion: when rendered with an ailment slug that has differentials and **no** red flag checked, the "Differentials to consider" header is present (collapsed). When a red flag **is** checked (the `hasRedFlag` branch), the header is **absent** (the panel lives only in the `!hasRedFlag` block, `step-redflags.tsx:94`).

**Verify:** `npm test -- step-redflags` green.

---

### Task 9 — Whole-repo guard + final verification

Run the full verification suite (no new code this step — confirmation only):

- **Typecheck:** `npx tsc --noEmit` — green.
- **Lint:** `npm run lint` — green.
- **Tests:** `npm test` — all suites green (existing + the two new + the modified step-redflags).
- **Build:** `npm run build` — succeeds (the new client module and component bundle; no server-only code introduced).
- **Guard greps** (paste-ready for CI / a `scripts/` check — but do NOT add a script this iteration, just run them):
  - `rg -n "DermNet|dermnetnz" src/` — every match is in `src/lib/clinical/differentials.ts` or its tests (no stray patient-context construction).
  - `rg -n 'href=\{' src/components/wizard/differential-panel.tsx` — every external `href` is a literal from the module (no interpolation).
  - `rg -n "patient\." src/components/wizard/differential-panel.tsx` — **zero matches** (the panel never touches patient data; the PHI-leak guarantee).

**Verify:** all four commands exit 0; the three greps match expectations.

---

## Files to Create / Modify (real paths)

**Create:**
- `src/lib/clinical/differentials.ts` — versioned differential + DermNet-link module (all 19 ailments; dermnetLinks on the 9 skin slugs); `DIFFERENTIALS_VERSION`, `computeDifferentialsHash`, `DIFFERENTIALS_HASH`.
- `src/components/wizard/differential-panel.tsx` — collapsible read-only `<DifferentialPanel slug>`.
- `src/__tests__/differentials.test.ts` — module shape, hash determinism, slug coverage, PHI-leak URL guard.
- `src/__tests__/differential-panel.test.tsx` — hide-when-empty, collapsed/expanded, link `rel` attributes, non-skin-ailment behaviour, no-callback contract.

**Modify:**
- `src/types/index.ts` — add `DifferentialDisposition`, `Differential`, `DermNetLink`, `DifferentialEntry` (after `Ailment` at `types/index.ts:7-16`).
- `src/components/wizard/step-redflags.tsx` — import + render `<DifferentialPanel slug={ailment.slug}/>` as first child of the `!hasRedFlag` fragment (`step-redflags.tsx:94`).
- `src/__tests__/step-redflags.test.tsx` — add panel-presence/absence assertions (panel present when no red flag, absent when red flag checked).

**Not touched (deliberately, per spec §8):** `data/ailments.json`; `wizard-container.tsx`; `combined-pdf.tsx` / `referral-pdf.tsx`; any fly.io or Supabase schema; any server action / API route; `package.json` (no new dependency — `lucide-react` already present, `node:crypto` built-in).

---

## Data / DB Changes

**None.** This is the defining property of the feature: it adds **no database table, no migration, no server action, no API route, and no PHI**. The entire feature is static reference content (a TS module in the bundle) plus public-URL link-outs. It does **not** depend on `PHI_PERSIST_ENABLED`, the fly.io/BAA gate, or any Supabase table — it ships live in Phase 1.

The one PHI-adjacent element (the pharmacist's free-text `assessmentNotes`, where differential reasoning is documented) is **unchanged**: it was already captured at `step-redflags.tsx:129-136`, already rendered on the PDF (`combined-pdf.tsx:301-306`), and already routed to #2's fly.io `assessment` row by the persist-assessments feature. No new PHI field is minted (spec §4.5 / Open Question §7.3).

---

## Tests

| Suite | Covers |
|---|---|
| `src/__tests__/differentials.test.ts` (new) | 19-slug coverage; valid dispositions; every `dermnetLinks[].url` is a literal `https://dermnetnz.org/topics/...` with no query/template (PHI-leak guard); dermnetLinks only on the 9 skin slugs; hash deterministic + versioned. |
| `src/__tests__/differential-panel.test.tsx` (new) | Hide-when-empty; collapsed-by-default; expand-on-click; amber refer-tag for `refer` dispositions; clinical-images row hidden for non-skin ailments; external links carry `rel="noopener noreferrer nofollow"` + `target="_blank"` + no patient-context URL; no-callback/no-canNext-effect contract. |
| `src/__tests__/step-redflags.test.tsx` (modified) | Existing behaviour unchanged; panel header present when no red flag checked, absent when a red flag is checked (the panel lives only in the `!hasRedFlag` branch). |

No integration/E2E test is required for NOW: the feature is a client-rendered read-only panel with no server interaction. A staging smoke (`/assess/impetigo` → step 1 → expand panel → click DermNet link opens new tab) is a manual rollout check (below), not an automated test.

---

## Verification Commands

```bash
npx tsc --noEmit                              # typecheck (Task 1,2,3,4,5)
npm run lint                                  # eslint (Task 4,5)
npm test                                      # full vitest suite (Task 6,7,8)
npm test -- differentials                     # module tests (Task 6)
npm test -- differential-panel                # component tests (Task 7)
npm test -- step-redflags                     # integration with existing step (Task 8)
npm run build                                 # production build (Task 5,9)

# Guard greps (Task 9) — informational, run locally:
rg -n "DermNet|dermnetnz" src/                # all matches in the module/tests
rg -n 'href=\{' src/components/wizard/differential-panel.tsx   # literal hrefs only
rg -n "patient\." src/components/wizard/differential-panel.tsx  # expect ZERO matches
```

---

## Rollout Notes

- **No feature flag is required.** The feature is additive reference UI that hides itself for un-curated ailments (`<DifferentialPanel>` returns `null` when an entry is absent). It cannot change any existing prescribe/refer outcome, does not touch the `canNext` gate, and adds no data. Shipping it directly is safe. If a pharmacy wants it off, the cleanest kill-switch is a one-line comment of the `<DifferentialPanel>` render in `step-redflags.tsx` — but no flag is recommended for NOW (YAGNI).
- **No infrastructure dependency.** Unlike the NOW-tier PHI features (#1–#4, #22's PHI writes), this feature does **not** wait on fly.io provisioning or the BAA (roadmap §7 open questions #1/#2). It ships live in Phase 1 — the same property #22's non-PHI inventory ledger enjoys.
- **Soft gate — clinical review of the differential content.** The `DIFFERENTIALS` entries (spec §4.1, populated in Task 3) are clinical assertions ("distinguishing features" that separate a mimic from the presenting complaint). Like #3's `statements.ts`, #4's `reasons.ts`, and #22's `catalog.ts`, this content **must be reviewed by a practising pharmacist** (ideally the pharmacy's clinical lead) before launch. The versioned `DIFFERENTIALS_VERSION` + `computeDifferentialsHash` discipline means any post-launch correction is a versioned PR — no migration, no data backfill. Flag the review as a launch prerequisite, not a code blocker.
- **Soft gate — DermNet NZ linking terms (spec Open Question §7.1).** Confirm deep-linking to `dermnetnz.org` topic pages is permitted under DermNet NZ's terms before relying on the links. If disallowed, the fallback is mechanical: swap each `dermnetLinks[].url` to an equivalent open atlas or a DermNet NZ search URL — a single-field change per entry, no code change.
- **Phased value, not phased rollout.** Because there is no data dependency, there is no "Phase 1 dark / Phase 2 live" split. The whole feature is live immediately on merge. The *optional* future enhancements (self-hosted licensed images, structured "differentials considered" persistence, AI differentials, dashboard mimic-hints) are explicitly LATER (spec §1 Out of scope, §3 Option C, §7) and do not gate this increment.
- **No new env vars. No new dependencies** (`lucide-react` present at `package.json:21`; `node:crypto` is a Node built-in). No CI changes required beyond running the existing `npm test` / `npm run lint` / `npm run build`.
