-- APPLY-ALL: paste this whole file into the Supabase SQL Editor and run once.
-- Idempotent: every statement is IF NOT EXISTS / DROP-then-CREATE, safe to re-run.
-- Order: June 1914/1915 (profiles tier trigger), 1916 (audit ENUM), Nov 2026 (pharmacies tier trigger).
-- (1913 profiles.subscription_tier column: already applied 2026-06-14 per its header.)

-- Migration: profiles_subscription_tier_protect
-- Prevents non-privileged roles from updating profiles.subscription_tier.
-- The column-level REVOKE in the previous migration is ineffective because
-- profiles has a table-level UPDATE grant to authenticated/anon (Supabase default).
-- This trigger closes the hole at the DB layer.
-- Source: docs/superpowers/specs/2026-06-14-critical-security-fixes-design.md

CREATE OR REPLACE FUNCTION public.protect_subscription_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_role        name := COALESCE(NULLIF(current_setting('role', true), ''), current_user);
  v_allowed     boolean;
BEGIN
  SELECT v_role IN ('postgres', 'supabase_admin', 'service_role') INTO v_allowed;
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier AND NOT v_allowed THEN
    RAISE EXCEPTION 'subscription_tier can only be changed by service_role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_protect_subscription_tier
  BEFORE UPDATE OF subscription_tier ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_subscription_tier();

-- Migration: profiles_subscription_tier_harden
-- Adds CHECK constraint on subscription_tier and makes the protective trigger
-- idempotent (DROP IF EXISTS before CREATE). Also simplifies the trigger
-- function body (inlined condition).
-- Note: the column-level REVOKE in migration 1913 is inert — the table-level
-- UPDATE grant to authenticated/anon (Supabase default) supersedes it.
-- The trigger in migration 1914 (and recreated here) is the actual protection.
-- Source: docs/superpowers/specs/2026-06-14-critical-security-fixes-design.md

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('basic', 'pro', 'enterprise'));

DROP TRIGGER IF EXISTS profiles_protect_subscription_tier ON public.profiles;

CREATE OR REPLACE FUNCTION public.protect_subscription_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     AND COALESCE(NULLIF(current_setting('role', true), ''), current_user)
         NOT IN ('postgres', 'supabase_admin', 'service_role')
  THEN
    RAISE EXCEPTION 'subscription_tier can only be changed by service_role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_protect_subscription_tier
  BEFORE UPDATE OF subscription_tier ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_subscription_tier();

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

-- Migration: pharmacies_tier_protect
-- Same protection June's 1914/1915 gave profiles.subscription_tier, aimed at
-- pharmacies.subscription_tier — now the canonical billing tier (per-pharmacy,
-- pay-to-use; see docs/adr/0001-per-pharmacy-billing.md). CHECK constraint +
-- service-role-only trigger, idempotent. The Polar webhook sync writes through
-- src/lib/supabase/admin.ts (service role); every other role is rejected.
-- Source: docs/superpowers/specs/2026-11-03-polar-billing-design.md

ALTER TABLE public.pharmacies
  DROP CONSTRAINT IF EXISTS pharmacies_subscription_tier_check;
ALTER TABLE public.pharmacies
  ADD CONSTRAINT pharmacies_subscription_tier_check
  CHECK (subscription_tier IN ('basic', 'pro', 'enterprise'));

DROP TRIGGER IF EXISTS pharmacies_protect_subscription_tier ON public.pharmacies;

CREATE OR REPLACE FUNCTION public.protect_pharmacies_subscription_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier
     AND COALESCE(NULLIF(current_setting('role', true), ''), current_user)
         NOT IN ('postgres', 'supabase_admin', 'service_role')
  THEN
    RAISE EXCEPTION 'subscription_tier can only be changed by service_role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pharmacies_protect_subscription_tier
  BEFORE UPDATE OF subscription_tier ON public.pharmacies
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_pharmacies_subscription_tier();
