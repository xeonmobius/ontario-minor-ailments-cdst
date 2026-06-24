# Smart Sig Auto-Suggest + Last-Used Rx Recall — Design

**Date:** 2026-06-24
**Roadmap item:** #12 (NEXT tier) — "Smart sig auto-suggest + 'last-used Rx' recall per ailment — Fewer clicks per consult"
**Status:** Draft (pending review)

---

## 1. Purpose

When an Ontario pharmacist selects a regimen on the CDST's Rx step (`src/components/wizard/step-rx.tsx:39-62`), the wizard pre-fills the four editable prescription fields — **sig, quantity, refills, duration** — with values derived in exactly one place: `handleSelectRx` in `src/components/wizard/wizard-container.tsx:70-78`:

```ts
function handleSelectRx(rx: Ailment["rxOptions"][number]) {
  setSelectedRx({
    ...rx,
    sig: rx.dose,        // the only non-generic value: re-uses the regimen's "dose" string
    quantity: "1",       // ← hardcoded, meaningless for every regimen
    refills: "0",        // ← hardcoded
    duration: "",        // ← always blank
  })
}
```

`rx.dose` is a reasonable sig seed for some regimens (e.g. UTI `Nitrofurantoin 100 mg` → dose `"1 cap BID × 5 days"`, which already encodes frequency + duration), but it is a bare frequency string for others (acne `Benzoyl peroxide 2.5–5%` → dose `"Apply BID"`), and it is **never** a quantity, a refill count, or a course duration. So today every consult lands the pharmacist on four fields where three are nonsensical placeholders: a topical paste defaults to `quantity: "1"`, a 5-day antibiotic course defaults to `duration: ""`, a once-daily 30-day antihistamine defaults to `quantity: "1"`. The pharmacist hand-corrects all four on every consult. That is the "fewer clicks per consult" gap roadmap item #12 names — PharmAssess and MAPflow both pre-fill sensible sigs; the CDST pre-fills `"1"`.

There is **no sig/dose suggestion infrastructure anywhere** in the codebase. A `rg` for `sig|sigDefault|suggest|recall|lastUsed|defaultSig|quantity` across `src/` returns only the `handleSelectRx` hardcoded block, the `SelectedRx` type fields (`src/types/index.ts:52-57`), the PDF render cells (`src/components/combined-pdf.tsx:280-282`), the step-Rx inputs (`step-rx.tsx:71-104`), and their tests. There is no defaults module, no recall query, no per-patient history read. The 19 ailments carry **80 Rx options in total** (`data/ailments.json`: acne 7, allergic-rhinitis 7, aphthous-ulcers 1, candidal-stomatitis 1, conjunctivitis 6, dermatitis 9, dysmenorrhea 2, gerd 5, hemorrhoids 5, herpes-labialis 5, impetigo 3, insect-bites-urticaria 5, musculoskeletal 4, nausea-vomiting 3, nvp 4, pinworms 2, tick-bites-lyme 1, uti 4, vvc 6) and **every one of them** funnels into the same four placeholders.

Roadmap #12 is two coupled sub-features in one line:

