# Polar Billing Design

## Goal

Wire polar.sh subscriptions into the CDST so the tool becomes pay-to-use: a pharmacy subscribes to **Pro** (CAD $25/month) and its pharmacists get access; no subscription means locked out. Polar replaces the Stripe design from `2026-05-31-auth-billing-design.md` (never implemented) and supersedes the per-user tier that shipped with the June security fixes. The billing-entity decision is recorded in [ADR 0001](../../../docs/adr/0001-per-pharmacy-billing.md).

## Decided model (grilling session, 2026-11-03)

| Decision | Value |
|----------|-------|
| Billing entity | **Per pharmacy** (`pharmacies.subscription_tier` is canonical; ADR 0001) |
| Pay model | **Pay-to-use** — `basic` = no subscription = locked; `pro` = usable |
| Provider | Polar, **sandbox first** (`POLAR_SANDBOX=true`), production later = swap env values |
| Product | One Pro product, **CAD $25/month flat**, monthly only, no trial |
| Feature gating | **None** — Pro gates tool access, not features (e-signature/consent stay flag-gated, not tier-gated) |
| Lapse | `subscription.canceled` → no-op (access until period end); `subscription.revoked` → tier `basic` → **hard lock**, data intact, resubscribe restores |
| Enterprise | Manual DB edit via service-role, no self-serve path |
| Billing actions | Owner-only (checkout, portal). Staff see tier read-only |

### ⚠️ VETOABLE defaults (recommended, user did not answer in grilling)

1. **Flat price, unlimited members** — $25 buys the whole pharmacy team; no seat counting, no invite gating.
2. **Lockout scope** — middleware redirects non-pro to `/billing` for everything except: `/billing`, `/settings/billing`, `/login`, `/signup`, `/auth/*`, `/invite/*`, `/api/*`. Profile and pharmacy-info settings stay usable; team page requires pro.
3. **Hard lock on lapse** — no read-only grace window.
4. **ADR + GLOSSARY written** alongside this spec.

## Scope

**In scope:** Polar checkout + webhook sync + customer portal + billing settings page + middleware paywall + `pharmacies.subscription_tier` protection migration + `addPharmacy` default fix.

**Out of scope:** seat metering, yearly pricing, trials, tax/invoice customization, dunning emails (Polar handles), migrating the dormant fly.io PHI stores, deleting `profiles.subscription_tier` / `pharmacies.seats` (left vestigial).

## TDD Applicability

| Component | TDD? | Rationale |
|-----------|------|-----------|
| `sync-subscription.ts` | **Yes** | Pure-ish function over the admin client. Mock it like `pharmacy-actions.test.ts` does. Cases: active/updated + product match → `pro`; revoked → `basic`; canceled/uncanceled/past_due → no-op; unknown product → no-op; pharmacy resolution via `metadata.pharmacy_id`; fallback via `external_customer_id` → owner profile → owned pharmacy; unresolved → no-op. |
| Middleware gate | **Yes** | `updateSession` gets a subscription branch: non-pro + protected path → redirect `/billing`; pro → pass-through; exempt paths pass. Mock `createServerClient` + one profiles/pharmacies query. |
| `addPharmacy` default | **Yes** | Extend `pharmacy-actions.test.ts`: insert payload must carry `subscription_status: "inactive"`. |
| Webhook route signature verify | No | Owned by `@polar-sh/nextjs`. Verified manually via `polar webhook trigger` against a listening dev server. |
| Checkout / portal routes | No | Thin wrappers over SDK calls needing real sandbox creds. Verified in the sandbox walkthrough. |

## Design

### Data layer

**Migration `supabase/migrations/20261103_pharmacies_tier_protect.sql`** — copy of the June trigger pattern (`202606141914/1915`) aimed at `pharmacies.subscription_tier`:

