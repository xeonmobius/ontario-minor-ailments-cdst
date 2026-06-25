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
      CREATE INDEX IF NOT EXISTS idx_assessments_non_prescribe
        ON phi.assessments (pharmacy_id, non_prescribe_reason)
        WHERE non_prescribe_reason IS NOT NULL;
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
