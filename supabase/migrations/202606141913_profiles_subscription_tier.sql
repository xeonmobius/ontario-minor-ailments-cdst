-- Migration: profiles_subscription_tier
-- Adds per-user plan tier column. Applied via Supabase MCP on 2026-06-14.
-- Source: docs/superpowers/specs/2026-06-14-critical-security-fixes-design.md

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'basic';

COMMENT ON COLUMN public.profiles.subscription_tier IS
  'Per-user plan tier: basic | pro | enterprise. Source of truth for seat limits. Set via service-role only.';

REVOKE UPDATE (subscription_tier) ON public.profiles FROM authenticated, anon;
