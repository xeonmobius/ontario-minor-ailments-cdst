# #10 — Automated PROM Follow-up Pipeline (Design Spec)

**Date:** 2026-06-24
**Roadmap feature:** `cdst-competitive-roadmap-design.md` §5, NEXT tier, row #10 — *"Automated PROM follow-up pipeline — signed-link SMS (Twilio) / email (Resend) at T+3 / T+7, patient answers structured Patient-Reported Outcome questions on a no-login page, responses land in fly.io (BAA). SMS/email carry no PHI; link is HMAC-signed, expiring, single-use."*
**Edge axis:** Retention/Compliance — *"Beats MAPflow patient-led follow-up; builds the structured outcomes dataset that feeds #14. Pennies/consult."*
**Depends on (foundation specs):** #2 `persist-assessments-flyio` (fly.io `patient`/`assessment`/`phi_audit_log` + `resolvePatientId` + `PHI_PERSIST_ENABLED`), #3 `digital-consent-capture` (`consent.consent_to_followup` gate), #8 `patient-pre-intake-link` (`src/lib/signed-links/` purpose-tagged `"prom_followup"` + the no-login unauthenticated-write discipline + single-use-on-resource pattern).
**Feeds:** #14 (outcomes study), #25 (revenue-leakage optimizer), #26 (clinical content governance), #27 (validated PROM library, LATER).

---

## 1. Purpose

### 1.1 The gap

The CDST today ends every consult at the document: once the pharmacist downloads the prescription PDF (`step-generate.tsx:47`) or referral PDF (`wizard-container.tsx:89` `handleDownloadReferral` → `downloadPdf`), the encounter is closed and the tool never re-engages the patient. A `rg` for `prom|PROM|followup|follow_up|cron|schedule|twilio|resend|sendSms|sendEmail|dispatch` across `src/` returns **zero matches**; `package.json:13-28` carries no Twilio/Resend SDK and no scheduler. The only "follow-up" that exists is the free-text `followUp` string baked into `data/ailments.json` for each of the 19 ailments (e.g. UTI at `data/ailments.json:906`: *"Advise patient to return if no improvement in 48–72h Refer if symptoms worsen…"*) — it is printed on the PDF and handed to the patient, then abandoned. There is no mechanism to *check whether the patient actually returned*, no structured outcome capture, and no dataset a pharmacist or researcher could later query to answer *"did this regimen work?"*.

