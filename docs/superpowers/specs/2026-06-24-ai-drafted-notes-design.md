# AI-Drafted Assessment Notes (SOAP) — Design

**Date:** 2026-06-24
**Roadmap item:** #7 (NEXT tier) — "AI-drafted assessment notes (SOAP from intake)"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST captures a rich, structured clinical picture during every consult — patient demographics (`PatientInfo`, `src/types/index.ts:18-37`), presenting symptoms (`symptomsChecked`, `wizard-container.tsx:44`), the red-flag screen result (`redFlagsChecked`, `wizard-container.tsx:43`), the selected regimen (`SelectedRx`, `types/index.ts:52-57`), the non-Rx advice discussed (`nonRxChecked`, `wizard-container.tsx:47`), and the protocol-defined follow-up (`ailment.followUp`, `types/index.ts:15`). Yet the **only free-text clinical narrative** the pharmacist ever produces is a single optional `assessmentNotes` textarea on the symptoms step (`step-redflags.tsx:129-136`, placeholder "Clinical observations…"), which is hand-typed at the counter under time pressure and frequently left blank. The terminal step (`step-generate.tsx:22`) shows a read-only "Assessment Summary" card (`step-generate.tsx:55-70`) and a Download button — it does **not** draft or assemble a note; the pharmacist is expected to have already typed everything they want on the PDF. A `rg` for `soap|openai|anthropic|llm|draftNote|generateNote` across `src/` returns zero matches; there is no note-drafting, templating, or generative-AI surface of any kind, and `package.json:13-28` carries no AI/LLM SDK.

