# Patient Pre-Intake Link — Design

**Date:** 2026-06-24
**Roadmap item:** #8 (NEXT tier) — "Patient pre-intake link (mobile; demographics + symptoms filled before arrival)"
**Status:** Draft (pending review)

---

## 1. Purpose

Every minute of an Ontario minor-ailment consult is typed at the counter, under time pressure, by the pharmacist. `WizardContainer` (`src/components/wizard/wizard-container.tsx:40`) opens with a blank `defaultPatient` (`wizard-container.tsx:14-33`) — 17 empty demographic fields — and the pharmacist hand-types the patient's name, DOB, sex, OHIP, address, city, postal code, phone, allergies, medications, and family-physician contact on **step 0** (`src/components/wizard/step-patient.tsx:25-207`) before they can even begin the clinical screen (`canNext` requires `patient.name && patient.dob` at `wizard-container.tsx:52-54`). Then on **step 1** (`step-redflags.tsx:94-125`) the pharmacist works the ailment-specific **presenting-symptoms** checklist (`ailment.symptoms`, `types/index.ts:11`) by asking the patient and ticking boxes. None of this demographic capture or symptom elicitation is clinical decision-making — it is clerical data entry that the patient is perfectly capable of doing themselves on the device already in their hand.

This is exactly the gap the competitive research names: *"Patient pre-intake link (mobile; demographics + symptoms filled before arrival) — Speed. Compresses counter time below 3 min; nobody does this well."* (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §5, NEXT tier, row #8). The roadmap §4 wedge against MAPflow is *"workflow automation they refuse to do — … patient pre-intake"* (`cdst-competitive-roadmap-design.md` §4). A patient who fills their own demographics and ticks their own presenting symptoms on their phone — before they reach the counter or while they wait — removes the single largest block of counter time from the consult and lets the pharmacist start at the clinical screen with a pre-populated, reviewable record.

**The goal of this feature** is a **patient-facing, no-login mobile intake page** reachable by a **short-lived, single-use, HMAC-signed link** that the pharmacist generates for a specific ailment. The patient opens the link (SMS, email, or on-device QR), fills the demographic fields they are competent to self-report, ticks their presenting symptoms from the ailment's own `ailment.symptoms` checklist, and submits. The submission lands as PHI on fly.io (per roadmap §6.2/§6.4) and is surfaced to the pharmacist as a **pre-fillable intake** on the dashboard; opening it seeds `WizardContainer`'s `patient` and `symptomsChecked` state so steps 0 and 1 arrive pre-completed and the pharmacist jumps straight to review. The pharmacist remains the clinical actor: **the patient never self-screens red flags, never selects an Rx, and never produces the legal record** — they only save the pharmacist's typing on the clerical demographic + symptom-elicitation work.

This feature also **establishes the shared signed-link infrastructure** (`src/lib/signed-links/`) that roadmap #10's PROM-follow-up pipeline explicitly requires (`cdst-competitive-roadmap-design.md` §5, row #10: *"link is HMAC-signed, expiring, single-use"*). #8 builds the sign/verify/TTL/purpose primitives once; #10 reuses them for its no-login PROM-response pages without re-deriving the discipline.

**Out of scope** (per roadmap §3, §6, and YAGNI for the NEXT tier): **patient self-screening of red flags** — the red-flag checklist (`ailment.redFlags`, `step-redflags.tsx:56-82`) is a clinical-safety action owned by the pharmacist (and the PMS owns automated safety per roadmap §3); **patient self-prescribing or Rx selection** (`step-rx.tsx`) — pharmacist-only; **a patient account / patient login** — the patient must never need a Supabase account (friction kills the speed value and creates a PHI-attribution surface); **booking/appointment integration** (roadmap #16, LATER) — the link is generated ad-hoc by the pharmacist, not by a booking system, though the token format is forward-compatible with one; **automated SMS/email dispatch** (a Twilio/Resend send) in this tier — the pharmacist copies the link to the patient via whatever channel they already use (the dispatch plumbing is roadmap #10's work and is reused from there; #8 produces the link, #10 wires the transport); **a longitudinal patient portal / chart** (roadmap #28, LATER); and **biometric/identity-proofed intake** (the submission is patient-attested and pharmacist-verified, not identity-proofed — see §5.5).

---

## 2. Current State (what exists in code)

### 2.1 Every consult opens with a blank 17-field demographic form typed by the pharmacist

`WizardContainer` seeds `patient` from `defaultPatient` (`wizard-container.tsx:14-33`), a fully-blank `PatientInfo` (`types/index.ts:18-37`) with only `allergies: "NKDA"` pre-set. `StepPatient` (`step-patient.tsx:15`) renders all 17 fields as empty `<Input>`s the pharmacist types: name, DOB, sex (+ pregnant/breastfeeding when Female), encounter type, OHIP, phone, address, city, postal code, allergies, current meds, and five family-physician fields (`step-patient.tsx:25-207`). The wizard cannot advance to the clinical screen until `patient.name && patient.dob` are non-empty (`wizard-container.tsx:52-54`). Every field is pharmacist-typed today; there is no "import from a prior source" affordance.

### 2.2 Presenting symptoms are an ailment-specific, pharmacist-confirmed checklist

`StepRedFlags` renders `ailment.symptoms` (`types/index.ts:11`) as a checkbox list (`step-redflags.tsx:94-125`) that the pharmacist populates by eliciting symptoms from the patient, alongside the separate `ailment.redFlags` referral screen (`step-redflags.tsx:56-82`). The symptom set is therefore **ailment-specific** — UTI symptoms differ from acne symptoms — which means a pre-intake page must know **which ailment** the patient is being seen for in order to render the correct checklist. The wizard itself is ailment-anchored: it is reached only via `/assess/[ailment]` (`src/app/assess/[ailment]/page.tsx:9`), which resolves the slug via `getAilmentBySlug` (`src/lib/ailments.ts:6`) and passes a single fixed `ailment` prop into `WizardContainer` (`assess/[ailment]/page.tsx:53`). A pre-intake link must therefore encode (or reference) the ailment slug.

### 2.3 There is no public / no-login route other than auth + invite flows

Every meaningful route calls `requireAuth()` (`src/lib/auth-guards.ts:44`) — the dashboard (`src/app/page.tsx:9`), the assess wizard (`assess/[ailment]/page.tsx:14`), and all settings pages. The only token-based route is `/invite/[token]` (`src/app/invite/[token]/page.tsx:3`), which resolves a Supabase team-invitation row. There is **no patient-facing, unauthenticated route** of any kind. A pre-intake page the patient opens on their phone must be a **new no-login route** (`/intake/[token]`), and its security cannot rely on a Supabase session — it must rely on the token itself (the HMAC signature). The `invite/[token]` route is the closest structural precedent (a param route with no auth), but it resolves a DB-backed invitation, whereas the pre-intake token must be **self-verifying** (no DB round-trip to validate authenticity) so the page can render even if the backing row is momentarily unreachable — see §4.2.

### 2.4 No signed-link / HMAC / SMS / email infrastructure exists

A `rg` for `createHmac|HMAC|webcrypto|magic link|signed-link|Twilio|Resend` across `src/` finds a single hit: `crypto.randomUUID()` in `auth-actions.ts:200` (used for invite tokens). There is no HMAC signing, no short-lived-token verification, no SMS provider, no email-send beyond Supabase's built-in auth email. `package.json:13-28` carries no `twilio`, `resend`, `nodemailer`, `jose`, or `jsonwebtoken` dependency. The pre-intake feature must therefore **introduce the signed-link primitive** (`src/lib/signed-links/`) from scratch using Node's built-in `node:crypto` (`createHmac`, `timingSafeEqual`, `randomUUID`) — **no new dependency**, exactly as the established "no new required dependency" pattern (#6 differentials, #7 raw-`fetch` AI) prescribes.

### 2.5 The persistence + identity foundation (#2) is the landing zone, and #10 is the shared-link consumer

#2's `persist-assessments-flyio-design.md` §4.3 defines the fly.io `patient` table (an identity index keyed by `identity_hash` via `src/lib/phi/identity.ts`) and the `assessment` table; #3/#4/#22 all reuse it through the recommended `resolvePatientId({ pharmacyId, identity })` helper (`digital-consent-capture-design.md` §7.3, `vaccination-workflow-design.md` §37). A pre-intake submission is PHI (demographics identify the patient; symptoms describe their clinical state — roadmap §6.4), so it lands on **fly.io**, and the eventual consult that consumes it resolves to the same `patient` row via `resolvePatientId`. #2's fly.io is not yet provisioned and no BAA is signed (roadmap §7 open questions #1/#2), so #8 reuses the established **stub-behind-`PHI_PERSIST_ENABLED`** pattern (#1 e-fax, #2 persist, #3 consent, #4 refusal) for the PHI write: the signed-link infra, the Supabase slot table, the no-login page, the dashboard picker, and the wizard pre-fill plumbing all ship live in Phase 1, while the PHI submit + retrieval is gated until fly.io/BAA land. Critically, roadmap #10 (PROM follow-up) states its links are *"HMAC-signed, expiring, single-use"* (`cdst-competitive-roadmap-design.md` §5) — #10 has not been specced yet, so #8 **builds the shared signed-link module #10 will consume**, not a pre-intake-only token helper.

### 2.6 The audit-log discipline and the content-governance precedent

The non-PHI Supabase `audit.log` (`src/lib/audit-actions.ts:5-18`) is the home for software/actor telemetry. #2's learnings flagged `ailment` as clinical/PHI-adjacent and recommended it stay OFF Supabase (`notes.md` iteration 2), so any pre-intake audit event's metadata must not carry `ailment_slug` or any patient field — only `{ intake_id }` (an opaque UUID). The versioned-hashed-content precedent (#3 `statements.ts`, #4 `reasons.ts`, #22 `catalog.ts`, #6 `differentials.ts`) does **not** apply here: the pre-intake page renders ailment content straight from `data/ailments.json` via `getAilmentBySlug` (read-only), so there is no new curated clinical content to version — the ailment's own `protocol_version` (per #2 §4.3) is inherited. #8 adds no hashed module.

---

## 3. Approach (options + recommendation)

The design hinges on six decisions: (a) whether the patient needs an account; (b) how the link is secured and what it carries; (c) where the non-PHI "slot" and the PHI "submission" live (the partitioning question); (d) how the pharmacist retrieves and loads the submission into the wizard; (e) what the patient is allowed to self-report vs. what stays pharmacist-only (the clinical-safety boundary); (f) whether the transport (SMS/email) is built now or deferred to #10. Options are evaluated against roadmap §6.2 (PHI on fly.io under BAA; Supabase = auth + non-PHI), §6.4 (the partitioning rule), §3 (PMS/pharmacist owns clinical-safety), and §4 (the counter-speed wedge).

### Option A — Signed-link + no-login page + Supabase slot + fly.io submission + wizard prefill (RECOMMENDED)

A new server action `generateIntakeLinkAction(ailmentSlug)` (pharmacist-authenticated via `requireAuth()`, `auth-guards.ts:44`) creates a **non-PHI intake slot** row on **Supabase** (`pre_intake`: `{ intake_id, pharmacy_id, ailment_slug, status, created_at, expires_at }` — no patient data exists at creation), then signs a **self-verifying token** carrying only `{ intake_id, pharmacy_id, purpose: "pre_intake", exp }` (NO PHI, NO ailment slug in the token — see §4.2/§5.2) and returns the URL `https://…/intake/{token}`. The pharmacist pastes the URL into whatever channel they already use to reach the patient (text, email, or shows a QR — the QR is just a rendered URL).

The patient opens `GET /intake/[token]` (a **new no-login route**, `src/app/intake/[token]/page.tsx`). The page calls `getIntakeContextAction(token)` — a **non-authenticated** server action that verifies the HMAC + expiry + purpose, looks up the slot by `intake_id`, and returns **only the non-PHI rendering context** (`{ pharmacyName, ailmentName, symptoms[] }`) needed to draw the form. The patient fills the demographic fields they are competent to self-report (name, DOB, sex, phone, address, city, postal code, OHIP, family-physician contact) and ticks their presenting symptoms from `ailment.symptoms`, then submits via `submitIntakeAction(token, payload)` — another **non-authenticated** action that re-verifies the token, enforces **single-use** by checking the slot's `status`, writes the **PHI submission** (demographics + symptoms) to a **fly.io** `pre_intake_submission` row keyed by `intake_id`, and flips the Supabase slot's `status` to `submitted`. The patient sees a confirmation; the pharmacist's dashboard surfaces the submitted intake.

The pharmacist retrieves it from a new **"Pending pre-intakes"** panel on the dashboard (`src/app/page.tsx`, alongside `<AilmentGrid>`). Clicking opens the existing wizard at `/assess/[ailment]?intake={intake_id}`. The assess route reads the query, calls `loadIntakeAction(intake_id)` (`requireAuth()` + pharmacy-scope check), fetches the PHI submission from fly.io, and passes it as new optional `initialPatient` + `initialSymptoms` props into `<WizardContainer>`, which seeds `patient` and `symptomsChecked` state. Steps 0 and 1 arrive pre-filled; the pharmacist reviews (edits if needed) and proceeds to the clinical screen. The signed-link module (`src/lib/signed-links/`) is built **purpose-tagged** (`"pre_intake" | "prom_followup"`) so #10 reuses it verbatim for its PROM-response pages.

- **Pros:** Faithful to the roadmap framing and the §4 wedge (real counter-time compression). Patient needs **no account** — the token is the credential (friction stays at zero; no PHI-attribution account surface is created). The partitioning is compliance-honest: the **slot** (created before any patient exists) is genuinely non-PHI → Supabase; the **submission** (demographics + symptoms) is PHI → fly.io under BAA; the **token** and the **SMS/email body** carry no PHI (the body is just a URL). Reuses the established **stub-behind-`PHI_PERSIST_ENABLED`** pattern so the infra ships live while the PHI write waits on fly.io/BAA, and the established **non-PHI-ships-live** property (#6, #22 inventory) for the slot table + page + picker. **Establishes the shared signed-link module #10 needs** (the single largest architectural contribution of this feature), so #10 does not re-derive HMAC discipline. The pharmacist stays the clinical actor — the patient self-reports only clerical demographics and their own symptoms, never red flags or Rx (roadmap §3 respected). The wizard pre-fill is additive: `initialPatient`/`initialSymptoms` are optional and default to the current blank state, so a consult without a pre-intake is byte-identical to today.
- **Cons:** The end-to-end pre-fill only works once fly.io/BAA land (the PHI submit + retrieval is gated) — so the *counter-time value* is BAA-gated even though the plumbing ships earlier (mitigated: the non-PHI slot + page + picker + signed-link infra are real, reviewable, and unblock #10 now; the gate is identical to #2's and lands with the same procurement). Single-use + expiry add a slot-status state machine (mitigated: four states, trivially testable). The ailment slug lives in the Supabase slot row (not the token) — see §5.2 for why this is the right call. Adds a new public route, enlarging the unauthenticated attack surface (mitigated: the route's only mutation is gated by a self-verifying, single-use, short-TTL token and writes only to fly.io behind `PHI_PERSIST_ENABLED`; no Supabase PHI ever).

### Option B — Patient creates a Supabase account; pre-intake is an authenticated patient portal

Require the patient to sign up and log in; their intake is saved to their own patient record.

- **Pros:** Strong attribution; easy re-use across visits.
- **Cons:** **Destroys the speed value** — a patient will not create an account, verify email, and log in to save 90 seconds of typing; conversion to a completed pre-intake would crater, making the feature useless. Creates a **patient identity surface in Supabase** (auth + a patient profile) that the partitioning rule (roadmap §6.2/§6.4) explicitly reserves for **staff** accounts — putting patient identity in the same auth pool as pharmacists is an avoidable PHI-attribution risk and a boundary violation. Adds password/email-verify friction at the worst possible moment (the patient is in the pharmacy or on the phone). Prematurely builds a longitudinal portal (roadmap #28). **Rejected** for the NEXT tier; the no-login token is the correct credential for a one-shot pre-intake, exactly as #10's PROM pages are deliberately no-login.

### Option C — On-device QR import only (no remote link); patient fills at the counter and the pharmacist scans

The pharmacist shows a QR; the patient scans it, fills the form on their phone over the pharmacy Wi-Fi, and the submission is imported by a pharmacist scan — no SMS/email, no remote pre-arrival.

- **Pros:** No transport dependency; works entirely in-pharmacy; no link to leak.
- **Cons:** Does **not** deliver the roadmap's stated value — *"filled before arrival"* (`cdst-competitive-roadmap-design.md` §5, row #8) is the whole point (the patient completes intake en route or in the waiting room, so the consult starts immediately). A QR-at-counter flow still makes the patient fill the form *during* the visit, saving the pharmacist's typing but not the wall-clock counter time below 3 min as effectively. Also redundant: the signed link already degrades to a QR (the pharmacist can render the URL as a QR at the counter if the patient is present), so Option C is a **subset** of Option A's transport, not an alternative. **Rejected** as the primary path; QR-at-counter is retained as a supported rendering of the Option-A URL (§4.1).

### Recommendation

**Option A.** It is the faithful, compliance-honest implementation of roadmap #8: the no-login signed-link page lets the patient pre-fill demographics + symptoms before arrival with zero account friction; the Supabase-slot / fly.io-submission split respects the partitioning rule exactly (non-PHI slot on Supabase, PHI submission on fly.io under BAA); the pharmacist stays the clinical actor; and the feature **establishes the shared signed-link module #10 requires**, making #8 the foundational security primitive for the entire no-login-patient-surface family. The stub-behind-`PHI_PERSIST_ENABLED` pattern lets the plumbing ship live while the PHI write waits on the same fly.io/BAA procurement every sibling feature already waits on.

---

## 4. Components & Data Model

### 4.1 Pharmacist-side: generate-link UI + dashboard picker (`src/app/page.tsx`, modified; new components)

The dashboard (`src/app/page.tsx:60` renders `<AilmentGrid>`) gains two additions:

- A **"Generate pre-intake link"** affordance. The simplest integration is a per-card action on `<AilmentCard>` (which today is a `<Link>` to `/assess/[slug]` at `ailment-card.tsx:23`): a secondary button that calls `generateIntakeLinkAction(slug)` and, on success, surfaces the returned URL with a **Copy** button and an optional **QR** render (the URL rendered into a QR via a dependency-free SVG generator or the existing canvas pattern from #3's signature pad — no new dependency is required; a tiny inline QR is YAGNI-flagged in §7). The pharmacist pastes the URL to the patient.
- A **"Pending pre-intakes"** panel listing slots where `status = 'submitted'` for the active pharmacy (patient name + ailment + submitted-at), each linking to `/assess/[ailment]?intake={intake_id}`. Read via a Supabase query on `pre_intake` (non-PHI) joined to surface only `status='submitted'` rows; the patient name for the list comes from the fly.io submission, fetched by `loadIntakeAction` at click time (not stored in the Supabase slot — see §4.4).

### 4.2 Signed-link module (`src/lib/signed-links/index.ts`, new — the #10-shared primitive)

A dependency-free module built on `node:crypto` (no `jsonwebtoken`/`jose`). It provides **authenticity + expiry + purpose-binding**; **single-use** is enforced by the resource handler (the slot/PROM row), not the module — a deliberate separation that keeps the module stateless and lets each consumer define its own consumption semantics.

```ts
// src/lib/signed-links/index.ts
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto"

export type SignedLinkPurpose = "pre_intake" | "prom_followup"

export interface SignedLinkPayload {
  /** Opaque resource id the link targets (pre_intake.intake_id, or a prom_response.id). */
  resourceId: string
  pharmacyId: string
  purpose: SignedLinkPurpose
  /** Unix seconds. */
  exp: number
}

export const DEFAULT_PRE_INTAKE_TTL_SECONDS = 60 * 60 * 24 // 24h

/**
 * Returns `${base64url(payloadJson)}.${base64url(mac)}` where
 * mac = HMAC-SHA256(SIGNED_LINK_SECRET, payloadJson + "|" + purpose).
 * The payload is NOT encrypted (it carries no PHI — see §5.2); it is
 * integrity-protected so it cannot be tampered with, and purpose-bound
 * so a pre_intake token can never be replayed as a prom_followup token.
 */
export function signLink(
  payload: Omit<SignedLinkPayload, "exp"> & { exp?: number },
  ttlSeconds = DEFAULT_PRE_INTAKE_TTL_SECONDS,
): string

export function verifyLink(
  token: string,
  expectedPurpose: SignedLinkPurpose,
  now: number = Math.floor(Date.now() / 1000),
): SignedLinkPayload | null   // null on bad MAC, wrong purpose, or expiry

export function newResourceId(): string   // randomUUID() convenience
```

The HMAC key is a **server-only** env var `SIGNED_LINK_SECRET` (never `NEXT_PUBLIC_`). `verifyLink` uses `timingSafeEqual` for the MAC comparison (constant-time, no oracle). The token carries **no PHI**: `resourceId` is an opaque UUID, `pharmacyId` is the pharmacy's Supabase id (non-PHI — it identifies the pharmacy, not a patient, per roadmap §6.4), `purpose` is a fixed enum, and `exp` is a timestamp. The ailment slug is **deliberately not in the token** — it is looked up server-side from the non-PHI slot row (§4.4, §5.2), so a leaked token reveals nothing clinical.

### 4.3 Server actions (`src/lib/intake/actions.ts`, new, mix of `"use server"` auth'd and non-auth'd)

```ts
// Pharmacist-authenticated (requireAuth). Creates the slot, signs the token, returns the URL.
export async function generateIntakeLinkAction(
  ailmentSlug: string,
): Promise<{ url?: string; intakeId?: string; error?: string }>

// NON-authenticated (token is the credential). Returns only non-PHI rendering context.
export async function getIntakeContextAction(
  token: string,
): Promise<{ pharmacyName: string; ailmentName: string; symptoms: string[] } | { error: string }>

// NON-authenticated. Re-verifies token, enforces single-use via slot.status, writes PHI to fly.io,
// flips slot.status -> 'submitted'. PHI_PERSIST_ENABLED-gated (no-op + friendly message when off).
export async function submitIntakeAction(
  token: string,
  submission: PreIntakeSubmission,
): Promise<{ ok: true } | { error: string }>

// Pharmacist-authenticated (requireAuth + pharmacy scope). Fetches the PHI submission from fly.io.
export async function loadIntakeAction(
  intakeId: string,
): Promise<{ patient: PatientInfo; symptomsChecked: string[] } | { error: string }>
```

`generateIntakeLinkAction` and `loadIntakeAction` mirror `reserveTxId()` (`src/lib/prescription-actions.ts:6-24`): `requireAuth()` → derive `{ pharmacistId, pharmacyId }` → perform the side effect scoped to `pharmacyId` → return a typed result. `getIntakeContextAction` and `submitIntakeAction` **must not** call `requireAuth()` (the patient has no session) — their only credential is the verified token, and `submitIntakeAction` additionally requires `slot.status === 'pending'` (single-use) and `slot.pharmacy_id === payload.pharmacyId` (binding).

### 4.4 Data model — the Supabase slot (non-PHI) + the fly.io submission (PHI)

**Supabase `pre_intake` slot (non-PHI, RLS by `pharmacy_id`):** created at link-generation time, **before any patient data exists**, so it is genuinely non-PHI (a pharmacy's pending-intake slot for an ailment). The ailment slug lives here (not in the token) so the page can render the correct symptom checklist via `getAilmentBySlug`.

```sql
-- Supabase, public schema. NON-PHI (slot created before any patient exists).
CREATE TABLE pre_intake (
  intake_id    uuid PRIMARY KEY,                       -- the resourceId in the signed token
  pharmacy_id  uuid NOT NULL REFERENCES pharmacies(id),
  ailment_slug text NOT NULL,                          -- e.g. 'uti' (looked up by the page, NOT in the token)
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','submitted','consumed','expired')),
  created_by   uuid NOT NULL,                          -- pharmacist profiles.id (actor who generated the link)
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,                   -- created_at + TTL (denormalised for cron expiry)
  submitted_at timestamptz,                            -- set when the patient submits (single-use marker)
  consumed_at  timestamptz                             -- set when the pharmacist loads it into a wizard
);
CREATE INDEX pre_intake_pharmacy_status ON pre_intake (pharmacy_id, status, created_at DESC);
-- RLS: pharmacists read/insert for their own pharmacy; the submit path uses a SECURITY DEFINER
-- function (see §4.5) because the patient has no RLS identity.
```

**fly.io `pre_intake_submission` (PHI, under BAA, behind `PHI_PERSIST_ENABLED`):** the patient-entered payload, written by `submitIntakeAction`. Keyed by `intake_id` (references the Supabase slot by value — no cross-DB FK is enforceable between fly.io and Supabase, per roadmap §6.2, identical to #2's `prescription_tx_id` pattern). Pharmacy-scoped like every fly.io table (#2 §4.3).

```sql
-- fly.io Postgres. PHI (demographics identify; symptoms describe clinical state).
CREATE TABLE pre_intake_submission (
  intake_id       uuid PRIMARY KEY,                    -- = Supabase pre_intake.intake_id (by value)
  pharmacy_id     uuid NOT NULL,                       -- copied from the verified token's pharmacyId
  patient_payload jsonb NOT NULL,                      -- patient-entered PatientInfo subset (§4.6)
  symptoms_checked jsonb NOT NULL DEFAULT '[]'::jsonb, -- patient-ticked ailment.symptoms
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  submitted_from  text                                 -- best-effort: 'web' (no IP/UA retained — §5.4)
);
CREATE INDEX pre_intake_submission_pharmacy ON pre_intake_submission (pharmacy_id, submitted_at DESC);
```

The eventual consult that consumes this submission resolves to #2's `patient` row via `resolvePatientId({ pharmacyId, identity })` (`persist-assessments-flyio-design.md` §4.2/§4.3) — the submission's demographics feed `identity_hash` exactly as the wizard's `patient` would. The submission is **not** the legal record; the `assessment` row (#2) created from the wizard is. The submission is a transient pre-fill source, consumed once (`slot.status -> 'consumed'`), and retention is short (§5.6).

### 4.5 Single-use + RLS mechanics (Supabase)

Two RLS realities drive the design:

1. **The patient has no Supabase identity**, so RLS cannot scope their write. `submitIntakeAction` therefore performs the slot-status flip and the (PHI_PERSIST_ENABLED-gated) fly.io write **server-side**; the only Supabase mutation the unauthenticated path performs is `pre_intake.status` flip, done through a **`SECURITY DEFINER` RPC** `consume_pre_intake_slot(p_intake_id, p_pharmacy_id)` that: (a) re-checks `status='pending'` and `expires_at > now()` atomically (`UPDATE … WHERE status='pending' … RETURNING`), (b) sets `status='submitted'`, `submitted_at=now()`, and (c) returns the row or NULL. This makes single-use **atomic at the DB** (two concurrent patient submits cannot both succeed) and keeps the unauthenticated surface to a single, narrow, parameterised RPC. No other Supabase write is reachable without auth.
2. **The pharmacist read** of `pre_intake` (the dashboard picker) is a normal RLS-scoped `SELECT WHERE pharmacy_id = auth-pharmacy`. The PHI submission is fetched from fly.io by `loadIntakeAction` (auth'd), never from Supabase.

### 4.6 What the patient self-reports vs. what stays pharmacist-only (the clinical-safety boundary)

The patient fills a **subset** of `PatientInfo` (`types/index.ts:18-37`) — the clerical demographics they are competent to self-report — plus their presenting symptoms. They **do not** touch any clinical-decision field:

| Field (`PatientInfo`) | Patient self-reports? | Why |
|---|---|---|
| `name`, `dob`, `sex`, `phone`, `address`, `city`, `postalCode`, `ohip` | **Yes** | Clerical identity/demographic data the patient knows best. |
| `doctorName`, `doctorPhone`, `doctorFax`, `doctorAddress` | **Yes** | Family-physician contact for referral/e-fax routing (#1). |
| `symptomsChecked` (from `ailment.symptoms`) | **Yes** | Patient self-report of their own presenting symptoms — the elicitation the pharmacist would otherwise do verbally. |
| `encounterType` (In-Person/Virtual/Phone) | **No** (pharmacist) | Determined by the pharmacy's workflow/booking, not the patient. |
| `pregnant`, `breastfeeding` | **No** (pharmacist) | Note: #5's spec (`stop-duplicating-pms-data-design.md`) removes these from `PatientInfo` entirely (pregnancy is ailment-clinical via `ailment.redFlags`, captured at `step-redflags.tsx:56-82`). Until #5 lands, these remain pharmacist-entered on step 0 and are **not** surfaced to the patient (clinical-context decision, not clerical). |
| `allergies`, `currentMeds` | **No** (PMS-owned) | #5's spec removes these as PMS duplications; the CDST must not re-collect them from the patient (roadmap §3 — the PMS owns the medication/allergy record). |
| `redFlagsChecked` (`ailment.redFlags`) | **No** (pharmacist) | **Clinical-safety action.** The red-flag screen (`step-redflags.tsx:56-82`) is a pharmacist clinical judgement, never patient self-service — roadmap §3 reserves clinical-safety to the pharmacist/PMS. |
| `selectedRx`, `nonRxChecked`, `assessmentNotes` | **No** (pharmacist) | Steps 2/3 — prescriber actions and clinical narrative. |

The submission type captures exactly the patient-enterable subset:

```ts
// src/lib/intake/types.ts (new)
export interface PreIntakeSubmission {
  // Demographics the patient self-reports:
  name: string
  dob: string
  sex: "" | "Male" | "Female" | "Other"
  phone: string
  address: string
  city: string
  postalCode: string
  ohip?: string
  doctorName?: string
  doctorPhone?: string
  doctorFax?: string
  doctorAddress?: string
  // Patient-ticked presenting symptoms (validated against ailment.symptoms server-side):
  symptomsChecked: string[]
}
```

`submitIntakeAction` **server-validates** that every `symptomsChecked` entry is a member of the resolved `ailment.symptoms` (rejecting any string the patient didn't see on the form), and applies the same minimal demographic validation `canNext` does today (`name && dob`). This prevents a tampered payload from injecting foreign symptom strings or red-flag claims.

### 4.7 The no-login intake page (`src/app/intake/[token]/page.tsx` + form component, new)

A **new public route** — the first patient-facing surface. The server component verifies the token via `getIntakeContextAction` and, on success, renders a **mobile-first** client form (`IntakeForm`) bound to `ailment.symptoms`. On failure (bad/expired/consumed token) it renders a plain-language error with no PHI disclosure ("This intake link is no longer valid — please ask the pharmacy staff for a new one"). The form submits to `submitIntakeAction`; on success it shows a confirmation screen and disables re-submit. Accessibility, mobile viewport, and a PHIPA collection-notice ("This pharmacy collects your information to provide a minor-ailments assessment under O. Reg. 256/24…") are required — the notice is the consent-to-collect disclosure that precedes the pharmacist's #3 treatment consent.

### 4.8 Wizard pre-fill (`src/components/wizard/wizard-container.tsx` + `assess/[ailment]/page.tsx`, modified)

- `WizardContainer` gains optional `initialPatient?: PatientInfo` and `initialSymptoms?: string[]` props, used only to seed the initial `useState` (`wizard-container.tsx:42-44`). When absent, behaviour is byte-identical to today (the default path). The pharmacist can still edit every pre-filled field on step 0 and untick/re-tick symptoms on step 1.
- `assess/[ailment]/page.tsx:9` reads `searchParams.intake`; if present and `loadIntakeAction` succeeds (auth + pharmacy scope), it passes `initialPatient` (mapped from the submission) and `initialSymptoms` into `<WizardContainer>` and marks the slot `status='consumed'`. If the intake is missing/expired/already-consumed, the wizard opens blank (graceful degradation — the consult proceeds normally).
- `canNext` at step 0 (`wizard-container.tsx:52-54`) is unchanged in logic: it still requires `patient.name && patient.dob`, which a pre-filled intake satisfies. No new gate; pre-fill is purely a seeding convenience the pharmacist reviews.

---

## 5. Security / PHIPA-PIPEDA Posture

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| The **slot** at creation (`pre_intake` row: `intake_id, pharmacy_id, ailment_slug, status, created_at, expires_at`) | **Non-PHI** — created before any patient exists; identifies a pharmacy + ailment, not a person | **Supabase** `pre_intake`. |
| The **patient submission** (`pre_intake_submission`: demographics + symptoms) | **PHI** — demographics identify; symptoms describe clinical state (roadmap §6.4) | **fly.io** under BAA, behind `PHI_PERSIST_ENABLED`. Never Supabase. |
| The **signed token** (`resourceId, pharmacyId, purpose, exp`) | **Non-PHI** — opaque UUID + pharmacy id + enum + timestamp; no patient data | Transient URL only; never persisted. |
| The **SMS/email body** carrying the link | **Non-PHI** — a bare URL with no patient context | The pharmacist's chosen channel (no transport is built in this tier — §4.1). |
| `intake.link_generated` / `intake.submitted` Supabase audit metadata | **Non-PHI** — strictly `{ intake_id }` (opaque UUID); never `ailment_slug` (PHI-adjacent per #2), never a patient field | **Supabase** `audit.log`. |
| `SIGNED_LINK_SECRET` | Secret | Server-only env var; never `NEXT_PUBLIC_`. |
| `pre_intake_submission.submitted_from` | Non-identifying best-effort tag (`'web'`) | **fly.io** only. No IP/UA retained (§5.4). |

**Rule of thumb (roadmap §6.4):** the *patient's demographics + symptoms* describe an individual → fly.io. The *existence of a pending/submitted slot for a pharmacy* describes the pharmacy → Supabase. The *link itself* describes nothing about a patient → transient.

### 5.2 Why the ailment slug is in the slot, not the token

The token is base64 (not encrypted), so anything in its payload is client-visible. Putting `ailment_slug` in the token would mean a token forwarded/leaked to a third party discloses "this person is being assessed for {ailment}" — a PHI-adjacent disclosure about an as-yet-unidentified-but-soon-to-be patient. Instead, the ailment slug lives in the **Supabase slot row**, looked up server-side by `getIntakeContextAction` after the token verifies. The only thing a leaked pre-intake token reveals is "pharmacy Y minted a one-shot link expiring at T" — acceptable, minimal, and unavoidable (the page needs to know which symptom checklist to render, and that knowledge must be reachable from the token). The single-use + 24h-TTL constraints bound the disclosure window.

### 5.3 The token security controls

1. **HMAC authenticity.** The token is `base64url(payload).base64url(HMAC-SHA256(secret, payload + "|" + purpose))`. Any tampering with the payload breaks the MAC; `verifyLink` uses `timingSafeEqual` (no timing oracle). Forging a token requires `SIGNED_LINK_SECRET`.
2. **Purpose-binding.** The MAC covers the `purpose` field, so a `"pre_intake"` token cannot be replayed against a `"prom_followup"` verifier (and vice versa when #10 ships) — preventing cross-feature token confusion.
3. **Expiry.** `exp` is checked against `now`; default TTL is 24h (configurable per-call). The Supabase slot also carries a denormalised `expires_at` for a cron job to mark stale slots `expired`.
4. **Single-use.** Enforced by the resource handler, atomically: `consume_pre_intake_slot` flips `status` only if it is still `pending` (`UPDATE … WHERE status='pending' RETURNING`). A replayed token passes `verifyLink` but the slot is no longer `pending`, so the second submit is rejected. This is the pattern #10's PROM pages will reuse (single-use keyed on `prom_response.responded_at`).
5. **Pharmacy binding.** `submitIntakeAction` checks `slot.pharmacy_id === payload.pharmacy_id` before writing — a token minted by pharmacy A cannot write a submission scoped to pharmacy B.

### 5.4 No PHI in logs, no over-collection

The provider request/response and the submission payload are never `console.log`ged, never written to Supabase, never written to fly.io except as the `pre_intake_submission` row. `submitted_from` stores only the literal `'web'` tag — **no IP address, no User-Agent, no device fingerprint** is retained (over-collection violates PIPEDA Principle 4.4; a pre-intake needs none of these). The Supabase audit events carry only `{ intake_id }`.

### 5.5 Identity is patient-attested, pharmacist-verified

The submission is **patient-attested**: the patient types their own name/DOB/OHIP; the CDST does not identity-proof them at intake. The pharmacist **verifies identity at the counter** (as they do today — visually/by OHIP card) before the consult proceeds, and may edit any pre-filled field. This is the same trust model as today's pharmacist-typed demographics, with the typing delegated — it introduces no new identity-proof claim and must not be mistaken for one. The medico-legal record is the `assessment` row (#2) the pharmacist creates, not the submission.

### 5.6 Regulatory mapping

- **PHIPA:** the submission is health information collected for the purpose of providing a minor-ailments assessment (O. Reg. 256/24). Collection is lawful under PHIPA (treatment purpose); the no-login page's collection notice (§4.7) is the transparency disclosure. Storage is on fly.io under BAA, AES-256 at rest, TLS in transit, pharmacy-scoped, `phi_audit_log` hash-chained (inherited from #2). Retention: the submission is a **transient pre-fill source**, not the legal record — it is deleted (or hard-expired) shortly after consumption; the durable record is the `assessment` row. (Exact retention window is an Open Question §7.)
- **PIPEDA Principle 4.4 (limit collection):** the patient enters only the clerical demographics + symptoms needed for the consult; no IP/UA/device data is collected (§5.4); allergies/meds are explicitly **not** re-collected (PMS owns them, per #5/roadmap §3).
- **PIPEDA Principle 4.1.3 (transfer to third party):** if the pharmacist sends the link via a consumer SMS/email app, the **body is a bare URL** (no PHI) — no PHI is transferred to the carrier beyond the URL's existence. (If/when #10 wires Twilio/Resend, those transports also carry only the URL.)
- **PHIPA s.16 / consent:** the no-login page's collection notice precedes collection; the pharmacist's #3 treatment/record consent is captured at the consult. The pre-intake does not capture treatment consent (the patient has not been assessed yet).
- **Consent to follow-up (#3 `consent_to_followup`):** orthogonal — pre-intake is not a follow-up channel. No conflict.
- **Clinical-safety boundary (roadmap §3):** the patient self-reports demographics + symptoms only; **no red-flag screening, no Rx, no clinical decision** is delegated. Identical boundary to #6/#7.
- **No FDA 21 CFR Part 11 implication** (roadmap §6.1 — not a GxP system).

### 5.7 Application security

- **No new required dependency.** The signed-link module uses `node:crypto` (`createHmac`, `timingSafeEqual`, `randomUUID`); the QR (if built) is a dependency-free SVG or reuses the canvas pattern; no `twilio`/`resend`/`jsonwebtoken`. Transport is deferred to #10.
- **Server-only secret.** `SIGNED_LINK_SECRET` is never `NEXT_PUBLIC_`; the sign/verify functions are server-only (`node:crypto` is unavailable in the client bundle anyway).
- **Narrow unauthenticated surface.** The only unauthenticated mutations are `getIntakeContextAction` (read-only, returns non-PHI context) and `submitIntakeAction` (writes only via the atomic `consume_pre_intake_slot` RPC + the gated fly.io insert). Both are token-gated; there is no unauthenticated Supabase PHI write path.
- **Fail-safe, not fail-open.** If `PHI_PERSIST_ENABLED` is off, `submitIntakeAction` performs the slot-status flip (so the link is honestly consumed) but returns a friendly "your information will be ready at the counter" message and writes nothing to fly.io — the pharmacist is never shown a phantom intake, and the patient is never silently dropped. (The dashboard picker simply shows no submitted intakes until fly.io is up.)
- **Replay/forwarding resilience.** Single-use + 24h TTL + purpose-binding mean a forwarded link is worthless after first submit or after a day. A pre-arrived leak reveals only pharmacy + expiry (§5.2).

---

## 6. Edge Cases

- **`PHI_PERSIST_ENABLED` off (Phase 1 or any time before fly.io/BAA):** the link generates, the page renders, the patient fills and submits; the slot flips to `submitted` (honest single-use), but no PHI is written (fly.io unavailable). The dashboard picker shows no submitted intakes (there is no PHI to load). The consult proceeds as today (blank wizard). The non-PHI plumbing (slot, picker shell, signed-link infra) is live and reviewable, and #10 is unblocked. The counter-time value ships when fly.io lands.
- **Patient opens an expired link:** `verifyLink` returns null on `exp`; the page renders the "link no longer valid" message. The pharmacist generates a fresh link. The slot is eventually marked `expired` by the cron.
- **Patient submits twice (or forwards the link, then both submit):** `consume_pre_intake_slot`'s atomic `WHERE status='pending'` flip means exactly one submit succeeds; the second gets `{ error: "already submitted" }`. No double-write.
- **Patient ticks a symptom string not on the ailment's list (tampered form):** `submitIntakeAction` server-validates each `symptomsChecked` against `getAilmentBySlug(slot.ailment_slug).symptoms` and rejects the payload; no foreign symptom reaches the wizard or fly.io.
- **Patient declines to fill some fields:** only `name` + `dob` are required (mirroring `canNext` at `wizard-container.tsx:52-54`); the rest are optional. The wizard pre-fills what it got and the pharmacist completes step 0 normally.
- **Patient fills the form but never submits / never arrives:** the slot stays `pending`, is marked `expired` by the cron after TTL, and is dropped from the picker. No PHI was ever written (nothing was submitted).
- **Pharmacist loads an intake, then goes Back and starts a different consult:** `consumed` is terminal; the same intake cannot be loaded twice into two wizards. The wizard the pharmacist abandoned is per-mount state (lost on navigation, like today — `WizardContainer` state is not persisted). No regression.
- **Link generated for the wrong ailment:** the pharmacist generates a new link for the correct ailment; the old slot expires. The patient cannot change the ailment (it is fixed by the slot, not patient-editable) — preventing a patient from routing their symptoms to the wrong clinical screen.
- **`generateIntakeLinkAction` called for a slug not in `data/ailments.json`:** `getAilmentBySlug` returns undefined; the action returns `{ error }` without creating a slot or signing a token. No orphan slots.
- **Token forgery attempt (no valid HMAC):** `verifyLink` returns null at every gate (`getIntakeContextAction`, `submitIntakeAction`); the page renders the invalid-link message and no write path is reachable.
- **A `"pre_intake"` token replayed against a future `"prom_followup"` verifier (or vice versa):** rejected by purpose-binding (the MAC covers `purpose`). Cross-feature token confusion is impossible.
- **`SIGNED_LINK_SECRET` rotation:** old tokens stop verifying (intended). In-flight pre-intakes would need re-issuance. Rotation procedure is an Open Question (§7); recommend a grace period with dual-secret verification if zero-downtime rotation is required.
- **QR rendered at the counter (no SMS/email):** the URL is the same token; the patient scans, fills over Wi-Fi/cellular, submits. The pharmacist's dashboard sees the intake arrive. This is the Option-C subset, fully supported by Option A's transport-agnostic URL.
- **Interaction with #5 (slimmed `PatientInfo`):** #5 removes `allergies`, `currentMeds`, `pregnant`, `breastfeeding`, `ohip`, `doctorLicense`. #8's `PreIntakeSubmission` already excludes the patient-non-enterable fields and treats `ohip` as optional; once #5 lands, the submission's `ohip` is dropped and the mapping to the slimmed `PatientInfo` tightens. No conflict; #8 is written to the post-#5 target shape with a graceful note.
- **Interaction with #2 (`resolvePatientId`):** the consult consuming a pre-intake resolves to the same `patient` row the wizard would, keyed by `identity_hash` from the submission's name+DOB+postal. A repeat patient's pre-intakes and assessments join cleanly — feeding #28 longitudinal and #10 follow-up.
- **Interaction with #10 (PROM follow-up):** #8 builds `src/lib/signed-links/` purpose-tagged for `"pre_intake" | "prom_followup"`; #10 adds its no-login PROM-response route consuming `verifyLink(token, "prom_followup")`, reusing the HMAC + expiry + purpose primitives and mirroring the single-use-on-resource pattern. No rework.
- **Multilingual (#24):** the intake page is EN in v1; #24 may later localize it (the collection notice + symptom labels). The token and slot are locale-agnostic. No NOW conflict.

---

## 7. Open Questions

1. **Retention window for `pre_intake_submission`.** The submission is a transient pre-fill source, not the legal record. Confirm the retention/deletion window after consumption (e.g., hard-delete 7 days after `consumed_at`, or immediately on consult save). Recommend a short window with a fly.io cleanup job; confirm vs. any college record-retention expectation (the `assessment` row is the retained record, not the submission).
2. **QR rendering — dependency or dependency-free?** The spec recommends a dependency-free inline SVG QR generator (or reusing the canvas pattern from #3's signature pad) so `package.json` stays clean. If reviewers prefer a vetted `qrcode` library, it is a small client-only dependency. Confirm.
3. **Transport (SMS/email dispatch) timing.** #8 produces the link; the pharmacist pastes it into whatever channel they use today. Automated Twilio/Resend dispatch is roadmap #10's work (it builds the transport once and both features reuse it). Confirm #8 should **not** wire a provider now (YAGNI), and that the link URL format is stable for #10 to embed.
4. **`SIGNED_LINK_SECRET` rotation procedure.** Confirm single-secret (rotation invalidates in-flight links) vs. dual-secret-with-grace (verify against either, mint with the new). Recommend dual-secret for zero-downtime rotation given #10 will also depend on it; specify the exact mechanism in the plan.
5. **Should the dashboard "Pending pre-intakes" panel surface the patient name before the pharmacist opens the consult?** The patient name lives in the fly.io submission (PHI), so showing it on the Supabase-backed dashboard requires a fly.io read per row. Options: (a) show ailment + submitted-time only on the dashboard and reveal the name on consult open (less PHI in the pharmacist's transient view), (b) cache the name on the Supabase slot (violates partitioning — rejected), (c) show the name (one fly.io read per pending row). Recommend (c) with a capped query (e.g., 20 most-recent) for usability; confirm.
6. **Cross-feature token table vs. one table per purpose.** The spec uses a `pre_intake` Supabase table for #8 and anticipates a separate `prom_*` table for #10, with the **signed-link module** shared but the **resource tables** separate. Alternatively, a single `signed_link` table with a `purpose` discriminator could hold both. Recommend separate resource tables (different columns, different lifecycles) + shared module; confirm.
7. **Collection-notice / consent wording legal review.** The no-login page's PHIPA collection notice (§4.7) must be reviewed by the pharmacy's privacy officer / counsel. Flagged as a soft launch gate (like #3's statements and #4's reasons). Confirm the exact wording path.
8. **Accessibility (AODA/AA) for the no-login page.** As a patient-facing Ontario public-facing surface, the intake page should meet AODA WCAG 2.1 AA (the staff app's bar may be lower). Confirm the required conformance level and whether an a11y audit is a launch gate.
9. **Should the patient be able to partially save and resume?** v1 requires the patient to complete and submit in one session (no resume). A "save draft" would require persisting partial PHI server-side keyed by the token — added complexity for an edge case. Recommend deferring; confirm.
10. **Should link generation be scoped to ailment only, or also to a named patient the pharmacist pre-enters?** v1 generates ailment-scoped links (the patient enters their own identity). A pharmacist-pre-entered patient name on the slot would make the slot PHI (defeating the non-PHI-slot design). Recommend ailment-only slots; confirm.
11. **Rate-limiting the public submit endpoint.** The unauthenticated `submitIntakeAction` is token-gated and single-use, but a brute-force token-guessing attempt is theoretically possible. Confirm whether a server-level rate limit (per-IP, on `/intake/[token]` POST) is a launch gate; recommend a lightweight per-IP limiter on the submit path given the public surface.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/signed-links/index.ts` — the #10-shared signed-link primitive (`signLink`, `verifyLink`, `newResourceId`, `SignedLinkPurpose`, `DEFAULT_PRE_INTAKE_TTL_SECONDS`); `node:crypto`-only, no new dependency.
- `src/lib/intake/types.ts` — `PreIntakeSubmission` (patient-enterable demographic subset + symptoms).
- `src/lib/intake/actions.ts` — `generateIntakeLinkAction`, `getIntakeContextAction`, `submitIntakeAction`, `loadIntakeAction` (mix of auth'd and token-auth'd `"use server"`).
- `src/app/intake/[token]/page.tsx` + `src/app/intake/[token]/intake-form.tsx` — the new no-login patient-facing route + mobile-first form + PHIPA collection notice.
- `src/components/dashboard/intake-picker.tsx` — the "Pending pre-intakes" panel.
- `src/__tests__/signed-links.test.ts` — sign/verify round-trip, tamper-detection, expiry, purpose-binding, timing-safe comparison.
- `src/__tests__/intake-actions.test.ts` — generate (auth + pharmacy scope + valid slug), context (token-auth, non-PHI payload), submit (single-use atomic, symptom validation, PHI_PERSIST_ENABLED gating, graceful no-op), load (auth + pharmacy scope).
- `src/__tests__/intake-form.test.tsx` — renders ailment symptoms, submit, error states, re-submit disabled.

**Modified:**
- `src/components/wizard/wizard-container.tsx` — accept optional `initialPatient`/`initialSymptoms`; seed `useState` (`wizard-container.tsx:42-44`); default unchanged.
- `src/app/assess/[ailment]/page.tsx` — read `searchParams.intake`; call `loadIntakeAction`; pass `initialPatient`/`initialSymptoms`; mark slot `consumed`; graceful fallback.
- `src/app/page.tsx` — render `<IntakePicker>` alongside `<AilmentGrid>` (`page.tsx:60`).
- `src/components/ailment-card.tsx` (or a sibling) — per-card "Generate pre-intake link" action + Copy/QR affordance.
- `src/lib/audit-actions.ts` — add `"intake.link_generated"`, `"intake.submitted"` to the `EventType` union (`audit-actions.ts:5-18`); metadata strictly `{ intake_id }`.
- `src/__tests__/wizard-container.test.tsx` (or sibling) — assert pre-fill seeding when `initialPatient`/`initialSymptoms` provided; assert blank default unchanged.

**Database (Supabase, non-PHI):** `pre_intake` table + RLS + `consume_pre_intake_slot` `SECURITY DEFINER` RPC (§4.4/§4.5); `intake.link_generated`/`intake.submitted` added to `audit.event_type`; `log_event` validation extended to allow only `{ intake_id }` metadata (no ailment/patient keys — mirroring #2's discipline).

**Database (fly.io, PHI, behind `PHI_PERSIST_ENABLED`/BAA):** `pre_intake_submission` table (§4.4); writes via `submitIntakeAction` stub when the flag is off.

**Environment (server-only):** `SIGNED_LINK_SECRET` (HMAC key); `PRE_INTAKE_TTL_SECONDS` (optional, default 86400); `NEXT_PUBLIC_APP_URL` (already required for absolute link URLs — confirm presence). `PHI_PERSIST_ENABLED` / `FLY_PHI_DATABASE_URL` inherited from #2 for the PHI write.

**Not touched (deliberately):** `data/ailments.json` (governance constraint — the page reads it via `getAilmentBySlug`); any clinical-safety logic / red-flag screen / Rx selection (PMS/pharmacist-owned, roadmap §3); `package.json` (no new dependency — `node:crypto` only); the referral path / `referral-pdf.tsx`; #3's consent capture (orthogonal); #10's transport (built later, reuses the signed-link module). The PHI submit + retrieval is BAA-gated like every #2-dependent feature; the non-PHI plumbing ships live.
