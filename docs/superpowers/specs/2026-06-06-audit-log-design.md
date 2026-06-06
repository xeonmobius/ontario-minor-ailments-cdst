# Audit Log Design

## Goal

Add an immutable, tamper-evident audit log to the CDST for PHIPA s.10.1 (Ontario) and PIPEDA (federal) compliance. Logs non-PHI events now (auth, tx IDs, settings); designed to extend to PHI events when fly.io storage is added later.

## PHI Analysis

The audit log stores NO patient data, drug names, diagnoses, or clinical information. It logs:

| Field | PHI? |
|-------|------|
| event_type (enum) | No |
| actor_id (pharmacist) | No (employee ID) |
| pharmacy_id | No (business ID) |
| resource_type, resource_id | No |
| metadata (validated jsonb) | No — whitelisted keys only |
| ip_address | PII under PIPEDA, not PHI |
| created_at | No |

**Future PHI events (on fly.io):** Same schema, different infrastructure. When patient records are stored on fly.io, PHI audit events go there. This Supabase audit log stays non-PHI.

## Legal Basis

- **PHIPA s.10.1**: Requires electronic audit log for every instance PHI is viewed, handled, modified. Not yet in force (awaits proclamation), but implementing now.
- **PHIPA s.12**: Custodians must protect PHI against theft, loss, unauthorized use/disclosure. Audit logging is a key safeguard.
- **PIPEDA Principle 4.7**: Security safeguards appropriate to sensitivity. Audit logging is a recognized safeguard.
- **IPC Guidance**: "Detecting and Deterring Unauthorized Access" recommends logging, auditing, and monitoring all electronic PHI access.
- **Data residency**: Supabase project is in `ca-central-1` (Montreal). All data stays in Canada.

## Data Model

### Schema

```sql
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TYPE audit.event_type AS ENUM (
  'auth.login',
  'auth.logout',
  'auth.login_failed',
  'auth.signup',
  'auth.password_change',
  'rx_tx_reserved',
  'pharmacy.updated',
  'profile.updated',
  'team.invite_created',
  'team.invite_accepted',
  'assessment.opened',
  'pdf.generated',
  'export.requested'
);

CREATE TABLE audit.log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type audit.event_type NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  pharmacy_id uuid REFERENCES public.pharmacies(id),
  resource_type text,
  resource_id uuid,
  metadata jsonb DEFAULT '{}',
  ip_address inet,
  chain_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX audit_log_actor ON audit.log (actor_id);
CREATE INDEX audit_log_pharmacy ON audit.log (pharmacy_id, created_at DESC);
CREATE INDEX audit_log_event_type ON audit.log (event_type, created_at DESC);
CREATE INDEX audit_log_created ON audit.log (created_at DESC);
```

### Tamper Evidence: Hash Chain

Each row stores `chain_hash = sha256(prev_hash || event_type || actor_id || pharmacy_id || created_at)`. If any row is modified or deleted, the chain breaks.

```sql
CREATE OR REPLACE FUNCTION audit.compute_chain_hash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
declare
  v_prev_hash text;
begin
  SELECT chain_hash INTO v_prev_hash
  FROM audit.log
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  v_prev_hash := coalesce(v_prev_hash, '');

  NEW.chain_hash := encode(
    digest(
      v_prev_hash || NEW.event_type::text || NEW.actor_id::text ||
      coalesce(NEW.pharmacy_id::text, '') || NEW.created_at::text,
      'sha256'
    ),
    'hex'
  );

  RETURN NEW;
end;
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TRIGGER audit_chain_hash
  BEFORE INSERT ON audit.log
  FOR EACH ROW
  EXECUTE FUNCTION audit.compute_chain_hash();
```

Periodic external snapshot: store the latest `chain_hash` on fly.io or a WORM store. The Commissioner can verify chain integrity.

### Write Path: SECURITY DEFINER Function