This is exactly the gap the competitive research names: *"AI-drafted assessment notes (SOAP from intake) — Speed. Counters MAPflow AI; saves 60–90s/consult"* (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §5, NEXT tier, row #7). The rival MAPflow's stated strength is "AI-assisted" documentation (`cdst-competitive-roadmap-design.md` §2). Every second a pharmacist spends re-typing symptoms, regimens, and follow-up that the wizard *already holds as structured data* is pure friction at a busy counter, and a blank `assessmentNotes` field on a medico-legal record is a documentation gap. The wizard has all the inputs for a complete SOAP note; it simply never assembles them.

**The goal of this feature** is to auto-draft a **structured SOAP (Subjective / Objective / Assessment / Plan) clinical note** from the wizard's already-collected state, present it to the pharmacist for **mandatory review and edit** on the terminal step, and route the accepted note onto the PDF and the persisted record. It is delivered in two tiers: (a) a **deterministic SOAP template engine** (`src/lib/notes/soap-template.ts`) that assembles the note locally from structured fields — no third party, no PHI disclosure, ships **live in Phase 1**; and (b) an **optional generative-AI enhancement layer** behind a feature flag (`AI_NOTES_ENABLED`) that sends a **PII-stripped clinical payload** to a **BAA'd LLM provider** (Azure OpenAI recommended) for a more natural, polished draft — gated on the same BAA discipline roadmap §6.2 applies to all PHI disclosures. In both tiers the pharmacist reviews, edits, and explicitly accepts the draft; an unreviewed draft never becomes the record. The note persists to the fly.io `assessment` row established by #2 (`2026-06-23-persist-assessments-flyio-design.md` §4.3) as a new `soap_note` column, renders on the prescription PDF, and carries a provenance marker recording how it was produced (`template` | `azure-openai` | …).

**Out of scope** (per roadmap §3, §6, and YAGNI for the NEXT tier): **automated clinical reasoning or decision-making** — the LLM drafts *prose from data the pharmacist already entered*; it does not recommend a diagnosis, select an Rx, flag a red flag, or perform allergy/interaction/pregnancy logic (all PMS-owned per roadmap §3, identical to the boundary #6's differentials respect); a **voice/dictation** note path (roadmap #17, LATER); **note templates per ailment authored by clinical governance** (roadmap #26 content governance — the v1 template is a single universal SOAP assembler, ailment-specific content comes from the existing `data/ailments.json` fields, not a curated template library); **longitudinal note aggregation / copy-forward from prior visits** (roadmap #28 chronic module); **auto-submitting the note to the PMS or an EHR** (PMS write-back is out of scope per roadmap §3); and **a note quality/scoring engine** (#14 outcomes analytics is LATER).

---

## 2. Current State (what exists in code)

### 2.1 The wizard collects a complete SOAP-shaped dataset but never assembles it

`WizardContainer` (`src/components/wizard/wizard-container.tsx:40`) holds, in `useState`, everything a SOAP note needs:

- `patient: PatientInfo` (`wizard-container.tsx:42`) — name, DOB, sex, encounter type (`types/index.ts:34`), prescriber, etc.
- `symptomsChecked: string[]` (`wizard-container.tsx:44`) — the presenting symptoms the pharmacist confirmed (the **Subjective** findings).
- `redFlagsChecked: string[]` (`wizard-container.tsx:43`) + derived `hasRedFlag` (`wizard-container.tsx:50`) — the red-flag screen result (the **Objective** screening outcome; on the prescribe path `hasRedFlag === false`, i.e. "no red flags identified").
- `assessmentNotes: string` (`wizard-container.tsx:45`) — the pharmacist's free-text observations (additional **Subjective** narrative).
- `selectedRx: SelectedRx | null` (`wizard-container.tsx:46`) — drug, dose, sig, quantity, refills, duration (`types/index.ts:52-57`); the **Plan**'s pharmacotherapy.
- `nonRxChecked: string[]` (`wizard-container.tsx:47`) — the self-care advice discussed (`step-rx.tsx:110-139`); the **Plan**'s non-pharmacotherapy.
- `ailment` (fixed prop, `wizard-container.tsx:40`) — `ailment.name` is the **Assessment** (the diagnosis the pharmacist committed to before opening the wizard); `ailment.followUp` (`types/index.ts:15`) is the **Plan**'s follow-up; `ailment.symptoms`/`redFlags`/`rxOptions`/`nonRx` (`types/index.ts:11-14`) are the structured content each checkbox list draws from.

All six state values plus `ailment` are passed to `<StepGenerate>` (`wizard-container.tsx:173-183`). The data is *present* at the terminal step; nothing *composes* it into a note.

### 2.2 The only free-text narrative is an optional, early, hand-typed textarea

`assessmentNotes` is captured on **step 1** (the red-flags/symptoms step), in a `<Textarea>` labelled "Assessment Notes" with placeholder "Clinical observations…" (`step-redflags.tsx:127-137`), reachable only when no red flag is checked (`step-redflags.tsx:94`). It is the pharmacist's typing burden today. It renders on the prescription PDF inside a "notes block" (`combined-pdf.tsx:301-306`) and — once #2 ships — persists to the fly.io `assessment.assessment_notes` column (`persist-assessments-flyio-design.md` §4.3). There is no SOAP structure, no auto-draft, and no review/edit surface; whatever the pharmacist typed at step 1 is what prints.

### 2.3 The terminal step is read-only — it does not draft

`StepGenerate` (`src/components/wizard/step-generate.tsx:22`) renders an "Assessment Summary" `<Card>` (`step-generate.tsx:55-70`) showing patient, ailment, and the selected drug/dose/sig/date, then a Download button (`step-generate.tsx:74-81`). The summary **omits** `assessmentNotes`, `symptomsChecked`, `nonRxChecked`, and `ailment.followUp` entirely — they only appear (if at all) inside the downloaded PDF. There is no editable note region on this step; the pharmacist cannot refine the narrative at the moment they are about to produce the legal document. `handleDownload` (`step-generate.tsx:26-51`) lazily reserves a tx id and renders `<CombinedPdf>` (`step-generate.tsx:35-45`); it is the natural insertion point for a draft-and-review panel.

### 2.4 No AI / LLM / templating infrastructure exists

`package.json:13-28` depends on `@react-pdf/renderer`, `@supabase/ssr`+`@supabase/supabase-js`, `base-ui`, `lucide-react`, `clsx`/`tailwind-merge`, `gray-matter`, and `shadcn` — **no `openai`, no `@anthropic-ai/sdk`, no `@azure/openai`, no `ai` (Vercel AI SDK), no LangChain**. A `rg` for `soap|openai|anthropic|\bllm\b|draftNote|generateNote|ai_drafted|azure` across `src/` returns no files. There is no server action that calls a generative model, no API route under `src/app/api/` beyond `auth/*` (`src/app/api/auth/{login,logout,signup,switch-pharmacy}/route.ts`). Introducing the AI tier therefore means (a) a new server action under `src/lib/`, (b) a new optional dependency on a provider SDK (or raw `fetch` to the provider's REST endpoint), and (c) new server-only env vars for the provider key/endpoint — none of which exist today.

### 2.5 The persistence + audit foundation (#2) is the landing zone

#2's `persist-assessments-flyio-design.md` §4.3 defines the fly.io `assessment` table with an `assessment_notes text` column and §4.6 defines the non-PHI Supabase `assessment.saved` audit event. The `EventType` union (`src/lib/audit-actions.ts:5-18`) currently has no `notes.*` event. #7 lands cleanly on this foundation: a new `soap_note text` + `note_provider text` column on the `assessment` row (PHI, fly.io), a new non-PHI `notes.ai_drafted` Supabase event, and the existing `saveAssessmentAction` (`persist-assessments-flyio-design.md` §4.7) threads the accepted `soapNote` into the persist payload. The server-action shape to mirror is `reserveTxId()` (`src/lib/prescription-actions.ts:6-24`) — `requireAuth()` (`auth-guards.ts:44`) → derive `{ pharmacistId, pharmacyId }` → perform the side effect → return a typed result.

### 2.6 The content-governance precedent and the non-PHI-ships-live property

Two recurring patterns from prior features directly shape #7. **(a) Content-governance:** #3 (`statements.ts`), #4 (`reasons.ts`), #22 (`catalog.ts`), #6 (`differentials.ts`) all place curated/versioned clinical content in a hashed TS module under `src/lib/`. #7's SOAP *assembler* (the template tier) is logic, not curated content, so it does not need a content hash — but the **prompt template** for the AI tier is a string that should be versioned (`NOTES_PROMPT_VERSION`) for audit reproducibility, exactly as #6 versions `DIFFERENTIALS_VERSION`. **(b) Non-PHI ships live:** #6 and #22's inventory ledger both ship live in Phase 1 with no `PHI_PERSIST_ENABLED` dependency because they add no PHI to a third party. #7's **template tier** shares this property — it is pure local computation that discloses nothing — so it ships live immediately; only the **AI tier** (a PHI disclosure to a third-party model) is BAA-gated, mirroring how #2's persist write is BAA-gated while the non-PHI audit event is not.

---

## 3. Approach (options + recommendation)

The design hinges on six decisions: (a) whether the draft is deterministic, generative, or both; (b) where drafting runs (client vs. server); (c) what the LLM payload contains and whether it is PHI; (d) how the pharmacist accepts/edits (human-in-the-loop discipline); (e) where the accepted note lives (new field vs. reuse `assessmentNotes`); (f) which LLM provider and under what legal terms. Options are evaluated against roadmap §6.2 (PHI on fly.io under BAA; Supabase = auth + non-PHI), §6.4 (the partitioning rule), §3 (PMS owns clinical-safety automation), and §4 (the counter-speed wedge).

### Option A — Two-tier draft: deterministic SOAP template (live) + optional BAA-gated LLM enhancement (RECOMMENDED)

A pure, synchronous **template engine** `src/lib/notes/soap-template.ts` exports `buildSoapNote(input: SoapDraftInput): SoapNote` that maps the wizard state into the four SOAP sections — **Subjective** (encounter type + `symptomsChecked` + `assessmentNotes`), **Objective** (`ailment.name` + "red-flag screen: none identified"), **Assessment** (`ailment.name`, framed as appropriate for minor-ailment prescribing under O. Reg. 256/24), **Plan** (`selectedRx` regimen + `nonRxChecked` advice + `ailment.followUp`). It is dependency-free, runs on the client, discloses nothing, and ships **live in Phase 1** behind no flag. An optional **AI enhancement server action** `src/lib/notes/actions.ts` → `draftNotesWithAiAction(input)` runs only when `AI_NOTES_ENABLED === "true"` AND a BAA'd provider is configured: it `requireAuth()`s, **strips direct identifiers** (name, DOB, OHIP, address, phone, prescriber) from the payload, sends the remaining **clinical** payload (ailment, symptoms, red-flag-screen result, regimen, advice, follow-up, the pharmacist's free-text observations) to the provider, and returns a polished prose draft. The clinical payload is still PHI per roadmap §6.4 ("describe their clinical state"), so the provider **must** operate under a signed BAA with zero-retention/no-training terms. In **both tiers**, the draft appears in an editable `<SoapNotePanel>` on the terminal step (`step-generate.tsx`) with a visible provenance banner; the pharmacist reviews, edits, and clicks **"Use this note"** to accept. The accepted text becomes the new `soapNote` field on `AssessmentData` (`types/index.ts:59-67`), renders on the PDF, and persists to #2's `assessment.soap_note`. A non-PHI `notes.ai_drafted` Supabase audit event records `{ provider, model }` (Phase 2 only; no patient data, no note text). When the flag is off or the provider call fails, the action **degrades gracefully to the template** so the pharmacist is never blocked.

- **Pros:** Faithful to the roadmap framing while being compliance-honest. The template tier delivers the **60–90s saving immediately**, independent of any BAA/provider procurement — so the feature moves the needle in Phase 1 even though fly.io (#2) and the LLM BAA are not yet in place (roadmap §7 open questions #1/#2). It reuses the established **non-PHI-ships-live** property (#6, #22 inventory) for the template and the **stub-behind-flag** property (#1 e-fax, #2 persist) for the AI call. PII-stripping the prompt minimises the PHI blast radius of the disclosure even though it cannot eliminate it (clinical content remains PHI). The **human-in-the-loop accept step** is the medico-legal safeguard: the pharmacist owns the note, countering any "the AI wrote it, not me" liability, and aligning with #11 (pharmacist e-signature) which will sign exactly this reviewed note. The deterministic template is the durable fallback for offline/connectivity-loss scenarios (a busy counter cannot depend on an external model being reachable), and it is the **base input the LLM refines** — so the two tiers compose rather than duplicate. Versioning the prompt (`NOTES_PROMPT_VERSION`) gives audit reproducibility (#26 governance, #14 outcomes) for the AI tier just as #6 versions its differential set.
- **Cons:** Two code paths to maintain (template + AI). The AI tier cannot ship until a BAA'd provider is procured and configured (mitigated: the template ships the value now; the AI is additive eloquence, not the core value). PII-stripping is a best-effort reduction, not a safe-harbor guarantee (clinical content is still PHI — mitigated by the hard BAA requirement and by never sending direct identifiers). Adds a new optional dependency for the provider (mitigated: raw `fetch` to the provider REST endpoint avoids any SDK dependency; `AI_NOTES_ENABLED` default-off means the code path is inert until configured).

### Option B — LLM-only (BAA-gated, single generative path)

Skip the template; call the LLM for every draft.

- **Pros:** One code path; maximally natural prose; strongest "Counters MAPflow AI" signal.
- **Cons:** **Cannot ship until the BAA is signed and a provider procured** — leaving the 60–90s typing gap entirely open in Phase 1, directly against the roadmap §4 counter-speed wedge and the "saves 60–90s/consult" rationale. Adds a hard runtime dependency on an external model's availability and latency at a busy counter (a 2–4s model round-trip, plus failure modes), with no offline fallback. Violates the established pattern that a feature should deliver value independent of un-provisioned infrastructure. **Rejected** for the NEXT tier; the LLM is an *enhancement* on a deterministic base, not a replacement for it.

### Option C — Client-side template only, no AI tier ever

Ship only the deterministic SOAP assembler; never add generative AI.

- **Pros:** Simplest; zero PHI disclosure; zero new infra; ships live.
- **Cons:** Does **not** deliver the roadmap's stated differentiation ("Counters MAPflow AI"); a mechanical template is not "AI-drafted" and a competitor reviewer would correctly note the absence. Closes off the eloquence/polish that makes a note read as clinician-authored rather than machine-assembled. Prematurely forecloses a clear roadmap direction. **Rejected** as the *sole* path; the template is retained as the Phase-1 tier of Option A, not as the whole feature.

### Recommendation

**Option A.** It is the faithful, compliance-honest implementation of roadmap #7: the deterministic template ships the speed value live in Phase 1 with zero PHI disclosure and zero infrastructure dependency (exactly the property #6 and #22-inventory established for non-PHI features), and the BAA-gated LLM tier delivers the "Counters MAPflow AI" eloquence once a provider is procured — degrading to the template when off/unconfigured so the pharmacist is never blocked. The human-in-the-loop accept step and the PII-stripped prompt keep the PHI disclosure minimal and the medico-legal accountability on the pharmacist.

---

## 4. Components & Data Model

### 4.1 Types (`src/types/index.ts`, modified; `src/lib/notes/soap-template.ts`, new — re-exports)

Add to `AssessmentData` (`types/index.ts:59-67`) an optional accepted note and its provenance:

```ts
export type NoteProvider = "manual" | "template" | "azure-openai" | "bedrock-claude"

export interface AssessmentData {
  // …existing fields (types/index.ts:59-67)…
  soapNote?: string        // the pharmacist-accepted SOAP note (final narrative); renders on PDF + persists
  noteProvider?: NoteProvider  // how soapNote was produced; persists to assessment.note_provider; feeds #14/#26
}
```

The draft inputs (read-only view of wizard state) live in the notes module:

```ts
// src/lib/notes/soap-template.ts
export interface SoapDraftInput {
  ailmentName: string
  encounterType?: string
  symptomsChecked: string[]
  assessmentNotes: string            // pharmacist's free-text observations (Subjective narrative)
  hasRedFlag: boolean
  selectedRx: SelectedRx | null
  nonRxChecked: string[]
  followUp: string
}

export interface SoapNote {
  subjective: string
  objective: string
  assessment: string
  plan: string
  /** Pre-rendered plain-text rendering (S:/O:/A:/P: lines) for the PDF + LLM prompt */
  plain: string
}

export const NOTES_TEMPLATE_VERSION = "soap-template-v1"
```

`assessmentNotes` (the existing free-text field, `types/index.ts:64`) is **unchanged** — it remains the pharmacist's raw observations captured at step 1 and becomes a **Subjective input** to the draft. `soapNote` is the assembled, reviewed, accepted final note; the two are distinct so the raw input and the final product are both preserved (a medico-legal and #14-outcomes property).

### 4.2 Deterministic SOAP template engine (`src/lib/notes/soap-template.ts`, new)

A pure, synchronous, dependency-free function — the Phase-1 tier that ships live. It performs **no** network call and **no** clinical reasoning beyond assembling the strings the wizard already holds; it never invents a symptom, alters a regimen, or interprets a red flag.

```ts
import type { SoapDraftInput, SoapNote } from "./soap-template" // or co-located

export function buildSoapNote(input: SoapDraftInput): SoapNote {
  const subjective = [
    input.encounterType ? `Encounter: ${input.encounterType}.` : null,
    input.symptomsChecked.length > 0
      ? `Patient presents with: ${input.symptomsChecked.join("; ")}.`
      : null,
    input.assessmentNotes.trim() ? input.assessmentNotes.trim() : null,
  ].filter(Boolean).join(" ")

  const objective =
    input.hasRedFlag
      ? `Red-flag screen POSITIVE for: ${input.redFlagsChecked?.join("; ") ?? "(unspecified)"}.`
      : `Red-flag screen completed; no red flags identified. Diagnosis-anchored to ${input.ailmentName}.`

  const assessment =
    `${input.ailmentName}. Suitable for pharmacist assessment and prescribing under O. Reg. 256/24 (Ontario minor ailments).`

  const planParts = [
    input.selectedRx
      ? `Rx: ${input.selectedRx.drug} ${input.selectedRx.dose}; Sig: ${input.selectedRx.sig}; Qty ${input.selectedRx.quantity}; ${input.selectedRx.refills} refills${input.selectedRx.duration ? `; duration ${input.selectedRx.duration}` : ""}.`
      : null,
    input.nonRxChecked.length > 0
      ? `Non-drug advice discussed: ${input.nonRxChecked.join("; ")}.`
      : null,
    input.followUp ? `Follow-up: ${input.followUp}.` : null,
  ].filter(Boolean)
  const plan = planParts.join(" ")

  const plain =
    `S: ${subjective}\nO: ${objective}\nA: ${assessment}\nP: ${plan}`
  return { subjective, objective, assessment, plan, plain }
}
```

The output is deterministic for a given input — a property the plan's unit tests assert and that makes the template a stable base for the LLM tier and for #14 outcomes (two pharmacists with identical inputs get identical drafts, isolating the LLM's contribution to eloquence). `NOTES_TEMPLATE_VERSION` pins the assembler logic; a change to phrasing bumps the version (recorded on the persisted row for audit reproducibility).

### 4.3 The AI enhancement server action (`src/lib/notes/actions.ts`, new, `"use server"`)

The Phase-2 tier. Mirrors the `reserveTxId()` server-action shape (`prescription-actions.ts:6-24`) and the #2 flag-guard discipline (`persist-assessments-flyio-design.md` §4.7). It **always returns a usable draft** — the template result when AI is off/unconfigured/failed, the LLM result when on.

```ts
"use server"
import { requireAuth } from "@/lib/auth-guards"
import { buildSoapNote, NOTES_TEMPLATE_VERSION } from "./soap-template"
import type { SoapDraftInput } from "./soap-template"
import { logAuditEvent } from "@/lib/audit-actions"

export const NOTES_PROMPT_VERSION = "notes-prompt-v1"

export interface DraftResult {
  plain: string
  provider: "template" | "azure-openai" | "bedrock-claude"
  model?: string
}

export async function draftNotesWithAiAction(
  input: SoapDraftInput
): Promise<DraftResult> {
  const template = buildSoapNote(input)
  const profile = await requireAuth()              // auth-guards.ts:44; redirects if unauthenticated
  if (!profile.pharmacyId) return { plain: template.plain, provider: "template" }

  // Graceful fallback: AI off or unconfigured -> deterministic template, no disclosure.
  if (process.env.AI_NOTES_ENABLED !== "true" || !process.env.AI_NOTES_ENDPOINT) {
    return { plain: template.plain, provider: "template" }
  }

  try {
    // PII-stripped clinical payload: NO name, DOB, OHIP, address, phone, prescriber.
    // Clinical content is still PHI (roadmap §6.4) -> BAA'd provider + zero-retention required.
    const clinicalPayload = {
      ailment: input.ailmentName,
      encounter: input.encounterType ?? null,
      symptoms: input.symptomsChecked,
      observations: input.assessmentNotes || null,
      redFlagScreen: input.hasRedFlag ? "positive" : "negative",
      regimen: input.selectedRx,
      nonDrugAdvice: input.nonRxChecked,
      followUp: input.followUp,
      templateDraft: template.plain,        // the deterministic base the LLM refines
      promptVersion: NOTES_PROMPT_VERSION,
    }
    const draft = await callLlmProvider(clinicalPayload)   // raw fetch -> provider REST; see §4.4
    // Non-PHI audit: provider + model ONLY. No note text, no patient data, no ailment.
    await logAuditEvent("notes.ai_drafted", {
      provider: draft.provider, model: draft.model ?? "",
    })
    return draft
  } catch {
    return { plain: template.plain, provider: "template" }  // never block the pharmacist
  }
}
```

`callLlmProvider` is a private helper in the same module: a raw `fetch` POST to `AI_NOTES_ENDPOINT` with `Authorization: Bearer ${AI_NOTES_API_KEY}` (server-only env vars, never `NEXT_PUBLIC_`). Using raw `fetch` — not a provider SDK — keeps `package.json` free of a new dependency (the call is a single JSON request/response) and keeps the provider swappable via env.

### 4.4 The LLM provider contract (configurable, BAA-gated)

The provider is selected by env, not hardcoded. Recommended: **Azure OpenAI** (HIPAA-eligible, offers a BAA, does not train on customer data, supports zero-retention). Acceptable alternative: **AWS Bedrock (Anthropic Claude)** (BAA under AWS's HIPAA eligibility). **Plain `api.openai.com` is NOT acceptable** for PHI unless the OpenAI Enterprise BAA + zero-data-retention terms are executed. Env shape:

```
AI_NOTES_ENABLED=true
AI_NOTES_PROVIDER=azure-openai          # | bedrock-claude
AI_NOTES_ENDPOINT=https://<resource>.openai.azure.com/openai/deployments/<dep>/chat/completions?api-version=...
AI_NOTES_API_KEY=<server-only>
AI_NOTES_MODEL=gpt-4o-mini              # or the Bedrock model id
```

The system prompt instructs the model to: rewrite the template draft as clean clinician SOAP prose; **add no clinical facts not present in the payload** (no new symptoms, no alternative diagnoses, no dosing changes — this is the PMS-owned clinical-safety boundary, roadmap §3); preserve the exact regimen and follow-up strings; keep it under ~120 words; emit `S:/O:/A:/P:` sections. The model **must not** be asked to recommend an Rx, interpret a red flag, or perform any decision — only to prose-ify data the pharmacist already entered. This keeps the LLM firmly in the "documentation assistant" lane and out of the "clinical decision" lane.

### 4.5 The `<SoapNotePanel>` client component (`src/components/wizard/soap-note-panel.tsx`, new)

Renders on the terminal step (`step-generate.tsx`). It is the human-in-the-loop surface — the draft is never silently adopted.

```tsx
"use client"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { draftNotesWithAiAction } from "@/lib/notes/actions"
import { buildSoapNote } from "@/lib/notes/soap-template"

interface SoapNotePanelProps {
  input: SoapDraftInput
  soapNote: string | undefined
  onAccept: (plain: string, provider: NoteProvider) => void
}

export function SoapNotePanel({ input, soapNote, onAccept }: SoapNotePanelProps) {
  const [draft, setDraft] = useState<string>(() => soapNote ?? buildSoapNote(input).plain)
  const [provider, setProvider] = useState<NoteProvider>("template")
  const [loading, setLoading] = useState(false)
  const [accepted, setAccepted] = useState(!!soapNote)

  async function regenerateWithAi() {
    setLoading(true)
    const res = await draftNotesWithAiAction(input)   // server action; degrades to template if off
    setDraft(res.plain); setProvider(res.provider); setLoading(false); setAccepted(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Assessment Note (SOAP)</h3>
        <Button variant="outline" size="sm" onClick={regenerateWithAi} disabled={loading}>
          {loading ? "Drafting…" : provider === "template" ? "Enhance with AI" : "Re-draft"}
        </Button>
      </div>
      {!accepted && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Draft ({provider}) — review, edit, and click “Use this note”. You are responsible for the final note.
        </p>
      )}
      <Textarea value={draft} onChange={(e) => { setDraft(e.target.value); setAccepted(false) }} rows={8} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { onAccept(draft, provider); setAccepted(true) }}>Use this note</Button>
        {accepted && <span className="text-xs text-muted-foreground self-center">Saved to this assessment{provider !== "manual" ? ` (${provider})` : ""}.</span>}
      </div>
    </div>
  )
}
```

Behavioural contract: editing the textarea resets `accepted=false` (any edit requires re-acceptance); the provenance `provider` follows the draft source but the pharmacist's edits make it *their* note — the persisted `note_provider` records the **origin** of the accepted text, not authorship (the pharmacist is always the author of record; §5). "Use this note" calls `onAccept(plain, provider)`, which `WizardContainer` threads into `soapNote`/`noteProvider` state and onward to the PDF and `saveAssessmentAction`.

### 4.6 Wiring into the terminal step + wizard (`step-generate.tsx`, `wizard-container.tsx`, modified)

- **`WizardContainer`** gains `const [soapNote, setSoapNote] = useState<string>()` and `const [noteProvider, setNoteProvider] = useState<NoteProvider>("manual")` (alongside `wizard-container.tsx:43-48`), and passes both + an `onAccept` callback into `<StepGenerate>` (`wizard-container.tsx:173-183`).
- **`StepGenerate`** renders `<SoapNotePanel>` between the Assessment Summary card (`step-generate.tsx:55-70`) and the Download button (`step-generate.tsx:74`), assembling `SoapDraftInput` from its existing props. The accepted `soapNote` is forwarded into `<CombinedPdf>` (`step-generate.tsx:35-45`) and into the `saveAssessmentAction` payload (once #2 is wired, per `persist-assessments-flyio-design.md` §4.7).
- **No change** to `canNext` (`wizard-container.tsx:52-59`): the note is optional; a pharmacist may download with only the step-1 `assessmentNotes`. Accepting a draft is encouraged but not mandatory (YAGNI — a hard gate would block the existing flow for pharmacists who prefer their own note).

### 4.7 PDF rendering (`src/components/combined-pdf.tsx`, modified)

`CombinedPdf` gains an optional `soapNote?: string` prop (`combined-pdf.tsx:159-169`). The existing notes block (`combined-pdf.tsx:301-306`) renders `soapNote ?? assessmentNotes`:

```tsx
{(soapNote ?? assessmentNotes) && (
  <View style={styles.notesBlock}>
    <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5, marginBottom: 1, color: TEAL }}>
      {soapNote ? "ASSESSMENT NOTE (SOAP)" : "ASSESSMENT NOTES"}
    </Text>
    <Text style={{ fontSize: 7 }}>{(soapNote ?? assessmentNotes)}</Text>
  </View>
)}
```

The `S:/O:/A:/P:` line prefixes in the template's `plain` rendering carry the structure into the PDF without a PDF-layout change. A richer multi-column SOAP PDF layout is a nice-to-have flagged as an Open Question (§7). The referral PDF (`referral-pdf.tsx`) is **not** touched in this iteration — it is a physician letter, structurally distinct; adopting the SOAP note there is a separate open question.

### 4.8 Persistence + audit (fly.io + Supabase, extending #2)

- **fly.io `assessment` table** (`persist-assessments-flyio-design.md` §4.3): add two columns — `soap_note text` (the accepted SOAP narrative, PHI) and `note_provider text` (origin: `template` | `azure-openai` | `manual` | …; PHI-adjacent record metadata, lives on fly.io with the row). `saveAssessmentAction` (`persist-assessments-flyio-design.md` §4.7) threads `soapNote`/`noteProvider` into the insert payload; PHI_PERSIST_ENABLED-gated as in #2.
- **Supabase non-PHI audit:** add `"notes.ai_drafted"` to the `EventType` union (`audit-actions.ts:5-18`) and to `audit.event_type`. Metadata is **strictly** `{ provider, model }` — never the note text, never the ailment, never any patient field. Extend the `log_event` validation (mirroring #2's `assessment.saved` discipline) to require `provider` and reject any clinical/patient key. Emitted **only** in the Phase-2 server action (`draftNotesWithAiAction`, §4.3); the Phase-1 template path is fully client-side and emits nothing to Supabase (its usage is captured in the fly.io `note_provider` column for #14 outcomes, not in the non-PHI log).

---

## 5. Security / PHIPA-PIPEDA Posture

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| Accepted `soapNote` (the SOAP narrative about a specific patient) | **PHI** (clinical reasoning identifying a patient) | **fly.io** `assessment.soap_note` (extends #2). Never Supabase. |
| `noteProvider` (origin tag) | PHI-adjacent record metadata | **fly.io** `assessment.note_provider`. Not in Supabase audit (it is record metadata, not a standalone event field). |
| The Phase-1 template computation (inputs + output) | PHI in memory, but **no disclosure** — pure local client computation | Never leaves the browser; never sent to a server in Phase 1. |
| The Phase-2 LLM prompt (PII-stripped clinical payload) | **PHI** — clinical content describes the patient's state (roadmap §6.4) even with direct identifiers removed | Transient disclosure **only** to the BAA'd provider over TLS; never logged, never persisted outside the provider's zero-retention window. |
| LLM provider response (the polished draft) | PHI once associated with the patient | Held in client state until accept; on accept, routed to fly.io `soap_note` via #2. |
| `notes.ai_drafted` Supabase audit metadata `{ provider, model }` | **Non-PHI** — a software/provider tag, no patient data, no clinical content | **Supabase** `audit.log`. |
| Provider API key (`AI_NOTES_API_KEY`), endpoint, model | Secret / config | Server-only env vars; never `NEXT_PUBLIC_`. |

**Rule of thumb (roadmap §6.4):** the *note* describes a patient's clinical state → fly.io. The *fact that an AI drafted it* is software telemetry → Supabase (non-PHI). The *clinical payload sent to the model* is PHI → only a BAA'd provider may see it.

### 5.2 The AI-tier disclosure controls (the new controls this feature introduces)

1. **Hard BAA gate.** The Phase-2 path runs only when `AI_NOTES_ENABLED === "true"` AND a provider endpoint is configured AND the provider operates under a signed BAA with **zero-retention / no-training** terms. Azure OpenAI (HIPAA-eligible, BAA, no customer-data training) is the recommended provider; AWS Bedrock Claude is acceptable; plain `api.openai.com` is **not** acceptable without the OpenAI Enterprise BAA + zero-retention addendum. The spec records this as a launch prerequisite, not a code detail.
2. **PII stripping.** The prompt payload **excludes** direct identifiers — `patient.name`, `dob`, `ohip`, `address`, `city`, `postalCode`, `phone`, and all `doctor*` fields. Only clinical content (ailment, symptoms, red-flag-screen result, regimen, advice, follow-up, the pharmacist's observations) is sent. This does **not** de-identify the payload under HIPAA safe-harbor (clinical content is still PHI per roadmap §6.4), but it minimises the blast radius: a provider breach exposes clinical state, not identity.
3. **No PHI in logs or audit.** The provider request/response is never `console.log`ged, never written to Supabase, never written to fly.io except as the accepted `soap_note`. The only Supabase trace is `{ provider, model }`.
4. **No clinical decision by the model.** The system prompt forbids adding clinical facts, changing the regimen, or interpreting red flags (§4.4) — keeping the LLM out of the PMS-owned clinical-safety lane (roadmap §3).
5. **Human-in-the-loop accept.** An unreviewed draft never persists and never prints. The pharmacist's explicit "Use this note" click is the act that makes it the record; their subsequent edits reset acceptance. This is the accountability safeguard: the pharmacist is the author of record, the model is a drafting assistant. `note_provider` records origin, not authorship.

### 5.3 Regulatory mapping

- **PHIPA:** the accepted note is a health-information record; it lives on fly.io under the same controls #2 establishes (AES-256 at rest, TLS in transit, pharmacy-scoped access, `phi_audit_log` hash chain). The Phase-2 disclosure to the BAA'd provider is a permitted use (treatment/documentation) provided the BAA is in place — identical legal posture to #2's fly.io storage being a third-party PHI handler.
- **PIPEDA Principle 4.1.3 (transfer to third party):** the LLM provider is a third party handling PHI for a documented purpose (note drafting). The signed BAA + zero-retention terms + minimised payload satisfy accountability; the provider's processing is limited to generating the draft and returning it.
- **PIPEDA Principle 4.4 (limit collection):** PII-stripping the prompt is the limiting measure — only the clinical content necessary to draft the note is sent.
- **PHIPA s.17 (cross-border):** the LLM provider's inference region matters. Azure OpenAI in a **Canada region** (e.g., `canadaeast`/`canadaecentral`) or Bedrock in a Canadian region keeps PHI in-country, consistent with #2's Canadian-region fly.io requirement (`persist-assessments-flyio-design.md` §5.2). The spec records region selection as a provisioning decision.
- **No FDA 21 CFR Part 11 implication** (roadmap §6.1 confirms the tool is not a GxP/validated system); AI-drafted notes are documentation assistance, not electronic records under Part 11.
- **Clinical-safety boundary (roadmap §3):** the model drafts prose; it performs **no** allergy, interaction, pregnancy, or red-flag logic. The PMS owns all clinical-safety automation, exactly as #6's differentials are advisory-only.

### 5.4 Application security

- **No new required dependency.** The provider call is a raw `fetch`; `package.json` stays clean. The template tier adds zero dependencies. (If a reviewer prefers a provider SDK, it would be an optional dependency behind the flag — but raw `fetch` is recommended for swappability and minimal surface.)
- **Server-only secrets.** `AI_NOTES_API_KEY`, `AI_NOTES_ENDPOINT` are never `NEXT_PUBLIC_`; the `draftNotesWithAiAction` server action is the only caller. The client never sees the key.
- **Auth on the AI path.** `draftNotesWithAiAction` calls `requireAuth()` (`auth-guards.ts:44`) — an unauthenticated user cannot reach the provider. A pharmacist with no `pharmacyId` gets the template fallback (no AI call).
- **Fail-safe, not fail-open.** Any provider error, timeout, or misconfiguration degrades to the deterministic template — the pharmacist is never blocked and no partial PHI state is left. The catch in §4.3 enforces this.
- **Prompt-injection resilience.** The model is instructed to ignore instructions embedded in `assessmentNotes` (the only free-text input the pharmacist controls) and to add no clinical facts. The output is always shown to the pharmacist for review before use, so a malformed draft is caught at the accept gate.

---

## 6. Edge Cases

- **AI off / unconfigured / provider down (Phase 1 or any time):** `draftNotesWithAiAction` returns the deterministic template draft (`provider: "template"`). The pharmacist proceeds normally; no error surface, no block. This is the defining resilience property — a counter tool cannot depend on an external model's uptime.
- **Pharmacist ignores the panel entirely:** `soapNote` stays `undefined`; the PDF falls back to `assessmentNotes` (existing behaviour, `combined-pdf.tsx:301-306`); `note_provider` is `"manual"` or null. Zero regression — the feature is additive.
- **Pharmacist edits the draft heavily:** any textarea edit resets `accepted=false`; the pharmacist must re-click "Use this note." The persisted `note_provider` still records the **origin** (`template`/`azure-openai`), accurately reflecting that an AI/tool produced the starting point the pharmacist edited — honest provenance for audit and #14 outcomes, without implying the AI authored the final text.
- **Pharmacist accepts, then changes the Rx (goes back to step 2):** the accepted `soapNote` is now stale relative to the new regimen. The panel re-derives the template draft from current wizard state on re-mount and flags the mismatch (the accepted note differs from a fresh draft) — the pharmacist re-reviews. (The plan details the re-derivation keying on a hash of `SoapDraftInput`.) For NOW the simplest correct behaviour is: if `selectedRx`/`symptomsChecked`/`nonRxChecked` change after accept, mark the note stale and require re-accept before download. Flagged in the plan.
- **Referral path (red flag checked):** the SOAP assembler still runs (`hasRedFlag=true` produces an Objective line stating the positive screen). The note is clinically useful on a referral too, but #7 scopes the PDF rendering to the prescribe path (`CombinedPdf`) for NOW; the referral PDF (`referral-pdf.tsx`) adoption is an Open Question (§7). The draft panel appears only on the prescribe terminal step (`step-generate.tsx`), not the referral branch (`wizard-container.tsx:142-172`).
- **Connectivity loss mid-AI-call:** the `fetch` rejects; the catch returns the template draft. The pharmacist is never stuck waiting. The `notes.ai_drafted` event is not emitted (no successful AI call) — accurate telemetry.
- **Provider returns a clinically altered draft (e.g. changes the dose):** the system prompt forbids it, but defensively the panel shows the draft for human review; the pharmacist is expected to catch and reject/edit. The persisted regimen is always the wizard's `selectedRx` (never the model's), so a model-hallucinated dose cannot reach the PDF's Prescription table (`combined-pdf.tsx:268-284`) — only the note text carries the model's wording, and the pharmacist reviews that text.
- **Free-text `assessmentNotes` contains patient-identifying detail (e.g. the pharmacist types the patient's occupation):** this PHI flows into the template (local, fine) and, in Phase 2, into the prompt. PII-stripping only removes *structured* identifier fields, not free-text. Mitigated by (a) the BAA covering any PHI in the prompt, and (b) the accept-gate review where the pharmacist sees exactly what will persist. Flagged as an Open Question (whether to add a light free-text identifier scrubber).
- **Two pharmacists, identical inputs:** the template produces an identical draft (deterministic); the AI tier may differ (model non-determinism). #14 outcomes should key on `note_provider` to separate template-draft adoption from AI-draft adoption. Not a defect — a measurable property.
- **Model latency at the counter:** a 2–4s round-trip is acceptable behind an explicit "Enhance with AI" click (not auto-fired on step entry). The template draft is shown **instantly** on panel mount so the pharmacist has a usable note before opting into the AI round-trip. This protects counter speed (roadmap §4).
- **`#11 pharmacist e-signature` interaction:** #7 produces the note the pharmacist will sign. `note_provider` provenance + #11's signature together form the complete "drafted by X, reviewed/edited and signed by pharmacist Y" record. No conflict; sequenced.
- **`#9 evidence citations` interaction:** the SOAP Plan section cites the regimen/follow-up but not the underlying evidence. #9 will later attach citations to protocol steps; the note's phrasing is unaffected. No NOW conflict.
- **Multilingual (#24 interaction):** the template and prompt are English in v1. #24 may later localize the note; the `NOTES_TEMPLATE_VERSION`/`NOTES_PROMPT_VERSION` discipline supports per-language versions. No NOW conflict.

---

## 7. Open Questions

1. **Provider procurement + BAA timing (the Phase-2 hard gate).** Confirm which BAA'd provider is procured (Azure OpenAI recommended; AWS Bedrock Claude acceptable) and that its BAA + zero-retention/no-training terms are executed AND its inference region is **Canadian** (`canadaeast`/`canadaecentral`) before `AI_NOTES_ENABLED` flips true. This is the single prerequisite for the AI tier going live; the template tier ships independently of it.
2. **Raw `fetch` vs. provider SDK.** The spec recommends a raw `fetch` to the provider REST endpoint to keep `package.json` clean and the provider swappable. If reviewers prefer the Azure/OpenAI SDK (better streaming/retry), it becomes an optional dependency behind the flag — confirm. Either way the call is a single request/response; streaming is YAGNI for a ~120-word note.
3. **Should the draft auto-fire on step entry, or require a click?** The spec recommends: show the **template** draft instantly on panel mount (zero latency, zero disclosure), and require an explicit "Enhance with AI" click for the LLM round-trip (avoids surprise PHI disclosures and surprise latency). Confirm.
4. **Stale-note detection after wizard back-navigation.** If the pharmacist accepts a note then goes back and changes the Rx/symptoms, the accepted note is stale. Options: (a) re-derive the template draft and require re-accept when `SoapDraftInput` changes, (b) allow the stale note through with a warning, (c) clear the note on back-nav. Recommend (a) for correctness; confirm the UX.
5. **Referral-PDF adoption.** The SOAP note is clinically useful on a referral too (the receiving physician wants the assessment). #7 scopes PDF rendering to the prescribe path (`CombinedPdf`). Should the referral path (`wizard-container.tsx:142-172`, `referral-pdf.tsx`) adopt `soapNote` in this tier or a LATER follow-up? Recommend LATER to keep the increment tight; the draft panel could optionally appear on the referral branch with a note that it prints on the referral letter once adopted.
6. **Free-text identifier scrubbing.** PII-stripping removes *structured* identifiers but not, say, a patient occupation the pharmacist typed into `assessmentNotes`. Should a light regex/NER scrubber run on free-text before it enters the prompt? Adds complexity for an edge case; recommend deferring unless review flags it, relying on the BAA + human review.
7. **`note_provider` semantics after heavy edit.** If the pharmacist accepts an AI draft then rewrites 90% of it, `note_provider` still records the AI origin. Is that the desired provenance semantics (origin), or should heavy edits flip it to `"manual"`? Recommend "origin" (honest, simple, queryable for #14); confirm.
8. **Richer SOAP PDF layout.** v1 renders the note as `S:/O:/A:/P:` prefixed lines in the existing notes block (`combined-pdf.tsx:301-306`). Should a future iteration render four labelled PDF sections? Recommend deferring — the prefixed-line form is readable and avoids a PDF-layout change; revisit if reviewers want a more polished document.
9. **Reconciliation with #2's `assessment_notes`.** #2 persists the step-1 free-text `assessmentNotes`; #7 adds `soap_note`. Both live on the fly.io `assessment` row. Confirm both columns are desired (raw input + final note) vs. collapsing to one. Recommend keeping both — the raw input is a useful audit input and the final note is the legal product; the cost is one extra column.
10. **Per-ailment note templates (clinical governance).** v1 uses a single universal SOAP assembler; ailment-specific phrasing comes from `data/ailments.json`. Should a later tier offer per-ailment curated note templates (authored under #26 governance)? Recommend LATER — YAGNI for the NEXT tier; the universal assembler + ailment data already produces ailment-specific notes.
11. **Usage analytics / adoption telemetry.** The `notes.ai_drafted { provider, model }` event captures AI-tier usage on Supabase; template-tier usage lives in the fly.io `note_provider` column. Is that sufficient for #13/#14, or should a non-PHI `notes.template_drafted` event also fire? Recommend deferring — the fly.io column covers the analytic need without a client→server round-trip on every template draft.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/notes/soap-template.ts` — deterministic SOAP assembler (`buildSoapNote`, `SoapDraftInput`, `SoapNote`, `NOTES_TEMPLATE_VERSION`); ships live, zero dependencies.
- `src/lib/notes/actions.ts` — `draftNotesWithAiAction` server action (Phase-2 AI tier; `requireAuth`, PII-stripped payload, raw-`fetch` to BAA'd provider, `notes.ai_drafted` audit, graceful template fallback); `callLlmProvider` helper; `NOTES_PROMPT_VERSION`.
- `src/components/wizard/soap-note-panel.tsx` — `<SoapNotePanel>` client component (draft textarea, provenance banner, "Enhance with AI" / "Use this note" human-in-the-loop accept).
- `src/__tests__/soap-template.test.ts` — determinism, SOAP-section presence, ailment-specific content from `data/ailments.json`, no-invention contract.
- `src/__tests__/notes-actions.test.ts` — flag-off/unconfigured → template fallback; `requireAuth` enforcement; PII-stripped payload shape; audit event metadata; provider-error → fallback (mocked `fetch`).
- `src/__tests__/soap-note-panel.test.tsx` — accept/edit/reset-accept contract, provenance display, loading state.

**Modified:**
- `src/types/index.ts` — add `NoteProvider`, `soapNote?`, `noteProvider?` to `AssessmentData` (`types/index.ts:59-67`).
- `src/lib/audit-actions.ts` — add `"notes.ai_drafted"` to the `EventType` union (`audit-actions.ts:5-18`).
- `src/components/wizard/wizard-container.tsx` — add `soapNote`/`noteProvider` state + `onAccept`; thread into `<StepGenerate>` (`wizard-container.tsx:173-183`).
- `src/components/wizard/step-generate.tsx` — render `<SoapNotePanel>` between the summary card and Download button (`step-generate.tsx:55-81`); forward `soapNote` into `<CombinedPdf>` and the persist payload.
- `src/components/combined-pdf.tsx` — accept `soapNote?` prop; render `soapNote ?? assessmentNotes` in the notes block (`combined-pdf.tsx:301-306`).
- `src/__tests__/combined-pdf-txid.test.tsx` (or a sibling) — assert SOAP note renders when present, falls back to `assessmentNotes` when absent.

**Database (fly.io, extending #2):** `ALTER TABLE assessment ADD COLUMN soap_note text, ADD COLUMN note_provider text;` (PHI; gated on `PHI_PERSIST_ENABLED`/BAA as in #2).

**Database (Supabase, non-PHI):** add `notes.ai_drafted` to `audit.event_type`; extend `log_event` validation to require `provider` and reject clinical/patient keys (mirroring #2's `assessment.saved` discipline).

**Environment (server-only):** `AI_NOTES_ENABLED`, `AI_NOTES_PROVIDER`, `AI_NOTES_ENDPOINT`, `AI_NOTES_API_KEY`, `AI_NOTES_MODEL` — all default-off/empty; the template tier needs none of them.

**Not touched (deliberately):** `data/ailments.json` (governance constraint); the referral path / `referral-pdf.tsx` (scoped out — §7.5); any clinical-safety logic (PMS-owned); `package.json` (raw `fetch`, no new required dependency). `PHI_PERSIST_ENABLED` / fly.io are NOT required for the template tier (ships live) and NOT required for the AI tier's *drafting* (the draft is returned to the client); they are required only for *persisting* the accepted note, which rides #2.
