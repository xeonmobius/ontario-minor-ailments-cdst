# AI-Drafted Assessment Notes (SOAP) — Implementation Plan

**Date:** 2026-06-24
**Roadmap item:** #7 (NEXT tier)
**Spec:** `docs/superpowers/specs/2026-06-24-ai-drafted-notes-design.md`

---

## Goal

Auto-draft a structured **SOAP** clinical note from the wizard's already-collected state, present it for mandatory pharmacist review/edit on the terminal step, and route the accepted note onto the PDF and the persisted record. Delivered in two tiers: a **deterministic SOAP template engine** (`src/lib/notes/soap-template.ts`) that ships **live in Phase 1** (local computation, no PHI disclosure, no flag), and an **optional BAA-gated LLM enhancement** (`src/lib/notes/actions.ts`, behind `AI_NOTES_ENABLED`) that refines the template draft via a PII-stripped payload to a BAA'd provider — degrading to the template when off/unconfigured/failed so the pharmacist is never blocked.

The plan is ordered so the **template tier (Tasks 1–6) is independently shippable and verifiable** before any AI/infra work: after Task 6 the feature already saves the pharmacist the 60–90s typing burden with zero PHI disclosure and zero new infrastructure. The **AI tier (Tasks 7–9)** is additive and lands behind a default-off flag.

---

## Sequenced Steps

### Task 1 — Types for the note model

**Modify** `src/types/index.ts` — add a provider union and two optional fields on `AssessmentData` (`types/index.ts:59-67`):

```ts
export type NoteProvider = "manual" | "template" | "azure-openai" | "bedrock-claude"

export interface AssessmentData {
  // …existing fields unchanged…
  soapNote?: string            // pharmacist-accepted SOAP note; renders on PDF + persists (fly.io)
  noteProvider?: NoteProvider  // origin of soapNote; persists to assessment.note_provider; feeds #14/#26
}
```

`assessmentNotes` (`types/index.ts:64`) is **untouched** — it remains the step-1 free-text observations and becomes a Subjective *input* to the draft.

**Verify:** `npx tsc --noEmit` green; the new names do not collide (confirmed by reading `types/index.ts:1-118`).

---

### Task 2 — The deterministic SOAP template engine

**Create** `src/lib/notes/soap-template.ts` (spec §4.1–§4.2). Pure, synchronous, zero-dependency. Exports `SoapDraftInput`, `SoapNote`, `NOTES_TEMPLATE_VERSION`, and `buildSoapNote(input)`. The assembler maps the wizard state into the four sections:

- **Subjective:** `encounterType` + `symptomsChecked` + `assessmentNotes`.
- **Objective:** `ailmentName` + red-flag screen result (`hasRedFlag ? "POSITIVE for …" : "completed; no red flags identified"`).
- **Assessment:** `ailmentName`, framed as suitable for O. Reg. 256/24 minor-ailments prescribing.
- **Plan:** `selectedRx` regimen (drug/dose/sig/qty/refills/duration) + `nonRxChecked` advice + `followUp`.

plus a `plain` rendering with `S: / O: / A: / P:` line prefixes for the PDF and the LLM prompt. Implement exactly as specified in spec §4.2.

**Hard contract (asserted in Task 8):** `buildSoapNote` is **deterministic** (same input ⇒ byte-identical output), performs **no** network I/O, and **invents no clinical fact** — every string in the output is either a literal framing sentence or a value copied from the input.

**Verify:** `npx tsc --noEmit` green; the module imports only `@/types` (or co-located types) and nothing from `next`, `react`, or any AI SDK.

---

### Task 3 — Add the `notes.ai_drafted` audit event (non-PHI)

**Modify** `src/lib/audit-actions.ts` — add `"notes.ai_drafted"` to the `EventType` union (`audit-actions.ts:5-18`):

```ts
type EventType =
  | …
  | "assessment.saved"   // added by #2
  | "notes.ai_drafted"   // added by #7
```

