# Multilingual Patient Instructions (FR-first) — Implementation Plan

**Date:** 2026-06-24
**Roadmap item:** #24 (NEXT tier)
**Spec:** `docs/superpowers/specs/2026-06-24-multilingual-patient-instructions-design.md`
**Status:** Draft (pending review)

---

## Goal

Turn the spec into build-ready, sequenced, verifiable tasks that add a bilingual (EN/FR/Both) Patient Instructions handout PDF generated alongside the existing Combined Prescription PDF on `step-generate.tsx`, backed by a versioned/hashed `src/lib/i18n/patient-instructions.ts` FR corpus, shipping **live in Phase 1** with no new dependency, no database change, no flag, and no BAA.

Every task is a small, independently-verifiable unit. Each names real file paths, the exact symbols touched, and how to verify it. The plan is split into a **Phase-1 shippable tier** (Tasks 1–7, 9–10) that delivers the full FR-first patient-handout value with zero infrastructure, and a **Phase-2 (post-#2) audit-wiring tier** (Task 8) that is a no-op stub until roadmap #2 provisions fly.io and the `pdf.generated` event gains a call site.

---

## Sequenced Steps

### Task 1 — Types + the FR corpus module skeleton + hash

**Create** `src/lib/i18n/patient-instructions.ts` with:
- `export type Language = "en" | "fr"` (extensible comment for `es|zh|tl|ar|pa`).
- `export const PATIENT_INSTRUCTIONS_VERSION = "patient-instructions-fr-v1"`.
- Interfaces: `RegimenDirections { fr: string }`, `AilmentPatientInstructions { followUpFr: string; nonRxFr: string[]; directionsByDrug: Record<string, RegimenDirections> }`.
- `export const PATIENT_INSTRUCTIONS_FR: Record<string, AilmentPatientInstructions>` — populate **at minimum** the Phase-1 launch set per spec §7.3: `uti`, `acne`, `allergic-rhinitis`, `dermatitis`, `gerd`, `dysmenorrhea`, `conjunctivitis` (7 ailments). For each: a `followUpFr` translation of `data/ailments.json`'s `followUp`, a `nonRxFr` array **positionally aligned** to the EN `nonRx` array (same length, same order), and a `directionsByDrug` entry keyed on the **exact** drug string for every regimen in that ailment (use #12's census: UTI 4, acne 7, allergic-rhinitis 7, dermatitis 9, gerd 5, dysmenorrhea 2, conjunctivitis 6 = 40 regimen entries). French must be clinically accurate Canadian French; mark a `// REVIEW: bilingual pharmacist` comment on every string.
- `export function getPatientInstructions(slug: string, language: Language): AilmentPatientInstructions | undefined` — returns `undefined` for `"en"` (EN is the source of truth in `data/ailments.json`) and for any un-curated slug.
- `export function getFrDirections(slug: string, drug: string): string | undefined` — `PATIENT_INSTRUCTIONS_FR[slug]?.directionsByDrug?.[drug]?.fr`.
- `export function computePatientInstructionsHash(): string` — `createHash("sha256").update(PATIENT_INSTRUCTIONS_VERSION).update(JSON.stringify(PATIENT_INSTRUCTIONS_FR)).digest("hex")`.
- The universal safety-net sentence (spec §7.7) as a module constant: `export const SAFETY_NET_FR = "Consultez un médecin ou appelez le 811 si vous avez de la fièvre, si vos symptômes s'aggravent ou s'ils ne s'améliorent pas."` plus an EN twin `SAFETY_NET_EN`.

**Verify:** `npx tsc --noEmit` passes; `node -e "console.log(require('./src/lib/i18n/patient-instructions.ts'.replace('.ts','')))"` is not runnable directly (TS), so verify via the Task 3 tests instead. Confirm `PATIENT_INSTRUCTIONS_FR` keys are ailment slugs that exist in `data/ailments.json` (cross-check with `src/lib/ailments.ts:4`).

