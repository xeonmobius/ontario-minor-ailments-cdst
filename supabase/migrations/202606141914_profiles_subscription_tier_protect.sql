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