**Supabase DDL** (non-PHI; applied alongside #2's `assessment.saved` work, mirroring its validation): insert `notes.ai_drafted` into `audit.event_type`; extend the `log_event` SECURITY DEFINER function to **require** `provider` and **reject** any clinical/patient key (`ailment`, `drug`, `rx_*`, `name`, `dob`, `notes`, `note`, `soap`, `symptom`). Permitted metadata keys are exactly `{ provider, model }`. This matches #2's `assessment.saved` discipline (`persist-assessments-flyio-design.md` §4.6).

The event is **emitted only from the Phase-2 server action** (Task 7); the Phase-1 template path is client-only and emits nothing to Supabase (its usage is captured in the fly.io `note_provider` column).

**Verify:** `npx tsc --noEmit` green; a manual `logAuditEvent("notes.ai_drafted", { provider: "azure-openai", model: "gpt-4o-mini" })` call in a scratch test round-trips (or, in Phase 1 without Supabase wiring, the union member simply compiles and is asserted in Task 8/9).

---

### Task 4 — The `<SoapNotePanel>` client component

**Create** `src/components/wizard/soap-note-panel.tsx` (`"use client"`), implementing spec §4.5. Props: `{ input: SoapDraftInput; soapNote: string | undefined; onAccept: (plain: string, provider: NoteProvider) => void }`.

Behaviour:
- Local `draft` state initialised to `soapNote ?? buildSoapNote(input).plain` — so the **template** draft is shown **instantly on mount** with zero latency and zero disclosure.
- `provider` state initialised to `"template"` (or `noteProvider` if a note was already accepted).
- `accepted` boolean: `true` only when `soapNote` was pre-supplied AND is unchanged; **any** textarea edit resets `accepted=false`.
- "Enhance with AI" button → calls `draftNotesWithAiAction(input)` (Task 7), sets `draft`/`provider`, resets `accepted=false`; shows "Drafting…" while pending.
- An amber provenance banner when `!accepted`: *"Draft ({provider}) — review, edit, and click 'Use this note'. You are responsible for the final note."*
- "Use this note" button → `onAccept(draft, provider)`; sets `accepted=true`.

Uses existing UI primitives (`@/components/ui/{button,textarea}`), matching the wizard's component conventions (`step-redflags.tsx:5-8`, `step-generate.tsx:8-10`).

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; behaviour covered by Task 10 tests.

---

### Task 5 — Wire the panel into the terminal step + wizard state

**Modify** `src/components/wizard/wizard-container.tsx`:
1. Add state alongside `wizard-container.tsx:43-48`:
   ```ts
   const [soapNote, setSoapNote] = useState<string>()
   const [noteProvider, setNoteProvider] = useState<NoteProvider>("manual")
   ```
2. Pass `soapNote`, `noteProvider`, and an `onAccept` callback into `<StepGenerate>` (`wizard-container.tsx:173-183`):
   ```ts
   onAcceptNote={(plain, provider) => { setSoapNote(plain); setNoteProvider(provider) }}
   ```

**Modify** `src/components/wizard/step-generate.tsx`:
1. Extend `StepGenerateProps` (`step-generate.tsx:12-20`) with `soapNote?: string`, `noteProvider: NoteProvider`, `onAcceptNote: (plain: string, provider: NoteProvider) => void`.
2. Build `SoapDraftInput` from the existing props (`ailment`, `patient.encounterType`, `symptomsChecked`, `assessmentNotes`, `hasRedFlag`-equivalent = `false` on the prescribe branch, `selectedRx`, `nonRxChecked`, `ailment.followUp`).
3. Render `<SoapNotePanel>` between the Assessment Summary card (`step-generate.tsx:55-70`) and the Download button block (`step-generate.tsx:74-81`).
4. Forward `soapNote` into `<CombinedPdf>` (`step-generate.tsx:35-45`) and, once #2 is wired, into the `saveAssessmentAction` payload.

**No change** to `canNext` (`wizard-container.tsx:52-59`): accepting a draft is encouraged but not mandatory.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green; `npm run build` succeeds. Manual: `/assess/acne` → complete to step 3 → the panel shows the template SOAP draft instantly; click "Use this note"; the accepted note is held in state.

---

### Task 6 — Render the accepted note on the PDF

**Modify** `src/components/combined-pdf.tsx`:
1. Add `soapNote?: string` to `CombinedPdfProps` (`combined-pdf.tsx:159-169`).
2. Replace the notes block (`combined-pdf.tsx:301-306`) to render `soapNote ?? assessmentNotes`, with the label switching to "ASSESSMENT NOTE (SOAP)" when `soapNote` is present:
   ```tsx
   {(soapNote ?? assessmentNotes) && (
     <View style={styles.notesBlock}>
       <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5, marginBottom: 1, color: TEAL }}>
         {soapNote ? "ASSESSMENT NOTE (SOAP)" : "ASSESSMENT NOTES"}
       </Text>
       <Text style={{ fontSize: 7 }}>{soapNote ?? assessmentNotes}</Text>
     </View>
   )}
   ```
3. `step-generate.tsx` already forwards `soapNote` (Task 5).

**The referral PDF (`referral-pdf.tsx`) is NOT touched** this iteration (spec §7.5).

**Verify:** `npx tsc --noEmit` green; `npm run build` succeeds. After Task 6 the **entire template tier is shippable** — the feature saves the typing burden live, with no AI/infra dependency. (This is the recommended Phase-1 cut point.)

---

### Task 7 — The AI enhancement server action (Phase 2, flag-gated)

**Create** `src/lib/notes/actions.ts` (`"use server"`), implementing spec §4.3–§4.4:

1. Export `NOTES_PROMPT_VERSION = "notes-prompt-v1"`, `DraftResult` interface.
2. `draftNotesWithAiAction(input: SoapDraftInput): Promise<DraftResult>`:
   - Always compute `const template = buildSoapNote(input)`.
   - `await requireAuth()` (`auth-guards.ts:44`); if no `pharmacyId` → return template.
   - **Guard:** if `process.env.AI_NOTES_ENABLED !== "true"` OR `!process.env.AI_NOTES_ENDPOINT` → return `{ plain: template.plain, provider: "template" }` (graceful fallback, no disclosure).
   - Build the **PII-stripped clinical payload** (spec §4.3): ailment, encounter, symptoms, observations, redFlagScreen, regimen, nonDrugAdvice, followUp, `templateDraft: template.plain`, `promptVersion`. **Exclude** name/DOB/OHIP/address/phone/prescriber.
   - `try { const draft = await callLlmProvider(clinicalPayload); await logAuditEvent("notes.ai_drafted", { provider: draft.provider, model: draft.model ?? "" }); return draft } catch { return template }`.
3. Private `callLlmProvider(payload): Promise<DraftResult>` — a **raw `fetch`** POST to `AI_NOTES_ENDPOINT` with `Authorization: Bearer ${AI_NOTES_API_KEY}` (server-only), a system prompt that (a) rewrites the template draft as clean SOAP prose, (b) **adds no clinical facts / changes no regimen / interprets no red flag** (PMS-owned boundary, roadmap §3), (c) preserves the exact regimen and follow-up, (d) stays ≤ ~120 words with `S:/O:/A:/P:` sections. Parse the JSON response to `{ plain, provider, model }`.

**Env (server-only, all default-off/empty):** `AI_NOTES_ENABLED`, `AI_NOTES_PROVIDER`, `AI_NOTES_ENDPOINT`, `AI_NOTES_API_KEY`, `AI_NOTES_MODEL`.

**Verify:** `npx tsc --noEmit` green; `npm run lint` green. Behaviour (flag-off fallback, PII-stripping, error fallback, audit metadata) covered by Task 9 tests with a mocked `fetch`.

---

### Task 8 — Template-engine unit tests

**Create** `src/__tests__/soap-template.test.ts` (vitest, mirroring `src/__tests__/pdf-filter.test.ts` / `parse-ailments.test.ts` style):

- **Determinism:** `buildSoapNote(fixedInput)` called twice returns byte-identical `plain`.
- **SOAP sections present:** output contains `S:`, `O:`, `A:`, `P:` lines.
- **Subjective content:** `symptomsChecked` items and `assessmentNotes` appear in the S line; absent items do not.
- **Objective reflects screen:** with `hasRedFlag=false` → "no red flags identified"; the line names `ailmentName`.
- **Assessment names the ailment** and references O. Reg. 256/24.
- **Plan carries the regimen exactly:** for a `selectedRx` fixture, the drug/dose/sig/quantity/refills/duration appear verbatim (the no-invention contract — the assembler copies, never alters).
- **Plan carries `nonRxChecked` and `followUp`** when present, omits cleanly when empty.
- **No-invention guard:** a property-style check that no token outside the input vocabulary + the fixed framing literals appears (e.g. the assembler never emits a drug name not in `selectedRx.drug`).
- **Ailment-data realism:** build inputs from a real `data/ailments.json` entry (e.g. `acne`, `ailments.json:5`) and assert the output is a coherent note (smoke).

**Verify:** `npm test -- soap-template` green.

---

### Task 9 — AI server-action unit tests (mocked fetch)

**Create** `src/__tests__/notes-actions.test.ts` (vitest; mock `requireAuth` and global `fetch`):

- **Flag off → template fallback:** `AI_NOTES_ENABLED` unset; `draftNotesWithAiAction(input)` returns `{ provider: "template" }` and `fetch` is **never called**; `logAuditEvent` not called.
- **Endpoint unset → template fallback:** flag on but `AI_NOTES_ENDPOINT` empty → same.
- **No pharmacyId → template fallback:** mocked `requireAuth` returns a profile with `pharmacyId: null` → template, no fetch.
- **PII-stripping:** flag on, fetch mocked to capture the request body; assert the body contains **no** `name`, `dob`, `ohip`, `address`, `phone`, `doctor*` keys; assert it contains `ailment`, `symptoms`, `regimen`, `templateDraft`.
- **Success path:** mocked fetch returns a draft → action returns `{ provider: "azure-openai", model, plain }` and `logAuditEvent` is called with `{ provider, model }` and **no** note text / ailment / patient key.
- **Provider error → template fallback:** mocked fetch rejects → action returns template, does not throw, does not call `logAuditEvent`.
- **Auth enforcement:** unauthenticated `requireAuth` redirects (assert the redirect path is hit) — the provider is unreachable without auth.

**Verify:** `npm test -- notes-actions` green.

---

### Task 10 — Panel + PDF component tests

**Create** `src/__tests__/soap-note-panel.test.tsx` (vitest + @testing-library/react, mirroring `step-redflags.test.tsx` / `step-rx.test.tsx`):

- **Template draft shown on mount:** render with a fixed `input` and no `soapNote`; assert the S/O/A/P text from `buildSoapNote` is visible immediately (no loading state).
- **Accept contract:** click "Use this note"; assert `onAccept` called with the current draft text and `"template"`.
- **Edit resets acceptance:** type into the textarea; assert the amber banner reappears (or acceptance flag resets) and "Use this note" must be clicked again to re-accept.
- **AI enhance flow:** mock `draftNotesWithAiAction` to resolve a draft; click "Enhance with AI"; assert "Drafting…" then the mocked draft; assert `onAccept` not yet called until "Use this note".
- **Pre-supplied note:** render with `soapNote` set; assert it is shown and `accepted` initial state is true (no banner).

**Modify** `src/__tests__/combined-pdf-txid.test.tsx` (or add `src/__tests__/combined-pdf-soap.test.tsx`) — assert:
- When `soapNote` is provided, the PDF renders "ASSESSMENT NOTE (SOAP)" + the soap text (use `@react-pdf/renderer`'s `renderToBuffer`/string render as the existing test does).
- When `soapNote` is absent but `assessmentNotes` present, renders "ASSESSMENT NOTES" + assessmentNotes (existing behaviour preserved).

**Modify** `src/__tests__/step-redflags.test.tsx` only if the panel accidentally affects it (it should not — the panel lives on step 3, not step 1); otherwise leave untouched.

**Verify:** `npm test -- soap-note-panel` green; `npm test -- combined-pdf` green; `npm test` (full suite) green.

---

### Task 11 — Persistence wiring (extends #2; gated on PHI_PERSIST_ENABLED)

This task is **conditional on #2 being landed**; if #2 is still behind its flag, this task ships the schema + store extension as no-op-ready and the accepted note simply is not persisted yet (it still renders on the PDF, which is the durable Phase-1 artefact).

**fly.io DDL** (extends `persist-assessments-flyio-design.md` §4.3):
```sql
ALTER TABLE assessment
  ADD COLUMN IF NOT EXISTS soap_note text,
  ADD COLUMN IF NOT EXISTS note_provider text;
```
(Both PHI/record-metadata; fly.io under BAA, gated by `PHI_PERSIST_ENABLED` as in #2.)

**Modify** `src/lib/phi/assessment-store.ts` (#2's store) — `saveAssessment` accepts `soapNote?`/`noteProvider?` and writes them into the `assessment` insert.

**Modify** `src/lib/assessment-actions.ts` (#2's `saveAssessmentAction`) — thread `soapNote`/`noteProvider` from the wizard payload into the store call; still flag-guarded (no-op stub when `PHI_PERSIST_ENABLED !== "true"`).

**Verify:** `npx tsc --noEmit` green; the accepted note persists on staging once #2's flag flips (E2E in Task 12). In Phase 1 (flag off) this is a no-op and the note lives only on the printed PDF — acceptable per spec §4.8.

---

### Task 12 — Whole-repo guard + final verification

Run the full suite (no new code this step — confirmation only):

- **Typecheck:** `npx tsc --noEmit` — green.
- **Lint:** `npm run lint` — green.
- **Tests:** `npm test` — all suites green (existing + soap-template + notes-actions + soap-note-panel + combined-pdf-soap).
- **Build:** `npm run build` — succeeds.
- **Guard greps** (informational; paste-ready for CI):
  - `rg -n "AI_NOTES_API_KEY|AI_NOTES_ENDPOINT" src/` — every match is in `src/lib/notes/actions.ts` or its test (never `NEXT_PUBLIC_`, never a client component).
  - `rg -n "fetch\(" src/lib/notes/` — the only network call is the provider POST in `callLlmProvider`.
  - `rg -n "name:|dob:|ohip:|phone:" src/lib/notes/actions.ts` — **zero matches in the payload-construction block** (PII-stripping guard); confirm direct identifiers are absent from the clinical payload.
  - `rg -n "notes.ai_drafted" src/` — emitted only from `draftNotesWithAiAction` and the EventType union; metadata never includes note text / ailment / patient keys.

**Verify:** all four commands exit 0; the greps match expectations.

---

## Files to Create / Modify (real paths)

**Create:**
- `src/lib/notes/soap-template.ts` — deterministic SOAP assembler; `buildSoapNote`, `SoapDraftInput`, `SoapNote`, `NOTES_TEMPLATE_VERSION`.
- `src/lib/notes/actions.ts` — `draftNotesWithAiAction` server action; `callLlmProvider`; `NOTES_PROMPT_VERSION`; `DraftResult`.
- `src/components/wizard/soap-note-panel.tsx` — `<SoapNotePanel>` (draft/edit/accept; AI-enhance button).
- `src/__tests__/soap-template.test.ts`, `src/__tests__/notes-actions.test.ts`, `src/__tests__/soap-note-panel.test.tsx`, `src/__tests__/combined-pdf-soap.test.tsx`.

**Modify:**
- `src/types/index.ts` — `NoteProvider`; `soapNote?`, `noteProvider?` on `AssessmentData`.
- `src/lib/audit-actions.ts` — `"notes.ai_drafted"` in `EventType`.
- `src/components/wizard/wizard-container.tsx` — `soapNote`/`noteProvider` state + `onAccept`; thread into `<StepGenerate>`.
- `src/components/wizard/step-generate.tsx` — render `<SoapNotePanel>`; forward `soapNote` to `<CombinedPdf>` and the persist payload.
- `src/components/combined-pdf.tsx` — `soapNote?` prop; render `soapNote ?? assessmentNotes`.
- `src/lib/phi/assessment-store.ts` + `src/lib/assessment-actions.ts` (Task 11, conditional on #2) — persist `soap_note`/`note_provider`.

**Not touched (deliberately, per spec §8):** `data/ailments.json`; `referral-pdf.tsx` / the referral branch; any clinical-safety logic; `package.json` (raw `fetch`, no new required dependency). `pg`/fly.io are NOT required for the template tier.

---

## Data / DB Changes

**fly.io Postgres (PHI, extends #2, gated on `PHI_PERSIST_ENABLED`/BAA):**
```sql
ALTER TABLE assessment
  ADD COLUMN IF NOT EXISTS soap_note text,        -- accepted SOAP narrative (PHI)
  ADD COLUMN IF NOT EXISTS note_provider text;    -- origin: template|azure-openai|manual|… (record metadata)
```

**Supabase (non-PHI audit):** add `notes.ai_drafted` to `audit.event_type`; extend `log_event` validation to require `provider` and reject clinical/patient keys (permitted metadata: `{ provider, model }` only).

**Environment (server-only, all default-off/empty):** `AI_NOTES_ENABLED`, `AI_NOTES_PROVIDER`, `AI_NOTES_ENDPOINT`, `AI_NOTES_API_KEY`, `AI_NOTES_MODEL`.

---

## Tests

| Suite | Covers |
|---|---|
| `src/__tests__/soap-template.test.ts` (new) | Determinism; SOAP sections present; Subjective/Objective/Assessment/Plan content from inputs; regimen copied verbatim (no-invention); empty-input handling; real-ailment smoke. |
| `src/__tests__/notes-actions.test.ts` (new) | Flag-off / endpoint-unset / no-pharmacyId → template fallback (no fetch, no audit); PII-stripped payload (no direct identifiers); success → audit `{provider, model}` only; provider error → template fallback; auth enforcement. |
| `src/__tests__/soap-note-panel.test.tsx` (new) | Template draft on mount; accept contract; edit resets acceptance; AI-enhance flow (mocked); pre-supplied note. |
| `src/__tests__/combined-pdf-soap.test.tsx` (new) | SOAP label + text when `soapNote` present; fallback to "ASSESSMENT NOTES" + assessmentNotes when absent. |

No E2E is required for the template tier (client-only). The AI tier's E2E is a manual staging smoke once a BAA'd provider is configured: `/assess/acne` → step 3 → panel shows template draft → "Enhance with AI" → polished draft → edit → "Use this note" → download PDF shows the SOAP note; confirm `notes.ai_drafted` appears in `audit.log`.

---

## Verification Commands

```bash
npx tsc --noEmit                                  # typecheck (Tasks 1–7, 11)
npm run lint                                      # eslint (Tasks 4,5,7)
npm test                                          # full vitest suite (Tasks 8–10)
npm test -- soap-template                         # template determinism + content (Task 8)
npm test -- notes-actions                         # AI action fallback/PII/audit (Task 9)
npm test -- soap-note-panel                       # panel accept/edit/AI flow (Task 10)
npm test -- combined-pdf                          # PDF SOAP rendering (Task 10)
npm run build                                     # production build (Tasks 5,6,12)

# Guard greps (Task 12) — informational, run locally:
rg -n "AI_NOTES_API_KEY|AI_NOTES_ENDPOINT" src/   # server-only, never NEXT_PUBLIC_
rg -n "fetch\(" src/lib/notes/                    # only the provider POST
rg -n "name:|dob:|ohip:|phone:" src/lib/notes/actions.ts   # zero in payload block (PII strip)
rg -n "notes.ai_drafted" src/                     # only action + EventType; no PHI keys
```

---

## Rollout Notes

- **Phased value.** **Phase 1 = Tasks 1–6 + 8 + 10 (template tier):** ships the 60–90s typing saving **live**, with **no** flag, **no** fly.io/BAA dependency, **no** new dependency, **no** PHI disclosure (pure local computation). This is the recommended Phase-1 cut point and is independently valuable. **Phase 2 = Tasks 7 + 9 + 12 (AI tier):** additive eloquence behind `AI_NOTES_ENABLED`, gated on a procured BAA'd provider with zero-retention/no-training terms and a Canadian inference region.
- **Hard gate — provider BAA + region (spec Open Question §7.1).** `AI_NOTES_ENABLED` must not flip true until (a) a BAA'd provider is procured (Azure OpenAI recommended; AWS Bedrock Claude acceptable), (b) its BAA + zero-retention terms are executed, and (c) its inference region is **Canadian** (`canadaeast`/`canadaecentral`) per PHIPA s.17 / roadmap §6.2. The template tier is unaffected by this gate.
- **No clinical-safety automation.** The LLM drafts prose from data the pharmacist entered; the system prompt forbids adding clinical facts, changing the regimen, or interpreting red flags (PMS-owned boundary, roadmap §3). The persisted regimen is always the wizard's `selectedRx`, never the model's; only the note text carries the model's wording, and that text is human-reviewed at the accept gate.
- **Human-in-the-loop is non-negotiable.** An unreviewed draft never persists and never prints. The accept click + the pharmacist's edits make it the record; `note_provider` records origin (not authorship). This is the medico-legal safeguard and aligns with #11 (pharmacist e-signature), which will sign this reviewed note.
- **Soft gate — prompt/system-message review.** The `NOTES_PROMPT_VERSION`-pinned system prompt (Task 7) is the LLM's behaviour contract; like #3/#4/#22/#6 curated content, it should be reviewed by a practising pharmacist/clinical lead before the AI tier goes live. A prompt change is a version bump (recorded on persisted rows for audit reproducibility, feeding #26/#14).
- **Fail-safe, not fail-open.** Any provider error/timeout/misconfiguration degrades to the deterministic template — the pharmacist is never blocked and no partial PHI state is left. The catch in `draftNotesWithAiAction` (Task 7) enforces this; the test in Task 9 asserts it.
- **No new required dependency.** The provider call is a raw `fetch`; `package.json` stays clean for the template tier and requires no SDK for the AI tier. If a reviewer prefers a provider SDK, it is an optional dependency behind the flag — but raw `fetch` is recommended for swappability and minimal surface.
- **Persistence rides #2.** The accepted note persists to fly.io only when #2's `PHI_PERSIST_ENABLED` is on; until then the printed PDF is the durable Phase-1 artefact (the same "render client-side, optionally persist" pattern established across #1/#2/#3). No backpressure on #2's BAA gate.
