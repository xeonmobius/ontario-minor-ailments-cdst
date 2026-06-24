# Vaccination Workflow — Implementation Plan

**Date:** 2026-06-23
**Roadmap item:** #22 (NOW tier)
**Companion design:** `docs/superpowers/specs/2026-06-23-vaccination-workflow-design.md`

> **For agentic workers:** Implement task-by-task. Each step is a small, independently verifiable unit. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the hard constraints in the design doc: **all PHI stays on fly.io** — the administration record (vaccine, lot, expiry, site, route, dose), the consent signature, and the contraindications-screened set are clinical data about a specific patient and live only on the `vaccination`/`consent` rows; Supabase receives only the non-PHI `vaccination.administered` metadata (`{ vaccination_id }` — **never** `vaccine_id`, `lot_number`, patient data, or outcome-irrelevant clinical content). `vaccine_inventory` is non-PHI (pharmacy stock) and lives on Supabase with RLS — it ships live in Phase 1, independent of the fly.io gate. Do **not** flip `PHI_PERSIST_ENABLED=true` until the fly.io BAA is signed and a Canadian region is confirmed (design §5.2). Until then `saveVaccinationAction` (+ #3's `saveConsentAction`) are no-op stubs, the wizard renders, the VAR PDF downloads, the inventory decrement runs, and the printed document is itself the durable legal artefact. **Do not** add automated allergy/interaction/pregnancy gating — that is PMS-owned (roadmap §3); the triage screen is a pharmacist-worked checklist only.

**Goal:** Add a second, parallel clinical workflow — vaccination administration — as a `VaccinationWizard` + `/vaccinate` routes + versioned vaccine catalog + VAR PDF, with the administration record persisted to #2's fly.io PHI store as a sibling `vaccination` table (sharing `patient` + `phi_audit_log`), vaccination consent captured via #3's `ConsentPanel` mechanism, and minimal lot-level inventory tracking on Supabase (non-PHI, decrement-on-administer, shipping live in Phase 1).

**Approach (from the design):** Option A — parallel `VaccinationWizard` (Patient → Contraindication triage → Administration details | Withhold/Refer → Consent + Generate); catalog in `src/lib/vaccines/catalog.ts`; sibling `vaccination` table on fly.io (not an `assessment.outcome`); `vaccine_inventory` on Supabase (RLS, non-PHI); vaccination-variant consent extending #3's `consent` table with a `consent_type` discriminator; triage as a checklist mirroring `step-redflags.tsx`. All PHI writes ride #2's `PHI_PERSIST_ENABLED` flag.

**Dependencies:** roadmap #2 (`persist-assessments-flyio`) — its fly.io `patient`/`phi_audit_log` schema, `pg` driver, `src/lib/phi/{db,identity,audit}.ts`, and `PHI_PERSIST_ENABLED` flag are reused. Roadmap #3 (`digital-consent-capture`) — its `ConsentPanel`, `ConsentCapture` type, `saveConsentAction`, signature pad, and `consent` table are reused and extended. Roadmap #5 (`stop-duplicating-pms-data`) — the slimmed `PatientInfo` is assumed. Tasks 1–6 + 8–10 can be built and merged without #2/#3 being live; the inventory ledger (Task 6) ships live in Phase 1; the E2E PHI persistence (Task 11) requires #2's Phase 2.

**Tech stack:** Next.js 16.2.6 server actions (`"use server"`), React 19, `@react-pdf/renderer ^4.5.1` (client Blob, unchanged — no new dependency), Supabase (non-PHI audit + inventory RLS), `pg` (from #2, for the fly.io write), `react-signature-canvas` (from #3, for consent), Vitest + React Testing Library.

---

### Task 1: Vaccination types + versioned vaccine catalog

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/lib/vaccines/catalog.ts`
- Create: `src/lib/vaccines/withhold-reasons.ts`
- Create: `src/lib/vaccines/consent-statements.ts`

- [ ] **Step 1: Add the vaccination types**

In `src/types/index.ts` (after `AssessmentData` at `types/index.ts:59-67`), add per design §4.2:

```ts
export type AdministrationRoute = "IM" | "SC" | "ID" | "intranasal" | "oral"
export type AdministrationSite =
  | "left_deltoid" | "right_deltoid"
  | "left_vastus_lateralis" | "right_vastus_lateralis"
  | "left_arm" | "right_arm" | "nasal" | "oral" | "other"

export interface VaccinationAdministration {
  vaccineId: string
  vaccineName: string
  lotNumber: string
  expiryDate: string
  manufacturer: string
  doseNumber: number
  seriesTotal: number
  route: AdministrationRoute
  site: AdministrationSite
  doseVolume: string
  administrationNotes: string
}

export type VaccinationOutcome = "administered" | "withheld" | "referred"

export type WithholdReason =
  | "contraindication_present"
  | "patient_declined"
  | "acute_illness_today"
  | "pregnancy_live_vaccine"
  | "out_of_stock"
  | "referred_to_physician"
  | "other"
```

Extend #3's `ConsentCapture` (added by #3 to `types/index.ts`) with two optional fields:

```ts
// inside ConsentCapture (from #3):
consentType?: "minor_ailments" | "vaccination"
consentToVaccinate?: boolean
```

- [ ] **Step 2: Create the vaccine catalog module**

`src/lib/vaccines/catalog.ts` — per design §4.1. Export `VACCINE_CATALOG_VERSION = "vaccines-v1"`, the `AdministrationRoute`/`AdministrationSite`/`Contraindication`/`VaccineProduct` interfaces, a `VACCINES: VaccineProduct[]` array seeded with the routine set (influenza, covid19-mrna, pneumococcal, shingles-rzv, tdap, hepatitis-b, hpv, meningococcal, rsv) — each with `vaccineId`, `name`, `defaultRoute`, `defaultSite`, `doseVolume`, `seriesTotal`, `fundedOntario`, `reportable`, `manufacturerExamples`, a `contraindications: Contraindication[]` checklist (e.g. "Severe allergic reaction to a previous dose or component" `severity: withhold`; "History of Guillain-Barré within 6 weeks of a prior dose" `severity: caution`; "Pregnant — live-vaccine caution" `severity: caution`), and a `patientEducation: string[]` list — and a `getVaccineByVaccineId(id)` helper. Plus `computeCatalogHash(vaccines): string` returning `sha256` over stable `(vaccineId, name, seriesTotal, contraindication ids)` tuples as hex (pins the catalog in effect — design §4.1, feeds `protocol_version` + #26).

> Place the catalog in a TS module under `src/lib/vaccines/` (not `data/`) so `protocol_version` is reproducible from the build and a deploy is required to change clinical content (design §7.2, mirrors #3's `statements.ts` / #4's `reasons.ts`). The exact Ontario-authorized product list (incl. the six July-2026 additions) is a clinical/legal review gate (design §7.3) — seed the routine set now, mark the additions TODO pending review.

- [ ] **Step 3: Create the withhold-reasons module**

`src/lib/vaccines/withhold-reasons.ts` — export a `WITHHOLD_REASONS` array of `{ value: WithholdReason; label: string; guidance: string | null }` (seven options per design §4.2), mirroring #4's `NON_PRESCRIBE_REASONS` shape. `referred_to_physician` produces the `referred` outcome (design §4.3); the rest produce `withheld`.

- [ ] **Step 4: Create the vaccination consent statements module**

`src/lib/vaccines/consent-statements.ts` — per design §4.5. Export `VACCINATION_CONSENT_VERSION = "vaccination-v1"` and `VACCINATION_CONSENT_STATEMENTS: ConsentStatement[]` (three statements: `consent_to_vaccinate` required, `consent_to_record` required, `consent_to_followup` optional). Reuse #3's `ConsentStatement` interface from `src/lib/consent/statements.ts`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/vaccines/catalog.ts src/lib/vaccines/withhold-reasons.ts src/lib/vaccines/consent-statements.ts
git commit -m "feat(vaccination): add vaccination types + versioned vaccine catalog"
```

---

### Task 2: Vaccination Administration Record PDF

**Files:**
- Create: `src/components/vaccination/vaccination-record-pdf.tsx`

- [ ] **Step 1: Implement the document component**

`src/components/vaccination/vaccination-record-pdf.tsx` — a client-side `@react-pdf/renderer` `<Document>` (same pipeline as `<CombinedPdf>` at `combined-pdf.tsx:185` and `<ReferralPdf>` at `referral-pdf.tsx:160`). Props per design §4.7:

```ts
interface VaccinationRecordPdfProps {
  vaccine: VaccineProduct
  patient: PatientInfo
  outcome: VaccinationOutcome
  administration: VaccinationAdministration | null   // when outcome=administered
  withholdReason?: WithholdReason                     // when outcome=withheld/referred
  withholdNote?: string
  contraindicationsChecked: string[]
  consentSignatureDataUrl?: string | null
  consentSignerName?: string
  consentSignerRelationship?: SignerRelationship
  consentCaptureMethod?: CaptureMethod
  consentStatementVersion?: string
  consentCapturedAt?: string
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
}
```

Reuse the established style objects (copy the `StyleSheet.create({...})` block from `combined-pdf.tsx:21-157` as the base — same TEAL/TEAL_LIGHT/DARK/MUTED/BORDER/GREEN/GREEN_LIGHT constants). Layout per design §4.7, branching on `outcome`:

- **Administered variant:** header `VACCINATION ADMINISTRATION RECORD`; pharmacy block (copy `combined-pdf.tsx:204-214`); two columns — Patient (left) | Administration (right: vaccine, `dose {doseNumber} of {seriesTotal}`, lot, expiry, manufacturer, route, site, dose volume, pharmacist); "Contraindications screened" section (the checked items or "None identified"); "Patient Education Provided" green block (the vaccine's `patientEducation` items, reusing `greenBlock`/`checkItem` from `combined-pdf.tsx:115-120`); "Follow-up" row — "Next dose due" when `doseNumber < seriesTotal` else "Series complete"; two-column signature block from #3 — patient/SDM side renders `<Image src={consentSignatureDataUrl} />` when present (sized `width: 120, height: 30`) else a `__________` line, pharmacist side a blank line (`pharmacy?.pharmacistName`); PHIPA footer per design §4.7 (incl. the "Report this administration to COVaxON / your local public health unit" reminder) + #3's consent attestation line.
- **Withheld/Referred variant:** same header colour but title `VACCINATION NOT ADMINISTERED — RECORD`; the Administration column replaced by "Outcome: Not administered" + the `withholdReason` label + the `withholdNote`; contraindications section as above; signatures + footer as above. No inventory decrement is implied by this document.

> `@react-pdf/renderer`'s `<Image>` accepts a data-URL `src` natively (same technique #3 uses for the consent signature).

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/vaccination/vaccination-record-pdf.tsx
git commit -m "feat(vaccination): add VaccinationRecordPdf document component"
```

---

### Task 3: Vaccination wizard (Patient → Triage → Admin/Withhold → Consent+Generate)

**Files:**
- Create: `src/components/vaccination/vaccination-wizard.tsx`
- Create: `src/components/vaccination/withhold-panel.tsx`
- Create: `src/components/vaccination/inventory-picker.tsx`

> **Sub-step 3a (inventory-picker) depends on Task 6's `getVaccineInventory`** — build the picker against the Task-6 contract now (it calls `getVaccineInventory(vaccineId)` and renders the lot list); if Task 6 lands first the picker is wired, otherwise stub the call locally until Task 6.

- [ ] **Step 1: Implement the `VaccinationWizard` shell + step machine**

`src/components/vaccination/vaccination-wizard.tsx` — a `"use client"` component, structurally parallel to `WizardContainer` (`wizard-container.tsx:40`). Props:

```ts
interface VaccinationWizardProps {
  vaccine: VaccineProduct
  pharmacy: PharmacyDefaults | null
}
```

State per design §4.2 (`step`, `patient`, `contraindicationsChecked`, `admin`, `selectedLotId`, `withholdReason`, `consent`, `vaccinationId`). `defaultPatient` reuses the slimmed 12-field `PatientInfo` from #5. The `canNext` gate per design §4.3 (step 0 requires `name && dob`; step 1 always advances; step 2 requires a withhold reason when a contraindication is present, else a complete `admin` object). Render a `<StepIndicator>` (reuse `wizard-nav.tsx`'s `StepIndicator` or a vaccination-specific 4-dot indicator) and the four steps.

- [ ] **Step 2: Step 0 — Patient**

Reuse the existing patient capture pattern (the slimmed `PatientInfo` form from `step-patient.tsx`, adapted). Add the In-Person guard (design §6): if `patient.encounterType !== "In-Person"`, show a blocking notice *"Vaccines can only be administered in person"* with "Switch to In-Person" / "Exit" actions.

- [ ] **Step 3: Step 1 — Contraindication triage**

Render `vaccine.contraindications` as a checkbox list (reusing the card/checkbox styling from `step-redflags.tsx:56-82`). `severity: "caution"` items render their `guidance` text but do not force the withhold branch; any checked `severity: "withhold"` item sets `hasContraindication = true`, routing step 2 to the `<WithholdPanel>`. **No automated allergy/interaction/pregnancy lookup** — a one-line note: *"Confirm against the patient's record in your PMS."*

- [ ] **Step 4: Step 2 — Administration details (no contraindication) + `<InventoryPicker>`**

`src/components/vaccination/inventory-picker.tsx` — calls `getVaccineInventory(vaccine.vaccineId)` (Task 6) and renders the lots as selectable cards: each shows `lotNumber`, `expiryDate`, `manufacturer`, `doses_on_hand`; lots with `doses_on_hand = 0` are disabled with a "no stock" badge. Selecting a lot sets `selectedLotId` and autofills `admin.lotNumber`/`expiryDate`/`manufacturer`. If no inventory rows exist for the vaccine, render a "Record with manual lot entry" free-entry fallback (design §6) that lets the pharmacist type lot/expiry/manufacturer directly (the decrement is skipped for manually-entered lots). The administration form then captures `doseNumber` (defaults to `vaccine.seriesTotal > 1 ? 1 : 1`, with a selector when `seriesTotal > 1`), `route` (default `vaccine.defaultRoute`), `site` (default `vaccine.defaultSite`), `doseVolume` (default `vaccine.doseVolume`), and an optional notes `<Textarea>`.

`src/components/vaccination/withhold-panel.tsx` — rendered instead when `hasContraindication`. A radio list of `WITHHOLD_REASONS` (Task 1), defaulting to `contraindication_present`, plus an optional note `<Textarea>`. `referred_to_physician` produces `outcome='referred'`; the rest `outcome='withheld'`.

- [ ] **Step 5: Step 3 — Consent + Generate**

Render #3's `<ConsentPanel>` configured with `statements={VACCINATION_CONSENT_STATEMENTS}` (Task 1), `encounterType={patient.encounterType}`, and the vaccination-specific `consentType="vaccination"`. Above the panel, an assessment summary Card (patient, vaccine, lot/expiry/site/route OR withhold reason). Below it, a "Download Vaccination Administration Record PDF" button `disabled={!consent || !decisionComplete}`. On click, call `handleGenerate` (Step 6).

- [ ] **Step 6: Implement `handleGenerate` (fail-closed ordering)**

Per design §4.8:

```ts
async function handleGenerate() {
  if (!consent) return
  const dateOfAssessment = new Date().toLocaleDateString("en-CA")
  try {
    // 1. Consent (vaccination variant) — extends #3's saveConsentAction.
    await saveConsentAction({
      consent: { ...consent, consentType: "vaccination" },
      patientIdentity: { name: patient.name, dob: patient.dob, postalCode: patient.postalCode },
      vaccinationId,
    })
    // 2. Administration/withhold record — fail-closed persistence (Task 8).
    await saveVaccinationAction({
      patient, vaccine, outcome, administration: admin,
      withholdReason, withholdNote: assessmentNotes,
      contraindicationsChecked, vaccinationId,
      protocolVersion: computeCatalogHash(VACCINES),
    })
    // 3. Inventory decrement (non-PHI; only when a real lot + administered).
    if (selectedLotId && admin && outcome === "administered") {
      try { await decrementInventory(selectedLotId) }
      catch (e) { console.error("Inventory decrement failed (reconcilable from ledger):", e) }
    }
    // 4. Document — fail-closed: a thrown error above blocks the download.
    const reasonOpt = withholdReason ? WITHHOLD_REASONS.find(r => r.value === withholdReason) : undefined
    const doc = <VaccinationRecordPdf
      vaccine={vaccine} patient={patient} outcome={outcome}
      administration={admin} withholdReason={withholdReason ?? undefined}
      withholdNote={assessmentNotes} contraindicationsChecked={contraindicationsChecked}
      consentSignatureDataUrl={consent.signatureDataUrl}
      consentSignerName={consent.signerName} consentSignerRelationship={consent.signerRelationship}
      consentCaptureMethod={consent.captureMethod} consentStatementVersion={consent.statementVersion}
      consentCapturedAt={consent.capturedAt}
      dateOfAssessment={dateOfAssessment} pharmacy={pharmacy}
    />
    await downloadPdf(doc, `vaccination-${vaccine.vaccineId}-${dateOfAssessment}.pdf`)
  } catch (err) {
    console.error("Vaccination record failed:", err)
  }
}
```

`vaccinationId` is `useState(() => crypto.randomUUID())` (mirrors #2's `assessmentId`). During Phase 1, `saveConsentAction` + `saveVaccinationAction` are no-op stubs returning null; the decrement runs (Supabase); the VAR downloads.

- [ ] **Step 7: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/components/vaccination/vaccination-wizard.tsx src/components/vaccination/withhold-panel.tsx src/components/vaccination/inventory-picker.tsx
git commit -m "feat(vaccination): add 4-step VaccinationWizard + withhold panel + inventory picker"
```

---

### Task 4: Dashboard entry + `/vaccinate` routes

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/vaccination-entry.tsx`
- Create: `src/app/vaccinate/page.tsx`
- Create: `src/app/vaccinate/[vaccine]/page.tsx`

- [ ] **Step 1: Dashboard vaccination entry**

`src/components/vaccination-entry.tsx` — a `"use client"` card/section (reusing `src/components/ui/card` + `ailment-card.tsx` styling conventions) linking to `/vaccinate`, rendered on the dashboard. In `src/app/page.tsx`, render `<VaccinationEntry/>` alongside `<AilmentGrid/>` at `page.tsx:60` (e.g., a section heading "Vaccinations" above the card, beneath the existing ailments grid).

- [ ] **Step 2: Vaccine picker route**

`src/app/vaccinate/page.tsx` — `requireAuth()` (`auth-guards.ts:44`), then render the `VACCINES` catalog (Task 1) as cards (reusing `ailment-card.tsx`'s `<Link>`/`<Card>` pattern), each linking to `/vaccinate/${vaccine.vaccineId}`. Include the standard dashboard header/footer chrome (template: `src/app/page.tsx:40-67`).

- [ ] **Step 3: Wizard route**

`src/app/vaccinate/[vaccine]/page.tsx` — parallel to `/assess/[ailment]/page.tsx:9`. `requireAuth()`, resolve the vaccine by `vaccineId` from the catalog (`getVaccineByVaccineId`), `notFound()` if missing, load the pharmacy defaults (copy `/assess/[ailment]/page.tsx:24-43` verbatim — same `pharmacies` select → `PharmacyDefaults` mapping), render `<VaccinationWizard vaccine={vaccine} pharmacy={pharmacyDefaults} />` with the `BackButton` header chrome (`/assess/[ailment]/page.tsx:46-55`).

- [ ] **Step 4: Typecheck + lint**

```bash
npx tsc --noEmit --pretty && npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/vaccination-entry.tsx src/app/vaccinate/page.tsx src/app/vaccinate/[vaccine]/page.tsx
git commit -m "feat(vaccination): add dashboard entry + /vaccinate picker and wizard routes"
```

---

### Task 5: Extend #3's consent table (fly.io migration)

> **Dependency:** the live migration depends on roadmap #3 (the `consent` table) being provisioned on fly.io. Define the migration now; it is applied when fly.io is provisioned alongside #3's base schema.

**Files:**
- Database (fly.io, when provisioned): `consent` table extension

- [ ] **Step 1: Write the migration**

Per design §4.5 (extends #3's `consent` table from `digital-consent-capture-design.md` §4.5):

```sql
-- Extend #3's consent table with a consent_type discriminator + vaccination flag.
ALTER TABLE consent ADD COLUMN consent_type text NOT NULL DEFAULT 'minor_ailments'
  CHECK (consent_type IN ('minor_ailments','vaccination'));
ALTER TABLE consent ADD COLUMN consent_to_vaccinate boolean;
-- consent_to_vaccinate is set only when consent_type='vaccination'; existing minor-ailments
-- rows default to 'minor_ailments' and NULL consent_to_vaccinate (no backfill needed).
```

- [ ] **Step 2: Coordinate migration ordering**

This migration runs **after** #3's base `consent` migration. Confirm the filename ordering (e.g. `0003_consent_vaccination_type.sql` after #3's `0002_consent.sql`) so it applies cleanly on a fresh DB.

- [ ] **Step 3: Verify (on the staging fly.io dev cluster, after provisioning)**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'consent' AND column_name IN ('consent_type','consent_to_vaccinate');
-- Expected: 2 rows.
```

---

### Task 6: `vaccine_inventory` table + query module (Supabase, ships live in Phase 1)

**Files:**
- Database (Supabase migration): `vaccine_inventory` + RLS + `decrement_vaccine_inventory`
- Create: `src/lib/vaccine-inventory.ts`

- [ ] **Step 1: Apply the Supabase migration**

Per design §4.6:

```sql
CREATE TABLE vaccine_inventory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id     uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  vaccine_id      text NOT NULL,
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

ALTER TABLE vaccine_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_pharmacy_select ON vaccine_inventory
  FOR SELECT USING (pharmacy_id IN (
    SELECT m.pharmacy_id FROM pharmacy_members m
    JOIN auth.users u ON u.id = m.user_id WHERE u.id = auth.uid() AND m.is_active ));
CREATE POLICY inventory_pharmacy_update ON vaccine_inventory
  FOR UPDATE USING (pharmacy_id IN (
    SELECT m.pharmacy_id FROM pharmacy_members m
    JOIN auth.users u ON u.id = m.user_id WHERE u.id = auth.uid() AND m.is_active ));
CREATE POLICY inventory_pharmacy_insert ON vaccine_inventory
  FOR INSERT WITH CHECK (pharmacy_id IN (
    SELECT m.pharmacy_id FROM pharmacy_members m
    JOIN auth.users u ON u.id = m.user_id WHERE u.id = auth.uid() AND m.is_active ));

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

- [ ] **Step 2: Create the query module**

`src/lib/vaccine-inventory.ts` — `"use server"`. Functions (all derive `pharmacyId` from `requireAuth()` internally):

- `getVaccineInventory(vaccineId: string): Promise<InventoryLot[]>` — `SELECT … WHERE pharmacy_id = $pharmacyId AND vaccine_id = $vaccineId ORDER BY expiry_date ASC`.
- `addInventoryLot(input): Promise<{ lotId }>` — `INSERT` (RLS insert policy). Used by a later inventory-management UI (LATER); expose now so the ledger is populate-able.
- `decrementInventory(lotId: string): Promise<{ remaining: number }>` — calls the `decrement_vaccine_inventory` RPC. Used by the wizard's `handleGenerate`.

```ts
export interface InventoryLot {
  id: string; vaccineId: string; lotNumber: string; expiryDate: string;
  manufacturer: string | null; dosesReceived: number; dosesOnHand: number; dosesWasted: number;
}
```

- [ ] **Step 3: Verify (on Supabase staging)**

```sql
-- Insert a test lot for the logged-in pharmacy, then confirm RLS hides it from another pharmacy.
-- Call the decrement RPC and confirm doses_on_hand drops by 1 and bottoms at 0.
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/vaccine-inventory.ts
git commit -m "feat(vaccination): add non-PHI vaccine_inventory ledger + decrement RPC"
```

---

### Task 7: `vaccination` table (fly.io migration)

> **Dependency:** the live migration depends on roadmap #2 (fly.io Postgres under BAA). Define the migration now; it is applied when fly.io is provisioned alongside #2's base schema.

**Files:**
- Database (fly.io, when provisioned): `vaccination` table

- [ ] **Step 1: Write the migration**

Per design §4.4 (sibling to #2's `assessment`; reuses #2's `patient` + `phi_audit_log`):

```sql
CREATE TABLE vaccination (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id         uuid NOT NULL,
  pharmacist_id       uuid NOT NULL,
  patient_id          uuid NOT NULL REFERENCES patient(id),
  vaccine_id          text NOT NULL,
  vaccine_name        text NOT NULL,
  outcome             text NOT NULL CHECK (outcome IN ('administered','withheld','referred')),
  dose_number         integer,
  series_total        integer,
  lot_number          text,
  expiry_date         date,
  manufacturer        text,
  route               text CHECK (route IS NULL OR route IN ('IM','SC','ID','intranasal','oral')),
  site                text CHECK (site IS NULL OR site IN
                      ('left_deltoid','right_deltoid','left_vastus_lateralis','right_vastus_lateralis',
                       'left_arm','right_arm','nasal','oral','other')),
  dose_volume         text,
  withhold_reason     text CHECK (withhold_reason IS NULL OR withhold_reason IN
                      ('contraindication_present','patient_declined','acute_illness_today',
                       'pregnancy_live_vaccine','out_of_stock','referred_to_physician','other')),
  contraindications_checked jsonb NOT NULL DEFAULT '[]'::jsonb,
  administration_notes text,
  consent_id          uuid,
  patient_snapshot    jsonb NOT NULL,
  pharmacy_snapshot   jsonb NOT NULL,
  protocol_version    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vaccination_pharmacy_created ON vaccination (pharmacy_id, created_at DESC);
CREATE INDEX vaccination_patient ON vaccination (patient_id, created_at DESC);
CREATE INDEX vaccination_lot ON vaccination (pharmacy_id, lot_number);
CREATE INDEX vaccination_vaccine ON vaccination (pharmacy_id, vaccine_id);
```

- [ ] **Step 2: Verify (on the staging fly.io dev cluster, after provisioning)**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'vaccination' ORDER BY ordinal_position;
-- Expected: all columns present; patient_id FK to patient(id) resolves.
```

---

### Task 8: `saveVaccinationAction` + store (fly.io)

**Files:**
- Create: `src/lib/phi/vaccination-store.ts`
- Create: `src/lib/vaccination-actions.ts`

- [ ] **Step 1: Implement the store module**

`src/lib/phi/vaccination-store.ts` — the **only** module that touches fly.io `vaccination`, mirroring #2's `assessment-store.ts`. `saveVaccination(input)`:

1. `resolvePatientId({ pharmacyId, identity })` (from #2) — upsert on #2's `patient` via `identity_hash` (`identity.ts`).
2. `INSERT INTO vaccination` with `pharmacy_id`/`pharmacist_id` injected from the verified session (never from the caller), the catalog hash as `protocol_version`, the immutable `patient_snapshot`/`pharmacy_snapshot` JSONB, and `consent_id` when set.
3. `INSERT INTO phi_audit_log (…, 'vaccination.administered', …)` (reuses #2's `compute_chain_hash` trigger).
4. All three in one `pool.connect()` → `BEGIN`/`COMMIT` transaction (inherited discipline). Returns `{ vaccinationId }`.

Also implement `listVaccinations({ pharmacyId, patientId?, vaccineId?, lotNumber?, limit, offset })` and `getVaccinationsByLot({ pharmacyId, lotNumber })` — both scoped by `pharmacy_id`; both write `vaccination.viewed` to `phi_audit_log`.

- [ ] **Step 2: Implement the server action**

`src/lib/vaccination-actions.ts` — `"use server"`. `saveVaccinationAction(payload)` per design §4.8:

1. `requireAuth()` → `{ id: pharmacistId, pharmacyId }`. Bail `{ vaccinationId: null }` when `!pharmacyId`.
2. **Guard:** `if (process.env.PHI_PERSIST_ENABLED !== "true")` → return `{ vaccinationId: null }` (no-op stub — identical pattern to #2).
3. Server-side re-validation (design §5.3): validate `outcome` enum; validate `route`/`site`/`withhold_reason` enums when present; require non-empty `lotNumber`/`expiryDate`/`doseNumber` when `outcome='administered'`.
4. Build the persistence input, call `saveVaccination(…)`.
5. Emit the non-PHI Supabase `vaccination.administered` event with metadata **strictly** `{ vaccination_id }` — no `vaccine_id`, no `lot_number`, no patient data.
6. Return `{ vaccinationId }`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit --pretty
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/phi/vaccination-store.ts src/lib/vaccination-actions.ts
git commit -m "feat(vaccination): add saveVaccinationAction + fly.io vaccination store"
```

---

### Task 9: Audit event + Supabase `log_event` validation

**Files:**
- Database (Supabase migration): `audit.log_event` + `audit.event_type`
- Modify: `src/lib/audit-actions.ts`

- [ ] **Step 1: Apply the Supabase migration**

Add `vaccination.administered` to `audit.event_type` and add a `vaccination.administered` branch to `log_event` (preserve all existing per-event checks from #1/#2/#3/#4):

```sql
  -- vaccination.administered: require vaccination_id; forbid any clinical/lot/patient key.
  IF p_event_type = 'vaccination.administered' THEN
    IF (p_metadata->>'vaccination_id') IS NULL THEN
      RAISE EXCEPTION 'vaccination.administered requires vaccination_id';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_metadata) k
      WHERE k LIKE 'patient_%'
         OR k IN ('vaccine_id','vaccine','lot_number','lot','dose','site','route',
                  'ailment','name','dob','notes')
    ) THEN
      RAISE EXCEPTION 'vaccination.administered metadata must not contain clinical/patient data';
    END IF;
  END IF;
```

- [ ] **Step 2: Add the event to the TS union**

In `src/lib/audit-actions.ts` (`audit-actions.ts:5-18`), add `| "vaccination.administered"` to the `EventType` union.

- [ ] **Step 3: Verify (on Supabase staging)**

```sql
SELECT event_type, metadata FROM audit.log
WHERE event_type = 'vaccination.administered'
ORDER BY created_at DESC LIMIT 5;
-- Expected: metadata = { vaccination_id } only. No 'vaccine_id', 'lot_number', patient keys.
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit-actions.ts
git commit -m "feat(audit): add vaccination.administered event (non-PHI metadata only)"
```

---

### Task 10: Tests

**Files:**
- Create: `src/__tests__/vaccination-wizard.test.tsx`
- Create: `src/__tests__/vaccination-record-pdf.test.tsx`
- Create: `src/__tests__/vaccination-actions.test.ts`
- Create: `src/__tests__/vaccine-inventory.test.ts`

- [ ] **Step 1: Wizard gating logic**

`src/__tests__/vaccination-wizard.test.tsx` — render `<VaccinationWizard>` with React Testing Library. Assert: step 0 `canNext` is false until `name`+`dob` are set; selecting a Virtual encounter shows the In-Person guard; checking a `severity: "withhold"` contraindication routes step 2 to the `<WithholdPanel>` (withhold reason radio appears); with no contraindication, step 2 shows the `<InventoryPicker>`; the step-3 Download button is disabled until `consent !== null`.

- [ ] **Step 2: PDF renders the administration + withhold variants**

`src/__tests__/vaccination-record-pdf.test.tsx` — render `<VaccinationRecordPdf>` into a `@react-pdf/renderer` test renderer. Assert: the administered-variant title contains "VACCINATION ADMINISTRATION RECORD"; the lot/expiry/site/route appear when `outcome='administered'`; the withhold-variant title contains "NOT ADMINISTERED" and renders the `withholdReason` label; the "Patient Education Provided" items render; the footer contains "COVaxON".

- [ ] **Step 3: Action flag-guard + non-PHI audit shape + server re-validation**

`src/__tests__/vaccination-actions.test.ts` — mock `requireAuth`, `isPhiEnabled`, the store, `logAuditEvent`. Assert: flag-off returns `{ vaccinationId: null }` and writes nothing; flag-on with `outcome='administered'` but missing `lotNumber` **throws** (server re-validation); flag-on with a valid payload calls the store and emits `vaccination.administered` with metadata **exactly** `{ vaccination_id }` (no `vaccine_id`, no `lot_number`, no patient keys). Assert `lotNumber`/`site`/`route` are passed to the store as column values, never to `logAuditEvent`.

- [ ] **Step 4: Inventory decrement + out-of-stock**

`src/__tests__/vaccine-inventory.test.ts` — mock the Supabase client + `requireAuth`. Assert: `getVaccineInventory` is scoped to the caller's `pharmacyId`; `decrementInventory` calls the `decrement_vaccine_inventory` RPC with the lot id + `pharmacyId`; a lot with `doses_on_hand = 0` raises (the RPC bottoms at 0). Assert RLS scoping: a second pharmacy's inventory is not returned.

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/__tests__
git commit -m "test(vaccination): cover wizard gating, PDF variants, action guard + audit shape, inventory"
```

---

### Task 11: End-to-end verification (staging fly.io dev cluster)

> Requires #2's Phase 2 (fly.io provisioned, BAA signed, `PHI_PERSIST_ENABLED=true`) AND #3's Phase 2 (`ConsentPanel` + `saveConsentAction` live). Inventory (Supabase) can be verified independently in Phase 1.

- [ ] **Step 1: Configure staging env**

Confirm `PHI_PERSIST_ENABLED=true`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT` (from #2); the fly.io dev cluster has #2's base migration + Task 7's `vaccination` migration + Task 5's `consent` extension applied; #3's `consent` migration is applied; Supabase has Task 6's `vaccine_inventory` + Task 9's audit migration applied.

- [ ] **Step 2: Inventory populate (Phase 1, Supabase only)**

Log in, populate `vaccine_inventory` for influenza (2 lots, one with `doses_on_hand=0`). Open `/vaccinate` → influenza. Expect: the picker shows the vaccine; step 2's `<InventoryPicker>` shows both lots, the zero-stock one disabled with "no stock".

- [ ] **Step 3: Administered path (Phase 2, fly.io)**

Complete step 0 (In-Person), pass triage with no contraindication, select the in-stock lot (autofills lot/expiry/manufacturer), confirm dose 1 of 1, route/site/volume defaults, complete #3's `<ConsentPanel>` (both required consents + signature). Expect on Download: a row in fly.io `vaccination` (`outcome='administered'`, `lot_number`, `site`, `route`, `dose_number=1`, `protocol_version=<catalog hash>`, `consent_id` set), a `phi_audit_log` `'vaccination.administered'` row, a `consent` row with `consent_type='vaccination'`, the `vaccine_inventory.doses_on_hand` decremented by 1, and the downloaded VAR shows the lot/expiry/site/route + the patient signature.

- [ ] **Step 4: Withhold path**

Check a `severity: "withhold"` contraindication at step 1. Expect: step 2 shows the `<WithholdPanel>`; selecting `patient_declined` + completing consent produces `outcome='withheld'`, `withhold_reason='patient_declined'`, `lot_number`/`site`/`route` NULL, **no** inventory decrement, and the withhold-variant VAR ("NOT ADMINISTERED").

- [ ] **Step 5: Out-of-stock manual-entry fallback**

Delete all inventory rows for a vaccine. Expect: step 2 shows "no inventory — record with manual lot entry"; the pharmacist types a lot/expiry; the administration records with the manual lot; **no** decrement occurs (no ledger row corresponds). Documented (design §6).

- [ ] **Step 6: Lot recall query**

Via the store, call `getVaccinationsByLot({ pharmacyId, lotNumber: <the lot from Step 3> })`. Expect: the Step-3 administration row returns, carrying patient identity for outreach.

- [ ] **Step 7: Verify no PHI leaked to Supabase**

```sql
SELECT event_type, metadata FROM audit.log
WHERE event_type = 'vaccination.administered'
ORDER BY created_at DESC LIMIT 10;
```

Expected: metadata = `{ vaccination_id }` only. No `vaccine_id`, `lot_number`, patient data, nowhere.

- [ ] **Step 8: Verify cross-pharmacy isolation**

Switch to a second pharmacy; attempt to read the first pharmacy's `vaccination` row via the store and the first pharmacy's inventory via `getVaccineInventory`. Expect: `null`/empty (RLS + app-layer scoping), enforced by the `WHERE pharmacy_id = $…` discipline + the Supabase RLS policies.

---

## Data / DB changes (summary)

- **fly.io Postgres (PHI, BAA):** new `vaccination` table + indexes (Task 7); extend #3's `consent` table with `consent_type` + `consent_to_vaccinate` (Task 5); reuse #2's `patient`, `phi_audit_log`, `compute_chain_hash`. Dedicated least-privilege app role (from #2): `INSERT`/`SELECT` only on `vaccination`; no `UPDATE`/`DELETE` (immutability inherited).
- **Supabase (non-PHI):** new `vaccine_inventory` table + RLS policies + `decrement_vaccine_inventory` RPC (Task 6); add `vaccination.administered` to `audit.event_type` + extend `log_event` validation to require `vaccination_id` and forbid `vaccine_id`/`lot_number`/patient keys (Task 9).
- **Dependencies:** none new — reuses `@react-pdf/renderer` (present), `pg` (from #2), `react-signature-canvas` (from #3), and the `src/components/ui/*` primitives. **No new env vars** — reuses #2's `PHI_PERSIST_ENABLED`, `FLY_PHI_DATABASE_URL`, `PHI_IDENTITY_SALT`.

## Verification commands

- Typecheck: `npx tsc --noEmit --pretty`
- Lint: `npm run lint`
- Tests: `npx vitest run`
- CI grep (PHI scoping discipline, inherited from #2 + extended): `rg -n "FROM vaccination|INTO vaccination" src/lib/phi` — every match must contain `pharmacy_id`.
- CI grep (no PHI in audit): `rg -n "vaccination.administered" src/lib` — confirm the metadata object literal contains only `vaccination_id` (no `vaccine_id`/`lot_number`/patient keys).
- CI grep (no PMS-owned safety logic): `rg -ni "allerg|interaction|contraindicat" src/components/vaccination` — confirm contraindication content is a static checklist from the catalog, not an automated lookup.

## Rollout notes

- **Phase 0 (ops — inherited from #2):** fly.io Postgres in a Canadian region (`yyz`/`yul`); BAA signed; `PHI_IDENTITY_SALT` set. `PHI_PERSIST_ENABLED` stays `false` until then.
- **Phase 1 (code, `PHI_PERSIST_ENABLED=false`):** ship Tasks 1–6 + 8–10. The `VaccinationWizard` renders end-to-end, the `<InventoryPicker>` reads live `vaccine_inventory` (Supabase, non-PHI — **live in Phase 1**), the VAR PDF downloads, and #3's `<ConsentPanel>` gates the Download — so the printed document is a complete legal artefact **even with no fly.io row**. `saveVaccinationAction` + `saveConsentAction` are no-op stubs (inherited from #2/#3); Supabase receives no `vaccination.administered` events yet. The inventory decrement runs live (it is non-PHI). This lets the vaccination UX land, typecheck, and test without waiting on the BAA, and the inventory feature delivers real value immediately.
- **Phase 2 (after #2's and #3's Phase 2):** apply the Task 5 + Task 7 migrations on fly.io and `PHI_PERSIST_ENABLED=true` lights up #2, #3, and #22 automatically. Run the Task 11 E2E against staging first.
- **Never** put the vaccine id, lot number, site, route, dose, contraindications, or any patient/clinical data in the Supabase audit metadata (enforced by the Task 9 `log_event` validation and the Task 10 actions test); **never** omit `pharmacy_id` from a fly.io `vaccination` query (inherited from #2); **never** render a VAR without a captured vaccination consent (fail-closed gate); **never** add automated allergy/interaction/pregnancy gating (PMS-owned — the triage screen is a checklist only).
- **Sequencing with siblings:** depends on #2 (`patient`/`phi_audit_log`, `pg`, `PHI_PERSIST_ENABLED`, `identity.ts`, `resolvePatientId`), #3 (`ConsentPanel`, `ConsentCapture`, `saveConsentAction`, `consent` table, signature pad), and #5 (slimmed `PatientInfo`). Unblocks #10 (PROM follow-up reads `vaccination.dose_number`/`series_total` + `consent_to_followup` for second-dose reminders), #13 (analytics rollups over `vaccine_id` per pharmacy — from fly.io aggregates, never Supabase), #16 (appointment booking links to the catalog), and #26 (the `protocol_version` catalog-hash governance feed). Clinical/legal review of `src/lib/vaccines/catalog.ts` + the contraindication taxonomy (design §7.3/§7.4) is a **hard** gate before production rollout — the catalog is seeded with the routine set and the six July-2026 additions are TODO pending that review.
