-- Migration: profiles_privilege_guard
-- Critical fix 2 (2026-11-05 audit): users_update_own_profile RLS lets the
-- row owner change EVERY column, including is_platform_admin (→ read every
-- pharmacy's audit log) and pharmacy_id (→ pivot into any pharmacy, e.g. a
-- subscribed one, bypassing the paywall). This trigger column-guards both:
-- is_platform_admin is service-role-managed, period; pharmacy_id is
-- user-settable only to a pharmacy where auth.uid() already holds an active
-- membership (service role exempt). All other columns remain user-editable.
-- Source: docs/superpowers/specs/2026-11-05-critical-security-fixes-2-design.md
-- NOTE: server actions now insert pharmacy_members BEFORE upserting profiles.

DROP TRIGGER IF EXISTS profiles_privilege_guard ON public.profiles;

CREATE OR REPLACE FUNCTION public.profiles_privilege_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  caller text;
BEGIN
  caller := COALESCE(NULLIF(current_setting('role', true), ''), current_user);

  -- is_platform_admin: never user-settable.
  IF TG_OP = 'INSERT' AND NEW.is_platform_admin IS TRUE
     AND caller NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'is_platform_admin can only be set by service_role';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
     AND caller NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'is_platform_admin can only be changed by service_role';
  END IF;

  -- pharmacy_id: user may point it only at a pharmacy of which they are an
  -- active member (server actions verify this before writing; the guard is
  -- the DB-level backstop).
  IF NEW.pharmacy_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR (TG_OP = 'UPDATE' AND NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id))
     AND caller NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.pharmacy_members m
      WHERE m.user_id = auth.uid()
        AND m.pharmacy_id = NEW.pharmacy_id
        AND m.is_active
    ) THEN
      RAISE EXCEPTION 'pharmacy_id can only be set to a pharmacy of which you are an active member';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_privilege_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_privilege_guard();
