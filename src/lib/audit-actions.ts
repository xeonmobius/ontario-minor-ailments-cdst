"use server"

import { createClient } from "@/lib/supabase/server"

type EventType =
  | "auth.login"
  | "auth.logout"
  | "auth.login_failed"
  | "auth.signup"
  | "auth.password_change"
  | "auth.email_change"
  | "pharmacy.updated"
  | "profile.updated"
  | "team.invite_created"
  | "team.invite_accepted"
  | "assessment.opened"
  | "pdf.generated"
  | "export.requested"

export async function logAuditEvent(
  eventType: EventType,
  metadata: Record<string, string> = {},
  resourceType?: string,
  resourceId?: string
) {
  try {
    const supabase = await createClient()
    await supabase.rpc("log_event", {
      p_event_type: eventType,
      p_resource_type: resourceType ?? null,
      p_resource_id: resourceId ?? null,
      p_metadata: metadata,
    })
  } catch {}
}

export async function getAuditLog(limit = 100, offset = 0) {
  const supabase = await createClient()
  const { data } = await supabase
    .schema("audit")
    .from("log")
    .select("id, event_type, actor_id, pharmacy_id, resource_type, resource_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
  return data ?? []
}
