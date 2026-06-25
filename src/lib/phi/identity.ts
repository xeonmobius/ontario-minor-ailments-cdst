import { createHmac, randomBytes } from "crypto"

const SALT = process.env.PHI_IDENTITY_SALT ?? "dev-only-change-me"

export function pseudonymize(value: string): string {
  return createHmac("sha256", SALT).update(value.toLowerCase().trim()).digest("hex")
}

export function patientHash(name: string, dob: string): string {
  return pseudonymize(`${name}|${dob}`)
}

export function generateRecordId(): string {
  return randomBytes(16).toString("hex")
}
