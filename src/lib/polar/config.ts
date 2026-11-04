/**
 * Shared Polar configuration so checkout, portal, and webhook handlers can't
 * drift between sandbox and production. Sandbox is the default until
 * POLAR_SANDBOX is explicitly flipped.
 */
export function polarEnvironment(): "sandbox" | "production" {
  return process.env.POLAR_SANDBOX === "true" ? "sandbox" : "production"
}

export function polarSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}
