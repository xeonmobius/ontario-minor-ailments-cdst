"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

export async function login(_prev: any, formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const password = formData.get("password") as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message }
  }

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
    const { error: pharmError } = await supabase.from("pharmacies").insert({
      name: pharmacyName,
      address,
      city,
      province: "Ontario",
      postal_code: postalCode,
      phone,
      fax,
      created_by: authData.user.id,
    }).select("id").single()

    if (pharmError) {
      console.error("Pharmacy insert error:", pharmError)
    }

    const { data: newPharmacy } = await supabase
      .from("pharmacies")
      .select("id")
      .eq("created_by", authData.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (newPharmacy) {
      await supabase.from("profiles").upsert({
        id: authData.user.id,
        pharmacy_id: newPharmacy.id,
        role: "owner",
        full_name: fullName,
        email,
        province: "Ontario",
      })
    }
  }

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

  revalidatePath("/", "layout")
  return { success: true }
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath("/", "layout")
  redirect("/login")
}

export async function createInvitation(formData: FormData) {
  const supabase = await createClient()
  const email = formData.get("email") as string
  const { data: profile } = await supabase
    .from("profiles")
    .select("pharmacy_id, role")
    .eq("id", (await supabase.auth.getUser()).data.user?.id)
    .single()

  if (!profile || profile.role !== "owner") {
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

  revalidatePath("/settings/team")
  return { success: true }
}
