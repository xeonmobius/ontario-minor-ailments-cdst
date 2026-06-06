# Auth & User Roles Design

## Context

CDST is a Next.js 16 Clinical Decision Support Tool for Ontario community pharmacists. Currently has no auth — pharmacy defaults stored in localStorage. Adding Supabase Auth with role-based access, multi-tenant pharmacy orgs, and subscription-ready schema.

## Decisions

- **3 roles**: `owner`, `pharmacist`, `platform_admin`
- **1 pharmacy = 1 org** (no multi-location)
- **Email/password** auth with email confirmation
- **Email invite** flow for adding pharmacists
- **Server-side only** — pharmacy defaults move from localStorage to Supabase
- **Assessments** remain client-side (no storage)
- **Subscription schema** included but no billing integration yet

## Database Schema

### `pharmacies`

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | `gen_random_uuid()` | PK |
| name | text | | Pharmacy name |
| address | text | | |
| city | text | | |
| province | text | | |
| postal_code | text | | |
| phone | text | | |
| fax | text | | |
| created_by | uuid FK → auth.users.id | | Owner who created it |
| subscription_status | text | `'active'` | `active`, `past_due`, `canceled`, `trialing` |
| subscription_tier | text | `'free'` | `free`, `pro`, `enterprise` |
| seats | int | `3` | Max pharmacists |
| stripe_customer_id | text nullable | | Future billing |
| created_at | timestamptz | `now()` | |

### `profiles`

1:1 with `auth.users`.

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid FK → auth.users.id | | PK |
| pharmacy_id | uuid FK → pharmacies.id nullable | | Null during invite flow |
| role | text | | `owner`, `pharmacist`, `platform_admin` |
| full_name | text | | |
| email | text | | Denormalized from auth |
| province | text nullable | | Licensing province |
| provincial_license | text nullable | | Pharmacist-specific |
| registration_number | text nullable | | Pharmacist-specific |
| created_at | timestamptz | `now()` | |

### `invitations`

| Column | Type | Default | Notes |
|---|---|---|---|
| id | uuid | `gen_random_uuid()` | PK |
| pharmacy_id | uuid FK → pharmacies.id | | Which pharmacy |
| email | text | | Invitee email |
| role | text | `'pharmacist'` | Role they get |
| token | text unique | | One-time invite token |
| accepted_at | timestamptz nullable | | Filled on acceptance |
| expires_at | timestamptz | | 7 days from creation |
| created_by | uuid FK → auth.users.id | | Who sent it |
| created_at | timestamptz | `now()` | |

## Auth Flows

### Owner Signup

1. `/signup` — email, password, full name, pharmacy details
2. `supabase.auth.signUp()` creates `auth.users`
3. Trigger creates `profiles` row (`role = 'owner'`, `pharmacy_id = null`)
4. Trigger creates `pharmacies` row from form data
5. `profiles.pharmacy_id` set to new pharmacy id
6. Email confirmation sent → user clicks → redirected to dashboard

### Pharmacist Invite

1. Owner enters email in team settings
2. `invitations` row created with token, `expires_at = now() + 7d`
3. Email sent with link `/invite/{token}`
4. Pharmacist clicks → signup form (email, password, name, provincial license)
5. `signUp()` creates account
6. Trigger creates `profiles` row, matches `invitations` by email (not accepted)
7. Sets `profiles.role = 'pharmacist'`, `profiles.pharmacy_id = invitations.pharmacy_id`
8. Marks `invitations.accepted_at = now()`

### Login

1. `/login` — email + password via `signInWithPassword()`
2. Redirect to `/` on success

### Logout

1. `signOut()` → clear session → redirect to `/login`

## Session Handling

- `@supabase/ssr` for cookie-based sessions (Next.js App Router)
- `middleware.ts` refreshes tokens, protects routes
- `createClient()` for server components, `createBrowserClient()` for client components

## Route Protection

| Path | Access |
|---|---|
| `/login`, `/signup` | Unauthenticated only |
| `/invite/*` | Unauthenticated (valid token) |
| `/` and app routes | Authenticated |
| `/admin/*` | `platform_admin` only |

## RLS Policies

| Table | Owner | Pharmacist | Platform Admin |
|---|---|---|---|
| pharmacies | Read/Write own | Read own | Read/Write all |
| profiles | Read own pharmacy, edit own row | Read own pharmacy, edit own row | Read/Write all |
| invitations | CRUD own pharmacy | No access | Read all |

- UPDATE policies include both `USING` and `WITH CHECK`
- `TO authenticated` combined with ownership predicates (not used alone)
- No `auth.role()` (deprecated) — use `TO` clause

## Database Functions

- `handle_new_user()` — trigger on `auth.users` insert, creates `profiles` row. `SECURITY DEFINER` in non-exposed schema with `auth.uid()` check
- `accept_invitation(p_token text)` — validates token, links profile to pharmacy, marks accepted. `SECURITY INVOKER`

## UI Pages

### New

| Route | Who |
|---|---|
| `/login` | Unauthenticated |
| `/signup` | Unauthenticated |
| `/invite/[token]` | Unauthenticated (valid token) |
| `/settings/pharmacy` | Owner only |
| `/settings/team` | Owner only |
| `/settings/profile` | All authenticated |
| `/admin` | Platform admin only |

### Modified

- `/` — Fetch pharmacy defaults from Supabase instead of localStorage
- `/assess/[ailment]` — Pharmacy defaults from Supabase session context
- `pharmacy-settings.tsx` — Reads/writes `pharmacies` table via Supabase, owner-only editing

### Navigation

- Avatar/profile dropdown in top-right
- Options: Profile, Pharmacy Settings (owner), Team (owner), Sign Out

## localStorage Migration

No migration. Owner fills pharmacy details at signup. Pharmacists inherit from org. Old localStorage ignored.

## Supabase Auth Settings

- Email/password provider enabled
- Anonymous sign-ins disabled
- Email confirmation required
- Redirect URLs configured for dev and prod

## Packages to Install

- `@supabase/supabase-js`
- `@supabase/ssr`
