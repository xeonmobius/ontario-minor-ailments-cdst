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

-- ================================================================
-- 2026-11-05 critical security fixes 2 (audit findings 2 + 3)
-- ================================================================

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

-- Migration: invitations_rls_lockdown
-- Critical fix 3 (2026-11-05 audit): the documented anyone_accept_invite
-- SELECT policy (`using (token is not null)`) is vacuously true — every
-- authenticated user could read ALL invitations: other pharmacies' invitee
-- emails, pharmacy ids, and live unaccepted tokens.
-- New model: members read their own pharmacy's invitations, owners create
-- them, and NOBODY updates them — acceptance moves to accept_invitation(),
-- validation to validate_invitation(). Both are SECURITY DEFINER and narrow;
-- accept is granted to anon because Supabase may return no session when
-- email confirmation is enabled (acceptance happens pre-confirmation).
-- Source: docs/superpowers/specs/2026-11-05-critical-security-fixes-2-design.md

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anyone_accept_invite ON public.invitations;
DROP POLICY IF EXISTS owners_manage_invitations ON public.invitations;

CREATE POLICY invitations_select_members ON public.invitations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pharmacy_members pm
    WHERE pm.pharmacy_id = invitations.pharmacy_id
      AND pm.user_id = auth.uid()
      AND pm.is_active
  ));

CREATE POLICY invitations_insert_owner ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.pharmacy_members pm
    WHERE pm.pharmacy_id = invitations.pharmacy_id
      AND pm.user_id = auth.uid()
      AND pm.is_active
      AND pm.role = 'owner'
  ));

-- No UPDATE or DELETE policies for user roles: revocation/cancellation of
-- invitations is out of scope and defaults to denied.

CREATE OR REPLACE FUNCTION public.validate_invitation(p_token text)
RETURNS TABLE (pharmacy_id uuid, email text, expires_at timestamptz, accepted_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT i.pharmacy_id, i.email, i.expires_at, i.accepted_at
  FROM public.invitations i
  WHERE i.token = p_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inv public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM public.invitations WHERE token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'invalid';
  END IF;
  IF inv.accepted_at IS NOT NULL THEN
    RETURN 'used';
  END IF;
  IF inv.expires_at < now() THEN
    RETURN 'expired';
  END IF;
  IF lower(inv.email) <> lower(p_email) THEN
    RETURN 'email_mismatch';
  END IF;
  UPDATE public.invitations SET accepted_at = now() WHERE token = p_token;
  RETURN 'accepted';
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_invitation(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invitation(text, text) TO anon, authenticated;
