# CDST Competitive Research & Feature Roadmap — Design

**Date:** 2026-06-23
**Scope:** Canada-wide minor-ailments CDST market, primary buyer = independent community pharmacies
**Status:** Draft (pending user review)

---

## 1. Product Context

A Clinical Decision Support Tool (CDST) for Ontario community pharmacists prescribing under **O. Reg. 256/24** (19 minor ailments). Web app (Next.js 16, React 19, Supabase Auth). Core flow: patient intake → red-flag screening → Rx selection → PDF generation. Designed for live, time-pressured counter consultations.

This document captures: (a) the Canadian competitive landscape, (b) a gap analysis of the current build, (c) the differentiation strategy, (d) a prioritized feature roadmap, and (e) the persistence/compliance architecture required to ship the highest-priority items.

---

## 2. Competitive Landscape (Canada)

| Competitor | Type | Pricing | Strength | Weakness |
|---|---|---|---|---|
| **MAPflow** (U. Waterloo spinout, sold via OPA) | Standalone CDST | ~$350/yr individual; per-pharmacy tier (unlimited users) | OPA endorsement; AI-assisted; research-validated (88.6% UTI clinical cure); "Academy" training; province-specific algorithms; patient-led follow-up; role-based access | No PMS write-back; standalone; minor-ailments-only; narrow surface |
| **PharmAssess** (Leslie Dan spinout) | Full clinical suite | **$150/mo** full bundle; $95/mo FillAssist | PMS write-back (Fillware); 51 conditions across 9 provinces; full suite (vaccinations, med reviews, appointments, POC testing, IVR, patient comms); DermNet clinical images; MedSask content; e-fax (Documo); 600+ pharmacies | Expensive; breadth adds complexity; not AI-native |
| **Kroll** (TELUS Health) | PMS-native module | Bundled in PMS | Lives inside the dispense workflow; zero double entry | TELUS lock-in; shallow CDSS; not best-of-breed decision support |
| **RxConsultAction** (Vigilance Santé) | Documentation tool | n/a | Strong in QC; clinical-intervention documentation | Documentation > decision-support |

**Remuneration reality (Ontario):** ~**$15 per minor-ailment consultation**. PharmAssess at $150/mo requires ~10 consults/month just to break even; MAPflow at $350/yr requires ~23 consults/year. **Price sensitivity is acute for independent pharmacies** — this is the core market wedge.

---

## 3. Gap Analysis — Current Build

Built today: 19 ailments, 4-step wizard (patient → red flags → Rx → PDF), red-flag hard-block, referral vs. prescribe branches, client-side PDF generation, Supabase auth (owner/pharmacist roles), multi-pharmacy switcher, team invites, partial audit log, PHIPA footer.

**Unforced gaps identified in code:**

| Gap | Evidence | Impact |
|---|---|---|
| Assessments are NOT persisted to any DB | `AssessmentData` type exists (`src/types/index.ts:59`) but no write occurs; only a tx ID is reserved (`prescription-actions.ts:14`) | No legal/clinical record kept. Audit and college-compliance blocker for any pharmacy owner. |
| Manual fax workflow | Combined/referral PDFs instruct "print, sign, and fax" | Time loss per consult; PharmAssess e-faxes automatically |
| No digital consent capture | Not present | PHIPA exposure; audit gap |
| Refusal/non-prescribe path undocumented | Red flags block, but refusal reasoning is not captured | Inconsistent refusal documentation (ODPRN-flagged industry gap) |
| Platform-admin surface stubbed | `requirePlatformAdmin` guard + `getAuditLog` exist but no admin UI | Cannot manage tenants or read audit data |
| Multi-pharmacy actions orphaned | `addPharmacy`/`leavePharmacy` (`pharmacy-actions.ts:64,130`) have no UI | Feature dead code |
| Audit events declared but never emitted | `assessment.opened`, `pdf.generated`, `export.requested` defined, no call sites | Audit log incomplete |

**Out of scope (by decision):** Allergy/drug-interaction checking, pregnancy/breastfeeding Rx gating, and auto-billing are explicitly excluded — the **PMS already owns clinical-safety checks and claim submission**. The CDST must not duplicate PMS responsibilities.

---

## 4. Differentiation Strategy (The Wedge)

> **"Best-of-breed decision support + workflow/documentation automation, priced for independents, AI-native."**

