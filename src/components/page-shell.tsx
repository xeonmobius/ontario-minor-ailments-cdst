import { BackButton } from "@/components/back-button"

/**
 * Standard page chrome for inner-app pages: top bar (back + title + optional
 * right-side actions) over a centered content column. The single source for
 * the `text-lg` bar title, `max-w-3xl` measure, and bar/main spacing.
 *
 * Auth pages (login/signup) intentionally don't use this — they are centered
 * `max-w-md` flows, not navigation pages.
 */
export function PageShell({
  title,
  actions,
  children,
  mainClassName,
}: {
  /** Bar title. Omit on wizard pages whose content owns the heading. */
  title?: string
  /** Right-aligned header content (e.g. a primary action). */
  actions?: React.ReactNode
  children: React.ReactNode
  /** Extra classes for the main container (e.g. `space-y-8`). */
  mainClassName?: string
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <BackButton />
          {title ? (
            <h1 className="text-lg font-bold tracking-tight">{title}</h1>
          ) : null}
          {actions ? <div className="ml-auto">{actions}</div> : null}
        </div>
      </header>
      <main
        className={`mx-auto w-full max-w-3xl flex-1 px-6 py-8${mainClassName ? ` ${mainClassName}` : ""}`}
      >
        {children}
      </main>
    </div>
  )
}
