# ADR 0001: Per-pharmacy billing

**Status:** Accepted — 2026-11-03
**Supersedes:** the Stripe org-billing model in `docs/superpowers/specs/2026-05-31-auth-billing-design.md` (never implemented) and the per-user tier semantics that shipped with `2026-06-14-critical-security-fixes-design.md`.

## Context

Three billing identities were in play at different times, none wired to money:

1. **May 2026 spec** — the *pharmacy org* subscribes (Stripe), admins manage, pharmacists ride along. Never built.
2. **June 2026 security fix** — `profiles.subscription_tier` (per-user) became the enforced source of truth for a pharmacy-ownership limit (`basic 1 / pro 5 / enterprise ∞`). Trigger-protected, service-role-only writes. No payment provider.
3. **Nov 2026 grilling** — user chose Polar.sh, sandbox-first, Pro-only, and — decisively — **pay-to-use**: no free tier; a pharmacy without an active subscription cannot use the tool at all.

Pay-to-use forces the question: whose subscription unlocks the tool?

## Decision

**The pharmacy is the subscriber.** Canonical tier = `pharmacies.subscription_tier`. One Pro subscription (CAD $25/mo flat, unlimited team members) unlocks the tool for that pharmacy's pharmacists. Lapse = whole pharmacy locks; data intact; resubscribe restores.

## Alternatives considered

- **Per-user** (`profiles.subscription_tier`, as shipped): a pharmacist pays personally; staff ride free; no organizational invoice — pharmacists typically expense to the pharmacy, so the pharmacy expects to be the payer and the invoice holder. Also made the ownership limit the entire product, which isn't what the user wanted ("only pro can use this at all").
- **Hybrid** (user buys seats for an org): needs seat metering, proration, and assignment UI — real complexity for zero v1 value with flat per-pharmacy pricing.

## Consequences

- **Middleware owns the gate.** `updateSession` checks the session user's pharmacy tier per request; clinical routes fail closed to `/settings/billing`.
- **Webhook writes are service-role only.** The June trigger pattern (1914/1915) is replicated for `pharmacies.subscription_tier` (`20261103_pharmacies_tier_protect.sql`); Polar events flow through `src/lib/supabase/admin.ts`.
- **Polar identity mapping:** checkout stamps `metadata.pharmacy_id` + `externalCustomerId` = owner's Supabase user id; webhook resolves the pharmacy from metadata first, owner-membership fallback second. No Polar IDs stored in the DB — the portal re-derives the customer from `external_id`.
- **`profiles.subscription_tier` and `pharmacies.seats` are vestigial.** Left in place (trigger-protected, harmless) to avoid destructive cleanup; do not read them for billing decisions.
- **Pharmacy creation stays free and unlimited; usage is the gated thing.** New pharmacies default to `subscription_status: 'inactive'` so they start locked.
- Reversing this later means re-pointing the middleware gate and re-parenting the webhook sync — contained, but it touches access control, hence the ADR.
