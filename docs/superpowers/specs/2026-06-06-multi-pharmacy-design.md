# Multi-Pharmacy Support Spec

## Problem

A pharmacist or owner can work at multiple pharmacies. Currently, `profiles.pharmacy_id` links a user to exactly one pharmacy. A pharmacist who works at both Pharmacy A and Pharmacy B needs access to both — but must never accidentally mix data between them (PHI exposure risk).

An owner can also be a pharmacist at another pharmacy (different role per pharmacy).

Platform admins need cross-pharmacy access without being tied to one.

## Data Model

### profiles (modified)

- **Remove** `role` column
- **Add** `is_platform_admin` boolean NOT NULL DEFAULT false
- **Keep** `pharmacy_id` uuid nullable — represents the user's **active pharmacy**
- All other columns unchanged

### pharmacy_members (new table)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, DEFAULT gen_random_uuid() | |
| user_id | uuid | NOT NULL, FK → profiles.id ON DELETE CASCADE | |
| pharmacy_id | uuid | NOT NULL, FK → pharmacies.id ON DELETE CASCADE | |
| role | text | NOT NULL, CHECK (role IN ('owner', 'pharmacist')) | Role at THIS pharmacy |
| is_active | boolean | NOT NULL DEFAULT true | Soft toggle |
| created_at | timestamptz | NOT NULL DEFAULT now() | |
| | | UNIQUE(user_id, pharmacy_id) | One membership per user-pharmacy pair |

### pharmacies (unchanged)

No schema changes. `subscription_tier` will determine pharmacy count limits in app code.

### Role Resolution

| User type | How determined |
|-----------|---------------|
| Platform admin | `profiles.is_platform_admin = true` |
| Owner at active pharmacy | `pharmacy_members.role = 'owner'` WHERE user_id = current AND pharmacy_id = active |
| Pharmacist at active pharmacy | `pharmacy_members.role = 'pharmacist'` WHERE user_id = current AND pharmacy_id = active |

A user's role depends on which pharmacy they're currently in. Alice can be owner at Pharmacy A and pharmacist at Pharmacy B.

## Pharmacy Context Safety

### The core risk

A pharmacist working at two pharmacies could accidentally run an assessment under the wrong pharmacy, resulting in:
- Prescription PDF showing wrong pharmacy info
- Fax sent to wrong doctor from wrong pharmacy
- PHI exposed to wrong pharmacy's records

### Safety mechanisms

1. **Explicit selection at login** — If user has multiple pharmacies, show a full-screen pharmacy picker before dashboard access. User must deliberately choose which pharmacy they're working at.

2. **Switching requires confirmation** — "Switch Pharmacy" button opens a modal listing pharmacies. User must click a pharmacy and confirm via dialog: "Switch from [Pharmacy A] to [Pharmacy B]? Any unsaved work will be lost." Only then does `profiles.pharmacy_id` update and page reload.

3. **Prominent visual indicator** — Active pharmacy name always visible in the header as a colored badge/banner. Impossible to forget which pharmacy context you're in.

4. **Assessment pharmacy lock (hard)** — When an assessment starts, the "Switch Pharmacy" button is completely disabled (hidden/greyed out) for the entire duration. The pharmacist must finish or abandon the assessment before switching. The `pharmacy_id` is captured at assessment start and used for all PDFs and records. Leaving the assessment page loses all in-progress state (no persistence).

5. **RLS enforcement** — Every pharmacy-scoped table (assessments, prescriptions, audit logs) has RLS policies that check `pharmacy_members` membership. Even if app code has a bug, the database prevents cross-pharmacy data access.

6. **No passive switcher** — No dropdown that changes context on click. Every pharmacy change is a deliberate, confirmed action with a page reload.

## User Flows

### Signup (owner creates first pharmacy)

1. Owner signs up with email/password
2. Fills in pharmacy details (name, address, etc.)
3. System creates:
   - `auth.users` row
   - `profiles` row (pharmacy_id = new pharmacy, is_platform_admin = false)
   - `pharmacies` row
   - `pharmacy_members` row (user_id, pharmacy_id, role = 'owner')
4. Redirect to dashboard (only one pharmacy, no picker needed)

### Invite acceptance