**No dependency added.** `node:crypto` is built-in (already used by #2/#6/#9/#10/#12 content modules).

---

### Task 2 — The Patient Instructions PDF component

**Create** `src/components/patient-instructions-pdf.tsx` — an `@react-pdf/renderer` `<Document>` rendering a **patient handout** (not a clinical record). Structure per spec §4.2:
- `fontSize: 10–11`, `fontFamily: "Helvetica"`, single-column, patient-friendly register, generous padding (contrast the Combined PDF's 7.5/dense/medico-legal).
- Props interface `PatientInstructionsPdfProps { ailment: Ailment; selectedRx: SelectedRx; nonRxChecked: string[]; pharmacy: PharmacyDefaults | null; language: Language | "both"; dateOfAssessment: string }`.
- Renders **one `<Page>` per language**: `"en"` → EN page; `"fr"` → FR page; `"both"` → EN page then FR page in the same `<Document>`.
- **EN page** sources from `ailment.followUp` / `ailment.nonRx` (via `filterCheckedItems` from `src/lib/pdf-filter.ts:1`) / `selectedRx.sig` directly — EN is never duplicated in the i18n module (spec §7.11).
- **FR page** sources from `getPatientInstructions(ailment.slug, "fr")`: `followUpFr`, `nonRxFr[i]` for each checked `nonRxChecked` item (resolve the FR index by matching the checked EN string against `ailment.nonRx`), and `getFrDirections(ailment.slug, selectedRx.drug)` for the directions.
- **The sig-translation invariant (spec §4.3):** compute `const canonicalFr = getFrDirections(...)`; render on the FR page EITHER `canonicalFr` (if it exists AND the pharmacist's `selectedRx.sig` matches the regimen default — divergence detection per spec §6 case 3) OR `selectedRx.sig` verbatim with the FR note `"Demandez à votre pharmacien de vous expliquer les directives en français."`. **Never** an MT, never a third path. Add an inline code comment pointing to spec §4.3.
- Sections per spec §4.2: title block (ailment name FR/EN + pharmacy name + date), "Your medication / Votre médicant" (drug + directions), "How to care for yourself / Soins à domicile" (checked non-Rx), "When to come back / Quand consulter à nouveau" (followUp), "When to seek help / Quand consulter un médecin" (universal `SAFETY_NET_*`), patient-friendly footer (pharmacy name + phone + "Questions? Ask your pharmacist / Questions? Adressez-vous à votre pharmacien"). **No PHIPA footer** (patient education, not a record). **No patient name** by default (spec §6 case 9, §7.10).

**Verify:** `npx tsc --noEmit`; the component imports only `@react-pdf/renderer`, `@/types`, `@/lib/pdf-filter`, `@/lib/i18n/patient-instructions` — `rg -n "from" src/components/patient-instructions-pdf.tsx` shows exactly these four.

---

### Task 3 — Module unit tests

**Create** `src/__tests__/patient-instructions.test.ts` covering:
- **Hash determinism:** `computePatientInstructionsHash()` returns the same 64-hex string across two calls in the same process; bumps when any FR string changes (mutate a string, re-call, assert differs).
- **Version exposed:** `PATIENT_INSTRUCTIONS_VERSION` matches `/^patient-instructions-fr-v\d+$/`.
- **Positional-alignment invariant (spec §4.1):** for every slug in `PATIENT_INSTRUCTIONS_FR`, `nonRxFr.length === ailment.nonRx.length` where `ailment = getAilmentBySlug(slug)` from `src/lib/ailments.ts:6`. Fails loudly if a `data/ailments.json` `nonRx` edit drops/adds an item without a corresponding FR update.
- **Key-coverage invariant (spec §4.1, reuses #12's lesson):** for every `(slug, drug)` key in `PATIENT_INSTRUCTIONS_FR[slug].directionsByDrug`, the drug string exists in `getAilmentBySlug(slug).rxOptions.map(r => r.drug)`. Catches a data rephrase orphaning the FR entry.
- **Slug validity:** every key in `PATIENT_INSTRUCTIONS_FR` resolves via `getAilmentBySlug` (no typo'd slugs).
- **Graceful undefined:** `getPatientInstructions("acne", "en")` returns `undefined`; `getPatientInstructions("nonexistent-slug", "fr")` returns `undefined`; `getFrDirections("uti", "Nonexistent Drug")` returns `undefined`.
- **Phase-1 launch coverage:** assert the 7 launch slugs (`uti`, `acne`, `allergic-rhinitis`, `dermatitis`, `gerd`, `dysmenorrhea`, `conjunctivitis`) are present with non-empty `followUpFr` and `nonRxFr.length > 0`.

**Verify:** `npx vitest run src/__tests__/patient-instructions.test.ts` — all green.

---

### Task 4 — Component tests for the handout PDF

**Create** `src/__tests__/patient-instructions-pdf.test.tsx` covering (using `@testing-library/react` + the existing vitest/jsdom setup already in `package.json`):
- **EN render:** `<PatientInstructionsPdf language="en" ailment={utiFixture} selectedRx={nitroFixture} nonRxChecked={[...]} pharmacy={pharmFixture} dateOfAssessment="2026-06-24" />` renders the EN `followUp`, the checked EN `nonRx` items, and the EN `selectedRx.sig` verbatim. Assert the `SAFETY_NET_EN` string appears.
- **FR render:** with `language="fr"` for a curated slug, renders `followUpFr`, the resolved `nonRxFr[i]` items, and the canonical FR directions (`getFrDirections`). Assert `SAFETY_NET_FR` appears.
- **Both render:** `language="both"` renders both the EN and FR safety-net strings (proving two pages' content co-exist in the document tree).
- **Sig-translation §4.3 invariant — fallback case:** with `selectedRx.sig` set to a custom value that differs from the regimen default, the FR page renders the EN sig verbatim AND the "Demandez à votre pharmacien" note, and does NOT render the canonical FR block (the divergence path). This is the patient-safety test.
- **Sig-translation §4.3 invariant — canonical case:** with `selectedRx.sig` equal to the regimen default, the FR page renders the canonical FR block (no EN sig, no fallback note).
- **Untranslated ailment fallback:** `language="fr"` for a slug NOT in `PATIENT_INSTRUCTIONS_FR` renders gracefully (the parent UI in Task 6 disables this, but the component must not throw if called directly) — assert it renders the EN content with no crash.
- **No PHI in rendered audit metadata:** a grep-style assertion that the component file does not emit any `ailment`/`drug`/`sig`/`name` keys to an audit call — verified in Task 8's CI guard, but a unit assertion here confirms the component itself carries no audit-emit code path.

**Fixtures:** define minimal `utiFixture`, `nitroFixture`, `pharmFixture` in the test file (or import from a shared fixtures module if one exists — check `src/__tests__/` for an existing pattern; the repo has `combined-pdf-txid.test.tsx` to mirror).

**Verify:** `npx vitest run src/__tests__/patient-instructions-pdf.test.tsx` — all green.

---

### Task 5 — The language toggle UI on the generate step

**Modify** `src/components/wizard/step-generate.tsx`:
- Import `PatientInstructionsPdf` and `Language` + `getPatientInstructions` from `@/lib/i18n/patient-instructions`.
- Add `const [handoutLanguage, setHandoutLanguage] = useState<Language | "both">("en")`.
- Add a second card below the existing "Assessment Summary" card: a "Patient Handout" card with:
  - A three-way segmented control (EN / FR / Both) using existing shadcn primitives + `lucide-react` icons (e.g. `Languages`). The `FR` and `Both` options are **disabled** with a tooltip "French version coming soon" when `getPatientInstructions(ailment.slug, "fr") === undefined` (spec §6 case 1).
  - A "Download Patient Instructions" `<Button>` that constructs `<PatientInstructionsPdf ailment={ailment} selectedRx={selectedRx} nonRxChecked={nonRxChecked} pharmacy={pharmacy ?? null} language={handoutLanguage} dateOfAssessment={handoutDate} />` and calls `downloadPdf(doc, \`patient-instructions-${handoutDate}.pdf\`)` (reusing `src/lib/pdf-helpers.ts:5`).
- Compute `const handoutDate = new Date().toLocaleDateString(handoutLanguage === "fr" ? "fr-CA" : "en-CA")` — locale-formatted for the handout only. The existing `dateOfAssessment` at `step-generate.tsx:23` (used for the Combined PDF) stays `"en-CA"` (the clinical record is EN for NOW).
- Leave the existing "Download Prescription + Doctor Notification PDF" button (`:75-77`) and its `reserveTxId` path (`:26-34`) **completely unchanged**. The handout download does NOT call `reserveTxId` — the handout is not a prescription (spec §6 case 6).

**Verify:** `npx tsc --noEmit`; `npm run dev` → navigate to `/assess/uti`, complete the wizard to step 3, confirm the "Patient Handout" card appears, the toggle switches EN/FR/Both, FR is enabled for UTI (curated), and clicking "Download Patient Instructions" downloads a PDF. Manually inspect the PDF: FR page shows French follow-up, French self-care, canonical FR directions, French safety-net, no patient name, no PHIPA footer.

---

### Task 6 — Tests for the generate-step toggle wiring

**Create or extend** a `step-generate` test (check `src/__tests__/` for an existing `step-generate.test.tsx`; if none, create one mirroring `combined-pdf-txid.test.tsx`'s setup):
- **Toggle renders:** the "Patient Handout" card and the EN/FR/Both segmented control render for a curated ailment (UTI).
- **FR disabled for un-curated ailment:** for a slug not in `PATIENT_INSTRUCTIONS_FR` (e.g. `pinworms` if not yet translated), the FR and Both options are disabled.
- **No tx-id consumption on handout download:** spy on `reserveTxId` (mock `@/lib/prescription-actions`); clicking "Download Patient Instructions" does NOT call `reserveTxId`, while clicking "Download Prescription + Doctor Notification PDF" DOES. This protects the spec §6 case 6 invariant.
- **`downloadPdf` called with `PatientInstructionsPdf`:** mock `@/lib/pdf-helpers` and assert the handout download invokes it with a `<PatientInstructionsPdf>` element carrying the selected language.

**Verify:** `npx vitest run` for the step-generate test — all green.

---

### Task 7 — Backfill the remaining 12 ailments in the FR corpus

**Modify** `src/lib/i18n/patient-instructions.ts`: add `PATIENT_INSTRUCTIONS_FR` entries for the remaining 12 slugs (`aphthous-ulcers`, `candidal-stomatitis`, `hemorrhoids`, `herpes-labialis`, `impetigo`, `insect-bites-urticaria`, `musculoskeletal`, `nausea-vomiting`, `nvp`, `pinworms`, `tick-bites-lyme`, `vvc`) — each with `followUpFr`, positionally-aligned `nonRxFr`, and `directionsByDrug` for every regimen in that ailment. Bump `PATIENT_INSTRUCTIONS_VERSION` to `"patient-instructions-fr-v2"` (any corpus edit changes the hash; the version bump makes the change grep-able in git/deploy logs).

This is the largest single task by string volume (~110 follow-up + non-Rx strings + ~40 regimen directions = ~150 strings), but it is pure data, no logic, and is parallelisable across reviewers. Each string carries a `// REVIEW:` comment for the bilingual pharmacist sign-off (spec §7.2 soft gate).

**Verify:** re-run Task 3's tests — the positional-alignment invariant and key-coverage invariant now cover all 19 slugs; the Phase-1 launch-coverage test is updated (or removed, since all 19 are now present). `npx vitest run src/__tests__/patient-instructions.test.ts` — all green.

---

### Task 8 — `pdf.generated` audit emit (no-op stub until #2 ships) [Phase 2 / post-#2]

**Modify** `src/components/wizard/step-generate.tsx` (the handout download path from Task 5): after `downloadPdf` resolves, call `logAuditEvent("pdf.generated", { tx_id: txId ?? "", document_type: "patient_instructions", language: handoutLanguage }, "assessment", undefined)` from `@/lib/audit-actions.ts:20`.

**Stub discipline (spec §4.4, §6 case 10):** in Phase 1, #2's `PHI_PERSIST_ENABLED` is off and `pdf.generated` has no call site. Two acceptable Phase-1 behaviours:
- (a) Emit unconditionally — `logAuditEvent` already swallows errors in its `try/catch` (`audit-actions.ts:26-34`), so if the `log_event` RPC rejects (e.g. `document_type`/`language` keys not yet in the `log_event` CHECK validation), the handout download still succeeds. Safe.
- (b) Gate behind `PHI_PERSIST_ENABLED` — emit only when #2 is live, matching every other feature's stub-behind-flag pattern.

**Recommend (a)** for this feature specifically, because the audit event is non-PHI (`{tx_id, document_type, language}` — all non-identifying per spec §5.3) and the emit failing closed would lose observability for no privacy gain. But coordinate with #2's `log_event` CHECK tightening (which must allow `document_type` and `language` in the `pdf.generated` metadata) — if #2's CHECK rejects unknown keys, switch to (b) until the CHECK is widened. **This task is blocked on #2's `log_event` validation landing**; until then the emit is a best-effort no-op (the `try/catch` makes it safe).

**Verify:** `rg -n "pdf.generated" src/` shows the new call site in `step-generate.tsx` alongside whatever #2 added for the Combined PDF. The audit metadata object contains **only** `{ tx_id, document_type, language }` — no ailment, no drug, no sig, no patient key (spec §5.3).

---

### Task 9 — CI guard greps

**Add** to the repo's CI/lint workflow (or document in `AGENTS.md` / a new `.github/workflows/` step if the pattern exists — check the repo for an existing guard-grep convention from #6/#9/#10/#12; if none is committed, document these as manual `rg` commands in the PR description). The guards:

1. **No MT / translator dependency:** `rg -n "deepl|google.*translate|azure.*translator|i18next|next-intl|react-intl" src/ package.json` → must return **zero** matches (spec §3 Option C rejected; no i18n library introduced).
2. **No new dependency:** `git diff main -- package.json` → empty (the feature reuses `@react-pdf/renderer`, `node:crypto`, shadcn, `lucide-react` only).
3. **No PHI in audit metadata:** `rg -n "logAuditEvent.*pdf.generated" src/components/wizard/step-generate.tsx` → the metadata object literal on that line contains only `tx_id`, `document_type`, `language` keys (manual review or a tighter `rg` for `ailment|drug|sig|patientName` on the same line → must be empty).
4. **Sig-translation invariant (spec §4.3):** `rg -n "translate|mt|machine" src/components/patient-instructions-pdf.tsx` → zero matches (no MT call site exists in the handout component).
5. **No patient-name default in handout:** `rg -n "patient.name" src/components/patient-instructions-pdf.tsx` → zero matches by default (spec §6 case 9; the handout does not embed the patient name unless Open Question §7.10 resolves to add it behind a flag).

**Verify:** run all five `rg` commands locally; all return zero (or the expected single-call-site for guard 3).

---

### Task 10 — Full verification + rollout notes

**Run the complete verification suite:**
- `npx tsc --noEmit` — typecheck clean.
- `npm run lint` — ESLint clean (the new files follow existing import order / naming conventions; check `eslint-config-next` rules).
- `npm run test` — all vitest suites green (Tasks 3, 4, 6 + the existing `combined-pdf-txid.test.tsx` still passes, proving no regression on the Combined PDF path).
- `npm run build` — production build succeeds (the new `patient-instructions-pdf.tsx` is `@react-pdf/renderer`-compatible in the client bundle; `step-generate.tsx` is `"use client"` already).
- Manual E2E in `npm run dev`: `/assess/uti` → complete wizard → step 3 → toggle EN/FR/Both → download each → visually inspect the three PDFs (EN-only handout, FR-only handout, two-page Both handout). Confirm: FR page has French throughout, canonical FR directions, French safety-net, no patient name, no PHIPA footer, no MT artifacts. `/assess/pinworms` (if still un-curated after Task 7) → confirm FR/Both disabled with tooltip.

**Rollout notes:**
- **No feature flag needed.** The feature is additive UI + non-PHI reference content; it ships live immediately. The FR/Both options auto-disable for un-curated ailments, so a partial corpus (Task 1's 7-ailment launch set) ships safely and backfills via Task 7 without redeployment ceremony.
- **Soft gate — bilingual pharmacist / translator review of the FR corpus (spec §7.2).** Every string carries a `// REVIEW:` comment; the review sign-off (reviewer name + date per string or per-ailment) feeds #26 (governance). The `PATIENT_INSTRUCTIONS_VERSION` + `computePatientInstructionsHash()` pin the reviewed corpus in the build.
- **Soft gate — pharmacist/clinical review of the universal safety-net sentence (spec §7.7).** The single generic FR/EN "seek help if fever/worsening" sentence is the one net-new clinical string; confirm wording with a pharmacist before launch.
- **Soft gate — AODA AA for the on-screen toggle (spec §7.6).** Verify keyboard navigation + screen-reader labels on the segmented control (shadcn primitives should satisfy this; manual check).
- **Hard gate — none.** No BAA, no fly.io, no Supabase migration, no provider procurement. The feature is unblocked the moment the FR corpus is reviewed.
- **Forward-compat:** the `Language` type + module shape extend to Mandarin/Punjabi/Tagalog/Arabic/Spanish (spec §6 case 12) without restructuring — add a `PATIENT_INSTRUCTIONS_ZH` map, extend `getPatientInstructions`, add locale strings. RTL layout for Arabic is the only non-trivial addition (@react-pdf/renderer flex-direction; LATER).

---

## Files to Create / Modify (consolidated)

**Create:**
- `src/lib/i18n/patient-instructions.ts` (Task 1, extended in Task 7)
- `src/components/patient-instructions-pdf.tsx` (Task 2)
- `src/__tests__/patient-instructions.test.ts` (Task 3)
- `src/__tests__/patient-instructions-pdf.test.tsx` (Task 4)
- A step-generate test file if none exists (Task 6) — else extend `src/__tests__/step-generate.test.tsx`

**Modify:**
- `src/components/wizard/step-generate.tsx` (Tasks 5, 8) — add Patient Handout card + language toggle + handout download + `pdf.generated` audit emit
- `src/__tests__/combined-pdf-txid.test.tsx` or sibling (Task 6) — add the no-tx-id-consumed assertion for the handout download

**Not modified (explicitly):** `combined-pdf.tsx`, `referral-pdf.tsx`, `wizard-container.tsx`, `step-rx.tsx`, `step-redflags.tsx`, `step-patient.tsx`, `src/lib/ailments.ts`, `data/ailments.json`, `src/lib/audit-actions.ts` (reuses `pdf.generated`), `package.json`, any fly.io/Supabase migration.

---

## Data / DB Changes

**None.** This is the defining property of Option A (spec §4.6):
- No fly.io migration (no PHI persisted by this feature; the handout is a transient client-rendered artefact).
- No Supabase table or column (no per-pharmacy language preference in NOW — spec §7.5 defers this).
- No new `EventType` (reuses `pdf.generated` at `audit-actions.ts:17`; the metadata `{document_type, language}` is validated by #2's `log_event` CHECK, not by a union change).
- No new RPC.

The only schema-adjacent dependency is **#2's `log_event` CHECK validation must permit `document_type` and `language` keys in `pdf.generated` metadata** (Task 8). If #2's CHECK is restrictive, either widen it (a #2-side change, coordinated) or gate the emit behind `PHI_PERSIST_ENABLED` (Task 8 option b). This is the single cross-feature coordination point.

---

## Tests

- **Module tests** (Task 3): `src/__tests__/patient-instructions.test.ts` — hash determinism, version shape, positional-alignment invariant, key-coverage invariant, slug validity, graceful-undefined, Phase-1 launch coverage.
- **Component tests** (Task 4): `src/__tests__/patient-instructions-pdf.test.tsx` — EN/FR/Both render, sig-translation §4.3 invariant (canonical + fallback cases), untranslated-ailment fallback, safety-net strings.
- **Wiring tests** (Task 6): step-generate test — toggle render, FR-disabled-for-un-curated, no-tx-id-consumed-on-handout, `downloadPdf` called with `PatientInstructionsPdf`.
- **Regression:** existing `src/__tests__/combined-pdf-txid.test.tsx` continues to pass (the Combined PDF path is untouched).
- **CI guards** (Task 9): five `rg` greps enforcing no-MT, no-new-dependency, no-PHI-in-audit, sig-translation-invariant, no-patient-name-default.

---

## Verification Commands

```bash
# Typecheck
npx tsc --noEmit

# Lint
npm run lint

# All tests
npm run test

# Targeted test runs during development
npx vitest run src/__tests__/patient-instructions.test.ts
npx vitest run src/__tests__/patient-instructions-pdf.test.tsx

# Production build
npm run build

# Manual E2E
npm run dev   # then /assess/uti → wizard → step 3 → toggle EN/FR/Both → download

# CI guard greps (Task 9)
rg -n "deepl|google.*translate|azure.*translator|i18next|next-intl|react-intl" src/ package.json   # expect 0
git diff main -- package.json                                                                       # expect empty
rg -n "ailment|drug|sig|patientName" src/components/wizard/step-generate.tsx                        # audit-metadata line review
rg -n "translate|mt|machine" src/components/patient-instructions-pdf.tsx                            # expect 0
rg -n "patient.name" src/components/patient-instructions-pdf.tsx                                    # expect 0
```

---

## Rollout Notes

- **Phase 1 (ships immediately, no gate):** Tasks 1–7, 9–10. FR corpus for the launch set (Task 1: 7 ailments) backfilled to all 19 (Task 7). The feature is live the moment the corpus is reviewed; FR/Both auto-disable for any ailment not yet curated, so partial rollout is safe.
- **Phase 2 (post-#2, no-op until then):** Task 8 — the `pdf.generated { tx_id, document_type, language }` audit emit lights up when #2's persistence layer and `log_event` CHECK validation land. Until then the emit is a safe no-op (the `try/catch` in `audit-actions.ts:26-34` swallows any rejection).
- **No feature flag, no BAA, no fly.io, no Supabase migration, no new dependency, no provider procurement.** The feature is unblocked by clinical review of the FR corpus alone — the lightest-infrastructure NEXT-tier feature alongside #6 (differentials) and #9 (citations), consistent with the "non-PHI reference content ships live in Phase 1" pattern now established across #6/#9/#22/#12 and #24.
