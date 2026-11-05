import { PharmacyBadge } from "@/components/pharmacy-badge"
import { UserNav } from "@/components/user-nav"
import type { PharmacyMember, Profile } from "@/types"

/**
 * Standard chrome for top-level app surfaces (dashboard, vaccinate index):
 * 6xl header with a leading element (brand mark or back), title + subtitle,
 * PharmacyBadge + UserNav on the right, 6xl content column, optional footer.
 *
 * Distinct from PageShell (3xl inner pages with back-nav) — one level, two
 * shells, each used consistently everywhere at its level.
 */
export function AppShell({
  title,
  subtitle,
  leading,
  footer,
  profile,
  pharmacyName,
  memberships,
  children,
}: {
  title: string
  subtitle?: string
  /** Brand mark or back button at the far left of the bar. */
  leading?: React.ReactNode
  footer?: string
  profile: Profile
  pharmacyName: string | null
  memberships: PharmacyMember[]
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {leading}
            <div>
              <h1 className="text-lg font-bold leading-none tracking-tight">{title}</h1>
              {subtitle ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PharmacyBadge
              pharmacyName={pharmacyName}
              pharmacyId={profile.pharmacyId}
              memberships={memberships}
            />
            <UserNav profile={profile} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      {footer ? (
        <footer className="mt-auto border-t">
          <div className="mx-auto max-w-6xl px-6 py-4 text-center text-xs text-muted-foreground">
            {footer}
          </div>
        </footer>
      ) : null}
    </div>
  )
}
