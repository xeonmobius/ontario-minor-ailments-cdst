# e-Fax Referral + Prescriber Notification — Design

**Date:** 2026-06-23
**Roadmap item:** #1 (NOW tier) — "e-Fax referral + prescriber notification (Phaxio or Documo)"
**Status:** Draft (pending review)

---

## 1. Purpose

Today the CDST generates two PDF documents entirely in the browser and instructs the pharmacist to **print, sign, and fax them manually**:

- The **combined prescription + prescriber-notification PDF** (`src/components/combined-pdf.tsx`), downloaded from `src/components/wizard/step-generate.tsx:75` with the helper copy "Print, sign, and fax to the physician" (`step-generate.tsx:79`).
- The **referral PDF** (`src/components/wizard/referral-pdf.tsx`), downloaded from the referral branch of `src/components/wizard/wizard-container.tsx:167` with the copy "Print, sign, and fax this referral to the patient's family physician" (`wizard-container.tsx:170`).

This manual step costs roughly one to two minutes per consult, is error-prone (wrong fax number, lost pages, no proof of transmission), and is a feature PharmAssess already ships. **e-Fax referral + prescriber notification** lets the pharmacist send the already-generated PDF to the patient's family physician with a single click, directly from the assessment wizard, and records proof of transmission for audit.

This is the highest-leverage NOW-tier item: pure speed/competitive-parity, no clinical-safety logic (the PMS still owns that), and it reuses the exact PDF components that already exist.

**Out of scope** (explicitly, per roadmap §3 and §6): allergy/drug-interaction checks, pregnancy gating, billing/claims, and any clinical content change. The fax carries the same document that is downloaded today; only the transport changes.

---

## 2. Current State (what exists in code)

### 2.1 PDF generation is 100% client-side

Both documents are React components rendered with `@react-pdf/renderer` (`^4.5.1`, `package.json:15`). The browser builds a Blob via `pdf(document).toBlob()` in `src/lib/pdf-helpers.ts:5` and triggers a download. The server never sees the document bytes.

- `CombinedPdf` (`src/components/combined-pdf.tsx:171`) — props include `ailment`, `patient`, `selectedRx`, `assessmentNotes`, `dateOfAssessment`, `pharmacy`, `symptomsChecked`, `nonRxChecked`, `txId?`.
- `ReferralPdf` (`src/components/wizard/referral-pdf.tsx:152`) — props include `ailment`, `patient`, `redFlagsChecked`, `dateOfAssessment`, `pharmacy`.
- Both already render a **"Family Physician (Faxed to)"** block with `patient.doctorName`, `patient.doctorLicense`, `patient.doctorPhone`, `patient.doctorFax`, `patient.doctorAddress` (`combined-pdf.tsx:242-250`; `referral-pdf.tsx:199-209`). The destination fax number is already a first-class field on the document.

### 2.2 Destination data is available but client-resident

`PatientInfo` (`src/types/index.ts:18`) carries `doctorName`, `doctorLicense`, `doctorPhone`, `doctorFax`, `doctorAddress`. The sender identity is `PharmacyDefaults.fax` (`types/index.ts:46`), which the assess page loads from the `pharmacies.fax` column (`src/app/assess/[ailment]/page.tsx:26-38`). None of this assessment data is persisted yet (see roadmap gap table and `AssessmentData` type at `types/index.ts:59`, which has no write path).

### 2.3 Transaction ID exists for prescriptions only

`reserveTxId()` (`src/lib/prescription-actions.ts:6`) calls the `next_prescription_tx` RPC and returns a `TX-{YYYY}-{NNNNNN}` id. It is reserved lazily in `step-generate.tsx:28-34` on first download. The referral path does **not** reserve any correlation id.

### 2.4 Audit log is non-PHI and has no fax event

`logAuditEvent()` (`src/lib/audit-actions.ts:20`) writes to the Supabase `audit.log` table via the `log_event` SECURITY DEFINER function. The accepted `EventType` union (`audit-actions.ts:5-18`) includes `pdf.generated` (currently no call site) but **no fax event**. The audit design (`docs/superpowers/specs/2026-06-06-audit-log-design.md`) explicitly states this Supabase log stores **no PHI** and that PHI audit events belong on fly.io.

### 2.5 Route-handler pattern

API routes follow `export async function POST(request: Request)` returning `NextResponse.json(...)` (e.g. `src/app/api/auth/login/route.ts`). Auth in route handlers uses `createRouteHandlerClient` (`src/lib/supabase/route-handler.ts`); server actions use `createClient` (`src/lib/supabase/server.ts`) plus `requireAuth()` (`src/lib/auth-guards.ts:44`).

