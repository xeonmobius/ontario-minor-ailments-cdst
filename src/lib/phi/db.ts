import { Pool } from "pg"

let pool: Pool | null = null
let migrated = false

export function isPhiEnabled(): boolean {
  return process.env.PHI_PERSIST_ENABLED === "true"
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set")
    }
    const dbHost = process.env.PHI_DB_HOST
    pool = new Pool(
      dbHost
        ? {
            host: dbHost,
            port: 5432,
            user: process.env.PHI_DB_USER ?? "fly-user",
            password: process.env.PHI_DB_PASSWORD ?? "",
            database: process.env.PHI_DB_NAME ?? "cdst",
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
            ssl: process.env.PHI_DB_SSL === "false" ? false : { rejectUnauthorized: false },
          }
        : {
            connectionString,
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
            ssl: process.env.PHI_DB_SSL === "false" ? false : { rejectUnauthorized: false },
          },
    )
  }
  return pool
}

async function ensureSchema() {
  if (migrated) return
  const client = await getPool().connect()
  try {
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS phi;
      CREATE TABLE IF NOT EXISTS phi.assessments (
        id                  TEXT PRIMARY KEY,
        patient_hash        TEXT NOT NULL,
        patient_name        TEXT NOT NULL,
        patient_dob         TEXT NOT NULL,
        patient_sex         TEXT,
        ailment_id          TEXT NOT NULL,
        ailment_name        TEXT NOT NULL,
        tx_id               TEXT NOT NULL,
        red_flags_checked   TEXT[] DEFAULT '{}',
        has_red_flag        BOOLEAN NOT NULL DEFAULT FALSE,
        symptoms_checked    TEXT[] DEFAULT '{}',
        assessment_notes    TEXT DEFAULT '',
        selected_rx         JSONB,
        non_rx_checked      TEXT[] DEFAULT '{}',
        is_referral         BOOLEAN NOT NULL DEFAULT FALSE,
        pharmacist_id       TEXT NOT NULL,
        pharmacy_id         TEXT NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_assessments_pharmacy ON phi.assessments (pharmacy_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assessments_patient   ON phi.assessments (patient_hash);
      CREATE INDEX IF NOT EXISTS idx_assessments_tx         ON phi.assessments (tx_id);

      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS outcome TEXT;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS non_prescribe_reason TEXT;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS non_prescribe_rationale TEXT;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS abandonment_reason TEXT;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS reason_taxonomy_version TEXT;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS reason_taxonomy_hash TEXT;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS consent_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_assessments_non_prescribe
        ON phi.assessments (pharmacy_id, non_prescribe_reason)
        WHERE non_prescribe_reason IS NOT NULL;

      -- Roadmap #11: pharmacist e-signature per-act binding columns on the
      -- assessment row. pharmacist_signature_id forward-links the credential;
      -- signed_at + signing_attestation_version are the write-once per-act
      -- stamp. Additive (CREATE/ALTER IF NOT EXISTS) so Phase 2 self-provisions.
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS pharmacist_signature_id TEXT;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
      ALTER TABLE phi.assessments ADD COLUMN IF NOT EXISTS signing_attestation_version TEXT;
      CREATE INDEX IF NOT EXISTS idx_assessments_signed
        ON phi.assessments (signed_at) WHERE signed_at IS NOT NULL;

      -- Roadmap #11: the enrolled per-pharmacist e-signature credential. PHI
      -- (a biometric stroke of an identified pharmacist) on fly.io only; never
      -- Supabase. One current credential per pharmacist (UNIQUE); re-enrollment
      -- overwrites the bytea. Scoped by pharmacy_id on every read/write.
      CREATE TABLE IF NOT EXISTS phi.pharmacist_signature (
        id                   TEXT PRIMARY KEY,
        pharmacist_id        TEXT NOT NULL,
        pharmacy_id          TEXT NOT NULL,
        signature_png        BYTEA NOT NULL,
        attestation_version  TEXT NOT NULL,
        attestation_hash     TEXT NOT NULL,
        enrolled_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacist_signature_one
        ON phi.pharmacist_signature (pharmacist_id);
      CREATE INDEX IF NOT EXISTS idx_pharmacist_signature_pharmacy
        ON phi.pharmacist_signature (pharmacy_id);

      -- Roadmap #3: patient/SDM consent artefact. PHI (signer identity + the
      -- stroke image) lives here on fly.io only; never Supabase. Scoped by
      -- pharmacy_id on every read/write. assessment_tx_id back-links the
      -- assessment; assessments.consent_id forward-links the consent.
      CREATE TABLE IF NOT EXISTS phi.consents (
        id                  TEXT PRIMARY KEY,
        patient_hash        TEXT NOT NULL,
        pharmacy_id         TEXT NOT NULL,
        pharmacist_id       TEXT NOT NULL,
        assessment_tx_id    TEXT,
        statement_version   TEXT NOT NULL,
        statement_hash      TEXT NOT NULL,
        consent_to_assess   BOOLEAN NOT NULL,
        consent_to_record   BOOLEAN NOT NULL,
        consent_to_followup BOOLEAN NOT NULL DEFAULT FALSE,
        signer_name         TEXT NOT NULL,
        signer_relationship TEXT NOT NULL,
        capture_method      TEXT NOT NULL,
        signature_png       BYTEA,
        ip_address          TEXT,
        captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_consents_pharmacy ON phi.consents (pharmacy_id, captured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_consents_patient   ON phi.consents (patient_hash);
      CREATE INDEX IF NOT EXISTS idx_consents_tx        ON phi.consents (assessment_tx_id);

      -- Roadmap #22: extend #3's consent table with a consent_type discriminator
      -- + vaccination-specific flag. Additive (ALTER IF NOT EXISTS) so Phase 2
      -- self-provisions; existing minor-ailments rows default to
      -- 'minor_ailments' and NULL consent_to_vaccinate (no backfill needed).
      ALTER TABLE phi.consents ADD COLUMN IF NOT EXISTS consent_type TEXT NOT NULL DEFAULT 'minor_ailments';
      ALTER TABLE phi.consents ADD COLUMN IF NOT EXISTS consent_to_vaccinate BOOLEAN;
      ALTER TABLE phi.consents ADD COLUMN IF NOT EXISTS vaccination_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_consents_vaccination ON phi.consents (vaccination_id);

      -- Roadmap #22: vaccination administration record. A sibling to the
      -- assessment table — a vaccination has no ailment slug and a different
      -- legal basis, so it is NOT modelled as an assessment.outcome. Shares the
      -- patient_hash identity index discipline; scoped by pharmacy_id on every
      -- read/write. No UPDATE/DELETE (immutability inherited from #2).
      CREATE TABLE IF NOT EXISTS phi.vaccinations (
        id                      TEXT PRIMARY KEY,
        patient_hash            TEXT NOT NULL,
        pharmacy_id             TEXT NOT NULL,
        pharmacist_id           TEXT NOT NULL,
        vaccination_client_id   TEXT,
        vaccine_id              TEXT NOT NULL,
        vaccine_name            TEXT NOT NULL,
        outcome                 TEXT NOT NULL,
        dose_number             INTEGER,
        series_total            INTEGER,
        lot_number              TEXT,
        expiry_date             TEXT,
        manufacturer            TEXT,
        route                   TEXT,
        site                    TEXT,
        dose_volume             TEXT,
        withhold_reason         TEXT,
        contraindications_checked TEXT[] DEFAULT '{}',
        administration_notes    TEXT DEFAULT '',
        consent_id              TEXT,
        protocol_version        TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vaccinations_pharmacy
        ON phi.vaccinations (pharmacy_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_vaccinations_patient
        ON phi.vaccinations (patient_hash);
      CREATE INDEX IF NOT EXISTS idx_vaccinations_lot
        ON phi.vaccinations (pharmacy_id, lot_number);
      CREATE INDEX IF NOT EXISTS idx_vaccinations_vaccine
        ON phi.vaccinations (pharmacy_id, vaccine_id);
    `)
    migrated = true
  } finally {
    client.release()
  }
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!isPhiEnabled()) return []
  await ensureSchema()
  const client = await getPool().connect()
  try {
    const result = await client.query<T>(text, params)
    return result.rows
  } finally {
    client.release()
  }
}
