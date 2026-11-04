-- Migration: audit_event_type_pharmacy_lifecycle
-- Adds three pharmacy lifecycle events to the audit.event_type ENUM.
-- The TS EventType union and existing logAuditEvent callers already reference
-- these strings, but the DB ENUM was missing them — logAuditEvent's try/catch
-- silently swallowed the resulting INVALID_PARAMETER errors, leaving
-- pharmacy.created/switched/left events unlogged.
-- Source: surfaced during Task 6 verification of critical-security-1-4.

ALTER TYPE audit.event_type ADD VALUE IF NOT EXISTS 'pharmacy.created';
ALTER TYPE audit.event_type ADD VALUE IF NOT EXISTS 'pharmacy.switched';
ALTER TYPE audit.event_type ADD VALUE IF NOT EXISTS 'pharmacy.left';
