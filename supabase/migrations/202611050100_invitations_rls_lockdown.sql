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
-- Also drop our own policies so the whole APPLY-ALL paste is re-runnable.
DROP POLICY IF EXISTS invitations_select_members ON public.invitations;
DROP POLICY IF EXISTS invitations_insert_owner ON public.invitations;

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
