# Smart Sig Auto-Suggest + Last-Used Rx Recall — Implementation Plan

**Date:** 2026-06-24
**Roadmap item:** #12 (NEXT tier) — "Smart sig auto-suggest + 'last-used Rx' recall per ailment — Fewer clicks per consult"
**Design:** `docs/superpowers/specs/2026-06-24-smart-sig-autosuggest-design.md`
**Status:** Draft (pending review)

---

## Goal

Replace the four hardcoded placeholder values in `handleSelectRx` (`wizard-container.tsx:73-77`: `sig: rx.dose, quantity: "1", refills: "0", duration: ""`) with a precedence-resolved pre-fill — **last-used (patient-specific, Phase 2) → smart-sig default (regimen-specific, Phase 1) → today's generic** — so the pharmacist's job on the Rx step shrinks from "type four fields" to "review and confirm." Delivered as two independent tiers:

- **Phase 1 (fly.io off / BAA unsigned):** a versioned/hashed `src/lib/clinical/sig-defaults.ts` module of curated per-regimen defaults, consumed by `handleSelectRx`. **Ships LIVE** — non-PHI reference content bundled into the client, no database, no BAA, no flag, no server round-trip (the "non-PHI ships live immediately" property from #6/#9/#22/#7-template).
- **Phase 2 (fly.io on / BAA signed / `PHI_PERSIST_ENABLED=true`):** a read-only per-patient recall over #2's `assessment.selected_rx` (`getLastUsedSig` in `assessment-store.ts` + `getRecalledSigAction`), surfaced as a non-intrusive "Last used for this patient" hint on step 2 that overrides the smart-sig default when the recalled drug matches the selection. **No new table, no schema change** — read-only over #2's store, the lightest fly.io footprint of any feature.

---

## Sequenced Steps (each a small, verifiable unit)

### Task 1 — Types

**Modify** `src/types/index.ts` — add the three types from design §4.1:

```ts
export interface SigDefault {
  sig: string
  quantity: string
  refills: string
  duration: string
}

export interface PatientIdentity {
  name: string
  dob: string
  postalCode: string
}

export interface RecalledSig {
  drug: string
  sig: string
  quantity: string
  refills: string
  duration: string
  prescribedAt: string   // ISO timestamp
}
```

**Verify:**
- `npm run typecheck` passes.

### Task 2 — Versioned smart-sig defaults module (Phase 1 core)

**Create** `src/lib/clinical/sig-defaults.ts` (design §4.2): `SIG_DEFAULTS_VERSION = "sig-defaults-v1"`, the `SIG_DEFAULTS` `Readonly<Record<string, SigDefault>>` keyed by `${ailmentSlug}::${drug}` (exact `data/ailments.json` drug strings), `sigDefaultKey(ailmentSlug, drug)`, `getSigDefault(ailmentSlug, drug): SigDefault | null` (returns `null` on miss → caller falls through to generic), and `computeSigDefaultsHash()` via `node:crypto` `createHash("sha256")` over `SIG_DEFAULTS_VERSION` + key-sorted canonical JSON. Pure module, SSR-safe, no side effects.

**Curate all 80 regimen rows** (design §2, the full ailment×drug matrix): acne 7, allergic-rhinitis 7, aphthous-ulcers 1, candidal-stomatitis 1, conjunctivitis 6, dermatitis 9, dysmenorrhea 2, gerd 5, hemorrhoids 5, herpes-labialis 5, impetigo 3, insect-bites-urticaria 5, musculoskeletal 4, nausea-vomiting 3, nvp 4, pinworms 2, tick-bites-lyme 1, uti 4, vvc 6. Derive each `{ sig, quantity, refills, duration }` from the regimen's `dose` + standard Ontario dispensing practice (e.g. `uti::Nitrofurantoin 100 mg` → `{ sig: "Take 1 capsule by mouth twice daily with food", quantity: "10 capsules", refills: "0", duration: "5 days" }`; `acne::Benzoyl peroxide 2.5–5%` → `{ sig: "Apply a thin layer to affected areas twice daily after washing", quantity: "60 g", refills: "2", duration: "8–12 weeks" }`). Representative samples are in design §4.2; the remainder follows the same pattern per regimen.

**Verify:**
- `npm run typecheck` + `npm run lint` pass.
- Unit test `src/__tests__/sig-defaults.test.ts`:
  - `SIG_DEFAULTS_VERSION` is a non-empty string.
  - `getSigDefault("uti", "Nitrofurantoin 100 mg")` returns a `SigDefault` with all four non-empty fields; `getSigDefault("uti", "Does Not Exist")` returns `null`.
  - `computeSigDefaultsHash()` is a 64-char hex string and is deterministic across two calls in one process.
  - **Coverage invariant:** iterate every ailment in `parseAilments(data/ailments)`; assert the count of `SIG_DEFAULTS` keys equals the total `rxOptions` count across all 19 ailments (80) — pins full curation.
  - **Drift guard:** for every `SIG_DEFAULTS` key, assert it resolves to a real `(slug, drug)` pair in the parsed ailments (key = `sigDefaultKey(slug, drug)` for some real `ailment.rxOptions[].drug`) — catches drug-string drift at test time (design §6, §7.5).
  - **No PHI / no placeholders:** no `SIG_DEFAULTS` value field equals `"1"`/`"0"`/`""` (the placeholders this feature replaces) for any curated row.

### Task 3 — Smart-sig wiring into `handleSelectRx` (Phase 1 ships here)

**Modify** `src/components/wizard/wizard-container.tsx:70-78` — `handleSelectRx` imports `getSigDefault` and applies the precedence **recall(null in Phase 1) > smart-sig > generic** (design §4.3). In Phase 1 the `recalled` argument is always `null`, so this resolves to **smart-sig > generic**:

```ts
import { getSigDefault } from "@/lib/clinical/sig-defaults"

function handleSelectRx(rx: Ailment["rxOptions"][number], recalled: RecalledSig | null = null) {
  const smart = getSigDefault(ailment.slug, rx.drug)
  const sameDrugRecall = recalled && recalled.drug === rx.drug ? recalled : null
  const generic = { sig: rx.dose, quantity: "1", refills: "0", duration: "" }
  const base = smart ?? generic
  setSelectedRx({
    ...rx,
    ...(sameDrugRecall
      ? { sig: sameDrugRecall.sig, quantity: sameDrugRecall.quantity,
          refills: sameDrugRecall.refills, duration: sameDrugRecall.duration }
      : base),
  })
}
```

The existing `onSelect={handleSelectRx}` call site (`wizard-container.tsx:136`) is updated to `onSelect={(rx) => handleSelectRx(rx, recalled)}` (the `recalled` state is added in Task 6; for Phase 1 it is `null`).

**Verify:**
- `npm run typecheck` + `npm run lint` + `npm run build` pass.
- Extend `src/__tests__/step-rx.test.tsx` (or a new `wizard-select-rx.test.tsx`): selecting a curated regimen (e.g. `uti::Nitrofurantoin 100 mg`) yields a `SelectedRx` whose `quantity`/`refills`/`duration` equal the curated values (not `"1"`/`"0"`/`""`); selecting an un-curated regimen falls through to `rx.dose`/`"1"`/`"0"`/`""` (byte-identical to today).
- **Phase-1 user-visible value ships here:** every curated regimen's four fields arrive pre-populated with sensible values, with no fly.io/BAA dependency.

### Task 4 — Recall store read (extends #2's `assessment-store.ts`)

**Modify** `src/lib/phi/assessment-store.ts` (from #2's plan) — add `getLastUsedSig({ pharmacyId, identityHash, ailmentSlug, drug }): Promise<RecalledSig | null>` (design §4.4):

- `SELECT a.selected_rx AS rx, a.created_at AS prescribed_at FROM assessment a JOIN patient p ON p.id = a.patient_id WHERE p.pharmacy_id = $1 AND p.identity_hash = $2 AND a.pharmacy_id = $1 AND a.ailment_slug = $3 AND a.outcome = 'prescribed' AND a.selected_rx IS NOT NULL AND a.selected_rx->>'drug' = $4 ORDER BY a.created_at DESC LIMIT 1`.
- On every call (hit or miss), `INSERT INTO phi_audit_log (…, 'sig.recalled', jsonb_build_object('ailment_slug',$,'drug',$,'hit',$))` — the PHI-read audit (free-text `action`, no CHECK per #2 §4.4 → no migration).
- Uses #2's `getPhiPool()` (`src/lib/phi/db.ts`); the caller guards the flag. Every query text contains `pharmacy_id` (CI grep guard). Read-only — no `UPDATE`/`DELETE`.

**Verify:**
- Unit test `src/__tests__/assessment-store-sig-recall.test.ts` (mocked `pg.Pool`):
  - Issues a `SELECT … ORDER BY a.created_at DESC LIMIT 1` whose text contains `pharmacy_id` twice (patient + assessment) and `identity_hash` and `selected_rx->>'drug'`.
  - Returns a `RecalledSig` (with `prescribedAt`) when a row matches; `null` when no row.
  - Writes exactly one `phi_audit_log` row with `action = 'sig.recalled'` on **both** hit and miss (`hit: false` on miss).
  - `rg -n "FROM assessment|JOIN patient|INTO phi_audit_log" src/lib/phi/assessment-store.ts` → every hit line contains `pharmacy_id` (the CI guard, mirroring #2 §5.3).
- `npm run test src/__tests__/assessment-store-sig-recall.test.ts` passes.

### Task 5 — Recall server action

**Create** `src/lib/sig-recall-actions.ts` (`"use server"`, design §4.5):

- `getRecalledSigAction({ ailmentSlug, drug, patient: PatientIdentity }): Promise<RecalledSig | null>` — `requireAuth()` → bail `null` when `!pharmacyId` → **flag guard** (`PHI_PERSIST_ENABLED !== "true"` → `null`, Phase-1 stub) → **identity guard** (`!patient.name || !patient.dob || !patient.postalCode` → `null`, mirrors #2 §6) → `computeIdentityHash(patient)` server-side (salt never sent to client) → `getLastUsedSig({ pharmacyId: profile.pharmacyId, identityHash, ailmentSlug, drug })`.

**Verify:**
- Unit test `src/__tests__/sig-recall-actions.test.ts`:
  - Returns `null` when `PHI_PERSIST_ENABLED` unset (mock `requireAuth` + store; assert the store is **not** called).
  - Returns `null` when any identity field is missing (store not called).
  - When the flag is on and identity complete, calls `getLastUsedSig` with the server-computed `identityHash` (assert the hash is computed via `computeIdentityHash`, not passed through).
- **CI guard grep:** `rg -n "NEXT_PUBLIC" src/lib/sig-recall-actions.ts src/lib/clinical/sig-defaults.ts` → must be empty (no client-exposed secrets).
- `npm run test src/__tests__/sig-recall-actions.test.ts` passes.

### Task 6 — Recall wiring in `WizardContainer` + `StepRx` (Phase 2 ships here)

**Modify** `src/components/wizard/wizard-container.tsx`:
- Add `const [recalled, setRecalled] = useState<RecalledSig | null>(null)`.
- Add a step-2-entry effect: when `step === 2` and identity is complete (`patient.name && patient.dob && patient.postalCode`) and `recalled` is unset for the current selection, call `getRecalledSigAction({ ailmentSlug: ailment.slug, drug: selectedRx?.drug ?? "", patient: { name: patient.name, dob: patient.dob, postalCode: patient.postalCode } })` → `setRecalled`. Re-fire on drug change (one call per selected drug). Skip entirely when the action would no-op (Phase 1) — the action short-circuits to `null`, so no network cost.
- Thread `recalled` into `handleSelectRx` (Task 3) and into `<StepRx recalled={recalled} … />`.

**Modify** `src/components/wizard/step-rx.tsx`:
- Add `recalled?: RecalledSig | null` to `StepRxProps` (design §4.6).
- Above the "Prescription Details" block (`step-rx.tsx:65`), when `recalled` is non-null, render a non-intrusive hint:
  - **Same drug** (`recalled.drug === selectedRx?.drug`): *"Last used for this patient on [date(prescribedAt)]: pre-filled — review and edit."*
  - **Different drug**: *"Previously prescribed [recalled.drug] ([recalled.sig]) on [date]."* + a *"Switch to [recalled.drug]"* button that calls `onSelect(ailment.rxOptions.find(r => r.drug === recalled.drug))` (hidden if the regimen was removed from `ailment.rxOptions`, per design §6).
- No field is disabled; the existing `handleFieldChange` inputs (`step-rx.tsx:21-24, 71-104`) remain fully editable.

**Verify:**
- `npm run typecheck` + `npm run lint` + `npm run build` pass.
- Component test `src/__tests__/step-rx-recall.test.tsx`:
  - `recalled === null` → hint does not render (Phase 1 / first visit).
  - `recalled.drug === selectedRx.drug` → hint renders with the date; the four fields reflect the recalled values (precedence applied in `handleSelectRx`).
  - `recalled.drug !== selectedRx.drug` → hint renders the prior prescription; "Switch to [drug]" button is visible; clicking it selects the recalled regimen (the same-drug path then applies).
  - `recalled.drug` not in `ailment.rxOptions` → "Switch" button hidden; hint still shows history as read-only.
- `npm run test src/__tests__/step-rx-recall.test.tsx` passes.

### Task 7 — Tests (whole-feature + CI guards)

- **Integration:** extend `src/__tests__/step-rx.test.tsx` (or `wizard-select-rx.test.tsx`) to assert the precedence stack end-to-end: (a) Phase 1 (no recall) + curated regimen → smart-sig values; (b) Phase 1 + un-curated regimen → generic (byte-identical to today); (c) Phase 2 + recalled same-drug → recalled values override smart-sig; (d) Phase 2 + recalled different-drug → smart-sig values for the selected drug + history hint.
- **CI guard greps** (added to a `test.concurrent` block or the test file):
  - `rg -n "NEXT_PUBLIC" src/lib/sig-recall-actions.ts src/lib/clinical/sig-defaults.ts` → empty (no client-exposed secrets).
  - `rg -n "FROM assessment|JOIN patient|INTO phi_audit_log" src/lib/phi/assessment-store.ts` → every hit line contains `pharmacy_id`.
  - `rg -n "sig.recalled" src/lib/phi/assessment-store.ts` → the PHI-read audit write exists.
  - `rg -n "selected_rx|selectedRx|sig|quantity|refills|duration" src/lib/audit-actions.ts` → empty (no sig/PHI reference leaks into the Supabase audit path; recall has no Supabase mirror).
  - `rg -n "twilio|resend|node-cron|openai|anthropic" package.json` → unchanged (no new dependency introduced by #12).

**Verify:**
- `npm run test` (full suite) passes.

### Task 8 — Whole-repo verification

- `npm run typecheck` — passes.
- `npm run lint` — passes.
- `npm run test` — passes (all new + existing tests).
- `npm run build` — passes; the smart-sig module is SSR-safe (pure TS, no `window`).
- `rg -n "quantity: \"1\"|refills: \"0\"|duration: \"\"" src/components/wizard/wizard-container.tsx` → returns only the `generic` fallback object (design §4.3), never the primary pre-fill path — confirming the placeholders are gone from the happy path.

---

## Files to Create / Modify (consolidated, real paths)

**Create:**
- `src/lib/clinical/sig-defaults.ts`
- `src/lib/sig-recall-actions.ts`
- `src/__tests__/sig-defaults.test.ts`
- `src/__tests__/assessment-store-sig-recall.test.ts`
- `src/__tests__/sig-recall-actions.test.ts`
- `src/__tests__/step-rx-recall.test.tsx`
- (`src/__tests__/wizard-select-rx.test.tsx` — if a dedicated wizard-level test is preferred over extending `step-rx.test.tsx`)

**Modify:**
- `src/types/index.ts` — add `SigDefault`, `PatientIdentity`, `RecalledSig`.
- `src/components/wizard/wizard-container.tsx` — `handleSelectRx` precedence resolution; `recalled` state + step-2-entry recall trigger; thread `recalled` into `<StepRx>` and `onSelect`.
- `src/components/wizard/step-rx.tsx` — `recalled` prop; recall hint + "Switch to [drug]" affordance.
- `src/lib/phi/assessment-store.ts` (from #2) — add `getLastUsedSig` read + `sig.recalled` audit.

**No PDF change** (`combined-pdf.tsx`, `referral-pdf.tsx` untouched — the four fields already render at `combined-pdf.tsx:278-283`; #12 changes only what populates them).
**No `audit-actions.ts` change** (no new Supabase `EventType` — recall is a PHI read on fly.io with no Supabase mirror; smart-sig is local computation).
**No `package.json` change** (no new dependency — `node:crypto` + existing `@/lib` imports only).

---

## Data / DB Changes

**fly.io Postgres (PHI, under BAA):** **none.** No new table, no `ALTER TABLE`, no new column, no migration. `getLastUsedSig` reads #2's existing `assessment.selected_rx` (jsonb) + `patient.identity_hash` and writes #2's existing `phi_audit_log` with `action = 'sig.recalled'` (the `action` column is free-text with no CHECK constraint per #2 §4.4, so a new action value needs no DDL).

**Supabase (non-PHI):** **none.** No new `audit.event_type`, no `log_event` validation change. The smart-sig tier emits no event (local computation); the recall tier is a PHI read on fly.io and has **no Supabase mirror** (design §5.1, §7.4) — mirroring a recall event to the non-PHI log would itself leak that an identified patient was looked up.

**Environment (server-only):** **none new** — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`. `PHI_IDENTITY_SALT` remains server-only (never `NEXT_PUBLIC_`); the client sends plaintext identity over the Server Action boundary and receives only `RecalledSig | null`.

---

## Tests

- **Unit:** `sig-defaults.test.ts` (version, `getSigDefault` hit/miss, hash determinism, **80-key coverage invariant**, **drift guard** every key resolves to a real `(slug, drug)`, no placeholder values), `assessment-store-sig-recall.test.ts` (recall SQL shape + `pharmacy_id`/`identity_hash`/`drug` filters, `LIMIT 1`, `sig.recalled` audit on hit **and** miss, `pharmacy_id` CI guard), `sig-recall-actions.test.ts` (flag guard → null + store uncalled, identity guard → null + store uncalled, server-side `computeIdentityHash`, no `NEXT_PUBLIC`).
- **Component:** `step-rx-recall.test.tsx` (hint hidden when `recalled === null`; same-drug pre-fill + date hint; different-drug hint + "Switch" button; removed-regimen hides "Switch").
- **Integration:** wizard-level precedence assertions (smart-sig > generic in Phase 1; recalled > smart-sig in Phase 2 same-drug; recalled different-drug keeps smart-sig + hint).
- **CI guard greps:** no `NEXT_PUBLIC` in #12 modules; every `assessment`/`patient`/`phi_audit_log` query contains `pharmacy_id`; `sig.recalled` audit exists; no sig/PHI reference in `audit-actions.ts`; no new dependency in `package.json`.

---

## Verification Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build

# Guard greps (expected: empty / the asserted pattern)
rg -n "NEXT_PUBLIC" src/lib/sig-recall-actions.ts src/lib/clinical/sig-defaults.ts                       # must be empty
rg -n "FROM assessment|JOIN patient|INTO phi_audit_log" src/lib/phi/assessment-store.ts                  # every line has pharmacy_id
rg -n "sig.recalled" src/lib/phi/assessment-store.ts                                                     # the PHI-read audit write
rg -n "selected_rx|selectedRx|quantity|refills|duration" src/lib/audit-actions.ts                        # must be empty (no PHI in Supabase audit path)
rg -n "twilio|resend|node-cron|openai|anthropic" package.json                                            # unchanged
rg -n "quantity: \"1\"|refills: \"0\"|duration: \"\"" src/components/wizard/wizard-container.tsx          # only the generic fallback, not the happy path
```

---

## Rollout Notes

- **Hard gate (blocks Phase 2 only):** signed fly.io BAA (roadmap §7 #2) + `PHI_PERSIST_ENABLED=true`, inherited from #2. Until these land, **Phase 1 ships independently and delivers the headline value** (curated smart-sig defaults pre-fill the four fields for all 80 regimens) with no gating dependency — the same "non-PHI ships live immediately" property #6/#9/#22 established.
- **Soft gates (review, not blocking):**
  - **Clinical review of the 80 curated defaults** (`src/lib/clinical/sig-defaults.ts`) by a pharmacist before launch — these are medico-legal free-text starting points on every prescription (identical review discipline to #6's differentials and #9's citations). The quantity/duration values reflect standard Ontario dispensing practice but must be confirmed for the pharmacy's formulary/pack sizes.
  - Confirm the per-patient (vs. per-pharmacy-aggregate) reading of "last-used Rx" (design §7.3) — per-patient is the higher-value implementation; the per-pharmacy aggregate is parked for #13/#25.
  - Confirm no Supabase mirror for `sig.recalled` (design §7.4) — recall activity is visible only on the fly.io `phi_audit_log`.
- **No flag of its own:** #12 reuses #2's `PHI_PERSIST_ENABLED` exactly as #1/#3/#4/#7/#10/#11/#22 do — no new env var, no new ops surface. The smart-sig tier needs no flag at all (it is static client content).
- **No new dependency:** `node:crypto` (already in use across #2/#3/#6/#9/#10/#11) and existing `@/lib` imports only — `package.json` is unchanged.
- **Sibling coordination:** the recall reads #2's `assessment.selected_rx`, so #12's Phase 2 is strictly downstream of #2 going live. #4 (`refusal-non-prescribe-docs`) widens the `outcome` enum to include `not_prescribed`; the recall query filters `outcome = 'prescribed'`, so non-prescribed assessments are correctly excluded (a `not_prescribed` visit carries no sig to recall). #5 (`stop-duplicating-pms-data`) does not affect #12 (the slimmed `PatientInfo` still carries `name`/`dob`/`postalCode`, which are the only identity inputs recall needs). #7 (AI-drafted notes) and #11 (e-signature) are independent of #12 and vice-versa.
- **Phase-1 user-visible value:** with fly.io dark, every curated regimen's four Rx fields arrive pre-populated with clinically-sensible values instead of `"1"`/`"0"`/`""` — the roadmap #12 headline ("fewer clicks per consult") is realized immediately. The patient-specific recall is the Phase-2 deepening for the recurrence case (UTI, acne, allergic-rhinitis, dysmenorrhea).