- vs **MAPflow**: win on **workflow automation they refuse to do** — e-fax, persisted audit-proof records, patient pre-intake, follow-up/outcome tracking.
- vs **PharmAssess**: win on **price + focus + AI + calm UX** — full feature set at ~$50–75/mo vs their $150/mo; 3–4 consults to break even instead of 10.
- vs **Kroll**: win on **decision-support depth** (differentials, citations, AI) that PMS modules lack.

The CDST's job is **the assessment itself + its documentation + the patient follow-through** — not clinical safety nets and not billing.

---

## 5. Feature Roadmap (Prioritized)

Scoring: Impact × Competitive Edge ÷ Effort. Tiers reflect sequencing for an independent-pharmacy GTM.

### 🔴 NOW — Unforced losses / table-stakes

| # | Feature | Edge axis | Rationale |
|---|---|---|---|
| 1 | **e-Fax referral + prescriber notification** (Phaxio or Documo) | Speed | Eliminates manual fax. PharmAssess has it; we don't. |
| 2 | **Persist assessments** to PHI store (fly.io Postgres, BAA) | Compliance | Today zero records are kept — a legal/audit blocker for owners. |
| 3 | **Digital patient consent capture** (signature) | Compliance | PHIPA + audit-ready. |
| 4 | **Refusal / non-prescribe documentation** | Compliance | ODPRN-flagged industry gap; nobody does it consistently. |
| 5 | **Stop duplicating PMS data** (keep PDF-only copies, no safety checks) | Focus | Remove unforced duplication; respect PMS boundary. |
| 22 | **Vaccination workflow** (triage, consent, lot/expiry, inventory tracking) | Speed/Revenue | Ontario adds 6 new vaccines July 2026; PharmAssess has it, MAPflow doesn't. Opens vax revenue. |

### 🟠 NEXT — Differentiators vs. MAPflow + PharmAssess

| # | Feature | Edge axis | Rationale |
|---|---|---|---|
| 6 | **Differential diagnosis + DermNet clinical images** | Clinical | PharmAssess has, MAPflow weak; boosts prescriber confidence. |
| 7 | **AI-drafted assessment notes** (SOAP from intake) | Speed | Counters MAPflow AI; saves 60–90s/consult. |
| 8 | **Patient pre-intake link** (mobile; demographics + symptoms filled before arrival) | Speed | Compresses counter time below 3 min; nobody does this well. |
| 9 | **Evidence citations per protocol step** | Clinical | Trust + liability shield. |
| 10 | **Automated PROM follow-up pipeline** — signed-link SMS (Twilio) / email (Resend) at T+3 / T+7, patient answers structured Patient-Reported Outcome questions on a no-login page, responses land in fly.io (BAA). SMS/email carry no PHI; link is HMAC-signed, expiring, single-use. | Retention/Compliance | Beats MAPflow patient-led follow-up; builds the structured outcomes dataset that feeds #14. Pennies/consult. |
| 11 | **Pharmacist e-signature on PDF** | Compliance | Print-ready, legitimate. |
| 12 | **Smart sig auto-suggest + "last-used Rx" recall per ailment** | Speed | Fewer clicks per consult. |
| 24 | **Multilingual patient instructions** (FR-first) | Clinical/Market | Opens QC entry + ON equity. PharmAssess excludes QC entirely. |

### 🟢 LATER — Platform / expansion

