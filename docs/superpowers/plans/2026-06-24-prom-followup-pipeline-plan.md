# #10 — Automated PROM Follow-up Pipeline (Implementation Plan)

**Date:** 2026-06-24
**Design spec:** `docs/superpowers/specs/2026-06-24-prom-followup-pipeline-design.md`
**Roadmap feature:** `cdst-competitive-roadmap-design.md` §5, NEXT tier, row #10.
**Foundation specs consumed (committed, not yet shipped — gnhf forbids `src/` edits):** #2 `persist-assessments-flyio`, #3 `digital-consent-capture`, #8 `patient-pre-intake-link`.

---

## Goal

Implement the automated PROM follow-up pipeline end-to-end as specified: a versioned instrument module, a bearer-protected cron scheduler route plus a manual dashboard fallback (sharing one dispatch core), a non-PHI Supabase dispatch ledger, a PHI fly.io response table, raw-`fetch` Twilio/Resend transport carrying no PHI, and a no-login `/prom/[token]` page with a token-gated, atomic, single-use submit. The non-PHI plumbing ships live in Phase 1; the PHI response write is gated behind `PHI_PERSIST_ENABLED` (the established stub-behind-flag pattern). Every step is independently verifiable; no step depends on fly.io/BAA being provisioned.

**Hard constraints honoured:** docs-only scope is *this plan's* deliverable; the plan itself prescribes `src/` changes for the future implementing engineer but introduces **no** new `package.json` dependency (raw `fetch` + `node:crypto` only), edits **no** file under `data/`, and respects the fly.io-BAA / Supabase-auth split throughout.

---

## Sequenced Steps

### Task 1 — Types + versioned instrument module (`src/lib/clinical/prom.ts`)

