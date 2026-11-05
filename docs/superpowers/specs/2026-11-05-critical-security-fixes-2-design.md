# Critical Security Fixes 2 Design (post-Polar audit)

## Goal

Close the three Critical findings from the 2026-11-04 security audit: (1) a **live Stripe restricted key** sitting in the public repo's git history, (2) authenticated users able to **self-promote to platform admin or point their profile at any pharmacy's id** through the unrestricted self-update RLS policy on `profiles`, and (3) **`invitations` readable by every authenticated user** via an always-true `token is not null` select policy.

## Scope

**In scope:** findings 1–3 only. High/Medium findings (rate limiting, `"use server"` on stores, audit-forgery, cookie-attribute regression, etc.) are parked for follow-up specs.

**Verified facts this spec rests on:**
- The repo (`xeonmobius/ontario-minor-ailments-cdst`) is **public on GitHub**, 0 forks.
- A live-mode Stripe restricted key (prefix `rk_live_…`, full value redacted here — see the audit, not this file) exists at commit `5303ba9` in `opencode.json`; an `rk_test_…` at `3512117`. No remote branch contains either commit — only local `main`'s history does.
- Vercel deploys are CLI-driven (no Git integration) — history rewrite has **no deploy impact**.
- `signupWithInvite` (`src/lib/auth-actions.ts:95`) reads `invitations` and updates `accepted_at` with the caller's JWT; `createInvitation` inserts with an owner JWT. The invite landing page only passes the token; it does not read the table.
- Both signup paths (`signup`, `signupWithInvite`) upsert `profiles` **before** inserting the `pharmacy_members` row — relevant to fix 2's trigger ordering.
- `switchPharmacy` verifies membership in the action **before** updating `profiles.pharmacy_id`.

**Not verifiable from here (flagged for the user):** live Supabase DDL/RLS. This spec writes idempotent migrations (`DROP POLICY IF EXISTS`) based on the documented policies in `docs/superpowers/plans/2026-06-06-auth-roles.md`.

## Fix 1 — Stripe key in public git history

**Revoke (user, dashboard):** disable both `rk_live_…` and `rk_test_…` in Stripe → API keys. Revocation is the actual security fix; history purge is hygiene.

**Purge (code):** `git filter-branch --tree-filter` redacting `rk_(live|test)_[A-Za-z0-9]+` in `opencode.json` across all commits → reflog expire + `git gc --prune=now` → force-push `main` (the only branch carrying dirty history). Local `no-mistakes` bare remote still holds old history — local-only, noted, not pushed.

## Fix 2 — `profiles` privilege guard (self-promotion + pharmacy pivot)

**Problem:** documented policy `users_update_own_profile … using (id = auth.uid())` lets the row owner change **every** column, including `is_platform_admin` and `pharmacy_id`. Chain: set `is_platform_admin=true` → `getAuditLog` returns all pharmacies' audit rows; set `pharmacy_id=<subscribed pharmacy>` → middleware tier gate unlocks the paid tool with no membership.

**Migration** (`202611050000_profiles_privilege_guard.sql`):
- `BEFORE INSERT OR UPDATE` trigger on `public.profiles`:
  - `is_platform_admin`: any set-to-true (insert) or change (update) requires `service_role`/`postgres`/`supabase_admin`. Demote-by-self is also blocked (changes require service role).
  - `pharmacy_id`: user-settable **only** to a pharmacy where `auth.uid()` holds an active `pharmacy_members` row (insert: non-null `pharmacy_id` must satisfy the same check). Service role exempt.
  - All other columns untouched (name, email, license remain user-editable).
- Trigger body runs with `SET search_path = ''`, referencing `public.`/`auth.` explicitly.

**Code reorder (required by the trigger):** `signup` and `signupWithInvite` must insert the `pharmacy_members` row **before** the `profiles` upsert (membership must exist when the guard validates `pharmacy_id`). `switchPharmacy` already verifies membership first — unchanged.

## Fix 3 — `invitations` RLS lockdown + token RPCs

**Problem:** documented `anyone_accept_invite … using (token is not null)` is vacuously true: any authenticated user can `SELECT *` the whole table (other pharmacies' invitee emails, ids, unaccepted tokens).

**Migration** (`202611050100_invitations_rls_lockdown.sql`):
- Drop `anyone_accept_invite` + `owners_manage_invitations` (`IF EXISTS` — names per the June docs).
- New policies:
  - `SELECT` → active members of the invitation's pharmacy.
  - `INSERT` → active **owners** of the pharmacy (`WITH CHECK` membership).
  - No user-role `UPDATE`/`DELETE` — acceptance moves to an RPC.
- Two `SECURITY DEFINER` functions (`SET search_path = ''`, execute granted to `anon` + `authenticated` — acceptance happens before email confirmation when no session exists):
  - `validate_invitation(p_token)` → single row `(pharmacy_id, email, expires_at, accepted_at)` or empty.
  - `accept_invitation(p_token, p_email)` → status text: `accepted | invalid | used | expired | email_mismatch` (does the same checks the action did, atomically at the DB).

**Code:** `signupWithInvite` swaps its direct table read for `rpc("validate_invitation")` and its `accepted_at` update for `rpc("accept_invitation")`.

## TDD Applicability

| Change | TDD? | Rationale |
|--------|------|-----------|
| `signupWithInvite` RPC swap | **Yes** | New test file mocking `createClient` with `rpc()` support: invalid/expired/mismatch paths, success path asserts membership insert precedes profile upsert and `accept_invitation` was called. |
| Signup reorder | No direct test (no existing suite covers `signup`; reorder is order-only, guarded in production by the trigger). |
| Migrations | Config-style — verified live by querying `information_schema`/policy catalog after manual application (user runs APPLY block). |
| History purge | Verified by post-rewrite grep across all objects + force-push. |

## Verification

1. `npx tsc --noEmit`, `npm test` — new invite tests green, existing 284+ green.
2. Post-purge: `git grep rk_live $(git rev-list --all)` empty; force-push accepted.
3. Deploy (`npx vercel --prod`); invite-accept walkthrough in sandbox (create invite → accept → member lands in pharmacy, invitation marked accepted).
4. User: run the two new migrations (appended to `APPLY-ALL.sql`) + revoke the Stripe keys in the dashboard.