| # | Feature | Edge axis |
|---|---|---|
| 13 | **Analytics dashboard + ROI calculator** | Business value (PharmAssess has, MAPflow doesn't) |
| 14 | **Outcomes data → publish study** (like MAPflow's 88.6% UTI result) | Credibility moat |
| 15 | **Multi-province scope** (BC/AB/NS/SK/MB/NL/NB/PE) | Market expansion |
| 16 | **Appointment booking** | Demand generation |
| 17 | **Keyboard-first + voice/dictation** | Counter speed |
| 18 | **White-label for banners** (Pharmasave, DrugStore) | Distribution |
| 19 | **Expand services** (med reviews, etc.) | Platform play |
| 20 | **CE/academy module** (new-grad training) | Counters MAPflow Academy |
| 21 | **+9 minor ailments ready** (data layer scales 19 → 28) | Scope-readiness (ON, July 2026) |
| 23 | **Virtual consult tooling** (documented video/phone; $15 virtual fee exists) | Telepharmacy trend |
| 25 | **Revenue-leakage optimizer** (analytics surfacing missed follow-ups / eligible-but-unscreened = $X unclaimed) | Owner ROI; neither rival surfaces this |
| 26 | **Clinical content governance + versioning** (authors / reviewers / changelog per protocol) | Audit defensibility + trust (match MAPflow "Authors & Reviewers") |
| 27 | **PROM library** — validated Patient-Reported Outcome questionnaires per condition | Real-world-data trend; feeds #10/#14 |
| 28 | **Chronic disease / Pharmacy Care Clinic module** (hypertension, diabetes, asthma + longitudinal record) | Post-minor-ailments frontier; PharmAssess ships this, MAPflow has a Care Clinics page |
| 29 | **Point-of-care testing + lab-order readiness** (strep, A1c, INR; ON consulting on pharmacist lab ordering) | Scope creep toward diagnostics; first-mover if ON grants labs |
| 30 | **Provincial EHR / FHIR connect** (read med history from ConnectingOntario / Netcare; push encounter summary) | NCPDP/FHIR interop push; moat PMS can't easily match |
| 31 | **Real-world evidence dataset product** (anonymized, pharma-partnered) | RWD trend + monetization; new revenue line |

---

## 6. Persistence & Compliance Architecture

### 6.1 Regulatory scope

| Regulation | Applies | Reason |
|---|---|---|
| **PHIPA** (Ontario) | ✅ Yes | PHI stored for Ontario patients. Primary law. |
| **PIPEDA** (federal) | ✅ Yes | Commercial handling of personal info; mandatory breach notice. |
| **HIPAA** (US) | ❌ No | Only if serving US pharmacies (future). |
| **FDA 21 CFR Part 11** | ❌ No | Applies to GxP/drug-mfg/clinical-trial validated systems. A pharmacy documentation tool is not one. No validation required. |

### 6.2 Architecture decision — split infrastructure

**Decision:** PHI lives on **fly.io Postgres with a signed BAA**; **Supabase is retained for auth and non-PHI metadata only.**

| Store | Hosts | Why |
|---|---|---|
| **fly.io Postgres** (BAA, encrypted volumes) | PHI: assessments, follow-ups, outcomes, patient demographics within an assessment, clinical notes | BAA-backed; cheaper PHI storage; full operational control |
| **Supabase** | Non-PHI: auth, profiles, pharmacies, pharmacy_members, invitations, audit metadata | Already wired; keeps auth simple; no PHI risk here |

**Linking model:** Supabase JWT (pharmacist identity + `pharmacy_id`) is verified by the app layer and used to scope fly.io rows by `pharmacy_id` / `pharmacist_id` ownership. No PHI identifier crosses into Supabase.

### 6.3 PHIPA/PIPEDA control matrix

| Control | Implementation |
|---|---|
| Consent | Digital consent capture (roadmap #3) recorded with each assessment |
| Encryption | AES-256 at rest (fly encrypted volumes) + TLS in transit |
| Access isolation | Row-level scoping by `pharmacy_id`; RBAC (owner/pharmacist) carried from Supabase |
| Audit trail | Every read/write/emit on PHI logged with actor + timestamp (extend existing `audit.log` pattern, replicated to fly.io) |
| Retention + disposal | ON college retention (~10 yr for Rx records) enforced by retention job + secure deletion |
| Breach response | PIPEDA breach log + notification procedure; documented |
| Accountability | BAA with fly.io; named privacy officer; data-flow map |

### 6.4 Data partitioning rule

> **Rule:** If a field could identify a patient or describe their clinical state, it goes to fly.io. If it describes the pharmacy, the pharmacist, or the software account, it stays in Supabase.

---

## 7. Open Questions

1. **fly.io ops ownership** — running our own Postgres means we own backups, PITR, monitoring. Confirm acceptable vs. managed Postgres (e.g., fly.io managed vs. self-hosted on a VM).
2. **BAA execution** — fly.io BAA must be signed before any PHI lands. Sequencing vs. building the persistence feature.
3. **Province expansion priority** — which province after ON for roadmap #15 (BC and NS are the largest expanded-scope markets).
4. **Pricing** — confirm the ~$50–75/mo target for the GTM wedge vs. free tier for early independents.

---

## 8. Next Step

This spec defines **what** to build and **why**. On approval, the next step is to invoke the **writing-plans** skill to produce a detailed implementation plan for the **NOW tier** (#1–5), starting with the fly.io PHI persistence foundation (item #2), since items #3 and #4 depend on it.
