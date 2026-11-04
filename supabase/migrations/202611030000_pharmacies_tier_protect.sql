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