### 2.6 No fax provider integration exists

A grep for `Phaxio`/`Documo`/`sendFax` across `src/` returns nothing. The only `fax` references are the demographic `fax` columns/fields on `pharmacies` and `PatientInfo` (`types/index.ts:46,102`). No fax SDK is installed.

---

## 3. Approach (options + recommendation)

The core design decision is **where the PDF bytes are produced for transmission** and **how they reach the fax provider**.

### Option A — Client-generated Blob → route handler → provider (RECOMMENDED)

The browser already produces the PDF Blob. Instead of (or in addition to) triggering a download, the client POSTs the Blob plus non-PHI metadata to a new route handler, which forwards it to the fax provider and records the delivery.

- **Pros:** Zero changes to the PDF components or their render path. Reuses the exact document the pharmacist already sees. No server-side React/PDF rendering or font registration. Lowest risk, smallest diff. Works identically for prescription and referral.
- **Cons:** PHI bytes transit the Next.js server briefly (in memory; never written to disk on Supabase-hosted routes). The destination number cannot be verified against a stored assessment record because assessments are not persisted yet (see §6, Edge cases).

### Option B — Server-side PDF render → provider

Render `CombinedPdf`/`ReferralPdf` on the server using `@react-pdf/renderer`'s Node stream/buffer API from a server action, then send.