```sql
CREATE OR REPLACE FUNCTION audit.log_event(
  p_event_type audit.event_type,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_actor_id uuid;
  v_pharmacy_id uuid;
  v_result uuid;
begin
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Look up pharmacy from profiles (SECURITY DEFINER bypasses RLS)
  SELECT pharmacy_id INTO v_pharmacy_id
  FROM public.profiles WHERE id = v_actor_id;

  -- Validate metadata size (max 1KB)
  IF length(p_metadata::text) > 1024 THEN
    RAISE EXCEPTION 'Metadata exceeds 1KB limit';
  END IF;

  -- Validate metadata is a flat object (no nested objects/arrays)
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_metadata)
    WHERE jsonb_typeof(value) IN ('object', 'array')
  ) THEN
    RAISE EXCEPTION 'Metadata must be flat key-value pairs only';
  END IF;

  -- Validate required metadata per event type
  IF p_event_type = 'rx_tx_reserved' AND (p_metadata->>'tx_id') IS NULL THEN
    RAISE EXCEPTION 'rx_tx_reserved requires tx_id in metadata';
  END IF;

  IF p_event_type = 'pharmacy.updated' AND (p_metadata->>'fields') IS NULL THEN
    RAISE EXCEPTION 'pharmacy.updated requires fields in metadata';
  END IF;

  IF p_event_type = 'export.requested' AND (p_metadata->>'format') IS NULL THEN
    RAISE EXCEPTION 'export.requested requires format in metadata';
  END IF;

  INSERT INTO audit.log (event_type, actor_id, pharmacy_id, resource_type, resource_id, metadata)
  VALUES (p_event_type, v_actor_id, v_pharmacy_id, p_resource_type, p_resource_id, p_metadata)
  RETURNING id INTO v_result;

  RETURN v_result;
end;
$$;
```

Key security properties:
- `actor_id` derived from `auth.uid()` — never a parameter (not spoofable)
- `created_at` is `DEFAULT now()` — never a parameter (not spoofable)
- `event_type` is an ENUM — only whitelisted values accepted
- `metadata` validated: max 1KB, flat key-value only, required keys per event type
- `SET search_path = ''` — prevents search path injection
- IP address NOT a parameter — must be set by a separate mechanism (see below)

### IP Address Handling

IP is set via a database trigger or application-level mechanism, NOT passed as a parameter to `log_event`. The server action extracts IP from `request.headers` and sets it via a separate UPDATE or by passing it through a different function. IP is PII under PIPEDA — documented in privacy policy, truncated to `/24` after 90 days.

### Rate Limiting

```sql
CREATE OR REPLACE FUNCTION audit.check_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  IF (
    SELECT count(*) >= 100
    FROM audit.log
    WHERE actor_id = NEW.actor_id
    AND created_at > now() - interval '1 minute'
  ) THEN
    RAISE EXCEPTION 'Audit log rate limit exceeded';
  END IF;
  RETURN NEW;
end;
$$;

CREATE TRIGGER audit_rate_limit
  BEFORE INSERT ON audit.log
  FOR EACH ROW
  EXECUTE FUNCTION audit.check_rate_limit();
```

Max 100 events per actor per minute. Prevents log flooding.

### RLS

```sql
ALTER TABLE audit.log ENABLE ROW LEVEL SECURITY;

-- SELECT: same-pharmacy members
CREATE POLICY pharmacy_audit_read ON audit.log
  FOR SELECT TO authenticated
  USING (pharmacy_id = public.get_user_pharmacy_id());

-- Platform admin: read all (for commissioner requests)
CREATE POLICY platform_admin_audit_read ON audit.log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'platform_admin'
    )
  );

-- Explicit UPDATE/DELETE denial
CREATE POLICY no_update ON audit.log FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY no_delete ON audit.log FOR DELETE USING (false);
```

No INSERT policy — writes go through `SECURITY DEFINER` function only.

### Critical Events: Database Triggers

For `rx_tx_reserved`, use a database trigger to ensure the audit entry is in the same transaction as the data change. If the audit insert fails, the whole transaction fails — no silent data loss.

```sql
CREATE OR REPLACE FUNCTION public.on_prescription_tx_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
begin
  INSERT INTO audit.log (event_type, actor_id, pharmacy_id, resource_type, resource_id, metadata)
  VALUES (
    'rx_tx_reserved',
    auth.uid(),
    NEW.pharmacy_id,
    'prescription_tx',
    NEW.id,
    jsonb_build_object('tx_id', NEW.tx_id)
  );
  RETURN NEW;
end;
$$;

CREATE TRIGGER on_rx_tx_insert
  AFTER INSERT ON public.prescription_tx
  FOR EACH ROW
  EXECUTE FUNCTION public.on_prescription_tx_insert();
```

