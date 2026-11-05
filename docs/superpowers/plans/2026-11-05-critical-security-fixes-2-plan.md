# Critical Security Fixes 2 — Implementation Plan

Spec: `docs/superpowers/specs/2026-11-05-critical-security-fixes-2-design.md`

## Order

1. **Fix 3 code first (TDD)** — write `src/__tests__/auth-invite.test.ts` (red), then swap `signupWithInvite` to `validate_invitation`/`accept_invitation` RPCs + reorder membership-before-profile (also reorder `signup`).
2. **Migrations** — `202611050000_profiles_privilege_guard.sql` + `202611050100_invitations_rls_lockdown.sql`; append both to `supabase/migrations/APPLY-ALL.sql`.
3. **Verify** — `tsc --noEmit`, `npm test`, commit.
4. **History purge** — filter-branch redaction of `rk_(live|test)_…` in `opencode.json` across `--all` → reflog expire → `gc --prune=now --aggressive` → verify grep empty → force-push main.
5. **Deploy** — `npx vercel --prod`.
6. **User actions** — revoke both Stripe keys (dashboard), run the two new migrations in the SQL editor, sandbox invite walkthrough.

## Files

- `src/lib/auth-actions.ts` — signupWithInvite RPC swap + both signup orderings
- `src/__tests__/auth-invite.test.ts` — new
- `supabase/migrations/202611050000_profiles_privilege_guard.sql` — new
- `supabase/migrations/202611050100_invitations_rls_lockdown.sql` — new
- `supabase/migrations/APPLY-ALL.sql` — append the two
- git history — rewrite + force-push

## Risks

- **Trigger vs. live RLS mismatch**: the pharmacy-membership guard assumes `pharmacy_members` inserts with the owner's JWT are permitted by live policy (they are today — the flows work). If migration application reveals otherwise, the trigger's membership check mirrors whatever policy shape exists.
- **Force-push**: rewrites ~35 SHAs on `main`. No forks (0), no open PRs, no Git-integration deploys → safe. Local `no-mistakes` bare remote keeps old history (local-only).
- **Acceptance before email confirmation**: `accept_invitation` granted to `anon` because Supabase may return no session when email confirmation is on.