- **Pros:** Single render path; server owns the canonical document (useful later for archival and #11 e-signature); destination can be bound to server-owned state.
- **Cons:** Requires server-side `@react-pdf/renderer` setup (font registration, the `"use client"` directive interaction), larger surface, and is premature while documents are not yet persisted (#2). Diverges from the proven client render path.

### Option C — Provider "fax-from-email/URL"

Phaxio/Documo can send a fax from a hosted document URL or a dedicated email address.

- **Pros:** Trivial.
- **Cons:** Requires hosting the PHI PDF at a URL (PHI at rest on a CDN = new attack surface) or emailing PHI (worse). Rejected.

### Recommendation

**Option A for the NOW tier.** It delivers the competitive feature with the smallest, safest change set and reuses the existing documents byte-for-byte. The spec is written so that **Option B becomes the natural evolution** once roadmap #2 (persist assessments on fly.io) and #11 (e-signature) land — at that point the server owns the canonical document, the destination can be validated against stored state, and the render path can move server-side with the same route-handler contract.

---

## 4. Components & Data Model

### 4.1 Client integration

Add a **"Fax to physician"** action beside each existing Download button. Both paths share one client helper.

- `src/components/wizard/step-generate.tsx` — beside the "Download Prescription + Doctor Notification PDF" button (`step-generate.tsx:75`), add a "Fax to physician" button. It builds the same `<CombinedPdf .../>` element, calls `pdf(doc).toBlob()` (the same primitive `pdf-helpers.ts:5` uses), wraps the Blob in `FormData`, and POSTs to `/api/fax/send`. Reuse the already-reserved `txId` (`step-generate.tsx:24`) as the correlation key.
- `src/components/wizard/wizard-container.tsx` — in the referral branch (`wizard-container.tsx:142-172`), beside "Download Referral PDF" (`wizard-container.tsx:167`), add a "Fax referral" button that does the same with `<ReferralPdf .../>`. Because referrals reserve no `tx_id` today, the client generates a fresh `correlationId` (UUID) for each send.
- `src/lib/fax-client.ts` (new) — a thin client helper: `sendFax({ blob, toNumber, documentType, correlationId, txId? })` → `POST /api/fax/send` with multipart form, returns `{ ok, providerFaxId, correlationId }` or `{ error }`. Centralizes fetch + error mapping so both buttons stay identical.

**Destination rule:** the action is enabled only when `patient.doctorFax` is present and non-empty; otherwise it is disabled with helper text ("Add the physician's fax number on the Patient step to enable e-fax") and the manual download path remains. The sender `caller_id` is `pharmacy.fax`.

### 4.2 Route handlers (server)

- `POST /api/fax/send` (`src/app/api/fax/send/route.ts`, new)
  - Accepts `multipart/form-data`: `file` (the PDF Blob) + fields `toNumber`, `documentType` (`"prescription" | "referral"`), `correlationId` (UUID), `txId?`.
  - Auth: `requireAuth()` (the cookie session reaches route handlers via `createClient`/`createRouteHandlerClient`). Reject if no `pharmacyId`.
  - Validates `toNumber` is a valid North-American E.164-ish format (`+1…` 10-digit). Validates `file` MIME is `application/pdf` and size ≤ a small cap (e.g. 2 MB; these are single-page docs).
  - Enforces a per-pharmacy rate limit (see §6).
  - Computes `content_sha256` of the received bytes (integrity/non-repudiation).
  - Calls the provider (§4.4) with `to=<toNumber>`, `file=<pdf>`, `caller_id=<pharmacy.fax>`. Captures `provider_fax_id`.
  - **Audit (non-PHI, Supabase):** emits `fax.sent` with metadata `{ correlation_id, status: "queued", provider }`. **No destination number, no patient data.**
  - **Delivery record (PHI, fly.io):** inserts into `fax_delivery` (§4.3) — `to_number`, `provider_fax_id`, `content_sha256`, etc. This write is gated on fly.io provisioning (roadmap #2). Until fly.io is live, this step is a documented no-op stub so the feature can ship behind a flag, and the table schema below is ready to migrate.
  - Returns `{ ok: true, providerFaxId, correlationId }` or an error status (400 validation, 429 rate limit, 502 provider failure).

- `POST /api/fax/webhook` (`src/app/api/fax/webhook/route.ts`, new)
  - Receiver for the provider's delivery-status callback (queued → sending → success/failure).
  - No session auth; integrity is enforced by verifying the provider's HMAC signature header against a server-side webhook secret.
  - Updates `fax_delivery.status` / `delivered_at` / `error_message` by `provider_fax_id` (idempotent upsert — callbacks can arrive out of order or be replayed).
  - Records nothing in the Supabase audit log (delivery status tied to a destination is PHI; it lives on fly.io).

### 4.3 Data model

**fly.io Postgres — `fax_delivery` (PHI, under BAA).** Designed now; migrated when fly.io is provisioned (depends on roadmap #2). Row-scoped by `pharmacy_id`/`pharmacist_id` (Supabase JWT identity, per roadmap §6.2 linking model).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `pharmacy_id` | uuid | FK → Supabase `pharmacies.id` (id copied, not enforced cross-DB) |
| `pharmacist_id` | uuid | FK → Supabase `profiles.id` |
| `tx_id` | text NULL | correlation to `prescription_tx.tx_id` when `document_type='prescription'` |
| `correlation_id` | uuid NOT NULL | per-send idempotency key (client-generated UUID) |
| `document_type` | text NOT NULL | `'prescription' \| 'referral'` |
| `to_number` | text NOT NULL | **PHI-adjacent** destination (physician fax) |
| `from_number` | text | sender CSID (`pharmacy.fax`) |
| `provider` | text NOT NULL | `'phaxio' \| 'documo'` |
| `provider_fax_id` | text | provider's fax id (for webhook matching) |
| `direction` | text NOT NULL | `'outbound'` |
| `status` | text NOT NULL | `'queued' \| 'sending' \| 'success' \| 'failed'` |
| `content_sha256` | text NOT NULL | hash of faxed PDF bytes |
| `page_count` | int | billed pages |
| `error_message` | text NULL | provider failure detail |
| `sent_at` | timestamptz NOT NULL | `now()` |
| `delivered_at` | timestamptz NULL | set by webhook |
| `created_at` | timestamptz NOT NULL | `now()` |

Indexes: `(pharmacy_id, sent_at desc)`, `(provider, provider_fax_id)` (webhook lookup), `(correlation_id)`. RLS equivalent: app-layer scoping by `pharmacy_id` from the verified Supabase JWT (fly.io has no Postgres RLS relationship to Supabase auth; the application enforces ownership, per roadmap §6.2).

**Supabase — audit enum extension (non-PHI).** Add `fax.sent` to `audit.event_type` and extend the `log_event` validation to require `correlation_id` + `status` + `provider` and to **reject** any `to_*`/patient key (defense-in-depth so a future caller cannot leak a destination into the non-PHI log).

### 4.4 Provider integration (`src/lib/fax/`)

A small provider abstraction so a swap between Phaxio/Documo is a one-file change:

- `src/lib/fax/provider.ts` — interface `FaxProvider { send({ toNumber, pdf, callerId }): Promise<{ providerFaxId, status }> }`.
- `src/lib/fax/phaxio.ts` — Phaxio v2.1 implementation: `POST https://api.phaxio.com/v2.1/faxes` with multipart `to`, `file`, `caller_id`; auth via `PHAXIO_API_KEY` + `PHAXIO_API_SECRET` (HTTP Basic). Returns the parsed `id`.
- `src/lib/fax/documo.ts` — Documo implementation (alternative; HMAC-signed REST). Kept as a stub interface conformance if Phaxio is chosen, fully implemented if Documo is chosen.
- `src/lib/fax/index.ts` — selects the provider from `FAX_PROVIDER` env (default `phaxio`). Reads `verifyWebhookSignature(header, body)` for `/api/fax/webhook`.

**Environment (server-only, never `NEXT_PUBLIC_`):** `FAX_ENABLED`, `FAX_PROVIDER`, `PHAXIO_API_KEY`, `PHAXIO_API_SECRET`, `FAX_WEBHOOK_SECRET`. Behind `FAX_ENABLED` so the feature ships dark until the BAA is signed (§6).

---

## 5. Security / PHIPA-PIPEDA Posture

This feature touches PHI (the document content and the destination fax number) and therefore must respect the **fly.io-BAA / Supabase-auth split** from roadmap §6.2 and the data-partitioning rule in §6.4.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| PDF document bytes (patient name, DOB, dx, Rx) | PHI | Transit only in Option A; **never** written to Supabase. Optional archive copy → fly.io object storage (scope of #2, open question §7). |
| Destination `to_number` (physician fax) | PHI | `fax_delivery.to_number` on **fly.io** only. Never in Supabase. |
| Sender `from_number` (pharmacy fax) | Non-PHI (business) | Already on Supabase `pharmacies.fax`; also mirrored in `fax_delivery`. |
| `content_sha256` | Non-identifying | Allowed on fly.io; could also sit in audit — kept on fly.io with the record. |
| `correlation_id`, `status`, `provider`, `document_type` | Non-PHI | **Only these** go to the Supabase `audit.log` `fax.sent` event. |
| `tx_id` | Non-PHI (already non-PHI per the prescription-tx-id spec) | May appear in audit metadata. |

The `log_event` validation is explicitly extended to **reject** destination/patient keys, so a programming error cannot accidentally persist a fax number in the non-PHI log.

### 5.2 Regulatory mapping

- **PHIPA s.12 / s.10.1:** faxing to a treating physician is a permitted disclosure for continuity of care; the audit trail (correlation id + status) plus the fly.io delivery record (destination + content hash) satisfy accountability.
- **PIPEDA Principle 4.1 / 4.7:** the fax provider is a **business associate** handling PHI → a signed **BAA is a hard gate** before any production PHI fax. Both Phaxio and Documo offer BAAs. Until signed, the feature stays behind `FAX_ENABLED=false`.
- **Cross-border (PHIPA s.17):** Phaxio's processing is US-based; PHI bytes transit US infrastructure en route to the (Canadian) physician fax. This is a disclosure outside Ontario that PHIPA permits with consent. Mitigations: (a) BAA with the provider, (b) transparency in the privacy policy, (c) prefer a provider with a BAA and transient-only processing. **Whether a Canadian-resident provider is required is an open question (§7).** The destination itself remains in Canada.
- **Consent linkage:** the digital-consent feature (#3) will, when shipped, attach a consent reference to each fax. For now, the pharmacist's act of sending is the documented disclosure event.

### 5.3 Application security

- **Provider credentials** are server-only env vars; never exposed to the client, never prefixed `NEXT_PUBLIC_`.
- **Destination validation + rate limiting:** until assessments are persisted (#2) the destination is client-supplied and cannot be cross-checked against stored state. We mitigate with (a) strict number-format validation, (b) a per-pharmacy rate limit (e.g. 20 outbound faxes/hour) enforced in `/api/fax/send` with a simple counter in Supabase (non-PHI), and (c) full audit + delivery record. After #2 lands, `to_number` must be validated against the stored assessment's physician fax.
- **SSRF / abuse:** the only outbound network call is to the chosen fax provider's fixed API base URL; `toNumber` is never used as a URL. Rate limiting bounds cost exposure (per-page billing abuse).
- **Webhook integrity:** `/api/fax/webhook` verifies the provider HMAC signature with `FAX_WEBHOOK_SECRET` and ignores unmatched payloads. It performs idempotent upserts keyed on `provider_fax_id`.
- **Non-repudiation:** `content_sha256` proves what was sent without retaining the full PHI document on a non-BAA store.

---

## 6. Edge Cases

- **No physician fax on file (`patient.doctorFax` empty):** disable the Fax button; show helper text; the Download/manual path remains available. (Ad-hoc destination entry is an open question, §7.)
- **Patient with no physician at all (`doctorName` empty):** same — manual path only; the prescriber-notification block already renders conditionally (`combined-pdf.tsx:242-253`).
- **Referral has no `tx_id`:** use a client-generated `correlation_id` (UUID); `fax_delivery.tx_id` stays NULL for `document_type='referral'`.
- **Provider 5xx / network failure:** `/api/fax/send` returns 502; client shows a retryable error; no provider fax is created, no Supabase audit row is written (the attempt is only worth recording once a provider fax id exists — or we record `status:'failed'`; see open question §7).
- **Fax busy / no answer:** the provider retries per its own policy; the final outcome arrives via webhook and is reflected in the UI on next view of the record. The wizard shows an optimistic "Sent — delivery pending" state, not "Delivered."
- **Double-click / double-send:** the client disables the button on click and sends a single `correlation_id`; the route handler treats `correlation_id` as the idempotency key (a second POST with the same id returns the first result rather than sending again).
- **Rate limit exceeded:** `/api/fax/send` returns 429; UI shows "Too many faxes — try again shortly."
- **Webhook arrives before the `fax_delivery` insert / arrives out of order:** upsert by `provider_fax_id`; missing-row webhook is stored/queued or dropped per provider guidance (open question, §7).
- **Multi-page / oversized PDF:** enforce a page/size cap in `/api/fax/send`; reject oversized payloads to bound per-page billing.
- **fly.io not yet provisioned (Phase 1):** the `fax_delivery` write is a no-op stub behind a feature check; the Supabase `fax.sent` audit event still records `correlation_id` + `status`. The delivery record lights up automatically once #2 provisions fly.io and the migration is applied.
- **Feature disabled (`FAX_ENABLED=false`):** the Fax buttons are not rendered; the UI falls back to today's Download-only behaviour with no errors.

---

## 7. Open Questions

1. **Provider choice + data residency.** Phaxio (best DX, dedicated fax API, BAA) vs Documo (what PharmAssess uses) vs a Canadian-resident provider to avoid PHIPA s.17 cross-border processing entirely. Recommendation: Phaxio, pending the data-residency call below.
2. **Is Canadian data residency required for the fax transport?** If yes, Phaxio/Documo (US) may be disqualifying and a Canadian provider or a different transport must be found. This is the single biggest compliance decision for this feature.
3. **BAA execution timing.** The provider BAA must be signed before any production PHI fax. Confirm signing is on the critical path (gate for `FAX_ENABLED=true`).
4. **Ad-hoc destination entry.** When no physician fax is on file, should the pharmacist be allowed to type a fax number inline for the send? This is convenient but increases the unvalidated-destination risk until #2 persists assessments.
5. **Failed-attempt audit.** Should a provider-side failure (no `provider_fax_id`) still emit a `fax.sent { status:'failed' }` audit row, or only successful queue-accepted sends?
6. **Full-PDF archival vs hash-only.** Do we store the faxed PDF copy (full PHI) on fly.io object storage for the legal record, or only its `content_sha256`? (Ties into the scope of roadmap #2.)
7. **Out-of-order / orphan webhooks.** If a webhook arrives for a `provider_fax_id` with no matching `fax_delivery` row (e.g. webhook beat the insert, or Phase-1 stub skipped the insert), do we buffer it or drop it?
8. **Referral correlation id space.** Should the referral path adopt the existing `prescription_tx` sequence (renaming it to a generic "document tx") or keep using an opaque UUID? Affects how referral records cross-reference audit/delivery rows.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/fax/provider.ts`, `src/lib/fax/phaxio.ts`, `src/lib/fax/documo.ts`, `src/lib/fax/index.ts`
- `src/lib/fax-client.ts`
- `src/app/api/fax/send/route.ts`
- `src/app/api/fax/webhook/route.ts`

**Modified:**
- `src/components/wizard/step-generate.tsx` — add Fax button + handler using `txId` as correlation.
- `src/components/wizard/wizard-container.tsx` — add Fax button + handler in the referral branch using a generated `correlation_id`.
- `src/lib/audit-actions.ts` — add `"fax.sent"` to the `EventType` union.
- Database (Supabase): extend `audit.event_type` enum with `'fax.sent'`; extend `log_event` validation.
- Database (fly.io, when provisioned): `fax_delivery` table (§4.3).
- Environment: `FAX_ENABLED`, `FAX_PROVIDER`, `PHAXIO_API_KEY`, `PHAXIO_API_SECRET`, `FAX_WEBHOOK_SECRET`.
