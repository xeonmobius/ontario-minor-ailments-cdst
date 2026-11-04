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
