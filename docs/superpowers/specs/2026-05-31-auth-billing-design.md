# Auth + Billing Design Spec

## Summary

Add Supabase Auth + Stripe billing to gate the CDST behind organization subscriptions. Pharmacy organizations pay a flat monthly/yearly fee. Org admins manage billing and invite pharmacists. Pharmacists log in and use the tool. No cloud data storage — PDFs stay local.

## Stack

- **Frontend:** Next.js 16 on Vercel
- **Auth + DB:** Supabase (Postgres + Auth)
- **Billing:** Stripe (Checkout Sessions + Customer Portal + Webhooks)
- **Packages:** `@supabase/ssr`, `@supabase/supabase-js`, `stripe`

## User Roles

| Role | Capabilities |
|------|-------------|
| Org admin | Register org, subscribe via Stripe, invite pharmacists, manage subscription via Customer Portal, use CDST |
| Pharmacist | Accept invite, log in, use CDST (ailment grid + wizard) |

## Supabase Schema

### `organizations`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `default gen_random_uuid()` |
| name | text | Org display name |
| stripe_customer_id | text unique | Set after first checkout |
| stripe_subscription_id | text unique | Set after first checkout |
| subscription_status | text | `inactive`, `active`, `past_due`, `canceled`, `trialing` |
| created_at | timestamptz | `default now()` |

RLS enabled. Users can only see orgs they belong to via `org_members`.

### `org_members`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| org_id | uuid FK → organizations | `on delete cascade` |
| user_id | uuid FK → auth.users | `on delete cascade` |
| role | text | `admin` or `pharmacist` |
| created_at | timestamptz | |

Unique constraint on `(org_id, user_id)`. Indexes on `user_id` and `org_id`.

RLS: users see members in their orgs. Only admins can insert/delete members.

### Database trigger

On new user signup (via Supabase Auth), a trigger or server action creates the `organizations` row and `org_members` row with `role='admin'`.

## Auth Flow

### Registration (org admin)

1. Visit `/register`, enter email + password + org name
2. `supabase.auth.signUp()` creates user
3. Server action creates `organizations` + `org_members` rows
4. Redirect to Stripe Checkout (`mode: 'subscription'`)
5. On checkout success → redirect to `/dashboard`

### Invite pharmacist

1. Admin visits `/settings`, enters pharmacist email
2. Server action calls `supabase.auth.admin.inviteUserByEmail()`
3. Adds `org_members` row with `role='pharmacist'`
4. Pharmacist receives email, sets password, lands on `/dashboard`

### Login

1. `/login` with email + password
2. Middleware refreshes session via `@supabase/ssr` `createServerClient`
3. Middleware checks `org.subscription_status`
4. No session → redirect `/login`
5. Session but inactive subscription → redirect `/billing`

## Stripe Integration

### Checkout

- Server action creates `stripe.checkout.sessions.create` with `mode: 'subscription'`
- NO `payment_method_types` parameter (dynamic per Stripe best practice)
- `success_url` and `cancel_url` point back to app
- Uses restricted API key (RAK, `rk_` prefix), not secret key

### Webhook (`/api/stripe/webhook`)

Verifies webhook signature on every request. Handles:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Set `subscription_status = 'active'`, store `stripe_customer_id` and `stripe_subscription_id` |
| `customer.subscription.updated` | Sync `subscription_status` from Stripe to DB |
| `customer.subscription.deleted` | Set `subscription_status = 'inactive'` |
| `invoice.payment_failed` | Set `subscription_status = 'past_due'` |

### Customer Portal

- Admin clicks "Manage Subscription" → server action creates portal session via `stripe.billingPortal.sessions.create`
- Stripe hosts billing UI (cancel, update payment, download invoices)
- Return URL points back to `/settings`

## Next.js Middleware

`middleware.ts` runs on every request:

1. Create Supabase server client via `@supabase/ssr`
2. Refresh session, get user
3. If no user and route is protected → redirect `/login`
4. If user exists, query `org_members` + `organizations` for subscription status
5. If subscription inactive → redirect `/billing`
6. Allow request through

Protected routes: `/dashboard`, `/assess/*`, `/settings`, `/billing`
Public routes: `/login`, `/register`, `/api/stripe/webhook`

## UI Routes

| Route | Access | Purpose |
|-------|--------|---------|
| `/login` | Public | Email + password login |
| `/register` | Public | Email + password + org name signup |
| `/dashboard` | Auth + active sub | Current ailment grid (replaces `/`) |
| `/settings` | Auth + admin role | Org settings, invite pharmacists, Stripe portal link |
| `/billing` | Auth + admin role | Subscription status + Stripe portal redirect |
| `/assess/[ailment]` | Auth + active sub | Current wizard (unchanged) |
| `/` | Redirects | Logged in → `/dashboard`, not logged in → `/login` |

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_RESTRICTED_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
```

All secrets in Vercel environment variables, never in source code.

## Security

- Restricted API keys (RAKs) for Stripe, not secret keys
- Webhook signature verification on every request
- RLS enabled on all tables
- Service role key only used in server actions/API routes, never client-side
- No cloud data storage — assessments and PDFs stay local

## What Does NOT Change

- The ailment grid UI
- The 4-step wizard flow
- PDF generation (combined prescription + notification)
- Pharmacy settings (localStorage, optionally synced later)
- The data model (`Ailment`, `PatientInfo`, `SelectedRx`)