1. **Smart sig auto-suggest** — curated, per-regimen default values for `sig`/`quantity`/`refills`/`duration` that replace the hardcoded `"1"`/`"0"`/`""` placeholders with clinically-sensible starting points a pharmacist accepts or tweaks. This is **static reference content** (a versioned/hashed `src/lib/clinical/*.ts` module) and, like roadmap #6 (differentials) and #9 (citations), it **ships LIVE in Phase 1 with no database, no BAA, no flag** — it is non-PHI advisory content bundled into the client.
2. **"Last-used Rx" recall per ailment** — when the pharmacist has entered the patient (step 0) and selects a drug on step 2, the wizard offers the **exact sig/quantity/refills/duration this patient received the last time they were prescribed for this ailment**, read from the persisted assessment record. This is a **PHI read from fly.io** (roadmap #2's `assessment.selected_rx` jsonb), so it is **BAA-gated behind `PHI_PERSIST_ENABLED`** and lights up only when #2 is live.

**The goal of this feature** is to make the four Rx fields arrive pre-populated with the best available value, resolved by a strict precedence — **last-used (patient-specific, Phase 2) → smart-sig default (regimen-specific, Phase 1) → today's generic (`rx.dose`/`"1"`/`"0"`/`""`)** — so the pharmacist's job on step 2 shrinks from "type four fields" to "review and confirm" for the common recurrence case (UTI, acne, allergic-rhinitis, dysmenorrhea) and from "type four fields" to "tweak one or two" for the first-visit case. No field is ever locked: every value remains pharmacist-editable, exactly as today (`step-rx.tsx:21-24`).

**Out of scope** (per roadmap §3 and the feature's discipline): any clinical-safety validation of the sig (dose-range checks, allergy/interaction/pregnancy gating are PMS-owned — the CDST renders `ailment.rxOptions` raw at `step-rx.tsx:39-62` and never re-derives safety); an AI/ML sig-generation engine (no BAA, not requested, and the curated defaults module is deterministic and reviewable — the same "deterministic first, AI optional later" split #7 established); per-pharmacy aggregate "most common sig" statistics (a LATER analytics surface, #25/#13); and any change to the `SelectedRx` type shape or the PDF rendering (the four fields already render at `combined-pdf.tsx:278-283` and need no change — #12 only changes what *populates* them).

---

## 2. Current State (what exists in code)

### 2.1 The single point of pre-fill, and its three placeholders

`WizardContainer.handleSelectRx` (`wizard-container.tsx:70-78`) is the **only** code path that constructs a `SelectedRx` from a clicked `RxOption`. It spreads the regimen (`drug`, `dose`, `notes` from `types/index.ts:1-5`) and hardcodes the four tail fields. `SelectedRx` extends `RxOption` with exactly those four (`types/index.ts:52-57`):

```ts
export interface SelectedRx extends RxOption {
  sig: string
  quantity: string
  refills: string
  duration: string
}
```

The fields are plain `string` (free-text), edited via four `<Input>` boxes on `step-rx.tsx:71-104` (sig, quantity, refills, duration), each calling `handleFieldChange(field, value)` → `onSelectedRxChange({ ...selectedRx, [field]: value })` (`step-rx.tsx:21-24`). The CDST never validates, parses, or units-checks any of them — they are medico-legal free-text the pharmacist owns, printed verbatim onto the PDF table at `combined-pdf.tsx:280-282` (`{selectedRx.sig}`, `{selectedRx.quantity}`, `{selectedRx.refills}`; `duration` is not currently rendered on the combined PDF but is captured). Because they are free-text strings, **any** sensible default is a strict improvement and cannot break a downstream parser (there is none).

### 2.2 `rx.dose` is a partial sig but never a quantity/refill/duration

Inspecting `data/ailments.json`, the `dose` string is regimen-shaped and varies in how much of a full sig it already contains:

| Ailment | Drug | `dose` (today's `sig` seed) |
|---|---|---|
| `uti` | Nitrofurantoin 100 mg | `"1 cap BID × 5 days"` — frequency **and** duration |
| `uti` | Fosfomycin 3 g | `"Single dose"` |
| `acne` | Benzoyl peroxide 2.5–5% | `"Apply BID"` — frequency only |
| `allergic-rhinitis` | Cetirizine 10 mg | `"Once daily"` — frequency only |
| `aphthous-ulcers` | Triamcinolone dental paste | `"Apply to ulcer BID–QID"` — frequency only |
| `dysmenorrhea` | Ibuprofen 400 mg | `"1 tab q6–8h PRN (max 1200 mg/day)"` — PRN + ceiling |
| `pinworms` | Mebendazole 100 mg | `"Single dose; repeat in 2 weeks"` — schedule, not a dispense quantity |

So `sig: rx.dose` is occasionally a near-complete sig (UTI) but is usually a frequency fragment, and it is **never** a dispense quantity (a number of tablets, a tube size in grams), a refill count, or a course duration in the pharmacist's own terms. The smart-sig module's job is to supply those three missing dimensions per regimen, and to upgrade `sig` from a frequency fragment to a full direction where the data supports it.

### 2.3 No persistence → no recall possible today

Roadmap #2 (`docs/superpowers/specs/2026-06-23-persist-assessments-flyio-design.md`) specifies the fly.io `assessment` table that recall reads from. Its `selected_rx` column is `jsonb` mirroring the full `SelectedRx` shape (`persist-assessments-flyio-design.md:149`: `selected_rx jsonb, -- SelectedRx | null (drug, dose, sig, quantity, refills, duration, notes)`), keyed by `patient_id` (resolved via `patient.identity_hash`, an HMAC over `name|dob|postalCode` per §4.2) and `ailment_slug`. **fly.io is not yet provisioned and the BAA is not signed** (roadmap §7 open questions #1, #2), and `AssessmentData` (`types/index.ts:59-67`) has zero write call sites today (`persist-assessments-flyio-design.md:30`: "has zero call sites that persist it"). So **last-used recall is impossible until #2 ships** — this feature's Phase 2 is strictly additive on #2's live store and is a no-op stub until then, exactly like the Phase-1/Phase-2 split #1, #3, #4, #7, #10, #11, and #22 all adopt.

### 2.4 The wizard is ailment-anchored; identity arrives at step 0

`assess/[ailment]/page.tsx:9-16` resolves one fixed `ailment` from the route param and passes it as a single prop to `<WizardContainer ailment={ailment} pharmacy={...}>` (`page.tsx:53`). The wizard therefore always knows `ailment.slug` from mount. Patient identity (`name`, `dob`, `postalCode`) is captured on step 0 (`step-patient.tsx`) and is required to advance (`wizard-container.tsx:52-54`: `canNext` for step 0 requires `patient.name && patient.dob`). So **by the time the pharmacist reaches step 2 (Rx), the identity inputs needed to resolve a patient on fly.io are already in component state** — the recall query can fire on the step-0→step-2 transition without any new capture surface. This is the structural reason recall is cheap to add: the join key (identity) and the filter (`ailment.slug`) are both already in scope when the Rx step renders.

### 2.5 The content-governance precedent is firmly established

Curated clinical/governance content needing a reproducible hash lives in a **versioned TS module under `src/lib/clinical/` or `src/lib/`**, never in `data/ailments.json` — both because the gnhf iteration constraint forbids `data/` edits and because a `protocol_version`/content hash must be reproducible from the build. The precedent now spans #3 (`statements.ts`), #4 (`reasons.ts`), #6 (`clinical/differentials.ts`), #9 (`clinical/citations.ts`), #10 (`clinical/prom.ts`), #22 (`vaccines/catalog.ts`), #11 (`signature/attestation.ts`), and #7 (`notes/` template). The smart-sig defaults module is the ninth instance of this pattern — `src/lib/clinical/sig-defaults.ts` with `SIG_DEFAULTS_VERSION` + `computeSigDefaultsHash()` — feeding roadmap #26 (clinical content governance) and #14 (outcomes reproducibility).

### 2.6 No audit of sig selection exists, and recall is a read-only PHI access

The Supabase `EventType` union (`audit-actions.ts:5-18`) has no sig/recall event, and none is needed for the smart-sig defaults (Phase 1 is pure local client computation — no disclosure, no event, mirroring #7's template tier and #6/#9's reference content). The recall (Phase 2) is a **PHI read** of `assessment.selected_rx`; per #2's discipline (`persist-assessments-flyio-design.md:212`), every PHI read writes a `phi_audit_log` row. #12 therefore adds a `sig.recalled` PHI-read action to `phi_audit_log` (free-text `action` column, no CHECK constraint per #2 §4.4 — no migration needed) and, per the recommendation in §5, **no** Supabase mirror (the recall is intrinsically a PHI access of an identified patient, like #11's `signature.enrolled`).

---

## 3. Approach (options + recommendation)

The design hinges on four decisions: (a) **where the smart-sig defaults live and how they ship**, (b) **what the recall is scoped to** (patient vs. pharmacy vs. ailment), (c) **the precedence when multiple sources disagree**, and (d) **the recall transport + identity handling**. Options are evaluated against roadmap §6.2 (PHI on fly.io, Supabase = auth + non-PHI), §6.4 (the partitioning rule), and §4 (the "counter speed" wedge — every click removed at step 2 is the wedge this feature exists to serve).

### Option A — Curated smart-sig defaults module (live Phase 1) + per-patient last-used recall (Phase 2, BAA-gated), patient recall taking precedence (RECOMMENDED)

A versioned/hashed `src/lib/clinical/sig-defaults.ts` module maps each `(ailment_slug, drug)` pair to a curated `{ sig, quantity, refills, duration }` default, derived from the regimen's `dose` and standard Ontario dispensing practice (e.g. `uti::Nitrofurantoin 100 mg` → `{ sig: "Take 1 capsule by mouth twice daily", quantity: "10 capsules", refills: "0", duration: "5 days" }`; `acne::Benzoyl peroxide 2.5–5%` → `{ sig: "Apply thin layer to affected areas twice daily", quantity: "60 g", refills: "2", duration: "8–12 weeks" }`). `handleSelectRx` consults `getSigDefault(ailment.slug, rx.drug)` and falls back to today's generic (`rx.dose`/`"1"`/`"0"`/`""`) when the pair is un-curated, so the wizard is never worse than today and strictly better for every curated regimen. This module is **non-PHI static reference content bundled into the client** — it ships **LIVE in Phase 1** with no database, no BAA, no flag, no server round-trip (the same "non-PHI ships live immediately" property #6 differentials, #9 citations, #22 inventory, and #7's template tier established).

Layered on top, behind #2's `PHI_PERSIST_ENABLED`, a per-patient recall: when the pharmacist advances from step 0 to step 2, a flag-guarded server action `getRecalledSigAction({ ailmentSlug, drug, patientIdentity })` resolves the patient via #2's `identity_hash`, queries fly.io for the most recent `assessment.selected_rx` where `patient_id` + `ailment_slug` + `selected_rx->>'drug'` match, and returns the prior `SelectedRx` tail (or `null`). When the pharmacist selects that same drug, the recalled values **override** the smart-sig default (precedence: **recall > smart-sig > generic**), because what THIS patient actually received last time is more relevant than a population default. A non-intrusive "Last used for this patient: [drug] — [sig] ([date])" hint surfaces the ailment-level history regardless of which drug is selected, so the pharmacist sees recurrence at a glance.

- **Pros:** Faithful to roadmap #12's two-part wording ("smart sig auto-suggest **+** last-used Rx recall"). The Phase-1 smart-sig module delivers immediate counter-speed value independent of every gating decision (fly.io, BAA, #2) — like #6/#9 it is unblocked reference content. The Phase-2 recall is the higher-value half for chronic/recurrent ailments (UTI, acne, allergic-rhinitis, dysmenorrhea) where the same patient returns and the prior sig is almost always re-acceptable; it is a **read-only** extension of #2's store (no new table, no schema change, no new PHI written by this feature — the lightest fly.io-touching feature yet). Precedence is intuitive and never locks a field (the pharmacist can always override). Reuses the content-governance module pattern verbatim and #2's `assessment-store.ts` + `identity.ts` verbatim.
- **Cons:** The smart-sig module must be **clinically curated and reviewed** for 80 regimen rows (a soft gate — pharmacist/clinical review, same as #6's differentials and #9's citations). The recall adds one server action + one fly.io read per step-2 entry (acceptable; one indexed query, and it is skipped entirely when the flag is off or no patient history exists). Per-patient recall requires identity to reach the server (handled via the same server-action POST body discipline #2's `saveAssessmentAction` uses — name/dob/postal hashed server-side via `PHI_IDENTITY_SALT`, never logged).

### Option B — AI/ML sig-generation engine (LLM drafts the sig from the regimen)

An LLM (the #7 provider, BAA'd) generates the sig/quantity/refills/duration from the drug + dose + ailment on demand.

- **Cons:** Blocked on the same BAA/provider gate as #7's Phase 2 (no value until then), adds non-determinism to a medico-legal free-text field that a pharmacist must then review anyway (the #7 "documentation assistant, never clinical decision" lane applies even more strictly to a prescription direction), and the curated defaults module is deterministic, reviewable, hashable, and offline — strictly better for a counter-speed feature that cannot depend on a model's uptime. The roadmap does not ask for AI here; #7 already covers the AI-drafted-text lane.
- **Rejected** as the primary path; an optional "AI suggest an alternative sig" affordance could ride on #7's provider later (LATER), but the curated default + recalled-history stack is the NOW implementation.

### Option C — Per-pharmacy aggregate "most common sig" instead of per-patient recall

Instead of reading one patient's last sig, compute the pharmacy's most-used sig per `(ailment, drug)` across all its historical assessments and suggest that.

- **Pros:** No patient-identity resolution needed at recall time (pharmacy + ailment + drug are all known without the patient step) — slightly simpler query.
- **Cons:** It answers "what does this pharmacy usually do" rather than "what did THIS patient get" — strictly weaker for the recurrence case (a returning UTI patient cares about their own last course, not the pharmacy mode), and it conflates individual variation into a statistic that can be medico-legally misleading as a "suggested" default. It is also an **analytics** surface (aggregation over many rows) that belongs to roadmap #13 (analytics dashboard) / #25 (revenue-leakage optimizer), not to a per-consult pre-fill. Per-patient recall is the higher-value, lower-risk reading of "last-used Rx."
- **Rejected** as the primary path; retained as an **optional Phase-3 enhancement** (a "most common at your pharmacy" secondary hint) that reuses the same query plumbing with a `GROUP BY` — explicitly parked for #13/#25 (Open Question §7.8).

### Recommendation

**Option A.** It is the faithful two-part implementation of roadmap #12, it splits cleanly along the now-established Phase-1-non-PHI-ships-live / Phase-2-PHI-behind-flag boundary, and it is the lightest possible fly.io footprint (read-only over #2, no new table, no schema change). The precedence (recall > smart-sig > generic) is intuitive, never locks a field, and degrades gracefully at every gate: no #2 → smart-sig only; un-curated regimen → generic; first-visit patient → smart-sig. The 80-row curation is a soft clinical-review gate identical to #6/#9, and the recall query is one indexed `SELECT` over a column #2 already writes.

---

## 4. Components & Data Model

### 4.1 New types (`src/types/index.ts`)

```ts
// The smart-sig default for one (ailment_slug, drug) pair. All four fields are
// free-text starting points (mirroring SelectedRx's free-text fields); never validated.
export interface SigDefault {
  sig: string
  quantity: string
  refills: string
  duration: string
}

// The minimal patient identity needed to resolve a prior assessment on fly.io.
// Mirrors #2's identity_hash inputs (persist-assessments-flyio-design.md §4.2).
export interface PatientIdentity {
  name: string
  dob: string
  postalCode: string
}

// The recall result returned to the client: the prior SelectedRx tail + provenance.
export interface RecalledSig {
  drug: string                  // the drug that was prescribed last time (may differ from current selection)
  sig: string
  quantity: string
  refills: string
  duration: string
  prescribedAt: string          // assessment.created_at (ISO) — for the "Last used ... on [date]" hint
}
```

### 4.2 Versioned smart-sig defaults module (`src/lib/clinical/sig-defaults.ts`, new)

The ninth instance of the content-governance precedent (§2.5). Pure module, SSR-safe, no side effects, no dependencies beyond `node:crypto`.

```ts
import { createHash } from "node:crypto"
import type { SigDefault } from "@/types"

export const SIG_DEFAULTS_VERSION = "sig-defaults-v1"

// Keyed by `${ailmentSlug}::${drug}` — the EXACT drug string from data/ailments.json.
// Curated from each regimen's `dose` + standard Ontario dispensing practice.
// Every entry MUST be clinically reviewed before launch (soft gate, §6/§7.4).
export const SIG_DEFAULTS: Readonly<Record<string, SigDefault>> = {
  // ── uti ────────────────────────────────────────────────────────────────────
  "uti::Nitrofurantoin 100 mg": {
    sig: "Take 1 capsule by mouth twice daily with food",
    quantity: "10 capsules", refills: "0", duration: "5 days",
  },
  "uti::TMP-SMX (160/800 mg)": {
    sig: "Take 1 tablet by mouth twice daily",
    quantity: "6 tablets", refills: "0", duration: "3 days",
  },
  "uti::Trimethoprim 100 mg": {
    sig: "Take 1 tablet by mouth twice daily",
    quantity: "6 tablets", refills: "0", duration: "3 days",
  },
  "uti::Fosfomycin 3 g": {
    sig: "Take 1 sachet (3 g) by mouth as a single dose",
    quantity: "1 sachet", refills: "0", duration: "1 day",
  },
  // ── acne (topicals → tube sizes; oral → tablet counts) ─────────────────────
  "acne::Benzoyl peroxide 2.5–5%": {
    sig: "Apply a thin layer to affected areas twice daily after washing",
    quantity: "60 g", refills: "2", duration: "8–12 weeks",
  },
  "acne::Adapalene 0.1%": {
    sig: "Apply a thin layer to affected areas at bedtime",
    quantity: "30 g", refills: "2", duration: "8–12 weeks",
  },
  // … (all 80 regimen rows populated; a representative sample is shown here;
  //     the implementation plan enumerates the full curation task) …
  // ── allergic-rhinitis ───────────────────────────────────────────────────────
  "allergic-rhinitis::Cetirizine 10 mg": {
    sig: "Take 1 tablet by mouth once daily",
    quantity: "30 tablets", refills: "2", duration: "30 days",
  },
  // ── aphthous-ulcers ────────────────────────────────────────────────────────
  "aphthous-ulcers::Triamcinolone dental paste": {
    sig: "Apply a thin film to the ulcer 2–4 times daily after meals",
    quantity: "5 g", refills: "1", duration: "7–14 days",
  },
  // ── pinworms (two-dose schedule → quantity covers one dose + the repeat) ────
  "pinworms::Mebendazole 100 mg": {
    sig: "Take 1 tablet as a single dose; repeat in 2 weeks",
    quantity: "2 tablets", refills: "0", duration: "1 day (repeat at week 2)",
  },
}

const KEY_SEPARATOR = "::"

export function sigDefaultKey(ailmentSlug: string, drug: string): string {
  return `${ailmentSlug}${KEY_SEPARATOR}${drug}`
}

// Returns the curated default for an exact (ailment, drug) pair, or null when un-curated.
// null → the caller falls through to today's generic (rx.dose / "1" / "0" / "").
export function getSigDefault(ailmentSlug: string, drug: string): SigDefault | null {
  return SIG_DEFAULTS[sigDefaultKey(ailmentSlug, drug)] ?? null
}

// sha256 over the canonical (key-sorted) JSON of SIG_DEFAULTS + the version.
// Reproducible from the build; feeds #26 governance + #14 outcomes reproducibility.
export function computeSigDefaultsHash(): string {
  const sorted = Object.keys(SIG_DEFAULTS).sort().reduce<Record<string, SigDefault>>((acc, k) => {
    acc[k] = SIG_DEFAULTS[k]
    return acc
  }, {})
  return createHash("sha256")
    .update(SIG_DEFAULTS_VERSION)
    .update(JSON.stringify(sorted))
    .digest("hex")
}
```

> The keying on the **exact** `data/ailments.json` drug string is deliberate and matches the fragility analysis from #9 §(robustness): a rephrase of a drug name in `data/ailments.json` (which this iteration cannot edit) would orphan the curated default silently. The mitigation is the same as #9's — `getSigDefault` returns `null` and the wizard falls through to today's generic, so an orphaned key degrades gracefully to the pre-feature behaviour rather than breaking. A CI guard (§6, plan Task 8) asserts every `SIG_DEFAULTS` key resolves to a real `(ailment.slug, ailment.rxOptions[].drug)` pair so drift is caught at test time, not at the counter.

### 4.3 Updated pre-fill in `handleSelectRx` (`wizard-container.tsx:70-78`, modified)

`handleSelectRx` gains a recalled-sig argument and applies the precedence **recall > smart-sig > generic**:

```ts
// wizard-container.tsx (modified) — handleSelectRx now resolves the best available
// pre-fill. `recalled` is null in Phase 1 (flag off) and on first-visit patients.
function handleSelectRx(
  rx: Ailment["rxOptions"][number],
  recalled: RecalledSig | null
) {
  const smart = getSigDefault(ailment.slug, rx.drug)   // Phase 1, always available
  const sameDrugRecall = recalled && recalled.drug === rx.drug ? recalled : null
  const base: Partial<SelectedRx> = smart
    ? { sig: smart.sig, quantity: smart.quantity, refills: smart.refills, duration: smart.duration }
    : { sig: rx.dose, quantity: "1", refills: "0", duration: "" }   // today's generic
  setSelectedRx({
    ...rx,
    ...(sameDrugRecall                                   // recall overrides smart-sig per-field
      ? { sig: sameDrugRecall.sig, quantity: sameDrugRecall.quantity,
          refills: sameDrugRecall.refills, duration: sameDrugRecall.duration }
      : base),
  })
}
```

Recall overrides **all four** fields only when the recalled drug matches the selection (a different drug's sig is not transferable). When the pharmacist later clicks a different drug card, the same resolution re-runs against the already-fetched `recalled` value — no extra server call per click.

### 4.4 Recall store read (`src/lib/phi/assessment-store.ts`, extended from #2)

Per #2's discipline (`persist-assessments-flyio-design.md:203-213`), **all** fly.io reads funnel through `assessment-store.ts`, which injects `pharmacy_id` from the verified JWT and accepts neither `pharmacyId` nor `patientId` from a caller. #12 adds one read function:

```ts
// src/lib/phi/assessment-store.ts (extended from #2)
import { computeIdentityHash } from "./identity"   // #2 §4.2

// Returns the patient's most-recent prescribed SelectedRx for this ailment + drug,
// or null. Read-only: writes a phi_audit_log row (action 'sig.recalled').
// No-op (returns null) when PHI_PERSIST_ENABLED !== "true".
export async function getLastUsedSig({
  pharmacyId, identityHash, ailmentSlug, drug,
}: {
  pharmacyId: string
  identityHash: string
  ailmentSlug: string
  drug: string
}): Promise<RecalledSig | null> {
  const pool = getPhiPool()   // #2 §4.1; throws if flag off → caller guards
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      `SELECT a.selected_rx AS rx, a.created_at AS prescribed_at
         FROM assessment a
         JOIN patient p ON p.id = a.patient_id
        WHERE p.pharmacy_id = $1
          AND p.identity_hash = $2
          AND a.pharmacy_id = $1
          AND a.ailment_slug = $3
          AND a.outcome = 'prescribed'
          AND a.selected_rx IS NOT NULL
          AND a.selected_rx->>'drug' = $4
        ORDER BY a.created_at DESC
        LIMIT 1`,
      [pharmacyId, identityHash, ailmentSlug, drug]
    )
    // PHI-read audit (free-text action column; no CHECK per #2 §4.4 → no migration)
    await client.query(
      `INSERT INTO phi_audit_log
         (assessment_id, patient_id, pharmacy_id, actor_id, action, metadata)
       VALUES ($1, $2, $3, $4, 'sig.recalled',
         jsonb_build_object('ailment_slug', $5, 'drug', $6, 'hit', $7))`,
      [rows[0]?.rx?.assessment_id ?? null, null, pharmacyId, /* actor from ctx */ null,
       ailmentSlug, drug, rows.length > 0]
    )
    if (rows.length === 0) return null
    const rx = rows[0].rx
    return {
      drug: rx.drug, sig: rx.sig, quantity: rx.quantity,
      refills: rx.refills, duration: rx.duration,
      prescribedAt: rows[0].prescribed_at,
    }
  } finally {
    client.release()
  }
}
```

Every query text contains `pharmacy_id` (CI grep guard, mirroring #2 §5.3's `pharmacy_id` rule and #11's `pharmacist_id` rule). The join through `patient` enforces the `(pharmacy_id, identity_hash)` ownership before any `assessment` row is visible, so a cross-pharmacy recall is structurally impossible. The `sig.recalled` audit row records the read (hit/miss) for PHI-access traceability — recall is a PHI access of an identified patient and must be on the tamper-evident chain (#2 §4.4).

### 4.5 Server action (`src/lib/sig-recall-actions.ts`, new `"use server"`)

Mirrors #2's `saveAssessmentAction` and #11's flag-guarded discipline. The patient identity travels only inside the Server Action POST body (never a URL, never logged) and is hashed server-side via #2's `PHI_IDENTITY_SALT` — the client never sees the hash and never holds the salt.

```ts
// src/lib/sig-recall-actions.ts
"use server"
import { requireAuth } from "@/lib/auth-guards"
import { computeIdentityHash } from "@/lib/phi/identity"   // #2 §4.2
import { getLastUsedSig } from "@/lib/phi/assessment-store"

export async function getRecalledSigAction({
  ailmentSlug, drug, patient,
}: {
  ailmentSlug: string
  drug: string
  patient: PatientIdentity
}): Promise<RecalledSig | null> {
  const profile = await requireAuth()
  if (!profile.pharmacyId) return null
  // Phase-1 stub: fly.io dark → recall impossible → return null (smart-sig still works).
  if (process.env.PHI_PERSIST_ENABLED !== "true") return null
  // Refuse to recall without complete identity inputs (mirrors #2 §6: no name/dob → no row).
  if (!patient.name || !patient.dob || !patient.postalCode) return null
  const identityHash = computeIdentityHash(patient)   // HMAC server-side; salt never sent to client
  return getLastUsedSig({
    pharmacyId: profile.pharmacyId,
    identityHash,
    ailmentSlug,
    drug,
  })
}
```

### 4.6 Step-2 UI: recall hint + smart-sig pre-fill (`step-rx.tsx`, modified)

`StepRx` gains an optional `recalled: RecalledSig | null` prop and renders a non-intrusive hint above the Prescription Details block when a prior prescription exists for this patient + ailment (regardless of the currently-selected drug), surfacing recurrence at a glance:

- **Recalled drug === selected drug:** the four fields arrive pre-filled with the recalled values (precedence applied in `handleSelectRx`, §4.3); the hint reads *"Last used for this patient: [sig] — [quantity], on [date]. Values pre-filled; review and edit."*
- **Recalled drug !== selected drug:** the fields pre-fill from the smart-sig default (or generic); the hint reads *"Previously prescribed [recalled.drug] ([recalled.sig]) on [date]."* with a one-click *"Switch to [recalled.drug]"* affordance that re-selects the recalled regimen (calling `onSelect(recalledRegimen)` where `recalledRegimen` is resolved from `ailment.rxOptions.find(r => r.drug === recalled.drug)`), which then triggers the same-drug pre-fill path.
- **No recall (first visit / Phase 1 / un-curated):** no hint; the fields pre-fill from the smart-sig default or today's generic. The step is byte-identical to today for un-curated regimens in Phase 1.

No field is disabled or locked — every value remains editable via the existing `handleFieldChange` inputs (`step-rx.tsx:21-24, 71-104`). The hint is advisory chrome; the pre-fill is the value.

### 4.7 Recall trigger wiring (`wizard-container.tsx`, modified)

The recall fires once when the pharmacist advances from step 0 to step 2 (identity is complete by then, §2.4). `WizardContainer` gains a `recalled` state + a `useEffect` that, on entering step 2, calls `getRecalledSigAction({ ailmentSlug: ailment.slug, drug: selectedRx?.drug ?? "", patient: { name, dob, postalCode } })` and stores the result; it re-fires only if the pharmacist changes the selected drug (one call per drug selection). The recalled value is threaded into `handleSelectRx` (§4.3) and into `<StepRx recalled={recalled}>` (§4.6). All recall calls are skipped when `PHI_PERSIST_ENABLED` is off (the action short-circuits to `null`), so Phase 1 incurs no server round-trip.

### 4.8 No PDF change, no `SelectedRx` shape change

The four fields already render onto the combined PDF at `combined-pdf.tsx:278-283` and are captured on the referral summary at `wizard-container.tsx` — #12 changes only **what populates** them, never how they render or are typed. No PDF component is modified. No `EventType` is added to the Supabase union (the smart-sig tier is local computation; the recall tier is a PHI read on fly.io, not a Supabase event — §5.1). No new env vars: Phase 2 reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.

---

## 5. Security / PHIPA-PIPEDA Posture

This feature is the lightest fly.io-touching feature in the roadmap: it **writes no PHI of its own** and adds **no new table and no schema change** — it only **reads** `assessment.selected_rx` (a column #2 already writes) and ships a non-PHI reference module. It therefore inherits every control #2 establishes and adds only read-specific and reference-content discipline.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| `SIG_DEFAULTS` content (curated sig/quantity/refill/duration strings) | **Non-PHI** (generic reference content describing regimens, not any patient) | **Client bundle only.** Never fly.io, never Supabase. Ships live in Phase 1. |
| `SIG_DEFAULTS_VERSION`, `computeSigDefaultsHash()` | Non-identifying (a version + a content hash) | Client bundle; the hash may appear in future #26 governance metadata. |
| Recalled `selected_rx` (a specific patient's prior sig/quantity/refills/duration) | **PHI** (clinical content of an identified patient's care event) | **fly.io** `assessment.selected_rx` (read-only). Never Supabase. |
| `PatientIdentity` (name/dob/postalCode) in transit | **PHI** in transit | Travels only inside the `getRecalledSigAction` Server Action POST body (server runtime), hashed server-side via `PHI_IDENTITY_SALT` (#2 §4.2) before any fly.io query. Never in a URL, never logged, never sent to the client as a hash. |
| `identity_hash` | Pseudonymous identifier | fly.io `patient.identity_hash` (HMAC'd). Same as #2. |
| `pharmacy_id`, `pharmacist_id` | Non-PHI (business/employee) | Scoping keys on fly.io, from the verified JWT. Same as #2. |
| `sig.recalled` audit row (hit/miss + ailment_slug + drug) | **PHI-adjacent** (records that an identified patient's record was accessed) | **fly.io** `phi_audit_log` only. **No Supabase mirror** — a recall event is intrinsically a PHI access of an identified patient (like #11's `signature.enrolled`), so mirroring its existence to the non-PHI log would itself leak that the patient was looked up. |

**Rule of thumb (roadmap §6.4):** the curated defaults describe regimens, not patients → non-PHI client bundle. The recalled values describe one identified patient's clinical state → PHI on fly.io. The recall *event* records access to that patient → PHI on fly.io.

### 5.2 Regulatory mapping

- **PHIPA s.12 / s.10.1:** the recall is a PHI read → logged to the tamper-evident `phi_audit_log` (`sig.recalled`), satisfying custodian accountability for every access. The smart-sig defaults touch no PHI and need no access control.
- **PIPEDA Principle 4.5 (limiting use):** the recall reads only `selected_rx` for the matching `(patient, ailment, drug)` — a purpose-limited, minimal read, not a full record pull. `LIMIT 1` + the indexed `(patient_id, ailment_slug, created_at DESC)` scan (#2 §4.3 indexes) keeps it cheap and scoped.
- **PHIPA s.17 (cross-border):** the recall query runs against fly.io in a Canadian region (inherited gate from #2); no new cross-border surface is introduced. The smart-sig module is static client content with no network movement.
- **Clinical-safety boundary (roadmap §3):** smart-sig defaults and recalled values are **advisory pre-fills**, never validated sigs. The CDST does not perform DUR (dose-range, allergy, interaction, pregnancy checks) — the PMS owns all of that. Every pre-filled value is pharmacist-editable and is the pharmacist's medico-legal act, exactly as today's hand-typed value is. This mirrors #6 (differentials are advisory) and #9 (citations are reference) precisely.
- **Not 21 CFR Part 11 (confirmed):** roadmap §6.1 explicitly states Part 11 does not apply; no validation is required for either the reference module or the recall.

### 5.3 Application security

- **Authorization is app-layer, not RLS** — identical to #2 §5.3. The recall funnels through `getLastUsedSig` in `assessment-store.ts`, which injects `pharmacy_id` from the verified JWT and joins through `patient` on `(pharmacy_id, identity_hash)` before any `assessment` row is visible. A pharmacist can recall **only their own pharmacy's** patients. `identityHash` is computed server-side from the action's `patient` input + `PHI_IDENTITY_SALT`; the caller cannot supply a raw `patient_id`. A CI grep (`rg -n "FROM assessment|JOIN patient" src/lib/phi/assessment-store.ts`) verifies every query text contains `pharmacy_id`.
- **Read-only:** `getLastUsedSig` issues only `SELECT` + the `phi_audit_log INSERT`. It offers no `UPDATE`/`DELETE` — the feature cannot mutate #2's records.
- **Identity minimization:** the action carries exactly the three identity fields #2's `computeIdentityHash` consumes (`name`, `dob`, `postalCode`) — no OHIP, no address, no phone — minimizing the PHI in transit. The salt is server-only (never `NEXT_PUBLIC_`).
- **Phase-1 fail-soft:** when `PHI_PERSIST_ENABLED` is off, `getRecalledSigAction` returns `null` without a network call; the wizard proceeds on smart-sig defaults only. No recall failure can block a consult (the feature is pure pre-fill convenience — fail-soft, unlike #2's fail-closed *write*).
- **Client never holds the salt or the hash:** the client sends plaintext identity over the Server Action boundary (same channel as #2's `saveAssessmentAction`) and receives only the resolved `RecalledSig | null`. The HMAC and the fly.io read happen server-side.

---

## 6. Edge Cases

- **fly.io not yet provisioned / BAA unsigned (Phase 1):** `PHI_PERSIST_ENABLED` is off; `getRecalledSigAction` returns `null` without calling the store; the recall hint never renders; `handleSelectRx` resolves to the smart-sig default (or generic). The wizard is strictly better than today (smart-sig) with no gating dependency. The flag and the read path are ready so flipping the switch lights up recall with no further code change.
- **Un-curated regimen (smart-sig miss):** `getSigDefault` returns `null`; `handleSelectRx` falls through to today's generic (`rx.dose`/`"1"`/`"0"`/`""`). The wizard is byte-identical to today for that regimen — never worse. A CI guard (plan Task 8) asserts every `SIG_DEFAULTS` key resolves to a real `(slug, drug)` pair and (optionally) flags regimens lacking a curated default for the curation backlog.
- **Drug-string drift in `data/ailments.json`:** if a drug name is rephrased (this iteration cannot edit `data/`), the curated key orphans silently and `getSigDefault` returns `null` → graceful fall-through to generic (same robustness argument as #9's section-level citation keying). Caught by the CI guard at test time.
- **First-visit patient (no prior assessment):** the recall query returns no row → `null` → smart-sig default. The hint does not render. Correct.
- **Recalled drug differs from the selected drug:** the hint shows the prior prescription for context but does **not** transplant a different drug's sig onto the current selection (a sig is drug-specific). A one-click "Switch to [recalled.drug]" affordance re-selects the recalled regimen if the pharmacist wants it (§4.6).
- **Patient identity typo (resolves to a different/no patient):** the HMAC resolves to a different `identity_hash` → either a different patient's history (a data-quality issue, not a safety issue — the pharmacist reviews every pre-fill) or no patient → `null` → smart-sig default. This is the same best-effort identity resolution #2 §6 documents; pharmacist-confirmed patient matching is LATER (#2 §7.6).
- **Two pharmacists at the same pharmacy assess the same patient:** both resolve to the same `patient.id` via `identity_hash` (#2 §6); recall returns the most recent assessment regardless of which pharmacist wrote it — correct (the patient's history is the pharmacy's record, scoped by `pharmacy_id`).
- **Quantity/duration are free-text with units ("60 g", "8–12 weeks"):** the smart-sig defaults include units to match the pharmacist's own convention; recall returns whatever free-text was entered last time. No parser exists, so no unit-normalization bug is possible.
- **PRN / ceiling-dose regimens (e.g. dysmenorrhea ibuprofen `"max 1200 mg/day"`):** the curated default embeds the ceiling in the sig string (e.g. `sig: "Take 1 tablet by mouth every 6–8 hours as needed (max 1200 mg/day)"`); the CDST does not enforce the ceiling (PMS-owned DUR) — it surfaces it as advisory text, mirroring how `data/ailments.json` already carries advisory notes rendered at `step-rx.tsx:55-57`.
- **Recall returns a regimen now removed from `ailment.rxOptions`:** the "Switch to [recalled.drug]" affordance resolves `recalled.drug` against `ailment.rxOptions.find(...)`; if the regimen was removed, the find returns `undefined` and the affordance is hidden (the hint still shows the history as read-only context). The recalled values are never applied to a regimen the wizard cannot express.
- **Multiple prior assessments for the same drug (recurrence):** `ORDER BY created_at DESC LIMIT 1` returns the most recent; earlier ones are not surfaced in NOW (a full history view is #28 longitudinal, LATER).
- **Pharmacist overrides the pre-fill, then re-selects the same drug:** re-selection re-runs `handleSelectRx`, overwriting the manual edit with the pre-fill again. Acceptable (re-selecting a card is an explicit "start over" gesture), but the hint copy should make clear that pre-filled values are starting points. Open Question §7.7 considers preserving manual edits across re-selection.
- **Recall audit on a miss:** `sig.recalled` is written even when the query returns no row (`hit: false`), so PHI-access attempts are traceable regardless of outcome — the *act* of looking up an identified patient is the auditable event, not just the hit.
- **Platform admin access:** explicitly **not** granted to the recall path (mirrors #2 §5.3, #11 §6). Recall is a pharmacist-scoped clinical read; admin analytics over aggregated sig data is #13/#25 (LATER).
- **Performance:** the recall is one indexed `SELECT … LIMIT 1` on the `(patient_id, ailment_slug, created_at DESC)` scan supported by #2's `assessment_patient` index (`persist-assessments-flyio-design.md:158`), plus one `phi_audit_log INSERT`. It fires at most once per step-2 entry + once per drug change. Negligible.

---

## 7. Open Questions

1. **fly.io provisioning + BAA timing (the hard gate for Phase 2).** Inherited verbatim from #2 §7.1: confirm fly.io Postgres is stood up in a **Canadian region** (`yyz`/`yul`) and the BAA is signed before `PHI_PERSIST_ENABLED` flips true. Recall rides the same flag. **Phase 1 (smart-sig) is unblocked and ships independently.**
2. **Curation depth + clinical review.** Should all 80 regimen rows ship curated in the first cut, or a high-frequency subset (UTI, acne, allergic-rhinitis, dysmenorrhea, GERD — the recurrence-heavy ailments) with the rest falling through to generic until curated? Recommend **all 80** (the module is the value; partial curation creates an inconsistent UX), but the curation **must be clinically reviewed by a pharmacist** before launch (soft gate, identical to #6's differentials and #9's citations). Confirm the reviewer + the `src/lib/clinical/sig-defaults.ts` location (reproducible hash for #26).
3. **Per-patient vs. per-pharmacy recall (Option C revisited).** The design chooses per-patient as the higher-value reading of "last-used Rx." Confirm this is preferred over (or in addition to) a per-pharmacy "most common sig" aggregate — the latter is parked as an optional Phase-3 hint reusing the same query plumbing with a `GROUP BY` (§7.8), and properly belongs to #13/#25.
4. **`sig.recalled` Supabase mirror — no.** The recommendation is **no** Supabase event for the recall (it is a PHI access of an identified patient, like #11's `signature.enrolled`). Confirm this is acceptable — it means recall activity is visible only on the fly.io `phi_audit_log`, not the Supabase audit dashboard. (The smart-sig tier emits no event at all, being local computation.)
5. **Drug-string-keyed curation fragility.** Keying `SIG_DEFAULTS` on the exact `data/ailments.json` drug string means a data rephrase orphans the default. The CI guard (plan Task 8) catches this at test time. Alternatively, key on a stable synthetic id — but `RxOption` has no id field (`types/index.ts:1-5`), and adding one is a larger change. Recommend **exact-string keying + CI guard** (YAGNI), consistent with #9's robustness argument.
6. **Should `duration` render on the combined PDF?** `duration` is captured and persisted but not currently rendered in the prescription table (`combined-pdf.tsx:278-283` shows drug/dose/sig/quantity/refills, not duration). #12 populates `duration` for the recall + future use but does **not** change the PDF. Confirm whether a separate ticket should add a Duration column to the PDF — out of scope here.
7. **Re-selection overwriting a manual edit.** Re-selecting a drug card re-runs `handleSelectRx` and overwrites any manual field edit with the pre-fill. Acceptable as "re-select = restart," but confirm; alternatively, track a `userEditedFields` set and preserve manual edits on re-selection (slightly more state, marginal value). Recommend **overwrite** (simplicity) for NOW.
8. **Per-pharmacy "most common sig" aggregate (Phase 3).** Parked for #13 (analytics) / #25 (revenue-leakage): a `SELECT … GROUP BY selected_rx->>'sig' … LIMIT 1` variant surfaced as a secondary hint. Reuses the recall plumbing; not in scope for #12.
9. **Recall for non-prescribed outcomes.** The query filters `outcome = 'prescribed'` (a `referred` or `not_prescribed`/`abandoned` assessment carries no usable sig). Confirm this is right — a `referred` patient who returns prescribed later will recall the prescribed visit, not the referral. Correct.
10. **Multilingual sigs (#24 interaction).** The curated default sigs are English. Roadmap #24 (multilingual patient instructions) is French-first; confirm whether #12's smart-sig module should be structured now for i18n (e.g. `SIG_DEFAULTS[locale]`) or whether #24 retrofits localization onto the English-first module later. Recommend **English-first now**, #24 adds the `fr` map — the keying (`slug::drug`) is locale-agnostic and the hash is computed per-locale.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/clinical/sig-defaults.ts` — versioned/hashed smart-sig defaults module (`SIG_DEFAULTS_VERSION`, `SIG_DEFAULTS`, `getSigDefault`, `sigDefaultKey`, `computeSigDefaultsHash`).
- `src/lib/sig-recall-actions.ts` — `getRecalledSigAction` server action (flag-guarded no-op stub in Phase 1).
- `src/__tests__/sig-defaults.test.ts` — 80-key coverage, every key resolves to a real `(slug, drug)`, hash determinism, graceful null on un-curated/drift.
- `src/__tests__/sig-recall-actions.test.ts` — flag guard (null when off), identity-required guard, store call shape, no-PHI-to-Supabase guard.
- `src/__tests__/step-rx-recall.test.tsx` — recall hint render (same-drug pre-fill, different-drug hint + switch, no-recall hidden), pre-fill precedence.

**Modified:**
- `src/types/index.ts` — add `SigDefault`, `PatientIdentity`, `RecalledSig` types.
- `src/components/wizard/wizard-container.tsx` — `handleSelectRx` resolves recall > smart-sig > generic; `recalled` state + step-2-entry `getRecalledSigAction` trigger; thread `recalled` into `<StepRx>`.
- `src/components/wizard/step-rx.tsx` — `recalled` prop; render the recall hint + "Switch to [drug]" affordance; pass `recalled` into `onSelect` so the same-drug pre-fill applies.
- `src/lib/phi/assessment-store.ts` (from #2) — add `getLastUsedSig` read (pharmacy-scoped, `sig.recalled` audit, every query contains `pharmacy_id`).

**Database (fly.io, PHI, under BAA):** **none.** No new table, no schema change — `getLastUsedSig` reads #2's existing `assessment.selected_rx` + `patient.identity_hash` and writes #2's existing `phi_audit_log` with action `'sig.recalled'` (free-text column, no CHECK per #2 §4.4 → no migration).

**Database (Supabase, non-PHI):** **none.** No new `EventType`, no `log_event` change — the smart-sig tier is local computation and the recall tier is a PHI read on fly.io with no Supabase mirror (§5.1, §7.4).

**Environment (server-only):** **none new** — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.

**Dependencies:** **none** — `node:crypto` (already used by #2/#3/#6/#9/#10/#11) and existing `@/lib` imports only. No new package.