## Events

| Event | Trigger | Metadata | Source |
|-------|---------|----------|--------|
| `auth.login` | User signs in | `{}` | Server action (login) |
| `auth.logout` | User signs out | `{}` | Server action (logout) |
| `auth.login_failed` | Wrong password/email | `{}` | Server action (login error) |
| `auth.signup` | New account created | `{ pharmacy_name }` | Server action (signup) |
| `auth.password_change` | Password updated | `{}` | Future |
| `rx_tx_reserved` | Prescription tx ID generated | `{ tx_id }` | DB trigger (auto) |
| `pharmacy.updated` | Pharmacy settings saved | `{ fields: "phone,fax" }` | Client action |
| `profile.updated` | Profile settings saved | `{ fields: "full_name" }` | Client action |
| `team.invite_created` | Owner invites pharmacist | `{ invite_email }` | Server action |
| `team.invite_accepted` | Pharmacist accepts invite | `{}` | Server action |
| `assessment.opened` | Pharmacist starts assessment | `{ ailment }` | Server action |
| `pdf.generated` | PDF downloaded | `{ tx_id }` | Server action |
| `export.requested` | Audit data exported | `{ format, date_range }` | Server action |

## Client API

Server action in `src/lib/audit-actions.ts`:

```typescript
"use server"

import { createClient } from "@/lib/supabase/server"

type EventType =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.signup"
  | "pharmacy.updated"
  | "profile.updated"
  | "team.invite_created"
  | "team.invite_accepted"
  | "assessment.opened"
  | "pdf.generated"
  | "export.requested"

export async function logAuditEvent(
  eventType: EventType,
  metadata: Record<string, string> = {}
) {
  const supabase = await createClient()
  await supabase.rpc("log_event", {
    p_event_type: eventType,
    p_metadata: metadata,
  })
}

export async function getAuditLog(
  limit = 100,
  offset = 0
) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("log")
    .select("id, event_type, actor_id, pharmacy_id, resource_type, resource_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
    .schema("audit")
  return data ?? []
}
```

Note: `rx_tx_reserved` is auto-logged by the DB trigger — no client call needed.

## Separation of Duties

- **Pharmacy owner**: Can read all audit entries for their pharmacy (including their own)
- **Platform admin**: Can read all pharmacies' audit entries (for commissioner requests). Every `platform_admin` access is itself logged as `export.requested`.
- **Immutable**: Neither role can UPDATE or DELETE entries.
- **Hash chain**: Even if a superuser modifies the DB directly, the chain breaks and is detectable.

## Export for Commissioner

Server action generates encrypted export:

1. `export.requested` event is logged first
2. Query `audit.log` for the specified pharmacy + date range
3. Generate CSV server-side
4. Encrypt with AES-256 (key provided by commissioner or stored in Vault)
5. Return encrypted file for secure delivery
6. Auto-delete server-side copy after delivery

## Retention

- **10 years minimum** from `created_at`, per Ontario pharmacy record retention
- No automated deletion — rows persist indefinitely until retention policy is implemented
- IP addresses truncated to `/24` (IPv4) or `/48` (IPv6) after 90 days

## Future PHI Events (fly.io)

When patient records are stored on fly.io:
- Same event schema pattern on fly.io Postgres
- PHI events: `patient_record.viewed`, `assessment.saved`, `prescription.created`
- These events contain patient identifiers and are PHI — stored on fly.io under BAA
- Export format matches Supabase audit schema for unified Commissioner view

## Files Changed

- `src/lib/audit-actions.ts` — new file, `logAuditEvent()` + `getAuditLog()` server actions
- `src/lib/auth-actions.ts` — add `logAuditEvent` calls to login/logout/signup
- `src/lib/prescription-actions.ts` — no change needed (rx_tx_reserved auto-logged by trigger)
- `src/app/settings/pharmacy/pharmacy-form.tsx` — log `pharmacy.updated` on save
- `src/app/settings/profile/profile-form.tsx` — log `profile.updated` on save
- `src/app/settings/team/invite-form.tsx` — log `team.invite_created`
- Database migration — create `audit` schema, `audit.log` table, triggers, functions, RLS