- `CHECK (subscription_tier IN ('basic','pro','enterprise'))`
- `BEFORE UPDATE OF subscription_tier ON pharmacies` trigger: raises unless `current_setting('role')` is in `('postgres','supabase_admin','service_role')`
- `DROP TRIGGER IF EXISTS` + `CREATE` for idempotency
- Prerequisite: **migrations 1914–1916 must also be applied** (still unconfirmed from June — verify in Supabase dashboard first).

**`addPharmacy` fix** (`src/lib/pharmacy-actions.ts`): new pharmacies insert `subscription_status: "inactive"` (currently hardcoded `"active"` — would silently bypass the paywall). `subscription_tier: "basic"` stays. Remove the per-user `TIER_LIMITS` check + `profiles.subscription_tier` read from `addPharmacy` (meaningless under per-pharmacy billing; pharmacy creation is free — the *usage* is what's gated). `TIER_LIMITS` constant deleted.

### Polar plumbing

**`src/lib/supabase/admin.ts`** (new) — service-role client for the webhook only:

```ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
```

No cookie persistence (webhooks have no session). Never imported from client code.

**`src/lib/polar/sync-subscription.ts`** (new) — the single place Polar events touch the DB:

```ts
type PolarSubData = {
  product_id?: string
  metadata?: Record<string, string>
  customer?: { external_id?: string | null }
}
type AdminClient = ReturnType<typeof createAdminClient>

export async function syncSubscription(
  admin: AdminClient,
  eventType: string,          // "subscription.active" | ".updated" | ".canceled" | ".revoked" | ...
  data: PolarSubData,
): Promise<"pro" | "basic" | "noop">
```

- `subscription.active` | `subscription.updated` + `data.product_id === POLAR_PRODUCT_PRO_ID` → tier `pro` (on `subscription.updated`, only upgrade: never downgrade `pro` → anything on a mere update)
- `subscription.revoked` → tier `basic`
- everything else (`canceled`, `uncanceled`, `past_due`, `cycled`, …) → no-op
- Pharmacy resolution, in order: (1) `data.metadata.pharmacy_id`; (2) `data.customer.external_id` → `profiles.id` → their **owned** pharmacy via `pharmacy_members` (role `owner`, `is_active`) — a fallback for checkouts where metadata was lost; (3) unresolved → no-op
- Unknown product → no-op (future enterprise/other products won't clobber pro rows)
- Write goes through the admin client only — the DB trigger rejects anything else.

**`src/app/api/webhooks/polar/route.ts`** (new) — the `Webhooks` adapter handles signature verification (`webhook-id`/`webhook-timestamp`/`webhook-signature` headers; 403 on bad signature):

```ts
import { Webhooks } from "@polar-sh/nextjs"
import { createAdminClient } from "@/lib/supabase/admin"
import { syncSubscription } from "@/lib/polar/sync-subscription"

export const POST = Webhooks({
  webhookSecret: process.env.POLAR_WEBHOOK_SECRET!,
  onPayload: async (payload) => {
    await syncSubscription(
      createAdminClient(),
      payload.type,
      payload.data as never,
    )
  },
})
```

`/api/*` is already exempt from the auth middleware (`src/lib/supabase/proxy.ts`), and the webhook secret is the route's own authz.

**`src/app/api/polar/checkout/route.ts`** (new, GET) — server-side checkout creation; nothing client-supplied except which pharmacy (validated against the session):

- Auth via `createRouteHandlerClient()`; unauthenticated → 401
- `pharmacy_id` query param must match an **owner** membership of the session user (or default to their active pharmacy) → prevents subscribing someone else's pharmacy
- SDK: `createPolar({ accessToken }).checkouts.create({ products: [POLAR_PRODUCT_PRO_ID], successUrl: ${SITE_URL}/settings/billing, externalCustomerId: user.id, customerEmail: user.email, metadata: { pharmacy_id }, ...(sandbox) })` → 302 redirect to `checkout.url`
- Missing env (`POLAR_ACCESS_TOKEN` / `POLAR_PRODUCT_PRO_ID`) → 503 with message

**`src/app/api/polar/portal/route.ts`** (new, GET) — `CustomerPortal({ accessToken, getExternalCustomerId: async () => session user id, customerSession: { enabled: true }, ...(sandbox) })`. 400 when the caller isn't authenticated (the helper's documented empty-id behavior covers it).

**Sandbox switch:** when `POLAR_SANDBOX=true`, both SDK client and adapter helpers get `server: "sandbox"` (checkout + portal) / `environment: "sandbox"`. One helper, `polarEnvConfig()`, in `src/lib/polar/config.ts` so checkout, portal, and webhooks can't drift.

### UI

**`src/app/settings/billing/page.tsx`** (new, Pattern A: server page + client child) — `requireAuth()`; fetch `profiles.pharmacy_id` → pharmacy row (`name`, `subscription_tier`, `subscription_status`) + caller's `pharmacy_members.role`:

- Owner + `basic` → **Upgrade to Pro** card (price line, CAD $25/mo) → link `/api/polar/checkout`
- Owner + `pro` → **Manage subscription** → `/api/polar/portal` (cancel, update card, invoices — Polar-hosted)
- Staff → tier badge, read-only, no actions
- Locked state banner if `subscription_status === 'inactive'` / tier `basic`

The existing `/billing`-equivalent paywall page for middleware redirects: reuse this page — exempt-list the settings billing route and point the middleware redirect at `/settings/billing`. (No separate top-level `/billing` route; one page, one source of truth.)

### Middleware paywall

**`src/lib/supabase/proxy.ts`** — extend `updateSession` after the existing auth check:

- If user authenticated and path not exempt (`/login`, `/signup`, `/auth`, `/invite/`, `/api`, `/settings/billing`, `/settings/profile`, `/settings/pharmacy`, `/settings/password`): fetch `profiles.pharmacy_id` + that pharmacy's `subscription_tier` (one query, two joins) → tier ≠ `pro` → `NextResponse.redirect("/settings/billing")`
- No pharmacy profile → redirect `/settings/pharmacy` (existing behavior assumes one)
- Errors fail **closed** (redirect to billing) — fail safe per PRODUCT.md, but never block when tier IS pro

Tests mock the client chain the way `audit-actions.test.ts` does.

### Env

`.env.local` additions (names; values user-supplied from Polar sandbox + Supabase dashboard):

```
POLAR_ACCESS_TOKEN=            # Polar sandbox org access token
POLAR_WEBHOOK_SECRET=          # webhook endpoint signing secret
POLAR_PRODUCT_PRO_ID=          # Pro monthly product ID
POLAR_SANDBOX=true             # false → production
SUPABASE_SERVICE_ROLE_KEY=     # Supabase → API keys (server-only; NEVER NEXT_PUBLIC_)
NEXT_PUBLIC_SITE_URL=          # e.g. http://localhost:3000 (already referenced by reset-password)
```

`.env.example` created with the same names + comments, no values.

### Dependencies

`@polar-sh/sdk` (API-version-pinned import), `@polar-sh/nextjs`.

## Verification

1. `npx tsc --noEmit`, `npm run lint`, `npm test` — new suites green, existing 263 green.
2. **Prereq (user, Supabase dashboard/SQL editor):** apply migrations 1914, 1915, 1916, then `20261103_pharmacies_tier_protect.sql`.
3. Sandbox end-to-end: `npm run dev`; `polar auth login --sandbox`; `polar webhook listen http://localhost:3000/api/webhooks/polar`; `polar webhook trigger subscription.created` → `pharmacies.subscription_tier = 'pro'` in Supabase; app unlock.
4. UI walkthrough: locked pharmacy → redirect to `/settings/billing` → Upgrade → Polar sandbox checkout (test card) → back on billing page as Pro → clinical routes reachable; invite team.
5. Lapse: `polar webhook trigger subscription.revoked` → next navigation redirects to billing; tier back to `basic`; data intact.
6. Negative: bad-signature POST → 403; unknown product event → no-op; staff account → no upgrade CTA.