Create `src/lib/clinical/prom.ts` with the types and content from design §4.1: `PROM_INSTRUMENT_VERSION = "prom-instrument-v1"`, `PromQuestion`/`PromInstrument`/`ClinicalOutcome` types, the four universal-baseline questions (`symptom_resolution`, `saw_physician`, `adherence`, `free_comment`), `touchWindows` cadence overlays for the high-volume ailments (uti, conjunctivitis, dermatitis) derived from their printed `followUp` text, the universal default `[{1,3},{2,7}]`, `getPromInstrument(slug)`, `computePromInstrumentHash()` (sha256 over `JSON.stringify(PROM_INSTRUMENTS)` with deterministic key ordering), and `deriveClinicalOutcome(answers)`. Apply the content-governance precedent (#3/#4/#6/#22/#9): a TS module under `src/lib/`, never `data/`.

**Verify:** `computePromInstrumentHash()` is deterministic across runs (same input ⇒ same hash); `getPromInstrument` returns a complete instrument for every one of the 19 slugs; `deriveClinicalOutcome` maps the four `symptom_resolution` options correctly and overrides to `saw_physician` when `saw_physician=Yes`.

### Task 2 — fly.io `prom_response` migration (PHI, behind `PHI_PERSIST_ENABLED`)

Add the `prom_response` table DDL (design §4.5) to the fly.io migration set #2 established: PK `id` (= token resourceId), `assessment_id`/`patient_id` by value, `ailment_slug`, `touch`, `instrument_version`, `instrument_hash`, `questions` jsonb, `answers` jsonb nullable, `clinical_outcome` CHECK enum, `status` CHECK enum default `awaiting_response`, `submitted_from`, `responded_at` nullable (the single-use gate), `UNIQUE (assessment_id, touch)`, indexes (`pharmacy_id, created_at`), (`assessment_id, touch`), (`ailment_slug, clinical_outcome` for #14). Extend the `phi_audit_log.action` set with `'prom.responded'` and `'prom.viewed'` (#2's hash-chain trigger covers them unchanged — it is action-agnostic).

**Verify:** the migration applies cleanly to a local fly.io Postgres; `responded_at IS NULL` is the only single-use gate; no `UPDATE`/`DELETE` grant is ever issued by the store module (inherited from #2 §5.3).

### Task 3 — Supabase `prom_dispatch` ledger + `mark_prom_responded` RPC (non-PHI, ships live)

Add the `prom_dispatch` table DDL (design §4.5) on Supabase `public`: PK, `pharmacy_id` FK, `assessment_id` (by value), `prom_response_id` (by value), `touch`, `channel` CHECK, `status` CHECK default `pending`, `token_exp`, `provider_message_id`, `sent_at`, `responded_at`, `error`, `created_at`, `UNIQUE (assessment_id, touch)` (idempotency), indexes. Add RLS policies: pharmacists read/insert for their `pharmacy_id`. Add the `mark_prom_responded(p_prom_response_id uuid) RETURNS void SECURITY DEFINER` RPC that flips `status='responded'`, `responded_at=now()` — the **single** unauthenticated Supabase mutation surface (mirrors #8's `consume_pre_intake_slot`). Add `prom.dispatched` and `prom.responded` to `audit.event_type` and extend `log_event` validation to allow only `{ prom_response_id, touch, channel? }` and reject any patient/clinical/answer key.

**Verify:** a pharmacist cannot read another pharmacy's rows (RLS); the RPC flips status atomically only when not already `responded`; `log_event` rejects an answer/ailment key.

### Task 4 — PROM store module (`src/lib/prom/store.ts`)

Create the fly.io data-plane module extending #2's `src/lib/phi/` discipline: `createAwaitingResponse({ id, pharmacyId, assessmentId, patientId, ailmentSlug, touch, instrument })` (inserts the empty `prom_response` row pinning version+hash+questions), `submitResponse({ id, pharmacyId, answers, clinicalOutcome })` (the atomic `UPDATE … WHERE responded_at IS NULL RETURNING id`; throws `already_submitted` on 0 rows; writes `prom.responded` to `phi_audit_log` in the same transaction), `getResponse({ id, pharmacyId })` (single-row select, writes `prom.viewed`), and `listDueAssessments({ pharmacyId?, now })` (the scheduler query: join `assessment`→`consent` on `consent_id`, filter `consent_to_followup=true` AND `outcome IN ('prescribed','not_prescribed')` AND `created_at::date` in the due windows AND no existing `prom_response` for `(assessment_id, touch)`). Every function injects `pharmacy_id` from the verified context, never from a caller argument. All gated on `PHI_PERSIST_ENABLED` via #2's `getPhiPool()` (throws a typed error when off — the action layer catches and no-ops).

**Verify:** CI grep `rg -n "FROM prom_response|INTO prom_response" src/lib/prom` shows every query text contains `pharmacy_id`; `submitResponse` is idempotent-fail (second call on same id throws `already_submitted`); `listDueAssessments` never returns an `abandoned`/`referred`-only or `consent_to_followup=false` row.

### Task 5 — Transport module (`src/lib/prom/transport.ts`) — raw `fetch`, no SDK

Create `sendPromMessage({ channel, to, pharmacyName, url })` per design §4.3: raw `fetch` to the Twilio SMS API (`https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`, Basic auth, `From`/`To`/`Body`) when `channel='sms'` and to the Resend email API (`https://api.resend.com/emails`, Bearer, `from`/`to`/`subject`/`html`) when `channel='email'`. Body template: SMS `"{{pharmacyName}}: Please tell us how you're feeling after your visit: {{url}}"`; email subject `"{{pharmacyName}} follow-up"`. Provider + credentials from server-only env (`PROM_SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM`, `PROM_EMAIL_PROVIDER`, `RESEND_API_KEY`/`RESEND_FROM`). Returns `{ channel, status, providerMessageId?, error? }`. **No `twilio`/`resend` package added** — mirrors #7's raw-fetch stance; `package.json` untouched.

**Verify:** the body string contains no template slot for name/ailment/drug/symptom (CI grep `rg -n "patient|ailment|drug|symptom" src/lib/prom/transport.ts` returns nothing in the body templates); a `fetch` mock returns the Twilio/Resend message id; missing-env returns `{ status: 'failed', error }` not a thrown crash.

### Task 6 — Dispatch core (`src/lib/prom/dispatch.ts`)

Create `dispatchDueForPharmacy({ pharmacyId?, now = new Date() })` per design §4.2 — the single function the cron route **and** the manual button both call. For each due `(assessment, touch)` from `listDueAssessments`: resolve the instrument, `newResourceId()` → `createAwaitingResponse` (fly.io, gated), `signLink({ resourceId, pharmacyId, purpose: "prom_followup" }, DEFAULT_PROM_TTL_SECONDS)` (#8's module; add `DEFAULT_PROM_TTL_SECONDS = 7*86400`), build `url = ${process.env.NEXT_PUBLIC_APP_URL}/prom/${token}`, insert `prom_dispatch` (Supabase, non-PHI, status `pending`), read patient contact from fly.io, choose channel (phone→sms else email→email else `failed:'no_contact'`), `sendPromMessage`, update `prom_dispatch` to `sent`/`failed` + `provider_message_id`/`error` + `sent_at`, emit `prom.dispatched { prom_response_id, touch, channel }`. Suppress a T+7 touch when the T+1 response is already `responded` (one-line guard). Idempotent by the `UNIQUE (assessment_id, touch)` constraints + the anti-join. When `PHI_PERSIST_ENABLED !== "true"`: write the Supabase `prom_dispatch` row only if a contact-less intent record is desired — **recommended: short-circuit and return `{ skipped: 'phi_disabled' }`** (no PHI destination read, no send), so the ledger never lies about a send that could not be personalised.

**Verify:** running twice in the same minute dispatches each due assessment exactly once (idempotency); a `consent_to_followup=false` assessment is never dispatched; a `responded` T+3 suppresses T+7.

### Task 7 — Cron route (`src/app/api/cron/prom-dispatch/route.ts`)

Create a `POST` (and `GET`) route handler: assert `Authorization: Bearer ${process.env.CRON_SECRET}` (401 on mismatch), call `dispatchDueForPharmacy({})` (all pharmacies), return `200 { dispatched, failed, skipped }`. Safe to re-run; no body parsing required (optional `?pharmacyId=`). This is the system's first scheduled surface — document the external invoker expectation (fly.io cron / GitHub Actions / cron-job.org) in a header comment and in `rollout notes`.

**Verify:** no-`CRON_SECRET` request → 401; valid bearer → 200 with counts; the route is stateless and re-invokable.

### Task 8 — No-login page + form (`src/app/prom/[token]/page.tsx`, `prom-form.tsx`)

Create the server-component page mirroring #8's `/intake/[token]`: `verifyLink(token, "prom_followup")` → null ⇒ render invalid/expired message; else `getPromContextAction(token)` → `{ pharmacyName, questions, touch }` (no patient PHI to the client; questions phrased generically). Render `<PromForm>` (mobile-first, AODA-AA mindful per #8 §7.8): the questions, a PHIPA collection notice, and a Submit button. On submit → `submitPromAction(token, answers)` (Task 9).

**Verify:** an expired/tampered token renders the invalid message and no form; the page source contains no patient name/ailment label; the form disables Submit while pending and shows success/error states.

### Task 9 — Token-gated actions (`src/lib/prom/actions.ts`)

Create three `"use server"` actions per design §4.4:
- `getPromContextAction(token)` — unauthenticated: `verifyLink(token,"prom_followup")`; read the `prom_response` row (fly.io, gated — if flag off, return a minimal `{ pharmacyName, questions: instrument.questions }` so the page still renders); return non-PHI context. Reject if `status='responded'` (show an already-answered state).
- `submitPromAction(token, answers)` — unauthenticated: re-`verifyLink`; validate every answer id/type against the pinned `questions` snapshot; `submitResponse` (atomic single-use); `supabase.rpc('mark_prom_responded', { p_prom_response_id })`; `logAuditEvent('prom.responded', { prom_response_id, touch })`. Flag-off: render a friendly no-op message, write nothing (fail-safe, not fail-open).
- `sendFollowupsNowAction()` — auth'd (`requireAuth` + pharmacy scope): calls `dispatchDueForPharmacy({ pharmacyId })`. The manual Phase-1 surface.

**Verify:** a replayed token after submit returns `{ error: 'already_submitted' }`; a tampered answer id is rejected; flag-off `submitPromAction` returns ok-without-writing; `sendFollowupsNowAction` requires auth and scopes to the caller's pharmacy.

### Task 10 — Audit events (`src/lib/audit-actions.ts`)

Add `"prom.dispatched"` and `"prom.responded"` to the `EventType` union (`audit-actions.ts:5-18`). Confirm `logAuditEvent` is called from the dispatch core (`prom.dispatched { prom_response_id, touch, channel }`) and from `submitPromAction` (`prom.responded { prom_response_id, touch }`). No PHI keys.

**Verify:** `rg -n "prom\." src/lib` shows exactly the two events with the allowed metadata keys; `tsc` passes.

### Task 11 — Dashboard surfaces (`src/app/page.tsx`, `src/components/dashboard/followup-panel.tsx`)

Add `<FollowupPanel>` to the dashboard (`page.tsx:60`, alongside `<AilmentGrid>` and #8's `<IntakePicker>`): a non-PHI list of recent `prom_dispatch` rows (touch, channel, status, sent_at, responded_at) for the active pharmacy, plus the "Send follow-ups now" button → `sendFollowupsNowAction`. For `responded` rows, a link to a `<PromOutcomeViewer>` (client component) that calls an auth'd `getPromResponseAction(promResponseId)` reading the PHI `prom_response` from fly.io (writes `prom.viewed` to `phi_audit_log`) and renders the answers + `clinical_outcome`; a `worse`/`saw_physician` answer surfaces an amber "follow up with patient" flag (pharmacist-worked, no automated action — roadmap §3).

**Verify:** the panel renders only the active pharmacy's rows; the outcome viewer requires auth and logs `prom.viewed`; the manual button is disabled while pending.

### Task 12 — Tests

- `src/__tests__/prom-instrument.test.ts` — hash determinism; 19-slug coverage (every `getPromInstrument` returns questions + cadence); `deriveClinicalOutcome` mapping incl. `saw_physician` override; **PHI-leak guard**: `rg` the instrument strings for any patient-name/ailment-as-label leak in `question.prompt` (prompts must be generic).
- `src/__tests__/prom-actions.test.ts` — `getPromContextAction` (valid/expired/tampered token; responded state); `submitPromAction` (single-use atomicity via a mocked `submitResponse` throwing `already_submitted` on second call; tampered-answer rejection; flag-off no-op); `sendFollowupsNowAction` (auth + pharmacy scope).
- `src/__tests__/prom-transport.test.ts` — Twilio + Resend `fetch` mocks return the message id; missing-env → `{ status:'failed' }` not a throw; **body-PHI guard**: the rendered body matches a regex that excludes name/ailment/drug tokens.
- `src/__tests__/prom-dispatch.test.ts` (if dispatch core is pure enough to unit-test with mocked store/transport) — idempotency (double-run = single dispatch); consent-gate; T+7 suppression after T+3 response; `no_contact` → `failed`.
- `src/__tests__/prom-form.test.tsx` — renders questions; submit success/error; re-submit disabled; expired-token branch.
- Existing tests: none broken (the feature is additive; `assessment`/`consent`/`signed-links` modules are consumed read-only).

**Verify:** `npm run test` is green; the PHI-leak and body-PHI guard tests are CI-friendly greps that fail loudly on regression.

### Task 13 — Whole-repo guard + typecheck/lint/build

Run the full verification suite (§Verification commands). Add CI guard greps: (a) no `NEXT_PUBLIC_` leak of any secret (`rg -n "NEXT_PUBLIC_(TWILIO|RESEND|CRON|SIGNED)" src` ⇒ empty); (b) the transport body templates carry no PHI slot (`rg -n "name|ailment|drug|symptom" src/lib/prom/transport.ts` within the template literals ⇒ empty); (c) every `prom_response` query contains `pharmacy_id` (`rg -n "FROM prom_response|INTO prom_response|UPDATE prom_response" src/lib/prom`); (d) no `twilio`/`resend`/`node-cron` added to `package.json` (`rg -n '"twilio"|"resend"|"node-cron"' package.json` ⇒ empty).

**Verify:** `npm run lint && npm run build && npm run test` all green; all four guard greps return empty.

---

## Files to Create / Modify (real paths)

**Create:**
- `src/lib/clinical/prom.ts`
- `src/lib/prom/dispatch.ts`
- `src/lib/prom/transport.ts`
- `src/lib/prom/actions.ts`
- `src/lib/prom/store.ts`
- `src/app/api/cron/prom-dispatch/route.ts`
- `src/app/prom/[token]/page.tsx`
- `src/app/prom/[token]/prom-form.tsx`
- `src/components/dashboard/followup-panel.tsx`
- `src/__tests__/prom-instrument.test.ts`, `src/__tests__/prom-actions.test.ts`, `src/__tests__/prom-transport.test.ts`, `src/__tests__/prom-dispatch.test.ts`, `src/__tests__/prom-form.test.tsx`

**Modify:**
- `src/lib/audit-actions.ts` (`:5-18` EventType union + two events)
- `src/app/page.tsx` (`:60` render `<FollowupPanel>` + manual button)

**Migrations:**
- fly.io (PHI): `prom_response` table + `phi_audit_log.action` set extension (Task 2).
- Supabase (non-PHI): `prom_dispatch` table + RLS + `mark_prom_responded` RPC + `audit.event_type`/`log_event` validation (Task 3).

---

## Data / DB Changes

- **fly.io (PHI, behind `PHI_PERSIST_ENABLED`/BAA):** new `prom_response` table (design §4.5). No change to #2's `assessment`/`patient`/`phi_audit_log` shape (read-only consumer); `phi_audit_log.action` gains two string values (`prom.responded`, `prom.viewed`) — the hash-chain trigger is action-agnostic so no trigger change.
- **Supabase (non-PHI):** new `prom_dispatch` table + RLS + `mark_prom_responded` `SECURITY DEFINER` RPC; `audit.event_type` gains `prom.dispatched`, `prom.responded`; `log_event` validation widened to allow `{ prom_response_id, touch, channel? }` and reject patient/clinical/answer keys.
- **No change** to `data/ailments.json` (governance constraint); cadence derives from a TS module.

---

## Tests

Vitest (`npm run test`), per Task 12. Coverage targets: instrument hash determinism + 19-slug coverage; single-use atomicity; consent gate; idempotent dispatch; transport body PHI-leak guard; token security (valid/expired/tampered/purpose-mismatch via #8's module tests already covering the crypto). The PHI-leak and body-PHI guards are CI-friendly `rg`-backed assertions that fail loudly on regression.

---

## Verification Commands

```bash
npm run lint
npm run build
npm run test

# CI guard greps (all must return empty / pass)
rg -n "NEXT_PUBLIC_(TWILIO|RESEND|CRON|SIGNED)" src            # empty
rg -n '"twilio"|"resend"|"node-cron"' package.json             # empty
rg -n "FROM prom_response|INTO prom_response|UPDATE prom_response" src/lib/prom | grep -L pharmacy_id  # empty
rg -n "logAuditEvent\('prom\." src/lib                         # exactly prom.dispatched + prom.responded
```

(The `prom_response`/`pharmacy_id` grep is illustrative — implement as a vitest assertion or a lint rule per #2 §5.3's discipline.)

---

## Rollout Notes

- **Phase 1 (live, no flag, no BAA, no provider):** the instrument module, the Supabase `prom_dispatch` ledger + RLS + RPC, the cron route (inert until `CRON_SECRET` is set + an invoker wired), the no-login `/prom/[token]` page, the manual "Send follow-ups now" button, and the dashboard panel all ship. With `PHI_PERSIST_ENABLED` off, `dispatchDueForPharmacy` short-circuits (`skipped: 'phi_disabled'`), `submitPromAction` renders the friendly no-op, and the panel shows no responses — but the surface is real, reviewable, and unblocks #14/#25.
- **Phase 2 (fly.io + BAA landed — inherited from #2):** flip `PHI_PERSIST_ENABLED=true`; `prom_response` writes activate end-to-end; structured outcomes begin accumulating (the #14 dataset).
- **Phase 3 (transport procurement):** provision a Twilio number (E.164) + Resend verified domain; set `TWILIO_*`/`RESEND_*`; the dispatch core activates SMS/email send. The manual button is the live surface until the cron invoker is wired; the cron route is the automated upgrade with **no** code change to the dispatch core.
- **Hard gates:** signed fly.io BAA (inherited from #2) for the PHI response store; `SIGNED_LINK_SECRET` (inherited from #8); `CRON_SECRET` + an external scheduler invoker for the automated tier; Twilio/Resend account + sender provisioning for the transport tier.
- **Soft gates (review, not blocking code):** pharmacist/clinical review of the instrument questions + the `deriveClinicalOutcome` mapping (like #4's `reasons.ts`); legal/privacy review of the no-login page's PHIPA collection notice (like #8 §7.7); the per-ailment `touchWindows` tuning (Open Question §7.2); AODA WCAG 2.1 AA for the patient-facing page (like #8 §7.8).
- **No flag is needed for the non-PHI plumbing** (additive, ships live); the `PHI_PERSIST_ENABLED` flag gates only the PHI response write, exactly as in #2/#3/#4/#8.
- **Forward-compat:** #14 (outcomes study) queries `prom_response` joined to `assessment`; #25 (leakage) queries the non-PHI `prom_dispatch`; #26 versions `PROM_INSTRUMENT_VERSION`/hash; #27 expands the instrument with validated per-condition questionnaires (same module, new version); #22's vaccination second-dose reminders reuse the scheduler + transport + a generalised `encounter_id`/`encounter_type` on `prom_response` (LATER increment — v1 is assessment-only per design §1.3).
