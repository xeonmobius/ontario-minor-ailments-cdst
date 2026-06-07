"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { logAuditEvent } from "@/lib/audit-actions"

export async function login(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    await logAuditEvent("auth.login_failed")
    return { error: error.message }
  }

  await logAuditEvent("auth.login")
  revalidatePath("/", "layout")
  redirect("/")
}

export async function signup(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string
  const pharmacyName = formData.get("pharmacyName") as string
  const address = formData.get("address") as string
  const city = formData.get("city") as string
  const postalCode = formData.get("postalCode") as string
  const phone = formData.get("phone") as string
  const fax = (formData.get("fax") as string) || null

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: "owner",
        pharmacy_name: pharmacyName,
        address,
        city,
        province: "Ontario",
        postal_code: postalCode,
        phone,
        fax,
      },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  if (authData.user) {
    const { data: newPharmacy } = await supabase
      .from("pharmacies")
      .insert({
        name: pharmacyName,
        address,
        city,
        province: "Ontario",
        postal_code: postalCode,
        phone,
        fax,
        created_by: authData.user.id,
      })
      .select("id")
      .single()

    if (newPharmacy) {
      await supabase.from("profiles").upsert({
        id: authData.user.id,
        pharmacy_id: newPharmacy.id,
        full_name: fullName,
        email,
        province: "Ontario",
      })
      await supabase.from("pharmacy_members").insert({
        user_id: authData.user.id,
        pharmacy_id: newPharmacy.id,
        role: "owner",
      })
    }
  }

  await logAuditEvent("auth.signup", { pharmacy_name: pharmacyName })
  revalidatePath("/", "layout")
  redirect("/")
}

export async function signupWithInvite(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string
  const fullName = formData.get("fullName") as string
  const provincialLicense = formData.get("provincialLicense") as string
  const province = formData.get("province") as string
  const token = formData.get("token") as string

  const { data: invite, error: inviteError } = await supabase
    .from("invitations")
    .select("pharmacy_id, email, expires_at, accepted_at")
    .eq("token", token)
    .single()

  if (inviteError || !invite) {
    return { error: "Invalid or expired invitation." }
  }

  if (invite.accepted_at) {
    return { error: "This invitation has already been used." }
  }

  if (new Date(invite.expires_at) < new Date()) {
    return { error: "This invitation has expired." }
  }

  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    return { error: "Email does not match the invitation." }
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        role: "pharmacist",
        provincial_license: provincialLicense,
        province,
        pharmacy_id: invite.pharmacy_id,
        invite_token: token,
      },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  if (authData.user) {
    await supabase.from("profiles").upsert({
      id: authData.user.id,
      pharmacy_id: invite.pharmacy_id,
      full_name: fullName,
      email,
      province,
      provincial_license: provincialLicense,
    })
    await supabase.from("pharmacy_members").insert({
      user_id: authData.user.id,
      pharmacy_id: invite.pharmacy_id,
      role: "pharmacist",
    })
    await supabase.from("invitations").update({ accepted_at: new Date().toISOString() }).eq("token", token)
  }

  revalidatePath("/", "layout")
  return { success: true }
}

export async function logout() {
  const supabase = await createClient()
  await logAuditEvent("auth.logout")
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}

export async function createInvitation(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const { data: profile } = await supabase
    .from("profiles")
    .select("pharmacy_id")
    .eq("id", (await supabase.auth.getUser()).data.user?.id)
    .single()

  if (!profile?.pharmacy_id) {
    return { error: "No active pharmacy." }
  }

  const { data: membership } = await supabase
    .from("pharmacy_members")
    .select("role")
    .eq("user_id", (await supabase.auth.getUser()).data.user?.id)
    .eq("pharmacy_id", profile.pharmacy_id)
    .eq("is_active", true)
    .single()

  if (!membership || membership.role !== "owner") {
    return { error: "Only owners can invite pharmacists." }
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from("invitations").insert({
    pharmacy_id: profile.pharmacy_id,
    email,
    role: "pharmacist",
    token,
    expires_at: expiresAt,
    created_by: (await supabase.auth.getUser()).data.user?.id,
  })

  if (error) {
    return { error: error.message }
  }

  await logAuditEvent("team.invite_created", { invite_email: email })
  revalidatePath("/settings/team")
  return { success: true }
}

export async function forgotPassword(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/reset-password`,
  })

  return { success: true }
}

export async function resetPassword(_prev: any, formData: FormData) {
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  await logAuditEvent("auth.password_change", { method: "reset_link" })
  return { success: true }
}

export async function changePassword(_prev: any, formData: FormData) {
  const currentPassword = formData.get("currentPassword") as string
  const password = formData.get("password") as string
  const confirmPassword = formData.get("confirmPassword") as string

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" }
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user?.email) {
    return { error: "Not authenticated" }
  }

  const { error: reAuthError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  })

  if (reAuthError) {
    return { error: "Current password is incorrect" }
  }

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  await logAuditEvent("auth.password_change", { method: "settings" })
  return { success: true }
}

export async function changeEmail(_prev: any, formData: FormData) {
  const email = formData.get("email") as string
  const currentPassword = formData.get("currentPassword") as string

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user?.email) {
    return { error: "Not authenticated" }
  }

  if (email === userData.user.email) {
    return { error: "New email is the same as current email" }
  }

  const { error: reAuthError } = await supabase.auth.signInWithPassword({
    email: userData.user.email,
    password: currentPassword,
  })

  if (reAuthError) {
    return { error: "Current password is incorrect" }
  }

  const { error } = await supabase.auth.updateUser({ email })

  if (error) {
    return { error: error.message }
  }

  await logAuditEvent("auth.email_change", { old_email: userData.user.email, new_email: email })
  return { success: true }
}
