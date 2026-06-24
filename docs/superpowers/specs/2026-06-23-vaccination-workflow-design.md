# Vaccination Workflow — Design

**Date:** 2026-06-23
**Roadmap item:** #22 (NOW tier) — "Vaccination workflow (triage, consent, lot/expiry, inventory tracking)"
**Status:** Draft (pending review)

---

## 1. Purpose

The CDST is, today, a single-purpose minor-ailments tool: 19 ailments, one 4-step wizard (`src/components/wizard/wizard-container.tsx:40`), one data source (`data/ailments.json` via `src/lib/ailments.ts:4`), one entry surface (`<AilmentGrid/>` at `src/app/page.tsx:60`), and one route shape (`/assess/[ailment]/page.tsx`). Every clinical object in the codebase is an `Ailment` (`src/types/index.ts:7-16`) and every encounter is an `AssessmentData` (`types/index.ts:59-67`) whose terminal outcomes are *prescribe* or *red-flag referral*. There is **no concept of a vaccine, a vaccination, a vaccine lot, a contraindication screen, or vaccine inventory anywhere in the codebase** — a `rg` for `vaccin|immuniz|immunis|vax|booster|lot_number|expiry` across `src/` returns zero true positives (the only matches are `data-slot` attributes on UI primitives matching the substring `lot`). Vaccination is a structurally different clinical workflow that the current wizard cannot express.