1. Owner invites pharmacist (scoped to owner's currently active pharmacy)
2. Pharmacist receives invite link
3. On accept:
   - `auth.users` created (if new) or existing user found
   - `pharmacy_members` row inserted (user_id, pharmacy_id, role = 'pharmacist')
   - `profiles.pharmacy_id` updated to inviting pharmacy ONLY if user has no current pharmacy (pharmacy_id IS NULL)
   - If user already has an active pharmacy, their `pharmacy_id` stays unchanged — no context disruption
4. If pharmacist already belongs to other pharmacies, they now have multiple memberships
5. On next login, they'll see the pharmacy picker (no pre-selection)

### Login with multiple pharmacies

1. User logs in
2. App checks: `SELECT COUNT(*) FROM pharmacy_members WHERE user_id = $1 AND is_active = true`
3. If count = 1: skip picker, set that pharmacy as active, go to dashboard
3. If count > 1: show full-screen pharmacy picker with NO pre-selection. User must deliberately choose every time they log in, even if they used Pharmacy A last session. This prevents autopilot errors for pharmacists working multiple locations.
4. User selects pharmacy → `UPDATE profiles SET pharmacy_id = $1 WHERE id = $2` → redirect to dashboard

### Switching pharmacies

1. User clicks "Switch Pharmacy" in header
2. Modal opens showing list of their pharmacies
3. User clicks a different pharmacy
4. Confirmation dialog appears
5. On confirm: `UPDATE profiles SET pharmacy_id = $1` → page reload
6. Active pharmacy badge updates

### Adding a pharmacy (owner)

1. Owner clicks "Add Pharmacy" on pharmacy settings page
2. App checks tier limit: `SELECT COUNT(*) FROM pharmacy_members WHERE user_id = $1 AND role = 'owner'` vs allowed limit
3. If at limit: show upgrade message ("Your plan allows X pharmacies. Upgrade to add more.")
4. If under limit: show form (name, address, city, province, postal, phone, fax, accreditation number)
5. On submit:
   - INSERT into `pharmacies`
   - INSERT into `pharmacy_members` (user_id, new_pharmacy_id, role = 'owner')
   - UPDATE `profiles SET pharmacy_id = new_pharmacy_id` (auto-switch)
6. Page reloads in new pharmacy context

### Assessment with pharmacy lock

1. Pharmacist starts assessment at Pharmacy A
2. Assessment captures `pharmacy_id = A` at creation time
3. "Switch Pharmacy" button is completely disabled for the entire assessment duration (hard lock)
4. If pharmacist leaves the assessment page, all in-progress state is lost (no persistence). They start fresh if they return.
5. Prescription/referral PDF always uses Pharmacy A's details
6. Assessment record stored with `pharmacy_id = A`

### Leaving a pharmacy

Both pharmacist and owner can remove a membership:
- **Pharmacist self-removal**: Settings page has a "Leave Pharmacy" option. Sets `is_active = false` on their membership (soft delete for audit history).
- **Owner removal**: Team management page can remove members. Sets `is_active = false`.
- If pharmacist is removed from their ONLY pharmacy: `profiles.pharmacy_id` set to NULL. On next load, redirected to "awaiting assignment" state — account exists but no pharmacy context.
- If pharmacist is removed from their ACTIVE pharmacy but has others: force redirect to pharmacy picker.
- Owner cannot leave their own pharmacy if they are the only owner (must transfer ownership first — out of scope for now).

### Privacy between pharmacies

- Owners can only see members of their own pharmacies (RLS enforces this)
- A pharmacist's memberships at other pharmacies are private
- No cross-pharmacy visibility of any data

## Pharmacy Tier Limits (Plan-Based Billing)

Tier limits defined in app code (not in database):

| Tier | Max pharmacies (owner) |
|------|----------------------|
| basic | 1 |
| pro | 5 |
| enterprise | Unlimited |

Enforced at "Add Pharmacy" time by counting `pharmacy_members WHERE role = 'owner'`.

Future: integrate with Stripe for billing. For now, tier is stored on `pharmacies.subscription_tier` and checked in app code.

## RLS Policies

### pharmacy_members

```sql
-- Users can see their own memberships
CREATE POLICY "members_read_own" ON pharmacy_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Users can NOT insert/update/delete memberships directly (done via server actions)
```

### profiles

```sql
-- Users can read/update their own profile
-- (existing policies, unchanged)
```

### All pharmacy-scoped tables (future: assessments, prescriptions, audit_logs)

```sql
-- Users can only see data for pharmacies they belong to
CREATE POLICY "pharmacy_scope" ON <table>
  FOR ALL TO authenticated
  USING (
    pharmacy_id IN (
      SELECT pharmacy_id FROM pharmacy_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
```

## Files to Change

### Schema (Supabase migration)

1. Add `is_platform_admin` boolean to `profiles`
2. Set `is_platform_admin = true` WHERE `role = 'platform_admin'`
3. Create `pharmacy_members` table with constraints and indexes
4. Backfill: `INSERT INTO pharmacy_members (user_id, pharmacy_id, role) SELECT id, pharmacy_id, role FROM profiles WHERE pharmacy_id IS NOT NULL`
5. Enable RLS on `pharmacy_members`
6. Add RLS policies
7. After app code migration verified: drop `profiles.role` column

### Types

- `src/types/index.ts`:
  - Remove `UserRole` type (or keep for pharmacy_members role values)
  - `Profile`: remove `role`, add `isPlatformAdmin: boolean`, add `activeRole: string` (from pharmacy_members)
  - Add `PharmacyMember` type

### Auth

- `src/lib/auth-guards.ts`:
  - `getProfile()`: join `pharmacy_members` to get active role. Return `activeRole` from membership.
  - `requireRole()`: check `activeRole` from pharmacy_members, not profiles.role
  - Add `requirePlatformAdmin()` for admin-only routes
- `src/lib/auth-actions.ts`:
  - Signup: insert into `pharmacy_members` with role='owner'
  - Invite accept: insert into `pharmacy_members` with role='pharmacist'
  - Remove role from profile inserts/updates
  - Add `switchPharmacy()`, `addPharmacy()`, `getUserPharmacies()` (or move to new file)

### New files

- `src/components/pharmacy-picker.tsx`: Full-screen picker + modal variant
- `src/lib/pharmacy-actions.ts`: switchPharmacy, addPharmacy, getUserPharmacies server actions

### Settings

- `src/app/settings/pharmacy/page.tsx`: Add "Add Pharmacy" button, show pharmacy count/limit
- `src/app/settings/pharmacy/add-pharmacy-form.tsx`: Form for creating new pharmacy
- `src/app/settings/team/page.tsx`: Query `pharmacy_members` instead of `profiles WHERE pharmacy_id = X`

### Layout/Nav

- Dashboard layout: Add pharmacy badge (active pharmacy name) + "Switch Pharmacy" button to header
- Pharmacy badge styled prominently (colored, always visible)

### Assessment

- Assessment wizard: Capture `pharmacy_id` at start, lock for duration
- PDF generation: Use locked pharmacy_id, not current active

### Tests

- Update all mocked profiles: remove `role`, add `isPlatformAdmin`, add `activeRole`
- Update `auth-actions.test.ts`, `auth-guards.test.ts`, `wizard-logic.test.ts`
- Add tests for pharmacy switching, multi-pharmacy role resolution

## Out of Scope

- Stripe billing integration (tier limits hardcoded for now)
- Pharmacy deactivation/removal
- Transfer ownership between users
- Audit log pharmacy scoping (separate task)
- Mobile app changes

## Decisions Log

1. **Users with no pharmacy** — Redirected to onboarding flow. No role needed until they create or join a pharmacy.
2. **Invite acceptance doesn't switch active pharmacy** — If user already has an active pharmacy, keep it. Only set if pharmacy_id IS NULL.
3. **Both pharmacist and owner can remove memberships** — Pharmacist self-removal + owner removal. Soft delete (`is_active = false`).
4. **Removed from only pharmacy** — Set pharmacy_id = NULL, redirect to "awaiting assignment" state.
5. **No cross-pharmacy visibility** — Owners only see their own pharmacy's members. Privacy between pharmacies.
6. **Invites scoped to active pharmacy** — No extra picker needed. The team page is already pharmacy-contextual.
7. **Hard block on tier limit** — Cannot add pharmacy if at limit. Show upgrade message.
8. **Hard lock during assessment** — Switch Pharmacy completely disabled during assessment. No switching, no persistence of in-progress state.
9. **No persistence of assessments** — If pharmacist leaves the assessment page, state is lost. Start fresh.
10. **No pre-selection on login picker** — Every login with multiple pharmacies requires deliberate re-selection. No "remember last pharmacy."
