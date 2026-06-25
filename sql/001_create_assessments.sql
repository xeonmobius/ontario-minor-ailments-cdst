-- PHI assessments table for fly.io Postgres
-- Run this on the fly.io Postgres cluster (cdst database)

CREATE SCHEMA IF NOT EXISTS phi;

CREATE TABLE IF NOT EXISTS phi.assessments (
    id                  TEXT PRIMARY KEY,
    patient_hash        TEXT NOT NULL,
    patient_name        TEXT NOT NULL,
    patient_dob         TEXT NOT NULL,
    patient_sex         TEXT,
    patient_ohip        TEXT,
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