This is a revenue and market-share gap the competitive research calls out explicitly: *"Vaccination workflow (triage, consent, lot/expiry, inventory tracking) — Ontario adds 6 new vaccines July 2026; PharmAssess has it, MAPflow doesn't. Opens vax revenue"* (`docs/superpowers/specs/2026-06-23-cdst-competitive-roadmap-design.md` §5, NOW tier, row #22). PharmAssess ships full vaccination management (`2026-06-23-cdst-competitive-roadmap-design.md` §2, competitor row: "vaccinations… 600+ pharmacies"); MAPflow does not. Ontario's expansion of the pharmacist injection authority — adding six additional vaccines in July 2026 — turns community-pharmacy vaccination from a seasonal flu side-line into a year-round revenue stream (~$13–$20 administration fee per dose under the Universal Influenza Immunization Program and the pharmacist injecting-agent framework), and an independent-pharmacy owner using this CDST today has no in-tool path to capture, document, or inventory it.

**The goal of this feature** is to add a **second, parallel clinical workflow** to the app — a vaccination administration flow — that is distinct from the minor-ailments assessment but shares the same compliance foundation. It comprises: (a) a **versioned vaccine catalog** (the "data source" analog to `ailments.json`, placed in a TS module under `src/lib/` per the governance/precedent established by #3's `statements.ts` and #4's `reasons.ts`); (b) a **contraindication triage screen** (the "red flags" analog — a structured pharmacist-worked checklist, *not* automated allergy/interaction logic, which remains PMS-owned per roadmap §3); (c) **vaccination-specific informed consent** captured via #3's `ConsentPanel` mechanism, extended with a `consent_type` discriminator and vaccination statement set; (d) **administration documentation** — lot number, expiry, manufacturer, dose number, route, anatomical site, dose volume — captured at the point of administration and rendered onto a dedicated **Vaccination Administration Record (VAR) PDF** via the existing client-side `@react-pdf/renderer` pipeline; (e) **persistence** of the administration record to roadmap #2's fly.io PHI store as a sibling `vaccination` table (sharing #2's `patient` identity index and `phi_audit_log`, *not* overloaded into the ailment-shaped `assessment` table); and (f) **minimal lot-level inventory tracking** as a non-PHI per-pharmacy ledger on Supabase, decremented on administration and gating the flow when stock is zero.

**Out of scope** (per roadmap §3 and §6): drug-allergy / drug-interaction / pregnancy safety *automation* (PMS-owned — the triage screen is a pharmacist-worked checklist, exactly as `step-redflags.tsx:56-82` is a checklist today, *not* an automated exclusion engine); **billing / claims submission** (the Universal Influenza Immunization Program claim, OHIP billing, and UHIP reconciliation are PMS-owned, exactly as Rx billing is out of scope per roadmap §3); **automated public-health reporting** — the pharmacist-administered vaccine must be reported to the provincial immunization system (COVaxON for COVID-19/influenza under the Universal Influenza program; the Ontario Immunization Record / ICON for others), but automated API submission is LATER (the VAR PDF this feature produces is the report source artefact); **appointment scheduling** for vaccines (roadmap #16 LATER); **cold-chain / temperature-excursion monitoring** (LATER); **dose-series recall / second-dose reminder SMS** (LATER; the #10 PROM pipeline is the analog and will key off the captured `dose_number`/`series_total`); **wastage / returns / ordering workflows** (the inventory ledger records `doses_wasted` but full inventory management is LATER). As with every NOW-tier feature that touches PHI, fly.io is not yet provisioned and the BAA is not yet signed (roadmap §7 #1/#2), so #22 ships dark behind #2's `PHI_PERSIST_ENABLED` flag for its PHI writes — the VAR PDF is itself the durable legal artefact in Phase 1 — while the non-PHI inventory ledger ships live in Phase 1 (it carries no PHI and needs no BAA).

---

## 2. Current State (what exists in code)

### 2.1 One clinical workflow, one data source, one entry surface

The dashboard (`src/app/page.tsx:8`) authenticates the pharmacist, loads the pharmacy + memberships (`page.tsx:9-38`), and renders exactly one clinical surface: `<AilmentGrid/>` (`page.tsx:60`). `<AilmentGrid>` (`src/components/ailment-grid.tsx:6`) maps over `ailments` (`src/lib/ailments.ts:4`, imported from `data/ailments.json`) and renders one `<AilmentCard>` per ailment, each a `<Link href={`/assess/${ailment.slug}`}>` (`src/components/ailment-card.tsx:23`). The `AILMENT_ICONS` map (`ailment-card.tsx:11-18`) hardcodes the 19 minor-ailment slugs. There is **no second surface, no vaccination card, no `/vaccinate` route, and no vaccine catalog.**

### 2.2 The wizard is ailment-shaped and cannot represent a vaccination

`WizardContainer` (`wizard-container.tsx:40`) drives a 4-step state machine (`step` 0→3) whose every gate (`canNext`, `wizard-container.tsx:52-59`) and every terminal branch (`wizard-container.tsx:142-183`) assumes an `Ailment` prop (`wizard-container.tsx:35-38`) with `rxOptions`, `redFlags`, and `nonRx`. `AssessmentData` (`types/index.ts:59-67`) carries `ailment: Ailment`, `selectedRx: SelectedRx | null`, `hasRedFlag`, and nothing vaccine-relevant. The terminal outcomes are `prescribed` (the `<StepGenerate>` branch rendering `<CombinedPdf>`, `wizard-container.tsx:173-183`) and `referred` (the red-flag branch, `wizard-container.tsx:142-172`). A vaccination has no `rxOptions` to select, no `ailment.slug`, a different consent basis (informed consent to the *vaccine*, not to a minor-ailments assessment under O. Reg. 256/24), and a different documentation artefact (a lot/expiry/site/route record, not a prescription). Forcing a vaccination into `WizardContainer` would corrupt the minor-ailments semantics (a vaccination is not a prescribe-or-refer decision) and overload the `assessment` table's `outcome` CHECK (`persist-assessments-flyio-design.md` §4.3: `('prescribed','referred','abandoned')`, widened to `'not_prescribed'` by #4) with a value that does not belong to a minor-ailments encounter. #22 therefore introduces a **parallel `VaccinationWizard`** rather than extending the existing one.

### 2.3 The PDF, persistence, consent, and identity primitives #22 reuses

Although the *workflow* is new, every *primitive* #22 needs already exists or is specified by a sibling NOW feature:

- **Client-side PDF** — `downloadPdf(doc, filename)` (`src/lib/pdf-helpers.ts`) wraps `pdf(document).toBlob()`; `<CombinedPdf>` (`src/components/combined-pdf.tsx`) and `<ReferralPdf>` are `@react-pdf/renderer` `<Document>` components with a shared teal style block (`combined-pdf.tsx:13-157`). A new `<VaccinationRecordPdf>` follows the identical render path — no server round-trip, no new transport. `@react-pdf/renderer` is already a dependency.
- **Identity + scoping** — `requireAuth()` (`src/lib/auth-guards.ts:44`) returns `{ id, pharmacyId, ... }` — the actor + per-pharmacy scoping pair every PHI row needs.
- **Patient identity index (#2)** — roadmap #2's `patient` table (`persist-assessments-flyio-design.md` §4.3) with `identity_hash` from `src/lib/phi/identity.ts` and the `resolvePatientId({ pharmacyId, identity })` helper #3's learnings recommended #2 expose (`refusal-non-prescribe-docs-design.md` Iteration 4 learnings: *"#2's plan should expose a resolvePatientId helper rather than have each sibling duplicate the identity_hash upsert"*). A vaccination is another encounter for the **same** patient, so #22 resolves to the same `patient.id` — this is what lets a future longitudinal view and the #10 follow-up pipeline join across an assessment and a vaccination for one person.
- **Consent (#3)** — roadmap #3's `ConsentCapture` type (`digital-consent-capture-design.md` §4.1), `ConsentPanel` (`§4.4`), `consent` fly.io table (`§4.5`), and `saveConsentAction` server action. The panel already handles signature-pad capture, SDM/signer-relationship, verbal-attested fallback, and the three-part statement model. #22 extends it with a vaccination variant rather than re-implementing consent.
- **PHI audit + flag-guarded stub pattern** — #2's `phi_audit_log` (`§4.4`) and the `PHI_PERSIST_ENABLED`-guarded no-op server action (`§4.7`) that lets UI ship in Phase 1 while fly.io is dark, established by #1/#2/#3/#4 and reused verbatim by #22.
- **Non-PHI Supabase audit** — `EventType` union (`src/lib/audit-actions.ts:5-18`) + the `audit.log_event` SECURITY DEFINER validator (`2026-06-06-audit-log-design.md` "Write Path"). #22 adds one event, `vaccination.administered`, with the same strict non-PHI metadata discipline #2 applies to `assessment.saved`.

### 2.4 No inventory, no lot, no public-health reporting code

A `rg` for `inventory|lot_number|dose_on_hand|COVaxON|ICON|cold.?chain` across `src/` returns nothing. The Supabase schema in use (`profiles`, `pharmacies`, `pharmacy_members`, `invitations`, `prescription_tx`, `audit.log`) has no vaccine-stock table. Inventory tracking, lot recall, and public-health submission are greenfield.

### 2.5 The hard ops gate is unchanged

fly.io Postgres is **not provisioned** and the **BAA is not signed** (roadmap §7 open questions #1, #2). Every PHI write in #22 (the `vaccination` row, the `consent` row, the `phi_audit_log` entry) rides #2's `PHI_PERSIST_ENABLED` flag and is a no-op stub until the gate clears — identical to #1, #2, #3, #4. The one exception is the **inventory ledger**, which is non-PHI (pharmacy stock, not patient data) and therefore Supabase-resident; it can and does ship live in Phase 1 with no BAA dependency.

---

## 3. Approach (options + recommendation)

The design hinges on six decisions: (a) parallel workflow vs. overloading the existing wizard; (b) catalog location (`data/` vs. `src/lib/`); (c) the data model for the vaccination encounter (sibling table vs. `assessment` outcome); (d) where inventory lives (fly.io PHI vs. Supabase non-PHI); (e) how vaccination consent relates to #3's consent; (f) how contraindication triage relates to the PMS-owned safety-check boundary. Options are evaluated against roadmap §6.2 (PHI on fly.io, Supabase = auth + non-PHI), §6.4 (the partitioning rule), §3 (the PMS boundary: allergy/interaction/pregnancy checks and billing are OUT), and §4 (counter-speed wedge).

### Option A — Parallel `VaccinationWizard` + `/vaccinate` route, catalog in `src/lib/`, sibling `vaccination` table on fly.io, inventory on Supabase, vaccination-variant consent via #3's mechanism, triage as a pharmacist checklist (RECOMMENDED)

A new route `/vaccinate/[vaccine]/page.tsx` (parallel to `/assess/[ailment]/page.tsx:9`) renders a new `VaccinationWizard` component (parallel to `WizardContainer`). The wizard is a 4-step machine: **Patient → Contraindication triage → Administration details → Consent + Generate VAR PDF**. The vaccine catalog lives in `src/lib/vaccines/catalog.ts` (versioned + hashed, mirroring #3's `statements.ts` / #4's `reasons.ts`). The administration record persists to a new sibling `vaccination` table on fly.io (PHI) that shares #2's `patient` table via `resolvePatientId` and writes to #2's `phi_audit_log`; it is **not** modelled as an `assessment.outcome` value. Lot-level inventory is a non-PHI `vaccine_inventory` table on Supabase (RLS by `pharmacy_id`), read at step 2 to populate the lot selector and decremented on administration. Consent is captured via #3's `ConsentPanel`, extended with a `consent_type` discriminator on #3's `consent` table (`'minor_ailments' | 'vaccination'`) and a vaccination-specific statement set. Contraindication triage is a structured checklist from the catalog (e.g., "Severe allergic reaction to a previous dose or component") that the pharmacist works through — checking any routes to a Withhold/Refer branch, exactly as red flags route to referral (`wizard-container.tsx:142-172`); it performs **no** automated allergy/interaction logic (PMS-owned).

- **Pros:** Faithful to the roadmap's framing of vaccination as a distinct workflow that "opens vax revenue" — it does not contaminate the minor-ailments wizard, the ailment catalog, or the `assessment` outcome enum. The sibling `vaccination` table reuses #2's `patient` index (so one patient's assessments and vaccinations join) and #2's `phi_audit_log`, inheriting every PHIPA control #2/#3 established at zero additional governance cost. The Supabase placement of inventory is the *correct* partitioning per §6.4 (stock describes the pharmacy, not a patient) and lets inventory ship live in Phase 1 independent of the fly.io gate. Reusing #3's `ConsentPanel` mechanism (signature pad, SDM, verbal fallback) avoids a second consent implementation and keeps the consent table unified. The checklist-style triage respects the PMS boundary (no automated safety logic) while mirroring the proven `step-redflags.tsx` UX pharmacists already know. Sibling-friendly: #10 PROM follow-up keys off `vaccination.dose_number`/`series_total` for second-dose reminders; #13 analytics roll up administrations per vaccine; #16 appointments can later link to the vaccine catalog; #26 governance versions the catalog via the same `protocol_version`/hash pattern.
- **Cons:** Adds a second wizard + route + catalog + table + PDF, growing the app surface meaningfully (the largest NOW feature after the persistence foundation). The vaccine catalog and the contraindication/contraindication text are clinical content requiring pharmacist/legal review (mitigated by the `src/lib/` + versioned-hash discipline, identical to #3/#4). Inventory on Supabase while administration is on fly.io means the lot number is the cross-store join key (acceptable — a lot number is a manufacturer code, non-PHI on its own). Decrement-on-administer spans two stores (Supabase decrement + fly.io insert) and is not cross-store transactional; mitigated by ordering (persist the fly.io administration row first, then decrement Supabase inventory; a failed decrement leaves the count momentarily high but is reconcilable from the append-only `vaccination` ledger — documented edge case §6).

### Option B — Model vaccination as a new `assessment.outcome='vaccinated'` and reuse `WizardContainer`

Reuse the existing wizard and `assessment` table, adding `'vaccinated'` to the `outcome` CHECK and vaccine-specific JSONB on the `assessment` row.

- **Pros:** Smallest number of new tables/routes.
- **Cons:** Directly corrupts minor-ailments semantics. `assessment` is `ailment_slug NOT NULL` (`persist-assessments-flyio-design.md` §4.3) and `has_red_flag NOT NULL DEFAULT false`; a vaccination has neither an ailment slug nor a red-flag outcome. The `outcome` enum would carry `vaccinated` alongside `prescribed`/`referred`/`not_prescribed`/`abandoned`, polluting every analytics query and every `canNext` branch that assumes "no outcome other than prescribe/refer." The wizard's `step-rx.tsx` (Rx selection) and `step-generate.tsx` (prescription PDF) have no vaccination meaning. `CombinedPdf` is a prescription document; reusing it for a vaccination produces a titled-"PRESCRIPTION" artefact for a non-prescription — the exact inspector-confusing failure #4's design rejected (`refusal-non-prescribe-docs-design.md` §3 Option B). This is a forced fit that violates the data model's intent.
- **Rejected.**

### Option C — Inventory on fly.io alongside the PHI administration record

Keep the inventory ledger on fly.io so the decrement and the administration insert are in one transaction.

- **Pros:** Cross-store atomicity; one database for "everything about a vaccination."
- **Cons:** Violates roadmap §6.4 (the partitioning rule): inventory is pharmacy stock, not patient data — it describes the pharmacy, so it belongs on Supabase per the explicit "If it describes the pharmacy… it stays in Supabase" rule. It also gates a non-PHI, revenue-relevant feature (knowing your stock without logging a patient encounter) behind the BAA hard gate, which is operationally senseless — an owner should be able to check flu stock in Phase 1 before fly.io exists. Placing PHI-adjacent non-PHI data on the PHI store also enlarges the PHI blast radius for no benefit.
- **Rejected** for the ledger; the fly.io `vaccination` row *references* the lot number (PHI in context) but the stock *count* lives on Supabase.

### Recommendation

**Option A.** It is the faithful implementation of the roadmap (a distinct vaccination workflow that opens revenue without contaminating the minor-ailments tool), it makes the *correct* data-partitioning decision for inventory (Supabase, shipping in Phase 1), it maximally reuses the #2/#3 compliance foundation (patient index, consent mechanism, phi_audit_log, flag-guarded stub), and the sibling `vaccination` table + parallel wizard keep the two clinical domains cleanly separable for every downstream feature.

---

## 4. Components & Data Model

### 4.1 Vaccine catalog (`src/lib/vaccines/catalog.ts`, new)

The "data source" analog to `data/ailments.json`. Per the precedent established by #3's `statements.ts` and #4's `reasons.ts` (and the gnhf constraint forbidding edits to `data/`), governance/clinical content that needs a reproducible content hash lives in a versioned TS module under `src/lib/`, not in `data/ailments.json`'s sibling. The catalog is extensible to the six new July-2026 Ontario vaccines (exact product list confirmed under Open Questions §7.3).

```ts
export const VACCINE_CATALOG_VERSION = "vaccines-v1"

export type AdministrationRoute = "IM" | "SC" | "ID" | "intranasal" | "oral"
export type AdministrationSite =
  | "left_deltoid" | "right_deltoid"
  | "left_vastus_lateralis" | "right_vastus_lateralis"   // pediatric
  | "left_arm" | "right_arm"                              // ID (e.g. BCG)
  | "nasal" | "oral" | "other"

export interface Contraindication {
  id: string
  label: string                  // the checklist item text
  guidance: string | null        // one-line pharmacist guidance when checked
  severity: "withhold" | "caution"  // withhold = do not administer; caution = clinical judgment
}

export interface VaccineProduct {
  vaccineId: string              // stable slug, e.g. "influenza", "covid19-mrna", "shingles-rzv", "tdap"
  name: string                   // display name
  defaultRoute: AdministrationRoute
  defaultSite: AdministrationSite
  doseVolume: string             // e.g. "0.5 mL"
  seriesTotal: number            // doses in the series: 1 (influenza), 2 (Shingrix), 3 (HPV primary)
  fundedOntario: boolean         // publicly funded (UIA / pharmacist injecting-agent)
  reportable: boolean            // must report to COVaxON / ICON
  manufacturerExamples: string[] // hints for the lot-entry free text
  contraindications: Contraindication[]   // the triage checklist (step 1)
  patientEducation: string[]     // post-vaccination advice rendered onto the VAR
}

export const VACCINES: VaccineProduct[] = [
  // influenza, covid19, pneumococcal, shingles (RZV), herpes zoster live,
  // tdap, hepatitis B, HPV, meningococcal, RSV, + the six July-2026 additions
  // (exact Ontario-authorized product list pending clinical/legal confirm — §7.3)
]

export function computeCatalogHash(vaccines: VaccineProduct[]): string {
  // sha256 over stable (vaccineId, name, contraindication ids, seriesTotal) tuples — pins
  // the exact catalog in effect, feeding protocol_version on the persisted row and #26 governance.
}
```

`protocol_version` (the catalog hash) is persisted on every `vaccination` row (§4.4) so a later catalog edit cannot retroactively change what a past administration meant — matching #2's `protocol_version` column and #3's `statement_hash`.

### 4.2 Vaccination wizard state + types

New types in `src/types/index.ts` (after `AssessmentData` at `types/index.ts:59-67`):

```ts
export interface VaccinationAdministration {
  vaccine: VaccineProduct
  lotNumber: string
  expiryDate: string            // ISO date
  manufacturer: string
  doseNumber: number            // 1-based within the series
  route: AdministrationRoute
  site: AdministrationSite
  doseVolume: string
  administrationNotes: string
}

export type VaccinationOutcome = "administered" | "withheld" | "referred"

// Structured reason when a vaccine is withheld or referred (mirrors #4 NonPrescribeReason).
export type WithholdReason =
  | "contraindication_present"
  | "patient_declined"
  | "acute_illness_today"
  | "pregnancy_live_vaccine"
  | "out_of_stock"
  | "referred_to_physician"
  | "other"
```

`VaccinationWizard` state (parallel to `WizardContainer`'s block at `wizard-container.tsx:40-48`):

```ts
const [step, setStep] = useState(0)
const [patient, setPatient] = useState<PatientInfo>(defaultPatient)
const [contraindicationsChecked, setContraindicationsChecked] = useState<string[]>([])
const [admin, setAdmin] = useState<VaccinationAdministration | null>(null)
const [selectedLotId, setSelectedLotId] = useState<string | null>(null)  // from inventory
const [withholdReason, setWithholdReason] = useState<WithholdReason | null>(null)
const [consent, setConsent] = useState<ConsentCapture | null>(null)      // from #3
const [vaccinationId] = useState(() => crypto.randomUUID())              // per-mount, mirrors #2
```

### 4.3 The wizard steps (`src/components/vaccination/vaccination-wizard.tsx`, new)

A `"use client"` component, structurally parallel to `WizardContainer` but with four vaccination-specific steps. The `canNext` gate mirrors `wizard-container.tsx:52-59`:

```ts
const hasContraindication = contraindicationsChecked.length > 0
const canNext =
  step === 0 ? !!(patient.name && patient.dob)
  : step === 1 ? true   // triage always advances; the outcome branch is decided at step 2/3
  : step === 2 ? (hasContraindication ? withholdReason !== null : admin !== null)
  : true
```

**Step 0 — Patient.** Reuses the slimmed `PatientInfo` capture (per #5 the type is 12 fields). A vaccination encounter requires `encounterType === "In-Person"` (a vaccine cannot be administered virtually); if the pharmacist selects Virtual/Phone, the wizard shows a blocking notice and offers to convert to In-Person or exit (§6 edge case). `sex` is retained (it informs live-vaccine/pregnancy caution text the pharmacist sees, though the *gating* itself is PMS-owned).

**Step 1 — Contraindication triage.** Renders the selected vaccine's `contraindications` as a checkbox list (reusing the card/checkbox styling from `step-redflags.tsx:56-82`). This is the roadmap's "triage." Checking any `severity: "withhold"` item sets `hasContraindication = true`, which routes step 2 to the Withhold/Refer branch instead of the Administration branch — the structural analog of red flags routing to referral (`wizard-container.tsx:142-172`). A `severity: "caution"` item surfaces guidance text but does not force the withhold branch (clinical-judgment gate). The screen performs **no** automated allergy/interaction/pregnancy lookup — that is PMS-owned (roadmap §3); the pharmacist confirms against the patient's record in the PMS before proceeding.

**Step 2 — Administration details (or Withhold/Refer).**
- *If no withhold contraindication:* an administration form. A **lot selector** populated from the non-PHI `vaccine_inventory` (Supabase) via a new `getVaccineInventory(vaccineId)` server query (RLS-scoped to `pharmacy_id`); selecting a lot autofills `lotNumber`, `expiryDate`, `manufacturer`, and validates `doses_on_hand > 0` (an out-of-stock lot is disabled with a "no stock" badge — the inventory gate). The pharmacist confirms `doseNumber` (defaults to `seriesTotal > 1` ? a selector : `1`), `route` (defaults to `vaccine.defaultRoute`), `site` (defaults to `vaccine.defaultSite`), `doseVolume` (defaults to `vaccine.doseVolume`), and optional notes. If the pharmacy has **no** inventory rows for this vaccine at all, a free-entry fallback lets the pharmacist type a lot/expiry manually (so the flow is not hard-blocked on inventory being populated — documented edge case §6), but the decrement step is then skipped.
- *If a withhold contraindication is present:* a `<WithholdPanel>` renders a `WithholdReason` radio list (sourced from a small `src/lib/vaccines/withhold-reasons.ts` module, mirroring #4's `reasons.ts`), defaulting to `contraindication_present`, plus an optional note. The terminal outcome is `withheld` or `referred` (if `referred_to_physician`), producing a short Withhold/Refer document (§4.7).

**Step 3 — Consent + Generate.** Renders #3's `<ConsentPanel>` configured with the **vaccination** statement set (§4.5) above a "Download Vaccination Administration Record PDF" button. The gate mirrors #3/#4: the Download button is `disabled` unless `consent !== null` (both required consents checked, signature/attestation captured) **and** the upstream administration/withhold decision is complete. On click, the wizard calls (in order, fail-closed) `saveConsentAction` (from #3, extended) → `saveVaccinationAction` (new) → `downloadPdf(<VaccinationRecordPdf/>)`.

### 4.4 Persistence: sibling `vaccination` table (fly.io, PHI under BAA)

#22 adds a new table to #2's fly.io schema. It **reuses** #2's `patient` table (via `resolvePatientId`) and `phi_audit_log`; it does **not** touch the ailment-shaped `assessment` table.

```sql
-- vaccination: one administered (or withheld) vaccine encounter (PHI). Sibling to #2's assessment.
CREATE TABLE vaccination (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- vaccination_id; cross-feature key
  pharmacy_id         uuid NOT NULL,
  pharmacist_id       uuid NOT NULL,            -- administering/capturing pharmacist (actor)
  patient_id          uuid NOT NULL REFERENCES patient(id),
  vaccine_id          text NOT NULL,            -- references catalog vaccineId (queryable)
  vaccine_name        text NOT NULL,            -- denormalised at capture (legal truth)
  outcome             text NOT NULL CHECK (outcome IN ('administered','withheld','referred')),
  dose_number         integer,                  -- NULL when withheld; 1-based when administered
  series_total        integer,                  -- from catalog at capture (for #10 dose-2 follow-up)
  lot_number          text,                     -- PHI in context (recall key); NULL when withheld
  expiry_date         date,                     -- PHI in context
  manufacturer        text,
  route               text CHECK (route IS NULL OR route IN ('IM','SC','ID','intranasal','oral')),
  site                text CHECK (site IS NULL OR site IN
                      ('left_deltoid','right_deltoid','left_vastus_lateralis','right_vastus_lateralis',
                       'left_arm','right_arm','nasal','oral','other')),
  dose_volume         text,                     -- e.g. '0.5 mL'
  withhold_reason     text CHECK (withhold_reason IS NULL OR withhold_reason IN
                      ('contraindication_present','patient_declined','acute_illness_today',
                       'pregnancy_live_vaccine','out_of_stock','referred_to_physician','other')),
  contraindications_checked jsonb NOT NULL DEFAULT '[]'::jsonb,  -- the triage screen state
  administration_notes text,                    -- PHI free text
  consent_id          uuid,                     -- FK to #3's consent table (vaccination variant)
  patient_snapshot    jsonb NOT NULL,           -- immutable PatientInfo at capture
  pharmacy_snapshot   jsonb NOT NULL,           -- immutable PharmacyDefaults at capture
  protocol_version    text,                     -- catalog hash (#26 governance)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vaccination_pharmacy_created ON vaccination (pharmacy_id, created_at DESC);
CREATE INDEX vaccination_patient ON vaccination (patient_id, created_at DESC);
CREATE INDEX vaccination_lot ON vaccination (pharmacy_id, lot_number);  -- lot-recall queries
CREATE INDEX vaccination_vaccine ON vaccination (pharmacy_id, vaccine_id);
```

> **Why a sibling table, not an `assessment.outcome`:** `assessment` is `ailment_slug NOT NULL` and semantically a minor-ailments prescribe/refer decision (`persist-assessments-flyio-design.md` §4.3). A vaccination has no ailment slug, no prescription, and a different legal basis. A sibling table preserves both domains' integrity and lets #13 analytics and #10 follow-up query each domain without filtering the other. The two join on `patient_id` (via #2's identity index), giving the longitudinal view the roadmap's #28 will eventually need.

**Store module** (`src/lib/phi/vaccination-store.ts`, new) — the **only** module that touches fly.io `vaccination`, mirroring #2's `assessment-store.ts` discipline. Every function derives `{ pharmacistId, pharmacyId }` from `requireAuth()` internally and injects `pharmacy_id` into every query; it never accepts `pharmacyId` from a caller. Functions:

- `saveVaccination(input)` — (1) `resolvePatientId` (upsert on #2's `patient` via `identity_hash`), (2) `INSERT INTO vaccination`, (3) `INSERT INTO phi_audit_log` with `action='vaccination.administered'`. All three in one `pool.connect()` → `BEGIN`/`COMMIT` transaction (inherited discipline from #2 §4.5). Returns `{ vaccinationId }`.
- `listVaccinations({ pharmacyId, patientId?, vaccineId?, lotNumber?, limit, offset })` — always scoped by `pharmacy_id`; writes `vaccination.viewed` to `phi_audit_log`.
- `getVaccinationsByLot({ pharmacyId, lotNumber })` — the **lot-recall** query path; scoped by `pharmacy_id`.

### 4.5 Consent extension (extends #3)

#22 does **not** build a parallel consent system. It extends #3's `consent` table (`digital-consent-capture-design.md` §4.5) with a discriminator and reuses #3's `ConsentPanel` + `saveConsentAction`:

```sql
-- Extend #3's consent table with a consent_type discriminator.
ALTER TABLE consent ADD COLUMN consent_type text NOT NULL DEFAULT 'minor_ailments'
  CHECK (consent_type IN ('minor_ailments','vaccination'));
-- Vaccination-specific informed consent flag (set only when consent_type='vaccination').
ALTER TABLE consent ADD COLUMN consent_to_vaccinate boolean;
```

A vaccination-specific statement set lives in `src/lib/vaccines/consent-statements.ts` (mirroring #3's `src/lib/consent/statements.ts`), versioned as `vaccination-v1`:

```ts
export const VACCINATION_CONSENT_VERSION = "vaccination-v1"
export const VACCINATION_CONSENT_STATEMENTS: ConsentStatement[] = [
  { key: "consent_to_vaccinate", label: "Consent to vaccination", required: true,
    body: "I consent to receive the {{vaccineName}} vaccine, including its risks and benefits as explained to me by the pharmacist, and to the pharmacist administering it." },
  { key: "consent_to_record", label: "Consent to record my health information (PHIPA)", required: true,
    body: "I consent to the pharmacy collecting, using, and retaining my personal health information for the purpose of this vaccination and my immunization record, in accordance with PHIPA." },
  { key: "consent_to_followup", label: "Optional: contact me for follow-up", required: false,
    body: "I agree the pharmacy may contact me to remind me of subsequent doses in this series and to follow up. Optional; refusing will not affect my care." },
]
```

`consent_to_followup` here is the gate #10's follow-up pipeline keys off for second-dose reminders (reads `vaccination.series_total > vaccination.dose_number` + `consent_to_followup`). The `ConsentCapture` type (#3 §4.1) gains an optional `consentType: "minor_ailments" | "vaccination"` and `consentToVaccinate?: boolean`; #3's panel accepts a `statements` prop so the same component renders either set.

### 4.6 Inventory ledger (Supabase, non-PHI, ships in Phase 1)

Per roadmap §6.4 (stock describes the pharmacy → Supabase), and independent of the fly.io/BAA gate:

```sql
-- vaccine_inventory: per-pharmacy lot ledger (NON-PHI). Lives on Supabase; RLS by pharmacy_id.
CREATE TABLE vaccine_inventory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id     uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  vaccine_id      text NOT NULL,          -- catalog vaccineId
  lot_number      text NOT NULL,
  expiry_date     date NOT NULL,
  manufacturer    text,
  doses_received  integer NOT NULL CHECK (doses_received >= 0),
  doses_on_hand   integer NOT NULL CHECK (doses_on_hand >= 0),
  doses_wasted    integer NOT NULL DEFAULT 0 CHECK (doses_wasted >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, lot_number)
);
CREATE INDEX vaccine_inventory_pharmacy_vaccine ON vaccine_inventory (pharmacy_id, vaccine_id);

-- RLS: a pharmacist may read/update only their own pharmacy's inventory.
ALTER TABLE vaccine_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_pharmacy_select ON vaccine_inventory
  FOR SELECT USING (pharmacy_id IN ( SELECT members.pharmacy_id FROM pharmacy_members members
                                      JOIN auth.users u ON u.id = members.user_id
                                      WHERE u.id = auth.uid() AND members.is_active ));
CREATE POLICY inventory_pharmacy_update ON vaccine_inventory
  FOR UPDATE USING (pharmacy_id IN ( SELECT members.pharmacy_id FROM pharmacy_members members
                                      JOIN auth.users u ON u.id = members.user_id
                                      WHERE u.id = auth.uid() AND members.is_active ));

-- Decrement RPC (defence-in-depth: never drops below 0; atomic).
CREATE OR REPLACE FUNCTION decrement_vaccine_inventory(p_lot_uuid uuid, p_pharmacy_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_remaining integer;
BEGIN
  UPDATE vaccine_inventory
    SET doses_on_hand = doses_on_hand - 1, updated_at = now()
    WHERE id = p_lot_uuid AND pharmacy_id = p_pharmacy_id AND doses_on_hand > 0
    RETURNING doses_on_hand INTO v_remaining;
  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'Lot not found, not owned by pharmacy, or out of stock';
  END IF;
  RETURN v_remaining;
END; $$;
```

A new server query module `src/lib/vaccine-inventory.ts` (`"use server"`) exposes `getVaccineInventory(vaccineId)`, `addInventoryLot(input)`, and `decrementInventory(lotId)` (which calls the `decrement_vaccine_inventory` RPC). The inventory list is read at step 2 to populate the lot selector; `decrementInventory` is called **after** the fly.io `saveVaccination` succeeds (ordering rationale §6).

### 4.7 The Vaccination Administration Record PDF (`src/components/vaccination/vaccination-record-pdf.tsx`, new)

A client-side `@react-pdf/renderer` `<Document>` (same pipeline as `<CombinedPdf>` at `combined-pdf.tsx:185`). Reuses the established teal style block (copy `StyleSheet.create({...})` from `combined-pdf.tsx:21-157`). Layout:

- **Header:** `<Text style={styles.title}>VACCINATION ADMINISTRATION RECORD</Text>` (teal) + subtitle `{vaccine.name} — Pharmacist Injecting Agent` + CONFIDENTIAL badge + date.
- **Pharmacy block:** identical to `combined-pdf.tsx:204-214`.
- **Two columns:** Patient (left) | Administration (right): vaccine, dose `doseNumber of seriesTotal`, lot, expiry, manufacturer, route, site, dose volume, administering pharmacist.
- **"Contraindications screened" section:** the checked items or "None identified" (reusing the field-row style).
- **"Patient Education Provided" section:** the vaccine's `patientEducation` items in the green block (reusing `greenBlock`/`checkItem` from `combined-pdf.tsx:115-120`).
- **Follow-up:** "Next dose due" computed when `doseNumber < seriesTotal` (text from the catalog), else "Series complete."
- **Signatures:** the two-column block from #3 — patient/SDM side carries the captured signature image (`<Image src={consentSignatureDataUrl} />`); pharmacist side a blank line (`pharmacy?.pharmacistName`).
- **PHIPA footer:** *"CONFIDENTIAL — Privileged health information under PHIPA. Vaccine administered by a pharmacist under the Ontario pharmacist injecting-agent authority. Report this administration to COVaxON / your local public health unit."* + #3's consent attestation line (statement version `vaccination-v1`, signer, method, timestamp).

> The **Withhold/Refer** sub-case (outcome `withheld`/`referred`) renders a lighter variant — title "VACCINATION NOT ADMINISTERED — RECORD", the withhold reason + notes, and the same consent attestation. It reuses the same component with an `outcome` prop, or a small `<VaccinationWithholdPdf>`; the design recommends one component branching on `outcome` (YAGNI — one document family).

### 4.8 Server action + client wiring

- `src/lib/vaccination-actions.ts` (new, `"use server"`) — `saveVaccinationAction(payload)`:
  1. `requireAuth()` → `{ id: pharmacistId, pharmacyId }`. Bail `{ vaccinationId: null }` when `!pharmacyId`.
  2. **Guard:** `if (process.env.PHI_PERSIST_ENABLED !== "true")` → return `{ vaccinationId: null }` (no-op stub; the wizard ships dark, identical pattern to #1/#2/#3/#4).
  3. Build the persistence input (compute `identity_hash` via #2's `identity.ts`; assemble `patient_snapshot`/`pharmacy_snapshot`/JSONB; resolve `protocol_version` = `computeCatalogHash(VACCINES)`), call `saveVaccination(…)`.
  4. Emit the non-PHI Supabase `vaccination.administered` event with metadata **strictly** `{ vaccination_id }` — no `vaccine_id`, no `lot_number`, no patient data (§5.1).
  5. Return `{ vaccinationId }`.

- **Generate wiring** (`vaccination-wizard.tsx`, step 3 click handler):
  ```ts
  async function handleGenerate() {
    if (!consent) return
    try {
      // 1. Consent (authorises the vaccination + retention) — extends #3's saveConsentAction.
      const consentRes = await saveConsentAction({ consent, patientIdentity: { name: patient.name, dob: patient.dob, postalCode: patient.postalCode }, consentType: "vaccination", vaccinationId })
      // 2. Administration/withhold record — fail-closed persistence.
      await saveVaccinationAction({ /* patient, vaccine, admin|withhold, consentId, protocol_version, … */ })
      // 3. Inventory decrement (non-PHI; only when a real lot was selected and outcome=administered).
      if (selectedLotId && admin && outcome === "administered") {
        try { await decrementInventory(selectedLotId) } catch (e) { /* logged; reconcilable from ledger — §6 */ }
      }
      // 4. Document (only after persistence succeeds).
      await downloadPdf(<VaccinationRecordPdf … />, `vaccination-${vaccine.vaccineId}-${dateOfAssessment}.pdf`)
    } catch (err) { console.error("Vaccination record failed:", err) }
  }
  ```
  `vaccinationId` is the per-mount client UUID (mirrors #2's `assessmentId` lifecycle). During Phase 1, `saveConsentAction` + `saveVaccinationAction` are no-op stubs returning null; the decrement (Supabase) is live; the VAR downloads.

### 4.9 Dashboard entry + routes

- **Dashboard** (`src/app/page.tsx`): add a `<VaccinationEntry/>` card/section alongside `<AilmentGrid/>` (`page.tsx:60`), so vaccination is a first-class surface. The card links to `/vaccinate`.
- **Picker route** `src/app/vaccinate/page.tsx` (new): lists `VACCINES` as cards (reusing `ailment-card.tsx` styling), each linking to `/vaccinate/[vaccineId]`.
- **Wizard route** `src/app/vaccinate/[vaccine]/page.tsx` (new): parallel to `/assess/[ailment]/page.tsx:9` — `requireAuth()`, resolve the vaccine by slug from the catalog, load pharmacy defaults (`/assess/[ailment]/page.tsx:24-43` is the template), render `<VaccinationWizard vaccine={vaccine} pharmacy={pharmacyDefaults} />`.

---

## 5. Security / PHIPA-PIPEDA Posture

This feature places a new class of PHI at rest (the administered-vaccine record) and a new non-PHI store (inventory). It inherits every control #2 establishes (#2 §5) and every consent control #3 establishes (#3 §5), and adds vaccination-specific notes.

### 5.1 PHI partitioning

| Data element | Classification | Store |
|---|---|---|
| Patient identity (name, DOB, sex, phone, address) | PHI | **fly.io** `patient` + `vaccination.patient_snapshot`. Never Supabase. Reuses #2's `patient` row. |
| `vaccine_id` / `vaccine_name` (which vaccine a specific patient received) | PHI (clinical — reveals the patient's immunization state) | **fly.io** `vaccination.*`. **Never Supabase.** Mirrors #2's stance that `ailment_slug` stays off Supabase (`persist-assessments-flyio-design.md` §5.1). |
| `lot_number`, `expiry_date`, `manufacturer` on an administration row | PHI in context (tied to a patient; recall key) | **fly.io** `vaccination.*`. Never Supabase. |
| `route`, `site`, `dose_volume`, `dose_number`, `contraindications_checked`, `administration_notes` | PHI (clinical) | **fly.io** `vaccination.*`. Never Supabase. |
| Vaccination consent (`signature_png`, `signer_name`, `consent_to_vaccinate`) | PHI | **fly.io** `consent` (extended from #3). Never Supabase. |
| `vaccination_id` (UUID) | Non-identifying | Allowed on **both** stores — the correlation key. Appears in Supabase `vaccination.administered` metadata. |
| `outcome` (`administered`/`withheld`/`referred`) | Non-identifying on its own | Allowed on **both** stores (mirrors #2's `outcome`). |
| `protocol_version` (catalog hash) | Non-identifying (describes the catalog) | Allowed on **both** stores. |
| `vaccine_inventory.*` (lot, expiry, doses_on_hand, doses_received, manufacturer) | **Non-PHI** — describes pharmacy stock, not a patient | **Supabase.** A lot number alone is a manufacturer code, not patient data; it is PHI *only* when joined to a patient via the fly.io `vaccination` row. RLS by `pharmacy_id`. |
| The `<VaccinationRecordPdf>` bytes | PHI in transit to the printer | Rendered/downloaded client-side via `pdf(document).toBlob()`; never cross the wire to Supabase. e-fax would route via #1's `fax_delivery` (fly.io) — out of scope for #22 but the partitioning is established. |

**Rule of thumb (roadmap §6.4):** the administration record, the consent, and the lot-when-tied-to-a-patient could describe a patient's clinical state → fly.io. The stock *count* describes the pharmacy → Supabase.

### 5.2 Regulatory mapping

- **PHIPA s.12 / s.10.1:** retaining the immunization record and logging every PHI access satisfies custodian accountability; #2's `phi_audit_log` hash chain (inherited) provides tamper-evidence. Retention inherits #2's ~10-year Ontario pharmacy retention.
- **HCCA + informed consent:** vaccination consent is a distinct legal basis from minor-ailments consent — it is informed consent to the *vaccine* (risks, benefits, alternatives) plus PHIPA record consent. Captured via #3's mechanism with the vaccination statement set; SDM capture under the HCCA hierarchy is inherited from #3 verbatim.
- **Pharmacist injecting-agent authority / Ontario public-health reporting:** pharmacists administer vaccines under the Ontario designated-act authority and **must report** each administration to the provincial immunization system (COVaxON for COVID-19/influenza; local public health / ICON for others). #22 produces the VAR PDF that is the report source and persists the reportable record; **automated** API submission to COVaxON/ICON is LATER (out of scope, like billing). The VAR footer explicitly reminds the pharmacist to report.
- **PIPEDA Principle 4.5 (limiting use):** the vaccination record is collected for the purpose of the immunization record, continuity of care, lot recall, and mandatory public-health reporting — not secondary marketing. Analytics over `vaccine_id` (#13) go through aggregate fly.io rollups, not direct PHI reads, and never carry `vaccine_id` to Supabase.
- **Data residency:** inherits #2's Canadian-region fly.io requirement (`yyz`/`yul`); vaccination PHI does not leave Canada. The Supabase inventory ledger is non-PHI and unaffected.

### 5.3 Application security

- **Authorization is app-layer, not RLS — identical to #2 §5.3.** All fly.io `vaccination` access funnels through `src/lib/phi/vaccination-store.ts`, which injects `pharmacy_id` from the verified JWT on every query. The CI grep rule #2 establishes extends naturally: `rg -n "FROM vaccination|INTO vaccination" src/lib/phi` — every match must contain `pharmacy_id`.
- **Supabase inventory uses real RLS** (it is non-PHI and Supabase-owned, so RLS by `pharmacy_id` is the right control here, unlike the fly.io PHI store). The `decrement_vaccine_inventory` RPC is `SECURITY DEFINER` and re-checks `pharmacy_id`, so the decrement cannot be forced across pharmacies.
- **Server-side re-validation:** `saveVaccinationAction` validates the `outcome` enum, the `route`/`site`/`withhold_reason` enums, and that `outcome='administered'` implies a non-empty `lot_number`/`expiry_date`/`doseNumber` (defence-in-depth — the client UI constrains these, but the server never trusts client input for a legal artefact).
- **Fail-closed persistence:** the VAR Download is blocked if `saveVaccinationAction` throws (Phase 2), guaranteeing every produced VAR has a stored record. (Phase-1 stub no-op returns null and proceeds.) The inventory decrement is **not** fail-closed — it is best-effort after the PHI write, because a missed decrement is reconcilable from the append-only fly.io `vaccination` ledger (§6), whereas blocking the document on a Supabase hiccup would wrongly withhold a legal record.
- **Immutability:** inherited from #2 — no `UPDATE`/`DELETE` on `vaccination`. An administration recorded in error is corrected by a future amendment row (#26). Inventory `doses_on_hand` is the exception (it is a mutable counter by design), but every decrement is reconstructable from the `vaccination` ledger + `doses_received` + `doses_wasted`.
- **No new env vars** beyond what #2/#3 introduce (`PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`). **Dependencies:** none new for the core flow — `@react-pdf/renderer` (present), `pg` (from #2), `react-signature-canvas` (from #3). The catalog, statements, and UI reuse `src/components/ui/*` primitives.

---

## 6. Edge Cases

- **fly.io not yet provisioned / BAA unsigned (Phase 1, PHI writes):** `PHI_PERSIST_ENABLED` is off; `saveVaccinationAction` returns `{ vaccinationId: null }` without writing. The triage screen renders, the administration form renders, the VAR PDF downloads, and the printed document (with the lot/expiry/site/route + consent attestation) is itself the durable legal artefact. The flag, schema, and audit branch are ready so flipping the switch lights up persistence with no further code change.
- **Inventory ships live in Phase 1 (non-PHI):** unlike the PHI writes, `vaccine_inventory` lives on Supabase and is not gated by `PHI_PERSIST_ENABLED`. An owner can populate lots, see stock, and have the lot selector + out-of-stock gate working **before** fly.io exists. The decrement-on-administer still runs in Phase 1 (it touches only Supabase); only the fly.io administration-row write is dark.
- **Out-of-stock lot:** step 2 disables any lot with `doses_on_hand = 0` with a "no stock" badge; the pharmacist cannot select it. If **all** lots are out of stock, the administration branch offers a "Record administration with manual lot entry" free-entry fallback (so a vaccine drawn from a non-ledger stock — e.g., a physician-supplied dose — can still be documented), but the decrement is skipped for a manually-entered lot (documented; the inventory stays consistent because no ledger row corresponds).
- **Contraindication present → Withhold/Refer:** checking any `severity: "withhold"` item routes step 2 to the `<WithholdPanel>`; the terminal outcome is `withheld` (or `referred` if `referred_to_physician`), the document is the VAR-withhold variant, and the `vaccination` row records `outcome='withheld'` + `withhold_reason` + the checked contraindications, with `lot_number`/`site`/`route` NULL. No inventory decrement occurs (no dose was drawn). This is the structural analog of #4's `not_prescribed` branch.
- **Lot recall:** public health issues a lot recall → the pharmacist opens a recall view (LATER) or runs `getVaccinationsByLot({ lotNumber })` directly; the store returns every administration of that lot scoped to `pharmacy_id`, each row carrying the patient identity for outreach. The lot-recall index (`vaccination_lot`) makes this a single indexed query.
- **Series dose 2 / multi-dose scheduling:** the catalog's `seriesTotal` + the persisted `dose_number` let #10's follow-up pipeline identify patients due for dose `N+1` (when `dose_number < series_total` and `consent_to_followup`). #22 captures both fields and renders a "next dose due" line on the VAR; the reminder SMS is #10's job (LATER).
- **Virtual/Phone encounter:** a vaccine cannot be administered virtually. If step 0 `encounterType !== "In-Person"`, the wizard shows a blocking notice ("Vaccines can only be administered in person") and offers "Switch to In-Person" or "Exit." Documented; no administration can be recorded against a virtual encounter.
- **Pediatric site / SDM consent:** the `site` enum includes pediatric anatomical sites (`*_vastus_lateralis`); for a minor, #3's SDM capture (`signer_relationship: 'parent'|'guardian'|'sdm'` + the SDM attestation clause) is inherited unchanged, and the vaccination consent is captured from the SDM.
- **Inventory decrement fails (Supabase) after the fly.io write succeeds:** the VAR still downloads (the legal record is produced). The `doses_on_hand` is momentarily too high. Reconciliation: a nightly job (LATER) or a manual recount reconciles `doses_on_hand` from `doses_received - COUNT(vaccination rows for this lot) - doses_wasted`. Documented; not a data-loss risk because the fly.io `vaccination` ledger is the immutable source of truth for "how many were given."
- **Re-administration / re-download idempotency:** the wizard reuses one `vaccinationId` per mount, so a pharmacist who downloads the VAR, goes back, and downloads again produces the same record (Phase 2: the store upserts on `id`). A genuinely *new* dose is a new wizard mount → a new `vaccinationId` → a new row.
- **Patient declines consent (`consent_to_vaccinate`):** the #3 `ConsentPanel` gate stays closed; the Download button is disabled; no vaccine is administered and no record is produced (the pharmacist does not administer a vaccine the patient has not consented to). Documented.
- **Platform admin access:** explicitly **not** granted to `vaccination` rows (mirrors #2 §5.3). Inventory is pharmacy-owned via RLS; a platform admin's analytics (#13) go through aggregate rollups, not direct reads.
- **Catalog change (governance):** `protocol_version` (catalog hash) pinned on each row means a later edit to `VACCINES` cannot retroactively change what a past administration's vaccine/contraindication set meant. Matches #2/#3/#4's versioning; feeds #26.

---

## 7. Open Questions

1. **fly.io provisioning + BAA timing (the hard gate).** Inherited verbatim from #2 §7.1: confirm fly.io Postgres is stood up in a **Canadian region** (`yyz`/`yul`) and the BAA is signed before `PHI_PERSIST_ENABLED` flips true. Vaccination PHI rides the same flag as #2/#3/#4. (Inventory is unaffected — Supabase, non-PHI.)
2. **Catalog location: `src/lib/` vs. `data/`.** The design places the vaccine catalog in `src/lib/vaccines/catalog.ts` (versioned + hashed, deploy-gated), mirroring #3's `statements.ts` / #4's `reasons.ts` and respecting the gnhf constraint forbidding edits to `data/`. Confirm a TS module is acceptable vs. a future editable `data/vaccines.json` + build-time hash (the latter would let clinical staff edit content without a deploy, but breaks the "hash reproducible from the build" guarantee). Recommend the TS module for NOW.
3. **Exact Ontario-authorized vaccine product list (the six July-2026 additions).** The catalog is structured for extensibility, but the concrete `VACCINES` entries — the routine set (influenza, COVID-19, pneumococcal, shingles/RZV, Tdap, hepatitis B, HPV, meningococcal, RSV) **plus the six newly added vaccines** — **must be confirmed against the current Ontario pharmacist injecting-agent schedule and the publicly-funded product list** before launch. This is a clinical/legal content gate, not an engineering one; the `computeCatalogHash` discipline means any post-launch correction is versioned.
4. **Contraindication taxonomy ownership.** The per-vaccine `contraindications` checklist (e.g., "Severe allergic reaction to a previous dose or component," "History of Guillain-Barré within 6 weeks," "Pregnant — live vaccine caution") is clinical content that **must be reviewed by a practising vaccinating pharmacist** (and ideally the pharmacy's clinical lead / public-health guidance) before launch. Where does the reviewed taxonomy live — `src/lib/vaccines/catalog.ts` (code, deploy-gated) or a separate content store? Recommend the TS module (same discipline as #3/#4). Confirm the `severity: withhold | caution` split maps to the pharmacist's actual decision logic.
5. **Inventory decrement atomicity.** The decrement (Supabase) and the administration write (fly.io) cannot share a transaction across stores. The design orders them (fly.io first, decrement best-effort) and reconciles from the append-only ledger. Confirm this is acceptable for NOW vs. requiring a deferred-reconciliation job from day one (LATER #13/#25).
6. **Public-health reporting: manual vs. automated.** #22 produces the VAR PDF and persists the reportable record but does **not** auto-submit to COVaxON/ICON. Confirm manual submission (the pharmacist files the report from the VAR) is acceptable for NOW, or whether automated COVaxON submission must be in the NOW tier (it would be a material scope increase — an authenticated integration with a government API, on par with billing, which roadmap §3 keeps out of scope).
7. **Should withheld vaccinations decrement inventory?** The design says no (no dose was drawn). Confirm — some workflows draw the dose then discover a contraindication, requiring a wastage decrement instead. If so, the `<WithholdPanel>` should optionally record `doses_wasted++` on the lot; recommend adding the optional wastage path in a follow-up rather than NOW.
8. **One VAR PDF component vs. two (administered vs. withheld).** The design recommends one `<VaccinationRecordPdf>` branching on `outcome`. Confirm, or split into `<VaccinationRecordPdf>` + `<VaccinationWithholdPdf>` if the layouts diverge enough in review.
9. **Does vaccination need its own `vaccination_id` tx-style sequence (like `prescription_tx`)?** The design uses a plain `gen_random_uuid()` for `vaccination.id` (no human-readable sequence). The minor-ailments flow reserves a `TX-…` id (`prescription-actions.ts:6`) because prescriptions are referenced in a dispensing workflow. Vaccinations are referenced by UUID in the immunization record; confirm a UUID is sufficient (no pharmacy-visible sequential vax number expected).
10. **Reconciliation with the older `assessment.opened { ailment }` audit event.** Inherited open question from #2 §7.7: the older `audit-log-design.md` lists `assessment.opened` carrying ailment in the non-PHI Supabase log, which conflicts with #2's stricter stance. #22's `vaccination.administered` deliberately carries **only** `{ vaccination_id }` (no `vaccine_id`) on Supabase, consistent with #2's stricter stance; confirm this is the discipline going forward and that a future `vaccination.opened` (if ever wired) likewise omits `vaccine_id`.

---

## 8. Files Touched (summary; the implementation plan enumerates steps)

**Created:**
- `src/lib/vaccines/catalog.ts` — versioned vaccine catalog (`VACCINES`, `VACCINE_CATALOG_VERSION`, `computeCatalogHash`), contraindication taxonomy.
- `src/lib/vaccines/consent-statements.ts` — vaccination consent statement set (`vaccination-v1`).
- `src/lib/vaccines/withhold-reasons.ts` — `WithholdReason` taxonomy (mirrors #4's `reasons.ts`).
- `src/lib/vaccine-inventory.ts` — `"use server"` query module: `getVaccineInventory`, `addInventoryLot`, `decrementInventory` (Supabase, non-PHI, RLS-scoped).
- `src/lib/phi/vaccination-store.ts` — all fly.io `vaccination` reads/writes, pharmacy-scoped (mirrors #2's `assessment-store.ts`).
- `src/lib/vaccination-actions.ts` — `saveVaccinationAction` server action (flag-guarded no-op stub in Phase 1).
- `src/components/vaccination/vaccination-wizard.tsx` — the 4-step vaccination wizard (Patient → Triage → Admin/Withhold → Consent+Generate).
- `src/components/vaccination/vaccination-record-pdf.tsx` — the VAR PDF (`@react-pdf/renderer`), branches on `outcome`.
- `src/components/vaccination/withhold-panel.tsx` — the withhold/refer branch panel.
- `src/components/vaccination/inventory-picker.tsx` — the lot selector (reads `vaccine_inventory`).
- `src/app/vaccinate/page.tsx` — vaccine picker (catalog list).
- `src/app/vaccinate/[vaccine]/page.tsx` — wizard route (parallel to `/assess/[ailment]/page.tsx`).
- `src/components/vaccination-entry.tsx` — dashboard vaccination card/section.
- `src/__tests__/vaccination-wizard.test.tsx`, `src/__tests__/vaccination-record-pdf.test.tsx`, `src/__tests__/vaccination-actions.test.ts`, `src/__tests__/vaccine-inventory.test.ts` — wizard gating, PDF rendering, action flag-guard + audit shape, inventory decrement/out-of-stock.

**Modified:**
- `src/types/index.ts` — add `VaccinationAdministration`, `VaccinationOutcome`, `WithholdReason`, `AdministrationRoute`, `AdministrationSite`; extend `ConsentCapture` with optional `consentType` + `consentToVaccinate`.
- `src/app/page.tsx` — render `<VaccinationEntry/>` alongside `<AilmentGrid/>` (`page.tsx:60`).
- `src/lib/audit-actions.ts` — add `"vaccination.administered"` to the `EventType` union (`audit-actions.ts:5-18`).

**Database (fly.io, PHI, applied at provisioning alongside #2/#3/#4):** new `vaccination` table + indexes (§4.4); extend #3's `consent` table with `consent_type` + `consent_to_vaccinate` (§4.5); reuse #2's `patient`, `phi_audit_log`, `compute_chain_hash`.

**Database (Supabase, non-PHI, ships in Phase 1):** new `vaccine_inventory` table + RLS policies + `decrement_vaccine_inventory` RPC (§4.6); add `vaccination.administered` to `audit.event_type` + extend `log_event` validation (require `vaccination_id`, forbid `vaccine_id`/`lot_number`/patient keys) (§4.8).

**Environment (server-only, all inherited):** `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`. No new env vars. **Dependencies:** none new (reuses `@react-pdf/renderer`, `pg` from #2, `react-signature-canvas` from #3).