This is exactly the gap the roadmap names and the competitive differentiator it targets. MAPflow's follow-up is *"patient-led"* (the patient must remember and self-report); PharmAssess has none. The roadmap's framing is explicit that the win is **automated, structured, pennies-per-consult** follow-up that builds the real-world-outcomes dataset MAPflow used to publish its headline *"88.6% UTI clinical cure"* result (`cdst-competitive-roadmap-design.md` §2, §5 row #10, and the §5 LATER row #14 *"Outcomes data → publish study"*).

### 1.2 The goal of this feature

Build the **automated Patient-Reported Outcome (PROM) follow-up pipeline** that, at configurable intervals after a consult (roadmap default **T+3 days** and **T+7 days**), sends the patient a **no-login signed link** over **SMS (Twilio)** or **email (Resend)**, the patient opens the link on their phone and answers a **small set of structured outcome questions** on a purpose-built no-login page, and the responses land as **PHI on fly.io under the BAA** (behind `PHI_PERSIST_ENABLED`, exactly like #2/#3/#4/#8's PHI writes). The SMS/email body carries **no PHI** — it is a bare URL plus the pharmacy name — so the carriers (Twilio, Resend) are conduits and require no BAA themselves. The link is the **HMAC-signed, expiring, single-use** token #8 already built (`src/lib/signed-links/`), consumed with `purpose: "prom_followup"`.

The feature comprises five parts: (a) a **versioned, hashed PROM instrument module** (`src/lib/clinical/prom.ts`) holding a universal baseline questionnaire plus per-ailment overlays, applying the now-firm content-governance precedent (#3 statements, #4 reasons, #6 differentials, #22 catalog, #9 citations); (b) a **scheduler route** (`/api/cron/prom-dispatch`, bearer-protected) that finds due assessments, signs tokens, and dispatches messages; (c) a **non-PHI dispatch ledger on Supabase** (`prom_dispatch`) tracking what was sent, so the dashboard and #13/#25 analytics can query follow-up activity without touching PHI; (d) a **PHI response table on fly.io** (`prom_response`) holding the patient's answers, joined to #2's `assessment`; (e) a **no-login `/prom/[token]` page** plus token-gated `submitPromAction` server action that writes the response atomically (single-use via `responded_at IS NULL`, the #8 pattern ported to fly.io).

### 1.3 Out of scope

Per roadmap §3, §6, and YAGNI for the NEXT tier: **automated clinical decision-making from responses** (a "worse" answer does not auto-book or auto-prescribe — it surfaces a flag for the pharmacist, exactly as `step-redflags.tsx:56-82` is a pharmacist-worked checklist, not an automated gate; the PMS owns clinical-safety); **billing for the follow-up** (PMS-owned); **the validated per-condition PROM library** (roadmap #27, LATER — #10 ships a universal baseline instrument + the versioning discipline #27 expands); **vaccination second-dose reminders** (#22 flagged these as forward-compat on `vaccination.dose_number`/`series_total`; #10's scheduler + transport are reusable, but v1 is scoped to the minor-ailments assessment to keep the increment tight); **in-app/pharmacist-side outcome charting** (roadmap #13 analytics, LATER); **two-way SMS conversation** (the message is one-way: a single link; replies are not parsed); and **identity-proofing the responder** (the response is **patient-attested** — whoever holds the single-use signed link is taken to be the patient, exactly as #8's pre-intake is patient-attested). As with every feature that touches PHI, fly.io is not yet provisioned and the BAA is not signed (roadmap §7 #1/#2), so #10 ships the **non-PHI plumbing live in Phase 1** (the dispatch ledger, the scheduler route, the no-login page, the manual "Send follow-ups" dashboard button, the signed-link consumption, the instrument module) and gates the **PHI response write** behind `PHI_PERSIST_ENABLED` — the established stub-behind-flag pattern (#1 e-fax, #2 persist, #3 consent, #4 refusal, #8 pre-intake).

---

## 2. Current State (what exists in code today)

### 2.1 No follow-up infrastructure of any kind

A repository-wide `rg "prom|PROM|followup|follow_up|cron|schedule|twilio|resend|sendSms|sendEmail|dispatch"` over `src/` returns **no matches**. `package.json:13-28` carries `@supabase/ssr`, `@supabase/supabase-js`, `@react-pdf/renderer`, `lucide-react`, `next`, `react`, and styling utilities — **no Twilio SDK, no Resend SDK, no node-cron, no queue library**. There is no `/api/cron/*` route: the only API routes are `src/app/api/auth/{login,logout,signup,switch-pharmacy}/route.ts`. There is no background-worker, no scheduled-function, and no outbound-message code path anywhere.

### 2.2 The "follow-up" that does exist is decorative text

Each of the 19 ailments carries a single free-text `followUp` string in `data/ailments.json` (the `Ailment.followUp` field, `types/index.ts:15`). Representative samples: acne (`data/ailments.json:906` wait — acne is `:64`) *"Reassess in 6–8 weeks; expect improvement by 2–3 months Refer if no improvement or worsening"*; UTI (`:906`) *"Advise patient to return if no improvement in 48–72h Refer if symptoms worsen or systemic symptoms develop"*; conjunctivitis (`:253`) *"Bacterial: reassess in 48h Viral/allergic: reassess in 3 days…"*. These strings are rendered onto the prescription PDF (`combined-pdf.tsx`) and the referral PDF (`referral-pdf.tsx`) and handed to the patient — then the tool's engagement with that patient ends. The cadence baked into these strings (48h, 3 days, 7 days, 2 weeks, 6–8 weeks) is the natural source for #10's per-ailment dispatch windows, but it is **advisory text only**, not an executable schedule, and the gnhf constraint forbids editing `data/` — so #10 derives its cadence in a TS module, not by editing `ailments.json`.

### 2.3 The persistence + identity + consent foundation #10 needs is specced (not yet shipped)

#10 is a pure consumer of three foundation specs, all of which are committed but not yet implemented (the gnhf constraint forbids `src/` edits):

- **#2 `persist-assessments-flyio-design.md` §4.3** defines the fly.io `patient` table (identity index keyed by `identity_hash` via `src/lib/phi/identity.ts`), the `assessment` table (one row per consult, carrying `ailment_slug`, `outcome`, `patient_snapshot`, `created_at`), and `phi_audit_log` (hash-chained). It recommends a `resolvePatientId({ pharmacyId, identity })` helper (#3's iteration-4 learning). The `assessment` row is the **source of truth** for "a consult happened that may need a follow-up" — its `created_at` is T+0, its `ailment_slug` selects the PROM instrument, and its `outcome` gates whether a follow-up is meaningful (`prescribed`/`not_prescribed` yes; `abandoned` no).
- **#3 `digital-consent-capture-design.md` §4.5** adds `consent_to_followup boolean NOT NULL DEFAULT false` to the fly.io `consent` table (`digital-consent-capture-design.md:212`) and names it *"the opt-in that roadmap #10 keys off"* (`:65`). The scheduler **must** join `assessment` → `consent` on `consent_id` and skip any assessment whose consent row has `consent_to_followup = false`. This is the PHIPA/PIPEDA consent gate — no follow-up is ever sent without it.
- **#8 `patient-pre-intake-link-design.md` §4.2** built `src/lib/signed-links/index.ts` — `signLink`/`verifyLink`/`newResourceId`, the `SignedLinkPurpose = "pre_intake" | "prom_followup"` union (`patient-pre-intake-link-design.md:103`), HMAC-SHA256 over `payload + "|" + purpose` with `timingSafeEqual`, and the explicit note (§5.3.4, `:291`) that *"This is the pattern #10's PROM pages will reuse (single-use keyed on `prom_response.responded_at`)."* #10 consumes `verifyLink(token, "prom_followup")` verbatim and adds **no** new crypto.

### 2.4 The unauthenticated-write discipline is already established

#8 established how the CDST handles a patient with no Supabase session writing through the app: the **token is the credential**, the only Supabase mutation the unauthenticated path performs is a single narrow `SECURITY DEFINER` RPC (`consume_pre_intake_slot`, `patient-pre-intake-link-design.md:211`), and the PHI write goes to fly.io behind `PHI_PERSIST_ENABLED` (`submitIntakeAction`, `:154`). #10's `submitPromAction` is the structural twin: token-gated, single-use enforced atomically at the fly.io `prom_response` row, and a single `SECURITY DEFINER` RPC (`mark_prom_responded`) flips the Supabase dispatch-ledger status so the dashboard reflects the response without an auth'd round-trip.

### 2.5 The dashboard and server-action shape #10 extends

The dashboard (`src/app/page.tsx:60` renders `<AilmentGrid>`) is where the manual "Send follow-ups now" fallback button lives (alongside #8's planned `<IntakePicker>`). The server-action shape is fixed by `reserveTxId()` (`src/lib/prescription-actions.ts:6-24`): `requireAuth()` → derive `{ pharmacistId, pharmacyId }` → perform the side effect scoped to `pharmacyId` → return a typed result. `logAuditEvent` (`src/lib/audit-actions.ts:20-35`) is the non-PHI audit channel; its `EventType` union (`:5-18`) gains the two new events `prom.dispatched` and `prom.responded`.

---

## 3. Approach (options)

### 3.1 Option A — Cron route + Supabase dispatch ledger + fly.io PHI responses + versioned instrument + raw-fetch transport + no-login `/prom/[token]` (RECOMMENDED)

A **bearer-protected cron route** `/api/cron/prom-dispatch` (invoked by fly.io's scheduler or any external cron via `CRON_SECRET`) queries fly.io for assessments whose `created_at` falls in the T+3 / T+7 windows **and** whose `consent.consent_to_followup = true` **and** which have no matching row in the **non-PHI Supabase `prom_dispatch` ledger** for that touch. For each due assessment the route: resolves the per-ailment PROM instrument from `src/lib/clinical/prom.ts`; inserts an empty `prom_response` row on fly.io (pinning the instrument version + hash + questions snapshot for #14/#26 reproducibility); signs a `"prom_followup"` token (resourceId = `prom_response.id`, TTL 7 days) via #8's `signLink`; inserts a `prom_dispatch` row on Supabase (non-PHI: `assessment_id` opaque UUID, token id, touch, channel, status); reads the patient's phone (preferred) or email from fly.io; and dispatches a single SMS (Twilio) or email (Resend) whose body is **the bare URL plus the pharmacy name — no PHI**. The patient opens the no-login `/prom/[token]` page, answers the questions, and `submitPromAction` (token-gated, unauthenticated) atomically `UPDATE … WHERE responded_at IS NULL RETURNING` on fly.io (single-use) and flips the Supabase ledger to `responded` via the `mark_prom_responded` RPC.

- **Pros:** Faithful to the roadmap framing ("automated", "signed-link SMS/email", "T+3/T+7", "no-login page", "responses land in fly.io", "SMS/email carry no PHI", "HMAC-signed, expiring, single-use" — every clause maps to a concrete component). Reuses **three** established patterns simultaneously: the **non-PHI-ships-live / stub-behind-flag** split (#1/#2/#3/#4/#8) so the ledger + scheduler + page + transport ship live while the PHI response write waits on fly.io/BAA; the **content-governance** module pattern (#3/#4/#6/#22/#9) for the instrument; and the **no-login token-gated unauthenticated write** discipline (#8) for the patient response. Partitioning is compliance-honest: PHI (responses, contact destination) on fly.io; non-PHI (the dispatch ledger — assessment_id is an opaque UUID per #2 §5.1, channel *type* not destination, timestamps) on Supabase; the token and the carrier body carry no PHI so **no BAA is required with Twilio or Resend** (they are conduits under PIPEDA 4.1.3 — see §5). Sibling-friendly: #14 (outcomes) queries `prom_response` joined to `assessment`; #25 (leakage) queries `prom_dispatch` (non-PHI, no BAA needed for the analytics read); #26 versions the instrument; #27 expands the instrument module; #22's second-dose reminders reuse the scheduler + transport. Raw-`fetch` to the providers (no SDK) keeps `package.json` clean and the provider swappable via env, exactly as #7's AI-notes spec resolved.
- **Cons:** Introduces the system's **first scheduled/async surface** (the cron route) — Next.js has no built-in scheduler, so the route depends on an external invoker (fly.io cron, GitHub Actions, cron-job.org) hitting it with `CRON_SECRET`. This is a real ops dependency (mitigated: the route is a plain `GET`/`POST` handler, idempotent and safe to re-run; and a **manual "Send follow-ups now" dashboard button** ships as the Phase-1 fallback so the feature has value before any scheduler is wired). Adds two new tables (one per store) and one new public route (mitigated: the route's only mutation is token-gated + single-use + writes only the gated fly.io row + one narrow Supabase RPC; identical trust model to #8's `/intake/[token]`). The T+7 second touch adds a state machine (mitigated: a single `touch` integer + anti-join on the ledger; trivially testable).

### 3.2 Option B — Supabase `pg_cron` + Edge Function dispatch, all on Supabase

Run the scheduler as a Supabase `pg_cron` job invoking an Edge Function, with the dispatch ledger **and** the responses both on Supabase.

- **Pros:** One platform; Supabase-native scheduling.
- **Cons:** **Violates the partitioning rule** (roadmap §6.2/§6.4) — PROM responses are PHI ("describe their clinical state", `persist-assessments-flyio-design.md` §5.1) and must live on fly.io under BAA, never Supabase. The scheduler **must read fly.io** to find due assessments and patient contacts (the assessment rows and the patient phone/email are PHI on fly.io), so an Edge Function would need a network tunnel / postgres FDW to fly.io — a heavy ops surface for a pennies-per-consult feature. `pg_cron` + Edge Functions split the logic across two runtimes and two query models. **Rejected** for the partitioning violation alone (it is precisely the architecture the roadmap was written to forbid), and doubly rejected for the operational complexity of cross-store scheduling.

### 3.3 Option C — Manual "Send follow-ups" button only (no automated scheduler)

The pharmacist clicks a dashboard button that runs the dispatch for their pharmacy's due assessments; no cron, no T+3/T+7 automation.

- **Pros:** Zero ops dependency (no scheduler, no `CRON_SECRET`); simplest possible first cut.
- **Cons:** **Defeats the roadmap's explicit "Automated" framing** and the core retention value — a manual button the pharmacist forgets to click is strictly worse than MAPflow's patient-led model. The structured-outcomes dataset (#14) would be riddled with selection bias (only proactively-followed-up patients). The pennies-per-consult economics depend on zero pharmacist touch-time, which a manual button reintroduces.
- **Role in the recommendation:** Option C is **not rejected — it is absorbed into Option A as the Phase-1 fallback**. The exact same dispatch logic powers both the cron route and the manual button; before any external scheduler is wired (or if `CRON_SECRET` is unset), the dashboard button is the live surface, and the cron route becomes the automated upgrade with no code change to the dispatch core.

### Recommendation

**Option A** (with C as the live Phase-1 fallback). It is the faithful, compliance-honest implementation of roadmap #10's every clause, it reuses the three patterns the immediately-preceding NEXT-tier features (#6/#7/#8/#9) already established (so it introduces **no** new architectural decision), and it composes cleanly with the #14/#25/#26/#27 siblings. The one new component (the cron route) is a thin, idempotent, bearer-protected handler over logic the manual button also exercises — the automation is a deployment choice, not a code rewrite.

---

## 4. Components & Data Model

### 4.1 Versioned PROM instrument module (`src/lib/clinical/prom.ts`, new)

Applies the content-governance precedent verbatim (#3 statements, #4 reasons, #6 differentials, #22 catalog, #9 citations): curated clinical content that needs a reproducible hash lives in a versioned TS module under `src/lib/`, never in `data/`. The instrument is keyed by ailment slug with a **universal baseline** applied to every ailment and optional **per-ailment overlays**. The `PROM_INSTRUMENT_VERSION` + `computePromInstrumentHash()` feed #26 governance and #14 outcomes reproducibility.

```ts
// src/lib/clinical/prom.ts
import { createHash } from "node:crypto"

export const PROM_INSTRUMENT_VERSION = "prom-instrument-v1"

export type PromAnswerType = "single_choice" | "free_text"

export interface PromQuestion {
  id: string                         // stable, e.g. "symptom_resolution"
  type: PromAnswerType
  prompt: string                     // patient-facing, EN in v1 (#24 localizes LATER)
  options?: string[]                 // for single_choice
  required: boolean
}

export interface PromInstrument {
  slug: string                       // ailment slug, or "universal"
  touchWindows: { touch: number; offsetDays: number }[]  // [{touch:1, offsetDays:3},{touch:2, offsetDays:7}]
  questions: PromQuestion[]
}

export const PROM_INSTRUMENTS: PromInstrument[] = [ /* … see §4.1.1 … */ ]

export function getPromInstrument(ailmentSlug: string): PromInstrument
export function computePromInstrumentHash(): string  // sha256 of the deterministic JSON of PROM_INSTRUMENTS
export type ClinicalOutcome = "resolved" | "improved" | "same" | "worse" | "saw_physician" | "no_response"
export function deriveClinicalOutcome(answers: Record<string, string>): ClinicalOutcome
```

The **universal baseline** questions (applied to all 19 ailments unless an overlay replaces them) mirror the structure MAPflow published for UTI cure-rate and the cadence hints in `data/ailments.json`:

1. `symptom_resolution` (single_choice, required): *"How are your symptoms compared to when you saw the pharmacist?"* → `["Completely gone","Improved","About the same","Worse"]` → maps `deriveClinicalOutcome` to `resolved`/`improved`/`same`/`worse`.
2. `saw_physician` (single_choice, required): *"Since your visit, have you seen a doctor or gone to an emergency department for this?"* → `["No","Yes"]` → contributes `saw_physician` to the derived outcome when `Yes`.
3. `adherence` (single_choice, optional): *"Did you take the medication as advised?"* → `["Yes, all of it","Some of it","None of it","I was not given a medication"]` (meaningful only for `outcome='prescribed'`).
4. `free_comment` (free_text, optional): *"Anything else you'd like us to know?"` (PHI — stored, never sent onward).

**Per-ailment overlays** are minimal in v1 (the validated per-condition instruments are roadmap #27, LATER). The only v1 overlay is the **`touchWindows`** cadence, derived from each ailment's `followUp` text so the dispatch honours the printed advice: e.g. `uti` → `[{1,2},{2,3}]` (the string says "48–72h"); `conjunctivitis` → `[{1,2},{2,3}]` (bacterial 48h); `acne` → `[{1,42}]` (6–8 weeks, single touch); most others → the roadmap default `[{1,3},{2,7}]`. Where no overlay exists, the universal default `[{1,3},{2,7}]` applies. `getPromInstrument` always returns a complete instrument (universal questions + the ailment's cadence).

### 4.2 Scheduler route (`src/app/api/cron/prom-dispatch/route.ts`, new)

A `POST` (or `GET`) route handler, **bearer-protected** by `CRON_SECRET` (the standard Next.js-on-fly cron pattern). Idempotent and safe to re-run. Pseudocode:

```
1. Assert Authorization: Bearer === process.env.CRON_SECRET, else 401.
2. Optional ?pharmacyId= to scope (else all pharmacies with follow-up enabled).
3. Guard: if PHI_PERSIST_ENABLED !== "true" → 200 { skipped: "phi_disabled" } (nothing to schedule;
   responses have nowhere to land — see §5.4). The non-PHI ledger + page still shipped live.
4. For each (ailment, touch) window now due:
     a. SELECT due assessments from fly.io:
          assessment a
          JOIN consent c ON c.id = a.consent_id
          WHERE c.consent_to_followup = true
            AND a.outcome IN ('prescribed','not_prescribed')
            AND a.created_at::date = (now() - touch.offsetDays)::date
            AND NOT EXISTS (a matching prom_response row for this assessment + touch)
        (anti-join: the empty prom_response row is inserted at dispatch time, so its existence
         is the idempotency key — a re-run finds the row and skips.)
     b. For each due assessment:
          - instrument = getPromInstrument(a.ailment_slug)
          - promResponseId = newResourceId()                          // = the token resourceId
          - INSERT INTO prom_response (id, pharmacy_id, assessment_id, touch,
              instrument_version, instrument_hash, questions, status='awaiting_response')
              on fly.io (PHI — behind the guard already passed).
          - token = signLink({ resourceId: promResponseId, pharmacyId, purpose: "prom_followup" },
              DEFAULT_PROM_TTL_SECONDS /* 7d */)
          - url = `${APP_URL}/prom/${token}`
          - INSERT INTO prom_dispatch (Supabase, non-PHI): assessment_id, prom_response_id,
              touch, channel (resolved §4.5), status='pending', token_exp.
          - contact = SELECT phone, email FROM patient WHERE id = a.patient_id   // fly.io, PHI
          - dispatch via §4.4 transport (Twilio SMS if phone, else Resend email).
          - UPDATE prom_dispatch status 'sent' | 'failed', provider_message_id, error.
          - logAuditEvent('prom.dispatched', { prom_response_id, touch, channel })  // non-PHI
5. 200 { dispatched: n, failed: m }.
```

The dispatch **core** (`src/lib/prom/dispatch.ts`) is extracted so the manual dashboard button (`sendFollowupsNowAction`, §4.6) calls the same function for the active pharmacy — the cron route is simply the unattended invoker.

### 4.3 Transport (`src/lib/prom/transport.ts`, new) — raw `fetch`, no SDK

Mirrors #7's `ai-drafted-notes` raw-fetch-no-SDK stance. The Twilio SMS API and the Resend email API are each a single JSON `POST`; no `twilio`/`resend` package is added to `package.json`. Provider selection is by env (`PROM_SMS_PROVIDER`, `PROM_EMAIL_PROVIDER`); credentials are server-only (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`; `RESEND_API_KEY`, `RESEND_FROM`).

```ts
export type PromChannel = "sms" | "email"
export interface DispatchResult { channel: PromChannel; status: "sent" | "failed"; providerMessageId?: string; error?: string }

export async function sendPromMessage(args: {
  channel: PromChannel
  to: string                         // phone (E.164) or email — read from fly.io, never persisted to Supabase
  pharmacyName: string               // non-PHI, appears in the body
  url: string                        // the signed /prom/{token} URL — the entire PHI-safe payload
}): Promise<DispatchResult>
```

The **body carries no PHI**: SMS template `"{{pharmacyName}}: Please tell us how you're feeling after your visit: {{url}}"` and the email subject/body likewise. No patient name, no ailment, no drug, no symptom. This is the §5.4 PIPEDA 4.1.3 control that keeps Twilio/Resend as conduits (no BAA with them).

### 4.4 No-login page + token-gated submit (`src/app/prom/[token]/page.tsx`, new; `src/lib/prom/actions.ts`, new)

The page is a server component mirroring #8's `/intake/[token]`:

```
1. verifyLink(token, "prom_followup") → null ⇒ render "link invalid or expired".
2. getPromContextAction(token) → { pharmacyName, questions, touch }   // NO patient PHI to the client
     (the questions are reference content; pharmacyName is non-PHI. The ailment is NOT sent to the
      browser as a label — the questions are phrased generically ("your symptoms"), so the page reveals
      nothing the patient doesn't already know about themselves; see §5.3.)
3. Render a mobile-first <PromForm> with the questions, a PHIPA collection notice, and a Submit button.
4. On submit → submitPromAction(token, answers) (unauthenticated):
     a. verifyLink(token, "prom_followup") again (defence-in-depth).
     b. Validate every answer against the instrument's question set/types (reject foreign ids).
     c. Fly.io txn: UPDATE prom_response
          SET answers = $2, clinical_outcome = $3, responded_at = now(), submitted_from = 'web'
          WHERE id = $1 AND responded_at IS NULL
          RETURNING id;
        If 0 rows ⇒ { error: "already_submitted" } (single-use; the #8 consume pattern on fly.io).
     d. Supabase: call mark_prom_responded(prom_response_id) SECURITY DEFINER RPC → flips
          prom_dispatch.status = 'responded', responded_at = now() (non-PHI; near-real-time dashboard).
     e. logAuditEvent('prom.responded', { prom_response_id, touch }).   // non-PHI
     f. Return { ok: true }.
```

Single-use is therefore enforced **atomically at the fly.io row** (`responded_at IS NULL` in the `UPDATE … RETURNING`), exactly as #8 §5.3.4 promised; two concurrent submits cannot both succeed. The Supabase write is the one narrow `SECURITY DEFINER` RPC — identical trust model to `consume_pre_intake_slot`.

### 4.5 Data model — the non-PHI dispatch ledger (Supabase) + the PHI response (fly.io)

**Supabase `prom_dispatch` (non-PHI, RLS by `pharmacy_id`):** the record that a follow-up was dispatched. Carries **no contact destination** (phone/email stay on fly.io; read at dispatch, never persisted here) and **no ailment/drug/symptom**. `assessment_id` is the opaque UUID #2 §5.1 already ruled safe on Supabase.

```sql
-- Supabase, public schema. NON-PHI (no patient data, no ailment, no contact destination).
CREATE TABLE prom_dispatch (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id         uuid NOT NULL REFERENCES pharmacies(id),
  assessment_id       uuid NOT NULL,                 -- opaque UUID; = fly.io assessment.id (by value, no cross-DB FK)
  prom_response_id    uuid NOT NULL,                 -- = fly.io prom_response.id (by value); also the token resourceId
  touch               smallint NOT NULL,             -- 1 (T+3) | 2 (T+7) | …
  channel             text NOT NULL CHECK (channel IN ('sms','email')),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','delivered','failed','responded','expired')),
  token_exp           timestamptz NOT NULL,          -- denormalised from the signed token (cron expiry/cleanup)
  provider_message_id text,                          -- Twilio/Resend id (non-PHI; an opaque carrier id)
  sent_at             timestamptz,
  responded_at        timestamptz,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, touch)                      -- idempotency: one dispatch per assessment per touch
);
CREATE INDEX prom_dispatch_pharmacy_status ON prom_dispatch (pharmacy_id, status, created_at DESC);
CREATE INDEX prom_dispatch_response ON prom_dispatch (prom_response_id);
-- RLS: pharmacists read for their pharmacy. The unauthenticated patient path mutates ONLY via the
-- mark_prom_responded SECURITY DEFINER RPC (single narrow surface, mirroring #8 §4.5).

CREATE OR REPLACE FUNCTION mark_prom_responded(p_prom_response_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
  UPDATE prom_dispatch
     SET status = 'responded', responded_at = now()
   WHERE prom_response_id = p_prom_response_id AND status <> 'responded';
$$;
```

**fly.io `prom_response` (PHI, under BAA, behind `PHI_PERSIST_ENABLED`):** the patient's answers + the pinned instrument snapshot. Keyed by `id` (= the token resourceId), FK-by-value to `assessment.id` and through it to #2's `patient.id`.

```sql
-- fly.io Postgres. PHI (answers describe the patient's clinical state).
CREATE TABLE prom_response (
  id                 uuid PRIMARY KEY,               -- = the signed token's resourceId; created at dispatch
  pharmacy_id        uuid NOT NULL,
  assessment_id      uuid NOT NULL,                  -- = fly.io assessment.id (by value)
  patient_id         uuid NOT NULL REFERENCES patient(id),
  ailment_slug       text NOT NULL,                  -- denormalised from assessment for instrument reproducibility
  touch              smallint NOT NULL,
  instrument_version text NOT NULL,                  -- PROM_INSTRUMENT_VERSION at dispatch
  instrument_hash    text NOT NULL,                  -- computePromInstrumentHash() at dispatch (#26/#14)
  questions          jsonb NOT NULL,                 -- the exact question snapshot shown (reproducibility)
  answers            jsonb,                          -- NULL until submitted
  clinical_outcome   text CHECK (clinical_outcome IN
                       ('resolved','improved','same','worse','saw_physician','no_response')),
  status             text NOT NULL DEFAULT 'awaiting_response'
                     CHECK (status IN ('awaiting_response','responded','expired')),
  submitted_from     text,                           -- 'web' only (no IP/UA — §5.5, mirrors #8 §5.4)
  responded_at       timestamptz,                    -- NULL ⇒ still awaiting; the single-use gate
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, touch)                      -- one response row per assessment per touch
);
CREATE INDEX prom_response_pharmacy ON prom_response (pharmacy_id, created_at DESC);
CREATE INDEX prom_response_assessment ON prom_response (assessment_id, touch);
CREATE INDEX prom_response_outcome ON prom_response (ailment_slug, clinical_outcome);   -- #14 outcomes query
```

App-layer write discipline (inherited from #2 §5.3): every query injects `pharmacy_id` from the verified context; no `UPDATE`/`DELETE` is exposed for clinical content; the only mutation the unauthenticated patient path can perform is the single `UPDATE … WHERE responded_at IS NULL RETURNING` (single-use), and it is pharmacy-bound by the token's `pharmacyId`. A `phi_audit_log` row (`prom.responded`) is written in the same transaction.

### 4.6 Pharmacist-facing surfaces (dashboard)

- **Manual fallback button.** `sendFollowupsNowAction()` (`"use server"`, `requireAuth` + pharmacy scope) calls the same `dispatchDueForPharmacy(pharmacyId)` core as the cron route — so a pharmacy without an external scheduler still gets follow-ups when the pharmacist clicks. Ships live in Phase 1 (the dispatch ledger write is non-PHI; the fly.io insert + send are gated, so a click before fly.io/BAA logs the intent and no-ops the PHI write).
- **Follow-up activity panel.** A `<FollowupPanel>` on the dashboard (`src/app/page.tsx:60`, alongside `<AilmentGrid>` and #8's `<IntakePicker>`) lists recent `prom_dispatch` rows (non-PHI: touch, channel, status, sent_at, responded_at) and, for responded rows, a link to a pharmacist-side `<PromOutcomeViewer>` that fetches the PHI `prom_response` from fly.io (auth'd, `phi_audit_log`-logged `prom.viewed`). The outcome viewer is the thin #13-analytics preview and the pharmacist's clinical-safety surface for a "worse"/`saw_physician` answer that warrants outreach.

### 4.7 Non-PHI Supabase audit events

Two events added to the `EventType` union (`src/lib/audit-actions.ts:5-18`) and `audit.event_type`:

- `prom.dispatched` — metadata strictly `{ prom_response_id, touch, channel }`.
- `prom.responded` — metadata strictly `{ prom_response_id, touch }`.

`log_event` validation is extended to allow only those keys and to reject any patient/clinical/answer key (`patient_*`, `ailment`, `drug`, `answer*`, `outcome`, `name`, `dob`) — mirroring #2/#3/#8's discipline. `clinical_outcome` is PHI-adjacent (it is a clinical state) and stays OFF Supabase; the dashboard's outcome counts are computed from fly.io reads, not from the audit log.

---

## 5. Security / PHIPA-PIPEDA Posture

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| PROM answers, free-text comment, derived `clinical_outcome` | PHI (clinical state) | **fly.io** `prom_response`. Never Supabase. |
| Patient phone / email (the dispatch destination) | PHI | **fly.io** `patient.phone`/`email` (and `assessment.patient_snapshot`). Read at dispatch into memory, sent to the carrier, **never persisted to Supabase**. |
| `prom_response.questions` / `instrument_hash` / `ailment_slug` | PHI-adjacent (clinical reference tied to a patient) | **fly.io** `prom_response`. |
| `assessment_id`, `prom_response_id` (UUIDs) | Non-identifying | Allowed on **both** stores — the correlation keys (per #2 §5.1). Appear in `prom_dispatch` and in audit metadata. |
| `pharmacy_id`, `touch`, `channel`, dispatch `status`, timestamps | Non-PHI | **Supabase** `prom_dispatch`. |
| The signed token payload (`resourceId`, `pharmacyId`, `purpose`, `exp`) | Non-PHI | Transient (base64, not encrypted — carries no PHI by construction, §5.3). |
| SMS/email body (URL + pharmacy name) | Non-PHI | Transient to the carrier; never stored. |

### 5.2 The carrier is a conduit, not a processor — no BAA with Twilio/Resend

PIPEDA Principle 4.1.3 (use/disclosure to third parties) and PHIPA: because the SMS/email body is **a bare URL plus the pharmacy name** — no patient name, no ailment, no drug, no symptom — Twilio and Resend receive **no PHI**. They transmit a URL; they are conduits, not PHI processors. **No BAA / PHIPA agreement is required with Twilio or Resend** for #10 (contrast with #7's LLM provider, where the prompt is PHI and a BAA is mandatory; and #2's fly.io, where PHI is stored and a BAA is mandatory). The signed BAA with **fly.io** (the response store) remains a hard gate, inherited from #2. This is the roadmap's explicit framing: *"SMS/email carry no PHI"*.

### 5.3 Token security (inherited from #8, restated for #10)

1. **HMAC authenticity** — `base64url(payload).base64url(HMAC-SHA256(SIGNED_LINK_SECRET, payload + "|" + purpose))`; `verifyLink` uses `timingSafeEqual`.
2. **Purpose-binding** — the MAC covers `purpose`, so a `"pre_intake"` token cannot be replayed against the `"prom_followup"` verifier (and vice versa), preventing cross-feature token confusion (#8 §5.3.2).
3. **Expiry** — `exp` checked against `now`; default TTL **7 days** (a follow-up link must outlive a 3-day dispatch lag + a few days of patient delay; the `prom_dispatch.token_exp` is denormalised for cron cleanup).
4. **Single-use** — enforced atomically at the fly.io `prom_response` row (`UPDATE … WHERE responded_at IS NULL RETURNING`); a replayed token verifies but finds the row already responded. This is the exact pattern #8 §5.3.4 named for #10.
5. **Pharmacy binding** — the dispatch writes `prom_response`/`prom_dispatch` scoped to the token's `pharmacyId`; a token minted by pharmacy A cannot create a response for pharmacy B.

### 5.4 Regulatory mapping

- **PHIPA s.12 / s.10.1:** the PHI response is stored on fly.io under BAA with AES-256 at rest + TLS in transit + pharmacy-scoped access + hash-chained `phi_audit_log` (all inherited from #2). Every pharmacist read of a response writes `prom.viewed` to `phi_audit_log`.
- **PHIPA s.17 (cross-border):** fly.io regions in Canada (`yyz`/`yul`) — inherited from #2; no new cross-border decision. **Twilio/Resend routing:** SMS/email may transit non-Canadian carrier infrastructure, but because the body carries no PHI (§5.2), PHIPA s.17's restriction on taking PHI outside Ontario is not triggered — no PHI leaves Canada.
- **PIPEDA Principle 4.3 (consent) / 4.5 (limiting use):** the follow-up is sent **only** when #3's `consent_to_followup = true` — an explicit opt-in captured at the consult for exactly this secondary purpose. Patients who declined are never contacted.
- **PIPEDA Principle 4.4 (limiting collection):** the patient answers only the instrument's questions; no IP/UA/device is retained (`submitted_from = 'web'` literal only, mirroring #8 §5.4).
- **PIPEDA Principle 4.1.3 (third-party disclosure):** the carrier body is a bare URL + pharmacy name — no PHI disclosed to Twilio/Resend (§5.2).
- **PIPEDA Principle 4.8 (accountability) + breach notice:** the dispatch ledger + audit events give end-to-end accountability ("we sent a follow-up at T+3 to channel X; the patient responded at T+4").
- **Clinical-safety boundary (roadmap §3):** a `worse`/`saw_physician` answer **does not** trigger any automated clinical action — it surfaces a flag on the pharmacist's `<FollowupPanel>` for human follow-up. The PMS owns clinical-safety; #10 only collects and surfaces, exactly as `step-redflags.tsx:56-82` is a pharmacist-worked checklist.
- **No FDA 21 CFR Part 11 implication** (roadmap §6.1 — not a GxP system; confirmed in user memory).

### 5.5 Application security

- **No new required dependency** (mirrors #7/#8/#9). The signed-link module is `node:crypto` (#8). Transport is raw `fetch` to Twilio/Resend REST endpoints — no `twilio`/`resend` SDK. The instrument hash is `node:crypto`.
- **Server-only secrets:** `SIGNED_LINK_SECRET` (inherited from #8), `CRON_SECRET`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM`, `RESEND_API_KEY`/`RESEND_FROM`, `NEXT_PUBLIC_APP_URL`. None prefixed `NEXT_PUBLIC_` except `APP_URL` (which is a public origin, not a secret).
- **Narrow unauthenticated surface:** the only unauthenticated mutations are `getPromContextAction` (read-only, returns instrument + pharmacy name) and `submitPromAction` (writes only via the atomic fly.io single-use `UPDATE … RETURNING` + the one `mark_prom_responded` Supabase RPC). Both token-gated; no unauthenticated Supabase PHI write path exists.
- **Fail-safe, not fail-open:** if `PHI_PERSIST_ENABLED` is off, `submitPromAction` renders a friendly "thank you, your response will be recorded at your next visit" message and writes nothing — the patient is never silently dropped, and no phantom response reaches the dashboard (mirrors #8 §5.7). The cron route no-ops (§4.2 step 3).
- **Idempotent dispatch:** `UNIQUE (assessment_id, touch)` on both tables + the anti-join make the scheduler safe to re-run and double-click-safe for the manual button.
- **Replay/forwarding resilience:** single-use + 7-day TTL + purpose-binding mean a forwarded link is worthless after first submit or after a week.

---

## 6. Edge Cases

- **`PHI_PERSIST_ENABLED` off (Phase 1 / before fly.io+BAA):** the dispatch ledger, scheduler route, no-login page, manual button, transport, and signed-link consumption all ship live; the cron route returns `{ skipped: "phi_disabled" }`; `submitPromAction` renders the friendly no-op message and writes nothing; the dashboard shows dispatched (non-PHI) rows but no responses. The structured-outcomes value ships when fly.io lands — identical to every #2-dependent feature.
- **Patient declined follow-up (`consent_to_followup = false`):** the scheduler's `JOIN consent` filter skips the assessment; no `prom_dispatch` row is created; no message sent. The opt-out is honoured and auditable by its absence.
- **Abandoned assessment (`outcome = 'abandoned'`):** excluded by the `outcome IN ('prescribed','not_prescribed')` filter — an abandoned consult has no regimen to follow up on.
- **Patient has neither phone nor email:** the dispatch resolves `channel = null` → `prom_dispatch.status = 'failed'`, `error = 'no_contact'`; no message sent; the row is visible on the dashboard as a missed follow-up (feeds #25 leakage optimizer). No PHI written.
- **Twilio/Resend failure (rate limit, invalid number, carrier bounce):** `prom_dispatch.status = 'failed'`, `error` recorded; the next cron run does **not** retry the same `(assessment_id, touch)` (the `UNIQUE` constraint + the existing `prom_response` row block re-dispatch). The pharmacist sees the failure on the panel and can manually re-trigger via a per-row "resend" action (out of scope for v1; flagged in §7).
- **Patient opens an expired link:** `verifyLink` returns null on `exp`; the page renders the "link no longer valid" message; the pharmacist can generate a fresh one-off link (future; v1 relies on the T+7 second touch).
- **Patient submits twice (or forwards the link, then both submit):** the atomic `WHERE responded_at IS NULL RETURNING` lets exactly one succeed; the second gets `{ error: "already_submitted" }`. No double-write.
- **Patient tampers the form (answers a question id not in the instrument):** `submitPromAction` validates every answer against the pinned `prom_response.questions` snapshot and rejects the payload; no foreign answer reaches fly.io.
- **T+3 dispatched, patient responds before T+7:** the T+7 scheduler's anti-join finds the touch-1 `prom_response` already `responded` and suppresses the second touch (`NOT EXISTS … for touch 2` evaluates against whether a touch-2 row exists, but the dispatch core additionally checks `touch-1 status='responded'` to avoid pestering a patient who already answered — a one-line guard in `dispatchDueForPharmacy`).
- **Cron never configured / `CRON_SECRET` unset:** the automated route is inert; the manual dashboard button is the live surface. No regression to today's behaviour.
- **Cron fires twice in the same minute (duplicate invocation):** idempotent — the `UNIQUE (assessment_id, touch)` constraints + the existing `prom_response` row make the second run a no-op; at worst a duplicate SMS is avoided by the `prom_dispatch.status IN ('pending','sent')` pre-check in the dispatch core.
- **`SIGNED_LINK_SECRET` rotation:** old tokens stop verifying (intended, inherited from #8 §7.4); in-flight follow-ups would need re-issuance. Recommend the dual-secret-with-grace mechanism #8's Open Question §7.4 flagged (verify against either secret, mint with the new) — #10 inherits whatever #8's plan decides.
- **Vaccination second-dose reminder (#22 forward-compat):** out of scope for v1 (assessment-only), but the scheduler + transport + `prom_response` shape are reusable: a vaccination reminder is a `prom_followup` token whose `prom_response.assessment_id` is generalised to an `encounter_id` + `encounter_type='vaccination'`, keyed on `vaccination.dose_number < series_total`. Flagged in §7.
- **Multilingual (#24):** the instrument + page are EN in v1; `PROM_INSTRUMENT_VERSION` supports per-language versions (`prom-instrument-v1-fr`); the token and ledger are locale-agnostic. No NOW conflict.
- **Interaction with #5 (slimmed `PatientInfo`):** phone stays on the post-#5 `PatientInfo` (it is needed for follow-up); #5 does not remove it. No conflict.

---

## 7. Open Questions

1. **Scheduler host.** The cron route is platform-agnostic, but something must invoke it. Confirm the preferred external invoker: fly.io's native cron (if the app deploys as a fly machine), a GitHub Actions scheduled workflow, or a third-party (cron-job.org). Each needs `CRON_SECRET` in its headers. Recommend fly.io cron if the app is on fly (co-located with the PHI store); confirm at provisioning.
2. **T+3/T+7 cadence vs the printed `followUp` advice.** The universal default `[{1,3},{2,7}]` is the roadmap's headline cadence, but several ailments' printed advice differs (UTI 48–72h, acne 6–8 weeks). Confirm whether v1 (a) honours the printed cadence per-ailment via `touchWindows` overlays (recommended — the follow-up matches the advice the patient was given), or (b) uses the universal 3/7 for all and defers per-ailment tuning to #27. Recommend (a) for the few high-volume ailments (UTI, conjunctivitis, dermatitis) and universal elsewhere.
3. **Channel selection policy.** When a patient has both phone and email, which wins? Recommended: SMS by default (higher open rate; roadmap leads with "SMS (Twilio) / email (Resend)"), email as fallback when no mobile/phone, with a per-pharmacy override env. Confirm.
4. **Retry/resend policy for failed dispatches.** v1 records the failure and does not auto-retry (the `UNIQUE` constraint blocks re-dispatch). Should the pharmacist-facing panel offer a per-row "resend" (new token, new touch row)? Recommend a follow-up increment; confirm it is not a launch gate.
5. **Retention of `prom_response`.** The response is a clinical outcome and part of the patient's record — recommend inheriting #2's ~10-year Rx retention (it is the evidence for #14). Confirm it is **not** a transient row like #8's `pre_intake_submission`. (Recommendation: durable, same retention as `assessment`.)
6. **Should `prom_dispatch` live to power #25, or is it transient?** It is recommended durable (non-PHI, cheap, and exactly what #25's "missed follow-ups" analytics needs). Confirm vs. a shorter cleanup window.
7. **`deriveClinicalOutcome` mapping governance.** The mapping from raw answers to the enum (`resolved`/`improved`/…) is clinical logic. Confirm it is pharmacist/clinical-review-governed content (like #4's `reasons.ts`), versioned with the instrument, and that `saw_physician=Yes` overrides to `saw_physician` regardless of symptom answer.
8. **Rate-limiting the public submit endpoint.** `submitPromAction` is token-gated and single-use, but the unauthenticated `/prom/[token]` POST is a public surface. Confirm whether a per-IP rate limit is a launch gate (recommend a lightweight limiter, mirroring #8 Open Question §7.11).
9. **Vaccination forward-compat in v1.** Confirm v1 is assessment-only and the vaccination second-dose reminder is a LATER increment (reusing this scheduler + transport), as scoped in §1.3.
10. **Twilio/Resend account + sender provisioning.** These are operational procurements (a Twilio phone number in E.164, a Resend verified domain). Confirm they are launch gates for the automated tier (the manual button + ledger + page ship without them; the transport is the final gate) and that the pharmacy name in the body is sourced from the verified Supabase `pharmacies.name`.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/clinical/prom.ts` — versioned PROM instrument module (`PROM_INSTRUMENTS`, `getPromInstrument`, `computePromInstrumentHash`, `PROM_INSTRUMENT_VERSION`, `deriveClinicalOutcome`); `node:crypto`-only, no new dependency.
- `src/lib/prom/dispatch.ts` — `dispatchDueForPharmacy({ pharmacyId?, now })` shared by the cron route and the manual button.
- `src/lib/prom/transport.ts` — `sendPromMessage` raw-`fetch` to Twilio/Resend; no SDK.
- `src/lib/prom/actions.ts` — `getPromContextAction` (token-gated read), `submitPromAction` (token-gated, atomic single-use write + `mark_prom_responded`), `sendFollowupsNowAction` (auth'd manual fallback).
- `src/lib/prom/store.ts` — fly.io `prom_response` read/write + `phi_audit_log` writes (extends #2's `src/lib/phi/` discipline).
- `src/app/api/cron/prom-dispatch/route.ts` — bearer-protected scheduler route.
- `src/app/prom/[token]/page.tsx` + `src/app/prom/[token]/prom-form.tsx` — the no-login patient page + mobile-first form + PHIPA collection notice.
- `src/components/dashboard/followup-panel.tsx` — dispatch-ledger activity panel (non-PHI) + outcome viewer (PHI, auth'd).
- `src/__tests__/prom-instrument.test.ts`, `src/__tests__/prom-actions.test.ts`, `src/__tests__/prom-transport.test.ts`, `src/__tests__/prom-form.test.tsx`.

**Modified:**
- `src/lib/audit-actions.ts` — add `"prom.dispatched"`, `"prom.responded"` to the `EventType` union (`audit-actions.ts:5-18`); metadata strictly `{ prom_response_id, touch, channel? }`.
- `src/app/page.tsx` — render `<FollowupPanel>` + the manual "Send follow-ups now" button (`page.tsx:60`).

**Database (Supabase, non-PHI):** `prom_dispatch` table + RLS + `mark_prom_responded` `SECURITY DEFINER` RPC (§4.5); `prom.dispatched`/`prom.responded` added to `audit.event_type`; `log_event` validation extended to allow only `{ prom_response_id, touch, channel? }` (reject patient/clinical/answer keys).

**Database (fly.io, PHI, behind `PHI_PERSIST_ENABLED`/BAA):** `prom_response` table (§4.5); writes via `submitPromAction` stub when the flag is off; `prom.responded`/`prom.viewed` actions added to `phi_audit_log.action`.

**Environment (server-only):** `CRON_SECRET`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM`, `RESEND_API_KEY`/`RESEND_FROM`, `NEXT_PUBLIC_APP_URL`; `SIGNED_LINK_SECRET` + `PHI_PERSIST_ENABLED`/`FLY_PHI_DATABASE_URL` inherited from #8/#2; `PROM_SMS_PROVIDER`/`PROM_EMAIL_PROVIDER` (optional).

**Not touched (deliberately):** `data/ailments.json` (governance constraint — cadence derives from a TS module reading the printed `followUp` text, not by editing data/); any clinical-safety logic / red-flag screen / Rx selection (PMS/pharmacist-owned, roadmap §3); `package.json` (no new dependency — raw `fetch` + `node:crypto`); the referral path / `referral-pdf.tsx`; #3's consent capture (orthogonal — #10 only **reads** `consent_to_followup`); the vaccination tables (#22 — forward-compat only, LATER increment); the signed-link module (#8 — consumed verbatim, not modified).
